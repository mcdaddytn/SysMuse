import { PrismaClient, Prisma, SpeakerType } from '@prisma/client';
import { Logger } from '../utils/logger';
import {
  ParsedMetadata,
  StructureAnalysis,
  DocumentSection,
  SectionBoundary
} from './MultiPassTypes';
import { SessionSectionParser } from './SessionSectionParser';
import { SpeakerRegistry } from '../services/SpeakerRegistry';
import { ExaminationContextManager } from '../services/ExaminationContextManager';
import { MultiTrialSpeakerService } from '../services/MultiTrialSpeakerService';
import { SummaryPageParser } from './SummaryPageParser';
import { AttorneyService } from '../services/AttorneyService';

export class ContentParser {
  private prisma: PrismaClient;
  private logger: Logger;
  private sessionSectionParser: SessionSectionParser;
  private speakerRegistry: SpeakerRegistry | null = null;
  private examinationContext: ExaminationContextManager | null = null;
  private speakerService: MultiTrialSpeakerService | null = null;
  
  // Court official handles that are exact matches
  private readonly COURT_OFFICIALS: { [key: string]: SpeakerType } = {
    'THE COURT': 'JUDGE',
    'THE WITNESS': 'WITNESS',
    'THE CLERK': 'ANONYMOUS',
    'THE BAILIFF': 'ANONYMOUS',
    'THE COURT REPORTER': 'ANONYMOUS',
    'COURTROOM DEPUTY': 'ANONYMOUS',
    'COURT SECURITY OFFICER': 'ANONYMOUS'
  };
  
  private readonly EXAMINATION_PATTERNS = [
    /DIRECT EXAMINATION/i,
    /CROSS[- ]EXAMINATION/i,
    /REDIRECT EXAMINATION/i,
    /RECROSS[- ]EXAMINATION/i,
    /VOIR DIRE EXAMINATION/i,
    /EXAMINATION CONTINUED/i
  ];

