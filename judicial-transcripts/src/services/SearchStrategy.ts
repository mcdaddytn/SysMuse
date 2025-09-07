import { StatementEvent, ElasticSearchResult, AccumulatorExpression } from '@prisma/client';
import { TranscriptConfig } from '../types/config.types';
import { Logger } from '../utils/logger';

/**
 * Common search result format for both ElasticSearch and in-memory strategies
 */
export interface SearchResult {
  statementId: number;
  expressionId?: number;
  phrase: string;
  score: number;
  positions?: number[];
  metadata?: any;
}

/**
 * Strategy interface for searching statements
 */
export interface SearchStrategy {
  /**
   * Search statements with accumulator expressions
   */
  searchWithExpressions(
    statements: StatementEvent[],
    accumulator: AccumulatorExpression & { 
      components?: any[]; 
      esExpressions?: any[];
    }
  ): Promise<Map<number, SearchResult[]>>;

  /**
   * Initialize the search service if needed
   */
  initialize?(): Promise<void>;

  /**
   * Cleanup resources if needed
   */
  cleanup?(): Promise<void>;
}

/**
 * Factory for creating search strategies based on configuration
 */
export class SearchStrategyFactory {
  private static logger = new Logger('SearchStrategyFactory');

  static async createStrategy(
    config: TranscriptConfig,
    prisma?: any
  ): Promise<SearchStrategy> {
    if (config.enableElasticSearch) {
      this.logger.info('Using ElasticSearch strategy');
      // Dynamically import to avoid dependency when not used
      const { ElasticSearchStrategy } = await import('./ElasticSearchStrategy');
      return new ElasticSearchStrategy(config, prisma);
    } else {
      this.logger.info('Using in-memory search strategy');
      const { InMemorySearchStrategy } = await import('./InMemorySearchStrategy');
      return new InMemorySearchStrategy(config);
    }
  }
}