import { StatementEvent, AccumulatorExpression } from '@prisma/client';
import { SearchStrategy, SearchResult } from './SearchStrategy';
import { InMemorySearchService, SearchExpression } from './InMemorySearchService';
import { TranscriptConfig } from '../types/config.types';
import { Logger } from '../utils/logger';

export class InMemorySearchStrategy implements SearchStrategy {
  private logger = new Logger('InMemorySearchStrategy');
  private searchService: InMemorySearchService;

  constructor(private config: TranscriptConfig) {
    this.searchService = new InMemorySearchService({
      caseSensitive: false,
      enableCache: true,
      maxCacheSize: 1000
    });
  }

  async searchWithExpressions(
    statements: StatementEvent[],
    accumulator: AccumulatorExpression & { 
      components?: any[]; 
      esExpressions?: any[];
    }
  ): Promise<Map<number, SearchResult[]>> {
    const resultsMap = new Map<number, SearchResult[]>();

    // Parse metadata to get search expressions
    const metadata = accumulator.metadata as any || {};
    const expressions = this.parseAccumulatorToExpressions(accumulator, metadata);

    if (expressions.length === 0) {
      this.logger.debug(`No search expressions found for accumulator ${accumulator.name}`);
      return resultsMap;
    }

    // Filter statements by speaker type if needed
    const filteredStatements = this.filterStatementsBySpeaker(statements, metadata);

    // Perform search
    const searchResults = this.searchService.searchStatements(filteredStatements, expressions);

    // Convert to SearchResult format
    for (const [statementId, phraseResults] of searchResults) {
      const results: SearchResult[] = phraseResults.map(pr => ({
        statementId: pr.statementId,
        phrase: pr.phrase,
        score: pr.confidence,
        positions: pr.positions,
        metadata: pr.metadata
      }));
      resultsMap.set(statementId, results);
    }

    this.logger.debug(`Found matches in ${resultsMap.size} statements for accumulator ${accumulator.name}`);
    return resultsMap;
  }

  private parseAccumulatorToExpressions(
    accumulator: AccumulatorExpression,
    metadata: any
  ): SearchExpression[] {
    const expressions: SearchExpression[] = [];

    // Handle attorney phrases
    if (metadata.attorneyPhrases && Array.isArray(metadata.attorneyPhrases)) {
      expressions.push({
        phrases: metadata.attorneyPhrases,
        weights: metadata.weights,
        speakerType: 'attorney'
      });
    }

    // Handle judge phrases
    if (metadata.judgePhrases && Array.isArray(metadata.judgePhrases)) {
      expressions.push({
        phrases: metadata.judgePhrases,
        weights: metadata.weights,
        speakerType: 'judge'
      });
    }

    // Handle witness phrases
    if (metadata.witnessPhrases && Array.isArray(metadata.witnessPhrases)) {
      expressions.push({
        phrases: metadata.witnessPhrases,
        weights: metadata.weights,
        speakerType: 'witness'
      });
    }

    // Handle general phrases
    if (metadata.phrases && Array.isArray(metadata.phrases)) {
      expressions.push({
        phrases: metadata.phrases,
        weights: metadata.weights
      });
    }

    // Handle search terms (alternative format)
    if (metadata.searchTerms && Array.isArray(metadata.searchTerms)) {
      expressions.push({
        phrases: metadata.searchTerms,
        weights: metadata.weights
      });
    }

    return expressions;
  }

  private filterStatementsBySpeaker(
    statements: StatementEvent[],
    metadata: any
  ): StatementEvent[] {
    // If no speaker requirements, return all statements
    if (!metadata.requiredSpeakers && !metadata.attorneyPhrases && !metadata.judgePhrases) {
      return statements;
    }

    return statements.filter(stmt => {
      // Handle statements with or without speaker relation loaded
      const speaker = (stmt as any).speaker;
      if (!speaker) return false;

      const speakerType = speaker.speakerType;
      const speakerName = speaker.name?.toLowerCase();

      // Check required speakers
      if (metadata.requiredSpeakers && Array.isArray(metadata.requiredSpeakers)) {
        for (const required of metadata.requiredSpeakers) {
          if (required === 'JUDGE' && speakerType === 'JUDGE') return true;
          if (required === 'ATTORNEY' && speakerType === 'ATTORNEY') return true;
          if (required === 'WITNESS' && speakerType === 'WITNESS') return true;
          if (speakerName && speakerName.includes(required.toLowerCase())) return true;
        }
      }

      // Check if statement is from appropriate speaker for phrase type
      if (metadata.attorneyPhrases && speakerType === 'ATTORNEY') return true;
      if (metadata.judgePhrases && speakerType === 'JUDGE') return true;
      if (metadata.witnessPhrases && speakerType === 'WITNESS') return true;

      // If no specific requirements, include the statement
      return !metadata.requiredSpeakers;
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('InMemorySearchStrategy initialized');
  }

  async cleanup(): Promise<void> {
    this.searchService.clearCache();
    this.logger.info('InMemorySearchStrategy cleaned up');
  }
}