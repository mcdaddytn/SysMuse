#!/usr/bin/env node

import { PrismaClient, MarkerSection } from '@prisma/client';
import { TranscriptRenderer } from '../services/TranscriptRenderer';
import { Logger } from '../utils/logger';
import { program } from 'commander';

const prisma = new PrismaClient();
const logger = new Logger('RegenerateSummaries');

interface RegenerateOptions {
  trialId?: number;
  force?: boolean;
  dryRun?: boolean;
}

async function regenerateSummaries(options: RegenerateOptions) {
  try {
    logger.info('Starting auto-summary regeneration');
    
    // Build query for MarkerSections
    const whereClause: any = {
      // Only sections with actual event ranges
      startEventId: { not: null },
      endEventId: { not: null }
    };
    
    if (options.trialId) {
      whereClause.trialId = options.trialId;
    }
    
    if (!options.force) {
      // Only regenerate for sections without summaries
      whereClause.OR = [
        { text: null },
        { text: '' }
      ];
    }
    
    const sections = await prisma.markerSection.findMany({
      where: whereClause,
      orderBy: [
        { trialId: 'asc' },
        { startEventId: 'asc' }
      ]
    });
    
    logger.info(`Found ${sections.length} sections to process`);
    
    if (options.dryRun) {
      logger.info('DRY RUN - No changes will be made');
      
      // Group sections by trial for reporting
      const sectionsByTrial = sections.reduce((acc, section) => {
        if (!acc[section.trialId]) {
          acc[section.trialId] = [];
        }
        acc[section.trialId].push(section);
        return acc;
      }, {} as Record<number, MarkerSection[]>);
      
      for (const [trialId, trialSections] of Object.entries(sectionsByTrial)) {
        logger.info(`Trial ${trialId}: ${trialSections.length} sections`);
        for (const section of trialSections) {
          logger.debug(`  - ${section.markerSectionType}: ${section.name || 'Unnamed'} [${section.startEventId}-${section.endEventId}]`);
        }
      }
      
      return;
    }
    
    const renderer = new TranscriptRenderer(prisma);
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    
    for (const section of sections) {
      try {
        // Check if section already has a summary and we're not forcing
        if (!options.force && section.text && section.text.trim()) {
          logger.debug(`Skipping section ${section.id} - already has summary`);
          skippedCount++;
          continue;
        }
        
        logger.debug(`Processing section ${section.id}: ${section.markerSectionType} - ${section.name}`);
        
        const rendered = await renderer.renderAndSaveSummary(section.id);
        
        if (rendered && rendered.summary) {
          logger.debug(`Generated summary for section ${section.id}: ${rendered.summary.substring(0, 100)}...`);
          successCount++;
        } else {
          logger.warn(`No summary generated for section ${section.id}`);
          errorCount++;
        }
        
      } catch (error) {
        logger.error(`Failed to generate summary for section ${section.id}:`, error);
        errorCount++;
      }
    }
    
    logger.info(`Summary regeneration complete:`);
    logger.info(`  - Processed: ${successCount}`);
    logger.info(`  - Skipped: ${skippedCount}`);
    logger.info(`  - Errors: ${errorCount}`);
    
    // Verify final state
    const finalCount = await prisma.markerSection.count({
      where: {
        startEventId: { not: null },
        endEventId: { not: null },
        text: { not: null },
        NOT: { text: '' }
      }
    });
    
    const totalCount = await prisma.markerSection.count({
      where: {
        startEventId: { not: null },
        endEventId: { not: null }
      }
    });
    
    logger.info(`Final state: ${finalCount}/${totalCount} sections have summaries`);
    
  } catch (error) {
    logger.error('Error regenerating summaries:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// CLI setup
program
  .name('regenerate-summaries')
  .description('Regenerate auto-summaries for MarkerSections')
  .option('-t, --trial-id <id>', 'Process specific trial only', parseInt)
  .option('-f, --force', 'Force regeneration even if summary exists')
  .option('-d, --dry-run', 'Preview what would be processed without making changes')
  .action(async (options) => {
    try {
      await regenerateSummaries(options);
      process.exit(0);
    } catch (error) {
      logger.error('Fatal error:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);