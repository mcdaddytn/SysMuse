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
    
    for (let i = 0; i < lineBatches.length; i++) {
      await this.processLineBatch(
        lineBatches[i],
        metadata,
        structure,
        sessionId,
        trialId
      );
      
      if ((i + 1) % 10 === 0) {
        this.logger.debug(`Processed ${(i + 1) * batchSize} lines`);
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
    
    // Parse attorneys from APPEARANCES section
    await this.parseAttorneysFromSummary(summaryLines, trialId);
    
    // Parse judge
    await this.parseJudgeFromSummary(summaryLines, trialId);
  }
  
  private async parseAttorneysFromSummary(
    lines: string[],
    trialId: number
  ): Promise<void> {
    if (!this.speakerService) return;
    
    // Find APPEARANCES section
    const appearancesIndex = lines.findIndex(l => 
      l.includes('APPEARANCES:') || l.includes('APPEARING:')
    );
    
    if (appearancesIndex === -1) {
      this.logger.warn('No APPEARANCES section found in summary');
      return;
    }
    
    // Parse attorney blocks (usually separated by FOR PLAINTIFF/DEFENDANT)
    let currentRole: 'PLAINTIFF' | 'DEFENDANT' | null = null;
    
    for (let i = appearancesIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Check for role markers
      if (line.includes('FOR PLAINTIFF') || line.includes('FOR THE PLAINTIFF')) {
        currentRole = 'PLAINTIFF';
        continue;
      }
      if (line.includes('FOR DEFENDANT') || line.includes('FOR THE DEFENDANT')) {
        currentRole = 'DEFENDANT';
        continue;
      }
      
      // Stop at next section
      if (line.includes('BEFORE THE HONORABLE') || line.includes('COURT REPORTER')) {
        break;
      }
      
      // Parse attorney name
      const attorneyMatch = line.match(/^(MR\.|MS\.|MRS\.|DR\.)?\s*([A-Z][A-Z\s\.',-]+?)(?:\s*,|$)/i);
      if (attorneyMatch && currentRole) {
        const title = attorneyMatch[1] || 'MR.';
        const name = attorneyMatch[2].trim();
        
        // Extract last name
        const nameParts = name.split(/\s+/);
        const lastName = nameParts[nameParts.length - 1];
        
        await this.speakerService.createAttorneyWithSpeaker({
          name,
          title,
          lastName,
          speakerPrefix: `${title} ${lastName}`.toUpperCase(),
          role: currentRole
        });
        
        this.logger.info(`Created attorney: ${title} ${name} for ${currentRole}`);
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
      
      if (!location) continue;
      
      const pageId = pageMap.get(location.pageNumber);
      if (!pageId) {
        this.logger.warn(`Page ${location.pageNumber} not found for line ${lineNum}`);
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
      if (speakerInfo?.speaker && section === DocumentSection.PROCEEDINGS) {
        statementEvents.push({
          trialId,
          sessionId,
          speakerId: speakerInfo.speaker.id,
          startTime: line.timestamp,
          startLineNumber: lineNum + 1,
          endLineNumber: lineNum + 1,
          eventType: 'STATEMENT',
          text: line.cleanText,
          rawText: line.rawText || line.cleanText
        });
      }
    }
    
    if (lineData.length > 0) {
      await this.prisma.line.createMany({
        data: lineData,
        skipDuplicates: true
      });
    }
    
    // Create statement events for identified speakers
    if (statementEvents.length > 0) {
      await this.prisma.statementEvent.createMany({
        data: statementEvents,
        skipDuplicates: true
      });
    }
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
    for (const { pattern, type } of this.SPEAKER_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        return {
          prefix: match[0].replace(':', '').trim(),
          type
        };
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