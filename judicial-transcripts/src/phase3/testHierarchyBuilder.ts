#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import { StandardTrialHierarchyBuilder } from './StandardTrialHierarchyBuilder';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();
const logger = new Logger('TestHierarchyBuilder');

async function main() {
  const trialId = parseInt(process.argv[2] || '1');
  
  logger.info(`Testing Standard Trial Hierarchy Builder for trial ${trialId}`);
  
  try {
    // Check if trial exists
    const trial = await prisma.trial.findUnique({
      where: { id: trialId }
    });
    
    if (!trial) {
      logger.error(`Trial ${trialId} not found`);
      return;
    }
    
    // Get counts separately
    const eventCount = await prisma.trialEvent.count({
      where: { trialId }
    });
    
    const sectionCount = await prisma.markerSection.count({
      where: { trialId }
    });
    
    logger.info(`Trial: ${trial.name}`);
    logger.info(`Events: ${eventCount}`);
    logger.info(`Existing marker sections: ${sectionCount}`);
    
    // Clear existing hierarchy sections for this trial (optional)
    if (process.argv.includes('--clean')) {
      logger.info('Cleaning existing hierarchy sections...');
      await prisma.markerSection.deleteMany({
        where: {
          trialId,
          source: {
            in: ['PHASE3_HIERARCHY', 'PHASE3_DISCOVERY', 'PHASE3_ZEROLENGTH']
          }
        }
      });
    }
    
    // Build hierarchy
    const builder = new StandardTrialHierarchyBuilder(prisma);
    await builder.buildStandardHierarchy(trialId);
    
    // Report results
    const sections = await prisma.markerSection.findMany({
      where: { trialId },
      include: {
        parentSection: true,
        childSections: true
      },
      orderBy: [
        { markerSectionType: 'asc' },
        { startEventId: 'asc' }
      ]
    });
    
    logger.info(`\nCreated ${sections.length} marker sections:`);
    
    // Group by type
    const sectionsByType = new Map<string, typeof sections>();
    for (const section of sections) {
      const type = section.markerSectionType;
      if (!sectionsByType.has(type)) {
        sectionsByType.set(type, []);
      }
      sectionsByType.get(type)!.push(section);
    }
    
    // Display hierarchy
    logger.info('\nHierarchy Structure:');
    
    // Find root sections (no parent)
    const rootSections = sections.filter(s => !s.parentSectionId);
    
    function printHierarchy(section: typeof sections[0], indent: string = '') {
      const confidence = section.confidence ? `(${(section.confidence * 100).toFixed(0)}%)` : '';
      const zeroLength = section.metadata && 
                        typeof section.metadata === 'object' && 
                        'zeroLength' in section.metadata ? ' [ZERO-LENGTH]' : '';
      
      console.log(`${indent}├─ ${section.markerSectionType}: ${section.name} ${confidence}${zeroLength}`);
      
      // Find children
      const children = sections.filter(s => s.parentSectionId === section.id);
      for (const child of children) {
        printHierarchy(child, indent + '│  ');
      }
    }
    
    for (const root of rootSections) {
      printHierarchy(root);
    }
    
    // Statistics
    logger.info('\n=== Statistics ===');
    for (const [type, typeSections] of sectionsByType) {
      const zeroLength = typeSections.filter(s => 
        s.metadata && typeof s.metadata === 'object' && 'zeroLength' in s.metadata
      ).length;
      const avgConfidence = typeSections
        .filter(s => s.confidence)
        .reduce((sum, s) => sum + (s.confidence || 0), 0) / typeSections.length || 0;
      
      logger.info(`${type}: ${typeSections.length} sections${zeroLength > 0 ? ` (${zeroLength} zero-length)` : ''}, avg confidence: ${(avgConfidence * 100).toFixed(1)}%`);
    }
    
    // Coverage
    const totalEvents = await prisma.trialEvent.count({ where: { trialId } });
    const coveredEventIds = new Set<number>();
    
    for (const section of sections) {
      if (section.startEventId && section.endEventId) {
        const events = await prisma.trialEvent.findMany({
          where: {
            trialId,
            id: {
              gte: section.startEventId,
              lte: section.endEventId
            }
          },
          select: { id: true }
        });
        events.forEach(e => coveredEventIds.add(e.id));
      }
    }
    
    const coverage = (coveredEventIds.size / totalEvents) * 100;
    logger.info(`\nEvent Coverage: ${coveredEventIds.size}/${totalEvents} (${coverage.toFixed(1)}%)`);
    
  } catch (error) {
    logger.error('Error building hierarchy:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);