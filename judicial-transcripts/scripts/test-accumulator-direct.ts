#!/usr/bin/env npx ts-node

import { PrismaClient } from '@prisma/client';
import { AccumulatorEngineV2 } from '../src/phase3/AccumulatorEngineV2';
import { TranscriptConfig } from '../src/types/config.types';
import { Logger } from '../src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('TestAccumulatorDirect');
const prisma = new PrismaClient();

async function main() {
  try {
    // Load configuration
    const configPath = path.join(__dirname, '../config/multi-trial-config-mac.json');
    const config: TranscriptConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    // Ensure ElasticSearch is disabled to use in-memory search
    config.enableElasticSearch = false;
    
    logger.info('=== Direct Accumulator Engine Test ===');
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
    
    // Check active accumulators
    const activeAccumulators = await prisma.accumulatorExpression.findMany({
      where: { isActive: true }
    });
    logger.info(`Active accumulators: ${activeAccumulators.length}`);
    for (const acc of activeAccumulators) {
      logger.info(`  - ${acc.name}: window=${acc.windowSize}, threshold=${acc.thresholdValue}`);
    }
    
    // Check existing results
    const existingResults = await prisma.accumulatorResult.count({
      where: { trialId }
    });
    logger.info(`Existing accumulator results: ${existingResults}`);
    
    // Create engine
    const engine = new AccumulatorEngineV2(prisma, config);
    await engine.initialize();
    
    // Process the trial
    logger.info('\nStarting accumulator evaluation with in-memory search...');
    const startTime = Date.now();
    
    await engine.evaluateTrialAccumulators(trialId);
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    logger.info(`Processing completed in ${duration.toFixed(2)} seconds`);
    
    // Check new results
    const newResultsCount = await prisma.accumulatorResult.count({
      where: { trialId }
    });
    logger.info(`Total accumulator results after processing: ${newResultsCount}`);
    logger.info(`New results generated: ${newResultsCount - existingResults}`);
    
    // Show results summary
    const results = await prisma.accumulatorResult.findMany({
      where: { trialId },
      include: {
        accumulator: true
      },
      orderBy: { floatResult: 'desc' },
      take: 20
    });
    
    // Group by accumulator
    const resultsByAccumulator = new Map<string, { total: number, matched: number, avgScore: number }>();
    const allResults = await prisma.accumulatorResult.findMany({
      where: { trialId },
      include: { accumulator: true }
    });
    
    for (const result of allResults) {
      const name = result.accumulator.name;
      const stats = resultsByAccumulator.get(name) || { total: 0, matched: 0, avgScore: 0 };
      stats.total++;
      if (result.booleanResult) stats.matched++;
      stats.avgScore = ((stats.avgScore * (stats.total - 1)) + (result.floatResult || 0)) / stats.total;
      resultsByAccumulator.set(name, stats);
    }
    
    logger.info('\n=== Results by Accumulator ===');
    for (const [name, stats] of resultsByAccumulator) {
      logger.info(`${name}:`);
      logger.info(`  Total windows: ${stats.total}`);
      logger.info(`  Matched: ${stats.matched} (${((stats.matched/stats.total)*100).toFixed(1)}%)`);
      logger.info(`  Average score: ${stats.avgScore.toFixed(3)}`);
    }
    
    // Show top matches
    logger.info('\n=== Top Scoring Matches ===');
    let shown = 0;
    for (const result of results) {
      if (result.booleanResult) {
        const score = result.floatResult || 0;
        const metadata = result.metadata as any || {};
        logger.info(`${result.accumulator.name}:`);
        logger.info(`  Score: ${score.toFixed(2)}, Confidence: ${result.confidenceLevel}`);
        if (metadata.windowSize) {
          logger.info(`  Window size: ${metadata.windowSize}`);
        }
        if (metadata.matches && Array.isArray(metadata.matches)) {
          logger.info(`  Match types: ${metadata.matches.map((m: any) => m.type).join(', ')}`);
        }
        shown++;
        if (shown >= 5) break;
      }
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
    logger.info(`Trial statements: ${statementCount}`);
    logger.info(`Processing time: ${duration.toFixed(2)} seconds`);
    logger.info(`Rate: ${(statementCount / duration).toFixed(0)} statements/second`);
    
    // Sample phrase search results
    logger.info('\n=== Sample Phrase Matches ===');
    const sampleResults = await prisma.accumulatorResult.findMany({
      where: { 
        trialId,
        booleanResult: true
      },
      include: {
        accumulator: true,
        startEvent: {
          include: {
            statement: true
          }
        }
      },
      take: 3
    });
    
    for (const result of sampleResults) {
      const metadata = result.metadata as any || {};
      if (result.startEvent?.statement?.text) {
        logger.info(`\n${result.accumulator.name} match:`);
        logger.info(`  Text snippet: "${result.startEvent.statement.text.substring(0, 100)}..."`);
        if (metadata.matches) {
          logger.info(`  Matched: ${JSON.stringify(metadata.matches)}`);
        }
      }
    }
    
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);