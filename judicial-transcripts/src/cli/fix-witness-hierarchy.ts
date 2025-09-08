#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();
const logger = new Logger('FixWitnessHierarchy');

async function fixWitnessHierarchy(trialId: number) {
  try {
    logger.info(`Fixing witness hierarchy for trial ${trialId}`);
    
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
    
    logger.info(`Found ${witnessTestimonies.length} individual witness testimony sections`);
    
    // Get all witness examination sections
    const examinations = await prisma.markerSection.findMany({
      where: {
        trialId,
        markerSectionType: 'WITNESS_EXAMINATION'
      },
      orderBy: { startEventId: 'asc' }
    });
    
    logger.info(`Found ${examinations.length} witness examination sections`);
    
    let fixedCount = 0;
    
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
      
      if (parentTestimony) {
        // Update the examination to have the correct parent
        await prisma.markerSection.update({
          where: { id: exam.id },
          data: { parentSectionId: parentTestimony.id }
        });
        
        logger.debug(`Set parent of ${exam.name} to ${parentTestimony.name}`);
        fixedCount++;
      } else {
        logger.warn(`Could not find parent testimony for ${exam.name} [${exam.startEventId}-${exam.endEventId}]`);
      }
    }
    
    logger.info(`Fixed ${fixedCount} witness examination parent relationships`);
    
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
    
    // Now assign each witness testimony to the correct parent
    for (const testimony of witnessTestimonies) {
      let parentId: number | null = null;
      
      if (plaintiffTestimonyPeriod && testimony.startEventId && plaintiffTestimonyPeriod.startEventId && plaintiffTestimonyPeriod.endEventId) {
        if (testimony.startEventId >= plaintiffTestimonyPeriod.startEventId && 
            testimony.startEventId <= plaintiffTestimonyPeriod.endEventId) {
          parentId = plaintiffTestimonyPeriod.id;
          logger.debug(`Setting ${testimony.name} as child of plaintiff testimony period`);
        }
      }
      
      if (!parentId && defenseTestimonyPeriod && testimony.startEventId && defenseTestimonyPeriod.startEventId && defenseTestimonyPeriod.endEventId) {
        if (testimony.startEventId >= defenseTestimonyPeriod.startEventId && 
            testimony.startEventId <= defenseTestimonyPeriod.endEventId) {
          parentId = defenseTestimonyPeriod.id;
          logger.debug(`Setting ${testimony.name} as child of defense testimony period`);
        }
      }
      
      if (parentId && testimony.parentSectionId !== parentId) {
        await prisma.markerSection.update({
          where: { id: testimony.id },
          data: { parentSectionId: parentId }
        });
        logger.debug(`Updated parent of ${testimony.name}`);
      }
    }
    
    logger.info('Witness hierarchy fixed successfully');
    
  } catch (error) {
    logger.error('Error fixing witness hierarchy:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run for trial 1
fixWitnessHierarchy(1)
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });