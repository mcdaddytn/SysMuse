#!/usr/bin/env node
// src/cli/fix-trial-metadata.ts

import { PrismaClient } from '@prisma/client';
import { TrialMetadataExtractor } from '../utils/trial-metadata-extractor';
import logger from '../utils/logger';

async function main() {
  const prisma = new PrismaClient();
  
  try {
    logger.info('Starting trial metadata extraction from SessionSections...');
    
    const extractor = new TrialMetadataExtractor(prisma);
    
    // Get trial ID from command line if provided
    const trialId = process.argv[2] ? parseInt(process.argv[2]) : null;
    
    if (trialId) {
      logger.info(`Updating metadata for trial ${trialId}`);
      await extractor.updateTrialMetadata(trialId);
    } else {
      logger.info('Updating all trials with Unknown Case name');
      await extractor.updateAllUnknownTrials();
    }
    
    logger.info('Metadata extraction complete');
    
    // Show updated trials
    const trials = await prisma.trial.findMany({
      select: {
        id: true,
        name: true,
        caseNumber: true,
        plaintiff: true,
        defendant: true,
        caseHandle: true
      },
      orderBy: {
        id: 'asc'
      }
    });
    
    console.log('\nUpdated Trial Information:');
    console.log('==========================');
    for (const trial of trials) {
      console.log(`\nTrial ${trial.id} (${trial.caseNumber}):`);
      console.log(`  Name: ${trial.name}`);
      if (trial.plaintiff) console.log(`  Plaintiff: ${trial.plaintiff}`);
      if (trial.defendant) console.log(`  Defendant: ${trial.defendant}`);
      if (trial.caseHandle) console.log(`  Handle: ${trial.caseHandle}`);
    }
    
  } catch (error) {
    logger.error('Error extracting metadata:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});