/**
 * PatentsView API Client
 * 
 * Access patent data including:
 * - Patent bibliographic information
 * - Citations (forward and backward)
 * - Inventors, assignees, locations
 * - Patent classifications (CPC, IPC, USPC)
 * 
 * API Documentation: https://search.patentsview.org/docs/
 * Rate Limit: 45 requests/minute per API key
 */

import { BaseAPIClient } from './base-client.js';

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';

export interface PatentsViewConfig {
  apiKey: string;
}

export interface PatentQueryOptions {
  query: PatentQuery;
  fields?: string[];
  sort?: Array<{ [field: string]: 'asc' | 'desc' }>;
  options?: {
    size?: number;
    after?: string | string[];
    exclude_withdrawn?: boolean;
    pad_patent_id?: boolean;
  };
}

export type PatentQuery = 
  | { [field: string]: any }
  | { _and: PatentQuery[] }
  | { _or: PatentQuery[] }
  | { _not: PatentQuery }
  | { _gte: { [field: string]: string | number } }
  | { _lte: { [field: string]: string | number } }
  | { _gt: { [field: string]: string | number } }
  | { _lt: { [field: string]: string | number } }
  | { _begins: { [field: string]: string } }
  | { _contains: { [field: string]: string } }
  | { _text_any: { [field: string]: string } }
  | { _text_all: { [field: string]: string } }
  | { _text_phrase: { [field: string]: string } };

export interface PatentResponse {
  error: boolean;
  count: number;
  total_hits: number;
  patents: Patent[];
}

export interface Patent {
  patent_id: string;
  patent_number?: string;
  patent_title?: string;
  patent_abstract?: string;
  patent_date?: string;
  patent_type?: string;
  patent_kind?: string;
  wipo_kind?: string;
  withdrawn?: boolean;
  
  // Assignees
  assignees?: Assignee[];
  
  // Inventors
  inventors?: Inventor[];
  
  // Citations
  us_patent_citations?: Citation[];
  us_application_citations?: Citation[];
  foreign_citations?: Citation[];
  other_references?: OtherReference[];
  
  // Classifications
  cpc?: CPCClassification[];
  ipc?: IPCClassification[];
  uspc?: USPCClassification[];
  
  // Claims
  claims?: Claim[];
  
  // Application data
  application_number?: string;
  filing_date?: string;
  
  // Additional fields available - see API docs
  [key: string]: any;
}

export interface Assignee {
  assignee_id: string;
  assignee_organization?: string;
  assignee_individual_name_first?: string;
  assignee_individual_name_last?: string;
  assignee_type?: string;
  assignee_country?: string;
  assignee_state?: string;
  assignee_city?: string;
}

export interface Inventor {
  inventor_id: string;
  inventor_name_first?: string;
  inventor_name_last?: string;
  inventor_city?: string;
  inventor_state?: string;
  inventor_country?: string;
}

export interface Citation {
  cited_patent_number?: string;
  cited_patent_id?: string;
  cited_patent_title?: string;
  cited_patent_date?: string;
  citation_category?: string;
  citation_sequence?: number;
}

export interface OtherReference {
  other_reference_id: string;
  other_reference_text?: string;
}

export interface CPCClassification {
  cpc_section_id?: string;
  cpc_subsection_id?: string;
  cpc_group_id?: string;
  cpc_subgroup_id?: string;
  cpc_category?: string;
}

export interface IPCClassification {
  ipc_class?: string;
  ipc_subclass?: string;
  ipc_main_group?: string;
  ipc_subgroup?: string;
}

export interface USPCClassification {
  uspc_mainclass_id?: string;
  uspc_subclass_id?: string;
  uspc_sequence?: number;
}

export interface Claim {
  claim_text?: string;
  claim_number?: string;
  claim_dependent?: boolean;
  claim_sequence?: number;
}

export class PatentsViewClient extends BaseAPIClient {
  constructor(config: PatentsViewConfig) {
    super({
      baseUrl: PATENTSVIEW_BASE_URL,
      apiKey: config.apiKey,
      rateLimit: {
        requestsPerMinute: 45, // PatentsView rate limit
      },
      retryAttempts: 3,
      retryDelay: 1000,
    });
  }

  /**
   * Get authentication headers for PatentsView API
   */
  private getHeaders(): Record<string, string> {
    return {
      'X-Api-Key': this.config.apiKey,
    };
  }

