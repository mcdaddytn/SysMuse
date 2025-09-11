import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import {
  ParsedMetadata,
  StructureAnalysis,
  MultiPassConfig,
  PassResult,
  DocumentSection
} from './MultiPassTypes';
import { MetadataExtractor } from './MultiPassMetadataExtractor';
import { StructureAnalyzer } from './MultiPassStructureAnalyzer';
import { ContentParser } from './MultiPassContentParser';

export class MultiPassTranscriptParser {
  private prisma: PrismaClient;
  private logger: Logger;
  private config: MultiPassConfig;
  private metadataExtractor: MetadataExtractor;
  private structureAnalyzer: StructureAnalyzer;
  private contentParser: ContentParser;
  private trialStyleConfig?: any;

  constructor(prisma: PrismaClient, logger: Logger, config?: Partial<MultiPassConfig>, customDelimiter?: string, trialStyleConfig?: any) {
    this.prisma = prisma;
    this.logger = logger;
    this.config = {
      mode: 'multi-pass',
      loadInMemory: true,
      validatePasses: true,
      debugOutput: false,
      batchSize: 1000,
      ...config
    };
    this.trialStyleConfig = trialStyleConfig;

    this.metadataExtractor = new MetadataExtractor(logger, this.config.pageHeaderLines);
    this.structureAnalyzer = new StructureAnalyzer(logger, trialStyleConfig);
    this.contentParser = new ContentParser(prisma, logger, customDelimiter, trialStyleConfig);
  }

  async parseTranscript(
    filePath: string,
    sessionId: number,
    trialId: number
  ): Promise<boolean> {
    const startTime = Date.now();
    
    this.logger.info(`Starting multi-pass parsing for: ${filePath}`);
    
    try {
      const fileContent = await this.loadFile(filePath);
      
      const pass1Result = await this.executePass1(fileContent, filePath);
      if (!pass1Result.success || !pass1Result.data) {
        this.logger.error('Pass 1 (Metadata Extraction) failed', pass1Result.errors);
        return false;
      }
      
      if (this.config.validatePasses) {
        this.validatePass1(pass1Result.data);
      }
      
      const pass2Result = await this.executePass2(pass1Result.data);
      if (!pass2Result.success || !pass2Result.data) {
        this.logger.error('Pass 2 (Structure Analysis) failed', pass2Result.errors);
        return false;
      }
      
      if (this.config.validatePasses) {
        this.validatePass2(pass2Result.data, pass1Result.data);
      }
      
      const pass3Result = await this.executePass3(
        pass1Result.data,
        pass2Result.data,
        sessionId,
        trialId
      );
      
      if (!pass3Result.success) {
        this.logger.error('Pass 3 (Content Parsing) failed', pass3Result.errors);
        return false;
      }
      
      const duration = Date.now() - startTime;
      this.logger.info(`Multi-pass parsing completed in ${duration}ms`);
      
      if (this.config.debugOutput) {
        this.outputDebugInfo(pass1Result.data, pass2Result.data);
      }
      
      return true;
      
    } catch (error) {
      this.logger.error('Multi-pass parsing failed', error);
      return false;
    }
  }

