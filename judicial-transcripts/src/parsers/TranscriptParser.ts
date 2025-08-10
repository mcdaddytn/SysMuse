// src/parsers/TranscriptParser.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LineParser } from './LineParser';
import { Phase2Processor } from './Phase2Processor';
import { AttorneyService } from '../services/AttorneyService';
import { 
  TranscriptConfig, 
  SessionInfo, 
  SummaryInfo,
  AttorneyInfo,
  AddressInfo
} from '../types/config.types';
import logger from '../utils/logger';

export class TranscriptParser {
  private prisma: PrismaClient;
  private config: TranscriptConfig;
  private lineParser: LineParser;
  private phase2Processor: Phase2Processor;
  private attorneyService: AttorneyService;
  private trialId?: number;
  
  // Statistics tracking
  private directoryStats = {
    totalFiles: 0,
    totalLines: 0,
    nonBlankLines: 0,
    totalPages: 0,
    errorFiles: [] as string[]
  };

  constructor(config: TranscriptConfig) {
    this.config = config;
    this.prisma = new PrismaClient();
    this.lineParser = new LineParser();
    this.phase2Processor = new Phase2Processor(config);
    this.attorneyService = new AttorneyService(this.prisma);
  }

  /**
   * Parse all transcript files in a directory
   */
  async parseDirectory(): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Get all text files in directory
      const files = await fs.readdir(this.config.inputDir);
      const textFiles = files.filter(f => f.endsWith('.txt')).sort();
      
      if (textFiles.length === 0) {
        logger.warn('No text files found in directory');
        return;
      }
      
      logger.info(`Found ${textFiles.length} text files to process`);
      
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
      
