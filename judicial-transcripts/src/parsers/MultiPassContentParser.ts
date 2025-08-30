import { PrismaClient, Prisma } from '@prisma/client';
import { Logger } from '../utils/logger';
import {
  ParsedMetadata,
  StructureAnalysis,
  DocumentSection,
  SectionBoundary
} from './MultiPassTypes';

export class ContentParser {
  private prisma: PrismaClient;
  private logger: Logger;
  
  private readonly SPEAKER_PATTERNS = [
    { pattern: /^THE COURT:/i, type: 'COURT' },
    { pattern: /^THE WITNESS:/i, type: 'WITNESS' },
    { pattern: /^MR\.\s+([A-Z][A-Z\s]+):/i, type: 'ATTORNEY' },
    { pattern: /^MS\.\s+([A-Z][A-Z\s]+):/i, type: 'ATTORNEY' },
    { pattern: /^JUDGE\s+([A-Z][A-Z\s]+):/i, type: 'JUDGE' },
    { pattern: /^JUROR\s+([A-Z][A-Z\s]+):/i, type: 'JUROR' },
    { pattern: /^PROSPECTIVE JUROR\s+([A-Z][A-Z\s]+):/i, type: 'JUROR' },
    { pattern: /^([A-Z][A-Z\s]+):/i, type: 'SPEAKER' }
  ];
  
  private readonly EXAMINATION_PATTERNS = [
    /DIRECT EXAMINATION/i,
    /CROSS[- ]EXAMINATION/i,
    /REDIRECT EXAMINATION/i,
    /RECROSS[- ]EXAMINATION/i,
    /VOIR DIRE EXAMINATION/i
  ];

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  async parseContent(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    sessionId: number,
    trialId: number,
    batchSize: number = 1000
  ): Promise<void> {
    this.logger.info('Starting content parsing (Pass 3)');
    
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
    
    this.logger.info(`Content parsing complete: ${metadata.lines.size} lines processed`);
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
      
      const speakerInfo = this.extractSpeaker(line.cleanText);
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
    }
    
    if (lineData.length > 0) {
      await this.prisma.line.createMany({
        data: lineData,
        skipDuplicates: true
      });
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
  }

  private async processSummarySection(
    metadata: ParsedMetadata,
    section: SectionBoundary,
    sessionId: number,
    trialId: number
  ): Promise<void> {
    const summaryLines: string[] = [];
    
    for (let lineNum = section.startLine; lineNum <= section.endLine; lineNum++) {
      const line = metadata.lines.get(lineNum);
      if (line) {
        summaryLines.push(line.cleanText);
      }
    }
    
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
    
    await this.prisma.sessionSection.create({
      data: {
        sessionId,
        trialId,
        sectionType: 'SUMMARY',
        sectionText: summaryText.substring(0, 5000),
        orderIndex: 1,
        metadata: {
          attorneys,
          judge,
          courtReporter,
          startLine: section.startLine,
          endLine: section.endLine
        },
        createdAt: new Date()
      }
    });
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