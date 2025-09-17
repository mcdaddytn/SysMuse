#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { Logger } from '../src/utils/logger';
import { AccumulatorEngineV2 } from '../src/phase3/AccumulatorEngineV2';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const logger = new Logger('TestAccumulatorConstraints');
const prisma = new PrismaClient();

async function testAccumulatorConstraints() {
  logger.info('Testing accumulator constraints...');

  try {
    // Get the accumulators we modified
    const accumulators = await prisma.accumulatorExpression.findMany({
      where: {
        name: {
          in: ['judge_attorney_interaction', 'opposing_counsel_interaction']
        }
      }
    });

    logger.info(`Found ${accumulators.length} interaction accumulators:`);

    for (const acc of accumulators) {
      logger.info(`\n${acc.name}:`);
      logger.info(`  Active: ${acc.isActive}`);
      logger.info(`  Window size: ${acc.windowSize}`);

      const metadata = acc.metadata as any;
      if (metadata) {
        logger.info('  Metadata:');
        if (metadata.minDistinctSpeakers) {
          logger.info(`    Min distinct speakers: ${metadata.minDistinctSpeakers}`);
        }
        if (metadata.maxStatementWords) {
          logger.info(`    Max statement words: ${metadata.maxStatementWords}`);
        }
        if (metadata.requiredSpeakers) {
          logger.info(`    Required speakers: ${metadata.requiredSpeakers.join(', ')}`);
        }
        if (metadata.requirePlaintiffAttorney) {
          logger.info(`    Require plaintiff attorney: ${metadata.requirePlaintiffAttorney}`);
        }
        if (metadata.requireDefenseAttorney) {
          logger.info(`    Require defense attorney: ${metadata.requireDefenseAttorney}`);
        }
      }
    }

    // Test with a sample trial
    const trial = await prisma.trial.findFirst({
      where: { id: 1 }
    });

    if (trial) {
      logger.info(`\nTesting with trial: ${trial.name}`);

      // Get a sample of statements to check word counts
      const events = await prisma.trialEvent.findMany({
        where: {
          trialId: trial.id,
          eventType: 'STATEMENT'
        },
        take: 100,
        include: {
          statement: {
            include: {
              speaker: true
            }
          }
        }
      });

      const statements = events.map(e => e.statement).filter(Boolean);
      logger.info(`Checking ${statements.length} statements for word counts...`);

      let longStatements = 0;
      for (const stmt of statements) {
        if (stmt && stmt.text) {
          const wordCount = stmt.text.split(/\s+/).length;
          if (wordCount > 20) {
            longStatements++;
            logger.debug(`  Long statement (${wordCount} words) from ${stmt.speaker?.speakerHandle}: "${stmt.text.substring(0, 50)}..."`);
          }
        }
      }

      logger.info(`Found ${longStatements} statements exceeding 20 words (${(longStatements/statements.length*100).toFixed(1)}%)`);

      // Check attorney roles
      const trialAttorneys = await prisma.trialAttorney.findMany({
        where: { trialId: trial.id },
        include: {
          attorney: true,
          speaker: true
        }
      });

      const plaintiffCount = trialAttorneys.filter(ta => ta.role === 'PLAINTIFF').length;
      const defenseCount = trialAttorneys.filter(ta => ta.role === 'DEFENDANT').length;

      logger.info(`\nAttorney roles in trial:`);
      logger.info(`  Plaintiff attorneys: ${plaintiffCount}`);
      logger.info(`  Defense attorneys: ${defenseCount}`);

      for (const ta of trialAttorneys) {
        if (ta.speaker) {
          logger.debug(`    ${ta.role}: ${ta.attorney.name} (speaker: ${ta.speaker.speakerHandle})`);
        }
      }
    }

  } catch (error) {
    logger.error('Error testing accumulator constraints:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testAccumulatorConstraints().catch(console.error);