  private async loadFile(filePath: string): Promise<string[]> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return content.split('\n');
  }

  private async executePass1(
    fileContent: string[],
    filePath: string
  ): Promise<PassResult<ParsedMetadata>> {
    const startTime = new Date();
    
    try {
      const metadata = await this.metadataExtractor.extractMetadata(fileContent, filePath);
      
      return {
        success: true,
        data: metadata,
        errors: [],
        warnings: [],
        stats: {
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          itemsProcessed: fileContent.length
        }
      };
    } catch (error) {
      this.logger.error('Pass 1 execution error:', error);
      if (error instanceof Error) {
        this.logger.error('Stack trace:', error.stack);
      }
      return {
        success: false,
        data: undefined,
        errors: [error instanceof Error ? error.message : 'Unknown error in Pass 1'],
        warnings: [],
        stats: {
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          itemsProcessed: 0
        }
      };
    }
  }

  private async executePass2(
    metadata: ParsedMetadata
  ): Promise<PassResult<StructureAnalysis>> {
    const startTime = new Date();
    
    try {
      const structure = await this.structureAnalyzer.analyzeStructure(metadata);
      
      return {
        success: true,
        data: structure,
        errors: [],
        warnings: [],
        stats: {
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          itemsProcessed: metadata.lines.size
        }
      };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error in Pass 2'],
        warnings: [],
        stats: {
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          itemsProcessed: 0
        }
      };
    }
  }

  private async executePass3(
    metadata: ParsedMetadata,
    structure: StructureAnalysis,
    sessionId: number,
    trialId: number
  ): Promise<PassResult<void>> {
    const startTime = new Date();
    
    try {
      await this.contentParser.parseContent(
        metadata,
        structure,
        sessionId,
        trialId,
        this.config.batchSize
      );
      
      return {
        success: true,
        errors: [],
        warnings: [],
        stats: {
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          itemsProcessed: metadata.lines.size
        }
      };
    } catch (error) {
      this.logger.error('Pass 3 error details:', error);
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error in Pass 3'],
        warnings: [],
        stats: {
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          itemsProcessed: 0
        }
      };
    }
  }

  private validatePass1(metadata: ParsedMetadata): void {
    if (metadata.pages.size === 0) {
      throw new Error('No pages detected in Pass 1');
    }
    
    if (metadata.lines.size === 0) {
      throw new Error('No lines detected in Pass 1');
    }
    
    let previousPage = 0;
    for (const [pageNum, page] of Array.from(metadata.pages.entries()).sort((a, b) => a[0] - b[0])) {
      if (pageNum !== previousPage + 1 && previousPage !== 0) {
        this.logger.warn(`Page gap detected: ${previousPage} -> ${pageNum}`);
      }
      previousPage = pageNum;
    }
    
    this.logger.info(`Pass 1 validation: ${metadata.pages.size} pages, ${metadata.lines.size} lines`);
  }

  private validatePass2(structure: StructureAnalysis, metadata: ParsedMetadata): void {
    if (structure.sections.length === 0) {
      throw new Error('No sections detected in Pass 2');
    }
    
    const summarySection = structure.sections.find(s => s.section === DocumentSection.SUMMARY);
    const proceedingsSection = structure.sections.find(s => s.section === DocumentSection.PROCEEDINGS);
    
    if (!summarySection && !proceedingsSection) {
      this.logger.warn('Neither SUMMARY nor PROCEEDINGS section detected');
    }
    
    for (let i = 0; i < structure.sections.length - 1; i++) {
      const current = structure.sections[i];
      const next = structure.sections[i + 1];
      
      if (current.endLine >= next.startLine) {
        throw new Error(`Overlapping sections detected: ${current.section} and ${next.section}`);
      }
    }
    
    this.logger.info(`Pass 2 validation: ${structure.sections.length} sections identified`);
  }

  private outputDebugInfo(metadata: ParsedMetadata, structure: StructureAnalysis): void {
    const debugDir = path.join(process.cwd(), 'debug-output');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    const metadataFile = path.join(debugDir, `metadata-${timestamp}.json`);
    fs.writeFileSync(metadataFile, JSON.stringify({
      pageCount: metadata.pages.size,
      lineCount: metadata.lines.size,
      pages: Array.from(metadata.pages.entries()).map(([num, page]) => ({
        number: num,
        ...page
      })),
      lines: Array.from(metadata.lines.entries()).slice(0, 100).map(([num, line]) => ({
        number: num,
        ...line
      }))
    }, null, 2));
    
    const structureFile = path.join(debugDir, `structure-${timestamp}.json`);
    fs.writeFileSync(structureFile, JSON.stringify({
      sectionCount: structure.sections.length,
      sections: structure.sections
    }, null, 2));
    
    this.logger.info(`Debug output written to: ${debugDir}`);
  }
}