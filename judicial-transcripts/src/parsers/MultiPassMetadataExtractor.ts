import { Logger } from '../utils/logger';
import {
  ParsedMetadata,
  PageMetadata,
  LineMetadata,
  DocumentLocation
} from './MultiPassTypes';
import { SmartPageHeaderParser, ParsedPageHeader } from './SmartPageHeaderParser';

export class MetadataExtractor {
  private logger: Logger;
  private pageHeaderLines: number;
  private smartHeaderParser: SmartPageHeaderParser;
  
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
    this.smartHeaderParser = new SmartPageHeaderParser(pageHeaderLines);
  }

  async extractMetadata(fileContent: string[], filePath: string): Promise<ParsedMetadata> {
    this.logger.info(`Extracting metadata from ${fileContent.length} lines`);
    
    // First, detect page boundaries using page breaks
    const pageStarts = this.detectPageBoundaries(fileContent);
    this.logger.info(`Detected ${pageStarts.length} page boundaries`);
    
    const pages = new Map<number, PageMetadata>();
    const lines = new Map<number, LineMetadata>();
    const fileLineMapping = new Map<number, DocumentLocation>();
    
    let globalLineNumber = 0;
    
    // Process each page
    for (let pageIdx = 0; pageIdx < pageStarts.length; pageIdx++) {
      const pageStartLine = pageStarts[pageIdx];
      const pageEndLine = (pageIdx + 1 < pageStarts.length) ? pageStarts[pageIdx + 1] - 1 : fileContent.length - 1;
      
      // First, grab the actual header lines for storage
      const actualHeaderLines: string[] = [];
      for (let i = 0; i < this.pageHeaderLines && pageStartLine + i <= pageEndLine; i++) {
        const line = fileContent[pageStartLine + i];
        if (line !== undefined) {
          actualHeaderLines.push(line);
        }
      }
      const actualHeaderText = actualHeaderLines.join('\n');
      
      // Use SmartPageHeaderParser for header detection
      const headerResult = this.smartHeaderParser.parseHeader(fileContent, pageStartLine);
      
      // Create page metadata - ALWAYS use the actual header text we captured
      const pageNumber = pageIdx + 1;
      const currentPage: PageMetadata = {
        pageNumber,
        trialPageNumber: headerResult.parsedTrialPage || headerResult.parsedPageNumber || pageNumber,
        parsedTrialPage: headerResult.parsedTrialPage || headerResult.parsedPageNumber || pageNumber,
        pageId: headerResult.pageId || (headerResult.lineRangeText ? `${headerResult.startLineNumber}-${headerResult.endLineNumber}` : undefined),
        headerText: actualHeaderText,  // Use the actual header lines we captured
        startFileLine: pageStartLine,
        endFileLine: pageEndLine,
        headerLines: actualHeaderLines  // Use actual header lines array
      };
      
      pages.set(pageNumber, currentPage);
      
      // Process transcript lines (skip header lines)
      // Use the maximum of what the parser detected or our configured header lines
      const headerLinesCount = Math.max(headerResult.headerLinesUsed, actualHeaderLines.length);
      const transcriptStartLine = pageStartLine + headerLinesCount;
      let pageLineNumber = 0;
      
      // Process main transcript content (skip the header lines entirely)
      for (let fileLineIndex = transcriptStartLine; fileLineIndex <= pageEndLine; fileLineIndex++) {
        const rawLine = fileContent[fileLineIndex];
      
        if (this.isBlankLine(rawLine)) {
          continue;
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
            pageNumber,
            lineNumber: globalLineNumber
          });
          
          pageLineNumber++;
          globalLineNumber++;
        }
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

  private detectPageBoundaries(fileContent: string[]): number[] {
    const pageStarts: number[] = [0];  // First page always starts at line 0
    let foundFormFeeds = false;
    
    // Look for form feed characters in the file content
    for (let i = 0; i < fileContent.length; i++) {
      const line = fileContent[i];
      if (line && line.includes('\f')) {
        foundFormFeeds = true;
        // Form feed found - the NEXT line starts a new page
        // (unless the form feed is at the very end of the line with nothing after it)
        const formFeedIndex = line.indexOf('\f');
        if (formFeedIndex < line.length - 1) {
          // There's content after the form feed on the same line
          // Split the line and treat the part after \f as the start of a new page
          const beforeFF = line.substring(0, formFeedIndex);
          const afterFF = line.substring(formFeedIndex + 1);
          
          // Replace the current line with just the part before form feed
          fileContent[i] = beforeFF;
          
          // Insert the part after form feed as a new line
          if (afterFF.trim()) {
            fileContent.splice(i + 1, 0, afterFF);
            // The new page starts at the newly inserted line
            pageStarts.push(i + 1);
          } else if (i + 1 < fileContent.length) {
            // If nothing after form feed, next line is the page start
            pageStarts.push(i + 1);
          }
        } else if (i + 1 < fileContent.length) {
          // Form feed is at the end of the line, next line starts new page
          pageStarts.push(i + 1);
        }
      }
    }
    
    if (!foundFormFeeds) {
      this.logger.info('No page breaks found, falling back to header-based page detection');
      return this.detectPageBoundariesByHeaders(fileContent);
    }
    
    this.logger.info(`Detected ${pageStarts.length} pages using form feed characters`);
    return pageStarts;
  }
  
  private detectPageBoundariesByHeaders(fileContent: string[]): number[] {
    const pageStarts: number[] = [0];
    
    for (let i = 1; i < fileContent.length; i++) {
      // Use smart header parser to check if this looks like a page start
      const headerResult = this.smartHeaderParser.parseHeader(fileContent, i);
      
      // If we found header content with page numbers, it's likely a page start
      if (headerResult.parsedPageNumber || headerResult.parsedTrialPage) {
        // Make sure we're not too close to the last page start
        const lastPageStart = pageStarts[pageStarts.length - 1];
        if (i - lastPageStart > 10) {  // Minimum 10 lines between pages
          pageStarts.push(i);
        }
      }
    }
    
    return pageStarts;
  }
  
  private detectPageHeader(
    line: string,
    fileContent: string[],
    currentIndex: number
  ): { trialPageNumber: number; parsedTrialPage: number; pageId?: string; headerText: string; headerLines: string[]; skipLines: number } | null {
    
    if (!line) return null;  // Safety check for undefined/null lines
    
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
      if (!pageId && currentIndex + 1 < fileContent.length && fileContent[currentIndex + 1]) {
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
        if (!nextLine) continue;  // Skip undefined lines
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
    
    if (!rawLine) return null;  // Safety check for undefined/null lines
    
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
    return !line || line.trim().length === 0;
  }
}