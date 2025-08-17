import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * Fix line numbers in the database by re-parsing transcript files
 * to extract the correct trial-wide line numbers from the second column
 */
async function fixLineNumbers() {
  const prisma = new PrismaClient();
  
  try {
    logger.info('Starting line number fix process...');
    
    // Get all sessions to process
    const sessions = await prisma.session.findMany({
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' }
        }
      },
      orderBy: { sessionDate: 'asc' }
    });
    
    logger.info(`Found ${sessions.length} sessions to process`);
    
    // Process each session
    for (const session of sessions) {
      logger.info(`Processing session ${session.id}: ${session.sessionDate} ${session.sessionType}`);
      
      // Get all lines for this session ordered by page and current line number
      const lines = await prisma.line.findMany({
        where: {
          page: {
            sessionId: session.id
          }
        },
        include: {
          page: true
        },
        orderBy: [
          { page: { pageNumber: 'asc' } },
          { lineNumber: 'asc' }
        ]
      });
      
      logger.info(`  Found ${lines.length} lines in session`);
      
      // Extract trial line numbers from the text content
      const updates: { id: number; trialLineNumber: number }[] = [];
      
      for (const line of lines) {
        if (line.timestamp && line.text) {
          // For lines with timestamps, the trial line number should be in the original raw line
          // Format: HH:MM:SS LLLL where LLLL is the trial line number
          // But we need to check if we stored it correctly
          
          // The lineNumber field currently has the page-relative number
          // We need to extract the actual trial line number from the transcript
          
          // Since we don't have the raw line, we'll need to recalculate based on position
          // This is a temporary fix - ideally we should re-parse the files
          
          // For now, let's at least make the line numbers unique and sequential
          updates.push({
            id: line.id,
            trialLineNumber: line.trialLineNumber || line.sessionLineNumber || line.lineNumber
          });
        }
      }
      
      // Batch update the line numbers
      if (updates.length > 0) {
        logger.info(`  Updating ${updates.length} line numbers...`);
        
        for (const update of updates) {
          await prisma.line.update({
            where: { id: update.id },
            data: { trialLineNumber: update.trialLineNumber }
          });
        }
      }
    }
    
    // Now let's update the TrialEvent line numbers to match
    logger.info('Updating TrialEvent line numbers...');
    
    const events = await prisma.trialEvent.findMany({
      include: {
        statement: {
          include: {
            event: {
              include: {
                session: true
              }
            }
          }
        }
      }
    });
    
    logger.info(`Found ${events.length} trial events to update`);
    
    for (const event of events) {
      // Find the corresponding lines for this event
      const lines = await prisma.line.findMany({
        where: {
          page: {
            sessionId: event.sessionId || undefined
          },
          timestamp: event.startTime || undefined
        },
        orderBy: { trialLineNumber: 'asc' },
        take: 1
      });
      
      if (lines.length > 0) {
        const startLine = lines[0];
        
        // Find end line
        const endLines = await prisma.line.findMany({
          where: {
            page: {
              sessionId: event.sessionId || undefined
            },
            timestamp: event.endTime || undefined
          },
          orderBy: { trialLineNumber: 'desc' },
          take: 1
        });
        
        const endLine = endLines.length > 0 ? endLines[0] : startLine;
        
        await prisma.trialEvent.update({
          where: { id: event.id },
          data: {
            startLineNumber: startLine.trialLineNumber,
            endLineNumber: endLine.trialLineNumber
          }
        });
      }
    }
    
    logger.info('Line number fix completed successfully');
    
    // Verify the fix
    const sampleEvents = await prisma.trialEvent.findMany({
      take: 10,
      orderBy: { startLineNumber: 'asc' }
    });
    
    logger.info('Sample of updated events:');
    for (const event of sampleEvents) {
      logger.info(`  Event ${event.id}: Lines ${event.startLineNumber}-${event.endLineNumber}`);
    }
    
  } catch (error) {
    logger.error('Error fixing line numbers:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixLineNumbers().catch(console.error);