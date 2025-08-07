// src/parsers/phase1/TranscriptParser.ts
// src/parsers/TranscriptParser.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
//import logger from '../../utils/logger';
import logger from '../utils/logger';
//gm: workaround (or can change tsconfig.json "noUnusedLocals": false)
import { 
  TranscriptConfig, 
  SessionInfo,
  TrialSummaryInfo,
  AttorneyInfo
} from '../types/config.types';
//import { 
//  TranscriptConfig, 
//  ParsedLine, 
//  ParsedPage, 
//  SessionInfo,
//  TrialSummaryInfo,
//  AttorneyInfo
//} from '../../types/config.types';
import { SummaryPageParser } from './SummaryPageParser';
import { LineParser } from './LineParser';
import { PageHeaderParser } from './PageHeaderParser';

export class TranscriptParser {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private trialId?: number;
  private directoryStats: { totalLines: number; nonBlankLines: number } = { totalLines: 0, nonBlankLines: 0 }; // ADD THIS LINE
  
  constructor(config: TranscriptConfig) {
    this.prisma = new PrismaClient();
    this.config = config;
  }

  async parseDirectory(): Promise<void> {
    const startTime = Date.now();
    logger.info(`🚀 Starting Phase 1 parsing of directory: ${this.config.transcriptPath}`);
    
    const files = this.getTranscriptFiles();
    logger.info(`📁 Found ${files.length} transcript files to process`);
    
    // Reset directory stats
    this.directoryStats = { totalLines: 0, nonBlankLines: 0 };
    
    for (let i = 0; i < files.length; i++) {
      const filename = files[i];
      logger.info(`\n📄 File ${i + 1}/${files.length}: ${filename}`);
      await this.parseTranscriptFile(filename);
    }
    
    const totalTime = (Date.now() - startTime) / 1000;
    const directoryBlankLines = this.directoryStats.totalLines - this.directoryStats.nonBlankLines;
    const directoryBlankPercentage = this.directoryStats.totalLines > 0 ? 
      ((directoryBlankLines / this.directoryStats.totalLines) * 100).toFixed(1) : '0';
    
    // Get final database statistics
    const totalLinesInDb = await this.prisma.line.count();
    const blankLinesInDb = await this.prisma.line.count({
      where: { isBlank: true }
    });
    const contentLinesInDb = totalLinesInDb - blankLinesInDb;
    
    logger.info(`\n🎉 PHASE 1 PARSING COMPLETED!`);
    logger.info(`📁 Directory Summary:`);
    logger.info(`   - Files processed: ${files.length}`);
    logger.info(`   - Processing time: ${totalTime.toFixed(1)}s`);
    logger.info(`📊 Line Statistics:`);
    logger.info(`   - Total lines processed: ${this.directoryStats.totalLines.toLocaleString()}`);
    logger.info(`   - Content lines: ${this.directoryStats.nonBlankLines.toLocaleString()}`);
    logger.info(`   - Blank lines: ${directoryBlankLines.toLocaleString()} (${directoryBlankPercentage}%)`);
    logger.info(`💾 Database Statistics:`);
    logger.info(`   - Lines stored: ${totalLinesInDb.toLocaleString()}`);
    logger.info(`   - Content lines stored: ${contentLinesInDb.toLocaleString()}`);
    logger.info(`   - Blank lines stored: ${blankLinesInDb.toLocaleString()}`);
    if (this.config.parsingOptions?.ignoreBlankLines) {
      logger.info(`   ✅ Blank lines were filtered out as configured`);
    }
  }

  private getTranscriptFiles(): string[] {
    const files = fs.readdirSync(this.config.transcriptPath);
    
    if (this.config.format === 'pdf') {
      return files.filter(f => f.endsWith('.pdf'));
    } else {
      return files.filter(f => f.endsWith('.txt'));
    }
  }

