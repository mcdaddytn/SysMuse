import { Logger } from '../utils/logger';
import {
  ParsedMetadata,
  PageMetadata,
  LineMetadata,
  DocumentLocation
} from './MultiPassTypes';

export class MetadataExtractor {
  private logger: Logger;
  
  private readonly PAGE_HEADER_PATTERN = /^\s*(\d+)\s+(.+?)\s+(\d+)\s*$/;
  
  private readonly PAGE_HEADER_MULTILINE_PATTERN = /^\s*(\d+)\s*$/;
  
  private readonly LINE_PREFIX_PATTERNS = {
    TIMESTAMP_AND_NUMBER: /^(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.*)$/,
    
    NUMBER_WITH_SPACES: /^(\d{1,2})\s{2,}(.*)$/,
    
    NUMBER_ONLY: /^(\d+)\s+(.*)$/
  };

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async extractMetadata(fileContent: string[], filePath: string): Promise<ParsedMetadata> {
    this.logger.info(`Extracting metadata from ${fileContent.length} lines`);
    
    const pages = new Map<number, PageMetadata>();
    const lines = new Map<number, LineMetadata>();
    const fileLineMapping = new Map<number, DocumentLocation>();
    
    let currentPage: PageMetadata | null = null;
    let pageLineNumber = 0;
    let globalLineNumber = 0;
    let skipNextLine = false;
    
    for (let fileLineIndex = 0; fileLineIndex < fileContent.length; fileLineIndex++) {
      const rawLine = fileContent[fileLineIndex];
      
      if (skipNextLine) {
        skipNextLine = false;
        continue;
      }
      
      const pageHeader = this.detectPageHeader(rawLine, fileContent, fileLineIndex);
      if (pageHeader) {
        if (currentPage) {
          currentPage.endFileLine = fileLineIndex - 1;
        }
        
        currentPage = {
          pageNumber: pages.size + 1,
          trialPageNumber: pageHeader.trialPageNumber,
          parsedTrialPage: pageHeader.parsedTrialPage,
          headerText: pageHeader.headerText,
          startFileLine: fileLineIndex,
          endFileLine: fileLineIndex,
          headerLines: pageHeader.headerLines
        };
        
        pages.set(currentPage.pageNumber, currentPage);
        pageLineNumber = 0;
        
        if (pageHeader.skipLines > 0) {
          fileLineIndex += pageHeader.skipLines - 1;
        }
        continue;
      }
      
      if (this.isBlankLine(rawLine)) {
        continue;
      }
      
      if (!currentPage) {
        currentPage = {
          pageNumber: 1,
          trialPageNumber: 1,
          parsedTrialPage: 1,
          headerText: '',
          startFileLine: 0,
          endFileLine: fileLineIndex,
          headerLines: []
        };
        pages.set(1, currentPage);
      }
      
      const lineMetadata = this.extractLineMetadata(
        rawLine,
        fileLineIndex,
        pageLineNumber,
        globalLineNumber
      );
      
      if (lineMetadata) {
        lines.set(globalLineNumber, lineMetadata);
        
        fileLineMapping.set(fileLineIndex, {
          pageNumber: currentPage.pageNumber,
          lineNumber: globalLineNumber
        });
        
        pageLineNumber++;
        globalLineNumber++;
      }
    }
    
    if (currentPage) {
      currentPage.endFileLine = fileContent.length - 1;
    }
    
    this.logger.info(`Extracted ${pages.size} pages and ${lines.size} lines`);
    
    return {
      pages,
      lines,
      fileLineMapping,
      rawContent: fileContent
    };
  }

  private detectPageHeader(
    line: string,
    fileContent: string[],
    currentIndex: number
  ): { trialPageNumber: number; parsedTrialPage: number; headerText: string; headerLines: string[]; skipLines: number } | null {
    
    const singleLineMatch = this.PAGE_HEADER_PATTERN.exec(line);
    if (singleLineMatch) {
      const pageNum = parseInt(singleLineMatch[1]);
      const middleText = singleLineMatch[2];
      const trialPageNum = parseInt(singleLineMatch[3]);
      
      if (this.isValidPageHeader(pageNum, trialPageNum)) {
        return {
          trialPageNumber: trialPageNum,
          parsedTrialPage: pageNum,
          headerText: line.trim(),
          headerLines: [line],
          skipLines: 0
        };
      }
    }
    
    const firstLineMatch = this.PAGE_HEADER_MULTILINE_PATTERN.exec(line);
    if (firstLineMatch && currentIndex + 2 < fileContent.length) {
      const pageNum = parseInt(firstLineMatch[1]);
      const nextLine = fileContent[currentIndex + 1];
      const thirdLine = fileContent[currentIndex + 2];
      
      const thirdLineMatch = /^\s*(\d+)\s*$/.exec(thirdLine);
      if (thirdLineMatch) {
        const trialPageNum = parseInt(thirdLineMatch[1]);
        
        if (this.isValidPageHeader(pageNum, trialPageNum)) {
          return {
            trialPageNumber: trialPageNum,
            parsedTrialPage: pageNum,
            headerText: `${line.trim()} ${nextLine.trim()} ${thirdLine.trim()}`,
            headerLines: [line, nextLine, thirdLine],
            skipLines: 2
          };
        }
      }
    }
    
    return null;
  }

  private isValidPageHeader(pageNum: number, trialPageNum: number): boolean {
    return pageNum > 0 && pageNum < 10000 && 
           trialPageNum > 0 && trialPageNum < 10000 &&
           Math.abs(pageNum - trialPageNum) < 100;
  }

  private extractLineMetadata(
    rawLine: string,
    fileLineNumber: number,
    pageLineNumber: number,
    globalLineNumber: number
  ): LineMetadata | null {
    
    const timestampMatch = this.LINE_PREFIX_PATTERNS.TIMESTAMP_AND_NUMBER.exec(rawLine);
    if (timestampMatch) {
      return {
        fileLineNumber,
        pageLineNumber,
        timestamp: timestampMatch[1],
        prefix: `${timestampMatch[1]} ${timestampMatch[2]}`,
        contentStart: timestampMatch[0].length - timestampMatch[3].length,
        rawText: rawLine,
        cleanText: timestampMatch[3].trim()
      };
    }
    
    const spacedNumberMatch = this.LINE_PREFIX_PATTERNS.NUMBER_WITH_SPACES.exec(rawLine);
    if (spacedNumberMatch) {
      return {
        fileLineNumber,
        pageLineNumber,
        prefix: spacedNumberMatch[1],
        contentStart: spacedNumberMatch[0].length - spacedNumberMatch[2].length,
        rawText: rawLine,
        cleanText: spacedNumberMatch[2].trim()
      };
    }
    
    const numberOnlyMatch = this.LINE_PREFIX_PATTERNS.NUMBER_ONLY.exec(rawLine);
    if (numberOnlyMatch) {
      const lineNum = parseInt(numberOnlyMatch[1]);
      if (lineNum > 0 && lineNum <= 25) {
        return {
          fileLineNumber,
          pageLineNumber,
          prefix: numberOnlyMatch[1],
          contentStart: numberOnlyMatch[0].length - numberOnlyMatch[2].length,
          rawText: rawLine,
          cleanText: numberOnlyMatch[2].trim()
        };
      }
    }
    
    if (rawLine.trim().length > 0) {
      return {
        fileLineNumber,
        pageLineNumber,
        prefix: '',
        contentStart: 0,
        rawText: rawLine,
        cleanText: rawLine.trim()
      };
    }
    
    return null;
  }

  private isBlankLine(line: string): boolean {
    return line.trim().length === 0;
  }
}