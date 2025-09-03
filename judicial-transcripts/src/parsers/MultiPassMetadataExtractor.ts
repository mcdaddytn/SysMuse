import { Logger } from '../utils/logger';
import {
  ParsedMetadata,
  PageMetadata,
  LineMetadata,
  DocumentLocation
} from './MultiPassTypes';

export class MetadataExtractor {
  private logger: Logger;
  private pageHeaderLines: number;
  
  private readonly PAGE_HEADER_PATTERN = /^\s*(\d+)\s+(.+?)\s+(\d+)\s*$/;
  
  private readonly PAGE_HEADER_MULTILINE_PATTERN = /^\s*(\d+)\s*$/;
  
  private readonly LINE_PREFIX_PATTERNS = {
    TIMESTAMP_AND_NUMBER: /^(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.*)$/,
    
    NUMBER_WITH_SPACES: /^(\d{1,2})\s{2,}(.*)$/,
    
    NUMBER_ONLY: /^(\d+)\s+(.*)$/
  };

  constructor(logger: Logger, pageHeaderLines: number = 2) {
    this.logger = logger;
    this.pageHeaderLines = pageHeaderLines;
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
          pageId: pageHeader.pageId,
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
          pageId: undefined,
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
      // Add the last page to the collection if it hasn't been added yet
      if (!pages.has(currentPage.pageNumber)) {
        pages.set(currentPage.pageNumber, currentPage);
      }
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
  ): { trialPageNumber: number; parsedTrialPage: number; pageId?: string; headerText: string; headerLines: string[]; skipLines: number } | null {
    
    // Check for Case document header pattern (2-line header)
    // First line: Case 2:19-cv-00123-JRG Document XXX Filed MM/DD/YY Page X of Y PageID #: ZZZZZ
    // Second line: page number
    // Make sure the line doesn't start with a line number prefix (avoid "25 Case..." patterns)
    const trimmedLine = line.trim();
    
    // Skip if line starts with a line number followed by Case (this is a false positive)
    if (/^\d{1,2}\s+Case\s+/.test(trimmedLine)) {
      return null;
    }
    
    // Extract PageID from the header line
    // Handle two patterns: PageID on same line, or PageID on next line
    const caseHeaderPattern = /^\s*Case\s+[\d:\w-]+.*Document\s+\d+.*Page\s+(\d+)\s+of\s+\d+\s+PageID\s*#?:?\s*(\d*)/i;
    const caseMatch = caseHeaderPattern.exec(line);
    
    if (caseMatch) {
      let pageId = caseMatch[2]; // Extract PageID from the regex match
      const headerLines: string[] = [line];
      let pageNum: number | null = null;
      // Use pageHeaderLines as the maximum search distance, but stop early if we find content
      let searchLimit = Math.min(currentIndex + this.pageHeaderLines, fileContent.length);
      
      // If PageID wasn't on the first line, check if it's on the next line
      if (!pageId && currentIndex + 1 < fileContent.length) {
        const nextLine = fileContent[currentIndex + 1].trim();
        if (/^\d+$/.test(nextLine) && nextLine.length > 3) {
          // Likely a PageID (more than 3 digits)
          pageId = nextLine;
          headerLines.push(fileContent[currentIndex + 1]);
        }
      }
      
      // Look for page number on the next line only (after header and possibly PageID)
      // Don't search beyond 1-2 lines after the header
      let foundPageNum = false;
      for (let i = currentIndex + 1; i < searchLimit && i <= currentIndex + 2; i++) {
        const nextLine = fileContent[i];
        const trimmed = nextLine.trim();
        
        // Skip if we already added this as PageID
        if (trimmed === pageId) {
          continue;
        }
        
        if (trimmed === '') {
          // Only add blank lines if we haven't found the page number yet
          if (!foundPageNum) {
            headerLines.push(nextLine);
          }
          continue;
        }
        
        // Check if it's a page number (digits only, 1-4 digits)
        const pageNumMatch = /^\s*(\d{1,4})\s*$/.exec(trimmed);
        if (pageNumMatch) {
          const num = parseInt(pageNumMatch[1]);
          // Page numbers should be reasonable (not PageID which is typically > 1000)
          if (num <= 999) {
            pageNum = num;
            headerLines.push(nextLine);
            foundPageNum = true;
            break;
          }
        }
        
        // If we hit any non-numeric content, stop looking
        // This is actual transcript content, not part of header
        break;
      }
      
      // Even if we don't find a page number, we still detected a page header
      if (!pageNum) {
        // Try to extract page number from the header itself
        const headerPageMatch = caseMatch[1];
        if (headerPageMatch) {
          pageNum = parseInt(headerPageMatch);
        }
      }
      
      // Always return when we find a Case header pattern
      return {
        trialPageNumber: pageNum || 0,
        parsedTrialPage: pageNum || 0,
        pageId: pageId,
        headerText: headerLines.join('\n'),
        headerLines: headerLines,
        skipLines: headerLines.length  // Skip exactly the number of header lines we found
      };
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