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
    
    // Check if line starts with timestamp format (HH:MM:SS)
    // Format is fixed: 8 chars for timestamp, 5 chars for line number, then content
    if (line.length > 13 && line[2] === ':' && line[5] === ':') {
      // Extract timestamp (first 8 characters)
      const timestamp = line.substring(0, 8);
      
      // Extract line number (next 5 characters, trimmed)
      const lineNumberStr = line.substring(8, 13).trim();
      const lineNumber = parseInt(lineNumberStr) || 0;
      
      // Extract the rest as content (after position 13)
      const content = line.substring(13).trim();
      
      // Debug logging
      if (content.includes('COURT SECURITY OFFICER')) {
        logger.debug(`Parsing line with COURT SECURITY OFFICER:`);
        logger.debug(`  Raw line: "${line}"`);
        logger.debug(`  Timestamp: "${timestamp}"`);
        logger.debug(`  Line number: ${lineNumber}`);
        logger.debug(`  Content: "${content}"`);
      }
      
      // Check for speaker in the content
      const speakerResult = this.extractSpeakerFromText(content);
      
      return {
        lineNumber,
        timestamp,
        text: speakerResult.text !== undefined ? speakerResult.text : content,
        speakerPrefix: speakerResult.speakerPrefix,
        isBlank: false
      };
    }
    
    // Line without timestamp - could be continuation, header, or standalone text
    const trimmedLine = line.trim();
    
    // Skip page headers and footers
    if (this.isPageHeaderOrFooter(trimmedLine)) {
      return {
        lineNumber: 0,
        timestamp: undefined,
        text: '',
        speakerPrefix: undefined,
        isBlank: true
      };
    }
    
    // Check for speaker patterns in non-timestamped lines
    const speakerResult = this.extractSpeakerFromText(trimmedLine);
    
    return {
      lineNumber: 0,
      timestamp: undefined,
      text: speakerResult.text !== undefined ? speakerResult.text : trimmedLine,
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