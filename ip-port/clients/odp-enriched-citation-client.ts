/**
 * USPTO Open Data Portal - Enriched Citation API Client
 *
 * Provides AI-extracted claim-to-prior-art mapping:
 * - Which claims each reference is cited against
 * - Citation relevance (primary/secondary)
 * - Specific elements from prior art mapped to claim limitations
 *
 * Lower priority data source — use after Rejection + Text APIs are validated.
 *
 * API Documentation: https://data.uspto.gov/apis/
 * Requires: USPTO ODP API Key (same key as File Wrapper + PTAB)
 */

import { BaseAPIClient } from './base-client.js';
import type {
  EnrichedCitationApiResponse,
  EnrichedCitationRecord,
  ClaimCitationMapping,
} from '../types/office-action-types.js';

const OA_BASE_URL = 'https://api.uspto.gov/api/v1/patent';
const DS_API_BASE_URL = 'https://developer.uspto.gov/ds-api';

export interface EnrichedCitationConfig {
  apiKey: string;
  rateLimit?: number;       // requests per minute (default 60)
  retryAttempts?: number;   // default 3
  retryDelay?: number;      // ms, default 1000
}

/**
 * Raw API response shape (mapped to our types after parsing)
 */
interface RawEnrichedCitationResponse {
  recordTotalQuantity?: number;
  count?: number;
  results?: any[];
  citations?: any[];
  enrichedCitations?: any[];
  // DS-API response shape
  response?: {
    numFound?: number;
    start?: number;
    docs?: any[];
  };
}

export class EnrichedCitationClient extends BaseAPIClient {
  constructor(config: EnrichedCitationConfig) {
    super({
      baseUrl: OA_BASE_URL,
      apiKey: config.apiKey,
      rateLimit: {
        requestsPerMinute: config.rateLimit ?? 60,
      },
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 1000,
    });
  }

