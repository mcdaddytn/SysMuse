// src/parsers/TranscriptParser.ts
import { PrismaClient } from '@prisma/client';
import { TranscriptConfig, SessionInfo, TrialSummaryInfo, DocumentSection } from '../types/config.types';
import { PageHeaderParser, PageHeaderInfo } from './PageHeaderParser';
import { LineParser } from './LineParser';
import { SummaryPageParser } from './SummaryPageParser';
import logger from '../utils/logger';
import fs from 'fs';
import path from 'path';

interface DirectoryStats {
  totalFiles: number;
  totalLines: number;
  nonBlankLines: number;
  totalPages: number;
  errorFiles: string[];
}

export class TranscriptParser {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private trialId: number | null = null;
  private directoryStats: DirectoryStats = {
    totalFiles: 0,
    totalLines: 0,
    nonBlankLines: 0,
    totalPages: 0,
    errorFiles: []
  };
  private currentDocumentSection: DocumentSection = 'SUMMARY'; // Start with SUMMARY
  private proceedingsEncountered = false;
  private certificationEncountered = false;
  private globalTrialLineNumber = 0;
  private globalSessionLineNumber = 0;

  constructor(config: TranscriptConfig, prisma: PrismaClient) {
    this.config = config;
    this.prisma = prisma;
  }

  async parseDirectory(directoryPath: string): Promise<void> {
    const directoryStartTime = Date.now();
    logger.info(`🚀 Starting Phase 1 parsing of directory: ${directoryPath}`);
    
    // Reset stats and state
    this.directoryStats = {
      totalFiles: 0,
      totalLines: 0,
      nonBlankLines: 0,
      totalPages: 0,
      errorFiles: []
    };
    this.currentDocumentSection = 'SUMMARY'; // Start with SUMMARY
    this.proceedingsEncountered = false;
    this.certificationEncountered = false;
    this.globalTrialLineNumber = 0;
    this.globalSessionLineNumber = 0;

    const files = fs.readdirSync(directoryPath)
      .filter(file => file.endsWith('.txt'))
      .sort(this.sortTranscriptFiles);

    logger.info(`📁 Found ${files.length} transcript files to process`);

    // Process files in order
    for (const file of files) {
      const filePath = path.join(directoryPath, file);
      try {
        await this.parseFile(filePath);
        this.directoryStats.totalFiles++;
      } catch (error) {
        logger.error(`❌ Error processing file ${file}:`, error);
        this.directoryStats.errorFiles.push(file);
      }
    }

    // Calculate final trial totals and update trial record
    if (this.trialId) {
      await this.updateTrialTotals();
    }

    const directoryTime = (Date.now() - directoryStartTime) / 1000;
    this.logDirectoryStats(directoryTime);
  }

  private async updateTrialTotals(): Promise<void> {
    if (!this.trialId) return;

    // Calculate total pages across all sessions
    const sessions = await this.prisma.session.findMany({
      where: { trialId: this.trialId },
      select: { totalPages: true }
    });

    const totalPages = sessions.reduce((sum, session) => sum + (session.totalPages || 0), 0);

    // Update trial with total pages
    await this.prisma.trial.update({
      where: { id: this.trialId },
      data: { totalPages }
    });

    logger.info(`✅ Updated trial totals: ${totalPages} pages across ${sessions.length} sessions`);
  }

  private sortTranscriptFiles(a: string, b: string): number {
    // Extract date patterns and session types for proper ordering
    const extractInfo = (filename: string) => {
      const dateMatch = filename.match(/(\d{1,2})[_\-](\d{1,2})[_\-](\d{2,4})/);
      const morningMatch = /morning|morn/i.test(filename);
      const afternoonMatch = /afternoon|aft/i.test(filename);
      
      let date = new Date();
      if (dateMatch) {
        const month = parseInt(dateMatch[1]);
        const day = parseInt(dateMatch[2]);
        const year = dateMatch[3].length === 2 ? 2000 + parseInt(dateMatch[3]) : parseInt(dateMatch[3]);
        date = new Date(year, month - 1, day);
      }
      
      let sessionOrder = 2; // Default for other types
      if (morningMatch) sessionOrder = 0;
      else if (afternoonMatch) sessionOrder = 1;
      
      return { date: date.getTime(), sessionOrder };
    };

    const aInfo = extractInfo(a);
    const bInfo = extractInfo(b);
    
    // Sort by date first, then by session type
    if (aInfo.date !== bInfo.date) {
      return aInfo.date - bInfo.date;
    }
    return aInfo.sessionOrder - bInfo.sessionOrder;
  }

