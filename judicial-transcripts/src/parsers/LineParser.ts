// src/parsers/LineParser.ts
import { ParsedLine, TrialStyleConfig } from '../types/config.types';
import { QAPatternDetector } from '../services/QAPatternDetector';
import logger from '../utils/logger';

export class LineParser {
  private qaDetector: QAPatternDetector | null = null;
  private trialConfig: TrialStyleConfig | null = null;
  
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
  
  constructor(trialConfig?: TrialStyleConfig) {
    this.trialConfig = trialConfig || null;
    if (trialConfig) {
      this.qaDetector = new QAPatternDetector(trialConfig);
    }
  }
  
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
    let linePrefix: string | undefined;
    let content = '';
    
    // Simple logic: Check what the line starts with
    
    // Check if line starts with a timestamp (HH:MM:SS format)
    if (line.length >= 8 && line[2] === ':' && line[5] === ':') {
      // This is a PROCEEDINGS format line with timestamp
      timestamp = line.substring(0, 8).trim();
      
      // After timestamp, find the line number (skip spaces)
      let pos = 8;
      while (pos < line.length && line[pos] === ' ') pos++;
      
      // Now get the line number
      let numEnd = pos;
      while (numEnd < line.length && line[numEnd] >= '0' && line[numEnd] <= '9') numEnd++;
      
      if (numEnd > pos) {
        lineNumber = parseInt(line.substring(pos, numEnd));
        linePrefix = line.substring(0, numEnd);
        
        // Skip spaces after line number to get to content
        let contentStart = numEnd;
        while (contentStart < line.length && line[contentStart] === ' ') contentStart++;
        content = line.substring(contentStart);
      } else {
        // No line number found after timestamp
        content = line.substring(8).trim();
      }
    }
    // Check if line starts with a 1-2 digit number (at position 0)
    else if (line[0] >= '0' && line[0] <= '9') {
      // Find where the number ends
      let numEnd = 1;
      while (numEnd < line.length && line[numEnd] >= '0' && line[numEnd] <= '9') numEnd++;
      
      // Parse the line number
      lineNumber = parseInt(line.substring(0, numEnd));
      
      // The content starts after the line number (may have spaces between)
      // For SUMMARY format, there are typically spaces that are part of the prefix
      // We'll consider up to position 7 as the prefix for SUMMARY format
      if (numEnd <= 2 && line.length > 7) {
        // This looks like SUMMARY format (1-2 digit number at start)
        linePrefix = line.substring(0, 7);
        content = line.substring(7);
      } else {
        // Other format or short line
        linePrefix = line.substring(0, numEnd);
        content = line.substring(numEnd);
      }
    }
    // Otherwise it's a continuation line - no prefix
    else {
      // Just return the trimmed content
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
        linePrefix,
        text: '',
        speakerPrefix: undefined,
        isBlank: true
      };
    }
    
    // Return the parsed line without speaker extraction
    // Speaker extraction should only happen in PROCEEDINGS sections
    return {
      lineNumber,
      timestamp,
      linePrefix,
      text: content,
      speakerPrefix: undefined,
      isBlank: false
    };
  }
  
  private extractSpeakerFromText(text: string): { speakerPrefix?: string; text?: string } {
    if (!text) return { text: '' };
    
    // Use QA detector if available for Q&A patterns
    if (this.qaDetector) {
      const detection = this.qaDetector.detect(text);
      if (detection.isQuestion) {
        // Extract the Q pattern and remaining text
        const pattern = detection.pattern || 'Q.';
        const idx = text.indexOf(pattern);
        if (idx >= 0) {
          return {
            speakerPrefix: pattern,
            text: text.substring(idx + pattern.length).trim()
          };
        }
      } else if (detection.isAnswer) {
        // Extract the A pattern and remaining text
        const pattern = detection.pattern || 'A.';
        const idx = text.indexOf(pattern);
        if (idx >= 0) {
          return {
            speakerPrefix: pattern,
            text: text.substring(idx + pattern.length).trim()
          };
        }
      }
    }
    
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