  private getHeaders(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey,
    };
  }

  /**
   * Get enriched citations by application number.
   * Returns AI-extracted claim-to-prior-art mapping.
   */
  async getCitations(applicationNumber: string): Promise<EnrichedCitationApiResponse> {
    const cleanAppNumber = applicationNumber.replace(/[^0-9]/g, '');

    // Strategy 1: ODP API (POST with JSON filters)
    try {
      const body = {
        filters: [
          { name: 'applicationNumber', value: [cleanAppNumber] }
        ],
        pagination: { offset: 0, limit: 500 }
      };

      const raw = await this.retryRequest<RawEnrichedCitationResponse>(async () => {
        return this.post<RawEnrichedCitationResponse>(
          '/enriched-citations/search',
          body,
          this.getHeaders()
        );
      });

      return this.mapResponse(raw);
    } catch (odpErr: any) {
      // Strategy 2: ODP v3 GET endpoint
      try {
        const raw = await this.retryRequest<RawEnrichedCitationResponse>(async () => {
          return this.get<RawEnrichedCitationResponse>(
            `/api/v3/patent/citations/search?applicationNumber=${cleanAppNumber}&offset=0&limit=500`,
            this.getHeaders()
          );
        });
        return this.mapResponse(raw);
      } catch {
        // Strategy 3: Legacy DS-API — Enriched Citation metadata (no auth needed)
        // Note: Uses 'patentApplicationNumber' field name
        try {
          const raw = await this.retryRequest<RawEnrichedCitationResponse>(async () => {
            return this.postFormUrlEncoded<RawEnrichedCitationResponse>(
              DS_API_BASE_URL + '/enriched_cited_reference_metadata/1/records',
              { criteria: `patentApplicationNumber:${cleanAppNumber}`, start: '0', rows: '500' }
            );
          });
          return this.mapResponse(raw);
        } catch (dsErr: any) {
          console.error(`[EnrichedCitation] All APIs failed for ${applicationNumber}:`,
            `ODP: ${odpErr?.message || odpErr}`,
            `DS-API: ${dsErr?.message || dsErr}`);
          return { totalRecords: 0, citations: [] };
        }
      }
    }
  }

  /**
   * Get enriched citations by patent number.
   * First resolves patent number to application number via File Wrapper search,
   * then fetches citation data.
   */
  async getCitationsByPatent(patentNumber: string): Promise<EnrichedCitationApiResponse> {
    const cleanPatentNum = patentNumber.replace(/[^0-9A-Za-z]/g, '');

    // Search for application by patent number
    const body = {
      filters: [
        { name: 'applicationMetaData.patentNumber', value: [cleanPatentNum] }
      ],
      pagination: {
        offset: 0,
        limit: 1
      }
    };

    try {
      const searchResult = await this.retryRequest<any>(async () => {
        return this.post<any>(
          '/applications/search',
          body,
          this.getHeaders()
        );
      });

      const apps = searchResult?.applicationBag || searchResult?.applications || [];
      if (apps.length === 0) {
        console.warn(`[EnrichedCitation] No application found for patent ${patentNumber}`);
        return { totalRecords: 0, citations: [] };
      }

      const appNumber = apps[0].applicationNumberText || apps[0].applicationNumber;
      if (!appNumber) {
        return { totalRecords: 0, citations: [] };
      }

      return this.getCitations(appNumber);
    } catch (err: any) {
      console.error(`[EnrichedCitation] Failed to resolve patent ${patentNumber}:`, err?.message || err);
      return { totalRecords: 0, citations: [] };
    }
  }

  /**
   * Map raw API response to our typed structure
   */
  private mapResponse(raw: RawEnrichedCitationResponse): EnrichedCitationApiResponse {
    const records = raw.response?.docs || raw.results || raw.citations || raw.enrichedCitations || [];
    const total = raw.response?.numFound || raw.recordTotalQuantity || raw.count || records.length;
    return {
      totalRecords: total,
      citations: records.map((r: any) => this.mapCitation(r)),
    };
  }

  private mapCitation(raw: any): EnrichedCitationRecord {
    // DS-API wraps values in arrays (Solr convention)
    const unwrap = (v: any) => Array.isArray(v) ? v[0] : v;

    const citedRef = unwrap(raw.citedReference) || unwrap(raw.citedDocumentIdentifier) || unwrap(raw.referenceDesignation) || unwrap(raw.documentNumber) || '';

    // DS-API enriched citations use 'citationCategoryCode' (X=primary, Y=combined, A=background)
    const catCode = unwrap(raw.citationCategoryCode);
    const refType = unwrap(raw.citedReferenceType) || unwrap(raw.referenceType) || unwrap(raw.documentKind) || '';

    // DS-API 'relatedClaimNumberText' is a string like "1-20" — parse to claim mappings
    const claimMapping = raw.claimMapping || raw.claimCitationMappings || [];
    if (claimMapping.length === 0 && raw.relatedClaimNumberText) {
      const claimText = unwrap(raw.relatedClaimNumberText) || '';
      const relevance = catCode === 'X' ? 'primary' : 'secondary';
      const passageText = unwrap(raw.passageLocationText) || '';
      const elements = passageText ? passageText.split('|').map((s: string) => s.trim()).filter(Boolean) : undefined;

      // Parse claim ranges like "1-20" or "1,3,5-7"
      const claimNums = this.parseClaimRange(claimText);
      return {
        applicationNumber: unwrap(raw.applicationNumber) || unwrap(raw.patentApplicationNumber) || '',
        patentNumber: unwrap(raw.patentNumber) || unwrap(raw.grantNumber) || undefined,
        citedReference: citedRef,
        citedReferenceType: refType,
        claimMapping: claimNums.map(n => ({ claimNumber: n, citationRelevance: relevance, citedElements: elements })),
      };
    }

    return {
      applicationNumber: unwrap(raw.applicationNumber) || unwrap(raw.patentApplicationNumber) || '',
      patentNumber: unwrap(raw.patentNumber) || unwrap(raw.grantNumber) || undefined,
      citedReference: citedRef,
      citedReferenceType: refType,
      claimMapping: claimMapping.map((m: any) => this.mapClaimMapping(m)),
    };
  }

  private mapClaimMapping(raw: any): ClaimCitationMapping {
    return {
      claimNumber: typeof raw.claimNumber === 'number' ? raw.claimNumber : parseInt(String(raw.claimNumber || '0')),
      citationRelevance: raw.citationRelevance || raw.relevance || 'secondary',
      citedElements: raw.citedElements || raw.elements || undefined,
    };
  }

  /**
   * Parse claim range strings like "1-20", "1,3,5-7", or "1-3,5,7-10"
   */
  private parseClaimRange(text: string): number[] {
    if (!text) return [];
    const claims: number[] = [];
    const parts = text.split(',').map(s => s.trim());
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(s => parseInt(s.trim()));
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = start; i <= end; i++) claims.push(i);
        }
      } else {
        const n = parseInt(part);
        if (!isNaN(n)) claims.push(n);
      }
    }
    return claims;
  }
}

/**
 * Create an Enriched Citation client using environment config
 */
export function createEnrichedCitationClient(): EnrichedCitationClient {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) {
    throw new Error('USPTO_ODP_API_KEY environment variable is required');
  }
  return new EnrichedCitationClient({
    apiKey,
    rateLimit: parseInt(process.env.API_RATE_LIMIT || '60'),
    retryAttempts: parseInt(process.env.API_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.API_RETRY_DELAY || '1000'),
  });
}