  private async parseFile(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const fileStartTime = Date.now();
    
    logger.info(`📄 Processing file: ${filename}`);
    
    // Reset document section state for each new file/session
    this.currentDocumentSection = 'SUMMARY';
    this.proceedingsEncountered = false;
    this.certificationEncountered = false;
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const pages = this.groupLinesIntoPages(lines);
    
    logger.info(`   📋 Split into ${pages.length} pages`);
    
    // Determine session info
    const sessionInfo = this.extractSessionInfo(filename, pages[0]);
    
    // Process first pages for trial summary if not already created
    if (!this.trialId && pages.length > 0) {
      const summaryInfo = await this.parseSummaryPages(pages.slice(0, 3));
      if (summaryInfo) {
        await this.createOrUpdateTrial(summaryInfo);
        logger.info(`   ✅ Created trial: ${summaryInfo.trialName || summaryInfo.caseNumber}`);
      }
    }
    
    // Create session
    const session = await this.createSession(sessionInfo, filename);
    logger.info(`   📅 Created session: ${sessionInfo.sessionDate.toLocaleDateString()} ${sessionInfo.sessionType}`);
    
    // Reset session line counter for new session
    this.globalSessionLineNumber = 0;
    
    // Track session statistics
    let sessionTotalLines = 0;
    let sessionNonBlankLines = 0;
    let transcriptStartPage: number | undefined;
    
    // Parse and store pages with progress tracking
    logger.info(`   🔄 Processing ${pages.length} pages...`);
    for (let i = 0; i < pages.length; i++) {
      const pageStats = await this.parsePage(pages[i], session.id, i + 1);
      sessionTotalLines += pageStats.totalLines;
      sessionNonBlankLines += pageStats.nonBlankLines;
      
      // Capture transcript start page from first page
      if (i === 0 && pageStats.trialPageNumber) {
        transcriptStartPage = pageStats.trialPageNumber;
      }
      
      // Show progress for large files
      if (pages.length > 50 && (i + 1) % 25 === 0) {
        const progress = ((i + 1) / pages.length * 100).toFixed(1);
        logger.info(`   📈 Progress: ${i + 1}/${pages.length} pages (${progress}%)`);
      }
    }
    
    // Update session with calculated totals
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        totalPages: pages.length,
        transcriptStartPage
      }
    });
    
    const sessionBlankLines = sessionTotalLines - sessionNonBlankLines;
    const blankPercentage = sessionTotalLines > 0 ? 
      ((sessionBlankLines / sessionTotalLines) * 100).toFixed(1) : '0';
    const fileTime = (Date.now() - fileStartTime) / 1000;
    
    // Update directory stats
    this.directoryStats.totalLines += sessionTotalLines;
    this.directoryStats.nonBlankLines += sessionNonBlankLines;
    this.directoryStats.totalPages += pages.length;
    
    logger.info(`   ✅ File completed in ${fileTime.toFixed(1)}s`);
    logger.info(`   📊 File stats: ${sessionTotalLines.toLocaleString()} total, ${sessionNonBlankLines.toLocaleString()} content, ${sessionBlankLines.toLocaleString()} blank (${blankPercentage}%)`);
  }

  // src/parsers/TranscriptParser.ts (relevant section)
  // This is the updated parsePage method that properly skips the trial page number line

  private async parsePage(
    pageLines: string[], 
    sessionId: number, 
    pageNumber: number
  ): Promise<{ totalLines: number, nonBlankLines: number, trialPageNumber?: number }> {
    const parser = new PageHeaderParser();
    const lineParser = new LineParser();
    
    // Parse page header if present
    const headerInfo = parser.parse(pageLines[0]);
    const trialPageNumber = parser.parseTrialPageNumber(pageLines);
    
    // Determine document section
    const detectedSection = parser.determineDocumentSection(pageLines);
    this.updateDocumentSectionState(detectedSection, pageLines);
    
    // Use upsert for page to handle duplicates
    const page = await this.prisma.page.upsert({
      where: {
        sessionId_pageNumber: {
          sessionId,
          pageNumber
        }
      },
      update: {
        documentSection: this.currentDocumentSection,
        trialPageNumber,
        pageId: headerInfo?.pageId || null,
        headerText: headerInfo?.fullText || null
      },
      create: {
        sessionId,
        pageNumber,
        documentSection: this.currentDocumentSection,
        trialPageNumber,
        pageId: headerInfo?.pageId || null,
        headerText: headerInfo?.fullText || null
      }
    });
    
    // Clear existing lines for this page
    await this.prisma.line.deleteMany({
      where: { pageId: page.id }
    });
    
    // BATCH PROCESSING: Prepare all lines first, filtering blanks
    const linesToInsert = [];
    let sequentialLineNumber = 1;
    let totalLines = 0;
    let blankLines = 0;
    
    // Only persist lines from PROCEEDINGS section, not SUMMARY
    const shouldPersistLines = this.currentDocumentSection === 'PROCEEDINGS';
    
    for (let i = 0; i < pageLines.length; i++) {
      const line = pageLines[i];
      totalLines++;
      
      // Skip header line (first line if it contains Case info)
      if (i === 0 && headerInfo) continue;
      
      // Skip trial page number line (second line if it's just a number)
      // gm: this test did not work, just do not need to persist first two lines always header 
      // if (i === 1 && trialPageNumber && line.trim() === trialPageNumber.toString()) {
      if (i === 1 && trialPageNumber) {
        logger.debug(`   Skipping trial page number line: ${trialPageNumber}`);
        continue;
      }
      
      const parsedLine = lineParser.parse(line);
      
      if (parsedLine) {
        // Count blank lines but skip storing them if configured to ignore
        if (parsedLine.isBlank) {
          blankLines++;
          if (this.config.parsingOptions?.ignoreBlankLines) {
            continue; // Skip storing blank lines
          }
        }
        
        // Only persist lines if we're in PROCEEDINGS section
        if (shouldPersistLines) {
          // Increment global counters
          this.globalTrialLineNumber++;
          this.globalSessionLineNumber++;
          
          linesToInsert.push({
            pageId: page.id,
            lineNumber: sequentialLineNumber++,
            trialLineNumber: this.globalTrialLineNumber,
            sessionLineNumber: this.globalSessionLineNumber,
            timestamp: parsedLine.timestamp,
            text: parsedLine.text,
            speakerPrefix: parsedLine.speakerPrefix,
            isBlank: parsedLine.isBlank
          });
        }
      }
    }
    
    // Batch insert all lines at once (only if we have lines to insert)
    if (linesToInsert.length > 0) {
      await this.prisma.line.createMany({
        data: linesToInsert
      });
      logger.debug(`   Persisted ${linesToInsert.length} lines to database`);
    } else if (shouldPersistLines) {
      logger.debug(`   No lines to persist for page ${pageNumber}`);
    } else {
      logger.debug(`   Skipping line persistence for ${this.currentDocumentSection} section`);
    }
    
    const nonBlankLines = totalLines - blankLines;
    
    // Log progress every 10 pages or for first 5 pages
    if (pageNumber % 10 === 0 || pageNumber <= 5) {
      logger.info(`   Page ${pageNumber} [${this.currentDocumentSection}]: ${totalLines} total, ${nonBlankLines} content, ${blankLines} blank (stored: ${linesToInsert.length})`);
    }
    
    return { totalLines, nonBlankLines, trialPageNumber: trialPageNumber || undefined };
  }

  private updateDocumentSectionState(detectedSection: DocumentSection, pageLines: string[]): void {
    // Check for section transitions based on detected content
    if (detectedSection === 'PROCEEDINGS' && !this.proceedingsEncountered) {
      this.currentDocumentSection = 'PROCEEDINGS';
      this.proceedingsEncountered = true;
      logger.info(`   🔄 Document section changed to: PROCEEDINGS`);
    } else if (detectedSection === 'CERTIFICATION' && !this.certificationEncountered) {
      this.currentDocumentSection = 'CERTIFICATION';
      this.certificationEncountered = true;
      logger.info(`   🔄 Document section changed to: CERTIFICATION`);
    }
    // If we haven't detected any section markers, stay in SUMMARY
    // Once in PROCEEDINGS, stay there unless we hit CERTIFICATION
    // Once in CERTIFICATION, stay there
  }

  private groupLinesIntoPages(lines: string[]): string[][] {
    const pages: string[][] = [];
    let currentPage: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for page break (but not on the very first line)
      if (i > 0 && this.isPageBreak(line)) {
        // Save current page if it has content
        if (currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
        }
      }
      
      // Add line to current page
      currentPage.push(line);
    }
    
    // Don't forget the last page
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    
    return pages;
  }

  private isPageBreak(line: string): boolean {
    const pageHeaderPattern = /^\s*Case\s+.*Document\s+\d+/;
    return line.includes('\f') || pageHeaderPattern.test(line);
  }  

  private extractSessionInfo(filename: string, firstPage: string[]): SessionInfo {
    const sessionDate = this.extractDateFromFilename(filename) || new Date();
    
    let sessionType: SessionInfo['sessionType'] = 'OTHER';
    
    if (/morning/i.test(filename)) {
      sessionType = 'MORNING';
    } else if (/afternoon/i.test(filename)) {
      sessionType = 'AFTERNOON';
    } else if (/bench\s*trial/i.test(filename)) {
      sessionType = 'BENCH_TRIAL';
    } else if (/jury\s*verdict/i.test(filename)) {
      sessionType = 'JURY_VERDICT';
    }
    
    // Try to extract document number from first page header
    let documentNumber: number | undefined;
    for (const line of firstPage) {
      const match = line.match(/Document\s+(\d+)/);
      if (match) {
        documentNumber = parseInt(match[1]);
        break;
      }
    }
    
    return {
      sessionDate,
      sessionType,
      fileName: filename,
      documentNumber
    };
  }

  private extractDateFromFilename(filename: string): Date | null {
    // Try various date patterns in filename
    const patterns = [
      /(\d{1,2})[_\-](\d{1,2})[_\-](\d{2,4})/,  // MM_DD_YY or MM-DD-YYYY
      /(\d{4})[_\-](\d{1,2})[_\-](\d{1,2})/,    // YYYY_MM_DD
    ];
    
    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) {
        const [, first, second, third] = match;
        
        // Determine if it's MM/DD/YY or YYYY/MM/DD format
        if (first.length === 4) {
          // YYYY/MM/DD format
          return new Date(parseInt(first), parseInt(second) - 1, parseInt(third));
        } else {
          // MM/DD/YY format
          const year = third.length === 2 ? 2000 + parseInt(third) : parseInt(third);
          return new Date(year, parseInt(first) - 1, parseInt(second));
        }
      }
    }
    
    return null;
  }

  private async parseSummaryPages(pages: string[][]): Promise<TrialSummaryInfo | null> {
    const parser = new SummaryPageParser();
    return parser.parse(pages);
  }

  private async createOrUpdateTrial(summaryInfo: TrialSummaryInfo): Promise<void> {
    logger.info('Creating/updating trial record');
    
    // Create or update trial
    const trial = await this.prisma.trial.upsert({
      where: { caseNumber: summaryInfo.caseNumber },
      update: {
        name: summaryInfo.trialName,
        court: summaryInfo.court,
        courtDivision: summaryInfo.courtDivision,
        courtDistrict: summaryInfo.courtDistrict
      },
      create: {
        name: summaryInfo.trialName,
        caseNumber: summaryInfo.caseNumber,
        court: summaryInfo.court,
        courtDivision: summaryInfo.courtDivision,
        courtDistrict: summaryInfo.courtDistrict
      }
    });
    
    this.trialId = trial.id;
    
    // Create judge
    if (summaryInfo.judge) {
      await this.prisma.judge.upsert({
        where: { trialId: trial.id },
        update: {
          name: summaryInfo.judge.name,
          title: summaryInfo.judge.title,
          honorific: summaryInfo.judge.honorific
        },
        create: {
          trialId: trial.id,
          name: summaryInfo.judge.name,
          title: summaryInfo.judge.title,
          honorific: summaryInfo.judge.honorific
        }
      });
    }
    
    // Create court reporter
    if (summaryInfo.courtReporter) {
      await this.prisma.courtReporter.upsert({
        where: { trialId: trial.id },
        update: {
          name: summaryInfo.courtReporter.name,
          credentials: summaryInfo.courtReporter.credentials,
          phone: summaryInfo.courtReporter.phone
        },
        create: {
          trialId: trial.id,
          name: summaryInfo.courtReporter.name,
          credentials: summaryInfo.courtReporter.credentials,
          phone: summaryInfo.courtReporter.phone
        }
      });
    }
    
    // Create attorneys
    await this.createAttorneys(trial.id, summaryInfo.plaintiffAttorneys, 'PLAINTIFF');
    await this.createAttorneys(trial.id, summaryInfo.defendantAttorneys, 'DEFENDANT');
  }

  private async createAttorneys(
    trialId: number, 
    attorneyInfos: any[], 
    role: 'PLAINTIFF' | 'DEFENDANT'
  ): Promise<void> {
    for (const attorneyInfo of attorneyInfos) {
      // First try to find existing attorney by name
      let attorney = await this.prisma.attorney.findFirst({
        where: { name: attorneyInfo.name }
      });
      
      // If not found, create new attorney
      if (!attorney) {
        attorney = await this.prisma.attorney.create({
          data: { name: attorneyInfo.name }
        });
      }
      
      // Create or get law firm
      let lawFirmId: number | null = null;
      if (attorneyInfo.lawFirm) {
        let lawFirm = await this.prisma.lawFirm.findFirst({
          where: { name: attorneyInfo.lawFirm.name }
        });
        
        if (!lawFirm) {
          let addressId: number | null = null;
          
          if (attorneyInfo.lawFirm.address) {
            const address = await this.prisma.address.create({
              data: attorneyInfo.lawFirm.address
            });
            addressId = address.id;
          }
          
          lawFirm = await this.prisma.lawFirm.create({
            data: {
              name: attorneyInfo.lawFirm.name,
              addressId
            }
          });
        }
        
        lawFirmId = lawFirm.id;
      }
      
      // Create trial attorney association
      await this.prisma.trialAttorney.upsert({
        where: {
          trialId_attorneyId: {
            trialId,
            attorneyId: attorney.id
          }
        },
        update: {
          role,
          lawFirmId
        },
        create: {
          trialId,
          attorneyId: attorney.id,
          role,
          lawFirmId
        }
      });
    }
  }

  private async createSession(sessionInfo: SessionInfo, fileName: string): Promise<any> {
    if (!this.trialId) {
      throw new Error('Trial ID not set');
    }
    
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
        documentNumber: sessionInfo.documentNumber
      },
      create: {
        trialId: this.trialId,
        sessionDate: sessionInfo.sessionDate,
        sessionType: sessionInfo.sessionType,
        fileName,
        documentNumber: sessionInfo.documentNumber
      }
    });
  }

  private logDirectoryStats(processingTime: number): void {
    const { totalFiles, totalLines, nonBlankLines, totalPages, errorFiles } = this.directoryStats;
    const blankLines = totalLines - nonBlankLines;
    const blankPercentage = totalLines > 0 ? ((blankLines / totalLines) * 100).toFixed(1) : '0';
    
    logger.info('\n' + '='.repeat(60));
    logger.info('📊 PHASE 1 PARSING COMPLETED');
    logger.info('='.repeat(60));
    logger.info(`⏱️  Total processing time: ${processingTime.toFixed(1)} seconds`);
    logger.info(`📁 Files processed: ${totalFiles}`);
    logger.info(`📄 Pages processed: ${totalPages.toLocaleString()}`);
    logger.info(`📝 Lines processed: ${totalLines.toLocaleString()}`);
    logger.info(`✅ Content lines: ${nonBlankLines.toLocaleString()}`);
    logger.info(`⚪ Blank lines: ${blankLines.toLocaleString()} (${blankPercentage}%)`);
    
    if (errorFiles.length > 0) {
      logger.warn(`⚠️  Files with errors: ${errorFiles.length}`);
      errorFiles.forEach(file => logger.warn(`   - ${file}`));
    }
    
    const avgLinesPerSecond = processingTime > 0 ? (totalLines / processingTime).toFixed(0) : '0';
    logger.info(`🚀 Processing speed: ${avgLinesPerSecond} lines/second`);
    logger.info('='.repeat(60));
  }
}