  private sortFilesByDateAndSession(files: string[]): string[] {
    return files.sort((a, b) => {
      // Extract date from filename (assuming format includes date)
      const dateA = this.extractDateFromFilename(a);
      const dateB = this.extractDateFromFilename(b);
      
      if (dateA && dateB) {
        const diff = dateA.getTime() - dateB.getTime();
        if (diff !== 0) return diff;
      }
      
      // If same date, morning comes before afternoon
      const isMorningA = /morning/i.test(a);
      const isMorningB = /morning/i.test(b);
      
      if (isMorningA && !isMorningB) return -1;
      if (!isMorningA && isMorningB) return 1;
      
      // Default alphabetical sort
      return a.localeCompare(b);
    });
  }

  private extractDateFromFilename(filename: string): Date | null {
    // Try to extract date from patterns like "10_1_20" or "10/1/20"
    const dateMatch = filename.match(/(\d{1,2})[_\/](\d{1,2})[_\/](\d{2,4})/);
    
    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      let year = parseInt(dateMatch[3]);
      
      // Convert 2-digit year to 4-digit
      if (year < 100) {
        year += 2000;
      }
      
      return new Date(year, month - 1, day);
    }
    
    return null;
  }

  private async parseTranscriptFile(filename: string): Promise<void> {
    const fileStartTime = Date.now();
    logger.info(`📄 Processing file: ${filename}`);
    
    const filePath = path.join(this.config.transcriptPath, filename);
    let content: string;
    
    if (this.config.format === 'pdf') {
      logger.warn('PDF extraction not yet implemented');
      return;
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
    }
    
    // Parse the transcript content
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
    
    // Track session statistics
    let sessionTotalLines = 0;
    let sessionNonBlankLines = 0;
    
    // Parse and store pages with progress tracking
    logger.info(`   🔄 Processing ${pages.length} pages...`);
    for (let i = 0; i < pages.length; i++) {
      const pageStats = await this.parsePage(pages[i], session.id, i + 1);
      sessionTotalLines += pageStats.totalLines;
      sessionNonBlankLines += pageStats.nonBlankLines;
      
      // Show progress for large files
      if (pages.length > 50 && (i + 1) % 25 === 0) {
        const progress = ((i + 1) / pages.length * 100).toFixed(1);
        logger.info(`   📈 Progress: ${i + 1}/${pages.length} pages (${progress}%)`);
      }
    }
    
    const sessionBlankLines = sessionTotalLines - sessionNonBlankLines;
    const blankPercentage = sessionTotalLines > 0 ? ((sessionBlankLines / sessionTotalLines) * 100).toFixed(1) : '0';
    const fileTime = (Date.now() - fileStartTime) / 1000;
    
    // Update directory stats
    this.directoryStats.totalLines += sessionTotalLines;
    this.directoryStats.nonBlankLines += sessionNonBlankLines;
    
    logger.info(`   ✅ File completed in ${fileTime.toFixed(1)}s`);
    logger.info(`   📊 File stats: ${sessionTotalLines.toLocaleString()} total, ${sessionNonBlankLines.toLocaleString()} content, ${sessionBlankLines.toLocaleString()} blank (${blankPercentage}%)`);
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
    
    // Try to extract document number from first page
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
        courtDivision: summaryInfo.courtDivision
      },
      create: {
        name: summaryInfo.trialName,
        caseNumber: summaryInfo.caseNumber,
        court: summaryInfo.court,
        courtDivision: summaryInfo.courtDivision
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
    
    // Create attorneys and law firms
    await this.createAttorneys(summaryInfo.plaintiffAttorneys, 'PLAINTIFF', trial.id);
    await this.createAttorneys(summaryInfo.defendantAttorneys, 'DEFENDANT', trial.id);
    
    // Create court reporter if present
    if (summaryInfo.courtReporter) {
      let addressId: number | null = null;
      
      if (summaryInfo.courtReporter.address) {
        const address = await this.prisma.address.create({
          data: summaryInfo.courtReporter.address
        });
        addressId = address.id;
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
      });
    }
  }

  private async createAttorneys(
    attorneys: AttorneyInfo[], 
    role: 'PLAINTIFF' | 'DEFENDANT',
    trialId: number
  ): Promise<void> {
    for (const attorneyInfo of attorneys) {
      // Create or get attorney
      let attorney = await this.prisma.attorney.findFirst({
        where: { name: attorneyInfo.name }
      });
      
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
  
  private async debugSummaryParsing(pages: string[][]): Promise<void> {
    logger.info('=== DEBUG: Summary Parsing ===');
    logger.info(`Total pages for summary: ${pages.length}`);
    
    if (pages.length > 0) {
      logger.info('First page lines count:', pages[0].length);
      logger.info('First page first 10 lines:');
      pages[0].slice(0, 10).forEach((line, i) => {
        logger.info(`Line ${i}: "${line}"`);
      });
    }
    
    if (pages.length > 1) {
      logger.info('Second page lines count:', pages[1].length);
      logger.info('Second page first 10 lines:');
      pages[1].slice(0, 10).forEach((line, i) => {
        logger.info(`Line ${i}: "${line}"`);
      });
    }
    
    // Test the parser
    const parser = new SummaryPageParser();
    const result = parser.parse(pages);
    
    if (result) {
      logger.info('Summary parsing SUCCESS:', JSON.stringify(result, null, 2));
    } else {
      logger.error('Summary parsing FAILED - no result returned');
    }
  }  

  private async parsePage(
    pageLines: string[], 
    sessionId: number, 
    pageNumber: number
  ): Promise<{ totalLines: number, nonBlankLines: number }> {
    const parser = new PageHeaderParser();
    const lineParser = new LineParser();
    
    // Parse page header if present
    const headerInfo = parser.parse(pageLines[0]);
    
    // Use upsert for page to handle duplicates
    const page = await this.prisma.page.upsert({
      where: {
        sessionId_pageNumber: {
          sessionId,
          pageNumber
        }
      },
      update: {
        totalSessionPages: headerInfo?.totalPages,
        transcriptPageNumber: headerInfo?.transcriptPageNumber,
        documentNumber: headerInfo?.documentNumber,
        pageId: headerInfo?.pageId,
        headerText: headerInfo?.fullText
      },
      create: {
        sessionId,
        pageNumber,
        totalSessionPages: headerInfo?.totalPages,
        transcriptPageNumber: headerInfo?.transcriptPageNumber,
        documentNumber: headerInfo?.documentNumber,
        pageId: headerInfo?.pageId,
        headerText: headerInfo?.fullText
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
    
    for (let i = 0; i < pageLines.length; i++) {
      const line = pageLines[i];
      totalLines++;
      
      // Skip header lines
      if (i === 0 && headerInfo) continue;
      
      const parsedLine = lineParser.parse(line);
      
      if (parsedLine) {
        // Count blank lines but skip storing them if configured to ignore
        if (parsedLine.isBlank) {
          blankLines++;
          if (this.config.parsingOptions?.ignoreBlankLines) {
            continue; // Skip storing blank lines
          }
        }
        
        linesToInsert.push({
          pageId: page.id,
          lineNumber: sequentialLineNumber++,
          timestamp: parsedLine.timestamp,
          text: parsedLine.text,
          speakerPrefix: parsedLine.speakerPrefix,
          isBlank: parsedLine.isBlank
        });
      }
    }
    
    // Batch insert all lines at once
    if (linesToInsert.length > 0) {
      await this.prisma.line.createMany({
        data: linesToInsert
      });
    }
    
    const nonBlankLines = totalLines - blankLines;
    
    // Log progress every 10 pages or for first 5 pages
    if (pageNumber % 10 === 0 || pageNumber <= 5) {
      logger.info(`   Page ${pageNumber}: ${totalLines} total, ${nonBlankLines} content, ${blankLines} blank (stored: ${linesToInsert.length})`);
    }
    
    return { totalLines, nonBlankLines };
  }

}
