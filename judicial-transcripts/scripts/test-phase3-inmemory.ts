#!/usr/bin/env npx ts-node

import { PrismaClient } from '@prisma/client';
import { Phase3ProcessorV2 } from '../src/phase3/Phase3ProcessorV2';
import { TranscriptConfig } from '../src/types/config.types';
import { Logger } from '../src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('TestPhase3InMemory');
const prisma = new PrismaClient();

async function main() {
  try {
    // Load configuration
    const configPath = path.join(__dirname, '../config/multi-trial-config-mac.json');
    const config: TranscriptConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Ensure ElasticSearch is disabled
    config.enableElasticSearch = false;
    
    logger.info('=== Phase 3 In-Memory Search Test ===');
    logger.info(`ElasticSearch enabled: ${config.enableElasticSearch}`);
    
    // Get a specific trial to test
    const trialId = 7; // The trial we tested earlier
    const trial = await prisma.trial.findUnique({
      where: { id: trialId }
    });
    
    if (!trial) {
      logger.error(`Trial ${trialId} not found`);
      return;
    }
    
    logger.info(`Testing with trial: ${trial.name} (ID: ${trial.id})`);
    
    // Check current state
    const existingResults = await prisma.accumulatorResult.count({
      where: { trialId }
    });
    logger.info(`Existing accumulator results for this trial: ${existingResults}`);
    
    // Clear existing results for this trial (optional)
    if (existingResults > 0) {
      logger.info('Clearing existing results for clean test...');
      await prisma.accumulatorResult.deleteMany({
        where: { trialId }
      });
    }
    
    // Create processor
    const processor = new Phase3ProcessorV2(prisma, config);
    
    // Process the trial
    logger.info('Starting Phase 3 processing with in-memory search...');
    const startTime = Date.now();
    
    await processor.process(trialId);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    logger.info(`Processing completed in ${duration.toFixed(2)} seconds`);
    
    // Check results
    const results = await prisma.accumulatorResult.findMany({
      where: { trialId },
      include: {
        accumulator: true
      },
      take: 20,
      orderBy: { floatResult: 'desc' }
    });
    
    logger.info(`\n=== Results Summary ===`);
    logger.info(`Total accumulator results generated: ${await prisma.accumulatorResult.count({ where: { trialId } })}`);
    
    // Group results by accumulator
    const resultsByAccumulator = new Map<string, number>();
    const allResults = await prisma.accumulatorResult.findMany({
      where: { trialId },
      include: { accumulator: true }
    });
    
    for (const result of allResults) {
      const name = result.accumulator.name;
      resultsByAccumulator.set(name, (resultsByAccumulator.get(name) || 0) + 1);
    }
    
    logger.info('\nResults by accumulator:');
    for (const [name, count] of resultsByAccumulator) {
      logger.info(`  ${name}: ${count} matches`);
    }
    
    // Show top matches
    logger.info('\nTop scoring matches:');
    for (const result of results.slice(0, 10)) {
      const score = result.floatResult || 0;
      logger.info(`  ${result.accumulator.name}: score=${score.toFixed(2)}, confidence=${result.confidenceLevel}, matched=${result.booleanResult}`);
    }
    
    // Performance metrics
    const statementCount = await prisma.statementEvent.count({
      where: {
        event: {
          trialId
        }
      }
    });
    
    logger.info(`\n=== Performance Metrics ===`);
    logger.info(`Statements processed: ${statementCount}`);
    logger.info(`Processing time: ${duration.toFixed(2)} seconds`);
    logger.info(`Rate: ${(statementCount / duration).toFixed(0)} statements/second`);
    
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);