      // Run Phase 2 processing if trial was created
      if (this.trialId) {
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
    let sessionLineNumber = 0;
    let trialLineNumber = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Detect section changes
      if (line.includes('PROCEEDINGS')) {
        currentSection = 'PROCEEDINGS';
        continue;
      } else if (line.includes('REPORTER\'S CERTIFICATE')) {
        currentSection = 'CERTIFICATION';
        continue;
      }
      
      // Parse based on current section
      if (currentSection === 'UNKNOWN' && !summaryInfo) {
        // First section is usually summary
        currentSection = 'SUMMARY';
        summaryInfo = await this.parseSummarySection(lines, i);
        
        // Create or update trial
        if (summaryInfo) {
          await this.createOrUpdateTrial(summaryInfo);
        }
        
        // Extract session info
        sessionInfo = this.extractSessionInfo(lines, fileName);
        
        // Skip to end of summary
        i += 100; // Approximate, will be refined
        continue;
      }
      
      if (currentSection === 'PROCEEDINGS' && sessionInfo && this.trialId) {
        // Create session if needed
        if (!currentPage) {
          const session = await this.createSession(sessionInfo, fileName);
          currentPage = await this.createPage(session.id, ++pageNumber, currentSection);
        }
        
        // Check for page break
        if (this.isPageBreak(line)) {
          const pageInfo = this.extractPageInfo(lines, i);
          if (pageInfo) {
            currentPage = await this.createPage(
              currentPage.sessionId,
              ++pageNumber,
              currentSection,
              pageInfo
            );
          }
          i += 5; // Skip page header lines
          continue;
        }
        
        // Parse line
        const parsedLine = this.lineParser.parse(line);
        if (parsedLine) {
          sessionLineNumber++;
          trialLineNumber++;
          
          await this.prisma.line.create({
            data: {
              pageId: currentPage.id,
              lineNumber: parsedLine.lineNumber || sessionLineNumber,
              trialLineNumber,
              sessionLineNumber,
              timestamp: parsedLine.timestamp,
              text: parsedLine.text,
              speakerPrefix: parsedLine.speakerPrefix,
              isBlank: parsedLine.isBlank
            }
          });
          
          this.directoryStats.totalLines++;
          if (!parsedLine.isBlank) {
            this.directoryStats.nonBlankLines++;
          }
        }
      }
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
    
    for (const line of lines) {
      // Look for case number pattern
      if (line.match(/Case\s+(?:No\.|Number)?\s*([\d:\-CV]+)/i)) {
        const match = line.match(/Case\s+(?:No\.|Number)?\s*([\d:\-CV]+)/i);
        if (match) caseNumber = match[1];
      }
      
      // Look for vs. pattern for case name
      if (line.includes(' vs. ') || line.includes(' v. ')) {
        caseName = line.trim();
      }
      
      // Look for court information
      if (line.includes('UNITED STATES DISTRICT COURT')) {
        court = 'UNITED STATES DISTRICT COURT';
      }
      if (line.includes('DIVISION')) {
        courtDivision = line.trim();
      }
      if (line.includes('DISTRICT OF')) {
        courtDistrict = line.trim();
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
      if (line.includes('HONORABLE') || line.includes('JUDGE')) {
        const judgeName = line.replace(/HONORABLE|JUDGE|HON\./gi, '').trim();
        return {
          name: judgeName,
          title: 'JUDGE',
          honorific: 'HONORABLE'
        };
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
    let currentFirm: { name: string; office?: { name: string; address?: AddressInfo } } | null = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Detect section
      if (line.match(/FOR.*PLAINTIFF/i) || line.includes('Attorneys for Plaintiff')) {
        currentSection = 'plaintiff';
        continue;
      } else if (line.match(/FOR.*DEFENDANT/i) || line.includes('Attorneys for Defendant')) {
        currentSection = 'defendant';
        continue;
      }
      
      if (!currentSection) continue;
      
      // Parse attorney name (MR./MS./MRS./DR. pattern)
      const nameMatch = line.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+(.+)$/i);
      if (nameMatch) {
        const attorney: AttorneyInfo = {
          name: line,
          title: nameMatch[1].toUpperCase(),
          lastName: this.extractLastName(nameMatch[2]),
          speakerPrefix: `${nameMatch[1].toUpperCase()} ${this.extractLastName(nameMatch[2]).toUpperCase()}`
        };
        
        if (currentFirm) {
          attorney.lawFirm = currentFirm;
        }
        
        if (currentSection === 'plaintiff') {
          plaintiffAttorneys.push(attorney);
        } else {
          defendantAttorneys.push(attorney);
        }
        continue;
      }
      
      // Parse law firm
      if (line.length > 0 && !line.match(/^\d/) && !line.includes('@')) {
        // Check if this might be a law firm name
        if (line.includes('LLP') || line.includes('LLC') || line.includes('P.C.') || 
            line.includes('Law') || line.includes('Attorney')) {
          currentFirm = { name: line };
        } else if (currentFirm && !currentFirm.office) {
          // This might be address information
          const address = this.parseAddress(lines, i);
          if (address) {
            currentFirm.office = {
              name: address.city || 'Main Office',
              address
            };
            i += 3; // Skip address lines
          }
        }
      }
    }
    
    return { plaintiffAttorneys, defendantAttorneys };
  }

  /**
   * Extract last name from full name
   */
  private extractLastName(fullName: string): string {
    const parts = fullName.trim().split(/\s+/);
    return parts[parts.length - 1];
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
    
    for (const line of lines.slice(0, 50)) {
      // Look for date patterns
      const dateMatch = line.match(/(\w+\s+\d{1,2},\s+\d{4})/);
      if (dateMatch) {
        sessionDate = new Date(dateMatch[1]);
        break;
      }
    }
    
    // Determine session type from filename
    if (fileName.includes('Morning') || fileName.includes('AM')) {
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
      fileName
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
      // Create speaker for judge
      const judgeSpeaker = await this.prisma.speaker.upsert({
        where: {
          trialId_speakerPrefix: {
            trialId: trial.id,
            speakerPrefix: 'THE COURT'
          }
        },
        update: {},
        create: {
          trialId: trial.id,
          speakerPrefix: 'THE COURT',
          speakerType: 'JUDGE'
        }
      });
      
      await this.prisma.judge.upsert({
        where: { trialId: trial.id },
        update: {
          name: summaryInfo.judge.name,
          title: summaryInfo.judge.title,
          honorific: summaryInfo.judge.honorific,
          speakerId: judgeSpeaker.id
        },
        create: {
          trialId: trial.id,
          name: summaryInfo.judge.name,
          title: summaryInfo.judge.title,
          honorific: summaryInfo.judge.honorific,
          speakerId: judgeSpeaker.id
        }
      });
      
      logger.info(`Judge created/updated: ${summaryInfo.judge.name}`);
    }
    
    // Create court reporter
    if (summaryInfo.courtReporter) {
      let addressId: number | null = null;
      
      if (summaryInfo.courtReporter.address) {
        const address = await this.prisma.address.create({
          data: {
            ...summaryInfo.courtReporter.address,
            country: summaryInfo.courtReporter.address.country || 'USA'
          }
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
    
    return await this.prisma.page.create({
      data: {
        sessionId,
        pageNumber,
        documentSection: section as any,
        trialPageNumber: pageInfo?.trialPageNumber,
        pageId: pageInfo?.pageId,
        headerText: pageInfo?.headerText
      }
    });
  }

  /**
   * Check if line is a page break
   */
  private isPageBreak(line: string): boolean {
    return line.includes('PageID #:') || 
           !!line.match(/^\s*\d+\s*$/) || 
           line.includes('Page ') ||
           line.includes('- - -');
  }

  /**
   * Extract page information from header
   */
  private extractPageInfo(lines: string[], index: number): any {
    const pageInfo: any = {};
    
    // Look for PageID
    for (let i = index; i < Math.min(index + 5, lines.length); i++) {
      const line = lines[i];
      const pageIdMatch = line.match(/PageID\s*#:\s*(\d+)/);
      if (pageIdMatch) {
        pageInfo.pageId = pageIdMatch[1];
      }
      
      const pageNumMatch = line.match(/Page\s+(\d+)/);
      if (pageNumMatch) {
        pageInfo.trialPageNumber = parseInt(pageNumMatch[1]);
      }
    }
    
    return pageInfo;
  }

  /**
   * Log directory statistics
   */
  private logDirectoryStats(processingTime: number): void {
    const { totalFiles, totalLines, nonBlankLines, totalPages, errorFiles } = this.directoryStats;
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
    
    if (errorFiles.length > 0) {
      logger.warn(`⚠️  Files with errors: ${errorFiles.length}`);
      errorFiles.forEach(file => logger.warn(`   - ${file}`));
    }
    
    const avgLinesPerSecond = processingTime > 0 ? (totalLines / processingTime).toFixed(0) : '0';
    logger.info(`🚀 Processing speed: ${avgLinesPerSecond} lines/second`);
    logger.info('='.repeat(60));
  }
}