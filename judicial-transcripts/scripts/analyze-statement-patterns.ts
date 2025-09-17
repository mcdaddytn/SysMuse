import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeStatements() {
  // Get all trials
  const trials = await prisma.trial.findMany({
    orderBy: { id: 'asc' }
  });

  console.log('\n=== Trial Statement Analysis ===\n');

  const problemTrials: any[] = [];

  for (const trial of trials) {
    console.log(`\nTrial ${trial.id}: ${trial.shortName}`);
    console.log(`Case: ${trial.caseNumber}`);

    let hasProblems = false;
    const problems: string[] = [];

    // Get opening statements
    const openingStatements = await prisma.markerSection.findMany({
      where: {
        trialId: trial.id,
        markerSectionType: {
          in: ['OPENING_STATEMENT_PLAINTIFF', 'OPENING_STATEMENT_DEFENSE']
        }
      },
      orderBy: { startEventId: 'asc' }
    });

    // Get closing statements
    const closingStatements = await prisma.markerSection.findMany({
      where: {
        trialId: trial.id,
        markerSectionType: {
          in: ['CLOSING_STATEMENT_PLAINTIFF', 'CLOSING_STATEMENT_DEFENSE', 'CLOSING_REBUTTAL_PLAINTIFF']
        }
      },
      orderBy: { startEventId: 'asc' }
    });

    console.log('Opening Statements:');
    if (openingStatements.length === 0) {
      console.log('  ❌ NONE FOUND');
      hasProblems = true;
      problems.push('No opening statements');
    } else {
      // Check order
      const plaintiffOpening = openingStatements.find(s => s.markerSectionType === 'OPENING_STATEMENT_PLAINTIFF');
      const defenseOpening = openingStatements.find(s => s.markerSectionType === 'OPENING_STATEMENT_DEFENSE');

      if (!plaintiffOpening) {
        console.log('  ❌ Missing plaintiff opening');
        hasProblems = true;
        problems.push('Missing plaintiff opening');
      } else {
        console.log(`  PLAINTIFF: Events ${plaintiffOpening.startEventId || '?'}-${plaintiffOpening.endEventId || '?'}`);
      }

      if (!defenseOpening) {
        console.log('  ❌ Missing defense opening');
        hasProblems = true;
        problems.push('Missing defense opening');
      } else {
        console.log(`  DEFENSE: Events ${defenseOpening.startEventId || '?'}-${defenseOpening.endEventId || '?'}`);
      }

      // Check order
      if (plaintiffOpening && defenseOpening &&
          plaintiffOpening.startEventId && defenseOpening.startEventId &&
          plaintiffOpening.startEventId > defenseOpening.startEventId) {
        console.log('  ⚠️ WRONG ORDER: Defense before plaintiff');
        hasProblems = true;
        problems.push('Opening statements out of order');
      }
    }

    console.log('Closing Statements:');
    if (closingStatements.length === 0) {
      console.log('  ❌ NONE FOUND');
      hasProblems = true;
      problems.push('No closing statements');
    } else {
      const plaintiffClosing = closingStatements.find(s => s.markerSectionType === 'CLOSING_STATEMENT_PLAINTIFF');
      const defenseClosing = closingStatements.find(s => s.markerSectionType === 'CLOSING_STATEMENT_DEFENSE');
      const rebuttal = closingStatements.find(s => s.markerSectionType === 'CLOSING_REBUTTAL_PLAINTIFF');

      if (!plaintiffClosing) {
        console.log('  ❌ Missing plaintiff closing');
        hasProblems = true;
        problems.push('Missing plaintiff closing');
      } else {
        console.log(`  PLAINTIFF: Events ${plaintiffClosing.startEventId || '?'}-${plaintiffClosing.endEventId || '?'}`);
      }

      if (!defenseClosing) {
        console.log('  ❌ Missing defense closing');
        hasProblems = true;
        problems.push('Missing defense closing');
      } else {
        console.log(`  DEFENSE: Events ${defenseClosing.startEventId || '?'}-${defenseClosing.endEventId || '?'}`);
      }

      if (rebuttal) {
        console.log(`  REBUTTAL: Events ${rebuttal.startEventId || '?'}-${rebuttal.endEventId || '?'}`);
      }

      // Check order
      if (plaintiffClosing && defenseClosing &&
          plaintiffClosing.startEventId && defenseClosing.startEventId &&
          plaintiffClosing.startEventId > defenseClosing.startEventId) {
        console.log('  ⚠️ WRONG ORDER: Defense before plaintiff in closing');
        hasProblems = true;
        problems.push('Closing statements out of order');
      }

      if (rebuttal && defenseClosing &&
          rebuttal.startEventId && defenseClosing.startEventId &&
          rebuttal.startEventId < defenseClosing.startEventId) {
        console.log('  ⚠️ WRONG ORDER: Rebuttal before defense');
        hasProblems = true;
        problems.push('Rebuttal before defense');
      }
    }

    if (hasProblems) {
      problemTrials.push({
        trialId: trial.id,
        shortName: trial.shortName,
        problems
      });
    }
  }

  console.log('\n\n=== SUMMARY OF PROBLEMATIC TRIALS ===\n');
  if (problemTrials.length === 0) {
    console.log('✅ All trials have properly sequenced statements');
  } else {
    console.log(`Found ${problemTrials.length} trials with issues:\n`);
    for (const trial of problemTrials) {
      console.log(`Trial ${trial.trialId}: ${trial.shortName}`);
      for (const problem of trial.problems) {
        console.log(`  - ${problem}`);
      }
    }
  }

  await prisma.$disconnect();
}

analyzeStatements().catch(console.error);