  /**
   * Search patents with advanced query
   */
  async searchPatents(queryOptions: PatentQueryOptions): Promise<PatentResponse> {
    const params: Record<string, any> = {
      q: queryOptions.query,
    };

    if (queryOptions.fields && queryOptions.fields.length > 0) {
      params.f = queryOptions.fields;
    }

    if (queryOptions.sort && queryOptions.sort.length > 0) {
      params.s = queryOptions.sort;
    }

    if (queryOptions.options) {
      params.o = queryOptions.options;
    }

    return this.retryRequest(() =>
      this.post<PatentResponse>('/patent/', params, this.getHeaders())
    );
  }

  /**
   * Get a specific patent by patent ID or number
   */
  async getPatent(
    patentId: string,
    fields?: string[]
  ): Promise<Patent | null> {
    const response = await this.searchPatents({
      query: { patent_id: patentId },
      fields: fields || [
        'patent_id',
        'patent_title',
        'patent_abstract',
        'patent_date',
        'assignees',
        'inventors',
        'cpc',
      ],
    });

    return response.patents.length > 0 ? response.patents[0] : null;
  }

  /**
   * Search patents by date range
   */
  async searchByDateRange(
    startDate: string,
    endDate: string,
    additionalQuery?: PatentQuery,
    fields?: string[]
  ): Promise<PatentResponse> {
    const dateQuery: PatentQuery = {
      _and: [
        { _gte: { patent_date: startDate } },
        { _lte: { patent_date: endDate } },
      ],
    };

    const query = additionalQuery
      ? { _and: [dateQuery, additionalQuery] }
      : dateQuery;

    return this.searchPatents({
      query,
      fields: fields || ['patent_id', 'patent_id', 'patent_title', 'patent_date'],
    });
  }

  /**
   * Search patents by assignee organization
   */
  async searchByAssignee(
    assigneeOrg: string,
    additionalQuery?: PatentQuery,
    fields?: string[]
  ): Promise<PatentResponse> {
    const assigneeQuery: PatentQuery = {
      'assignees.assignee_organization': assigneeOrg,
    };

    const query = additionalQuery
      ? { _and: [assigneeQuery, additionalQuery] }
      : assigneeQuery;

    return this.searchPatents({
      query,
      fields: fields || [
        'patent_id',
        'patent_title',
        'patent_date',
        'assignees',
      ],
    });
  }

  /**
   * Get citation counts for a patent
   * Note: Full citation data requires using the separate citation endpoints
   */
  async getPatentCitations(patentId: string): Promise<{
    backward: Citation[];
    forward: Patent[];
    counts: {
      usPatentsCited: number;
      usApplicationsCited: number;
      foreignDocumentsCited: number;
      totalCited: number;
      timesCitedByUSPatents: number;
    };
  }> {
    // Get patent with citation count fields
    const patentResponse = await this.getPatent(patentId, [
      'patent_id',
      'patent_num_us_patents_cited',
      'patent_num_us_applications_cited',
      'patent_num_foreign_documents_cited',
      'patent_num_total_documents_cited',
      'patent_num_times_cited_by_us_patents',
    ]);

    const counts = {
      usPatentsCited: patentResponse?.patent_num_us_patents_cited || 0,
      usApplicationsCited: patentResponse?.patent_num_us_applications_cited || 0,
      foreignDocumentsCited: patentResponse?.patent_num_foreign_documents_cited || 0,
      totalCited: patentResponse?.patent_num_total_documents_cited || 0,
      timesCitedByUSPatents: patentResponse?.patent_num_times_cited_by_us_patents || 0,
    };

    // Note: To get full citation details, use the dedicated citation endpoints:
    // - /api/v1/patent/us_patent_citation/
    // - /api/v1/patent/us_application_citation/
    // - /api/v1/patent/foreign_citation/

    return {
      backward: [], // Use citation endpoints for full data
      forward: [],  // Use citation endpoints for full data
      counts,
    };
  }

  /**
   * Get forward citations - patents that cite a given patent
   * Uses the dedicated /patent/us_patent_citation/ endpoint
   */
  async getForwardCitations(
    patentId: string,
    maxResults: number = 500
  ): Promise<{
    total_hits: number;
    citing_patent_ids: string[];
  }> {
    const response = await this.retryRequest(() =>
      this.post<any>('/patent/us_patent_citation/', {
        q: { citation_patent_id: patentId },
        f: ['patent_id'],
        o: { size: maxResults }
      }, this.getHeaders())
    );

    const citingIds = response.us_patent_citations
      ? [...new Set(response.us_patent_citations.map((c: any) => c.patent_id))]
      : [];

    return {
      total_hits: response.total_hits || 0,
      citing_patent_ids: citingIds as string[],
    };
  }

