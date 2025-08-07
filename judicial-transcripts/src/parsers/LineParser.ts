// src/parsers/phase1/LineParser.ts
// src/parsers/LineParser.ts
//import { ParsedLine } from '../../types/config.types';
//import logger from '../../utils/logger';
import { ParsedLine } from '../types/config.types';
//gm: not used
//import logger from '../utils/logger';

export class LineParser {
  private readonly timestampPattern = /^(\d{2}:\d{2}:\d{2})\s+(\d+)\s+(.*?)$/;
  private readonly speakerPattern = /^\s*(THE COURT|MR\.|MS\.|MRS\.|DR\.)\s+([A-Z][A-Z\s]*?):\s*(.*)$/;
  private readonly qaPattern = /^\s*(Q\.|A\.)\s+(.*)$/;
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
      let speakerPrefix: string | undefined;
      let text = remainingText;
      
      const speakerMatch = remainingText.match(this.speakerPattern);
      if (speakerMatch) {
        speakerPrefix = `${speakerMatch[1]} ${speakerMatch[2]}:`;
        text = speakerMatch[3];
      } else {
        const qaMatch = remainingText.match(this.qaPattern);
        if (qaMatch) {
          speakerPrefix = qaMatch[1];
          text = qaMatch[2];
        }
      }
      
      return {
        lineNumber: parseInt(timestampMatch[2]),
        timestamp: timestampMatch[1],
        text: text.trim(),
        speakerPrefix,
        isBlank: false
      };
    }
    
    // Line without timestamp - could be continuation or header
    return {
      lineNumber: 0,
      timestamp: undefined,
      text: line.trim(),
      speakerPrefix: undefined,
      isBlank: false
    };
  }
  
  isCourtDirective(line: string): boolean {
    return this.directivePattern.test(line);
  }
  
  extractDirective(line: string): string | null {
    const match = line.match(this.directivePattern);
    return match ? match[1] : null;
  }
  
  isSpeakerLine(line: string): boolean {
    return this.speakerPattern.test(line) || this.qaPattern.test(line);
  }
  
  extractSpeaker(line: string): string | null {
    const speakerMatch = line.match(this.speakerPattern);
    if (speakerMatch) {
      return `${speakerMatch[1]} ${speakerMatch[2]}`;
    }
    
    const qaMatch = line.match(this.qaPattern);
    if (qaMatch) {
      return qaMatch[1];
    }
    
    return null;
  }
}