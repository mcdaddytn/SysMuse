/**
 * ElasticSearch Service for Patent Text Search
 *
 * Provides:
 * - Index creation and management
 * - Patent document indexing
 * - Full-text search across abstracts, titles
 * - More-like-this similarity queries
 * - Aggregations for term extraction
 */

import * as dotenv from 'dotenv';
dotenv.config();

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'patents';

interface PatentDocument {
  patent_id: string;
  title: string;
  abstract?: string;
  grant_date?: string;
  assignee?: string;
  assignee_normalized?: string;
  cpc_codes?: string[];
  cpc_classes?: string[];
  forward_citations?: number;
  backward_citations?: number;
  competitor_citations?: number;
  competitors_citing?: string[];
  tier?: number;
  enhanced_score?: number;
  user_priority?: number;
  remaining_years?: number;
  inventors?: string[];
}

interface SearchResult {
  patent_id: string;
  title: string;
  abstract?: string;
  score: number;
  highlights?: Record<string, string[]>;
}

interface SearchResponse {
  total: number;
  hits: SearchResult[];
  aggregations?: Record<string, any>;
}

// Index mapping optimized for patent search
const PATENT_INDEX_MAPPING = {
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        patent_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'english_stemmer', 'english_stop']
        }
      },
      filter: {
        english_stemmer: {
          type: 'stemmer',
          language: 'english'
        },
        english_stop: {
          type: 'stop',
          stopwords: '_english_'
        }
      }
    }
  },
  mappings: {
    properties: {
      patent_id: { type: 'keyword' },
      title: {
        type: 'text',
        analyzer: 'patent_analyzer',
        fields: {
          keyword: { type: 'keyword' },
          raw: { type: 'text', analyzer: 'standard' }
        }
      },
      abstract: {
        type: 'text',
        analyzer: 'patent_analyzer',
        term_vector: 'with_positions_offsets',  // For MLT queries
        fields: {
          raw: { type: 'text', analyzer: 'standard' }
        }
      },
      grant_date: { type: 'date' },
      assignee: {
        type: 'text',
        fields: { keyword: { type: 'keyword' } }
      },
      assignee_normalized: { type: 'keyword' },
      cpc_codes: { type: 'keyword' },
      cpc_classes: { type: 'keyword' },
      forward_citations: { type: 'integer' },
      backward_citations: { type: 'integer' },
      competitor_citations: { type: 'integer' },
      competitors_citing: { type: 'keyword' },
      tier: { type: 'integer' },
      enhanced_score: { type: 'float' },
      user_priority: { type: 'integer' },
      remaining_years: { type: 'float' },
      inventors: { type: 'keyword' }
    }
  }
};

export class ElasticsearchService {
  private baseUrl: string;
  private indexName: string;

  constructor(baseUrl: string = ES_URL, indexName: string = INDEX_NAME) {
    this.baseUrl = baseUrl;
    this.indexName = indexName;
  }

