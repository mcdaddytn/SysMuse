import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import logger from '../utils/logger';

/**
 * Fix trial line numbers by re-parsing transcript files
 * 
 * Page format:
 * Line 1: Case 2:19-cv-00123-JRG Document 336 Filed 10/09/20 Page 1 of 187 PageID #: 19357
 * Line 2: 972  (this is the starting trial line number for this page)
 * Line 3+: Transcript lines with format: HH:MM:SS  NN  TEXT
 *          where NN is the line number WITHIN this page (1-25 typically)
 *          The actual trial line number = page starting line + NN - 1
 */
async function fixTrialLineNumbers() {
  const prisma = new PrismaClient();
  const transcriptDir = path.join(process.cwd(), 'samples', 'transcripts');
  
  try {
    logger.info('Starting trial line number fix...');
    
    // Process all transcript files to build a map of content to trial line numbers
    const files = await fs.readdir(transcriptDir);
    const txtFiles = files.filter(f => f.endsWith('.txt')).sort();
    
    logger.info(`Processing ${txtFiles.length} transcript files...`);
    
    // Map: "timestamp|text" -> trial line number
    const lineNumberMap = new Map<string, number>();
    
    for (const file of txtFiles) {
      const filePath = path.join(transcriptDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      let pageStartingLineNumber = 0;
      let inPage = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for page header
        if (line.includes('Case 2:19-cv-00123-JRG Document')) {
          // Next line should be the starting trial line number for this page
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            const pageStart = parseInt(nextLine);
            if (!isNaN(pageStart) && pageStart > 0) {
              pageStartingLineNumber = pageStart;
              inPage = true;
              logger.debug(`Page starting at trial line ${pageStartingLineNumber} in ${file}`);
              i++; // Skip the page number line
              continue;
            }
          }
        }
        
        // Process transcript lines
        if (inPage && line.length > 13 && line[2] === ':' && line[5] === ':') {
          // Extract components
          const timestamp = line.substring(0, 8).trim();
          const pageLineStr = line.substring(8, 13).trim();
          const pageLineNum = parseInt(pageLineStr);
          const text = line.substring(13).trim();
          
          if (!isNaN(pageLineNum) && pageLineNum > 0 && text) {
            // Calculate actual trial line number
            // The page starts at pageStartingLineNumber
            // Line 1 on the page = pageStartingLineNumber
            // Line 2 on the page = pageStartingLineNumber + 1, etc.
            const trialLineNumber = pageStartingLineNumber + pageLineNum - 1;
            
            // Create key for mapping
            const key = `${timestamp}|${text.substring(0, 80)}`;
            lineNumberMap.set(key, trialLineNumber);
            
            if (pageLineNum <= 3 || pageLineNum % 10 === 0) {
              logger.debug(`  Page line ${pageLineNum} -> Trial line ${trialLineNumber}: ${text.substring(0, 50)}...`);
            }
          }
        }
      }
    }
    
    logger.info(`Built map with ${lineNumberMap.size} line number mappings`);
    
    // Now update the database
    // First, update Line records
    const dbLines = await prisma.line.findMany({
      where: {
        text: { not: null },
        timestamp: { not: null }
      }
    });
    
    logger.info(`Updating ${dbLines.length} Line records...`);
    
    let updatedLines = 0;
    let notFoundLines = 0;
    const updates: { id: number; trialLineNumber: number }[] = [];
    
    for (const dbLine of dbLines) {
      if (dbLine.text && dbLine.timestamp) {
        const key = `${dbLine.timestamp}|${dbLine.text.substring(0, 80)}`;
        const trialLineNumber = lineNumberMap.get(key);
        
        if (trialLineNumber) {
          updates.push({ id: dbLine.id, trialLineNumber });
          updatedLines++;
        } else {
          notFoundLines++;
        }
      }
    }
    
    // Batch update lines
    logger.info(`Applying ${updates.length} line updates...`);
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      await Promise.all(
        batch.map(update =>
          prisma.line.update({
            where: { id: update.id },
            data: { trialLineNumber: update.trialLineNumber }
          })
        )
      );
      
      if ((i + 100) % 1000 === 0) {
        logger.info(`  Updated ${i + 100} lines...`);
      }
    }
    
    logger.info(`Updated ${updatedLines} Line records, ${notFoundLines} not found`);
    
    // Now update TrialEvent records based on their associated lines
    logger.info('Updating TrialEvent line numbers...');
    
    const events = await prisma.trialEvent.findMany({
      include: {
        session: true
      }
    });
    
    logger.info(`Processing ${events.length} TrialEvent records...`);
    
    let updatedEvents = 0;
    
    for (const event of events) {
      if (event.startTime) {
        // Find the line with this timestamp
        const startLine = await prisma.line.findFirst({
          where: {
            timestamp: event.startTime,
            page: {
              sessionId: event.sessionId || undefined
            },
            trialLineNumber: { not: null }
          },
          orderBy: { trialLineNumber: 'asc' }
        });
        
        if (startLine && startLine.trialLineNumber) {
          // Find end line
          let endLineNumber = startLine.trialLineNumber;
          
          if (event.endTime && event.endTime !== event.startTime) {
            const endLine = await prisma.line.findFirst({
              where: {
                timestamp: event.endTime,
                page: {
                  sessionId: event.sessionId || undefined
                },
                trialLineNumber: { not: null }
              },
              orderBy: { trialLineNumber: 'desc' }
            });
            
            if (endLine && endLine.trialLineNumber) {
              endLineNumber = endLine.trialLineNumber;
            }
          }
          
          await prisma.trialEvent.update({
            where: { id: event.id },
            data: {
              startLineNumber: startLine.trialLineNumber,
              endLineNumber: endLineNumber
            }
          });
          
          updatedEvents++;
        }
      }
    }
    
    logger.info(`Updated ${updatedEvents} TrialEvent records`);
    
    // Verify the fix - check for proper sequence
    const sampleEvents = await prisma.statementEvent.findMany({
      take: 20,
      include: {
        event: true,
        speaker: true
      },
      where: {
        event: {
          startLineNumber: { not: null }
        }
      },
      orderBy: {
        event: { startLineNumber: 'asc' }
      }
    });
    
    logger.info('\nSample of corrected statements (should show sequential line numbers):');
    for (const stmt of sampleEvents) {
      logger.info(`  Line ${stmt.event.startLineNumber}: ${stmt.speaker?.speakerPrefix}: "${stmt.text.substring(0, 50)}..."`);
    }
    
    // Check for issues
    const duplicates = await prisma.$queryRaw`
      SELECT "startLineNumber", COUNT(*) as count
      FROM "TrialEvent"
      WHERE "startLineNumber" IS NOT NULL
      GROUP BY "startLineNumber"
      HAVING COUNT(*) > 1
      ORDER BY "startLineNumber"
      LIMIT 10
    ` as Array<{ startLineNumber: number; count: bigint }>;
    
    if (duplicates.length > 0) {
      logger.info('\nNote: Some line numbers have multiple events (this is expected for Q/A on same line):');
      for (const dup of duplicates) {
        logger.info(`  Line ${dup.startLineNumber}: ${dup.count} events`);
      }
    }
    
    logger.info('\nTrial line number fix completed successfully!');
    
  } catch (error) {
    logger.error('Error fixing trial line numbers:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixTrialLineNumbers().catch(console.error);