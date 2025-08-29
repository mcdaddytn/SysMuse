import { logger } from '../utils/logger';

export interface ParsedPageHeader {
  caseNumber: string;
  documentNumber?: string;
  filingDate?: string;
  currentPage: number;
  totalPages: number;
  pageId?: string;
  parsedTrialLine?: number;
  headerText: string;
  isValid: boolean;
  hasBleed?: boolean; // When pageId bleeds into trial line number
}

export class EnhancedPageHeaderParser {
  // Pattern for standard page header components
  private readonly headerPattern = /Case\s+([\d:cv-]+\w+)\s+Document\s+(\d+)\s+Filed\s+([\d/]+)\s+Page\s+(\d+)\s+of\s+(\d+)\s+PageID\s+#:\s*([\d\s]+)/i;
  
  // Simplified pattern for when components might be on different lines
  private readonly partialPatterns = {
    caseNumber: /Case\s+([\d:cv-]+\w+)/i,
    document: /Document\s+(\d+)/i,
    filed: /Filed\s+([\d/]+)/i,
    page: /Page\s+(\d+)\s+of\s+(\d+)/i,
    pageId: /PageID\s+#:\s*([\d\s]+)/i
  };

  parse(lines: string[], pageHeaderLines: number = 2): ParsedPageHeader | null {
    if (!lines || lines.length === 0) {
      return null;
    }
    
    const headerText = lines.slice(0, pageHeaderLines).join('\n');
    
    // Based on number of header lines, use different parsing strategies
    switch (pageHeaderLines) {
      case 1:
        return this.parseSingleLineHeader(lines[0], headerText);
      case 2:
        return this.parseTwoLineHeader(lines.slice(0, 2), headerText);
      case 3:
        return this.parseThreeLineHeader(lines.slice(0, 3), headerText);
      default:
        return this.parseAutoDetect(lines, headerText);
    }
  }

  private parseSingleLineHeader(line: string, headerText: string): ParsedPageHeader | null {
    const match = line.match(this.headerPattern);
    
    if (match) {
      const [, caseNumber, documentNumber, filingDate, currentPage, totalPages, pageIdAndLine] = match;
      
      // Check for bleed between pageId and trial line number
      let pageId: string | undefined;
      let parsedTrialLine: number | undefined;
      let hasBleed = false;
      
      if (pageIdAndLine) {
        const trimmed = pageIdAndLine.trim();
        // If page number > 99, expect bleed
        if (parseInt(currentPage) > 99 && trimmed.length > 5) {
          // Assume pageId is 5 digits, rest is trial line
          pageId = trimmed.substring(0, 5);
          const lineNum = trimmed.substring(5).trim();
          if (lineNum) {
            parsedTrialLine = parseInt(lineNum);
            hasBleed = true;
          }
        } else {
          // Normal case - space separated
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            pageId = parts[0];
            parsedTrialLine = parseInt(parts[parts.length - 1]);
          } else {
            pageId = parts[0];
          }
        }
      }
      
      return {
        caseNumber,
        documentNumber,
        filingDate,
        currentPage: parseInt(currentPage),
        totalPages: parseInt(totalPages),
        pageId,
        parsedTrialLine,
        headerText,
        isValid: true,
        hasBleed
      };
    }
    
