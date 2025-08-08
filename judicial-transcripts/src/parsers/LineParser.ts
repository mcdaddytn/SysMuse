// src/parsers/LineParser.ts
import { ParsedLine } from '../types/config.types';

export class LineParser {
  private readonly timestampPattern = /^(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.*?)$/;
  
  // More comprehensive speaker patterns
  private readonly speakerPatterns = [
    // THE COURT: pattern
    /^\s*(THE COURT):\s*(.*)$/,
    // MR./MS./MRS./DR. NAME: pattern  
    /^\s*((?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    // Q./A. pattern
    /^\s*(Q\.|A\.)\s+(.*)$/,
    // BY MR./MS. pattern
    /^\s*(BY\s+(?:MR\.|MS\.|MRS\.|DR\.)\s+[A-Z][A-Z\s]*?):\s*(.*)$/,
    // Other formal speakers (WITNESS, BAILIFF, etc.)
    /^\s*((?:WITNESS|BAILIFF|COURT REPORTER|INTERPRETER)):\s*(.*)$/i
  ];
  
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
    
    // Try to match timestamp pattern first
    const timestampMatch = line.match(this.timestampPattern);
    if (timestampMatch) {
      const remainingText = timestampMatch[3];
      
      // Check for speaker in remaining text
      const speakerResult = this.extractSpeakerFromText(remainingText);
      
      return {
        lineNumber: parseInt(timestampMatch[2]),
        timestamp: timestampMatch[1],
        text: speakerResult.text,
        speakerPrefix: speakerResult.speakerPrefix,
        isBlank: false
      };
    }
    
    // Line without timestamp - could be continuation, header, or standalone speaker line
    const speakerResult = this.extractSpeakerFromText(line);
    
    return {
      lineNumber: 0,
      timestamp: undefined,
      text: speakerResult.text,
      speakerPrefix: speakerResult.speakerPrefix,
      isBlank: false
    };
  }
  
  private extractSpeakerFromText(text: string): { speakerPrefix?: string; text: string } {
    // Try each speaker pattern
    for (const pattern of this.speakerPatterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          speakerPrefix: match[1].trim(),
          text: match[2].trim()
        };
      }
    }
    
    // No speaker pattern found, return original text
    return {
      speakerPrefix: undefined,
      text: text.trim()
    };
  }
  
  isCourtDirective(line: string): boolean {
    return this.directivePattern.test(line.trim());
  }
  
  extractDirective(line: string): string | null {
    const match = line.trim().match(this.directivePattern);
    return match ? match[1] : null;
  }
  
  isSpeakerLine(line: string): boolean {
    return this.speakerPatterns.some(pattern => pattern.test(line));
  }
  
  extractSpeaker(line: string): string | null {
    const result = this.extractSpeakerFromText(line);
    return result.speakerPrefix || null;
  }
}