  /**
   * Make a request to ElasticSearch
   */
  private async request<T>(
    path: string,
    method: string = 'GET',
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`ES request failed: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Check if ES is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.request<any>('/_cluster/health');
      return response.status === 'green' || response.status === 'yellow';
    } catch {
      return false;
    }
  }

  /**
   * Create the patents index with proper mappings
   */
  async createIndex(): Promise<void> {
    const exists = await this.indexExists();

    if (exists) {
      console.log(`Index '${this.indexName}' already exists`);
      return;
    }

    await this.request(`/${this.indexName}`, 'PUT', PATENT_INDEX_MAPPING);
    console.log(`Created index '${this.indexName}'`);
  }

  /**
   * Check if index exists
   */
  async indexExists(): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/${this.indexName}`, {
      method: 'HEAD',
    });
    return response.status === 200;
  }

  /**
   * Delete and recreate index (use with caution!)
   */
  async recreateIndex(): Promise<void> {
    try {
      await this.request(`/${this.indexName}`, 'DELETE');
      console.log(`Deleted index '${this.indexName}'`);
    } catch {
      // Index didn't exist
    }
    await this.createIndex();
  }

  /**
   * Index a single patent document
   */
  async indexPatent(patent: PatentDocument): Promise<void> {
    await this.request(
      `/${this.indexName}/_doc/${patent.patent_id}`,
      'PUT',
      patent
    );
  }

  /**
   * Bulk index multiple patents
   */
  async bulkIndex(patents: PatentDocument[]): Promise<{ indexed: number; errors: number }> {
    if (patents.length === 0) return { indexed: 0, errors: 0 };

    // Build NDJSON bulk request body
    const bulkLines: string[] = [];
    for (const patent of patents) {
      bulkLines.push(JSON.stringify({ index: { _index: this.indexName, _id: patent.patent_id } }));
      bulkLines.push(JSON.stringify(patent));
    }
    const bulkBody = bulkLines.join('\n') + '\n';

    // Direct fetch for bulk (needs special content-type handling)
    const response = await fetch(`${this.baseUrl}/_bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: bulkBody,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Bulk index failed: ${response.status} - ${error}`);
    }

    const result = await response.json() as any;
    const errors = result.items?.filter((item: any) => item.index?.error).length || 0;
    return {
      indexed: patents.length - errors,
      errors
    };
  }

  /**
   * Search patents by text query
   */
  async search(
    query: string,
    options: {
      fields?: string[];
      size?: number;
      from?: number;
      filters?: Record<string, any>;
      highlight?: boolean;
    } = {}
  ): Promise<SearchResponse> {
    const {
      fields = ['title', 'abstract'],
      size = 20,
      from = 0,
      filters = {},
      highlight = true
    } = options;

    const esQuery: any = {
      bool: {
        must: [
          {
            multi_match: {
              query,
              fields: fields.map(f => f === 'title' ? 'title^2' : f),
              type: 'best_fields',
              fuzziness: 'AUTO'
            }
          }
        ],
        filter: []
      }
    };

    // Add filters
    if (filters.tier) {
      esQuery.bool.filter.push({ term: { tier: filters.tier } });
    }
    if (filters.competitor) {
      esQuery.bool.filter.push({ term: { competitors_citing: filters.competitor } });
    }
    if (filters.cpc_class) {
      esQuery.bool.filter.push({ term: { cpc_classes: filters.cpc_class } });
    }
    if (filters.min_score) {
      esQuery.bool.filter.push({ range: { enhanced_score: { gte: filters.min_score } } });
    }
    if (filters.has_competitor_citations) {
      esQuery.bool.filter.push({ range: { competitor_citations: { gt: 0 } } });
    }

    const body: any = {
      query: esQuery,
      size,
      from,
      _source: true
    };

    if (highlight) {
      body.highlight = {
        fields: {
          title: { number_of_fragments: 0 },
          abstract: { fragment_size: 200, number_of_fragments: 3 }
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>']
      };
    }

    const response = await this.request<any>(`/${this.indexName}/_search`, 'POST', body);

    return {
      total: response.hits?.total?.value || 0,
      hits: response.hits?.hits?.map((hit: any) => ({
        patent_id: hit._id,
        title: hit._source.title,
        abstract: hit._source.abstract,
        score: hit._score,
        highlights: hit.highlight,
        ...hit._source
      })) || []
    };
  }

  /**
   * Find patents similar to a given patent
   */
  async findSimilar(
    patentId: string,
    options: { size?: number; minTermFreq?: number } = {}
  ): Promise<SearchResponse> {
    const { size = 20, minTermFreq = 1 } = options;

    const body = {
      query: {
        more_like_this: {
          fields: ['title', 'abstract'],
          like: [{ _index: this.indexName, _id: patentId }],
          min_term_freq: minTermFreq,
          min_doc_freq: 2,
          max_query_terms: 25,
          minimum_should_match: '30%'
        }
      },
      size
    };

    const response = await this.request<any>(`/${this.indexName}/_search`, 'POST', body);

    return {
      total: response.hits?.total?.value || 0,
      hits: response.hits?.hits?.map((hit: any) => ({
        patent_id: hit._id,
        title: hit._source.title,
        abstract: hit._source.abstract,
        score: hit._score,
        ...hit._source
      })) || []
    };
  }

  /**
   * Extract significant terms from a set of patents (e.g., Tier 1)
   */
  async extractSignificantTerms(
    filter: { tier?: number; patentIds?: string[] },
    options: { field?: string; size?: number } = {}
  ): Promise<Array<{ term: string; score: number; docCount: number }>> {
    const { field = 'abstract', size = 50 } = options;

    const query: any = { bool: { filter: [] } };

    if (filter.tier) {
      query.bool.filter.push({ term: { tier: filter.tier } });
    }
    if (filter.patentIds?.length) {
      query.bool.filter.push({ ids: { values: filter.patentIds } });
    }

    const body = {
      size: 0,
      query,
      aggs: {
        significant_terms: {
          significant_text: {
            field,
            size,
            min_doc_count: 3
          }
        }
      }
    };

    const response = await this.request<any>(`/${this.indexName}/_search`, 'POST', body);

    return response.aggregations?.significant_terms?.buckets?.map((bucket: any) => ({
      term: bucket.key,
      score: bucket.score,
      docCount: bucket.doc_count
    })) || [];
  }

  /**
   * Get term frequencies for a specific field
   */
  async getTermFrequencies(
    filter: { competitor?: string; tier?: number } = {},
    options: { field?: string; size?: number } = {}
  ): Promise<Array<{ term: string; count: number }>> {
    const { field = 'cpc_codes', size = 50 } = options;

    const query: any = { bool: { filter: [] } };

    if (filter.competitor) {
      query.bool.filter.push({ term: { competitors_citing: filter.competitor } });
    }
    if (filter.tier) {
      query.bool.filter.push({ term: { tier: filter.tier } });
    }

    // If no filters, match all
    if (query.bool.filter.length === 0) {
      query.bool.must = [{ match_all: {} }];
    }

    const body = {
      size: 0,
      query,
      aggs: {
        terms: {
          terms: { field, size }
        }
      }
    };

    const response = await this.request<any>(`/${this.indexName}/_search`, 'POST', body);

    return response.aggregations?.terms?.buckets?.map((bucket: any) => ({
      term: bucket.key,
      count: bucket.doc_count
    })) || [];
  }

  /**
   * Get index statistics
   */
  async getStats(): Promise<{ docCount: number; sizeBytes: number }> {
    const response = await this.request<any>(`/${this.indexName}/_stats`);
    return {
      docCount: response._all?.primaries?.docs?.count || 0,
      sizeBytes: response._all?.primaries?.store?.size_in_bytes || 0
    };
  }

  /**
   * Count documents matching a query
   */
  async count(query?: Record<string, any>): Promise<number> {
    const body = query ? { query } : undefined;
    const response = await this.request<any>(
      `/${this.indexName}/_count`,
      body ? 'POST' : 'GET',
      body
    );
    return response.count || 0;
  }
}

