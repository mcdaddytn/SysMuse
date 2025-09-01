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
      // Clean up the case title - remove extra spaces and line breaks but preserve format
      const caseTitleRaw = caseTitleSection.sectionText;
      
      // Split by )( delimiter to separate left (parties) from right (case info)
      // For now, hardcode )( as it's the delimiter for Vocalife trial
      // TODO: Get delimiter from trialstyle.json or detect automatically
      const delimiter = ')(';
      
      // Split each line by delimiter and collect both sides
      const lines = caseTitleRaw.split('\n');
      const leftSideParts: string[] = [];
      const rightSideParts: string[] = [];
      
      for (const line of lines) {
        if (line.includes(delimiter)) {
          const parts = line.split(delimiter);
          if (parts[0]) {
            leftSideParts.push(parts[0].trim());
          }
          if (parts[1]) {
            rightSideParts.push(parts[1].trim());
          }
        } else {
          // If no delimiter, include the whole line on left (might be continuation)
          leftSideParts.push(line.trim());
        }
      }
      
      // Join the left side parts (party names) and clean up
      const leftSideText = leftSideParts
        .join(' ')
        .replace(/[\(\)]/g, ' ')  // Remove remaining parentheses
        .replace(/\s+/g, ' ')  // Collapse multiple spaces
        .trim();
      
      // Join the right side parts (case info, dates, times)
      const rightSideText = rightSideParts
        .join(' ')
        .replace(/[\(\)]/g, ' ')  // Remove remaining parentheses
        .replace(/\s+/g, ' ')  // Collapse multiple spaces
        .trim();
      
      // Extract case number from right side (format: 2:19-CV-123-JRG or similar)
      const caseNumberMatch = rightSideText.match(/\b(\d+:\d+-CV-\d+-\w+)\b/);
      if (caseNumberMatch) {
        updateData.caseNumber = caseNumberMatch[1];
        this.logger.info(`Extracted case number: ${caseNumberMatch[1]}`);
      }
      
      // Extract session start time from right side (format: 9:24 A.M. or similar)
      const timeMatch = rightSideText.match(/\b(\d{1,2}:\d{2}\s*[AP]\.?M\.?)\b/i);
      if (timeMatch) {
        // Store in metadata for now - could update Session.startTime later
        this.logger.info(`Found session start time in CASE_TITLE: ${timeMatch[1]}`);
      }
      
      // Extract plaintiff and defendant from LEFT side based on VS. or V.
      let plaintiff = '';
      let defendant = '';
      let vsDelimiter = '';
      
      if (leftSideText.includes(' VS. ')) {
        vsDelimiter = ' VS. ';
        const parts = leftSideText.split(' VS. ');
        if (parts.length >= 2) {
          plaintiff = parts[0].replace(/,?\s*PLAINTIFF[S]?[,\s]*$/i, '').trim();
          defendant = parts[1].replace(/,?\s*DEFENDANT[S]?[,\s]*$/i, '').trim();
        }
      } else if (leftSideText.includes(' V. ')) {
        vsDelimiter = ' V. ';
        const parts = leftSideText.split(' V. ');
        if (parts.length >= 2) {
          plaintiff = parts[0].replace(/,?\s*PLAINTIFF[S]?[,\s]*$/i, '').trim();
          defendant = parts[1].replace(/,?\s*DEFENDANT[S]?[,\s]*$/i, '').trim();
        }
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