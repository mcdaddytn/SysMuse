#!/usr/bin/env npx ts-node

import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { Phase3ProcessorV2 } from '../phase3/Phase3ProcessorV2';
import { TranscriptConfig } from '../types/config.types';
import { Logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('Phase3-CLI-V2');
const prisma = new PrismaClient();

const program = new Command();

program
  .name('phase3-v2')
  .description('Phase 3 processing with in-memory search support')
  .version('2.0.0');

program
  .command('process')
  .description('Process Phase 3 for trials')
  .option('-c, --config <path>', 'Path to configuration file', './config/multi-trial-config-mac.json')
  .option('-t, --trial-id <id>', 'Process specific trial by ID')
  .option('--all', 'Process all active trials')
  .option('--reprocess', 'Clear existing results and reprocess')
  .action(async (options) => {
    try {
      // Load configuration
      const configPath = path.resolve(options.config);
      if (!fs.existsSync(configPath)) {
        logger.error(`Configuration file not found: ${configPath}`);
        process.exit(1);
      }

      const config: TranscriptConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      logger.info(`Loaded configuration from: ${configPath}`);
      logger.info(`ElasticSearch enabled: ${config.enableElasticSearch}`);

      // Create processor
      const processor = new Phase3ProcessorV2(prisma, config);

      if (options.trialId) {
        // Process specific trial
        const trialId = parseInt(options.trialId);
        
        if (options.reprocess) {
          await processor.reprocessTrial(trialId);
        } else {
          await processor.process(trialId);
        }
        
        logger.info(`Completed processing trial ${trialId}`);
      } else if (options.all) {
        // Process all trials
        await processor.processAllTrials();
        logger.info('Completed processing all trials');
      } else {
        // Process first available trial
        const trial = await prisma.trial.findFirst({});
        
        if (!trial) {
          logger.error('No active trials found');
          process.exit(1);
        }
        
        logger.info(`Processing trial: ${trial.name} (ID: ${trial.id})`);
        
        if (options.reprocess) {
          await processor.reprocessTrial(trial.id);
        } else {
          await processor.process(trial.id);
        }
      }

      // Show summary
      await showProcessingSummary(options.trialId ? parseInt(options.trialId) : undefined);

    } catch (error) {
      logger.error('Processing failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('status')
  .description('Show Phase 3 processing status')
  .option('-t, --trial-id <id>', 'Show status for specific trial')
  .action(async (options) => {
    try {
      if (options.trialId) {
        const trialId = parseInt(options.trialId);
        await showTrialStatus(trialId);
      } else {
        await showAllTrialsStatus();
      }
    } catch (error) {
      logger.error('Failed to get status:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

async function showProcessingSummary(trialId?: number) {
  logger.info('\n=== Processing Summary ===');
  
  const where = trialId ? { trialId } : {};
  
  // Count accumulator results
  const accumulatorResults = await prisma.accumulatorResult.count({ where });
  logger.info(`Accumulator results: ${accumulatorResults}`);
  
  // Note: witnessMarker and activityMarker tables were removed from schema
  // These counts are now handled through marker sections with specific types
  
  // Show sample results
  if (accumulatorResults > 0) {
    const samples = await prisma.accumulatorResult.findMany({
      where,
      take: 5,
      include: {
        accumulator: true
      },
      orderBy: { floatResult: 'desc' }
    });
    
    logger.info('\nTop accumulator matches:');
    for (const sample of samples) {
      const score = sample.floatResult || 0;
      logger.info(`  - ${sample.accumulator.name}: score=${score.toFixed(2)}, confidence=${sample.confidenceLevel}`);
    }
  }
}

async function showTrialStatus(trialId: number) {
  const trial = await prisma.trial.findUnique({
    where: { id: trialId }
  });
  
  const workflowState = await prisma.trialWorkflowState.findUnique({
    where: { trialId: trialId }
  });
  
  if (!trial) {
    logger.error(`Trial ${trialId} not found`);
    return;
  }
  
  logger.info(`\nTrial: ${trial.name} (ID: ${trial.id})`);
  
  if (workflowState) {
    logger.info(`Phase 3 completed: ${workflowState.phase3CompletedAt || 'Not completed'}`);
    // Note: phase3MarkerCount and phase3SectionCount were removed from schema
    // These are now tracked through MarkerSection counts
    
    if (workflowState.lastError) {
      logger.error(`Last error: ${workflowState.lastError}`);
    }
  }
  
  await showProcessingSummary(trialId);
}

async function showAllTrialsStatus() {
  const trials = await prisma.trial.findMany({
    orderBy: { id: 'asc' }
  });
  
  // Get all workflow states
  const workflowStates = await prisma.trialWorkflowState.findMany({
    where: {
      trialId: { in: trials.map(t => t.id) }
    }
  });
  
  // Create a map for easy lookup
  const stateMap = new Map(workflowStates.map(s => [s.trialId, s]));
  
  logger.info('\n=== All Trials Status ===');
  
  for (const trial of trials) {
    const status = stateMap.get(trial.id);
    const phase3Status = status?.phase3CompletedAt ? '✓' : 
                        status?.phase3Completed ? '⏳' : 
                        status?.lastError ? '✗' : '-';
    
    logger.info(`${phase3Status} Trial ${trial.id}: ${trial.name}`);
  }
  
  // Overall summary
  const completed = workflowStates.filter(s => s.phase3CompletedAt).length;
  const inProgress = workflowStates.filter(s => s.phase3Completed && !s.phase3CompletedAt).length;
  const failed = workflowStates.filter(s => s.lastError && !s.phase3CompletedAt).length;
  
  logger.info(`\nSummary: ${completed} completed, ${inProgress} in progress, ${failed} failed`);
}

// Parse arguments
program.parse(process.argv);