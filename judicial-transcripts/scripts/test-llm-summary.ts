#!/usr/bin/env npx ts-node

/**
 * Test script to verify LLMSummary1 integration
 */

import { PrismaClient } from '@prisma/client';
import { SummaryService } from '../src/services/SummaryService';
import { Logger } from '../src/utils/logger';

const logger = new Logger('TestLLMSummary');
const prisma = new PrismaClient();

async function testLLMSummary() {
  try {
    logger.info('Testing LLMSummary1 integration...');

    // Initialize SummaryService
    const summaryService = new SummaryService(prisma);

    // Find a sample MarkerSection for testing
    const section = await prisma.markerSection.findFirst({
      where: {
        markerSectionType: {
          in: [
            'OPENING_STATEMENT_PLAINTIFF',
            'OPENING_STATEMENT_DEFENSE',
            'CLOSING_STATEMENT_PLAINTIFF',
            'CLOSING_STATEMENT_DEFENSE'
          ]
        }
      },
      include: {
        trial: true
      }
    });

    if (!section) {
      logger.warn('No suitable MarkerSection found for testing');
      return;
    }

    logger.info(`Testing with section: ${section.name} (ID: ${section.id})`);
    logger.info(`Trial: ${section.trial.shortName}`);
    logger.info(`Section Type: ${section.markerSectionType}`);

    // Test available summaries
    const availableSummaries = await summaryService.getAvailableSummaries(section.id);
    logger.info(`Available summaries: ${availableSummaries.join(', ')}`);

    // Test getting LLMSummary1
    logger.info('Fetching LLMSummary1...');
    const llmSummary = await summaryService.getSummary(section.id, 'llmsummary1');

    if (llmSummary.includes('[LLM Summary not available')) {
      logger.info('LLMSummary1 not available - fallback to abridged summary working correctly');
      logger.info(`First 200 chars of fallback: ${llmSummary.substring(0, 200)}...`);
    } else {
      logger.info('LLMSummary1 found!');
      logger.info(`First 200 chars: ${llmSummary.substring(0, 200)}...`);
    }

    // Test other summary types for comparison
    logger.info('\nTesting other summary types...');

    const abridged = await summaryService.getSummary(section.id, 'abridged');
    logger.info(`Abridged summary length: ${abridged.length} chars`);

    const fulltext = await summaryService.getSummary(section.id, 'fulltext');
    logger.info(`Full text summary length: ${fulltext.length} chars`);

    logger.info('\nTest completed successfully!');

  } catch (error) {
    logger.error('Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testLLMSummary();