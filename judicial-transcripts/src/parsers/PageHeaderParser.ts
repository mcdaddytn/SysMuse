// src/parsers/phase1/PageHeaderParser.ts
// src/parsers/PageHeaderParser.ts
import logger from '../../utils/logger';

export interface PageHeaderInfo {
  caseNumber?: string;
  documentNumber?: number;
  filedDate?: string;
  pageNumber?: number;
  totalPages?: number;
  pageId?: string;
  transcriptPageNumber?: number;
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
      pageId: match[6],
      fullText: line
    };
  }
  
  parseTranscriptPageNumber(lines: string[]): number | null {
    // Look for standalone page number on second line
    if (lines.length > 1) {
      const secondLine = lines[1].trim();
      if (/^\d+$/.test(secondLine)) {
        return parseInt(secondLine);
      }
    }
    return null;
  }
}
