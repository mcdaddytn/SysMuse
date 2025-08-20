import { SqlQueryService, SqlFilters, StatementQueryResult } from './SqlQueryService';
import { ElasticSearchService, ElasticSearchQuery } from './ElasticSearchService';
import logger from '../utils/logger';

export interface SearchQueryInput {
  trialName?: string | string[];
  sessionDate?: string | string[];
  sessionType?: string | string[];
  speakerType?: string | string[];
  speakerPrefix?: string | string[];
  elasticSearchQueries?: ElasticSearchQuery[];
}

export interface SearchResultItem extends StatementQueryResult {
  elasticSearchMatches?: { [queryName: string]: boolean };
  elasticSearchHighlights?: string[];
}

export interface SearchResults {
  totalStatements: number;
  matchedStatements: number;
  results: SearchResultItem[];
  elasticSearchSummary?: {
    [queryName: string]: {
      matched: number;
      percentage: number;
    };
  };
}

export class CombinedSearchService {
  private sqlService: SqlQueryService;
  private elasticService: ElasticSearchService;
  
  constructor() {
    this.sqlService = new SqlQueryService();
    this.elasticService = new ElasticSearchService({
      url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      index: 'judicial_statements'
    });
  }
  
  async executeSearch(input: SearchQueryInput): Promise<SearchResults> {
    try {
      logger.info('Executing combined search with filters:', input);
      
      const sqlFilters = this.buildSqlFilters(input);
      
      const statements = await this.sqlService.queryStatements(sqlFilters);
      logger.info(`SQL query returned ${statements.length} statements`);
      
      let results: SearchResultItem[] = statements.map(stmt => ({
        ...stmt,
        elasticSearchMatches: {},
        elasticSearchHighlights: []
      }));
      
      let elasticSearchSummary: any = {};
      
      if (input.elasticSearchQueries && input.elasticSearchQueries.length > 0) {
        const elasticSearchIds = statements
          .filter(stmt => stmt.elasticSearchId)
          .map(stmt => stmt.elasticSearchId!);
        
        if (elasticSearchIds.length > 0) {
          const matchMap = await this.elasticService.matchStatementsWithQueries(
            elasticSearchIds,
            input.elasticSearchQueries
          );
          
          for (const queryDef of input.elasticSearchQueries) {
            const matchedIds = matchMap.get(queryDef.name) || new Set();
            elasticSearchSummary[queryDef.name] = {
              matched: 0,
              percentage: 0
            };
            
            for (const result of results) {
              if (result.elasticSearchId && matchedIds.has(result.elasticSearchId)) {
                result.elasticSearchMatches![queryDef.name] = true;
                elasticSearchSummary[queryDef.name].matched++;
              } else {
                result.elasticSearchMatches![queryDef.name] = false;
              }
            }
            
            elasticSearchSummary[queryDef.name].percentage = 
              results.length > 0 
                ? Math.round((elasticSearchSummary[queryDef.name].matched / results.length) * 100)
                : 0;
          }
          
          logger.info('Elasticsearch matching complete:', elasticSearchSummary);
        } else {
          logger.warn('No statements have elasticSearchId, skipping Elasticsearch queries');
        }
      }
      
      const matchedStatements = results.filter(result => {
        if (!input.elasticSearchQueries || input.elasticSearchQueries.length === 0) {
          return true;
        }
        return Object.values(result.elasticSearchMatches!).some(matched => matched);
      });
      
      return {
        totalStatements: statements.length,
        matchedStatements: matchedStatements.length,
        results: results,
        elasticSearchSummary: Object.keys(elasticSearchSummary).length > 0 ? elasticSearchSummary : undefined
      };
    } catch (error) {
      logger.error('Error in combined search:', error);
      throw error;
    }
  }
  
  private buildSqlFilters(input: SearchQueryInput): SqlFilters {
    const filters: SqlFilters = {};
    
    if (input.trialName) {
      filters.trialName = input.trialName;
    }
    
    if (input.sessionDate) {
      if (Array.isArray(input.sessionDate)) {
        filters.sessionDate = input.sessionDate.map(date => new Date(date));
      } else {
        filters.sessionDate = new Date(input.sessionDate);
      }
    }
    
    if (input.sessionType) {
      filters.sessionType = input.sessionType;
    }
    
    if (input.speakerType) {
      filters.speakerType = input.speakerType;
    }
    
    if (input.speakerPrefix) {
      filters.speakerPrefix = input.speakerPrefix;
    }
    
    return filters;
  }
  
  async disconnect() {
    await this.sqlService.disconnect();
  }
}