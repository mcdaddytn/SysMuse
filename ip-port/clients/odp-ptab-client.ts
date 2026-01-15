/**
 * USPTO Open Data Portal - PTAB API Client
 * 
 * Access Patent Trial and Appeal Board (PTAB) data including:
 * - Inter Partes Review (IPR) proceedings
 * - Post-Grant Review (PGR)
 * - Covered Business Method (CBM) reviews
 * - Ex Parte Appeals
 * - PTAB decisions and documents
 * 
 * API Documentation: https://data.uspto.gov/apis/ptab-trials
 * Swagger: https://data.uspto.gov/swagger/index.html
 * Requires: USPTO ODP API Key
 */

import { BaseAPIClient, APIConfig } from './base-client.js';

const PTAB_BASE_URL = 'https://api.data.uspto.gov/ptab/v1';

export interface PTABConfig {
  apiKey: string;
}

export interface PTABSearchQuery {
  filters?: PTABFilter[];
  rangeFilters?: PTABRangeFilter[];
  sort?: PTABSort[];
  page?: number;
  size?: number;
  searchText?: string;
}

export interface PTABFilter {
  name: string;
  value: string | string[];
}

export interface PTABRangeFilter {
  field: string;
  valueFrom?: string;
  valueTo?: string;
}

export interface PTABSort {
  field: string;
  order: 'asc' | 'desc';
}

export interface PTABTrialSearchResponse {
  totalHits: number;
  page: number;
  size: number;
  trials: PTABTrial[];
}

export interface PTABTrial {
  trialNumber: string;
  trialType: string; // IPR, PGR, CBM, etc.
  trialStatusCategory?: string;
  trialStatusText?: string;
  
  // Petitioner information
  petitionerPartyName?: string;
  petitionerCounselName?: string;
  
  // Patent owner information
  patentOwnerName?: string;
  patentOwnerCounselName?: string;
  
  // Challenged patent information
  respondentPatentNumber?: string;
  respondentPatentTitle?: string;
  respondentPatentIssueDate?: string;
  
  // Trial dates
  filingDate?: string;
  institutionDecisionDate?: string;
  institutionDecision?: string; // "Instituted" or "Denied"
  finalWrittenDecisionDate?: string;
  
  // Claims challenged
  claimsChallenged?: string;
  claimsInstituted?: string;
  
  // Outcome
  finalWrittenDecisionType?: string;
  patentability?: string; // "Unpatentable", "Patentable", "Mixed"
  
  [key: string]: any;
}

export interface PTABDocumentsResponse {
  totalHits: number;
  documents: PTABDocument[];
}

export interface PTABDocument {
  documentIdentifier: string;
  documentNumber?: string;
  trialNumber?: string;
  documentType?: string;
  documentTypeDescription?: string;
  documentTitle?: string;
  documentCategory?: string;
  filingDate?: string;
  filingParty?: string;
  documentUrl?: string;
  documentSize?: number;
  
  // Decision specific fields
  isDecision?: boolean;
  decisionType?: string;
  decisionDate?: string;
  
  [key: string]: any;
}

export interface PTABDecisionSearchResponse {
  totalHits: number;
  page: number;
  size: number;
  decisions: PTABDecision[];
}

export interface PTABDecision {
  trialNumber: string;
  decisionType: string;
  decisionDate?: string;
  documentIdentifier?: string;
  documentUrl?: string;
  
  // Patent information
  patentNumber?: string;
  
  // Decision details
  decisionText?: string;
  decisionSummary?: string;
  
  // Claims analysis
  claimsAnalyzed?: ClaimAnalysis[];
  
  [key: string]: any;
}

export interface ClaimAnalysis {
  claimNumber: string;
  patentability: 'Unpatentable' | 'Patentable' | 'Not Instituted';
  basis?: string;
  priorArt?: string[];
}

export interface PTABStatistics {
  totalTrials: number;
  totalIPR: number;
  totalPGR: number;
  totalCBM: number;
  institutionRate: number;
  settlementRate: number;
  averageDuration: number;
}

