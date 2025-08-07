// src/parsers/phase1/TranscriptParser.ts
// src/parsers/TranscriptParser.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../../utils/logger';
import { 
  TranscriptConfig, 
  ParsedLine, 
  ParsedPage, 
  SessionInfo,
  TrialSummaryInfo,
  AttorneyInfo
} from '../../types/config.types';
import { SummaryPageParser } from './SummaryPageParser';
import { LineParser } from './LineParser';
import { PageHeaderParser } from './PageHeaderParser';

export class TranscriptParser {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private trialId?: number;
  
  constructor(config: TranscriptConfig) {
    this.prisma = new PrismaClient();
    this.config = config;
  }

  async parseDirectory(): Promise<void> {
    logger.info(`Starting Phase 1 parsing of directory: ${this.config.transcriptPath}`);
    
    try {
      // Get all transcript files
      const files = this.getTranscriptFiles();
      
      if (files.length === 0) {
        logger.warn('No transcript files found in directory');
        return;
      }
      
      // Sort files by date and session type
      const sortedFiles = this.sortFilesByDateAndSession(files);
      
      // Process each file
      for (const file of sortedFiles) {
        await this.parseTranscriptFile(file);
      }
      
      logger.info('Phase 1 parsing completed successfully');
    } catch (error) {
      logger.error('Error during Phase 1 parsing:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
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
    logger.info(`Parsing file: ${filename}`);
    
    const filePath = path.join(this.config.transcriptPath, filename);
    let content: string;
    
    if (this.config.format === 'pdf') {
      // TODO: Implement PDF extraction
      logger.warn('PDF extraction not yet implemented');
      return;
    } else {
      content = fs.readFileSync(filePath, 'utf-8');
    }
    
    // Parse the transcript content
    const lines = content.split(/\r?\n/);
    const pages = this.groupLinesIntoPages(lines);
    
    // Determine session info
    const sessionInfo = this.extractSessionInfo(filename, pages[0]);
    
    // Process first pages for trial summary if not already created
    if (!this.trialId && pages.length > 0) {
      const summaryInfo = await this.parseSummaryPages(pages.slice(0, 3));
      if (summaryInfo) {
        await this.createOrUpdateTrial(summaryInfo);
      }
    }
    
    // Create session
    const session = await this.createSession(sessionInfo, filename);
    
    // Parse and store pages
    for (let i = 0; i < pages.length; i++) {
      await this.parsePage(pages[i], session.id, i + 1);
    }
    
    logger.info(`Completed parsing file: ${filename}`);
  }

  private groupLinesIntoPages(lines: string[]): string[][] {
    const pages: string[][] = [];
    let currentPage: string[] = [];
    
    for (const line of lines) {
      // Check for page break indicators
      if (this.isPageBreak(line)) {
        if (currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
        }
      }
      currentPage.push(line);
    }
    
    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    
    return pages;
  }

  private isPageBreak(line: string): boolean {
    // Check for form feed character or page header pattern
    return line.includes('\f') || 
           /Case\s+[\d:cv-]+\s+Document\s+\d+/.test(line);
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

  private async parsePage(
    pageLines: string[], 
    sessionId: number, 
    pageNumber: number
  ): Promise<void> {
    const parser = new PageHeaderParser();
    const lineParser = new LineParser();
    
    // Parse page header if present
    const headerInfo = parser.parse(pageLines[0]);
    
    // Create page record
    const page = await this.prisma.page.create({
      data: {
        sessionId,
        pageNumber,
        totalSessionPages: headerInfo?.totalPages,
        transcriptPageNumber: headerInfo?.transcriptPageNumber,
        documentNumber: headerInfo?.documentNumber,
        pageId: headerInfo?.pageId,
        headerText: headerInfo?.fullText
      }
    });
    
    // Parse and store lines
    for (let i = 0; i < pageLines.length; i++) {
      const line = pageLines[i];
      
      // Skip header lines
      if (i === 0 && headerInfo) continue;
      
      const parsedLine = lineParser.parse(line);
      
      if (parsedLine) {
        await this.prisma.line.create({
          data: {
            pageId: page.id,
            lineNumber: parsedLine.lineNumber || i,
            timestamp: parsedLine.timestamp,
            text: parsedLine.text,
            speakerPrefix: parsedLine.speakerPrefix,
            isBlank: parsedLine.isBlank
          }
        });
      }
    }
  }
}
