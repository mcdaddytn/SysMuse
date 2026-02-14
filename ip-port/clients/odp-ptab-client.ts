/**
 * USPTO Open Data Portal - PTAB API Client (v3)
 *
 * Access Patent Trial and Appeal Board (PTAB) data including:
 * - Inter Partes Review (IPR) proceedings
 * - Post-Grant Review (PGR)
 * - Covered Business Method (CBM) reviews
 * - Ex Parte Appeals
 * - PTAB decisions and documents
 *
 * API Documentation: https://data.uspto.gov/apis/ptab-trials
 * PTAB v3 Migration Guide: https://data.uspto.gov/documents/documents/PTAB-to-ODP-PTAB-API-Mapping.pdf
 * Requires: USPTO ODP API Key
 *
 * Note: PTAB v3 endpoints migrated November 2025 to api.uspto.gov
 */

import { BaseAPIClient } from './base-client.js';

const PTAB_BASE_URL = 'https://api.uspto.gov/api/v1/patent';

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
      'x-api-key': this.config.apiKey,
    };
  }

  /**
   * Search PTAB trial proceedings (v3 API)
   */
  async searchTrials(query: PTABSearchQuery): Promise<PTABTrialSearchResponse> {
    const body: any = {
      pagination: {
        offset: (query.page || 0) * (query.size || 100),
        limit: query.size || 100,
      },
    };

    // v3 API requires filter values to be arrays
    if (query.filters && query.filters.length > 0) {
      body.filters = query.filters.map(f => ({
        name: f.name,
        value: Array.isArray(f.value) ? f.value : [f.value],
      }));
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

    try {
      const response = await this.retryRequest(() =>
        this.post<any>('/trials/proceedings/search', body, this.getHeaders())
      );
      // Transform v3 response to our interface
      return this.transformTrialResponse(response, query.page || 0, query.size || 100);
    } catch (error: any) {
      // 404 means no matching records - return empty results
      if (error.statusCode === 404) {
        return { totalHits: 0, page: query.page || 0, size: query.size || 100, trials: [] };
      }
      throw error;
    }
  }

  /**
   * Transform v3 API response to our interface
   */
  private transformTrialResponse(response: any, page: number, size: number): PTABTrialSearchResponse {
    const trials = (response.patentTrialProceedingDataBag || []).map((item: any) => ({
      trialNumber: item.trialNumber || item.trialMetaData?.trialNumber,
      trialType: item.trialMetaData?.trialTypeCode,
      trialStatusCategory: item.trialMetaData?.trialStatusCategory,
      trialStatusText: item.trialMetaData?.trialStatusText,
      // v3 uses regularPetitionerData for petitioner info
      petitionerPartyName: item.regularPetitionerData?.realPartyInInterestName,
      petitionerCounselName: item.regularPetitionerData?.counselName,
      patentOwnerName: item.patentOwnerData?.patentOwnerName,
      patentOwnerCounselName: item.patentOwnerData?.counselName,
      respondentPatentNumber: item.patentOwnerData?.patentNumber,
      respondentPatentTitle: item.patentOwnerData?.inventionTitle,
      respondentPatentIssueDate: item.patentOwnerData?.grantDate,
      filingDate: item.trialMetaData?.accordedFilingDate || item.trialMetaData?.petitionFilingDate,
      institutionDecisionDate: item.trialMetaData?.institutionDecisionDate,
      institutionDecision: item.trialMetaData?.institutionDecisionCategory,
      finalWrittenDecisionDate: item.trialMetaData?.finalDecisionDate,
      claimsChallenged: item.trialMetaData?.claimsChallenged,
      claimsInstituted: item.trialMetaData?.claimsInstituted,
      // Store original data for access to any unmapped fields
      _raw: item,
    }));

    return {
      totalHits: response.count || 0,
      page,
      size,
      trials,
    };
  }

  /**
   * Get a specific trial by trial number (v3 API)
   */
  async getTrial(trialNumber: string): Promise<PTABTrial> {
    const endpoint = `/trials/proceedings/${trialNumber}`;

    const response = await this.retryRequest(() =>
      this.get<any>(endpoint, this.getHeaders())
    );

    // Transform single trial response
    const item = response;
    return {
      trialNumber: item.trialMetaData?.trialNumber || trialNumber,
      trialType: item.trialMetaData?.trialTypeCode,
      trialStatusCategory: item.trialMetaData?.trialStatusCategory,
      trialStatusText: item.trialMetaData?.trialStatusText,
      petitionerPartyName: item.petitionerData?.petitionerName,
      patentOwnerName: item.patentOwnerData?.patentOwnerName,
      respondentPatentNumber: item.patentOwnerData?.patentNumber,
      respondentPatentTitle: item.patentOwnerData?.inventionTitle,
      respondentPatentIssueDate: item.patentOwnerData?.grantDate,
      filingDate: item.trialMetaData?.accordedFilingDate,
      institutionDecisionDate: item.trialMetaData?.institutionDecisionDate,
      institutionDecision: item.trialMetaData?.institutionDecisionCategory,
      finalWrittenDecisionDate: item.trialMetaData?.finalDecisionDate,
      _raw: item,
    };
  }

  /**
   * Get documents for a specific trial (v3 API)
   */
  async getTrialDocuments(trialNumber: string): Promise<PTABDocumentsResponse> {
    // In v3, use the documents search endpoint with trial filter
    // Note: v3 API has a max limit of 100 per request
    const body = {
      filters: [
        { name: 'trialNumber', value: [trialNumber] }
      ],
      pagination: { offset: 0, limit: 100 }
    };

    try {
      const response = await this.retryRequest(() =>
        this.post<any>('/trials/documents/search', body, this.getHeaders())
      );

      const documents = (response.patentTrialDocumentDataBag || []).map((item: any) => ({
        documentIdentifier: item.documentData?.documentIdentifier,
        documentNumber: item.documentData?.documentNumber,
        trialNumber: item.trialNumber,
        documentType: item.documentData?.documentTypeCode,
        documentTypeDescription: item.documentData?.documentTypeDescriptionText,
        documentTitle: item.documentData?.documentTitle,
        documentCategory: item.documentData?.documentCategory,
        filingDate: item.documentData?.documentFilingDate,
        filingParty: item.documentData?.filingPartyCategory,
        documentUrl: item.documentData?.fileDownloadURI,
        documentSize: item.documentData?.documentSize,
        _raw: item,
      }));

      return {
        totalHits: response.count || 0,
        documents,
      };
    } catch (error: any) {
      // 404 means no documents found
      if (error.statusCode === 404) {
        return { totalHits: 0, documents: [] };
      }
      throw error;
    }
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
   * Search for IPRs by patent number (v3 API)
   */
  async searchIPRsByPatent(patentNumber: string): Promise<PTABTrialSearchResponse> {
    // v3 uses patentOwnerData.patentNumber for the challenged patent
    return this.searchTrials({
      filters: [
        { name: 'trialMetaData.trialTypeCode', value: 'IPR' },
        { name: 'patentOwnerData.patentNumber', value: patentNumber },
      ],
    });
  }

  /**
   * Search for all IPRs filed within a date range (v3 API)
   */
  async searchIPRsByDateRange(
    startDate: string,
    endDate: string
  ): Promise<PTABTrialSearchResponse> {
    return this.searchTrials({
      filters: [
        { name: 'trialMetaData.trialTypeCode', value: 'IPR' },
      ],
      rangeFilters: [
        {
          field: 'trialMetaData.accordedFilingDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ],
    });
  }

  /**
   * Search for IPRs by petitioner (v3 API)
   */
  async searchByPetitioner(petitionerName: string): Promise<PTABTrialSearchResponse> {
    return this.searchTrials({
      filters: [
        { name: 'regularPetitionerData.realPartyInInterestName', value: petitionerName },
      ],
    });
  }

  /**
   * Search for IPRs by patent owner (v3 API)
   */
  async searchByPatentOwner(patentOwnerName: string): Promise<PTABTrialSearchResponse> {
    return this.searchTrials({
      filters: [
        { name: 'patentOwnerData.patentOwnerName', value: patentOwnerName },
      ],
    });
  }

  /**
   * Get all instituted IPRs (v3 API)
   */
  async getInstitutedIPRs(
    startDate?: string,
    endDate?: string
  ): Promise<PTABTrialSearchResponse> {
    const query: PTABSearchQuery = {
      filters: [
        { name: 'trialMetaData.trialTypeCode', value: 'IPR' },
        { name: 'trialMetaData.trialStatusCategory', value: 'Instituted' },
      ],
    };

    if (startDate && endDate) {
      query.rangeFilters = [
        {
          field: 'trialMetaData.institutionDecisionDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ];
    }

    return this.searchTrials(query);
  }

  /**
   * Get all denied institution decisions (v3 API)
   */
  async getDeniedInstitutions(
    startDate?: string,
    endDate?: string
  ): Promise<PTABTrialSearchResponse> {
    const query: PTABSearchQuery = {
      filters: [
        { name: 'trialMetaData.trialStatusCategory', value: 'Institution Denied' },
      ],
    };

    if (startDate && endDate) {
      query.rangeFilters = [
        {
          field: 'trialMetaData.institutionDecisionDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ];
    }

    return this.searchTrials(query);
  }

  /**
   * Search PTAB decisions (v3 API)
   */
  async searchDecisions(query: PTABSearchQuery): Promise<PTABDecisionSearchResponse> {
    const body: any = {
      pagination: {
        offset: (query.page || 0) * (query.size || 100),
        limit: query.size || 100,
      },
    };

    // v3 API requires filter values to be arrays
    if (query.filters && query.filters.length > 0) {
      body.filters = query.filters.map(f => ({
        name: f.name,
        value: Array.isArray(f.value) ? f.value : [f.value],
      }));
    }

    if (query.rangeFilters && query.rangeFilters.length > 0) {
      body.rangeFilters = query.rangeFilters;
    }

    if (query.searchText) {
      body.searchText = query.searchText;
    }

    try {
      const response = await this.retryRequest(() =>
        this.post<any>('/trials/decisions/search', body, this.getHeaders())
      );
      return this.transformDecisionResponse(response, query.page || 0, query.size || 100);
    } catch (error: any) {
      // 404 means no matching records
      if (error.statusCode === 404) {
        return { totalHits: 0, page: query.page || 0, size: query.size || 100, decisions: [] };
      }
      throw error;
    }
  }

  /**
   * Transform v3 decision response to our interface
   */
  private transformDecisionResponse(response: any, page: number, size: number): PTABDecisionSearchResponse {
    const decisions = (response.patentTrialDecisionDataBag || []).map((item: any) => ({
      trialNumber: item.trialNumber,
      decisionType: item.documentData?.documentTypeDescriptionText,
      decisionDate: item.documentData?.documentFilingDate,
      documentIdentifier: item.documentData?.documentIdentifier,
      documentUrl: item.documentData?.fileDownloadURI,
      patentNumber: item.patentOwnerData?.patentNumber,
      _raw: item,
    }));

    return {
      totalHits: response.count || 0,
      page,
      size,
      decisions,
    };
  }

  /**
   * Get final written decisions (v3 API)
   */
  async getFinalWrittenDecisions(
    startDate?: string,
    endDate?: string
  ): Promise<PTABDecisionSearchResponse> {
    const query: PTABSearchQuery = {
      filters: [
        { name: 'documentData.documentTypeDescriptionText', value: 'Final Written Decision' },
      ],
    };

    if (startDate && endDate) {
      query.rangeFilters = [
        {
          field: 'documentData.documentFilingDate',
          valueFrom: startDate,
          valueTo: endDate,
        },
      ];
    }

    return this.searchDecisions(query);
  }

  /**
   * Full text search in decisions
   * Note: v3 API may not support full text search - returns empty results if not available
   */
  async searchDecisionsFullText(_searchText: string): Promise<PTABDecisionSearchResponse> {
    // v3 API doesn't support searchText parameter
    // Return empty results with a note
    console.warn('PTAB v3 API does not support full text search in decisions');
    return { totalHits: 0, page: 0, size: 100, decisions: [] };
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