export class PTABClient extends BaseAPIClient {
  constructor(config: PTABConfig) {
    super({
      baseUrl: PTAB_BASE_URL,
      apiKey: config.apiKey,
      rateLimit: {
        requestsPerMinute: 60, // Conservative estimate
      },
      retryAttempts: 3,
      retryDelay: 1000,
    });
  }

  /**
   * Get authentication headers for USPTO ODP API
   */
  private getHeaders(): Record<string, string> {
    return {
      'X-API-Key': this.config.apiKey,
    };
  }

  /**
   * Search PTAB trial proceedings
   */
  async searchTrials(query: PTABSearchQuery): Promise<PTABTrialSearchResponse> {
    const body: any = {
      page: query.page || 0,
      size: query.size || 100,
    };

    if (query.filters && query.filters.length > 0) {
      body.filters = query.filters;
    }

    if (query.rangeFilters && query.rangeFilters.length > 0) {
      body.rangeFilters = query.rangeFilters;
    }

    if (query.sort && query.sort.length > 0) {
      body.sort = query.sort;
    }

    if (query.searchText) {
      body.searchText = query.searchText;
    }

    return this.retryRequest(() =>
      this.post<PTABTrialSearchResponse>('/trials/search', body, this.getHeaders())
    );
  }

  /**
   * Get a specific trial by trial number
   */
  async getTrial(trialNumber: string): Promise<PTABTrial> {
    const endpoint = `/trials/${trialNumber}`;

    return this.retryRequest(() =>
      this.get<PTABTrial>(endpoint, this.getHeaders())
    );
  }

  /**
   * Get documents for a specific trial
   */
  async getTrialDocuments(trialNumber: string): Promise<PTABDocumentsResponse> {
    const endpoint = `/trials/${trialNumber}/documents`;

    return this.retryRequest(() =>
      this.get<PTABDocumentsResponse>(endpoint, this.getHeaders())
    );
  }

