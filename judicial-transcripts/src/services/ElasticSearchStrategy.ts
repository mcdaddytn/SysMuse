import { StatementEvent, AccumulatorExpression, ElasticSearchResult as PrismaESResult } from '@prisma/client';
import { SearchStrategy, SearchResult } from './SearchStrategy';
import { ElasticSearchService } from './ElasticSearchService';
import { TranscriptConfig } from '../types/config.types';
import { Logger } from '../utils/logger';
import { PrismaClient } from '@prisma/client';

export class ElasticSearchStrategy implements SearchStrategy {
  private logger = new Logger('ElasticSearchStrategy');
  private esService?: ElasticSearchService;
  private prisma?: PrismaClient;

  constructor(
    private config: TranscriptConfig,
    prisma?: PrismaClient
  ) {
    this.prisma = prisma;
    if (config.enableElasticSearch && config.elasticSearchUrl) {
      this.esService = new ElasticSearchService({
        url: config.elasticSearchUrl,
        index: 'judicial_statements'
      });
    }
  }

  async searchWithExpressions(
    statements: StatementEvent[],
    accumulator: AccumulatorExpression & { 
      components?: any[]; 
      esExpressions?: any[];
      esResults?: PrismaESResult[];
    }
  ): Promise<Map<number, SearchResult[]>> {
    const resultsMap = new Map<number, SearchResult[]>();

    // If we have existing ES results from the database, use those
    if (this.prisma && accumulator.esExpressions) {
      for (const statement of statements) {
        // Query for existing ElasticSearch results
        const esResults = await this.prisma.elasticSearchResult.findMany({
          where: {
            statementId: statement.id,
            expressionId: {
              in: accumulator.esExpressions.map((exp: any) => exp.id)
            }
          },
          include: {
            expression: true
          }
        });

        if (esResults.length > 0) {
          const searchResults: SearchResult[] = esResults.map(esr => ({
            statementId: esr.statementId,
            expressionId: esr.expressionId,
            phrase: esr.expression?.query || '',
            score: esr.score,
            metadata: {
              highlights: esr.highlights,
              matchedQueries: esr.matchedQueries
            }
          }));
          resultsMap.set(statement.id, searchResults);
        }
      }
    } else if (this.esService) {
      // Perform live ElasticSearch queries
      const metadata = accumulator.metadata as any || {};
      const queries = this.buildQueriesFromMetadata(metadata);

      for (const statement of statements) {
        const statementResults: SearchResult[] = [];

        for (const query of queries) {
          try {
            const results = await this.esService.search(query.phrase, {
              term: { statementId: statement.id }
            });

            for (const result of results) {
              statementResults.push({
                statementId: statement.id,
                phrase: query.phrase,
                score: result._score || 1.0,
                metadata: {
                  speakerType: query.speakerType,
                  highlights: result.highlight?.text
                }
              });
            }
          } catch (error) {
            this.logger.error(`Error searching ES for statement ${statement.id}:`, error);
          }
        }

        if (statementResults.length > 0) {
          resultsMap.set(statement.id, statementResults);
        }
      }
    }

    this.logger.debug(`Found ES matches in ${resultsMap.size} statements for accumulator ${accumulator.name}`);
    return resultsMap;
  }

  private buildQueriesFromMetadata(metadata: any): Array<{ phrase: string; speakerType?: string }> {
    const queries: Array<{ phrase: string; speakerType?: string }> = [];

    // Handle attorney phrases
    if (metadata.attorneyPhrases && Array.isArray(metadata.attorneyPhrases)) {
      for (const phrase of metadata.attorneyPhrases) {
        queries.push({ phrase, speakerType: 'attorney' });
      }
    }

    // Handle judge phrases
    if (metadata.judgePhrases && Array.isArray(metadata.judgePhrases)) {
      for (const phrase of metadata.judgePhrases) {
        queries.push({ phrase, speakerType: 'judge' });
      }
    }

    // Handle witness phrases
    if (metadata.witnessPhrases && Array.isArray(metadata.witnessPhrases)) {
      for (const phrase of metadata.witnessPhrases) {
        queries.push({ phrase, speakerType: 'witness' });
      }
    }

    // Handle general phrases
    if (metadata.phrases && Array.isArray(metadata.phrases)) {
      for (const phrase of metadata.phrases) {
        queries.push({ phrase });
      }
    }

    return queries;
  }

  async initialize(): Promise<void> {
    if (this.esService) {
      this.logger.info('ElasticSearchStrategy initialized');
    } else {
      this.logger.warn('ElasticSearchStrategy initialized without ES service');
    }
  }

  async cleanup(): Promise<void> {
    this.logger.info('ElasticSearchStrategy cleaned up');
  }
}