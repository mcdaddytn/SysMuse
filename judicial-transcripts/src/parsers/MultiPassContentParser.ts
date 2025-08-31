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

export class ContentParser {
  private prisma: PrismaClient;
  private logger: Logger;
  private sessionSectionParser: SessionSectionParser;
  private speakerRegistry: SpeakerRegistry | null = null;
  private examinationContext: ExaminationContextManager | null = null;
  private speakerService: MultiTrialSpeakerService | null = null;
  
  private readonly SPEAKER_PATTERNS = [
    { pattern: /^THE COURT:/i, type: 'JUDGE' },
    { pattern: /^THE WITNESS:/i, type: 'WITNESS' },
    { pattern: /^THE DEPONENT:/i, type: 'WITNESS' },
    { pattern: /^THE ATTORNEY:/i, type: 'ATTORNEY' },
    { pattern: /^MR\.\s+([A-Z][A-Z\s'-]+?):/i, type: 'ATTORNEY' },
    { pattern: /^MS\.\s+([A-Z][A-Z\s'-]+?):/i, type: 'ATTORNEY' },
    { pattern: /^MRS\.\s+([A-Z][A-Z\s'-]+?):/i, type: 'ATTORNEY' },
    { pattern: /^DR\.\s+([A-Z][A-Z\s'-]+?):/i, type: 'ATTORNEY' },
    { pattern: /^JUDGE\s+([A-Z][A-Z\s]+):/i, type: 'JUDGE' },
    { pattern: /^JUROR\s+(?:NO\.\s+)?(\d+):/i, type: 'JUROR' },
    { pattern: /^PROSPECTIVE JUROR\s+([A-Z][A-Z\s]+):/i, type: 'JUROR' },
    { pattern: /^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+([A-Z][A-Z\s'-]+?):/i, type: 'BY_ATTORNEY' },
    { pattern: /^Q\.?\s*/i, type: 'QUESTION' },
    { pattern: /^A\.?\s*/i, type: 'ANSWER' },
    { pattern: /^QUESTION:?\s*/i, type: 'QUESTION' },
    { pattern: /^ANSWER:?\s*/i, type: 'ANSWER' },
    { pattern: /^([A-Z][A-Z\s]+):/i, type: 'SPEAKER' }
  ];
  
  private readonly EXAMINATION_PATTERNS = [
    /DIRECT EXAMINATION/i,
    /CROSS[- ]EXAMINATION/i,
    /REDIRECT EXAMINATION/i,
    /RECROSS[- ]EXAMINATION/i,
    /VOIR DIRE EXAMINATION/i,
    /EXAMINATION CONTINUED/i
  ];

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
    this.sessionSectionParser = new SessionSectionParser(prisma);
  }

  async parseContent(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    sessionId: number,
    trialId: number,
    batchSize: number = 1000
  ): Promise<void> {
    this.logger.info('Starting content parsing (Pass 3) with speaker identification');
    
    // Initialize speaker services
    await this.initializeSpeakerServices(trialId);
    
    // Parse summary section first to extract attorneys, judge, etc.
    await this.parseSummaryForSpeakers(metadata, structure, trialId);
    
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
    
    // Log speaker statistics
    if (this.speakerRegistry) {
      const stats = this.speakerRegistry.getStatistics();
      this.logger.info(`Speaker identification complete: ${stats.total} speakers identified`);
      this.logger.info(`Speaker breakdown: ${JSON.stringify(stats.byType)}`);
      if (stats.unmatched.length > 0) {
        this.logger.warn(`Unmatched speakers: ${stats.unmatched.join(', ')}`);
      }
    }
    
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
    
    // Extract lines from summary section
    const summaryLines: string[] = [];
    for (let i = summarySection.startLine; i <= summarySection.endLine; i++) {
      const line = metadata.lines.get(i);
      if (line?.cleanText) {
        summaryLines.push(line.cleanText);
      }
    }
    
    // Parse attorneys from summary (will be refined after SessionSections are created)
    await this.parseAttorneysFromSummary(summaryLines, trialId);
    
    // Parse judge
    await this.parseJudgeFromSummary(summaryLines, trialId);
  }
  
  private async parseAttorneysFromSummary(
    lines: string[],
    trialId: number
  ): Promise<void> {
    if (!this.speakerService) return;
    
    // Look for the sections that start with "FOR THE PLAINTIFF:" or "FOR THE DEFENDANT:"
    let currentRole: 'PLAINTIFF' | 'DEFENDANT' | null = null;
    let inAttorneySection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for role markers - these are section headers
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
        }
      }
    }
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
      
      // Update examination context
      if (this.examinationContext) {
        await this.examinationContext.updateFromLine({
          text: line.cleanText,
          lineNumber: lineNum,
          timestamp: line.timestamp
        });
      }
      
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
    if (!text || !this.speakerRegistry || !this.examinationContext) {
      return this.extractSpeaker(text);
    }
    
    // First try to resolve through examination context (Q&A formats)
    const contextualSpeaker = await this.examinationContext.resolveSpeaker({
      text,
      lineNumber
    });
    
    if (contextualSpeaker) {
      return {
        prefix: contextualSpeaker.speakerPrefix,
        type: contextualSpeaker.speakerType,
        speaker: contextualSpeaker
      };
    }
    
    // Extract speaker prefix from text
    const speakerInfo = this.extractSpeaker(text);
    if (!speakerInfo) return null;
    
    // Handle special cases
    if (speakerInfo.type === 'BY_ATTORNEY') {
      // This sets the examining attorney context but doesn't create a statement
      return null;
    }
    
    // Try to find or create speaker in registry
    let speaker = null;
    
    if (speakerInfo.type === 'JUDGE' || speakerInfo.prefix === 'THE COURT') {
      speaker = this.speakerRegistry.getTheCourt();
    } else if (speakerInfo.type === 'QUESTION' || speakerInfo.type === 'ANSWER') {
      // These should have been handled by examination context
      // If not, try contextual lookup
      speaker = this.speakerRegistry.resolveContextualSpeaker(speakerInfo.prefix);
    } else {
      // Standard speaker lookup/creation
      const speakerType = this.mapToSpeakerType(speakerInfo.type);
      speaker = await this.speakerRegistry.findOrCreateSpeaker(
        speakerInfo.prefix,
        speakerType
      );
    }
    
    return {
      prefix: speakerInfo.prefix,
      type: speakerInfo.type,
      speaker
    };
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
    // Strict speaker identification rules:
    // 1. Must be at the start of the line (no whitespace to the left)
    // 2. Must have whitespace to the right (or end of line for Q/A)
    // 3. Case sensitive comparison
    
    if (!text || text.length === 0) return null;
    
    // Check if line starts with whitespace - if so, not a speaker
    if (text[0] === ' ' || text[0] === '\t') return null;
    
    // Special handling for Q. and A. patterns (case sensitive)
    if (text === 'Q.' || text.startsWith('Q. ')) {
      return { prefix: 'Q.', type: 'QUESTION' };
    }
    if (text === 'A.' || text.startsWith('A. ')) {
      return { prefix: 'A.', type: 'ANSWER' };
    }
    
    // Exclude bare Q and A (without periods) for this trial
    // These would be: text === 'Q' || text.startsWith('Q ') || text === 'A' || text.startsWith('A ')
    // We're explicitly NOT matching these
    
    // Check other speaker patterns
    for (const { pattern, type } of this.SPEAKER_PATTERNS) {
      // Skip Q/A patterns as we've handled them specially above
      if (type === 'QUESTION' || type === 'ANSWER') continue;
      
      const match = pattern.exec(text);
      if (match && match.index === 0) { // Must match at start of line
        const fullMatch = match[0];
        
        // Check if there's whitespace or end of line after the match
        const afterMatch = text.substring(fullMatch.length);
        if (afterMatch.length === 0 || afterMatch[0] === ' ' || afterMatch[0] === '\t') {
          return {
            prefix: fullMatch.replace(':', '').trim(),
            type
          };
        }
      }
    }
    
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
    
    const proceedingsSection = structure.sections.find(s => s.section === DocumentSection.PROCEEDINGS);
    
    if (proceedingsSection) {
      await this.processProceedingsMetadata(
        metadata,
        proceedingsSection,
        sessionId,
        trialId
      );
    }
    
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

  private async processProceedingsMetadata(
    metadata: ParsedMetadata,
    section: SectionBoundary,
    sessionId: number,
    trialId: number
  ): Promise<void> {
    await this.prisma.sessionSection.create({
      data: {
        sessionId,
        trialId,
        sectionType: 'PROCEEDINGS',
        sectionText: '',
        orderIndex: 2,
        metadata: {
          startPage: section.startPage,
          endPage: section.endPage,
          lineCount: section.endLine - section.startLine + 1,
          startLine: section.startLine,
          endLine: section.endLine
        },
        createdAt: new Date()
      }
    });
  }
}