  /**
   * Get details of multiple patents by ID (batch query)
   */
  async getPatentsBatch(
    patentIds: string[],
    fields?: string[]
  ): Promise<Patent[]> {
    if (patentIds.length === 0) return [];

    // PatentsView has limits, so batch in chunks of 100
    const batchSize = 100;
    const allPatents: Patent[] = [];

    for (let i = 0; i < patentIds.length; i += batchSize) {
      const batch = patentIds.slice(i, i + batchSize);

      const response = await this.retryRequest(() =>
        this.post<PatentResponse>('/patent/', {
          q: { _or: batch.map(id => ({ patent_id: id })) },
          f: fields || [
            'patent_id',
            'patent_title',
            'patent_date',
            'assignees',
          ],
          o: { size: batchSize }
        }, this.getHeaders())
      );

      allPatents.push(...response.patents);
    }

    return allPatents;
  }

  /**
   * Search patents by CPC classification
   */
  async searchByCPC(
    cpcSection: string,
    additionalQuery?: PatentQuery,
    fields?: string[]
  ): Promise<PatentResponse> {
    const cpcQuery: PatentQuery = {
      'cpc.cpc_section_id': cpcSection,
    };

    const query = additionalQuery
      ? { _and: [cpcQuery, additionalQuery] }
      : cpcQuery;

    return this.searchPatents({
      query,
      fields: fields || [
        'patent_id',
        'patent_title',
        'patent_date',
        'cpc',
      ],
    });
  }

  /**
   * Full text search in patent title and abstract
   */
  async searchFullText(
    searchText: string,
    fields?: string[],
    searchIn: 'title' | 'abstract' | 'both' = 'both'
  ): Promise<PatentResponse> {
    let query: PatentQuery;

    if (searchIn === 'both') {
      query = {
        _or: [
          { _text_any: { patent_title: searchText } },
          { _text_any: { patent_abstract: searchText } },
        ],
      };
    } else if (searchIn === 'title') {
      query = { _text_any: { patent_title: searchText } };
    } else {
      query = { _text_any: { patent_abstract: searchText } };
    }

    return this.searchPatents({
      query,
      fields: fields || ['patent_id', 'patent_id', 'patent_title', 'patent_abstract'],
    });
  }

  /**
   * Get all patents for a specific inventor
   */
  async searchByInventor(
    inventorLastName: string,
    inventorFirstName?: string,
    fields?: string[]
  ): Promise<PatentResponse> {
    const query: PatentQuery = inventorFirstName
      ? {
          _and: [
            { 'inventors.inventor_name_last': inventorLastName },
            { 'inventors.inventor_name_first': inventorFirstName },
          ],
        }
      : { 'inventors.inventor_name_last': inventorLastName };

    return this.searchPatents({
      query,
      fields: fields || [
        'patent_id',
        'patent_title',
        'patent_date',
        'inventors',
      ],
    });
  }

  /**
   * Paginated search - automatically handles pagination
   */
  async *searchPaginated(
    queryOptions: PatentQueryOptions,
    pageSize: number = 100
  ): AsyncGenerator<Patent[], void, unknown> {
    let hasMore = true;
    let afterCursor: string | string[] | undefined = undefined;

    while (hasMore) {
      const options = {
        ...queryOptions,
        options: {
          ...queryOptions.options,
          size: pageSize,
          after: afterCursor,
        },
      };

      const response = await this.searchPatents(options);

      if (response.patents.length === 0) {
        break;
      }

      yield response.patents;

      // Check if there are more results
      if (response.patents.length < pageSize) {
        hasMore = false;
      } else {
        // Get the last value from the sort field for cursor
        const lastPatent = response.patents[response.patents.length - 1];
        const sortFields = queryOptions.sort || [{ patent_id: 'asc' }];
        
        afterCursor = sortFields.map(sortObj => {
          const field = Object.keys(sortObj)[0];
          return lastPatent[field];
        });

        if (afterCursor.length === 1) {
          afterCursor = afterCursor[0];
        }
      }
    }
  }
}

// Helper function to create client from environment
export function createPatentsViewClient(): PatentsViewClient {
  const apiKey = process.env.PATENTSVIEW_API_KEY;
  
  if (!apiKey) {
    throw new Error('PATENTSVIEW_API_KEY environment variable is required');
  }

  return new PatentsViewClient({ apiKey });
}