  /**
   * Download a specific PTAB document
   */
  async downloadDocument(
    trialNumber: string,
    documentIdentifier: string
  ): Promise<ArrayBuffer> {
    const endpoint = `/trials/${trialNumber}/documents/${documentIdentifier}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        signal: controller.signal,
        headers: this.getHeaders(),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to download document: ${response.status}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Search for IPRs by patent number
   */
  async searchIPRsByPatent(patentNumber: string): Promise<PTABTrialSearchResponse> {
    return this.searchTrials({
      filters: [
        { name: 'trialType', value: 'IPR' },
        { name: 'respondentPatentNumber', value: patentNumber },
      ],
    });
  }

  /**
   * Search for all IPRs filed within a date range
   */
  async searchIPRsByDateRange(
    startDate: string,
    endDate: string
  ): Promise<PTABTrialSearchResponse> {
    return this.searchTrials({
      filters: [
        { name: 'trialType', value: 'IPR' },
      ],
      rangeFilters: [
        {
          field: 'filingDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ],
    });
  }

  /**
   * Search for IPRs by petitioner
   */
  async searchByPetitioner(petitionerName: string): Promise<PTABTrialSearchResponse> {
    return this.searchTrials({
      filters: [
        { name: 'petitionerPartyName', value: petitionerName },
      ],
    });
  }

  /**
   * Search for IPRs by patent owner
   */
  async searchByPatentOwner(patentOwnerName: string): Promise<PTABTrialSearchResponse> {
    return this.searchTrials({
      filters: [
        { name: 'patentOwnerName', value: patentOwnerName },
      ],
    });
  }

  /**
   * Get all instituted IPRs
   */
  async getInstitutedIPRs(
    startDate?: string,
    endDate?: string
  ): Promise<PTABTrialSearchResponse> {
    const query: PTABSearchQuery = {
      filters: [
        { name: 'trialType', value: 'IPR' },
        { name: 'institutionDecision', value: 'Instituted' },
      ],
    };

    if (startDate && endDate) {
      query.rangeFilters = [
        {
          field: 'institutionDecisionDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ];
    }

    return this.searchTrials(query);
  }

  /**
   * Get all denied institution decisions
   */
  async getDeniedInstitutions(
    startDate?: string,
    endDate?: string
  ): Promise<PTABTrialSearchResponse> {
    const query: PTABSearchQuery = {
      filters: [
        { name: 'institutionDecision', value: 'Denied' },
      ],
    };

    if (startDate && endDate) {
      query.rangeFilters = [
        {
          field: 'institutionDecisionDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ];
    }

    return this.searchTrials(query);
  }

  /**
   * Search PTAB decisions
   */
  async searchDecisions(query: PTABSearchQuery): Promise<PTABDecisionSearchResponse> {
    const body: any = {
      page: query.page || 0,
      size: query.size || 100,
    };

    if (query.filters && query.filters.length > 0) {
      body.filters = query.filters;
    }

    if (query.rangeFilters && query.rangeFilters.length > 0) {
      body.rangeFilters = query.rangeFilters;
    }

    if (query.searchText) {
      body.searchText = query.searchText;
    }

    return this.retryRequest(() =>
      this.post<PTABDecisionSearchResponse>('/decisions/search', body, this.getHeaders())
    );
  }

  /**
   * Get final written decisions
   */
  async getFinalWrittenDecisions(
    startDate?: string,
    endDate?: string
  ): Promise<PTABDecisionSearchResponse> {
    const query: PTABSearchQuery = {
      filters: [
        { name: 'decisionType', value: 'Final Written Decision' },
      ],
    };

    if (startDate && endDate) {
      query.rangeFilters = [
        {
          field: 'decisionDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ];
    }

    return this.searchDecisions(query);
  }

  /**
   * Full text search in decisions
   */
  async searchDecisionsFullText(searchText: string): Promise<PTABDecisionSearchResponse> {
    return this.searchDecisions({
      searchText,
    });
  }

  /**
   * Get comprehensive trial information including all documents
   */
  async getTrialComplete(trialNumber: string): Promise<{
    trial: PTABTrial;
    documents: PTABDocument[];
  }> {
    const [trial, documentsResponse] = await Promise.all([
      this.getTrial(trialNumber),
      this.getTrialDocuments(trialNumber),
    ]);

    return {
      trial,
      documents: documentsResponse.documents,
    };
  }

  /**
   * Calculate statistics for a set of trials
   */
  calculateStatistics(trials: PTABTrial[]): PTABStatistics {
    const totalTrials = trials.length;
    const iprTrials = trials.filter(t => t.trialType === 'IPR');
    const pgrTrials = trials.filter(t => t.trialType === 'PGR');
    const cbmTrials = trials.filter(t => t.trialType === 'CBM');

    const institutedTrials = trials.filter(
      t => t.institutionDecision === 'Instituted'
    );

    const settledTrials = trials.filter(t =>
      t.trialStatusText?.toLowerCase().includes('settled')
    );

    const trialsWithDuration = trials.filter(
      t => t.filingDate && t.finalWrittenDecisionDate
    );

    const avgDuration = trialsWithDuration.length > 0
      ? trialsWithDuration.reduce((sum, trial) => {
          const start = new Date(trial.filingDate!).getTime();
          const end = new Date(trial.finalWrittenDecisionDate!).getTime();
          const days = (end - start) / (1000 * 60 * 60 * 24);
          return sum + days;
        }, 0) / trialsWithDuration.length
      : 0;

    return {
      totalTrials,
      totalIPR: iprTrials.length,
      totalPGR: pgrTrials.length,
      totalCBM: cbmTrials.length,
      institutionRate:
        totalTrials > 0 ? (institutedTrials.length / totalTrials) * 100 : 0,
      settlementRate:
        totalTrials > 0 ? (settledTrials.length / totalTrials) * 100 : 0,
      averageDuration: avgDuration,
    };
  }

  /**
   * Paginated search through trials
   */
  async *searchPaginated(
    query: PTABSearchQuery,
    pageSize: number = 100
  ): AsyncGenerator<PTABTrial[], void, unknown> {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.searchTrials({
        ...query,
        page,
        size: pageSize,
      });

      if (response.trials.length === 0) {
        break;
      }

      yield response.trials;

      const totalRetrieved = (page + 1) * pageSize;
      hasMore = totalRetrieved < response.totalHits;
      page++;
    }
  }
}

// Helper function to create client from environment
export function createPTABClient(): PTABClient {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  
  if (!apiKey) {
    throw new Error('USPTO_ODP_API_KEY environment variable is required');
  }

  return new PTABClient({ apiKey });
}
