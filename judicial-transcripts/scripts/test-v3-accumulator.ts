import { PrismaClient, MarkerSource } from '@prisma/client';
import { StandardTrialHierarchyBuilder } from '../src/phase3/StandardTrialHierarchyBuilder';

const prisma = new PrismaClient();

async function deletePhase3Data(trialId: number, trialName: string) {
  console.log(`\n=== Deleting Phase3 data for Trial ${trialId}: ${trialName} ===`);

  // Delete MarkerSections created by Phase3
  const deletedSections = await prisma.markerSection.deleteMany({
    where: {
      trialId,
      source: {
        in: [MarkerSource.PHASE3_HIERARCHY, MarkerSource.PHASE3_DISCOVERY, MarkerSource.PHASE3_ZEROLENGTH]
      }
    }
  });

  console.log(`Deleted ${deletedSections.count} marker sections`);

  // Delete any accumulator results
  const deletedAccumulator = await prisma.accumulatorResult.deleteMany({
    where: { trialId }
  });

  console.log(`Deleted ${deletedAccumulator.count} accumulator results`);

  // Delete any elastic search results
  const deletedElastic = await prisma.elasticSearchResult.deleteMany({
    where: { trialId }
  });

  console.log(`Deleted ${deletedElastic.count} elastic search results`);
}

async function testTrialV3(trialId: number) {
  const trial = await prisma.trial.findUnique({
    where: { id: trialId },
    select: {
      id: true,
      shortName: true,
      caseNumber: true
    }
  });

  if (!trial) {
    console.error(`Trial ${trialId} not found`);
    return;
  }

  console.log(`\n=== Testing Trial ${trial.id}: ${trial.shortName} ===`);
  console.log(`Case: ${trial.caseNumber}`);

  // Delete existing Phase3 data
  await deletePhase3Data(trial.id, trial.shortName || `trial_${trial.id}`);

  // Run Phase3 with V3 accumulator
  console.log('\n--- Running Phase3 with V3 Accumulator ---');
  const builder = new StandardTrialHierarchyBuilder(prisma);

  try {
    await builder.buildStandardHierarchy(trial.id);
    console.log('✅ Phase3 completed successfully');
  } catch (error) {
    console.error('❌ Phase3 failed:', error);
  }

  // Check results
  console.log('\n--- Checking Results ---');
  const openingStatements = await prisma.markerSection.findMany({
    where: {
      trialId: trial.id,
      markerSectionType: {
        in: ['OPENING_STATEMENT_PLAINTIFF', 'OPENING_STATEMENT_DEFENSE']
      }
    },
    orderBy: { startEventId: 'asc' }
  });

  const closingStatements = await prisma.markerSection.findMany({
    where: {
      trialId: trial.id,
      markerSectionType: {
        in: ['CLOSING_STATEMENT_PLAINTIFF', 'CLOSING_STATEMENT_DEFENSE', 'CLOSING_REBUTTAL_PLAINTIFF']
      }
    },
    orderBy: { startEventId: 'asc' }
  });

  console.log('\nOpening Statements Found:');
  for (const stmt of openingStatements) {
    const metadata = stmt.metadata as any;
    console.log(`  ${stmt.markerSectionType}: Events ${stmt.startEventId}-${stmt.endEventId}`);
    console.log(`    Confidence: ${stmt.confidence?.toFixed(2)}, Ratio: ${metadata?.speakerRatio?.toFixed(2)}`);
    console.log(`    Words: ${metadata?.totalWords} total, ${metadata?.speakerWords} speaker`);
    console.log(`    Algorithm: ${metadata?.algorithm || 'unknown'}`);
  }

  console.log('\nClosing Statements Found:');
  for (const stmt of closingStatements) {
    const metadata = stmt.metadata as any;
    console.log(`  ${stmt.markerSectionType}: Events ${stmt.startEventId}-${stmt.endEventId}`);
    console.log(`    Confidence: ${stmt.confidence?.toFixed(2)}, Ratio: ${metadata?.speakerRatio?.toFixed(2)}`);
    console.log(`    Words: ${metadata?.totalWords} total, ${metadata?.speakerWords} speaker`);
    console.log(`    Algorithm: ${metadata?.algorithm || 'unknown'}`);
  }

  // Check if evaluation logs were created
  const fs = require('fs');
  const path = require('path');
  const logDir = path.join('output/longstatements', trial.shortName || `trial_${trial.id}`);
  if (fs.existsSync(logDir)) {
    console.log('\n--- Evaluation Logs Created ---');
    const files = fs.readdirSync(logDir);
    for (const file of files) {
      const size = fs.statSync(path.join(logDir, file)).size;
      console.log(`  ${file} (${size} bytes)`);
    }
  } else {
    console.log('\n⚠️ No evaluation logs found at', logDir);
  }
}

async function main() {
  // Test specific problematic trials
  const problematicTrials = [
    { id: 2, name: '02 Contentguard', issue: 'Missing defense opening and closing' },
    { id: 8, name: '10 Metaswitch Genband 2016', issue: 'Opening statements out of order' },
    { id: 27, name: '36 Salazar V. Htc', issue: 'Missing defense opening' }
  ];

  console.log('=== Testing V3 Accumulator on Problematic Trials ===\n');
  console.log('Configuration:');
  console.log('  - Algorithm: Defense-first with window narrowing');
  console.log('  - Ratio Mode: WEIGHTED_SQRT');
  console.log('  - Min Words: 400');
  console.log('  - Tracking: Enabled (output to ./output/longstatements/)');
  console.log('  - Initial Threshold Required: Yes');

  // Allow selecting specific trial via command line
  const trialArg = process.argv[2];
  if (trialArg) {
    const trialId = parseInt(trialArg);
    if (!isNaN(trialId)) {
      await testTrialV3(trialId);
    } else {
      // Look for trial by shortName
      const trial = await prisma.trial.findFirst({
        where: {
          OR: [
            { shortName: { contains: trialArg } },
            { caseNumber: { contains: trialArg } }
          ]
        }
      });
      if (trial) {
        await testTrialV3(trial.id);
      } else {
        console.error(`Trial not found: ${trialArg}`);
      }
    }
  } else {
    // Test first problematic trial
    console.log('\nTesting first problematic trial. Use "npm run test:v3 <trialId>" to test specific trial.\n');
    await testTrialV3(problematicTrials[0].id);
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('Error:', error);
  prisma.$disconnect();
  process.exit(1);
});