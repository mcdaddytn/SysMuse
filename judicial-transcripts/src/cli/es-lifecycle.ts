#!/usr/bin/env node
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { ElasticsearchLifecycleService } from '../services/ElasticsearchLifecycleService';
import { syncTrialStatementEvents, cleanupTrialElasticsearch, indexTrialMarkerSections } from '../scripts/syncElasticsearchLifecycle';
import logger from '../utils/logger';

const prisma = new PrismaClient();
const program = new Command();

program
  .name('es-lifecycle')
  .description('Elasticsearch lifecycle management for trials')
  .version('1.0.0');

program
  .command('status')
  .description('Show Elasticsearch storage status')
  .action(async () => {
    try {
      const service = new ElasticsearchLifecycleService();
      const status = await service.getStorageStatus();
      
      console.log('\n=== Elasticsearch Storage Status ===\n');
      
      if (status.phase2Indices.length > 0) {
        console.log('Phase 2 Indices:');
        status.phase2Indices.forEach((idx: any) => {
          console.log(`  - ${idx.name}: ${idx.docs} docs, ${idx.size}`);
        });
      } else {
        console.log('No Phase 2 indices found');
      }
      
      if (status.phase3Index) {
        console.log(`\nPhase 3 Index (Permanent):`);
        console.log(`  - ${status.phase3Index.name}: ${status.phase3Index.docs} docs, ${status.phase3Index.size}`);
      }
      
      console.log('\nTrial Processing Status:');
      const activeTrials = status.trials.filter((t: any) => !t.elasticsearchCleared && t.phase2Started);
      const clearedTrials = status.trials.filter((t: any) => t.elasticsearchCleared);
      
      if (activeTrials.length > 0) {
        console.log(`  Active trials with ES data: ${activeTrials.length}`);
        activeTrials.forEach((t: any) => {
          console.log(`    - Trial ${t.id} (${t.caseNumber}): Phase 2: ${t.phase2Completed ? '✓' : 'in progress'}, Phase 3: ${t.phase3Completed ? '✓' : 'pending'}`);
        });
      }
      
      if (clearedTrials.length > 0) {
        console.log(`  Cleared trials: ${clearedTrials.length}`);
      }
      
      await service.disconnect();
    } catch (error) {
      logger.error('Failed to get status:', error);
      process.exit(1);
    }
  });

program
  .command('cleanup')
  .description('Clean up Phase 2 Elasticsearch data for a trial')
  .requiredOption('-t, --trial <id>', 'Trial ID to clean up')
  .action(async (options) => {
    try {
      const trialId = parseInt(options.trial);
      await cleanupTrialElasticsearch(trialId);
      logger.info(`Successfully cleaned up Elasticsearch data for trial ${trialId}`);
    } catch (error) {
      logger.error('Cleanup failed:', error);
      process.exit(1);
    }
  });

program
  .command('cleanup-all')
  .description('Clean up all Phase 2 Elasticsearch indices')
  .option('--confirm', 'Confirm the cleanup action')
  .action(async (options) => {
    try {
      if (!options.confirm) {
        console.log('This will delete ALL Phase 2 Elasticsearch indices.');
        console.log('Run with --confirm to proceed.');
        return;
      }
      
      const service = new ElasticsearchLifecycleService();
      await service.cleanupAllPhase2Indices();
      logger.info('Successfully cleaned up all Phase 2 indices');
      await service.disconnect();
    } catch (error) {
      logger.error('Cleanup failed:', error);
      process.exit(1);
    }
  });

program
  .command('index-phase3')
  .description('Index Phase 3 marker sections for a trial')
  .requiredOption('-t, --trial <id>', 'Trial ID')
  .action(async (options) => {
    try {
      const trialId = parseInt(options.trial);
      await indexTrialMarkerSections(trialId);
      logger.info(`Successfully indexed Phase 3 data for trial ${trialId}`);
    } catch (error) {
      logger.error('Indexing failed:', error);
      process.exit(1);
    }
  });

program
  .command('sync-phase2')
  .description('Sync Phase 2 statement events for a trial')
  .requiredOption('-t, --trial <id>', 'Trial ID')
  .action(async (options) => {
    try {
      const trialId = parseInt(options.trial);
      await syncTrialStatementEvents(trialId);
      logger.info(`Successfully synced Phase 2 data for trial ${trialId}`);
    } catch (error) {
      logger.error('Sync failed:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);

// Close database connection on exit
process.on('exit', async () => {
  await prisma.$disconnect();
});