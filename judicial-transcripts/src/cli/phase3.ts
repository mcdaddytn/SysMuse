#!/usr/bin/env node
import { Command } from 'commander';
import { PrismaClient, LLMTaskStatus } from '@prisma/client';
import { Phase3Processor } from '../phase3/Phase3Processor';
import { MarkerUpsert } from '../phase3/MarkerUpsert';
import { Logger } from '../utils/logger';
import * as path from 'path';

const prisma = new PrismaClient();
const logger = new Logger('Phase3CLI');

// Helper function to update workflow state for Phase 3
async function updatePhase3WorkflowState(trialId: number): Promise<void> {
  try {
    await prisma.trialWorkflowState.upsert({
      where: { trialId },
      create: {
        trialId,
        phase3Completed: true,
        phase3CompletedAt: new Date(),
        phase3IndexCompleted: true,
        phase3IndexAt: new Date(),
        llmOverrideStatus: LLMTaskStatus.PENDING,
        llmMarkerStatus: LLMTaskStatus.PENDING
      },
      update: {
        phase3Completed: true,
        phase3CompletedAt: new Date(),
        phase3IndexCompleted: true,
        phase3IndexAt: new Date()
      }
    });
    logger.debug(`Updated workflow state for trial ${trialId}: Phase 3 completed`);
  } catch (error) {
    logger.warn(`Failed to update workflow state for trial ${trialId}: ${error}`);
  }
}

const program = new Command();

program
  .name('phase3')
  .description('Phase 3: Marker discovery and accumulator processing')
  .version('1.0.0');

program
  .command('process')
  .description('Run Phase 3 processing for marker discovery')
  .option('-t, --trial <id>', 'Process specific trial by ID')
  .option('-c, --case <number>', 'Process specific trial by case number')
  .option('--clean', 'Clean existing markers before processing')
  .option('--cleanup-after', 'Clean up Phase 2 Elasticsearch data after processing')
  .option('--no-preserve-markers', 'Skip indexing marker sections to permanent ES')
  .action(async (options) => {
    try {
      const processor = new Phase3Processor(prisma);

      // Determine which trial(s) to process
      let trialId: number | null = null;

      if (options.trial) {
        trialId = parseInt(options.trial);
      } else if (options.case) {
        const trial = await prisma.trial.findUnique({
          where: { caseNumber: options.case }
        });
        if (!trial) {
          logger.error(`Trial with case number ${options.case} not found`);
          process.exit(1);
        }
        trialId = trial.id;
      }

      // Clean if requested
      if (options.clean) {
        if (trialId) {
          await processor.cleanupTrialMarkers(trialId);
        } else {
          logger.warn('Clean option requires specific trial selection');
        }
      }

      // Process (lifecycle options temporarily disabled due to TS issue)
      if (trialId) {
        logger.info(`Processing trial ${trialId}`);
        await processor.process(trialId);
        
        // Update workflow state for Phase 3 completion
        await updatePhase3WorkflowState(trialId);
      } else {
        logger.info('Processing all trials');
        await processor.processAllTrials();
        
        // Update workflow state for all trials
        const trials = await prisma.trial.findMany();
        for (const trial of trials) {
          await updatePhase3WorkflowState(trial.id);
        }
      }

      logger.info('Phase 3 processing completed successfully');
    } catch (error) {
      logger.error(`Phase 3 processing failed: ${error}`);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('export')
  .description('Export markers to JSON file')
  .requiredOption('-t, --trial <id>', 'Trial ID')
  .option('-o, --output <path>', 'Output file path', './markers-export.json')
  .action(async (options) => {
    try {
      const upsert = new MarkerUpsert(prisma);
      const trialId = parseInt(options.trial);
      
      await upsert.exportMarkersToFile(trialId, options.output);
      logger.info(`Markers exported to ${options.output}`);
    } catch (error) {
      logger.error(`Export failed: ${error}`);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('import')
  .description('Import/upsert markers from JSON file')
  .requiredOption('-t, --trial <id>', 'Trial ID')
  .requiredOption('-i, --input <path>', 'Input file path')
  .action(async (options) => {
    try {
      const upsert = new MarkerUpsert(prisma);
      const trialId = parseInt(options.trial);
      
      await upsert.upsertMarkersFromFile(options.input, trialId);
      logger.info('Markers imported successfully');
    } catch (error) {
      logger.error(`Import failed: ${error}`);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('stats')
  .description('Show Phase 3 statistics')
  .option('-t, --trial <id>', 'Show stats for specific trial')
  .action(async (options) => {
    try {
      if (options.trial) {
        const trialId = parseInt(options.trial);
        
        const markers = await prisma.marker.count({
          where: { trialId }
        });
        
        const markerSections = await prisma.markerSection.count({
          where: { trialId }
        });
        
        const accumulatorResults = await prisma.accumulatorResult.count({
          where: { trialId }
        });
        
        const esResults = await prisma.elasticSearchResult.count({
          where: { trialId }
        });

        console.log(`\nPhase 3 Statistics for Trial ${trialId}:`);
        console.log(`  Markers: ${markers}`);
        console.log(`  Marker Sections: ${markerSections}`);
        console.log(`  Accumulator Results: ${accumulatorResults}`);
        console.log(`  ElasticSearch Results: ${esResults}`);
      } else {
        // Global stats
        const trials = await prisma.trial.count();
        const markers = await prisma.marker.count();
        const markerSections = await prisma.markerSection.count();
        const accumulatorResults = await prisma.accumulatorResult.count();
        const esResults = await prisma.elasticSearchResult.count();

        console.log('\nGlobal Phase 3 Statistics:');
        console.log(`  Trials: ${trials}`);
        console.log(`  Total Markers: ${markers}`);
        console.log(`  Total Marker Sections: ${markerSections}`);
        console.log(`  Total Accumulator Results: ${accumulatorResults}`);
        console.log(`  Total ElasticSearch Results: ${esResults}`);
      }
    } catch (error) {
      logger.error(`Failed to get statistics: ${error}`);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);