// Factory function
export function createElasticsearchService(
  baseUrl?: string,
  indexName?: string
): ElasticsearchService {
  return new ElasticsearchService(baseUrl, indexName);
}

// CLI for testing
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const es = createElasticsearchService();

  switch (command) {
    case 'health':
      const healthy = await es.healthCheck();
      console.log(`ElasticSearch health: ${healthy ? 'OK' : 'UNAVAILABLE'}`);
      break;

    case 'create-index':
      await es.createIndex();
      break;

    case 'recreate-index':
      await es.recreateIndex();
      break;

    case 'stats':
      const stats = await es.getStats();
      console.log(`Documents: ${stats.docCount}`);
      console.log(`Size: ${(stats.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
      break;

    case 'search':
      const query = args.slice(1).join(' ');
      if (!query) {
        console.log('Usage: search <query>');
        break;
      }
      const results = await es.search(query);
      console.log(`Found ${results.total} results:\n`);
      results.hits.slice(0, 10).forEach(hit => {
        console.log(`[${hit.patent_id}] ${hit.title}`);
        console.log(`  Score: ${hit.score.toFixed(2)}`);
        if (hit.highlights?.abstract) {
          console.log(`  ...${hit.highlights.abstract[0]}...`);
        }
        console.log();
      });
      break;

    case 'similar':
      const patentId = args[1];
      if (!patentId) {
        console.log('Usage: similar <patent_id>');
        break;
      }
      const similar = await es.findSimilar(patentId);
      console.log(`Patents similar to ${patentId}:\n`);
      similar.hits.forEach(hit => {
        console.log(`[${hit.patent_id}] ${hit.title} (score: ${hit.score.toFixed(2)})`);
      });
      break;

    case 'terms':
      const tier = args[1] ? parseInt(args[1]) : undefined;
      const terms = await es.extractSignificantTerms({ tier });
      console.log(`Significant terms${tier ? ` (Tier ${tier})` : ''}:\n`);
      terms.slice(0, 30).forEach(t => {
        console.log(`  ${t.term}: ${t.docCount} docs (score: ${t.score.toFixed(2)})`);
      });
      break;

    default:
      console.log(`
ElasticSearch Service CLI

Commands:
  health          Check if ES is available
  create-index    Create the patents index
  recreate-index  Delete and recreate index
  stats           Show index statistics
  search <query>  Search patents by text
  similar <id>    Find patents similar to given ID
  terms [tier]    Extract significant terms
      `);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('elasticsearch-service')) {
  main().catch(console.error);
}
