// src/parsers/PageHeaderParser.ts

export interface PageHeaderInfo {
  caseNumber?: string;
  documentNumber?: number;
  filedDate?: string;
  pageNumber?: number;
  totalPages?: number;
  pageId?: string;        // Extracted from PageID #: XXXXX
  trialPageNumber?: number; // Page number within entire trial (from second line)
  fullText: string;
}

export class PageHeaderParser {
  private readonly headerPattern = /^\s*Case\s+([\d:\-cv]+)\s+Document\s+(\d+)\s+Filed\s+([\d\/]+)\s+Page\s+(\d+)\s+of\s+(\d+)\s+PageID\s+#:\s+(\d+)/i;
  
  parse(line: string): PageHeaderInfo | null {
    if (!line) return null;
    
    // Simple approach: Just take the line as headerText and extract pageId
    const headerText = line.trim();
    
    // Extract pageId - look for "PageID #: " and take the number after it
    let pageId: string | undefined;
    const pageIdMatch = headerText.match(/PageID #:\s*(\d+)/);
    if (pageIdMatch) {
      pageId = pageIdMatch[1];
    }
    
    // Still try the regex for other components, but don't fail if it doesn't match
    const match = line.match(this.headerPattern);
    
    if (match) {
      return {
        caseNumber: match[1],
        documentNumber: parseInt(match[2]),
        filedDate: match[3],
        pageNumber: parseInt(match[4]),
        totalPages: parseInt(match[5]),
        pageId: pageId || match[6],
        fullText: headerText
      };
    } else {
      // If regex fails, just return what we can extract simply
      return {
        caseNumber: undefined,
        documentNumber: undefined,
        filedDate: undefined,
        pageNumber: undefined,
        totalPages: undefined,
        pageId: pageId,
        fullText: headerText
      };
    }
  }
  
  /**
   * Parse trial page number from lines following the header
   * This is typically a standalone number on the second line after the header
   */
  parseTrialPageNumber(lines: string[]): number | null {
    // Look for standalone page number on second line
    if (lines.length > 1) {
      const secondLine = lines[1].trim();
      if (/^\d+$/.test(secondLine)) {
        return parseInt(secondLine);
      }
    }
    return null;
  }
  
  /**
   * Determine document section based on content analysis
   * Look for specific patterns in the 3rd non-blank line after header
   */
  determineDocumentSection(pageLines: string[]): 'SUMMARY' | 'PROCEEDINGS' | 'CERTIFICATION' | 'UNKNOWN' {
    // Filter out blank lines and get content lines
    const nonBlankLines = pageLines.filter(line => line.trim() !== '');
    
    // Debug logging
    console.log(`DEBUG: Page has ${nonBlankLines.length} non-blank lines`);
    if (nonBlankLines.length >= 3) {
      console.log(`DEBUG: Third line is: "${nonBlankLines[2].trim()}"`);
    }
    
    // We need at least 3 non-blank lines (header, page number, content)
    if (nonBlankLines.length < 3) {
      return 'UNKNOWN';
    }
    
    // The 3rd non-blank line should contain our section marker
    const thirdLine = nonBlankLines[2].trim();
    
    // Check for PROCEEDINGS marker - look for it anywhere in the line (with timestamp prefix)
    if (thirdLine.includes('P R O C E E D I N G S')) {
      console.log('DEBUG: Found PROCEEDINGS marker');
      return 'PROCEEDINGS';
    }
    
    // Check for CERTIFICATION marker - look for it anywhere in the line
    if (thirdLine.includes('CERTIFICATION')) {
      console.log('DEBUG: Found CERTIFICATION marker');
      return 'CERTIFICATION';
    }
    
    // Also check all lines in case the markers appear elsewhere
    for (const line of nonBlankLines) {
      const trimmedLine = line.trim();
      
      // Look for standalone PROCEEDINGS
      if (trimmedLine === 'P R O C E E D I N G S' || trimmedLine.endsWith('P R O C E E D I N G S')) {
        console.log('DEBUG: Found PROCEEDINGS marker in line scan');
        return 'PROCEEDINGS';
      }
      
      // Look for standalone CERTIFICATION  
      if (trimmedLine === 'CERTIFICATION' || trimmedLine.endsWith('CERTIFICATION')) {
        console.log('DEBUG: Found CERTIFICATION marker in line scan');
        return 'CERTIFICATION';
      }
    }
    
    console.log('DEBUG: No section marker found, returning UNKNOWN');
    return 'UNKNOWN';
  }
}