    // Try to extract what we can from partial match
    return this.extractPartialHeader(line, headerText);
  }

  private parseTwoLineHeader(lines: string[], headerText: string): ParsedPageHeader | null {
    // Combine lines and try full pattern first
    const combined = lines.join(' ');
    const fullMatch = combined.match(this.headerPattern);
    
    if (fullMatch) {
      const [, caseNumber, documentNumber, filingDate, currentPage, totalPages, pageIdPart] = fullMatch;
      
      // Second line typically has the trial line number
      const secondLine = lines[1].trim();
      const parsedTrialLine = this.extractNumberFromEnd(secondLine);
      
      return {
        caseNumber,
        documentNumber,
        filingDate,
        currentPage: parseInt(currentPage),
        totalPages: parseInt(totalPages),
        pageId: pageIdPart?.trim(),
        parsedTrialLine,
        headerText,
        isValid: true
      };
    }
    
    // Parse components separately
    const result: Partial<ParsedPageHeader> = { headerText, isValid: false };
    
    // First line usually has case info
    const caseMatch = lines[0].match(this.partialPatterns.caseNumber);
    if (caseMatch) result.caseNumber = caseMatch[1];
    
    const docMatch = lines[0].match(this.partialPatterns.document);
    if (docMatch) result.documentNumber = docMatch[1];
    
    const pageMatch = lines[0].match(this.partialPatterns.page);
    if (pageMatch) {
      result.currentPage = parseInt(pageMatch[1]);
      result.totalPages = parseInt(pageMatch[2]);
    }
    
    const pageIdMatch = lines[0].match(this.partialPatterns.pageId);
    if (pageIdMatch) result.pageId = pageIdMatch[1].trim();
    
    // Second line often has the trial line number
    if (lines[1]) {
      result.parsedTrialLine = this.extractNumberFromEnd(lines[1]);
    }
    
    if (result.caseNumber) {
      return result as ParsedPageHeader;
    }
    
    return null;
  }

  private parseThreeLineHeader(lines: string[], headerText: string): ParsedPageHeader | null {
    // Three-line headers typically have:
    // Line 1: Case info up to PageID
    // Line 2: PageID number
    // Line 3: Trial line number
    
    const result: Partial<ParsedPageHeader> = { headerText, isValid: false };
    
    // Parse first line
    const caseMatch = lines[0].match(this.partialPatterns.caseNumber);
    if (caseMatch) result.caseNumber = caseMatch[1];
    
    const docMatch = lines[0].match(this.partialPatterns.document);
    if (docMatch) result.documentNumber = docMatch[1];
    
    const pageMatch = lines[0].match(this.partialPatterns.page);
    if (pageMatch) {
      result.currentPage = parseInt(pageMatch[1]);
      result.totalPages = parseInt(pageMatch[2]);
    }
    
    // Second line typically has PageID value
    if (lines[1]) {
      const pageIdNum = this.extractNumber(lines[1]);
      if (pageIdNum) result.pageId = pageIdNum.toString();
    }
    
    // Third line has trial line number
    if (lines[2]) {
      result.parsedTrialLine = this.extractNumberFromEnd(lines[2]);
    }
    
    if (result.caseNumber) {
      result.isValid = true;
      return result as ParsedPageHeader;
    }
    
    return null;
  }

  private parseAutoDetect(lines: string[], headerText: string): ParsedPageHeader | null {
    // Try to detect the header format automatically
    // Look for "Case" keyword to identify header start
    let headerEndIdx = 0;
    
    for (let i = 0; i < Math.min(lines.length, 4); i++) {
      if (lines[i].includes('Case') && lines[i].includes('Document')) {
        // Found header start, check how many lines it spans
        if (lines[i].includes('PageID')) {
          // Check if complete on this line
          if (this.extractNumberFromEnd(lines[i])) {
            headerEndIdx = i + 1;
          } else if (i + 1 < lines.length) {
            headerEndIdx = i + 2;
            if (i + 2 < lines.length && /^\s*\d+\s*$/.test(lines[i + 2])) {
              headerEndIdx = i + 3;
            }
          }
        }
        break;
      }
    }
    
    if (headerEndIdx > 0) {
      const detectedLines = headerEndIdx;
      logger.debug(`Auto-detected ${detectedLines}-line page header`);
      return this.parse(lines, detectedLines);
    }
    
    return null;
  }

  private extractPartialHeader(text: string, headerText: string): ParsedPageHeader | null {
    const result: Partial<ParsedPageHeader> = { headerText, isValid: false };
    
    for (const [key, pattern] of Object.entries(this.partialPatterns)) {
      const match = text.match(pattern);
      if (match) {
        switch (key) {
          case 'caseNumber':
            result.caseNumber = match[1];
            break;
          case 'document':
            result.documentNumber = match[1];
            break;
          case 'filed':
            result.filingDate = match[1];
            break;
          case 'page':
            result.currentPage = parseInt(match[1]);
            result.totalPages = parseInt(match[2]);
            break;
          case 'pageId':
            result.pageId = match[1].trim();
            break;
        }
      }
    }
    
    if (result.caseNumber) {
      result.isValid = true;
      return result as ParsedPageHeader;
    }
    
    return null;
  }

  private extractNumber(text: string): number | undefined {
    const match = text.match(/\d+/);
    return match ? parseInt(match[0]) : undefined;
  }

  private extractNumberFromEnd(text: string): number | undefined {
    const trimmed = text.trim();
    const match = trimmed.match(/(\d+)\s*$/);
    return match ? parseInt(match[1]) : undefined;
  }

  isPageHeader(lines: string[]): boolean {
    if (!lines || lines.length === 0) return false;
    
    // Check first line for typical header pattern
    return lines[0].includes('Case') && 
           lines[0].includes('Document') && 
           lines[0].includes('Page');
  }
}