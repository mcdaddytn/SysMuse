// Test script to verify examination pattern matching
import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger';

const prisma = new PrismaClient();

async function testPatterns() {
  try {
    // Test examination patterns
    const examPatterns = [
      /^\s*DIRECT\s+EXAMINATION\s*$/,
      /^\s*CROSS-EXAMINATION\s*$/,
      /^\s*CROSS\s+EXAMINATION\s*$/,
      /^\s*REDIRECT\s+EXAMINATION\s*$/,
      /^\s*RECROSS-EXAMINATION\s*$/,
      /^\s*RECROSS\s+EXAMINATION\s*$/,
      /^\s*DIRECT\s+EXAMINATION\s+CONTINUED\s*$/,
      /^\s*CROSS-EXAMINATION\s+CONTINUED\s*$/,
      /^\s*CROSS\s+EXAMINATION\s+CONTINUED\s*$/,
      /^\s*REDIRECT\s+EXAMINATION\s+CONTINUED\s*$/,
      /^\s*RECROSS-EXAMINATION\s+CONTINUED\s*$/,
      /^\s*RECROSS\s+EXAMINATION\s+CONTINUED\s*$/
    ];
    
    // Get all lines containing EXAMINATION
    const examLines = await prisma.line.findMany({
      where: {
        text: { contains: 'EXAMINATION' }
      },
      orderBy: {
        lineNumber: 'asc'
      }
    });
    
    logger.info(`Found ${examLines.length} lines containing EXAMINATION`);
    
    let matchedCount = 0;
    const unmatched: string[] = [];
    
    for (const line of examLines) {
      const text = line.text?.trim() || '';
      let matched = false;
      
      for (const pattern of examPatterns) {
        if (pattern.test(text)) {
          matched = true;
          matchedCount++;
          logger.info(`✓ Matched: ${text}`);
          break;
        }
      }
      
      if (!matched) {
        unmatched.push(text);
      }
    }
    
    logger.info(`\nMatched ${matchedCount} out of ${examLines.length} examination lines`);
    
    if (unmatched.length > 0) {
      logger.warn('\nUnmatched lines:');
      for (const text of unmatched) {
        logger.warn(`  ✗ ${text}`);
      }
    }
    
    // Test video deposition patterns
    const videoPatterns = [
      /^\s*PRESENTED\s+BY\s+VIDEO\s+DEPOSITION\s*$/,
      /^\s*VIDEO\s+DEPOSITION\s*$/
    ];
    
    const videoLines = await prisma.line.findMany({
      where: {
        text: { contains: 'DEPOSITION' }
      }
    });
    
    logger.info(`\nFound ${videoLines.length} lines containing DEPOSITION`);
    
    let videoMatched = 0;
    for (const line of videoLines) {
      const text = line.text?.trim() || '';
      for (const pattern of videoPatterns) {
        if (pattern.test(text)) {
          videoMatched++;
          logger.info(`✓ Matched video: ${text}`);
          break;
        }
      }
    }
    
    logger.info(`Matched ${videoMatched} out of ${videoLines.length} deposition lines`);
    
  } catch (error) {
    logger.error('Error testing patterns:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPatterns();