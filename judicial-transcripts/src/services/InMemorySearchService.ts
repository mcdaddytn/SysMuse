import { StatementEvent, ConfidenceLevel } from '@prisma/client';
import { Logger } from '../utils/logger';

export interface PhraseSearchResult {
  statementId: number;
  phrase: string;
  positions: number[];
  confidence: number;
  metadata?: any;
}

export interface SearchExpression {
  phrases: string[];
  weights?: Record<string, number>;
  caseSensitive?: boolean;
  speakerType?: string;
}

export interface InMemorySearchConfig {
  caseSensitive?: boolean;
  enableCache?: boolean;
  maxCacheSize?: number;
}

export class InMemorySearchService {
  private logger = new Logger('InMemorySearchService');
  private patternCache = new Map<string, RegExp>();
  private config: InMemorySearchConfig;

  constructor(config?: InMemorySearchConfig) {
    this.config = {
      caseSensitive: false,
      enableCache: true,
      maxCacheSize: 1000,
      ...config
    };
  }

  /**
   * Search for phrases within a single statement
   */
  searchStatement(
    statement: StatementEvent,
    expression: SearchExpression
  ): PhraseSearchResult[] {
    if (!statement.text) {
      return [];
    }

    const results: PhraseSearchResult[] = [];
    const text = this.config.caseSensitive 
      ? statement.text 
      : statement.text.toLowerCase();

    for (const phrase of expression.phrases) {
      const searchPhrase = this.config.caseSensitive 
        ? phrase 
        : phrase.toLowerCase();
      
      const positions = this.findAllPositions(text, searchPhrase);
      
      if (positions.length > 0) {
        const weight = expression.weights?.[phrase] ?? 1.0;
        results.push({
          statementId: statement.id,
          phrase,
          positions,
          confidence: weight,
          metadata: {
            speakerType: expression.speakerType,
            originalPhrase: phrase
          }
        });
      }
    }

    return results;
  }

  /**
   * Search multiple statements with expressions
   */
  searchStatements(
    statements: StatementEvent[],
    expressions: SearchExpression[]
  ): Map<number, PhraseSearchResult[]> {
    const resultsMap = new Map<number, PhraseSearchResult[]>();

    for (const statement of statements) {
      const statementResults: PhraseSearchResult[] = [];
      
      for (const expression of expressions) {
        const results = this.searchStatement(statement, expression);
        statementResults.push(...results);
      }

      if (statementResults.length > 0) {
        resultsMap.set(statement.id, statementResults);
      }
    }

    return resultsMap;
  }

  /**
   * Parse accumulator metadata into search expressions
   */
  parseAccumulatorMetadata(metadata: any): SearchExpression[] {
    const expressions: SearchExpression[] = [];

    // Parse attorney phrases
    if (metadata.attorneyPhrases) {
      expressions.push({
        phrases: metadata.attorneyPhrases,
        weights: metadata.weights,
        speakerType: 'attorney'
      });
    }

    // Parse judge phrases
    if (metadata.judgePhrases) {
      expressions.push({
        phrases: metadata.judgePhrases,
        weights: metadata.weights,
        speakerType: 'judge'
      });
    }

    // Parse general phrases
    if (metadata.phrases) {
      expressions.push({
        phrases: metadata.phrases,
        weights: metadata.weights
      });
    }

    // Parse witness phrases
    if (metadata.witnessPhrases) {
      expressions.push({
        phrases: metadata.witnessPhrases,
        weights: metadata.weights,
        speakerType: 'witness'
      });
    }

    return expressions;
  }

  /**
   * Find all positions of a phrase in text
   */
  private findAllPositions(text: string, phrase: string): number[] {
    const positions: number[] = [];
    let index = 0;

    while ((index = text.indexOf(phrase, index)) !== -1) {
      positions.push(index);
      index += phrase.length;
    }

    return positions;
  }

  /**
   * Get or create a cached regex pattern
   */
  private getPattern(phrase: string, caseSensitive: boolean): RegExp {
    const cacheKey = `${phrase}_${caseSensitive}`;
    
    if (this.config.enableCache && this.patternCache.has(cacheKey)) {
      return this.patternCache.get(cacheKey)!;
    }

    // Escape special regex characters
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = new RegExp(`\\b${escaped}\\b`, flags);

    if (this.config.enableCache) {
      // Manage cache size
      if (this.patternCache.size >= this.config.maxCacheSize!) {
        const firstKey = this.patternCache.keys().next().value;
        if (firstKey !== undefined) {
          this.patternCache.delete(firstKey);
        }
      }
      this.patternCache.set(cacheKey, pattern);
    }

    return pattern;
  }

  /**
   * Calculate confidence level from score
   */
  calculateConfidenceLevel(score: number): ConfidenceLevel {
    if (score >= 0.8) return 'HIGH';
    if (score >= 0.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Clear the pattern cache
   */
  clearCache(): void {
    this.patternCache.clear();
  }
}