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
    
    // Check for Case document header pattern (2-line header)
    // First line: Case 2:19-cv-00123-JRG Document XXX Filed MM/DD/YY Page X of Y PageID #: ZZZZZ
    // Second line: page number
    // Make sure the line doesn't start with a line number prefix (avoid "25 Case..." patterns)
    const trimmedLine = line.trim();
    
    // Skip if line starts with a line number followed by Case (this is a false positive)
    if (/^\d{1,2}\s+Case\s+/.test(trimmedLine)) {
      return null;
    }
    
    const caseHeaderPattern = /^\s*Case\s+[\d:cv-]+.*Document\s+\d+.*Page\s+(\d+)\s+of\s+\d+\s+PageID/i;
    const caseMatch = caseHeaderPattern.exec(line);
    
    if (caseMatch && currentIndex + 1 < fileContent.length) {
      const nextLine = fileContent[currentIndex + 1];
      const pageNumMatch = /^\s*(\d+)\s*$/.exec(nextLine.trim());
      
      if (pageNumMatch) {
        const pageNum = parseInt(pageNumMatch[1]);
        // Validate the page number is reasonable
        if (pageNum > 0 && pageNum < 10000) {
          return {
            trialPageNumber: pageNum,
            parsedTrialPage: pageNum,
            headerText: `${line.trim()}\n${nextLine.trim()}`,
            headerLines: [line, nextLine],
            skipLines: 1
          };
        }
      }
    }
    
    // Skip the traditional court header patterns for now as they're causing false positives
    // These patterns like "18  19" or "23  24" are not real page headers
    // The real headers are the Case document headers above
    
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