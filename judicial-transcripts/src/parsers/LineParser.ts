// src/parsers/LineParser.ts
import { ParsedLine } from '../types/config.types';
import logger from '../utils/logger';

export class LineParser {
  // Speaker patterns for extracting speaker prefix from the text content
  private readonly speakerPatterns = [
    // THE COURT: pattern
    /^\s*(THE COURT):\s*(.*)$/,
    // COURT SECURITY OFFICER: pattern
    /^\s*(COURT SECURITY OFFICER):\s*(.*)$/,
    // MR./MS./MRS./DR. NAME: pattern  
    /^\s*((?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    // JUROR NAME: pattern
    /^\s*(JUROR\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    // Q./A. pattern (these don't have colons)
    /^\s*(Q\.|A\.)\s+(.*)$/,
    // BY MR./MS. pattern
    /^\s*(BY\s+(?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    // THE WITNESS: pattern
    /^\s*(THE WITNESS):\s*(.*)$/,
    // Other formal speakers (WITNESS, BAILIFF, etc.)
    /^\s*((?:WITNESS|BAILIFF|COURT REPORTER|INTERPRETER)):\s*(.*)$/i,
    // Generic capitalized speaker pattern (any capitalized word(s) followed by colon)
    /^\s*([A-Z][A-Z\s]*?):\s*(.*)$/
  ];
  
  // Pattern for court directives (parenthetical content)
  private readonly directivePattern = /^\s*\((.*?)\)\s*$/;
  
  parse(line: string): ParsedLine | null {
    // Check if line is blank
    if (!line || line.trim() === '') {
      return {
        lineNumber: 0,
        timestamp: undefined,
        text: '',
        speakerPrefix: undefined,
        isBlank: true
      };
    }
    
    let timestamp: string | undefined;
    let lineNumber = 0;
    let content = '';
    
    // Detect line format based on fixed positions
    // Check if this is a 13-character header line (PROCEEDINGS format)
    if (line.length >= 13) {
      // First 8 chars might be timestamp (HH:MM:SS) or spaces
      const first8 = line.substring(0, 8);
      // Next 5 chars should be line number
      const lineNumStr = line.substring(8, 13).trim();
      const possibleLineNum = parseInt(lineNumStr);
      
      // If we have a valid line number in positions 8-13, this is a PROCEEDINGS line
      if (possibleLineNum > 0) {
        // Check if first 8 chars contain a timestamp
        if (first8[2] === ':' && first8[5] === ':') {
          timestamp = first8.trim();
        }
        lineNumber = possibleLineNum;
        content = line.substring(13).trim();
      }
      // Otherwise check if it's a 7-character SUMMARY format
      else {
        const firstSeven = line.substring(0, 7).trim();
        const summaryLineNum = parseInt(firstSeven);
        if (summaryLineNum > 0 && line.length > 7) {
          lineNumber = summaryLineNum;
          content = line.substring(7).trim();
        } else {
          // Not a formatted line
          content = line.trim();
        }
      }
    }
    // Check for 7-character header (SUMMARY format)
    else if (line.length >= 7) {
      const firstSeven = line.substring(0, 7).trim();
      const possibleLineNum = parseInt(firstSeven);
      
      if (possibleLineNum > 0 && line.length > 7) {
        lineNumber = possibleLineNum;
        content = line.substring(7).trim();
      } else {
        content = line.trim();
      }
    } else {
      // Short line, treat as plain text
      content = line.trim();
    }
    
    // Skip page headers and footers
    if (this.isPageHeaderOrFooter(content)) {
      return {
        lineNumber: 0,
        timestamp: undefined,
        text: '',
        speakerPrefix: undefined,
        isBlank: true
      };
    }
    
    // If we have no content, treat as blank
    if (!content) {
      return {
        lineNumber,
        timestamp,
        text: '',
        speakerPrefix: undefined,
        isBlank: true
      };
    }
    
    // Check for speaker patterns in the content
    const speakerResult = this.extractSpeakerFromText(content);
    
    return {
      lineNumber,
      timestamp,
      text: speakerResult.text !== undefined ? speakerResult.text : content,
      speakerPrefix: speakerResult.speakerPrefix,
      isBlank: false
    };
  }
  
  private extractSpeakerFromText(text: string): { speakerPrefix?: string; text?: string } {
    if (!text) return { text: '' };
    
    // Check each speaker pattern
    for (const pattern of this.speakerPatterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          speakerPrefix: match[1].trim(),
          text: match[2] !== undefined ? match[2].trim() : ''
        };
      }
    }
    
    // Check for court directive (parenthetical content)
    const directiveMatch = text.match(this.directivePattern);
    if (directiveMatch) {
      return {
        text: text  // Keep the full directive text including parentheses
      };
    }
    
    // No speaker found, return original text
    return { text };
  }
  
  private isPageHeaderOrFooter(line: string): boolean {
    // Skip common page header/footer patterns
    if (line.includes('Case 2:19-cv-00123-JRG Document')) return true;
    if (line.match(/^\s*\d+\s*$/)) return true; // Just a page number
    if (line.includes('PageID #:')) return true;
    
    return false;
  }
}