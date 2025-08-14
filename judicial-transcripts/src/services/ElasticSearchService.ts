// src/services/ElasticSearchService.ts
import { Client } from '@elastic/elasticsearch';
import logger from '../utils/logger';

export interface ElasticSearchQuery {
  name: string;
  query: string;
  type?: 'match' | 'match_phrase' | 'term' | 'wildcard' | 'regexp' | 'fuzzy';
  field?: string;
  boost?: number;
  proximity?: number;
}

export interface ElasticSearchResult {
  id: string;
  score: number;
  source: any;
  highlights?: string[];
  matchedQueries?: string[];
}

export class ElasticSearchService {
  private client: Client;
  private indexName: string;
  
  constructor(options: any) {
    this.client = new Client({
      node: options.url || 'http://localhost:9200',
      auth: options.apiKey ? {
        apiKey: options.apiKey
      } : undefined
    });
    this.indexName = options.index || 'judicial_statements';
  }
  
  async indexStatement(id: string, statement: any): Promise<void> {
    try {
      await this.client.index({
        index: this.indexName,
        id,
        body: statement
      });
      
      logger.info(`Indexed statement in ElasticSearch: ${id}`);
    } catch (error) {
      logger.error('Error indexing to ElasticSearch:', error);
    }
  }
  
  async bulkIndex(statements: any[]): Promise<void> {
    try {
      const bulkBody: any[] = [];
      
      for (const statement of statements) {
        bulkBody.push(
          { index: { _index: this.indexName, _id: statement.id } },
          statement
        );
      }
      
      const result = await this.client.bulk({
        body: bulkBody
      });
      
      if (result.errors) {
        logger.error('Bulk indexing errors:', result.items.filter((item: any) => item.index?.error));
      } else {
        logger.info(`Bulk indexed ${statements.length} statements`);
      }
    } catch (error) {
      logger.error('Error bulk indexing:', error);
      throw error;
    }
  }
  
  async search(query: string, filters?: any): Promise<any> {
    try {
      const result = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            bool: {
              must: [
                {
                  match: {
                    text: query
                  }
                }
              ],
              filter: filters || []
            }
          }
        }
      });
      
      return result.hits.hits;
    } catch (error) {
      logger.error('Error searching ElasticSearch:', error);
      return [];
    }
  }
  
  async searchWithNamedQueries(
    namedQueries: ElasticSearchQuery[],
    filters?: any[],
    size: number = 100
  ): Promise<Map<string, ElasticSearchResult[]>> {
    try {
      const must: any[] = [];
      const should: any[] = [];
      
      for (const namedQuery of namedQueries) {
        const queryBody = this.buildQuery(namedQuery);
        // Create a bool query with must and _name
        const namedQueryWrapper = {
          bool: {
            must: queryBody,
            _name: namedQuery.name
          }
        };
        logger.debug(`Building query for ${namedQuery.name}:\n${JSON.stringify(namedQueryWrapper, null, 2)}`);
        should.push(namedQueryWrapper);
      }
      
      const searchBody = {
        query: {
          bool: {
            should,
            minimum_should_match: 0,
            filter: filters || []
          }
        },
        highlight: {
          fields: {
            text: {
              fragment_size: 150,
              number_of_fragments: 3
            }
          }
        },
        size
      };
      
      logger.debug('Elasticsearch query body:\n' + JSON.stringify(searchBody, null, 2));
      
      const result = await this.client.search({
        index: this.indexName,
        body: searchBody
      });
      
      const totalHits = typeof result.hits.total === 'object' ? result.hits.total.value : result.hits.total;
      logger.info(`Elasticsearch query returned ${totalHits} total hits`);
      
      const resultMap = new Map<string, ElasticSearchResult[]>();
      
      for (const hit of result.hits.hits as any[]) {
        const matchedQueries = hit.matched_queries || [];
        const elasticResult: ElasticSearchResult = {
          id: hit._id,
          score: hit._score,
          source: hit._source,
          highlights: hit.highlight?.text || [],
          matchedQueries
        };
        
        for (const queryName of matchedQueries) {
          if (!resultMap.has(queryName)) {
            resultMap.set(queryName, []);
          }
          resultMap.get(queryName)!.push(elasticResult);
        }
      }
      
      for (const [queryName, results] of resultMap.entries()) {
        logger.info(`Query '${queryName}' matched ${results.length} documents`);
      }
      
      return resultMap;
    } catch (error) {
      logger.error('Error in named queries search:', error);
      return new Map();
    }
  }
  
  async matchStatementsWithQueries(
    statementIds: string[],
    namedQueries: ElasticSearchQuery[]
  ): Promise<Map<string, Set<string>>> {
    try {
      const filters = [
        {
          ids: {
            values: statementIds
          }
        }
      ];
      
      const results = await this.searchWithNamedQueries(namedQueries, filters, statementIds.length);
      
      const matchMap = new Map<string, Set<string>>();
      
      for (const [queryName, elasticResults] of results.entries()) {
        const matchedIds = new Set<string>();
        for (const result of elasticResults) {
          matchedIds.add(result.id);
        }
        matchMap.set(queryName, matchedIds);
      }
      
      return matchMap;
    } catch (error) {
      logger.error('Error matching statements with queries:', error);
      return new Map();
    }
  }
  
  private buildQuery(elasticQuery: ElasticSearchQuery): any {
    const field = elasticQuery.field || 'text';
    
    switch (elasticQuery.type) {
      case 'match_phrase':
        if (elasticQuery.proximity) {
          const proximityQuery: any = {
            query: elasticQuery.query,
            slop: elasticQuery.proximity
          };
          if (elasticQuery.boost) {
            proximityQuery.boost = elasticQuery.boost;
          }
          return {
            match_phrase: {
              [field]: proximityQuery
            }
          };
        }
        const phraseQuery: any = {
          query: elasticQuery.query
        };
        if (elasticQuery.boost) {
          phraseQuery.boost = elasticQuery.boost;
        }
        return {
          match_phrase: {
            [field]: phraseQuery
          }
        };
        
      case 'term':
        const termQuery: any = {
          value: elasticQuery.query
        };
        if (elasticQuery.boost) {
          termQuery.boost = elasticQuery.boost;
        }
        return {
          term: {
            [field]: termQuery
          }
        };
        
      case 'wildcard':
        const wildcardQuery: any = {
          value: elasticQuery.query
        };
        if (elasticQuery.boost) {
          wildcardQuery.boost = elasticQuery.boost;
        }
        return {
          wildcard: {
            [field]: wildcardQuery
          }
        };
        
      case 'regexp':
        const regexpQuery: any = {
          value: elasticQuery.query
        };
        if (elasticQuery.boost) {
          regexpQuery.boost = elasticQuery.boost;
        }
        return {
          regexp: {
            [field]: regexpQuery
          }
        };
        
      case 'fuzzy':
        const fuzzyQuery: any = {
          value: elasticQuery.query,
          fuzziness: 'AUTO'
        };
        if (elasticQuery.boost) {
          fuzzyQuery.boost = elasticQuery.boost;
        }
        return {
          fuzzy: {
            [field]: fuzzyQuery
          }
        };
        
      case 'match':
      default:
        const matchQuery: any = {
          query: elasticQuery.query
        };
        if (elasticQuery.boost) {
          matchQuery.boost = elasticQuery.boost;
        }
        return {
          match: {
            [field]: matchQuery
          }
        };
    }
  }
}
