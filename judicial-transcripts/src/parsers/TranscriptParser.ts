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
    let session: any = null;
    let summaryProcessed = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Skip empty lines at the document level
      if (!trimmedLine && currentSection === 'UNKNOWN') {
        continue;
      }
      
      // Detect section changes - be more flexible with detection
      if (trimmedLine.includes('P R O C E E D I N G S') || 
          trimmedLine.includes('PROCEEDINGS') ||
          (trimmedLine.match(/^\d{2}:\d{2}:\d{2}/) && !summaryProcessed)) {
        // If we see a timestamp pattern, we're definitely in proceedings
        currentSection = 'PROCEEDINGS';
        //logger.info(`Detected PROCEEDINGS section at line ${i}`);
        
        // Create session if not already created
        if (!session && this.trialId) {
          if (!sessionInfo) {
            sessionInfo = this.extractSessionInfo(lines, fileName);
          }
          session = await this.createSession(sessionInfo, fileName);
          logger.info(`Created session: ${session.id}`);
        }
        
        // Create first page if needed
        if (!currentPage && session) {
          pageNumber++;
          currentPage = await this.createPage(session.id, pageNumber, currentSection);
          logger.info(`Created first page of PROCEEDINGS: ${currentPage.id}`);
        }
      } else if (trimmedLine.includes('REPORTER\'S CERTIFICATE') || 
                 trimmedLine.includes('CERTIFICATION')) {
        currentSection = 'CERTIFICATION';
        logger.info(`Detected CERTIFICATION section at line ${i}`);
        continue;
      }
      
      // Process summary section (first part of document)
      if (currentSection === 'UNKNOWN' && !summaryProcessed) {
        // Collect lines for summary parsing (first ~100 lines)
        if (i < 100) {
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
          
          // Reset index to process from where we detected proceedings
          i = 100; // Skip past summary
          continue;
        }
      }
      
      // Process PROCEEDINGS section
      if (currentSection === 'PROCEEDINGS' && this.trialId) {
        // Ensure we have a session
        if (!session) {
          if (!sessionInfo) {
            sessionInfo = this.extractSessionInfo(lines, fileName);
          }
          session = await this.createSession(sessionInfo, fileName);
          logger.info(`Created session: ${session.id}`);
        }
        
        // Check for page break
        if (this.isPageBreak(line)) {
          // Save current page and create new one
          if (currentPage) {
            logger.debug(`Page ${pageNumber} completed with ${sessionLineNumber} lines`);
          }
          
          pageNumber++;
          const pageInfo = this.extractPageInfo(lines, i);
          currentPage = await this.createPage(
            session.id,
            pageNumber,
            currentSection,
            pageInfo
          );
          
          // Skip page header lines
          i += this.getPageHeaderLineCount(lines, i);
          continue;
        }
        
        // Ensure we have a page
        if (!currentPage) {
          pageNumber++;
          currentPage = await this.createPage(session.id, pageNumber, currentSection);
          logger.info(`Created page ${pageNumber}`);
        }
        
        // Parse and store line (skip blank lines)
        const parsedLine = this.lineParser.parse(line);
        if (parsedLine && !parsedLine.isBlank) {  // Only store non-blank lines
          // Only increment line numbers for non-blank lines with content
          if (parsedLine.text || parsedLine.timestamp) {
            sessionLineNumber++;
            trialLineNumber++;
            
            await this.prisma.line.create({
              data: {
                pageId: currentPage.id,
                lineNumber: parsedLine.lineNumber || sessionLineNumber,
                trialLineNumber,
                sessionLineNumber,
                timestamp: parsedLine.timestamp || null,
                text: parsedLine.text || null,
                speakerPrefix: parsedLine.speakerPrefix || null,
                isBlank: false  // Always false since we're skipping blanks
              }
            });
            
            this.directoryStats.totalLines++;
            this.directoryStats.nonBlankLines++;
            
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
    
    logger.info(`File processing completed: ${fileName}`);
    logger.info(`  Total lines processed: ${sessionLineNumber}`);
    logger.info(`  Pages created: ${pageNumber}`);
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
      
      // Look for case number pattern - be more flexible
      const caseMatch = line.match(/(?:Case|CIVIL ACTION NO\.?)\s*([\d:\-CVcv]+)/i);
      if (caseMatch && !caseNumber) {
        caseNumber = caseMatch[1].toUpperCase();
      }
      
      // Look for vs. pattern for case name
      if ((line.includes(' vs. ') || line.includes(' v. ') || line.includes(' VS. ')) && !caseName) {
        caseName = line.trim()
          .replace(/[)(]/g, '') // Remove parentheses
          .replace(/\s+/g, ' ') // Normalize spaces
          .trim();
      }
      
      // Look for plaintiff/defendant pattern for case name
      if (!caseName && line.includes('PLAINTIFF') && i < lines.length - 5) {
        // Look for pattern like "VOCALIFE LLC," as plaintiff
        const plaintiffMatch = line.match(/^([A-Z][A-Z\s,\.&]+?),?\s*\)?\(?\s*$/);
        if (plaintiffMatch) {
          const plaintiff = plaintiffMatch[1].trim();
          // Look for defendant in next few lines
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            if (lines[j].includes('DEFENDANT')) {
              const defendantMatch = lines[j - 1].match(/^([A-Z][A-Z\s,\.&]+?),?\s*\)?\(?\s*$/);
              if (defendantMatch) {
                const defendant = defendantMatch[1].trim();
                caseName = `${plaintiff} v. ${defendant}`;
                break;
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
      
      // Parse attorney name (MR./MS./MRS./DR. pattern)
      // Look for patterns with multiple spaces or at line start
      const nameMatch = cleanLine.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z][A-Z\s\.,]+?)(?:\s{2,}|$)/i);
      if (nameMatch) {
        // Save previous attorney if exists
        if (currentAttorney) {
          if (currentSection === 'plaintiff') {
            plaintiffAttorneys.push(currentAttorney);
          } else {
            defendantAttorneys.push(currentAttorney);
          }
        }
        
        // Extract full name and last name
        const title = nameMatch[1].toUpperCase();
        const fullNamePart = nameMatch[2].trim();
        
        // Handle multi-part names (e.g., "JENNIFER L. TRUELOVE")
        const nameParts = fullNamePart.split(/\s+/);
        const lastName = nameParts[nameParts.length - 1].toUpperCase();
        
        // Create new attorney
        currentAttorney = {
          name: `${title} ${fullNamePart}`,
          title: title,
          lastName: lastName,
          speakerPrefix: `${title} ${lastName}`
        };
        
        if (currentFirm) {
          currentAttorney.lawFirm = { ...currentFirm };
        }
        
        logger.debug(`Found attorney: ${currentAttorney.name} (${currentSection}) - Speaker: ${currentAttorney.speakerPrefix}`);
        
        // Reset for next attorney
        addressLines = [];
        continue;
      }
      
      // Check if this is a law firm name (contains legal entity markers)
      if (cleanLine.length > 0 && 
          (cleanLine.includes('LLP') || cleanLine.includes('LLC') || cleanLine.includes('P.C.') || 
           cleanLine.includes('LAW') || cleanLine.includes('FIRM') || cleanLine.includes('SMITH'))) {
        
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
   * Get number of lines in page header to skip
   */
  private getPageHeaderLineCount(lines: string[], index: number): number {
    let headerLines = 0;
    
    // Check next few lines for header pattern
    for (let i = index; i < Math.min(index + 10, lines.length); i++) {
      const line = lines[i].trim();
      
      // Page headers usually contain:
      // - Case number line
      // - PageID line
      // - Page number line
      // - Blank lines
      // - Sometimes date/time info
      
      if (line.includes('Case') || 
          line.includes('PageID') || 
          line.match(/^\d+$/) ||
          line.includes('Document') ||
          line === '' ||
          line.includes('Page ')) {
        headerLines++;
      } else if (line.match(/^\d{2}:\d{2}:\d{2}/)) {
        // Found first content line with timestamp
        break;
      } else if (headerLines > 0) {
        // We've seen header lines and now hit content
        break;
      }
    }
    
    return Math.max(headerLines, 3); // Skip at least 3 lines for safety
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