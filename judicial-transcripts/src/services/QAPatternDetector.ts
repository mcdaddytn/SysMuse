import { TrialStyleConfig } from '../types/config.types';
import logger from '../utils/logger';

export interface DetectedPattern {
  type: 'QUESTION' | 'ANSWER' | 'ATTORNEY_INDICATOR';
  pattern: string;
  match: RegExpMatchArray;
  confidence: number;
}

export interface QADetectionResult {
  isQuestion: boolean;
  isAnswer: boolean;
  attorneyIndicator?: string;
  pattern?: string;
  confidence: number;
}

export class QAPatternDetector {
  private questionPatterns: RegExp[];
  private answerPatterns: RegExp[];
  private attorneyIndicatorPatterns: RegExp[];
  private config: TrialStyleConfig;
  
  constructor(config: TrialStyleConfig) {
    this.config = config;
    
    // Initialize question patterns
    this.questionPatterns = this.compilePatterns(
      config.questionPatterns || ['Q.', 'Q:', 'Q', 'QUESTION:', 'QUESTION']
    );
    
    // Initialize answer patterns
    this.answerPatterns = this.compilePatterns(
      config.answerPatterns || ['A.', 'A:', 'A', 'ANSWER:', 'ANSWER']
    );
    
    // Initialize attorney indicator patterns
    this.attorneyIndicatorPatterns = this.compileAttorneyPatterns(
      config.attorneyIndicatorPatterns || [
        'BY MR\\. ([A-Z]+)',
        'BY MS\\. ([A-Z]+)',
        'BY MRS\\. ([A-Z]+)',
        'BY DR\\. ([A-Z]+)'
      ]
    );
  }
  
  private compilePatterns(patterns: string[]): RegExp[] {
    return patterns.map(pattern => {
      // Escape special regex characters except for backslashes (already escaped)
      const escaped = pattern.replace(/([.?*+^$[\]{}()|])/g, '\\$1');
      
      // Single character patterns must be followed by space or end of string
      if (pattern.length === 1) {
        return new RegExp(`^\\s*${escaped}(?:\\s+|$)`, 'i');
      }
      
      // Patterns ending with : don't need space after
      if (pattern.endsWith(':')) {
        return new RegExp(`^\\s*${escaped}\\s*`, 'i');
      }
      
      // Other patterns should have space after
      return new RegExp(`^\\s*${escaped}\\s+`, 'i');
    });
  }
  
  private compileAttorneyPatterns(patterns: string[]): RegExp[] {
    return patterns.map(pattern => {
      // These patterns are already regex strings, compile directly
      return new RegExp(pattern, 'i');
    });
  }
  
  detect(text: string): QADetectionResult {
    const normalizedText = this.normalizeWhitespace(text);
    
    // Check for question patterns
    for (let i = 0; i < this.questionPatterns.length; i++) {
      const pattern = this.questionPatterns[i];
      if (pattern.test(normalizedText)) {
        return {
          isQuestion: true,
          isAnswer: false,
          pattern: this.config.questionPatterns?.[i],
          confidence: 1.0
        };
      }
    }
    
    // Check for answer patterns
    for (let i = 0; i < this.answerPatterns.length; i++) {
      const pattern = this.answerPatterns[i];
      if (pattern.test(normalizedText)) {
        return {
          isQuestion: false,
          isAnswer: true,
          pattern: this.config.answerPatterns?.[i],
          confidence: 1.0
        };
      }
    }
    
    // Check for attorney indicators
    for (const pattern of this.attorneyIndicatorPatterns) {
      const match = normalizedText.match(pattern);
      if (match) {
        return {
          isQuestion: false,
          isAnswer: false,
          attorneyIndicator: match[1],
          confidence: 1.0
        };
      }
    }
    
    return {
      isQuestion: false,
      isAnswer: false,
      confidence: 0
    };
  }
  
  detectAttorneyFromLine(text: string): string | null {
    const normalizedText = this.normalizeWhitespace(text);
    
    for (const pattern of this.attorneyIndicatorPatterns) {
      const match = normalizedText.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
    
    return null;
  }
  
  private normalizeWhitespace(text: string): string {
    // Normalize multiple spaces to single space
    // Remove leading whitespace but preserve structure
    return text.replace(/\s+/g, ' ').trim();
  }
  
  detectPatternsInFile(lines: string[]): {
    detectedQuestionPatterns: Set<string>;
    detectedAnswerPatterns: Set<string>;
    detectedAttorneyPatterns: Set<string>;
  } {
    const detectedQuestionPatterns = new Set<string>();
    const detectedAnswerPatterns = new Set<string>();
    const detectedAttorneyPatterns = new Set<string>();
    
    // Common Q&A pattern variations to check
    const potentialQPatterns = ['Q.', 'Q:', 'Q', 'QUESTION:', 'QUESTION', 'Q '];
    const potentialAPatterns = ['A.', 'A:', 'A', 'ANSWER:', 'ANSWER', 'A '];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Check question patterns
      for (const pattern of potentialQPatterns) {
        if (trimmed.startsWith(pattern)) {
          // Verify there's actual content after the pattern
          const afterPattern = trimmed.substring(pattern.length).trim();
          if (afterPattern.length > 0 || pattern.endsWith(':')) {
            detectedQuestionPatterns.add(pattern.trim());
          }
        }
      }
      
      // Check answer patterns
      for (const pattern of potentialAPatterns) {
        if (trimmed.startsWith(pattern)) {
          // Verify there's actual content after the pattern
          const afterPattern = trimmed.substring(pattern.length).trim();
          if (afterPattern.length > 0 || pattern.endsWith(':')) {
            detectedAnswerPatterns.add(pattern.trim());
          }
        }
      }
      
      // Check attorney indicators
      const byMatch = trimmed.match(/^BY\s+(MR\.|MS\.|MRS\.|DR\.)\s+[A-Z]/i);
      if (byMatch) {
        detectedAttorneyPatterns.add(byMatch[1].toUpperCase());
      }
    }
    
    return {
      detectedQuestionPatterns,
      detectedAnswerPatterns,
      detectedAttorneyPatterns
    };
  }
  
  suggestPatternsForTrial(lines: string[]): Partial<TrialStyleConfig> {
    const detected = this.detectPatternsInFile(lines);
    
    const suggestions: Partial<TrialStyleConfig> = {};
    
    if (detected.detectedQuestionPatterns.size > 0) {
      suggestions.questionPatterns = Array.from(detected.detectedQuestionPatterns);
      logger.info(`Detected question patterns: ${suggestions.questionPatterns.join(', ')}`);
    }
    
    if (detected.detectedAnswerPatterns.size > 0) {
      suggestions.answerPatterns = Array.from(detected.detectedAnswerPatterns);
      logger.info(`Detected answer patterns: ${suggestions.answerPatterns.join(', ')}`);
    }
    
    if (detected.detectedAttorneyPatterns.size > 0) {
      const patterns: string[] = [];
      for (const title of detected.detectedAttorneyPatterns) {
        patterns.push(`BY ${title} ([A-Z][A-Z\\s'-]+?)`);
      }
      suggestions.attorneyIndicatorPatterns = patterns;
      logger.info(`Detected attorney patterns: ${patterns.length} patterns`);
    }
    
    return suggestions;
  }
}