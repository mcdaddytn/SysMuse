import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

const prisma = new PrismaClient();

async function analyze() {
  try {
    // Get all witness events
    const events = await prisma.witnessCalledEvent.findMany({
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
    
    console.log(`Total witness events: ${events.length}`);
    console.log('Expected: 57-58\n');
    
    // Group by examination type and sworn status
    const stats: Record<string, number> = {};
    for (const e of events) {
      const key = `${e.examinationType} - ${e.swornStatus}`;
      stats[key] = (stats[key] || 0) + 1;
    }
    
    console.log('Events by type and sworn status:');
    for (const [key, count] of Object.entries(stats)) {
      console.log(`  ${key}: ${count}`);
    }
    
    // Count by examination type only
    const byType: Record<string, number> = {};
    for (const e of events) {
      byType[e.examinationType] = (byType[e.examinationType] || 0) + 1;
    }
    
    console.log('\nEvents by examination type:');
    for (const [type, count] of Object.entries(byType)) {
      console.log(`  ${type}: ${count}`);
    }
    
    // Find NOT_SWORN events that aren't VIDEO_DEPOSITION
    const wrongSworn = events.filter(e => 
      e.swornStatus === 'NOT_SWORN' && 
      e.examinationType !== 'VIDEO_DEPOSITION'
    );
    
    console.log(`\nIncorrectly NOT_SWORN (should only be for VIDEO): ${wrongSworn.length}`);
    for (const e of wrongSworn.slice(0, 10)) {
      console.log(`  Line ${e.event.startLineNumber}: ${e.witness?.name || 'Unknown'} - ${e.examinationType}`);
    }
    
    // Check for duplicate events at same line
    const lineMap: Record<number, typeof events> = {};
    for (const e of events) {
      const lineNum = e.event.startLineNumber || 0;
      if (!lineMap[lineNum]) lineMap[lineNum] = [];
      lineMap[lineNum].push(e);
    }
    
    console.log('\nChecking for duplicates at same line:');
    let duplicateCount = 0;
    for (const [lineNum, evs] of Object.entries(lineMap)) {
      if (evs.length > 1) {
        duplicateCount += evs.length - 1;
        console.log(`  Line ${lineNum} has ${evs.length} events:`);
        for (const e of evs) {
          console.log(`    - ${e.witness?.name || 'Unknown'} ${e.examinationType}`);
        }
      }
    }
    console.log(`Total duplicate events: ${duplicateCount}`);
    
  } catch (error) {
    logger.error('Error analyzing witness events:', error);
  } finally {
    await prisma.$disconnect();
  }
}

analyze();