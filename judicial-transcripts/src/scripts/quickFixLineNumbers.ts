import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * Quick fix for trial line numbers - focus on just updating the TrialEvent records
 * based on a sample file to understand the pattern
 */
async function quickFixLineNumbers() {
  const prisma = new PrismaClient();
  
  try {
    logger.info('Quick fix for trial line numbers...');
    
    // First, let's check the current state
    const sampleEvents = await prisma.trialEvent.findMany({
      take: 10,
      where: {
        startLineNumber: { not: null }
      },
      orderBy: { id: 'asc' }
    });
    
    logger.info('Current line numbers (showing duplicates):');
    for (const event of sampleEvents) {
      logger.info(`  Event ${event.id}: Line ${event.startLineNumber}`);
    }
    
    // Get all events grouped by session
    const sessions = await prisma.session.findMany({
      orderBy: { sessionDate: 'asc' }
    });
    
    logger.info(`Processing ${sessions.length} sessions...`);
    
    let currentTrialLine = 1;
    
    for (const session of sessions) {
      logger.info(`\nProcessing session ${session.id} (${session.sessionDate} ${session.sessionType})`);
      
      // Get all events for this session ordered by their current line numbers
      const events = await prisma.trialEvent.findMany({
        where: { sessionId: session.id },
        orderBy: [
          { startLineNumber: 'asc' },
          { id: 'asc' }
        ]
      });
      
      logger.info(`  Found ${events.length} events`);
      
      // Assign sequential trial line numbers
      for (const event of events) {
        await prisma.trialEvent.update({
          where: { id: event.id },
          data: {
            startLineNumber: currentTrialLine,
            endLineNumber: currentTrialLine
          }
        });
        
        currentTrialLine++;
        
        if (currentTrialLine % 100 === 0) {
          logger.info(`  Assigned up to line ${currentTrialLine}`);
        }
      }
    }
    
    logger.info(`\nAssigned trial lines 1 through ${currentTrialLine - 1}`);
    
    // Verify the fix
    const fixedEvents = await prisma.statementEvent.findMany({
      take: 20,
      include: {
        event: true,
        speaker: true
      },
      where: {
        speaker: { speakerType: 'JUDGE' },
        text: { contains: 'sustained' }
      },
      orderBy: {
        event: { startLineNumber: 'asc' }
      }
    });
    
    logger.info('\nSample of fixed statements with "sustained":');
    for (const stmt of fixedEvents) {
      logger.info(`  Line ${stmt.event.startLineNumber}: ${stmt.speaker?.speakerPrefix}: "${stmt.text.substring(0, 60)}..."`);
    }
    
    // Check uniqueness
    const duplicateCheck = await prisma.$queryRaw`
      SELECT "startLineNumber", COUNT(*) as count
      FROM "TrialEvent"
      WHERE "startLineNumber" IS NOT NULL
      GROUP BY "startLineNumber"
      HAVING COUNT(*) > 1
      LIMIT 5
    ` as Array<{ startLineNumber: number; count: bigint }>;
    
    if (duplicateCheck.length === 0) {
      logger.info('\n✓ All line numbers are now unique!');
    } else {
      logger.info('\n⚠ Still have some duplicates:');
      for (const dup of duplicateCheck) {
        logger.info(`  Line ${dup.startLineNumber}: ${dup.count} events`);
      }
    }
    
  } catch (error) {
    logger.error('Error in quick fix:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the quick fix
quickFixLineNumbers().catch(console.error);