  private summaryParser: SummaryPageParser;
  private attorneyService: AttorneyService;
  
  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
    this.sessionSectionParser = new SessionSectionParser(prisma);
    this.summaryParser = new SummaryPageParser();
    this.attorneyService = new AttorneyService(prisma);
  }

  async parseContent(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    sessionId: number,
    trialId: number,
    batchSize: number = 1000
  ): Promise<void> {
    this.logger.info('Starting content parsing (Pass 3) - Phase 1: Basic extraction only');
    
    // Phase 1: Skip speaker service initialization
    // Phase 2 will handle speaker resolution and examination context
    // await this.initializeSpeakerServices(trialId);
    
    // Phase 1: Skip summary speaker parsing
    // Phase 2 will extract attorneys, judge, etc.
    // await this.parseSummaryForSpeakers(metadata, structure, trialId);
    
    // Update session with metadata (totalPages, transcriptStartPage)
    await this.updateSessionMetadata(metadata, sessionId, trialId);
    
    await this.createPages(metadata, sessionId, trialId);
    
    const lineBatches = this.createLineBatches(metadata, structure, batchSize);
    
    this.logger.info(`Processing ${metadata.lines.size} lines in ${lineBatches.length} batches of ${batchSize}`);
    
    for (let i = 0; i < lineBatches.length; i++) {
      await this.processLineBatch(
        lineBatches[i],
        metadata,
        structure,
        sessionId,
        trialId
      );
      
      if ((i + 1) % 10 === 0 || i === lineBatches.length - 1) {
        this.logger.debug(`Processed batch ${i + 1}/${lineBatches.length} (${Math.min((i + 1) * batchSize, metadata.lines.size)} lines)`);
      }
    }
    
    await this.processSessionSections(metadata, structure, sessionId, trialId);
    
    // Extract and update Trial metadata from SessionSections  
    await this.updateTrialMetadataFromSections(trialId);
    
    // Phase 1: Skip speaker statistics - Phase 2 will handle speaker resolution
    
    this.logger.info(`Content parsing complete: ${metadata.lines.size} lines processed`);
  }
  
  private async initializeSpeakerServices(trialId: number): Promise<void> {
    this.logger.info(`Initializing speaker services for trial ${trialId}`);
    
    this.speakerService = new MultiTrialSpeakerService(this.prisma, trialId);
    this.speakerRegistry = new SpeakerRegistry(this.prisma, trialId);
    await this.speakerRegistry.initialize();
    
    this.examinationContext = new ExaminationContextManager(this.speakerRegistry);
  }
  
  private async parseSummaryForSpeakers(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    trialId: number
  ): Promise<void> {
    if (!this.speakerService) return;
    
    this.logger.info('Parsing summary section for court participants');
    
    // Find summary section
    const summarySection = structure.sections.find(s => s.section === DocumentSection.SUMMARY);
    if (!summarySection) {
      this.logger.warn('No summary section found for speaker extraction');
      return;
    }
    
    // Extract lines from summary section organized by pages for SummaryPageParser
    const summaryPages: string[][] = [];
    let currentPage: string[] = [];
    let lastPageNumber: number | undefined;
    
    for (let i = summarySection.startLine; i <= summarySection.endLine; i++) {
      const line = metadata.lines.get(i);
      if (line) {
        // Get page number from DocumentLocation
        const location = metadata.fileLineMapping.get(i);
        const pageNumber = location?.pageNumber;
        
        // Check if this is a new page
        if (pageNumber && lastPageNumber && pageNumber !== lastPageNumber) {
          if (currentPage.length > 0) {
            summaryPages.push(currentPage);
            currentPage = [];
          }
        }
        if (line.cleanText) {
          currentPage.push(line.cleanText);
        }
        lastPageNumber = pageNumber;
      }
    }
    
    // Add the last page
    if (currentPage.length > 0) {
      summaryPages.push(currentPage);
    }
    
    // Use SummaryPageParser to extract detailed information including law firms
    const summaryInfo = this.summaryParser.parse(summaryPages);
    
    if (summaryInfo) {
      this.logger.info('Using SummaryPageParser results with law firm information');
      
      // Create attorneys with law firm information
      for (const attorneyInfo of summaryInfo.plaintiffAttorneys) {
        await this.attorneyService.createOrUpdateAttorney(trialId, attorneyInfo, 'PLAINTIFF');
        
        // Extract speaker prefix for registry
        const nameMatch = attorneyInfo.name.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+(.+)$/);
        if (nameMatch && this.speakerRegistry) {
          const title = nameMatch[1];
          const fullName = nameMatch[2];
          const nameParts = fullName.split(/\s+/);
          let lastName = nameParts[nameParts.length - 1];
          
          // Handle suffixes
          if (lastName.match(/^(III|II|IV|V|JR\.?|SR\.?)$/i) && nameParts.length > 1) {
            lastName = nameParts[nameParts.length - 2];
          }
          
          const speakerPrefix = `${title} ${lastName}`.toUpperCase();
          await this.speakerRegistry.registerAttorney(speakerPrefix, attorneyInfo.name);
        }
      }
      this.logger.info(`Created ${summaryInfo.plaintiffAttorneys.length} plaintiff attorneys with law firm info`);
      
      for (const attorneyInfo of summaryInfo.defendantAttorneys) {
        await this.attorneyService.createOrUpdateAttorney(trialId, attorneyInfo, 'DEFENDANT');
        
        // Extract speaker prefix for registry
        const nameMatch = attorneyInfo.name.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+(.+)$/);
        if (nameMatch && this.speakerRegistry) {
          const title = nameMatch[1];
          const fullName = nameMatch[2];
          const nameParts = fullName.split(/\s+/);
          let lastName = nameParts[nameParts.length - 1];
          
          // Handle suffixes
          if (lastName.match(/^(III|II|IV|V|JR\.?|SR\.?)$/i) && nameParts.length > 1) {
            lastName = nameParts[nameParts.length - 2];
          }
          
          const speakerPrefix = `${title} ${lastName}`.toUpperCase();
          await this.speakerRegistry.registerAttorney(speakerPrefix, attorneyInfo.name);
        }
      }
      this.logger.info(`Created ${summaryInfo.defendantAttorneys.length} defendant attorneys with law firm info`);
      
      // Parse judge
      if (summaryInfo.judge) {
        await this.parseJudgeFromSummaryInfo(summaryInfo.judge, trialId);
      }
    } else {
      // Fallback to original parsing if SummaryPageParser fails
      this.logger.warn('SummaryPageParser failed, falling back to simple parsing');
      const summaryLines: string[] = [];
      for (let i = summarySection.startLine; i <= summarySection.endLine; i++) {
        const line = metadata.lines.get(i);
        if (line?.cleanText) {
          summaryLines.push(line.cleanText);
        }
      }
      await this.parseAttorneysFromSummary(summaryLines, trialId);
      await this.parseJudgeFromSummary(summaryLines, trialId);
    }
  }
  
  private async parseAttorneysFromSummary(
    lines: string[],
    trialId: number
  ): Promise<void> {
    if (!this.speakerService) return;
    
    // Look for the sections that start with "FOR THE PLAINTIFF:" or "FOR THE DEFENDANT:"
    // These are section headers, NOT speakers
    let currentRole: 'PLAINTIFF' | 'DEFENDANT' | null = null;
    let inAttorneySection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for role markers - these are section headers, NOT speakers
      if (line === 'FOR THE PLAINTIFF:' || line.startsWith('FOR THE PLAINTIFF:')) {
        currentRole = 'PLAINTIFF';
        inAttorneySection = true;
        continue;
      }
      if (line === 'FOR THE DEFENDANT:' || line === 'FOR THE DEFENDANTS:' || 
          line.startsWith('FOR THE DEFENDANT:') || line.startsWith('FOR THE DEFENDANTS:')) {
        currentRole = 'DEFENDANT';
        inAttorneySection = true;
        continue;
      }
      
      // Stop at next major section
      if (line.includes('BEFORE THE HONORABLE') || line.includes('COURT REPORTER') || 
          line.includes('OFFICIAL COURT REPORTER')) {
        inAttorneySection = false;
        continue;
      }
      
      // Skip empty lines
      if (!line || line.length === 0) continue;
      
      // Parse attorney name if we're in an attorney section
      if (inAttorneySection && currentRole) {
        // Match attorney names with titles (MR., MS., MRS., DR.)
        const attorneyMatch = line.match(/^(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z][A-Z\s\.',-]+?)(?:\s*$|,)/i);
        if (attorneyMatch) {
          const title = attorneyMatch[1].toUpperCase();
          const fullName = attorneyMatch[2].trim();
          
          // Extract last name (handle names like "RUBINO, III")
          const nameParts = fullName.split(/\s+/);
          let lastName = nameParts[nameParts.length - 1];
          
          // Handle suffixes like III, Jr., Sr.
          if (lastName.match(/^(III|II|IV|V|JR\.?|SR\.?)$/i) && nameParts.length > 1) {
            lastName = nameParts[nameParts.length - 2];
          }
          
          this.logger.debug(`Creating attorney: ${fullName} (${title} ${lastName}) for ${currentRole}`);
          
          await this.speakerService.createAttorneyWithSpeaker({
            name: fullName,
            title,
            lastName,
            speakerPrefix: `${title} ${lastName}`.toUpperCase(),
            role: currentRole
          });
          
          this.logger.info(`Created attorney: ${fullName} for ${currentRole}`);
          
          // Also register in speaker registry for quick lookup
          if (this.speakerRegistry) {
            await this.speakerRegistry.registerAttorney(`${title} ${lastName}`.toUpperCase(), fullName);
          }
        }
      }
    }
  }
  
  private async parseJudgeFromSummaryInfo(
    judgeInfo: { name: string; title?: string; honorific?: string },
    trialId: number
  ): Promise<void> {
    if (!this.speakerService) return;
    
    this.logger.debug(`Creating judge from SummaryPageParser: ${judgeInfo.name}`);
    
    await this.speakerService.createJudgeWithSpeaker(
      judgeInfo.name,
      judgeInfo.title || 'UNITED STATES DISTRICT JUDGE',
      judgeInfo.honorific || 'HONORABLE'
    );
    
    this.logger.info(`Created judge: ${judgeInfo.name}`);
  }
  
  private async parseJudgeFromSummary(
    lines: string[],
    trialId: number
  ): Promise<void> {
    if (!this.speakerService) return;
    
    for (const line of lines) {
      // Look for BEFORE THE HONORABLE pattern
      if (line.includes('BEFORE THE HONORABLE')) {
        const match = line.match(/BEFORE THE HONORABLE(?:\s+JUDGE)?\s+([A-Z][A-Z\s]+?)(?:\s+UNITED|\s*$)/i);
        if (match) {
          const judgeName = match[1].trim()
            .replace(/\s+/g, ' ')
            .replace(/JUDGE\s*/i, '');
          
          await this.speakerService.createJudgeWithSpeaker(
            judgeName,
            'JUDGE',
            'HONORABLE'
          );
          
          this.logger.info(`Created judge: ${judgeName}`);
          break;
        }
      }
    }
  }
  
  private async updateSessionMetadata(
    metadata: ParsedMetadata,
    sessionId: number,
    trialId: number
  ): Promise<void> {
    const totalPages = metadata.pages.size;
    
    // Calculate transcriptStartPage based on previous sessions
    const previousSessions = await this.prisma.session.findMany({
      where: { 
        trialId,
        id: { lt: sessionId }  // Sessions before this one
      },
      orderBy: { id: 'asc' }
    });
    
    let transcriptStartPage = 1;
    for (const prevSession of previousSessions) {
      if (prevSession.totalPages) {
        transcriptStartPage += prevSession.totalPages;
      }
    }
    
    // Extract document number from first page header if available
    let documentNumber: number | undefined;
    const firstPage = metadata.pages.get(1);
    if (firstPage?.headerText) {
      const docMatch = firstPage.headerText.match(/Document\s+(\d+)/);
      if (docMatch) {
        documentNumber = parseInt(docMatch[1]);
      }
    }
    
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        totalPages,
        transcriptStartPage,
        documentNumber
      }
    });
    
    const transcriptEndPage = transcriptStartPage + totalPages - 1;
    this.logger.debug(`Updated session ${sessionId}: pages ${transcriptStartPage}-${transcriptEndPage} (${totalPages} total)`);
  }

  private async createPages(
    metadata: ParsedMetadata,
    sessionId: number,
    trialId: number
  ): Promise<void> {
    const pageData: Prisma.PageCreateManyInput[] = [];
    
    for (const [pageNum, page] of metadata.pages) {
      pageData.push({
        sessionId,
        pageNumber: page.pageNumber,
        trialPageNumber: page.trialPageNumber,
        parsedTrialPage: page.parsedTrialPage,
        pageId: page.pageId,
        headerText: page.headerText,
        createdAt: new Date()
      });
    }
    
    if (pageData.length > 0) {
      await this.prisma.page.createMany({
        data: pageData,
        skipDuplicates: true
      });
      
      this.logger.debug(`Created ${pageData.length} pages`);
    }
  }

  private createLineBatches(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    batchSize: number
  ): Array<Array<[number, any]>> {
    const allLines = Array.from(metadata.lines.entries());
    const batches: Array<Array<[number, any]>> = [];
    
    for (let i = 0; i < allLines.length; i += batchSize) {
      batches.push(allLines.slice(i, i + batchSize));
    }
    
    return batches;
  }

  private async processLineBatch(
    batch: Array<[number, any]>,
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    sessionId: number,
    trialId: number
  ): Promise<void> {
    const lineData: Prisma.LineCreateManyInput[] = [];
    const statementEvents: any[] = [];
    
    const pages = await this.prisma.page.findMany({
      where: { sessionId },
      orderBy: { pageNumber: 'asc' }
    });
    
    const pageMap = new Map(pages.map(p => [p.pageNumber, p.id]));
    
    for (const [lineNum, line] of batch) {
      const location = metadata.fileLineMapping.get(line.fileLineNumber);
      const section = structure.sectionMapping.get(lineNum) || DocumentSection.UNKNOWN;
      
      if (!location) {
        this.logger.warn(`No location found for line ${lineNum} (fileLineNumber: ${line.fileLineNumber})`);
        continue;
      }
      
      const pageId = pageMap.get(location.pageNumber);
      if (!pageId) {
        this.logger.warn(`Page ${location.pageNumber} not found for line ${lineNum}`);
        continue;
      }
      
      // Skip blank lines - don't persist them
      if (!line.cleanText || line.cleanText.trim() === '') {
        continue;
      }
      
      // Phase 1: Skip examination context update
      // Phase 2 will handle examination context
      
      // Extract speaker with enhanced identification
      const speakerInfo = await this.identifySpeaker(line.cleanText, lineNum);
      const isExamination = this.isExaminationLine(line.cleanText);
      
      lineData.push({
        pageId,
        lineNumber: lineNum + 1,
        trialLineNumber: lineNum + 1,
        linePrefix: line.prefix,
        text: line.cleanText,
        timestamp: line.timestamp,
        documentSection: section,
        speakerPrefix: speakerInfo?.prefix,
        createdAt: new Date()
      });
      
      // Create statement event if we have a speaker and are in PROCEEDINGS
      // Note: We'll need to create these properly in Phase 2 with TrialEvents
      // For now, just skip statement events in the multi-pass parser
      // as they should be created in Phase 2 processing
    }
    
    if (lineData.length > 0) {
      this.logger.debug(`Creating ${lineData.length} lines in database for batch`);
      await this.prisma.line.createMany({
        data: lineData,
        skipDuplicates: true
      });
    }
    
    // Statement events will be created in Phase 2 when TrialEvents are properly created
  }
  
  private async identifySpeaker(
    text: string,
    lineNumber: number
  ): Promise<{ prefix: string; type: string; speaker?: any } | null> {
    // Phase 1: Only extract basic speaker prefixes, no resolution
    // Q&A resolution and examination context should be handled in Phase 2
    return this.extractSpeaker(text);
  }
  
  private mapToSpeakerType(type: string): SpeakerType {
    switch (type) {
      case 'ATTORNEY':
        return 'ATTORNEY';
      case 'JUDGE':
      case 'COURT':
        return 'JUDGE';
      case 'WITNESS':
        return 'WITNESS';
      case 'JUROR':
        return 'JUROR';
      default:
        return 'UNKNOWN';
    }
  }

  private extractSpeaker(text: string): { prefix: string; type: string } | null {
    // Strict speaker identification using EXACT string matching
    // No regular expressions - only exact matches
    
    if (!text || text.length === 0) return null;
    
    // Must start at position 0 (no leading whitespace)
    if (text[0] === ' ' || text[0] === '\t') return null;
    
    // Check for Q. and A. patterns (exact matches only)
    // Phase 1: Store raw Q. and A. prefixes without resolution
    // Phase 2 will handle examination context and speaker resolution
    if (text === 'Q.' || text.startsWith('Q. ')) {
      return { prefix: 'Q.', type: 'QUESTION' };
    }
    if (text === 'A.' || text.startsWith('A. ')) {
      return { prefix: 'A.', type: 'ANSWER' };
    }
    
    // Check for colon-delimited speakers
    const colonIndex = text.indexOf(':');
    if (colonIndex > 0) {
      const handle = text.substring(0, colonIndex);
      const afterColon = text.substring(colonIndex + 1);
      
      // Must have space or end-of-line after colon
      if (afterColon.length > 0 && afterColon[0] !== ' ') {
        return null;
      }
      
      // Check exact matches for court officials
      if (this.COURT_OFFICIALS[handle]) {
        return {
          prefix: handle,
          type: this.COURT_OFFICIALS[handle]
        };
      }
      
      // Check for attorney patterns (MR./MS./MRS./DR. + LASTNAME)
      if (handle.startsWith('MR. ') || handle.startsWith('MS. ') || 
          handle.startsWith('MRS. ') || handle.startsWith('DR. ')) {
        // Extract the title and last name
        const parts = handle.split(' ');
        if (parts.length >= 2) {
          const title = parts[0]; // MR., MS., etc.
          const lastName = parts[parts.length - 1];
          
          // Phase 1: Store attorney prefix without validation
          // Phase 2 will verify against registry
          return {
            prefix: handle,
            type: 'ATTORNEY'
          };
        }
      }
      
      // Check for BY MR./MS./etc. pattern (sets examination context)
      if (handle.startsWith('BY MR. ') || handle.startsWith('BY MS. ') ||
          handle.startsWith('BY MRS. ') || handle.startsWith('BY DR. ')) {
        return {
          prefix: handle,
          type: 'BY_ATTORNEY'
        };
      }
      
      // Check for JUROR patterns
      if (handle.startsWith('JUROR NO. ')) {
        const jurorMatch = handle.match(/^JUROR NO\. (\d+)$/);
        if (jurorMatch) {
          return {
            prefix: handle,
            type: 'JUROR'
          };
        }
      }
      
      if (handle.startsWith('PROSPECTIVE JUROR ')) {
        return {
          prefix: handle,
          type: 'JUROR'
        };
      }
      
      // If we found a colon but the handle doesn't match any known pattern,
      // this is NOT a speaker (e.g., "It says:", "The question is:", etc.)
      // Return null to prevent false positives
      return null;
    }
    
    // No colon found - not a speaker
    return null;
  }

  private isExaminationLine(text: string): boolean {
    for (const pattern of this.EXAMINATION_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  private async processSessionSections(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    sessionId: number,
    trialId: number
  ): Promise<void> {
    const summarySection = structure.sections.find(s => s.section === DocumentSection.SUMMARY);
    
    if (summarySection) {
      await this.processSummarySection(
        metadata,
        summarySection,
        sessionId,
        trialId
      );
    }
    
    // PROCEEDINGS section should not be created as a SessionSection
    // The proceedings content is part of the main transcript body
    
    // Process CERTIFICATION section
    const certificationSection = structure.sections.find(s => s.section === DocumentSection.CERTIFICATION);
    
    if (certificationSection) {
      const certLines: string[] = [];
      
      // Collect certification lines
      for (let lineNum = certificationSection.startLine; lineNum <= certificationSection.endLine; lineNum++) {
        const line = metadata.lines.get(lineNum);
        if (line) {
          certLines.push(line.rawText);
        }
      }
      
      // Use SessionSectionParser to create CERTIFICATION section
      await this.sessionSectionParser.parseCertificationSection(
        certLines,
        0,  // Start index is 0 since we're passing just the certification lines
        sessionId,
        trialId
      );
    }
  }

  private async processSummarySection(
    metadata: ParsedMetadata,
    section: SectionBoundary,
    sessionId: number,
    trialId: number
  ): Promise<void> {
    const summaryLines: string[] = [];
    
    // Collect the raw text lines for the SUMMARY section
    for (let lineNum = section.startLine; lineNum <= section.endLine; lineNum++) {
      const line = metadata.lines.get(lineNum);
      if (line) {
        // Include the full raw text to preserve line prefixes for the parser
        summaryLines.push(line.rawText);
      }
    }
    
    // Use SessionSectionParser to parse the summary into detailed sections
    // (CASE_TITLE, APPEARANCES, COURT_AND_DIVISION, etc.)
    await this.sessionSectionParser.parseSummarySections(
      summaryLines,
      sessionId,
      trialId
    );
    
    // Also extract metadata for other purposes
    const summaryText = summaryLines.join('\n');
    const attorneys = this.extractAttorneys(summaryText);
    const judge = this.extractJudge(summaryText);
    const courtReporter = this.extractCourtReporter(summaryText);
    
    if (attorneys.length > 0) {
      this.logger.debug(`Found ${attorneys.length} attorneys in summary`);
    }
    
    if (judge) {
      this.logger.debug(`Found judge: ${judge}`);
    }
    
    if (courtReporter) {
      this.logger.debug(`Found court reporter: ${courtReporter}`);
    }
    
    // Don't create a duplicate SUMMARY section - SessionSectionParser handles all sections
    // The SessionSectionParser creates detailed sections like CASE_TITLE, APPEARANCES, etc.
  }

  private extractAttorneys(text: string): string[] {
    const attorneys: string[] = [];
    const attorneyPattern = /(?:MR\.|MS\.|MRS\.)\s+([A-Z][A-Z\s]+?)(?:\n|,|;|FOR)/gi;
    
    let match;
    while ((match = attorneyPattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name && !attorneys.includes(name)) {
        attorneys.push(name);
      }
    }
    
    return attorneys;
  }

  private extractJudge(text: string): string | null {
    const judgePattern = /(?:JUDGE|HON\.|HONORABLE)\s+([A-Z][A-Z\s]+?)(?:\n|,|;)/i;
    const match = judgePattern.exec(text);
    return match ? match[1].trim() : null;
  }

  private extractCourtReporter(text: string): string | null {
    const reporterPattern = /(?:COURT REPORTER|REPORTED BY):\s*([A-Z][A-Z\s]+?)(?:\n|,|;)/i;
    const match = reporterPattern.exec(text);
    return match ? match[1].trim() : null;
  }
  
  private parseSessionDate(dateStr: string): Date | null {
    // Parse date strings like "OCTOBER 10, 2017" or "NOVEMBER 12, 2015"
    const months: { [key: string]: number } = {
      'JANUARY': 0, 'FEBRUARY': 1, 'MARCH': 2, 'APRIL': 3,
      'MAY': 4, 'JUNE': 5, 'JULY': 6, 'AUGUST': 7,
      'SEPTEMBER': 8, 'OCTOBER': 9, 'NOVEMBER': 10, 'DECEMBER': 11
    };
    
    const match = dateStr.match(/([A-Z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (match) {
      const monthName = match[1];
      const day = parseInt(match[2]);
      const year = parseInt(match[3]);
      
      if (months.hasOwnProperty(monthName)) {
        return new Date(year, months[monthName], day);
      }
    }
    
    return null;
  }

  
  private async detectSummaryCenterDelimiter(lines: string[]): Promise<string> {
    // Check if delimiter is configured in trialstyle
    // TODO: Get from trialstyle.json if not "AUTO"
    
    // Auto-detect delimiter by checking frequency
    const candidates = [')(', ') (', '|', '||', ' v. ', ' vs. ', ' V. ', ' VS. '];
    const counts = new Map<string, number>();
    
    for (const line of lines) {
      for (const delimiter of candidates) {
        if (line.includes(delimiter)) {
          counts.set(delimiter, (counts.get(delimiter) || 0) + 1);
        }
      }
    }
    
    // Return delimiter with highest count > 5
    let maxCount = 0;
    let bestDelimiter = ')('; // default
    
    for (const [delimiter, count] of counts) {
      if (count > maxCount && count >= 5) {
        maxCount = count;
        bestDelimiter = delimiter;
      }
    }
    
    this.logger.info(`Detected summaryCenterDelimiter: "${bestDelimiter}" (found ${maxCount} times)`);
    return bestDelimiter;
  }
  
  private async updateTrialMetadataFromSections(trialId: number): Promise<void> {
    this.logger.info('Extracting trial metadata from SessionSections');
    
    // Get the CASE_TITLE section
    const caseTitleSection = await this.prisma.sessionSection.findFirst({
      where: {
        trialId,
        sectionType: 'CASE_TITLE'
      }
    });
    
    // Get ALL COURT_AND_DIVISION sections (there may be multiple lines)
    const courtSections = await this.prisma.sessionSection.findMany({
      where: {
        trialId,
        sectionType: 'COURT_AND_DIVISION'
      },
      orderBy: {
        orderIndex: 'asc'
      }
    });
    
    const updateData: any = {};
    
    if (caseTitleSection) {
      // Parse CASE_TITLE using the two-column format approach
      // Step 1: Split raw text into lines
      const lines = caseTitleSection.sectionText.split('\n');
      
      // Step 2: Detect the center delimiter (usually ")(" but can vary)
      const delimiter = await this.detectSummaryCenterDelimiter(lines);
      
      // Step 3: Split each line by delimiter to separate left (party names) from right (case info)
      const leftSideLines: string[] = [];
      const rightSideLines: string[] = [];
      
      for (const line of lines) {
        if (line.includes(delimiter)) {
          // Split at delimiter position to preserve spacing
          const delimiterIndex = line.indexOf(delimiter);
          const leftPart = line.substring(0, delimiterIndex).trim();
          const rightPart = line.substring(delimiterIndex + delimiter.length).trim();
          
          if (leftPart) leftSideLines.push(leftPart);
          if (rightPart) rightSideLines.push(rightPart);
        } else {
          // Lines without delimiter typically belong to left side (party names continuation)
          const trimmed = line.trim();
          if (trimmed && !trimmed.match(/^\d+$/)) { // Skip standalone page numbers
            leftSideLines.push(trimmed);
          }
        }
      }
      
      // Step 4: Clean and join the separated content
      // Left side contains party names (plaintiff, defendant)
      const leftSideText = leftSideLines
        .filter(line => line.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')  // Collapse multiple spaces
        .trim();
      
      // Right side contains case info (case number, date, time, location)
      const rightSideText = rightSideLines
        .filter(line => line.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')  // Collapse multiple spaces
        .trim();
      
      // Parse right side into separate SessionSections
      // Get the highest orderIndex from existing sections
      const maxOrderIndex = await this.prisma.sessionSection.aggregate({
        where: { trialId },
        _max: { orderIndex: true }
      });
      let nextOrderIndex = (maxOrderIndex._max.orderIndex || 0) + 1;
      
      // Step 6: Parse right side for case metadata
      // Extract and create CIVIL_ACTION_NO section
      // Try multiple patterns for case numbers
      let caseNumberMatch = rightSideText.match(/(?:Civil (?:Action |Docket )?No\.?|Case)\s*(\d+:\d+-cv-\d+(?:-\w+)?)/i);
      if (!caseNumberMatch) {
        // Try simpler pattern for format like "2:16-CV-230-JRG"
        caseNumberMatch = rightSideText.match(/\b(\d+:\d+-CV-\d+(?:-\w+)?)\b/i);
      }
      
      if (caseNumberMatch) {
        updateData.caseNumber = caseNumberMatch[1].toUpperCase();
        this.logger.info(`Extracted case number: ${caseNumberMatch[1]}`);
        
        // Get sessionId from the first existing section
        const firstSection = await this.prisma.sessionSection.findFirst({
          where: { trialId },
          select: { sessionId: true }
        });
        
        if (firstSection) {
          await this.prisma.sessionSection.create({
            data: {
              sessionId: firstSection.sessionId,
              trialId,
              sectionType: 'CIVIL_ACTION_NO',
              sectionText: caseNumberMatch[1],
              orderIndex: nextOrderIndex++,
              metadata: { source: 'CASE_TITLE_right_side' }
            }
          });
        }
      }
      
      // Extract and create SESSION_START_TIME section
      const timeMatch = rightSideText.match(/\b(\d{1,2}:\d{2}\s*[AP]\.?M\.?)\b/i);
      if (timeMatch) {
        this.logger.info(`Found session start time: ${timeMatch[1]}`);
        
        const firstSection = await this.prisma.sessionSection.findFirst({
          where: { trialId },
          select: { sessionId: true }
        });
        
        if (firstSection) {
          await this.prisma.sessionSection.create({
            data: {
              sessionId: firstSection.sessionId,
              trialId,
              sectionType: 'SESSION_START_TIME',
              sectionText: timeMatch[1],
              orderIndex: nextOrderIndex++,
              metadata: { source: 'CASE_TITLE_right_side' }
            }
          });
          
          // Also update Session.startTime
          const timeStr = timeMatch[1].toUpperCase();
          const timeParts = timeStr.match(/(\d{1,2}):(\d{2})\s*([AP])\.?M\.?/);
          if (timeParts) {
            let hours = parseInt(timeParts[1]);
            const minutes = parseInt(timeParts[2]);
            const isPM = timeParts[3] === 'P';
            
            if (isPM && hours !== 12) hours += 12;
            if (!isPM && hours === 12) hours = 0;
            
            // Get session date
            const session = await this.prisma.session.findUnique({
              where: { id: firstSection.sessionId },
              select: { sessionDate: true }
            });
            
            if (session && session.sessionDate) {
              const startTime = new Date(session.sessionDate);
              startTime.setHours(hours, minutes, 0, 0);
              
              await this.prisma.session.update({
                where: { id: firstSection.sessionId },
                data: { startTime: startTime.toISOString() }
              });
            }
          }
        }
      }
      
      // Extract and create TRIAL_DATE section (actually SESSION_DATE)
      // Need to remove location prefix (e.g., "MARSHALL, TEXAS" from "MARSHALL, TEXAS OCTOBER 1, 2020")
      const dateMatch = rightSideText.match(/\b([A-Z]+\s+\d{1,2},?\s+\d{4})\b/);
      if (dateMatch) {
        this.logger.info(`Found trial date: ${dateMatch[1]}`);
        
        const firstSection = await this.prisma.sessionSection.findFirst({
          where: { trialId },
          select: { sessionId: true }
        });
        
        if (firstSection) {
          await this.prisma.sessionSection.create({
            data: {
              sessionId: firstSection.sessionId,
              trialId,
              sectionType: 'TRIAL_DATE',
              sectionText: dateMatch[1],
              orderIndex: nextOrderIndex++,
              metadata: { source: 'CASE_TITLE_right_side' }
            }
          });
          
          // Also update Session.sessionDate if it's a placeholder date
          const session = await this.prisma.session.findUnique({
            where: { id: firstSection.sessionId },
            select: { sessionDate: true }
          });
          
          // Check if session date is the default/placeholder
          if (session && session.sessionDate) {
            const sessionDateStr = session.sessionDate.toISOString().split('T')[0];
            const currentYear = new Date().getFullYear();
            
            // If session date is in current year (likely a placeholder), update it
            if (sessionDateStr.startsWith(String(currentYear))) {
              // Parse the date from the match (e.g., "OCTOBER 10, 2017")
              const parsedDate = this.parseSessionDate(dateMatch[1]);
              if (parsedDate) {
                await this.prisma.session.update({
                  where: { id: firstSection.sessionId },
                  data: { sessionDate: parsedDate }
                });
                this.logger.info(`Updated session date to: ${parsedDate.toISOString()}`);
              }
            }
          }
        }
      }
      
      // Extract and create TRIAL_LOCATION section (usually city, state)
      // Look for pattern like "MARSHALL, TEXAS" - city and state in caps
      const locationMatch = rightSideText.match(/\b([A-Z]+,\s+[A-Z]+)\b/);
      if (locationMatch && !locationMatch[1].match(/\d/) && !locationMatch[1].match(/OCTOBER|NOVEMBER|DECEMBER|JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER/)) { 
        // Ensure no numbers (not a date) and not a month name
        this.logger.info(`Found trial location: ${locationMatch[1]}`);
        
        const firstSection = await this.prisma.sessionSection.findFirst({
          where: { trialId },
          select: { sessionId: true }
        });
        
        if (firstSection) {
          await this.prisma.sessionSection.create({
            data: {
              sessionId: firstSection.sessionId,
              trialId,
              sectionType: 'TRIAL_LOCATION',
              sectionText: locationMatch[1],
              orderIndex: nextOrderIndex++,
              metadata: { source: 'CASE_TITLE_right_side' }
            }
          });
        }
      }
      
      // Step 5: Extract plaintiff and defendant from LEFT side
      // Handle multi-party plaintiffs/defendants properly
      let plaintiff = '';
      let defendant = '';
      let vsDelimiter = '';
      
      // Parse the left side line by line to handle complex multi-party cases
      const leftLines = leftSideLines.map(l => l.trim()).filter(l => l);
      let inPlaintiff = true;
      let plaintiffLines: string[] = [];
      let defendantLines: string[] = [];
      
      for (const line of leftLines) {
        // Check for VS delimiter
        if (line === 'VS.' || line === 'V.' || line.match(/^VS\.?$/i) || line.match(/^V\.?$/i)) {
          inPlaintiff = false;
          vsDelimiter = line;
          continue;
        }
        
        // Add to appropriate party
        if (inPlaintiff) {
          // Check if line contains VS. inline
          if (line.includes(' VS. ') || line.includes(' V. ')) {
            const delimiter = line.includes(' VS. ') ? ' VS. ' : ' V. ';
            const parts = line.split(delimiter);
            if (parts.length >= 2) {
              plaintiffLines.push(parts[0].trim());
              defendantLines.push(parts[1].trim());
              vsDelimiter = delimiter.trim();
              inPlaintiff = false;
            } else {
              plaintiffLines.push(line);
            }
          } else {
            plaintiffLines.push(line);
          }
        } else {
          defendantLines.push(line);
        }
      }
      
      // Join the lines and clean up
      plaintiff = plaintiffLines.join(' ')
        .replace(/,?\s*PLAINTIFF[S]?[,\s]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      defendant = defendantLines.join(' ')
        .replace(/,?\s*DEFENDANT[S]?[,\s]*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
        
      // Handle "ET AL" expansion if we have more complete info in the text
      if (plaintiff.includes('ET AL')) {
        // Look for a more complete listing with "AND" that might give us full party names
        const fullPlaintiffMatch = leftSideText.match(/([A-Z][A-Z0-9\s,\.]+(?:LLC|INC|CORP|LTD|LIMITED)[A-Z0-9\s,\.]*(?:,\s*[A-Z][A-Z0-9\s,\.]+(?:LLC|INC|CORP|LTD|LIMITED)[A-Z0-9\s,\.]*)*(?:,?\s*AND\s+[A-Z][A-Z0-9\s,\.]+(?:LLC|INC|CORP|LTD|LIMITED)[A-Z0-9\s,\.]*)*)(?:\s+VS\.?\s+|\s+V\.?\s+)/i);
        if (fullPlaintiffMatch) {
          const candidatePlaintiff = fullPlaintiffMatch[1].trim();
          // Only use if it's longer/more complete than what we have
          if (candidatePlaintiff.length > plaintiff.length && !candidatePlaintiff.includes('VS.') && !candidatePlaintiff.includes(' V.')) {
            plaintiff = candidatePlaintiff;
          }
        }
      }
      
      // Clean up party names - remove trailing commas, PLAINTIFF/DEFENDANT labels, etc.
      if (plaintiff) {
        plaintiff = plaintiff
          .replace(/,\s*$/, '')  // Remove trailing comma
          .replace(/\s+/g, ' ')  // Normalize spaces
          .trim();
      }
      
      if (defendant) {
        defendant = defendant
          .replace(/,\s*$/, '')  // Remove trailing comma
          .replace(/\s+/g, ' ')  // Normalize spaces
          .replace(/\s*TRANSCRIPT OF JURY TRIAL.*$/i, '') // Remove transcript info that might be appended
          .trim();
      }
      
      if (plaintiff) {
        updateData.plaintiff = plaintiff;
        this.logger.info(`Extracted plaintiff: ${plaintiff}`);
      }
      
      if (defendant) {
        updateData.defendant = defendant;
        this.logger.info(`Extracted defendant: ${defendant}`);
      }
      
      // Set the trial name preserving the original VS. or V. format
      if (plaintiff && defendant && vsDelimiter) {
        updateData.name = `${plaintiff}${vsDelimiter}${defendant}`;
      }
    }
    
    if (courtSections.length > 0) {
      // Combine all court section lines
      const courtTextCombined = courtSections
        .map(s => s.sectionText)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Extract court components - these are constants for all test cases
      if (courtTextCombined.includes('UNITED STATES DISTRICT COURT')) {
        updateData.court = 'UNITED STATES DISTRICT COURT';
      }
      
      if (courtTextCombined.includes('EASTERN DISTRICT OF TEXAS')) {
        updateData.courtDistrict = 'EASTERN DISTRICT OF TEXAS';
      }
      
      if (courtTextCombined.includes('MARSHALL DIVISION')) {
        updateData.courtDivision = 'MARSHALL DIVISION';
      }
      
      this.logger.info(`Extracted court: ${updateData.court}`);
      this.logger.info(`Extracted district: ${updateData.courtDistrict}`);
      this.logger.info(`Extracted division: ${updateData.courtDivision}`);
    }
    
    // Only update if we have data to update
    if (Object.keys(updateData).length > 0) {
      await this.prisma.trial.update({
        where: { id: trialId },
        data: updateData
      });
      
      this.logger.info(`Updated trial metadata for trial ${trialId}`);
    } else {
      this.logger.warn('No trial metadata found in SessionSections to update');
    }
  }
}