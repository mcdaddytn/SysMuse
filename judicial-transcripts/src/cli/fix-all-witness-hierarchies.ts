#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();
const logger = new Logger('FixAllWitnessHierarchies');

async function fixAllTrials() {
  try {
    // Get all trials
    const trials = await prisma.trial.findMany({
      select: { id: true, name: true }
    });
    
    logger.info(`Found ${trials.length} trials to process`);
    
    for (const trial of trials) {
      logger.info(`Processing trial ${trial.id}: ${trial.name}`);
      await fixWitnessHierarchy(trial.id);
    }
    
    logger.info('All trials processed successfully');
  } catch (error) {
    logger.error('Error processing trials:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function fixWitnessHierarchy(trialId: number) {
  try {
    // Get all witness testimony sections (individual witnesses)
    const witnessTestimonies = await prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: 'WITNESS_TESTIMONY',
        // Only get the individual witness testimonies (e.g., WitnessTestimony_WITNESS_1)
        name: {
          startsWith: 'WitnessTestimony_WITNESS_'
        }
      },
      orderBy: { startEventId: 'asc' }
    });
    
    // Get all witness examination sections
    const examinations = await prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: 'WITNESS_EXAMINATION'
      },
      orderBy: { startEventId: 'asc' }
    });
    
    let fixedExamCount = 0;
    
    // For each examination, find its parent testimony section
    for (const exam of examinations) {
      // Find the testimony section that contains this examination
      const parentTestimony = witnessTestimonies.find(testimony => {
        return (
          exam.startEventId !== null &&
          exam.endEventId !== null &&
          testimony.startEventId !== null &&
          testimony.endEventId !== null &&
          exam.startEventId >= testimony.startEventId &&
          exam.endEventId <= testimony.endEventId
        );
      });
      
      if (parentTestimony && exam.parentSectionId !== parentTestimony.id) {
        // Update the examination to have the correct parent
        await prisma.markerSection.update({
          where: { id: exam.id },
          data: { parentSectionId: parentTestimony.id }
        });
        fixedExamCount++;
      }
    }
    
    // Now fix the witness testimony sections to be children of the appropriate parent sections
    // First, get the WITNESS_TESTIMONY_PLAINTIFF and WITNESS_TESTIMONY_DEFENSE sections
    const plaintiffTestimonyPeriod = await prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: 'WITNESS_TESTIMONY_PLAINTIFF'
      }
    });
    
    const defenseTestimonyPeriod = await prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: 'WITNESS_TESTIMONY_DEFENSE'
      }
    });
    
    let fixedTestimonyCount = 0;
    
    // Now assign each witness testimony to the correct parent
    for (const testimony of witnessTestimonies) {
      let parentId: number | null = null;
      
      if (plaintiffTestimonyPeriod && testimony.startEventId && plaintiffTestimonyPeriod.startEventId && plaintiffTestimonyPeriod.endEventId) {
        if (testimony.startEventId >= plaintiffTestimonyPeriod.startEventId && 
            testimony.startEventId <= plaintiffTestimonyPeriod.endEventId) {
          parentId = plaintiffTestimonyPeriod.id;
        }
      }
      
      if (!parentId && defenseTestimonyPeriod && testimony.startEventId && defenseTestimonyPeriod.startEventId && defenseTestimonyPeriod.endEventId) {
        if (testimony.startEventId >= defenseTestimonyPeriod.startEventId && 
            testimony.startEventId <= defenseTestimonyPeriod.endEventId) {
          parentId = defenseTestimonyPeriod.id;
        }
      }
      
      if (parentId && testimony.parentSectionId !== parentId) {
        await prisma.markerSection.update({
          where: { id: testimony.id },
          data: { parentSectionId: parentId }
        });
        fixedTestimonyCount++;
      }
    }
    
    // Also fix COMPLETE_WITNESS_TESTIMONY to be a child of WITNESS_TESTIMONY_PERIOD
    const completeTestimony = await prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: 'COMPLETE_WITNESS_TESTIMONY'
      }
    });
    
    const testimonyPeriod = await prisma.markerSection.findFirst({
      where: {
        trialId,
        markerSectionType: 'WITNESS_TESTIMONY_PERIOD'
      }
    });
    
    let fixedComplete = false;
    if (completeTestimony && testimonyPeriod && completeTestimony.parentSectionId !== testimonyPeriod.id) {
      await prisma.markerSection.update({
        where: { id: completeTestimony.id },
        data: { parentSectionId: testimonyPeriod.id }
      });
      fixedComplete = true;
    }
    
    if (fixedExamCount > 0 || fixedTestimonyCount > 0 || fixedComplete) {
      logger.info(`  Trial ${trialId}: Fixed ${fixedExamCount} examinations, ${fixedTestimonyCount} testimonies${fixedComplete ? ', 1 complete testimony' : ''}`);
    } else {
      logger.debug(`  Trial ${trialId}: No changes needed`);
    }
    
  } catch (error) {
    logger.error(`Error fixing trial ${trialId}:`, error);
    // Continue with other trials
  }
}

// Run for all trials
fixAllTrials()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });