// src/parsers/TranscriptParser.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LineParser } from './LineParser';
import { Phase2Processor } from './Phase2Processor';
import { SessionSectionParser } from './SessionSectionParser';
import { AttorneyService } from '../services/AttorneyService';
import { AddressService } from '../services/AddressService';
import { 
  TranscriptConfig, 
  SessionInfo, 
  SummaryInfo,
  AttorneyInfo,
  AddressInfo,
  TrialStyleConfig
} from '../types/config.types';
import logger from '../utils/logger';

export class TranscriptParser {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private lineParser: LineParser;
  private phase2Processor: Phase2Processor;
  private sessionSectionParser: SessionSectionParser;
  private attorneyService: AttorneyService;
  private addressService: AddressService;
  private trialId?: number;
  
  // Line and page numbering - persistent across entire parsing
  private globalTrialLineNumber: number = 0;
  private globalTrialPageNumber: number = 0;  // Track total pages across all sessions
  private currentSessionId?: number;
  private sessionLineNumbers: Map<number, number> = new Map(); // sessionId -> last line number
  
  // Statistics tracking
  private directoryStats = {
    totalFiles: 0,
    totalLines: 0,
    nonBlankLines: 0,
    totalPages: 0,
    errorFiles: [] as string[],
    batchInserts: 0,
    totalBatchTime: 0
  };
  
  // Batch processing
  private lineBatch: any[] = [];
  private batchStartTime: number = 0;

  constructor(config: TranscriptConfig) {
    this.config = config;
    this.prisma = new PrismaClient();
    this.lineParser = new LineParser();
    this.phase2Processor = new Phase2Processor(config);
    this.sessionSectionParser = new SessionSectionParser(this.prisma);
    this.attorneyService = new AttorneyService(this.prisma);
    this.addressService = new AddressService(this.prisma);
  }

  /**
   * Flush pending line batch to database
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async flushLineBatch(): Promise<void> {
    if (this.lineBatch.length === 0) return;
    
    const batchStartTime = Date.now();
    
    try {
      await this.prisma.line.createMany({
        data: this.lineBatch
      });
      
      const batchTime = Date.now() - batchStartTime;
      this.directoryStats.batchInserts++;
      this.directoryStats.totalBatchTime += batchTime;
      
      logger.debug(`Inserted batch of ${this.lineBatch.length} lines in ${batchTime}ms`);
      
      this.lineBatch = [];
    } catch (error) {
      logger.error(`Failed to insert batch of ${this.lineBatch.length} lines: ${error}`);
      throw error;
    }
  }

  /**
   * Parse all transcript files in a directory
   */
  async parseDirectory(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Check for trialstyle.json in output directory
      let textFiles: string[] = [];
      const trialStylePath = path.join(this.config.outputDir, 'trialstyle.json');
      
      if (await this.fileExists(trialStylePath)) {
        // Load trialstyle.json
        const trialStyleContent = await fs.readFile(trialStylePath, 'utf-8');
        const trialStyle: TrialStyleConfig = JSON.parse(trialStyleContent);
        logger.info('Loading file order from trialstyle.json');
        
        if (trialStyle.orderedFiles && trialStyle.orderedFiles.length > 0) {
          // Use the ordered files from trialstyle.json
          textFiles = trialStyle.orderedFiles;
          logger.info(`Using ${textFiles.length} ordered files from trialstyle.json`);
          
          // If there are unidentified files, warn about them
          if (trialStyle.unidentifiedFiles && trialStyle.unidentifiedFiles.length > 0) {
            logger.warn(`${trialStyle.unidentifiedFiles.length} files in unidentifiedFiles will not be processed:`);
            trialStyle.unidentifiedFiles.forEach(f => logger.warn(`  - ${f}`));
          }
        } else {
          // No ordered files in trialstyle.json, fall back to directory listing
          logger.warn('No orderedFiles found in trialstyle.json, falling back to directory listing');
          const files = await fs.readdir(this.config.inputDir);
          textFiles = files.filter(f => f.endsWith('.txt'));
        }
      } else {
        // No trialstyle.json, use directory listing with sorting
        logger.info('No trialstyle.json found, using directory listing with auto-sorting');
        const files = await fs.readdir(this.config.inputDir);
        textFiles = files.filter(f => f.endsWith('.txt'));
      
      // Custom sort to ensure Morning comes before Afternoon for each date
      textFiles.sort((a, b) => {
        // Extract date and session type from filename
        // Files have format: "... held on 10_1_20 (Trial Transcript - Morning ..."
        const getDateAndType = (filename: string) => {
          // Extract date from "held on MM_DD_YY" pattern
          const dateMatch = filename.match(/held on (\d+)_(\d+)_(\d+)/);
          let date = '';
          if (dateMatch) {
            const month = dateMatch[1].padStart(2, '0');
            const day = dateMatch[2].padStart(2, '0');
            const year = '20' + dateMatch[3]; // Assuming 20xx
            date = `${year}-${month}-${day}`;
          }
          
          // Extract session type (Morning, Afternoon, Bench Trial, etc.)
          let sessionType = '';
          const lowerFile = filename.toLowerCase();
          if (lowerFile.includes('morning')) {
            sessionType = '1_morning';  // 1 prefix ensures it sorts first
          } else if (lowerFile.includes('afternoon')) {
            sessionType = '2_afternoon'; // 2 prefix ensures it sorts second
          } else if (lowerFile.includes('bench')) {
            sessionType = '3_bench';     // 3 prefix ensures bench trials come last
          } else if (lowerFile.includes('verdict')) {
            sessionType = '4_verdict';   // 4 prefix for verdict
          } else {
            sessionType = '5_other';     // 5 prefix for any other type
          }
          
          return { date, sessionType, filename };
        };
        
        const aInfo = getDateAndType(a);
        const bInfo = getDateAndType(b);
        
        // First sort by date
        if (aInfo.date !== bInfo.date) {
          return aInfo.date.localeCompare(bInfo.date);
        }
        
          // Then by session type (morning before afternoon before bench)
          return aInfo.sessionType.localeCompare(bInfo.sessionType);
        });
      }
      
      logger.info(`Files will be processed in order: ${textFiles.join(', ')}`);
      
      if (textFiles.length === 0) {
        logger.warn('No text files found in directory');
        return;
      }
      
      logger.info(`Found ${textFiles.length} text files to process`);
      logger.info(`Using batch size of ${this.config.batchSize} lines for bulk inserts`);
      
      // Process each file
      for (const file of textFiles) {
        try {
          await this.parseFile(path.join(this.config.inputDir, file));
          this.directoryStats.totalFiles++;
        } catch (error) {
          logger.error(`Error processing file ${file}: ${error}`);
          this.directoryStats.errorFiles.push(file);
        }
      }
      
      // Run Phase 2 processing if trial was created (unless disabled by config)
      if (this.trialId && this.config.runPhase2 !== false) {
        logger.info('\n' + '='.repeat(60));
        logger.info('Starting Phase 2 Processing');
        logger.info('='.repeat(60));
        
        await this.phase2Processor.processTrial(this.trialId);
      }
      
      const endTime = Date.now();
      const processingTime = (endTime - startTime) / 1000;
      
      this.logDirectoryStats(processingTime);
      
    } catch (error) {
      logger.error(`Directory parsing failed: ${error}`);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Parse a single transcript file
   */
  async parseFile(filePath: string): Promise<void> {
    const fileName = path.basename(filePath);
    logger.info(`Processing file: ${fileName}`);
    
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    
    let currentSection: 'SUMMARY' | 'PROCEEDINGS' | 'CERTIFICATION' | 'UNKNOWN' = 'UNKNOWN';
    let sessionInfo: SessionInfo | null = null;
    let summaryInfo: SummaryInfo | null = null;
    let currentPage: any = null;
    let pageNumber = 0;
    let pageLineNumber = 0;  // Line number within current page
    let session: any = null;
    let summaryProcessed = false;
    let summaryLines: string[] = [];
    
    // Get or initialize session line number
    let sessionLineNumber = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Skip empty lines at the document level
      if (!trimmedLine && currentSection === 'UNKNOWN') {
        continue;
      }
      
      // Parse the line first to extract text content (removes line prefix)
      let parsedLine = this.lineParser.parse(line);
      
      // Use the parsed text content for all comparisons (line prefix has been removed)
      const textContent = parsedLine?.text?.trim() || '';
      
      // Check for CERTIFICATION section - this will occur while in PROCEEDINGS section
      if (textContent === 'CERTIFICATION') {
        // Flush any pending PROCEEDINGS lines
        await this.flushLineBatch();
        
        currentSection = 'CERTIFICATION';
        logger.info(`Detected CERTIFICATION section at line ${i}`);
        
        // Create a page for CERTIFICATION section
        if (session) {
          pageNumber++;
          pageLineNumber = 0;  // Reset page line number for new page
          
          // Look backwards for the page header before CERTIFICATION
          let pageStartIndex = i;
          for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
            if (this.isPageBreak(lines[j])) {
              pageStartIndex = j;
              break;
            }
          }
          
          const certPageInfo = this.extractPageInfo(lines, pageStartIndex);
          currentPage = await this.createPage(session.id, pageNumber, 'CERTIFICATION', certPageInfo);
          logger.info(`Created CERTIFICATION page: ${currentPage.id}`);
        }
        
        // Parse and store certification section
        if (session && this.trialId) {
          await this.sessionSectionParser.parseCertificationSection(
            lines,
            i,
            session.id,
            this.trialId
          );
        }
        
        // Continue to store the CERTIFICATION lines
        // Don't continue here, let it fall through to store this line
      }
      
      // Check for exact "P R O C E E D I N G S" in the parsed text
      if (currentSection !== 'PROCEEDINGS' && textContent === 'P R O C E E D I N G S') {
          // Process summary if not already done
          if (!summaryProcessed) {
            currentSection = 'SUMMARY';
            summaryInfo = await this.parseSummarySection(lines, 0);
            
            if (summaryInfo) {
              await this.createOrUpdateTrial(summaryInfo);
            }
            
            sessionInfo = this.extractSessionInfo(lines, fileName);
            summaryProcessed = true;
            logger.info('Summary section processed (early PROCEEDINGS detection)');
            
            // Create session
            if (!session && this.trialId) {
              session = await this.createSession(sessionInfo, fileName);
              logger.info(`Created session: ${session.id} for file: ${fileName}`);
              
              // Initialize session line numbering
              this.currentSessionId = session.id;
              sessionLineNumber = this.sessionLineNumbers.get(session.id) || 0;
              
              // Create a page for SUMMARY section
              pageNumber = 1;  // Initialize page number for this session
              pageLineNumber = 0;  // Reset page line number
              const summaryPageInfo = this.extractPageInfo(lines, 0);
              const summaryPage = await this.createPage(session.id, pageNumber, 'SUMMARY', summaryPageInfo);
              logger.info(`Created SUMMARY page: ${summaryPage.id}`);
              
              // Store SUMMARY lines in Line table (lines before PROCEEDINGS)
              let currentSummaryPage = summaryPage;
              for (let j = 0; j < i; j++) {
                const summaryLine = lines[j];
                
                // Check for page break within summary
                if (j > 0 && this.isPageBreak(summaryLine)) {
                  // Found a new page within the summary
                  pageNumber++;
                  pageLineNumber = 0;  // Reset page line number for new page
                  const newPageInfo = this.extractPageInfo(lines, j);
                  currentSummaryPage = await this.createPage(session.id, pageNumber, 'SUMMARY', newPageInfo);
                  logger.info(`Created additional SUMMARY page: ${currentSummaryPage.id} (page ${pageNumber})`);
                  
                  // Skip the page header lines
                  const headerLineCount = this.getPageHeaderLineCount(lines, j);
                  j += headerLineCount - 1;  // -1 because the for loop will increment j
                  continue;
                }
                
                const parsedSummaryLine = this.lineParser.parse(summaryLine);
                
                if (parsedSummaryLine && !parsedSummaryLine.isBlank) {
                  if (parsedSummaryLine.text) {
                    pageLineNumber++;
                    sessionLineNumber++;
                    this.globalTrialLineNumber++;
                    
                    this.lineBatch.push({
                      pageId: currentSummaryPage.id,
                      lineNumber: pageLineNumber,  // Use page line number
                      trialLineNumber: this.globalTrialLineNumber,
                      sessionLineNumber,
                      linePrefix: parsedSummaryLine.linePrefix || null,
                      timestamp: null,
                      dateTime: null,
                      text: parsedSummaryLine.text || null,
                      speakerPrefix: parsedSummaryLine.speakerPrefix || null,
                      documentSection: 'SUMMARY',
                      isBlank: false
                    });
                    
                    this.directoryStats.totalLines++;
                    this.directoryStats.nonBlankLines++;
                    
                    if (this.lineBatch.length >= this.config.batchSize) {
                      await this.flushLineBatch();
                    }
                  }
                }
              }
              
              // Parse and store summary sections (use lines up to current position)
              await this.sessionSectionParser.parseSummarySections(
                lines.slice(0, i), 
                session.id, 
                this.trialId
              );
            }
          }
          
          currentSection = 'PROCEEDINGS';
          logger.info(`Detected PROCEEDINGS section at line ${i} with text: "${textContent}"`);
          
          // Session should already be created in summary processing
          if (!session) {
            logger.warn('No session found when entering PROCEEDINGS - this should not happen');
          }
          
          // Use the existing page that was created during SUMMARY processing
          // PROCEEDINGS typically starts on the same page where SUMMARY ends (usually page 3)
          if (!currentPage && session) {
            // Initialize session line numbering if not already done
            if (!this.currentSessionId || this.currentSessionId !== session.id) {
              this.currentSessionId = session.id;
              sessionLineNumber = this.sessionLineNumbers.get(session.id) || 0;
            }
            
            // Get the last page that was created (should be the page where PROCEEDINGS starts)
            currentPage = await this.prisma.page.findFirst({
              where: {
                sessionId: session.id
              },
              orderBy: {
                pageNumber: 'desc'
              }
            });
            
            if (currentPage) {
              logger.info(`Using existing page for PROCEEDINGS: ${currentPage.id} (page ${currentPage.pageNumber}, trial page ${currentPage.trialPageNumber})`);
              // Update pageNumber to match the current page
              pageNumber = currentPage.pageNumber;
              // Sync the globalTrialPageNumber with the current state
              // Since we're reusing a page, we need to ensure our counter is accurate
              if (currentPage.trialPageNumber) {
                this.globalTrialPageNumber = currentPage.trialPageNumber;
              }
              // Don't reset pageLineNumber - continue from where we left off in SUMMARY
              // Get the current line count on this page
              const existingLines = await this.prisma.line.count({
                where: {
                  pageId: currentPage.id
                }
              });
              pageLineNumber = existingLines;
            } else {
              logger.warn('No existing page found when entering PROCEEDINGS - this should not happen');
            }
          }
        }
      
      // Process summary section (first part of document)
      if (currentSection === 'UNKNOWN' && !summaryProcessed) {
        // Collect lines for summary parsing (first ~100 lines)
        if (i < 100) {
          summaryLines.push(line);
          // Mark section as SUMMARY for line storage
          currentSection = 'SUMMARY';
          continue; // Collect more lines
        } else {
          // Parse summary once we have enough lines
          currentSection = 'SUMMARY';
          summaryInfo = await this.parseSummarySection(lines, 0);
          
          if (summaryInfo) {
            await this.createOrUpdateTrial(summaryInfo);
          }
          
          sessionInfo = this.extractSessionInfo(lines, fileName);
          summaryProcessed = true;
          logger.info('Summary section processed');
          
          // Create session for this file NOW, don't wait for PROCEEDINGS
          if (!session && this.trialId) {
            session = await this.createSession(sessionInfo, fileName);
            logger.info(`Created session: ${session.id} for file: ${fileName}`);
            
            // Initialize session line numbering
            this.currentSessionId = session.id;
            sessionLineNumber = this.sessionLineNumbers.get(session.id) || 0;
            
            // Create a page for SUMMARY section
            pageNumber = 1;  // Initialize page number
            pageLineNumber = 0;  // Reset page line number
            const summaryPageInfo = this.extractPageInfo(lines, 0);
            currentPage = await this.createPage(session.id, pageNumber, 'SUMMARY', summaryPageInfo);
            logger.info(`Created SUMMARY page: ${currentPage.id}`);
            
            // Store SUMMARY lines in Line table
            let currentSummaryPage2 = currentPage;
            for (let j = 0; j < summaryLines.length; j++) {
              const summaryLine = summaryLines[j];
              
              // Check for page break within summary
              if (j > 0 && this.isPageBreak(summaryLine)) {
                // Found a new page within the summary
                pageNumber++;
                pageLineNumber = 0;  // Reset page line number for new page
                const newPageInfo = this.extractPageInfo(summaryLines, j);
                currentSummaryPage2 = await this.createPage(session.id, pageNumber, 'SUMMARY', newPageInfo);
                logger.info(`Created additional SUMMARY page: ${currentSummaryPage2.id} (page ${pageNumber})`);
                
                // Skip the page header lines
                const headerLineCount = this.getPageHeaderLineCount(summaryLines, j);
                j += headerLineCount - 1;  // -1 because the for loop will increment j
                continue;
              }
              
              const parsedSummaryLine = this.lineParser.parse(summaryLine);
              
              if (parsedSummaryLine && !parsedSummaryLine.isBlank) {
                if (parsedSummaryLine.text) {
                  pageLineNumber++;
                  sessionLineNumber++;
                  this.globalTrialLineNumber++;
                  
                  this.lineBatch.push({
                    pageId: currentSummaryPage2.id,
                    lineNumber: pageLineNumber,  // Use page line number
                    trialLineNumber: this.globalTrialLineNumber,
                    sessionLineNumber,
                    linePrefix: parsedSummaryLine.linePrefix || null,
                    timestamp: null, // No timestamps in SUMMARY
                    dateTime: null,
                    text: parsedSummaryLine.text || null,
                    speakerPrefix: parsedSummaryLine.speakerPrefix || null,
                    documentSection: 'SUMMARY',
                    isBlank: false
                  });
                  
                  this.directoryStats.totalLines++;
                  this.directoryStats.nonBlankLines++;
                  
                  if (this.lineBatch.length >= this.config.batchSize) {
                    await this.flushLineBatch();
                  }
                }
              }
            }
            
            // Parse and store summary sections
            await this.sessionSectionParser.parseSummarySections(
              summaryLines, 
              session.id, 
              this.trialId
            );
          }
          
          // Reset for PROCEEDINGS
          currentPage = null;
          pageNumber = 0;
          currentSection = 'SUMMARY'; // Keep as SUMMARY until we hit PROCEEDINGS
          
          // Continue processing from where we are
          continue;
        }
      }
      
      // Process PROCEEDINGS or CERTIFICATION sections
      if ((currentSection === 'PROCEEDINGS' || currentSection === 'CERTIFICATION') && this.trialId) {
        // Ensure we have a session
        if (!session) {
          if (!sessionInfo) {
            sessionInfo = this.extractSessionInfo(lines, fileName);
          }
          session = await this.createSession(sessionInfo, fileName);
          logger.info(`Created session: ${session.id}`);
          
          // Initialize session line numbering
          this.currentSessionId = session.id;
          sessionLineNumber = this.sessionLineNumbers.get(session.id) || 0;
        }
        
        // Check for page break
        if (this.isPageBreak(line)) {
          // Check if next page is CERTIFICATION
          let isNextPageCertification = false;
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            // Parse the line to get text without line prefix
            const checkParsed = this.lineParser.parse(lines[j]);
            const checkText = checkParsed?.text?.trim() || '';
            
            if (checkText === 'CERTIFICATION') {
              isNextPageCertification = true;
              break;
            }
            // If we hit proceedings content (timestamp), it's not certification
            if (checkParsed?.timestamp) {
              break;
            }
          }
          
          // If next page is CERTIFICATION, prepare for certification
          if (isNextPageCertification) {
            // Continue to next iteration, CERTIFICATION will be detected
            continue;
          }
          
          // Flush batch before page transition
          await this.flushLineBatch();
          
          // Save current page and create new PROCEEDINGS page
          if (currentPage) {
            logger.debug(`Page ${pageNumber} completed with ${pageLineNumber} lines`);
          }
          
          pageNumber++;
          pageLineNumber = 0;  // Reset page line number for new page
          const pageInfo = this.extractPageInfo(lines, i);
          currentPage = await this.createPage(
            session.id,
            pageNumber,
            'PROCEEDINGS',
            pageInfo
          );
          
          // Skip page header lines
          i += this.getPageHeaderLineCount(lines, i);
          continue;
        }
        
        // Ensure we have a page (but don't create if in CERTIFICATION)
        if (!currentPage && currentSection === 'PROCEEDINGS') {
          pageNumber++;
          pageLineNumber = 0;  // Reset page line number for new page
          // Look backwards to find the most recent page header
          let pageStartIndex = i;
          for (let j = i; j >= Math.max(0, i - 20); j--) {
            if (this.isPageBreak(lines[j])) {
              pageStartIndex = j;
              break;
            }
          }
          const pageInfo = this.extractPageInfo(lines, pageStartIndex);
          currentPage = await this.createPage(session.id, pageNumber, 'PROCEEDINGS', pageInfo);
          logger.info(`Created page ${pageNumber} (trial page ${pageInfo.trialPageNumber})`);
        }
        
        // Use the already parsed line if available, otherwise parse it
        if (!parsedLine) {
          parsedLine = this.lineParser.parse(line);
        }
        if (parsedLine && !parsedLine.isBlank) {  // Only store non-blank lines
          // Only increment line numbers for non-blank lines with content
          if (parsedLine.text || parsedLine.timestamp) {
            pageLineNumber++;
            sessionLineNumber++;
            this.globalTrialLineNumber++;
            
            // Calculate dateTime if we have timestamp and session date
            let dateTime: Date | null = null;
            if (parsedLine.timestamp && session?.sessionDate) {
              // Combine session date with timestamp
              const sessionDate = new Date(session.sessionDate);
              const [hours, minutes, seconds] = parsedLine.timestamp.split(':').map(n => parseInt(n));
              dateTime = new Date(sessionDate);
              dateTime.setHours(hours, minutes, seconds, 0);
            }
            
            // Extract speaker ONLY in PROCEEDINGS section
            let speakerPrefix: string | null = null;
            let textToStore = parsedLine.text || null;
            if (currentSection === 'PROCEEDINGS' && parsedLine.text) {
              const speakerResult = this.extractSpeakerFromText(parsedLine.text);
              if (speakerResult.speakerPrefix) {
                speakerPrefix = speakerResult.speakerPrefix;
                textToStore = speakerResult.text || null;
              }
            }
            
            // Add to batch instead of immediate insert
            this.lineBatch.push({
              pageId: currentPage.id,
              lineNumber: pageLineNumber,  // Use page line number
              trialLineNumber: this.globalTrialLineNumber,
              sessionLineNumber,
              linePrefix: parsedLine.linePrefix || null,
              timestamp: parsedLine.timestamp || null,
              dateTime: dateTime,
              text: textToStore,
              speakerPrefix: speakerPrefix,
              documentSection: currentSection as any,  // Use actual current section
              isBlank: false  // Always false since we're skipping blanks
            });
            
            this.directoryStats.totalLines++;
            this.directoryStats.nonBlankLines++;
            
            // Flush batch when it reaches the configured size
            if (this.lineBatch.length >= this.config.batchSize) {
              await this.flushLineBatch();
            }
            
            // Log progress every 100 lines
            if (sessionLineNumber % 100 === 0) {
              logger.debug(`Processed ${sessionLineNumber} lines in session`);
            }
          }
        } else if (parsedLine && parsedLine.isBlank) {
          // Count blank lines but don't store them
          this.directoryStats.totalLines++;
        }
      }
    }
    
    // Flush any remaining lines in the batch
    await this.flushLineBatch();
    
    // Save the session line number for potential continuation
    if (session) {
      this.sessionLineNumbers.set(session.id, sessionLineNumber);
    }
    
    logger.info(`File processing completed: ${fileName}`);
    logger.info(`  Session lines in this file: ${sessionLineNumber - (this.sessionLineNumbers.get(session?.id || 0) || 0)}`);
    logger.info(`  Total session lines so far: ${sessionLineNumber}`);
    logger.info(`  Total trial lines so far: ${this.globalTrialLineNumber}`);
    logger.info(`  Pages created: ${pageNumber}`);
    
    // Count EXAMINATION and DEPOSITION strings for debugging
    if (session) {
      const examLines = await this.prisma.line.count({
        where: {
          pageId: {
            in: await this.prisma.page.findMany({
              where: { sessionId: session.id },
              select: { id: true }
            }).then(pages => pages.map(p => p.id))
          },
          text: { contains: 'EXAMINATION' }
        }
      });
      
      const depLines = await this.prisma.line.count({
        where: {
          pageId: {
            in: await this.prisma.page.findMany({
              where: { sessionId: session.id },
              select: { id: true }
            }).then(pages => pages.map(p => p.id))
          },
          text: { contains: 'DEPOSITION' }
        }
      });
      
      logger.info(`  EXAMINATION occurrences in this session: ${examLines}`);
      logger.info(`  DEPOSITION occurrences in this session: ${depLines}`);
      logger.info(`  Total EXAMINATION/DEPOSITION lines: ${examLines + depLines}`);
    }
    
    // Save the session line number for potential continuation
    if (session) {
      this.sessionLineNumbers.set(session.id, sessionLineNumber);
    }
  }

  /**
   * Parse summary section to extract trial and participant information
   */
  private async parseSummarySection(lines: string[], startIndex: number): Promise<SummaryInfo | null> {
    const summaryLines = lines.slice(startIndex, Math.min(startIndex + 100, lines.length));
    
    // Extract case information
    const caseInfo = this.extractCaseInfo(summaryLines);
    if (!caseInfo) return null;
    
    // Extract judge
    const judge = this.extractJudge(summaryLines);
    
    // Extract court reporter
    const courtReporter = this.extractCourtReporter(summaryLines);
    
    // Extract attorneys
    const { plaintiffAttorneys, defendantAttorneys } = this.extractAttorneys(summaryLines);
    
    return {
      caseInfo,
      judge,
      courtReporter,
      plaintiffAttorneys,
      defendantAttorneys
    };
  }

  /**
   * Extract case information from summary
   */
  private extractCaseInfo(lines: string[]): any {
    let caseNumber = '';
    let caseName = '';
    let court = '';
    let courtDivision = '';
    let courtDistrict = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Parse case number using direct string parsing
      // Method 1: From page header "Case 2:19-cv-00123-JRG Document 328..."
      if (!caseNumber && line.includes('Case ') && line.includes(' Document')) {
        const caseStart = line.indexOf('Case ') + 5;
        const docStart = line.indexOf(' Document');
        if (caseStart > 4 && docStart > caseStart) {
          const extracted = line.substring(caseStart, docStart).trim();
          if (extracted.length > 0) {
            caseNumber = extracted.toUpperCase();
            logger.info(`Extracted case number from header: ${caseNumber}`);
          }
        }
      }
      
      // Method 2: Look for standalone case number after "CIVIL ACTION NO."
      // This appears as "2:19-CV-123-JRG" on its own line
      if (!caseNumber) {
        const trimmed = line.trim();
        // Remove any )( characters and spaces
        const cleaned = trimmed.replace(/[)(]/g, '').trim();
        // Check if this looks like a case number (format: X:XX-CV-XXX-XXX)
        if (cleaned.includes(':') && cleaned.includes('-CV-') && cleaned.length < 30) {
          // Check if previous line had "CIVIL ACTION"
          if (i > 0 && lines[i-1].includes('CIVIL ACTION')) {
            caseNumber = cleaned.toUpperCase();
            logger.info(`Extracted case number after CIVIL ACTION: ${caseNumber}`);
          }
        }
      }
      
      // Look for trial name using )( format from the header
      // Pattern: VOCALIFE LLC, PLAINTIFF, VS. AMAZON.COM, INC. and AMAZON.COM LLC, DEFENDANTS.
      if (!caseName && line.includes(')(')) {
        // Check if this is the start of the party block (contains company name)
        const leftPart = line.split(')(')[0].trim().replace(/^\d+\s*/, '').trim();
        
        // Look for lines that contain party names (uppercase letters)
        // Could be company name, PLAINTIFF, VS., or DEFENDANTS
        if (leftPart && (/[A-Z]/.test(leftPart) || leftPart === '')) {
          // Collect all consecutive )( lines that contain party info
          const partyLines: string[] = [];
          
          // Start from current line and collect all )( lines in the block
          // Don't stop at blank lines - they're part of the format
          let inPartyBlock = true;
          for (let j = i; j < Math.min(i + 30, lines.length) && inPartyBlock; j++) {
            const currentLine = lines[j];
            
            // If line contains )(, extract the left part
            if (currentLine.includes(')(')) {
              const part = currentLine.split(')(')[0].trim().replace(/^\d+\s*/, '').trim();
              
              // Include non-empty content only
              if (part && part.length > 0) {
                partyLines.push(part);
              }
            } 
            // Continue through blank lines if we're still seeing )( lines nearby
            else if (currentLine.trim() === '') {
              // Check if there are more )( lines ahead
              let hasMorePartyLines = false;
              for (let k = j + 1; k < Math.min(j + 3, lines.length); k++) {
                if (lines[k].includes(')(')) {
                  hasMorePartyLines = true;
                  break;
                }
              }
              if (!hasMorePartyLines) {
                inPartyBlock = false;
              }
            } else {
              // Non-blank line without )( - stop collecting
              inPartyBlock = false;
            }
          }
          
          // Process the collected lines to form case name
          if (partyLines.length >= 2) {  // Reduced requirement - at least plaintiff and defendant names
            // Join and clean up the party lines
            const fullText = partyLines.join(' ')
              .replace(/\s+/g, ' ')  // Normalize spaces
              .trim();
            
            // Strategy 1: Look for explicit PLAINTIFF/DEFENDANT markers
            if (fullText.includes('PLAINTIFF') && fullText.includes('DEFENDANT') && 
                (fullText.includes('VS.') || fullText.includes('V.'))) {
              caseName = fullText
                .replace(/\s*,\s*/g, ', ')  // Fix comma spacing
                .replace(/\s+(PLAINTIFF|DEFENDANTS?|VS\.)/g, ' $1')  // Fix spacing around keywords
                .trim();
              
              // Ensure proper ending
              if (!caseName.endsWith('.')) {
                caseName += '.';
              }
            }
            // Strategy 2: Look for VS. without explicit markers (like GENBAND US LLC VS. METASWITCH)
            else if (fullText.includes('VS.')) {
              // Split by VS. to get plaintiff and defendant parts
              const parts = fullText.split(/\s+VS\.\s+/i);
              if (parts.length === 2) {
                const plaintiff = parts[0].trim();
                const defendant = parts[1].trim();
                
                // Only use if both parts look like entity names (contain uppercase letters)
                if (plaintiff.match(/[A-Z]{2,}/) && defendant.match(/[A-Z]{2,}/)) {
                  caseName = `${plaintiff} VS. ${defendant}`;
                  
                  // Clean up any trailing company indicators that got separated
                  caseName = caseName
                    .replace(/\s+(CORP|INC|LLC|LTD|LLP)\s*\.?\s*/gi, ' $1. ')
                    .replace(/\s+/g, ' ')
                    .trim();
                }
              }
            }
            // Strategy 3: Look for pattern with just a period separator (like PACKET INTELLIGENCE LLC . NETSCOUT)
            else if (partyLines.length >= 2) {
              // Check if we have entity names separated by blank lines or periods
              const entities: string[] = [];
              let currentEntity = '';
              
              for (const line of partyLines) {
                // If line is just a period or VS, it's a separator
                if (line === '.' || line.toUpperCase() === 'VS' || line.toUpperCase() === 'VS.') {
                  if (currentEntity) {
                    entities.push(currentEntity.trim());
                    currentEntity = '';
                  }
                }
                // Otherwise accumulate entity name
                else if (line.match(/[A-Z]{2,}/)) {
                  currentEntity = currentEntity ? currentEntity + ' ' + line : line;
                }
              }
              
              // Don't forget the last entity
              if (currentEntity) {
                entities.push(currentEntity.trim());
              }
              
              // If we have at least 2 entities, form the case name
              if (entities.length >= 2) {
                // Take first as plaintiff, rest as defendants
                const plaintiff = entities[0];
                const defendants = entities.slice(1).join(', ');
                caseName = `${plaintiff} VS. ${defendants}`;
              }
            }
          }
        }
      }
      
      // Look for court information
      if (line.includes('UNITED STATES DISTRICT COURT')) {
        court = 'UNITED STATES DISTRICT COURT';
      }
      if (line.includes('DIVISION')) {
        // Remove line numbers and extra spaces from the beginning
        courtDivision = line.replace(/^\s*\d+\s*/, '').trim();
      }
      if (line.includes('DISTRICT OF')) {
        // Remove line numbers and extra spaces, also clean up "FOR THE" prefix
        courtDistrict = line.replace(/^\s*\d+\s*/, '')
                           .replace(/^FOR THE\s+/i, '')
                           .trim();
      }
    }
    
    // Default values if not found
    if (!caseNumber) {
      caseNumber = `CASE-${Date.now()}`; // Generate unique case number
      logger.warn(`Could not extract case number, using: ${caseNumber}`);
    }
    if (!caseName) {
      caseName = 'Unknown Case';
      logger.warn('Could not extract case name');
    }
    if (!court) {
      court = 'Unknown Court';
      logger.warn('Could not extract court name');
    }
    
    logger.info(`Extracted case info: ${caseName} (${caseNumber})`);
    
    return {
      caseNumber,
      name: caseName,
      court,
      courtDivision,
      courtDistrict
    };
  }

  /**
   * Extract judge information
   */
  private extractJudge(lines: string[]): any {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Look for "BEFORE THE HONORABLE" pattern
      if (line.includes('BEFORE THE HONORABLE')) {
        // Judge name is typically after "JUDGE" on the same or next line
        const currentAndNext = line + ' ' + (lines[i + 1] || '');
        
        // Pattern: "BEFORE THE HONORABLE JUDGE RODNEY GILSTRAP"
        const match = currentAndNext.match(/BEFORE THE HONORABLE(?:\s+JUDGE)?\s+([A-Z][A-Z\s]+?)(?:\s+UNITED|\s*$)/i);
        if (match) {
          const judgeName = match[1].trim()
            .replace(/\s+/g, ' ')  // Normalize spaces
            .replace(/JUDGE\s*/i, ''); // Remove JUDGE if it's part of the captured name
          
          return {
            name: judgeName,
            title: 'JUDGE',
            honorific: 'HONORABLE'
          };
        }
      }
    }
    return null;
  }

  /**
   * Extract court reporter information
   */
  private extractCourtReporter(lines: string[]): any {
    // Look for patterns like "Jane Doe, CSR, TCRR"
    for (const line of lines) {
      if (line.match(/CSR|RPR|COURT REPORTER/i)) {
        const parts = line.split(',').map(p => p.trim());
        return {
          name: parts[0],
          credentials: parts.slice(1).join(', ')
        };
      }
    }
    return null;
  }

  /**
   * Extract attorney information with enhanced parsing
   */
  private extractAttorneys(lines: string[]): { 
    plaintiffAttorneys: AttorneyInfo[], 
    defendantAttorneys: AttorneyInfo[] 
  } {
    const plaintiffAttorneys: AttorneyInfo[] = [];
    const defendantAttorneys: AttorneyInfo[] = [];
    
    let currentSection: 'plaintiff' | 'defendant' | null = null;
    let currentAttorney: AttorneyInfo | null = null;
    let currentFirm: { name: string; office?: { name: string; address?: AddressInfo } } | null = null;
    let addressLines: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Detect section - be more flexible with patterns
      if (trimmedLine.match(/FOR THE PLAINTIFF/i) || trimmedLine.includes('PLAINTIFF:')) {
        // Save any pending attorney before switching sections
        if (currentAttorney && currentSection) {
          if (currentSection === 'plaintiff') {
            plaintiffAttorneys.push(currentAttorney);
          } else {
            defendantAttorneys.push(currentAttorney);
          }
          currentAttorney = null;
        }
        currentSection = 'plaintiff';
        continue;
      } else if (trimmedLine.match(/FOR THE DEFENDANT/i) || trimmedLine.includes('DEFENDANTS:')) {
        // Save any pending attorney before switching sections
        if (currentAttorney && currentSection) {
          if (currentSection === 'plaintiff') {
            plaintiffAttorneys.push(currentAttorney);
          } else {
            defendantAttorneys.push(currentAttorney);
          }
          currentAttorney = null;
        }
        currentSection = 'defendant';
        continue;
      }
      
      if (!currentSection) continue;
      
      // Remove line numbers from the beginning if present
      const cleanLine = trimmedLine.replace(/^\d+\s+/, '');
      
      // Parse attorney name - look for MR./MS./MRS./DR. at the start of the line
      // Match patterns like "MR. JOSEPH R. RE" or "ALAN G. LAQUER" (sometimes without title)
      let nameMatch = cleanLine.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z][A-Z\s\.,]+?)(?:\s{2,}|$)/i);
      
      // If no title found, check if it's just a name in caps (like "ALAN G. LAQUER")
      if (!nameMatch && currentSection && cleanLine.match(/^[A-Z][A-Z\s\.]+$/)) {
        // Check if this is a law firm name first
        const isLawFirm = cleanLine.includes('LLP') || cleanLine.includes('LLC') || 
                          cleanLine.includes('P.C.') || cleanLine.includes('P.A.') ||
                          cleanLine.includes('PLLC') || cleanLine.includes('LAW') || 
                          cleanLine.includes('FIRM') || cleanLine.includes('ASSOCIATES') ||
                          cleanLine.includes('PARTNERS') || cleanLine.includes('COUNSEL');
        
        if (!isLawFirm) {
          // This might be an attorney name without title
          const nameParts = cleanLine.trim().split(/\s+/);
          if (nameParts.length >= 2 && nameParts.length <= 4) {
            // Likely an attorney name - use empty title placeholder
            nameMatch = ['', '', cleanLine];
            logger.debug(`Found attorney without title: ${cleanLine}`);
          }
        }
      }
      
      if (nameMatch) {
        // Save previous attorney if exists
        if (currentAttorney) {
          if (currentSection === 'plaintiff') {
            plaintiffAttorneys.push(currentAttorney);
          } else {
            defendantAttorneys.push(currentAttorney);
          }
        }
        
        // Extract full name and parse components
        const title = nameMatch[1] ? nameMatch[1].toUpperCase() : '';
        const fullNamePart = nameMatch[2].trim();
        
        // Parse name components
        const parsedName = this.parseFullName(fullNamePart);
        const lastName = parsedName.lastName.toUpperCase();
        
        // Create new attorney
        currentAttorney = {
          name: title ? `${title} ${fullNamePart}`.trim() : fullNamePart.trim(),
          title: title || undefined,
          lastName: lastName,
          speakerPrefix: title ? `${title} ${lastName}` : `??? ${lastName}`,
          firstName: parsedName.firstName,
          middleInitial: parsedName.middleInitial,
          suffix: parsedName.suffix
        };
        
        if (currentFirm) {
          currentAttorney.lawFirm = { ...currentFirm };
        }
        
        logger.debug(`Found attorney: ${currentAttorney.name} (${currentSection}) - Speaker: ${currentAttorney.speakerPrefix}`);
        
        // Reset for next attorney
        addressLines = [];
        continue;
      }
      
      // Check if this is a law firm name (contains legal entity markers or common patterns)
      if (cleanLine.length > 0 && 
          (cleanLine.includes('LLP') || cleanLine.includes('LLC') || cleanLine.includes('P.C.') || 
           cleanLine.includes('P.A.') || cleanLine.includes('PLLC') ||
           cleanLine.includes('LAW') || cleanLine.includes('FIRM') || 
           cleanLine.includes('ASSOCIATES') || cleanLine.includes('PARTNERS') ||
           cleanLine.includes(' & ') || // Common pattern for law firms like "Smith & Jones"
           cleanLine.includes('SMITH') || cleanLine.includes('KNOBBE') || cleanLine.includes('FENWICK'))) {
        
        // Process any pending address for previous firm
        if (addressLines.length > 0 && currentFirm) {
          const address = this.parseAddressLines(addressLines);
          if (address) {
            currentFirm.office = {
              name: address.city || 'Main Office',
              address
            };
            // Update current attorney if they exist
            if (currentAttorney && !currentAttorney.lawFirm) {
              currentAttorney.lawFirm = { ...currentFirm };
            }
          }
        }
        
        // Start new firm
        currentFirm = { name: cleanLine };
        addressLines = [];
        continue;
      }
      
      // Collect potential address lines
      if (cleanLine.length > 0 && !cleanLine.match(/^COURT REPORTER/)) {
        addressLines.push(cleanLine);
        
        // Check if we have a complete address (typically 2-3 lines)
        if (addressLines.length >= 2) {
          // Check if last line looks like city, state zip
          const lastLine = addressLines[addressLines.length - 1];
          if (lastLine.match(/,\s*[A-Z]{2}\s+\d{5}/)) {
            const address = this.parseAddressLines(addressLines);
            if (address && currentFirm) {
              currentFirm.office = {
                name: address.city || 'Main Office',
                address
              };
              // Update current attorney
              if (currentAttorney) {
                currentAttorney.lawFirm = { ...currentFirm };
              }
            }
            addressLines = [];
          }
        }
      }
    }
    
    // Save last attorney
    if (currentAttorney) {
      if (currentSection === 'plaintiff') {
        plaintiffAttorneys.push(currentAttorney);
      } else if (currentSection === 'defendant') {
        defendantAttorneys.push(currentAttorney);
      }
    }
    
    // Log summary
    logger.info(`Extracted attorneys:`);
    plaintiffAttorneys.forEach(a => logger.info(`  Plaintiff: ${a.name} (${a.speakerPrefix})`));
    defendantAttorneys.forEach(a => logger.info(`  Defendant: ${a.name} (${a.speakerPrefix})`));
    
    return { plaintiffAttorneys, defendantAttorneys };
  }
  
  /**
   * Parse address from collected lines
   */
  private parseAddressLines(lines: string[]): AddressInfo | null {
    if (lines.length < 2) return null;
    
    // Last line should be city, state zip
    const lastLine = lines[lines.length - 1];
    const cityStateZip = lastLine.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    
    if (cityStateZip) {
      return {
        street1: lines[0],
        street2: lines.length > 2 ? lines[1] : undefined,
        city: cityStateZip[1],
        state: cityStateZip[2],
        zipCode: cityStateZip[3],
        country: 'USA'
      };
    }
    
    return null;
  }

  /**
   * Parse name into components (firstName, middleInitial, lastName, suffix)
   */
  private parseFullName(fullName: string): {
    firstName?: string;
    middleInitial?: string;
    lastName: string;
    suffix?: string;
  } {
    // First check for comma-separated suffix (e.g., "RUBINO, III")
    let mainName = fullName.trim();
    let suffix: string | undefined;
    
    const commaMatch = fullName.match(/^(.+?),\s*([IVX]+|Jr\.?|Sr\.?|ESQ\.?|Ph\.?D\.?|M\.?D\.?)$/i);
    if (commaMatch) {
      mainName = commaMatch[1].trim();
      suffix = commaMatch[2].trim();
    }
    
    // Clean up and split the main name
    const cleanName = mainName.replace(/\s+/g, ' ');
    const parts = cleanName.split(/\s+/);
    
    // Check for suffixes at the end of the name (if not already found via comma)
    if (!suffix) {
      const suffixes = ['III', 'II', 'IV', 'JR', 'JR.', 'SR', 'SR.', 'ESQ', 'ESQ.', 'PHD', 'PH.D.', 'MD', 'M.D.'];
      const lastPart = parts[parts.length - 1].toUpperCase().replace(/\./g, '');
      if (suffixes.includes(lastPart)) {
        suffix = parts[parts.length - 1];
        parts.pop(); // Remove suffix from parts
      }
    }
    
    let nameParts = [...parts];
    
    // Now parse the remaining name parts
    if (nameParts.length === 0) {
      return { lastName: fullName }; // Fallback
    } else if (nameParts.length === 1) {
      return { lastName: nameParts[0], suffix };
    } else if (nameParts.length === 2) {
      return { 
        firstName: nameParts[0], 
        lastName: nameParts[1], 
        suffix 
      };
    } else {
      // 3 or more parts - assume middle initial(s)
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      const middleInitial = nameParts.slice(1, -1).join(' ');
      return { firstName, middleInitial, lastName, suffix };
    }
  }
  
  /**
   * Extract last name from full name (using new parser)
   */
  private extractLastName(fullName: string): string {
    return this.parseFullName(fullName).lastName;
  }

  /**
   * Parse address from lines
   */
  private parseAddress(lines: string[], startIndex: number): AddressInfo | null {
    if (startIndex + 2 >= lines.length) return null;
    
    const street1 = lines[startIndex + 1]?.trim();
    const cityStateZip = lines[startIndex + 2]?.trim();
    
    if (!cityStateZip) return null;
    
    // Parse city, state, zip
    const match = cityStateZip.match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      return {
        street1,
        city: match[1],
        state: match[2],
        zipCode: match[3],
        country: 'USA'
      };
    }
    
    return null;
  }

  /**
   * Extract session information
   */
  private extractSessionInfo(lines: string[], fileName: string): SessionInfo {
    // Try to extract date from content
    let sessionDate = new Date();
    let sessionType: SessionInfo['sessionType'] = 'OTHER';
    let documentNumber: number | undefined;
    let totalPages: number | undefined;
    
    for (const line of lines.slice(0, 50)) {
      // Look for document number and page count in header
      // Pattern: "Case 2:19-cv-00123-JRG Document 328 Filed 10/09/20 Page 1 of 125 PageID #: 18337"
      const headerMatch = line.match(/Document\s+(\d+)\s+Filed\s+[\d\/]+\s+Page\s+\d+\s+of\s+(\d+)/);
      if (headerMatch) {
        documentNumber = parseInt(headerMatch[1]);
        totalPages = parseInt(headerMatch[2]);
      }
      
      // Look for date patterns
      const dateMatch = line.match(/(\w+\s+\d{1,2},\s+\d{4})/);
      if (dateMatch) {
        sessionDate = new Date(dateMatch[1]);
        break;
      }
    }
    
    // Determine session type from filename
    // Check for full-day transcript first (contains both AM and PM)
    if (fileName.includes('AM and PM') || fileName.includes('AM & PM')) {
      sessionType = 'ALLDAY';  // Full day transcript containing both morning and afternoon
    } else if (fileName.includes('Morning') || fileName.includes('AM')) {
      sessionType = 'MORNING';
    } else if (fileName.includes('Afternoon') || fileName.includes('PM')) {
      sessionType = 'AFTERNOON';
    } else if (fileName.includes('Verdict')) {
      sessionType = 'JURY_VERDICT';
    } else if (fileName.includes('Bench')) {
      sessionType = 'BENCH_TRIAL';
    }
    
    return {
      sessionDate,
      sessionType,
      fileName,
      documentNumber,
      totalPages
    };
  }

  /**
   * Create or update trial with enhanced attorney handling
   */
  private async createOrUpdateTrial(summaryInfo: SummaryInfo): Promise<void> {
    // Create or update trial
    const trial = await this.prisma.trial.upsert({
      where: { caseNumber: summaryInfo.caseInfo.caseNumber },
      update: {
        name: summaryInfo.caseInfo.name,
        court: summaryInfo.caseInfo.court,
        courtDivision: summaryInfo.caseInfo.courtDivision,
        courtDistrict: summaryInfo.caseInfo.courtDistrict
      },
      create: {
        name: summaryInfo.caseInfo.name,
        caseNumber: summaryInfo.caseInfo.caseNumber,
        court: summaryInfo.caseInfo.court,
        courtDivision: summaryInfo.caseInfo.courtDivision,
        courtDistrict: summaryInfo.caseInfo.courtDistrict
      }
    });
    
    this.trialId = trial.id;
    logger.info(`Trial created/updated: ${trial.caseNumber} (ID: ${trial.id})`);
    
    // Create judge with speaker
    if (summaryInfo.judge) {
      // Create speaker for judge with handle
      const speakerHandle = `JUDGE_${trial.id}`;
      
      const judgeSpeaker = await this.prisma.speaker.findFirst({
        where: {
          trialId: trial.id,
          speakerHandle: speakerHandle
        }
      });
      
      let speaker;
      if (!judgeSpeaker) {
        speaker = await this.prisma.speaker.create({
          data: {
            trialId: trial.id,
            speakerPrefix: 'THE COURT',
            speakerHandle: speakerHandle,
            speakerType: 'JUDGE'
          }
        });
      } else {
        speaker = judgeSpeaker;
      }
      
      await this.prisma.judge.upsert({
        where: { trialId: trial.id },
        update: {
          name: summaryInfo.judge.name,
          title: summaryInfo.judge.title,
          honorific: summaryInfo.judge.honorific,
          speakerId: speaker.id
        },
        create: {
          trialId: trial.id,
          name: summaryInfo.judge.name,
          title: summaryInfo.judge.title,
          honorific: summaryInfo.judge.honorific,
          speakerId: speaker.id
        }
      })
      
      logger.info(`Judge created/updated: ${summaryInfo.judge.name}`);
    }
    
    // Create court reporter
    if (summaryInfo.courtReporter) {
      let addressId: number | null = null;
      
      if (summaryInfo.courtReporter.address) {
        addressId = await this.addressService.createOrFindAddress(summaryInfo.courtReporter.address);
      }
      
      await this.prisma.courtReporter.upsert({
        where: { trialId: trial.id },
        update: {
          name: summaryInfo.courtReporter.name,
          credentials: summaryInfo.courtReporter.credentials,
          phone: summaryInfo.courtReporter.phone,
          addressId
        },
        create: {
          trialId: trial.id,
          name: summaryInfo.courtReporter.name,
          credentials: summaryInfo.courtReporter.credentials,
          phone: summaryInfo.courtReporter.phone,
          addressId
        }
      })
      
      logger.info(`Court reporter created/updated: ${summaryInfo.courtReporter.name}`);
    }
    
    // Create attorneys with new service
    for (const attorneyInfo of summaryInfo.plaintiffAttorneys) {
      await this.attorneyService.createOrUpdateAttorney(trial.id, attorneyInfo, 'PLAINTIFF');
    }
    logger.info(`Created ${summaryInfo.plaintiffAttorneys.length} plaintiff attorneys`);
    
    for (const attorneyInfo of summaryInfo.defendantAttorneys) {
      await this.attorneyService.createOrUpdateAttorney(trial.id, attorneyInfo, 'DEFENDANT');
    }
    logger.info(`Created ${summaryInfo.defendantAttorneys.length} defendant attorneys`);
  }

  /**
   * Create session
   */
  private async createSession(sessionInfo: SessionInfo, fileName: string): Promise<any> {
    if (!this.trialId) {
      throw new Error('Trial ID not set');
    }
    
    // Calculate transcriptStartPage and ordinal based on previous sessions
    const previousSessions = await this.prisma.session.findMany({
      where: { trialId: this.trialId },
      orderBy: [
        { sessionDate: 'asc' },
        { sessionType: 'asc' }
      ]
    });
    
    let transcriptStartPage = 1;
    for (const prevSession of previousSessions) {
      if (prevSession.totalPages) {
        transcriptStartPage += prevSession.totalPages;
      }
    }
    
    // Calculate ordinal - it's the count of sessions + 1
    const ordinal = previousSessions.length + 1;
    
    // Generate sessionHandle: YYYYMMDD_sessionType
    const dateStr = sessionInfo.sessionDate.toISOString().split('T')[0].replace(/-/g, '');
    const sessionHandle = `${dateStr}_${sessionInfo.sessionType}`;
    
    return await this.prisma.session.upsert({
      where: {
        trialId_sessionDate_sessionType: {
          trialId: this.trialId,
          sessionDate: sessionInfo.sessionDate,
          sessionType: sessionInfo.sessionType
        }
      },
      update: {
        fileName,
        documentNumber: sessionInfo.documentNumber,
        totalPages: sessionInfo.totalPages,
        transcriptStartPage,
        ordinal,
        sessionHandle
      },
      create: {
        trialId: this.trialId,
        sessionDate: sessionInfo.sessionDate,
        sessionType: sessionInfo.sessionType,
        sessionHandle,
        fileName,
        documentNumber: sessionInfo.documentNumber,
        totalPages: sessionInfo.totalPages,
        transcriptStartPage,
        ordinal
      }
    });
  }

  /**
   * Create page
   */
  private async createPage(
    sessionId: number,
    pageNumber: number,
    section: string,
    pageInfo?: any
  ): Promise<any> {
    this.directoryStats.totalPages++;
    this.globalTrialPageNumber++;
    
    // Use the globalTrialPageNumber as the calculated trial page number
    // This ensures continuity across sessions
    const calculatedTrialPageNumber = this.globalTrialPageNumber;
    
    return await this.prisma.page.create({
      data: {
        sessionId,
        pageNumber,
        trialPageNumber: calculatedTrialPageNumber,
        parsedTrialPage: pageInfo?.parsedTrialPage,
        pageId: pageInfo?.pageId,
        headerText: pageInfo?.headerText
      }
    });
  }

  /**
   * Check if line is a page break
   */
  private isPageBreak(line: string): boolean {
    // Look for the specific page header format: "Case X:XX-cv-XXXXX-XXX Document XXX..."
    if (line.includes('Case ') && line.includes(' Document ') && line.includes(' PageID #:')) {
      return true;
    }
    return false;
  }
  
  /**
   * Get number of lines in page header to skip
   */
  private getPageHeaderLineCount(lines: string[], index: number): number {
    let headerLines = 0;
    let foundCaseLine = false;
    let foundTrialLine = false;
    
    // Check next few lines for header pattern
    for (let i = index; i < Math.min(index + 10, lines.length); i++) {
      const line = lines[i].trim();
      
      // First line: Case header
      if (i === index && line.includes('Case') && line.includes('Document')) {
        foundCaseLine = true;
        headerLines = 1;
        continue;
      }
      
      // Second line: parsedTrialPage (single number)
      if (i === index + 1 && foundCaseLine) {
        const lineNum = parseInt(line);
        if (lineNum > 0 && line === lineNum.toString()) {
          foundTrialLine = true;
          headerLines = 2;
          continue;
        }
      }
      
      // Additional blank lines after header
      if (foundTrialLine && line === '') {
        headerLines++;
      } else if (foundTrialLine && line.match(/^\d{2}:\d{2}:\d{2}/)) {
        // Stop at first content line with timestamp
        break;
      } else if (foundTrialLine) {
        // Stop at first non-blank line after 2-line header
        break;
      }
      
      // Legacy: handle other header patterns if not 2-line format
      if (!foundCaseLine && (
          line.includes('Case') || 
          line.includes('PageID') || 
          line.match(/^\d+$/) ||
          line.includes('Document') ||
          line === '' ||
          line.includes('Page '))) {
        headerLines++;
      } else if (line.match(/^\d{2}:\d{2}:\d{2}/)) {
        // Found first content line with timestamp
        break;
      } else if (headerLines > 0) {
        // We've seen header lines and now hit content
        break;
      }
    }
    
    return Math.max(headerLines, 2); // Skip at least 2 lines for Vocalife format
  }

  /**
   * Extract page information from header
   */
  private extractPageInfo(lines: string[], index: number): any {
    const pageInfo: any = {};
    
    // Look for PageID and page number in header
    // Pattern: "Case 2:19-cv-00123-JRG Document 328 Filed 10/09/20 Page X of 125 PageID #: 18337"
    // For Vocalife: 2-line header with parsedTrialPage on second line
    let headerLines: string[] = [];
    
    for (let i = index; i < Math.min(index + 5, lines.length); i++) {
      const line = lines[i];
      
      // Store the header text (first line of the page)
      if (i === index && line.includes('Case')) {
        headerLines.push(line);
        pageInfo.headerText = line;
        
        // Extract both page number and PageID from the same line if possible
        const fullHeaderMatch = line.match(/Page\s+(\d+)\s+of\s+\d+\s+PageID\s*#:\s*(\d+)/);
        if (fullHeaderMatch) {
          pageInfo.trialPageNumber = parseInt(fullHeaderMatch[1]);
          pageInfo.pageId = fullHeaderMatch[2];
        } else {
          // Fallback to individual patterns
          const pageIdMatch = line.match(/PageID\s*#:\s*(\d+)/);
          if (pageIdMatch) {
            pageInfo.pageId = pageIdMatch[1];
          }
          
          const pageNumMatch = line.match(/Page\s+(\d+)\s+of/);
          if (pageNumMatch) {
            pageInfo.trialPageNumber = parseInt(pageNumMatch[1]);
          }
        }
      }
      
      // Check if next line is the parsedTrialPage (single number on its own line)
      if (i === index + 1 && headerLines.length > 0) {
        const trimmedLine = line.trim();
        const lineNum = parseInt(trimmedLine);
        if (lineNum > 0 && trimmedLine === lineNum.toString()) {
          // This is the parsedTrialPage
          pageInfo.parsedTrialPage = lineNum;
          headerLines.push(line);
          pageInfo.headerText = headerLines.join('\n');
          break;
        }
      }
    }
    
    return pageInfo;
  }

  /**
   * Log directory statistics
   */
  private logDirectoryStats(processingTime: number): void {
    const { totalFiles, totalLines, nonBlankLines, totalPages, errorFiles, batchInserts, totalBatchTime } = this.directoryStats;
    const blankLines = totalLines - nonBlankLines;
    const blankPercentage = totalLines > 0 ? ((blankLines / totalLines) * 100).toFixed(1) : '0';
    
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 TRANSCRIPT PARSING COMPLETED');
    logger.info('='.repeat(60));
    logger.info(`⏱️  Total processing time: ${processingTime.toFixed(1)} seconds`);
    logger.info(`📁 Files processed: ${totalFiles}`);
    logger.info(`📄 Pages processed: ${totalPages.toLocaleString()}`);
    logger.info(`📝 Lines processed: ${totalLines.toLocaleString()}`);
    logger.info(`✅ Content lines: ${nonBlankLines.toLocaleString()}`);
    logger.info(`⚪ Blank lines: ${blankLines.toLocaleString()} (${blankPercentage}%)`);
    
    // Batch processing statistics
    logger.info('\n📦 BATCH PROCESSING STATS:');
    logger.info(`🔢 Total batch inserts: ${batchInserts}`);
    logger.info(`⚡ Batch size: ${this.config.batchSize} lines`);
    if (batchInserts > 0) {
      const avgBatchTime = (totalBatchTime / batchInserts).toFixed(1);
      const avgLinesPerBatch = (nonBlankLines / batchInserts).toFixed(1);
      logger.info(`⏱️  Average batch insert time: ${avgBatchTime}ms`);
      logger.info(`📈 Average lines per batch: ${avgLinesPerBatch}`);
      const insertRate = totalBatchTime > 0 ? ((nonBlankLines / totalBatchTime) * 1000).toFixed(0) : '0';
      logger.info(`💾 Database insert rate: ${insertRate} lines/second`);
    }
    
    if (errorFiles.length > 0) {
      logger.warn(`\n⚠️  Files with errors: ${errorFiles.length}`);
      errorFiles.forEach(file => logger.warn(`   - ${file}`));
    }
    
    const avgLinesPerSecond = processingTime > 0 ? (totalLines / processingTime).toFixed(0) : '0';
    logger.info(`\n🚀 Overall processing speed: ${avgLinesPerSecond} lines/second`);
    logger.info('='.repeat(60));
  }

  /**
   * Extract speaker from text (only for PROCEEDINGS sections)
   */
  private extractSpeakerFromText(text: string): { speakerPrefix?: string; text?: string } {
    if (!text) return { text: '' };
    
    // Speaker patterns for extracting speaker prefix from the text content
    const speakerPatterns = [
      // THE COURT: pattern
      /^\s*(THE COURT):\s*(.*)$/,
      // COURT SECURITY OFFICER: pattern
      /^\s*(COURT SECURITY OFFICER):\s*(.*)$/,
      // THE FOREPERSON: pattern
      /^\s*(THE FOREPERSON):\s*(.*)$/,
      // MR./MS./MRS./DR. NAME: pattern  
      /^\s*((?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
      // JUROR NAME: pattern
      /^\s*(JUROR\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
      // Q./A. pattern (these don't have colons)
      /^\s*(Q\.|A\.)\s+(.*)$/,
      // BY MR./MS. pattern
      /^\s*(BY\s+(?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
      // THE WITNESS: pattern
      /^\s*(THE WITNESS):\s*(.*)$/,
      // Other formal speakers (WITNESS, BAILIFF, etc.)
      /^\s*((?:WITNESS|BAILIFF|COURT REPORTER|INTERPRETER)):\s*(.*)$/i,
      // Generic capitalized speaker pattern (any capitalized word(s) followed by colon)
      /^\s*([A-Z][A-Z\s]*?):\s*(.*)$/
    ];
    
    // Pattern for court directives (parenthetical content)
    const directivePattern = /^\s*\((.*?)\)\s*$/;
    
    // Check each speaker pattern
    for (const pattern of speakerPatterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          speakerPrefix: match[1].trim(),
          text: match[2] !== undefined ? match[2].trim() : ''
        };
      }
    }
    
    // Check for court directive (parenthetical content)
    const directiveMatch = text.match(directivePattern);
    if (directiveMatch) {
      return {
        text: text  // Keep the full directive text including parentheses
      };
    }
    
    // No speaker found, return original text
    return { text };
  }
}