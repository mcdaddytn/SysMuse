#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { generateCaseHandle } from '../utils/fileTokenGenerator';
import logger from '../utils/logger';

const prisma = new PrismaClient();

async function updateCaseHandles() {
  try {
    logger.info('Starting to update case handles for all trials...');
    
    // Fetch all trials
    const trials = await prisma.trial.findMany({
      select: {
        id: true,
        name: true,
        caseNumber: true,
        caseHandle: true
      },
      orderBy: { id: 'asc' }
    });
    
    logger.info(`Found ${trials.length} trials to process`);
    
    // Update each trial with generated caseHandle
    for (const trial of trials) {
      const newCaseHandle = generateCaseHandle(trial.caseNumber);
      
      if (trial.caseHandle !== newCaseHandle) {
        await prisma.trial.update({
          where: { id: trial.id },
          data: { caseHandle: newCaseHandle }
        });
        
        logger.info(`Updated trial ${trial.id}: ${trial.caseNumber} -> ${newCaseHandle}`);
      } else {
        logger.info(`Trial ${trial.id} already has correct caseHandle: ${newCaseHandle}`);
      }
    }
    
    logger.info('Successfully updated all case handles');
    
    // Display summary
    const updatedTrials = await prisma.trial.findMany({
      select: {
        id: true,
        name: true,
        caseNumber: true,
        caseHandle: true
      },
      orderBy: { id: 'asc' }
    });
    
    console.log('\nUpdated Trials:');
    console.log('==============');
    for (const trial of updatedTrials) {
      console.log(`ID: ${trial.id}`);
      console.log(`Name: ${trial.name}`);
      console.log(`Case Number: ${trial.caseNumber}`);
      console.log(`Case Handle: ${trial.caseHandle}`);
      console.log('---');
    }
    
  } catch (error) {
    logger.error('Error updating case handles:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  updateCaseHandles();
}