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
  private readonly headerPattern = /Case\s+([\d:\-cv]+)\s+Document\s+(\d+)\s+Filed\s+([\d\/]+)\s+Page\s+(\d+)\s+of\s+(\d+)\s+PageID\s+#:\s+(\d+)/;
  
  parse(line: string): PageHeaderInfo | null {
    if (!line) return null;
    
    const match = line.match(this.headerPattern);
    if (!match) return null;
    
    return {
      caseNumber: match[1],
      documentNumber: parseInt(match[2]),
      filedDate: match[3],
      pageNumber: parseInt(match[4]),
      totalPages: parseInt(match[5]),
      pageId: match[6],  // Extract just the number part
      fullText: line
    };
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
   * This method should be called with page content to determine the section
   */
  determineDocumentSection(pageLines: string[]): 'SUMMARY' | 'PROCEEDINGS' | 'CERTIFICATION' | 'UNKNOWN' {
    // Skip empty lines and header
    const contentLines = pageLines.filter(line => line.trim() !== '').slice(1);
    
    for (const line of contentLines) {
      const trimmedLine = line.trim();
      
      // Check for PROCEEDINGS marker
      if (trimmedLine === 'P R O C E E D I N G S' || 
          /^P\s*R\s*O\s*C\s*E\s*E\s*D\s*I\s*N\s*G\s*S$/.test(trimmedLine.replace(/\s+/g, ' '))) {
        return 'PROCEEDINGS';
      }
      
      // Check for CERTIFICATION marker
      if (trimmedLine.toLowerCase().includes('certification') ||
          trimmedLine.toLowerCase().includes('certificate') ||
          /^CERTIFICATION OF TRANSCRIPT$/i.test(trimmedLine) ||
          /^COURT REPORTER'S CERTIFICATE$/i.test(trimmedLine)) {
        return 'CERTIFICATION';
      }
    }
    
    return 'UNKNOWN';
  }
}