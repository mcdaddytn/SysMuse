import { DocumentSection } from '@prisma/client';
import { logger } from '../utils/logger';

export interface EnhancedParsedLine {
  lineNumber: number;
  trialLineNumber?: number;
  sessionLineNumber?: number;
  parsedTrialPage?: number;
  linePrefix?: string;
  timestamp?: string;
  dateTime?: Date;
  text?: string;
  speakerPrefix?: string;
  documentSection: DocumentSection;
  isBlank: boolean;
  isPageHeader?: boolean;
}

export class EnhancedLineParser {
  private currentSection: DocumentSection = 'SUMMARY';
  private trialLineCounter = 0;
  private sessionLineCounter = 0;
  private lastParsedLineNumber?: number;
  
  // Pattern for detecting section transitions
  private readonly sectionPatterns = {
    proceedings: /^\s*P\s+R\s+O\s+C\s+E\s+E\s+D\s+I\s+N\s+G\s+S\s*$/,
    certification: /^\s*CERTIFICATION\s*$/
  };
  
  // Patterns for line prefixes
  private readonly linePrefixPatterns = [
    // Timestamp + line number: "08:30:35    9"
    /^(\d{2}:\d{2}:\d{2})\s+(\d{1,2})\s+/,
    // Line number only with varying spaces: "14  " or " 9 "
    /^\s*(\d{1,2})\s+/
  ];
  
  // Speaker patterns (enhanced from original)
  private readonly speakerPatterns = [
    /^\s*(THE COURT):\s*(.*)$/,
    /^\s*(COURT SECURITY OFFICER):\s*(.*)$/,
    /^\s*((?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    /^\s*(JUROR\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    /^\s*(Q\.|A\.)\s+(.*)$/,
    /^\s*(BY\s+(?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    /^\s*(THE WITNESS):\s*(.*)$/,
    /^\s*((?:WITNESS|BAILIFF|COURT REPORTER|INTERPRETER)):\s*(.*)$/i,
    /^\s*([A-Z][A-Z\s]*?):\s*(.*)$/
  ];
  
  // Pattern for court directives
  private readonly directivePattern = /^\s*\((.*?)\)\s*$/;
  
  // Special whitespace characters to treat as blank lines
  private readonly whitespacePatterns = [
    /^\s*\*+\s*$/,
    /^\s*_+\s*$/,
    /^\s*-+\s*$/
  ];

  reset(): void {
    this.currentSection = 'SUMMARY';
    this.trialLineCounter = 0;
    this.sessionLineCounter = 0;
    this.lastParsedLineNumber = undefined;
  }

  setSessionDate(sessionDate: Date): void {
    // Store session date for dateTime construction
    this.sessionDate = sessionDate;
  }

  private sessionDate?: Date;

  parse(line: string, pageNumber?: number): EnhancedParsedLine {
    // Increment counters
    this.trialLineCounter++;
    this.sessionLineCounter++;
    
    // Check if line is effectively blank
    const isBlank = this.isBlankLine(line);
    
    // Detect section changes
    this.detectSectionChange(line);
    
    // Parse line prefix and extract components
    const { linePrefix, parsedLineNumber, timestamp, remainingText } = this.parseLinePrefix(line);
    
    // Handle cases where no line number is present but text exists
    let actualLineNumber = parsedLineNumber;
    if (!actualLineNumber && !isBlank) {
      // Use the last parsed line number if available
      actualLineNumber = this.lastParsedLineNumber;
    } else if (actualLineNumber) {
      this.lastParsedLineNumber = actualLineNumber;
    }
    
    // Extract speaker if present
    const { speakerPrefix, text } = this.extractSpeaker(remainingText);
    
    // Construct dateTime if we have timestamp and session date
    let dateTime: Date | undefined;
    if (timestamp && this.sessionDate) {
      dateTime = this.constructDateTime(timestamp, this.sessionDate);
    }
    
    return {
      lineNumber: actualLineNumber || 0,
      trialLineNumber: this.trialLineCounter,
      sessionLineNumber: this.sessionLineCounter,
      parsedTrialPage: undefined, // Will be parsed from page header separately
      linePrefix,
      timestamp,
      dateTime,
      text: text || remainingText,
      speakerPrefix,
      documentSection: this.currentSection,
      isBlank,
      isPageHeader: false
    };
  }

  private isBlankLine(line: string): boolean {
    if (!line || line.trim() === '') {
      return true;
    }
    
    // Check for special whitespace patterns
    for (const pattern of this.whitespacePatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }
    
    return false;
  }

  private detectSectionChange(line: string): void {
    const trimmed = line.trim();
    
    if (this.sectionPatterns.proceedings.test(trimmed)) {
      this.currentSection = 'PROCEEDINGS';
    } else if (this.sectionPatterns.certification.test(trimmed)) {
      this.currentSection = 'CERTIFICATION';
    }
  }

  private parseLinePrefix(line: string): {
    linePrefix?: string;
    parsedLineNumber?: number;
    timestamp?: string;
    remainingText: string;
  } {
    // Try timestamp (HH:MM:SS or HH:MM) + line number pattern first
    const timestampMatch = line.match(/^(\d{2}:\d{2}(?::\d{2})?)\s+(\d{1,2})\s+/);
    if (timestampMatch) {
      return {
        linePrefix: timestampMatch[0].trim(),
        parsedLineNumber: parseInt(timestampMatch[2]),
        timestamp: timestampMatch[1],
        remainingText: line.substring(timestampMatch[0].length)
      };
    }
    
    // Try line number only pattern
    const lineNumMatch = line.match(/^\s*(\d{1,2})\s+/);
    if (lineNumMatch) {
      return {
        linePrefix: lineNumMatch[0].trim(),
        parsedLineNumber: parseInt(lineNumMatch[1]),
        remainingText: line.substring(lineNumMatch[0].length)
      };
    }
    
    // No line prefix found
    return {
      remainingText: line
    };
  }

  private extractSpeaker(text: string): {
    speakerPrefix?: string;
    text?: string;
  } {
    if (!text) {
      return {};
    }
    
    for (const pattern of this.speakerPatterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          speakerPrefix: match[1].trim(),
          text: match[2] ? match[2].trim() : ''
        };
      }
    }
    
    return { text };
  }

  private constructDateTime(timestamp: string, sessionDate: Date): Date {
    const [hours, minutes, seconds] = timestamp.split(':').map(n => parseInt(n));
    const dateTime = new Date(sessionDate);
    dateTime.setHours(hours, minutes, seconds, 0);
    return dateTime;
  }

  isCourtDirective(text: string): boolean {
    return this.directivePattern.test(text);
  }

  extractDirectiveText(text: string): string | null {
    const match = text.match(this.directivePattern);
    return match ? match[1] : null;
  }
}