import { logger } from '../utils/logger';

export interface ParsedPageHeader {
  // Main header line (case info through "Page X of Y")
  headerMainLine: string;
  caseNumber: string | null;
  parsedPageNumber: number | null;  // From "Page X of Y"
  parsedTotalPages: number | null;  // From "Page X of Y"
  
  // Line range (e.g., "1:1 - 25:25")
  lineRangeText: string | null;
  startLineNumber: number | null;
  endLineNumber: number | null;
  
  // Standalone page number (the trailing/leading integer)
  parsedTrialPage: number | null;
  
  // PageID for Case headers
  pageId: string | null;
  
  // Metadata
  headerLinesUsed: number;
  remainingLines: string[];  // Non-header lines for transcript
  fullHeaderText: string;    // Complete header text for storage
}

export class SmartPageHeaderParser {
  private pageHeaderLines: number;  // Only configuration needed
  
  constructor(pageHeaderLines: number = 3) {
    this.pageHeaderLines = pageHeaderLines;
  }
  
  parseHeader(lines: string[], pageStartIndex: number): ParsedPageHeader {
    const result: ParsedPageHeader = {
      headerMainLine: '',
      caseNumber: null,
      parsedPageNumber: null,
      parsedTotalPages: null,
      lineRangeText: null,
      startLineNumber: null,
      endLineNumber: null,
      parsedTrialPage: null,
      pageId: null,
      headerLinesUsed: 0,
      remainingLines: [],
      fullHeaderText: ''
    };
    
    // Extract header lines - use configured amount
    const headerCandidates = lines.slice(
      pageStartIndex, 
      Math.min(pageStartIndex + this.pageHeaderLines, lines.length)
    );
    
    let headerLinesProcessed = 0;
    let foundCaseLine = false;
    let lastContentLine = 0;  // Track last line with header content (0-based index)
    
    // Check what we need to find
    const needsCase = true;
    const needsPageOf = true;
    const needsPageNum = true;
    
    // Process each line looking for components
    for (let i = 0; i < headerCandidates.length; i++) {
      const line = headerCandidates[i];
      if (!line) continue;  // Skip undefined lines
      const trimmed = line.trim();
      
      // Skip completely blank lines but track position
      if (!trimmed) {
        continue;
      }
      
      let foundSomething = false;
      
      // Component 1: Case number (anywhere in the line)
      if (!result.caseNumber) {
        const caseMatch = trimmed.match(/Case\s+([\w:.-]+)/i);
        if (caseMatch) {
          result.caseNumber = caseMatch[1];
          foundCaseLine = true;
          foundSomething = true;
          lastContentLine = i;
        }
      }
      
      // Component 2: Page X of Y (anywhere in the line)
      if (!result.parsedPageNumber) {
        const pageOfMatch = trimmed.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
        if (pageOfMatch) {
          result.parsedPageNumber = parseInt(pageOfMatch[1]);
          result.parsedTotalPages = parseInt(pageOfMatch[2]);
          foundSomething = true;
          lastContentLine = i;
        }
      }
      
      // Component 3: PageID (might be split across lines)
      if (!result.pageId) {
        // Check if this line has PageID followed by number
        const pageIdMatch = trimmed.match(/PageID\s*#?\s*:?\s*(\d+)/i);
        if (pageIdMatch) {
          result.pageId = pageIdMatch[1];
          foundSomething = true;
          lastContentLine = i;
        }
        // Check if current line ends with "PageID #:" (split format)
        else if (/PageID\s*#?\s*:?\s*$/i.test(trimmed)) {
          // Look at next line for the PageID number
          if (i + 1 < headerCandidates.length && headerCandidates[i + 1]) {
            const nextLine = headerCandidates[i + 1].trim();
            // PageID numbers are typically 4+ digits
            const pageIdNumberMatch = nextLine.match(/^\s*(\d{3,})\s*$/);
            if (pageIdNumberMatch) {
              result.pageId = pageIdNumberMatch[1];
              foundSomething = true;
              lastContentLine = i + 1;  // Mark that we've consumed the next line
              
              // For split format, page number often follows on line after PageID number
              // We'll handle that in the standalone page number section
            }
          }
        }
      }
      
      // Component 4: Line range (e.g., "1:1 - 25:25")
      if (!result.lineRangeText) {
        const lineRangeMatch = trimmed.match(/(\d+)(?::\d+)?\s*[-–to]+\s*(\d+)(?::\d+)?/);
        if (lineRangeMatch) {
          result.lineRangeText = lineRangeMatch[0];
          result.startLineNumber = parseInt(lineRangeMatch[1]);
          result.endLineNumber = parseInt(lineRangeMatch[2]);
          foundSomething = true;
          lastContentLine = i;
        }
      }
      
      // Component 5: Standalone page number (just a small number on its own line)
      // Only look for this AFTER we've found PageID or as a standalone number
      if (!result.parsedTrialPage && i <= lastContentLine + 1) {
        // Check if it's a standalone small number
        const standaloneMatch = trimmed.match(/^\s*(\d{1,3})\s*$/);
        if (standaloneMatch) {
          const num = parseInt(standaloneMatch[1]);
          // Don't confuse large PageIDs with page numbers
          if (num < 1000) {
            // Only accept if we've already found PageID or this is within expected header lines
            if (result.pageId || i < 3) {
              result.parsedTrialPage = num;
              foundSomething = true;
              lastContentLine = i;
            }
          }
        }
      }
      
      // Check for unexpected content - if we haven't found anything, this might be transcript
      if (!foundSomething && trimmed) {
        // Special case: if it's just a number and we're expecting PageID continuation, allow it
        if (i == lastContentLine + 1 && /^\s*\d+\s*$/.test(trimmed)) {
          // This could be a PageID number or page number following the header
          const num = parseInt(trimmed);
          if (!result.pageId && num >= 1000) {
            // Large number after header line, might be PageID
            continue;
          } else if (!result.parsedTrialPage && num < 1000) {
            // Small number, likely page number
            result.parsedTrialPage = num;
            foundSomething = true;
            lastContentLine = i;
          }
        } else if (!/^\s*\d+\s*$/.test(trimmed)) {
          // Non-numeric content that doesn't match any header pattern
          // This is likely transcript content - stop processing here
          logger.debug(`Found non-header content at line ${i}, stopping header parsing`);
          break;
        }
      }
      
      // If we found Case line, that's usually the main header
      if (foundCaseLine && !result.headerMainLine) {
        result.headerMainLine = line;
      }
      
      // Early exit: if we found all main components on first line(s), stop
      if (result.caseNumber && result.parsedPageNumber && result.parsedTrialPage) {
        headerLinesProcessed = lastContentLine + 1;
        break;
      }
    }
    
    // Set header lines used based on actual content found
    if (lastContentLine >= 0) {
      // Only consume lines up to the last line with header content
      result.headerLinesUsed = Math.max(2, lastContentLine + 1);
      result.headerLinesUsed = Math.min(result.headerLinesUsed, this.pageHeaderLines);
    } else {
      result.headerLinesUsed = 0;
    }
    
    // Store the full header text
    if (result.headerLinesUsed > 0) {
      result.fullHeaderText = headerCandidates.slice(0, result.headerLinesUsed).join('\n');
    }
    
    // Return unused lines as potential transcript content
    if (result.headerLinesUsed < headerCandidates.length) {
      result.remainingLines = headerCandidates.slice(result.headerLinesUsed);
    }
    
    return result;
  }
}