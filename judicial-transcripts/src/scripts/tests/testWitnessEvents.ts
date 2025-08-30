// Test script to verify witness event parsing for Feature 02D
import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger';

const prisma = new PrismaClient();

async function testWitnessEvents() {
  try {
    // Get the trial
    const trial = await prisma.trial.findFirst({
      where: { caseNumber: 'CV-15-04441' }
    });
    
    if (!trial) {
      logger.error('Trial not found. Please run phase 1 parsing first.');
      return;
    }
    
    logger.info(`Testing witness events for trial: ${trial.name}`);
    
    // Count witness called events
    const witnessEvents = await prisma.witnessCalledEvent.findMany({
      include: {
        event: true,
        witness: true
      },
      orderBy: {
        event: {
          startLineNumber: 'asc'
        }
      }
    });
    
    logger.info(`\nFound ${witnessEvents.length} witness called events`);
    logger.info('Expected: 48 events according to Feature 02D spec\n');
    
    // Group by examination type
    const byType: Record<string, number> = {};
    for (const we of witnessEvents) {
      byType[we.examinationType] = (byType[we.examinationType] || 0) + 1;
    }
    
    logger.info('Events by examination type:');
    for (const [type, count] of Object.entries(byType)) {
      logger.info(`  ${type}: ${count}`);
    }
    
    // List all witness events with details
    logger.info('\nDetailed witness events:');
    for (const we of witnessEvents) {
      const witness = we.witness;
      logger.info(`Line ${we.event.startLineNumber}: ${witness?.name || 'Unknown'} - ${we.examinationType} (${we.swornStatus}) ${we.continued ? '[CONTINUED]' : ''} ${we.presentedByVideo ? '[VIDEO]' : ''}`);
    }
    
    // Check for lines containing EXAMINATION or DEPOSITION
    const examLines = await prisma.line.findMany({
      where: {
        OR: [
          { text: { contains: 'EXAMINATION' } },
          { text: { contains: 'DEPOSITION' } }
        ]
      },
      orderBy: {
        lineNumber: 'asc'
      }
    });
    
    logger.info(`\nFound ${examLines.length} lines containing EXAMINATION or DEPOSITION`);
    logger.info('Expected: 46 EXAMINATION + 12 DEPOSITION = 58 total according to Feature 02D\n');
    
    // Show lines that might be missing witness events
    logger.info('Lines with EXAMINATION/DEPOSITION text:');
    for (const line of examLines.slice(0, 20)) {  // Show first 20
      const hasEvent = witnessEvents.some(we => 
        we.event.startLineNumber === line.lineNumber ||
        we.event.endLineNumber === line.lineNumber ||
        (we.event.startLineNumber! <= line.lineNumber && we.event.endLineNumber! >= line.lineNumber)
      );
      
      logger.info(`Line ${line.lineNumber}: ${line.text?.substring(0, 60)}... ${hasEvent ? '[✓ HAS EVENT]' : '[✗ MISSING EVENT]'}`);
    }
    
    // Summary
    const missingCount = 48 - witnessEvents.length;
    if (missingCount > 0) {
      logger.warn(`\n⚠️  Missing ${missingCount} witness events`);
      logger.info('Please review the implementation to ensure all examination types are being detected.');
    } else if (missingCount < 0) {
      logger.warn(`\n⚠️  Found ${-missingCount} extra witness events (more than expected)`);
    } else {
      logger.info('\n✅ All expected witness events found!');
    }
    
  } catch (error) {
    logger.error('Error testing witness events:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testWitnessEvents();