#!/usr/bin/env npx ts-node

import { PrismaClient } from '@prisma/client';
import { AccumulatorEngineV2 } from '../src/phase3/AccumulatorEngineV2';
import { InMemorySearchService } from '../src/services/InMemorySearchService';
import { TranscriptConfig } from '../src/types/config.types';
import { Logger } from '../src/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const logger = new Logger('TestInMemorySearch');
const prisma = new PrismaClient();

async function testBasicSearch() {
  logger.info('Testing basic in-memory search functionality');
  
  const searchService = new InMemorySearchService({
    caseSensitive: false,
    enableCache: true
  });

  // Test data
  const testStatements = [
    { id: 1, text: 'I object to that question, Your Honor.', speakerId: 1 },
    { id: 2, text: 'Objection sustained.', speakerId: 2 },
    { id: 3, text: 'Let me rephrase the question.', speakerId: 3 },
    { id: 4, text: 'We object to this line of questioning.', speakerId: 1 },
  ];

  const searchExpression = {
    phrases: ['object', 'objection', 'sustained'],
    weights: {
      'object': 1.0,
      'objection': 1.0,
      'sustained': 1.0
    }
  };

  logger.info('Searching for phrases: ' + searchExpression.phrases.join(', '));

  for (const stmt of testStatements) {
    const results = searchService.searchStatement(stmt as any, searchExpression);
    if (results.length > 0) {
      logger.info(`  Statement ${stmt.id}: Found ${results.length} matches`);
      for (const result of results) {
        logger.info(`    - "${result.phrase}" at positions: ${result.positions.join(', ')}`);
      }
    }
  }
}

async function testAccumulatorEngine() {
  logger.info('\nTesting AccumulatorEngine with in-memory search');

  // Load config
  const configPath = path.join(__dirname, '../config/multi-trial-config-mac.json');
  if (!fs.existsSync(configPath)) {
    logger.error(`Config file not found: ${configPath}`);
    return;
  }

  const config: TranscriptConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  // Ensure ElasticSearch is disabled
  config.enableElasticSearch = false;
  logger.info(`ElasticSearch enabled: ${config.enableElasticSearch}`);

  // Create engine
  const engine = new AccumulatorEngineV2(prisma, config);
  await engine.initialize();

  // Get first trial
  const trial = await prisma.trial.findFirst();
  if (!trial) {
    logger.warn('No trials found in database');
    return;
  }

  logger.info(`Testing with trial: ${trial.name} (ID: ${trial.id})`);

  // Check for active accumulators
  const activeAccumulators = await prisma.accumulatorExpression.findMany({
    where: { isActive: true }
  });

  if (activeAccumulators.length === 0) {
    logger.warn('No active accumulators found. Loading sample accumulators...');
    await loadSampleAccumulators();
  }

  // Run evaluation
  logger.info('Starting accumulator evaluation...');
  await engine.evaluateTrialAccumulators(trial.id);
  
  // Check results
  const results = await prisma.accumulatorResult.findMany({
    where: { trialId: trial.id },
    take: 10,
    orderBy: { createdAt: 'desc' }
  });

  logger.info(`Found ${results.length} accumulator results`);
  for (const result of results) {
    logger.info(`  Result: matched=${result.booleanResult}, confidence=${result.confidenceLevel}, score=${result.floatResult}`);
  }
}

async function loadSampleAccumulators() {
  // Only activate existing accumulators, don't create new ones
  logger.info('Checking for existing accumulators to activate...');
  
  // Find inactive accumulators with simple phrase patterns
  const inactiveAccumulators = await prisma.accumulatorExpression.findMany({
    where: { isActive: false },
    take: 3
  });

  if (inactiveAccumulators.length > 0) {
    for (const acc of inactiveAccumulators) {
      await prisma.accumulatorExpression.update({
        where: { id: acc.id },
        data: { isActive: true }
      });
      logger.info(`Activated existing accumulator: ${acc.name}`);
    }
  } else {
    logger.info('All accumulators are already active or none exist');
    
    // Check if we need to load from seed file
    const totalAccumulators = await prisma.accumulatorExpression.count();
    if (totalAccumulators === 0) {
      logger.warn('No accumulators in database. Run "npm run seed" to load seed data first.');
    }
  }
}

async function main() {
  try {
    logger.info('Starting in-memory search tests\n');
    
    // Test basic search functionality
    await testBasicSearch();
    
    // Test with accumulator engine
    await testAccumulatorEngine();
    
    logger.info('\nTests completed successfully');
  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run tests
main().catch(console.error);