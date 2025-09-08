#!/usr/bin/env node
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { StandardTrialHierarchyBuilder } from '../phase3/StandardTrialHierarchyBuilder';
import { Logger } from '../utils/logger';

const prisma = new PrismaClient();
const logger = new Logger('BuildHierarchyCLI');

const program = new Command();

program
  .name('build-hierarchy')
  .description('Build Standard Trial Hierarchy for a trial')
  .version('1.0.0');

program
  .command('build')
  .description('Build hierarchy for a specific trial')
  .requiredOption('-t, --trial <id>', 'Trial ID to process')
  .option('--clean', 'Clean existing hierarchy sections before building')
  .option('--stats', 'Show detailed statistics after building')
  .action(async (options) => {
    try {
      const trialId = parseInt(options.trial);
      
      // Verify trial exists
      const trial = await prisma.trial.findUnique({
        where: { id: trialId }
      });
      
      if (!trial) {
        logger.error(`Trial ${trialId} not found`);
        process.exit(1);
      }
      
      logger.info(`Building hierarchy for: ${trial.name}`);
      
      // Clean if requested
      if (options.clean) {
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
      
      // Show statistics if requested
      if (options.stats) {
        const sections = await prisma.markerSection.findMany({
          where: { trialId },
          include: {
            parentSection: true,
            _count: {
              select: {
                childSections: true
              }
            }
          }
        });
        
        logger.info('\n=== Hierarchy Statistics ===');
        logger.info(`Total sections: ${sections.length}`);
        
        // Group by type
        const byType = new Map<string, typeof sections>();
        sections.forEach(s => {
          const type = s.markerSectionType;
          if (!byType.has(type)) byType.set(type, []);
          byType.get(type)!.push(s);
        });
        
        logger.info('\nSections by type:');
        for (const [type, typeSections] of byType) {
          const zeroLength = typeSections.filter(s => 
            s.metadata && typeof s.metadata === 'object' && 'zeroLength' in s.metadata
          ).length;
          logger.info(`  ${type}: ${typeSections.length}${zeroLength > 0 ? ` (${zeroLength} zero-length)` : ''}`);
        }
        
        // Show hierarchy tree
        logger.info('\nHierarchy Structure:');
        const rootSections = sections.filter(s => !s.parentSectionId);
        
        function printTree(section: typeof sections[0], indent = '') {
          const confidence = section.confidence ? ` (${(section.confidence * 100).toFixed(0)}%)` : '';
          const zeroLength = section.metadata && 
                            typeof section.metadata === 'object' && 
                            'zeroLength' in section.metadata ? ' [ZERO]' : '';
          const children = section._count.childSections;
          
          console.log(`${indent}├─ ${section.markerSectionType}: ${section.name}${confidence}${zeroLength}${children > 0 ? ` (${children} children)` : ''}`);
          
          const childSections = sections.filter(s => s.parentSectionId === section.id);
          childSections.forEach((child, index) => {
            const isLast = index === childSections.length - 1;
            printTree(child, indent + (isLast ? '   ' : '│  '));
          });
        }
        
        rootSections.forEach(root => printTree(root));
        
        // Coverage calculation
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
        
        const coverage = totalEvents > 0 ? (coveredEventIds.size / totalEvents) * 100 : 0;
        logger.info(`\nEvent Coverage: ${coveredEventIds.size}/${totalEvents} (${coverage.toFixed(1)}%)`);
      }
      
      logger.info('\nHierarchy building completed successfully!');
      
    } catch (error) {
      logger.error('Error building hierarchy:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('inspect')
  .description('Inspect existing hierarchy for a trial')
  .requiredOption('-t, --trial <id>', 'Trial ID to inspect')
  .option('--type <type>', 'Filter by section type')
  .action(async (options) => {
    try {
      const trialId = parseInt(options.trial);
      
      const whereClause: any = { trialId };
      if (options.type) {
        whereClause.markerSectionType = options.type;
      }
      
      const sections = await prisma.markerSection.findMany({
        where: whereClause,
        include: {
          parentSection: true,
          childSections: true
        },
        orderBy: [
          { markerSectionType: 'asc' },
          { startEventId: 'asc' }
        ]
      });
      
      if (sections.length === 0) {
        logger.info('No sections found');
        return;
      }
      
      logger.info(`Found ${sections.length} sections:`);
      
      for (const section of sections) {
        const parent = section.parentSection ? ` (parent: ${section.parentSection.name})` : '';
        const children = section.childSections.length > 0 ? ` [${section.childSections.length} children]` : '';
        const confidence = section.confidence ? ` ${(section.confidence * 100).toFixed(0)}%` : '';
        const source = ` [${section.source}]`;
        
        logger.info(`\n${section.markerSectionType}: ${section.name}${confidence}${source}`);
        logger.info(`  ID: ${section.id}${parent}${children}`);
        if (section.description) {
          logger.info(`  Description: ${section.description}`);
        }
        if (section.startEventId && section.endEventId) {
          logger.info(`  Events: ${section.startEventId} - ${section.endEventId}`);
        }
        if (section.metadata && typeof section.metadata === 'object' && 'zeroLength' in section.metadata) {
          logger.info(`  ⚠️ Zero-length section: ${(section.metadata as any).reason}`);
        }
      }
      
    } catch (error) {
      logger.error('Error inspecting hierarchy:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);