/**
 * USPTO Open Data Portal - Office Action Rejection API Client
 *
 * Provides structured per-claim rejection data from office actions:
 * - Claim numbers and rejection statutory basis (101/102/103/112)
 * - Cited prior art references per rejection
 * - Coverage: 2018-present (daily), 2008-2017 (beta)
 *
 * This is the highest priority data source — structured JSON, no LLM needed.
 *
 * API Documentation: https://data.uspto.gov/apis/
 * Requires: USPTO ODP API Key (same key as File Wrapper + PTAB)
 */

import { BaseAPIClient } from './base-client.js';
import type {
  OARejectionApiResponse,
  OARejectionRecord,
} from '../types/office-action-types.js';

const OA_BASE_URL = 'https://api.uspto.gov/api/v1/patent';
const DS_API_BASE_URL = 'https://developer.uspto.gov/ds-api';

export interface OARejectionConfig {
  apiKey: string;
  rateLimit?: number;       // requests per minute (default 60)
  retryAttempts?: number;   // default 3
  retryDelay?: number;      // ms, default 1000
}

/**
 * Raw API response shape (mapped to our types after parsing)
 */
interface RawOARejectionResponse {
  recordTotalQuantity?: number;
  count?: number;
  results?: any[];
  rejections?: any[];
  officeActionRejections?: any[];
  // DS-API response shape
  response?: {
    numFound?: number;
    start?: number;
    docs?: any[];
  };
}

export class OARejectionClient extends BaseAPIClient {
  constructor(config: OARejectionConfig) {
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
   * Get office action rejections by application number.
   * Tries ODP API first, then falls back to legacy DS-API.
   */
  async getRejections(applicationNumber: string): Promise<OARejectionApiResponse> {
    const cleanAppNumber = applicationNumber.replace(/[^0-9]/g, '');

    // Strategy 1: ODP API (POST with JSON filters)
    try {
      const body = {
        filters: [
          { name: 'applicationNumber', value: [cleanAppNumber] }
        ],
        pagination: { offset: 0, limit: 200 }
      };

      const raw = await this.retryRequest<RawOARejectionResponse>(async () => {
        return this.post<RawOARejectionResponse>(
          '/office-actions/rejections/search',
          body,
          this.getHeaders()
        );
      });

      return this.mapResponse(raw);
    } catch (odpErr: any) {
      // Strategy 2: Legacy DS-API (form-urlencoded with Solr criteria, no auth needed)
      // Note: DS-API uses 'applicationId' not 'applicationNumber'
      try {
        const raw = await this.retryRequest<RawOARejectionResponse>(async () => {
          return this.postFormUrlEncoded<RawOARejectionResponse>(
            DS_API_BASE_URL + '/oa_rejections/v1/records',
            { criteria: `applicationId:${cleanAppNumber}`, start: '0', rows: '200' }
          );
        });

        return this.mapResponse(raw);
      } catch (dsErr: any) {
        console.error(`[OARejection] Both APIs failed for ${applicationNumber}:`,
          `ODP: ${odpErr?.message || odpErr}`,
          `DS-API: ${dsErr?.message || dsErr}`);
        return { totalRecords: 0, rejections: [] };
      }
    }
  }

  /**
   * Get office action rejections by patent number.
   * First resolves patent number to application number via File Wrapper search,
   * then fetches rejection data.
   */
  async getRejectionsByPatent(patentNumber: string): Promise<OARejectionApiResponse> {
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
        console.warn(`[OARejection] No application found for patent ${patentNumber}`);
        return { totalRecords: 0, rejections: [] };
      }

      const appNumber = apps[0].applicationNumberText || apps[0].applicationNumber;
      if (!appNumber) {
        return { totalRecords: 0, rejections: [] };
      }

      return this.getRejections(appNumber);
    } catch (err: any) {
      console.error(`[OARejection] Failed to resolve patent ${patentNumber}:`, err?.message || err);
      return { totalRecords: 0, rejections: [] };
    }
  }

  /**
   * Map raw API response to our typed structure
   */
  private mapResponse(raw: RawOARejectionResponse): OARejectionApiResponse {
    // Handle DS-API response shape (results in response.docs)
    const records = raw.response?.docs || raw.results || raw.rejections || raw.officeActionRejections || [];
    const total = raw.response?.numFound || raw.recordTotalQuantity || raw.count || records.length;
    return {
      totalRecords: total,
      rejections: records.map((r: any) => this.mapRejection(r)),
    };
  }

  private mapRejection(raw: any): OARejectionRecord {
    // DS-API wraps values in arrays (Solr convention) — unwrap with helper
    const unwrap = (v: any) => Array.isArray(v) ? v[0] : v;

    // DS-API uses binary flags (rejection101, rejection102, etc.)
    // Derive statutory basis from flags if structured basis field is absent
    let statutoryBasis = unwrap(raw.statutoryBasis) || unwrap(raw.rejectionStatute) || unwrap(raw.basisOfRejection) || '';
    if (!statutoryBasis && (raw.rejection101 || raw.rejection102 || raw.rejection103 || raw.rejection112 || raw.rejectionDp)) {
      const bases: string[] = [];
      if (unwrap(raw.rejection101) === '1' || unwrap(raw.rejection101) === 1) bases.push('101');
      if (unwrap(raw.rejection102) === '1' || unwrap(raw.rejection102) === 1) bases.push('102');
      if (unwrap(raw.rejection103) === '1' || unwrap(raw.rejection103) === 1) bases.push('103');
      if (unwrap(raw.rejection112) === '1' || unwrap(raw.rejection112) === 1) bases.push('112');
      if (unwrap(raw.rejectionDp) === '1' || unwrap(raw.rejectionDp) === 1) bases.push('double-patenting');
      statutoryBasis = bases.join(',');
    }

    return {
      applicationNumber: unwrap(raw.applicationNumber) || unwrap(raw.applicationNumberText) || unwrap(raw.applicationId) || '',
      mailDate: unwrap(raw.mailDate) || unwrap(raw.mailRoomDate) || unwrap(raw.officialDate) || '',
      documentCode: unwrap(raw.documentCode) || unwrap(raw.documentCd) || unwrap(raw.documentCodeDescriptionText) || '',
      rejectionIdentifier: unwrap(raw.rejectionIdentifier) || unwrap(raw.rejectionId) || unwrap(raw.id) || '',
      statutoryBasis,
      rejectionType: unwrap(raw.rejectionType) || unwrap(raw.rejectionCategory) || unwrap(raw.actionType) || '',
      claimNumbers: this.parseClaimNumbers(raw.claimNumbers || raw.claims || raw.rejectedClaims),
      citedReferences: (raw.citedReferences || raw.references || []).map((ref: any) => ({
        referenceNumber: ref.referenceNumber || ref.documentNumber || '',
        referenceType: ref.referenceType || ref.documentKind || '',
        referenceDesignation: ref.referenceDesignation || ref.documentNumber || '',
        referenceDate: ref.referenceDate || ref.documentDate || '',
        relevantClaims: this.parseClaimNumbers(ref.relevantClaims || ref.claims),
      })),
    };
  }

  private parseClaimNumbers(value: any): number[] {
    if (!value) return [];
    // DS-API wraps CSV strings in arrays: ["1,2,3,4,5"] — unwrap and split
    if (Array.isArray(value)) {
      return value.flatMap(v => {
        if (typeof v === 'number') return [v];
        const s = String(v);
        if (s.includes(',') || s.includes(';')) {
          return s.split(/[,;\s]+/).map(p => parseInt(p.trim())).filter(n => !isNaN(n));
        }
        const n = parseInt(s);
        return isNaN(n) ? [] : [n];
      });
    }
    if (typeof value === 'string') {
      return value.split(/[,;\s]+/).map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    }
    return [];
  }
}

/**
 * Create an OA Rejection client using environment config
 */
export function createOARejectionClient(): OARejectionClient {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) {
    throw new Error('USPTO_ODP_API_KEY environment variable is required');
  }
  return new OARejectionClient({
    apiKey,
    rateLimit: parseInt(process.env.API_RATE_LIMIT || '60'),
    retryAttempts: parseInt(process.env.API_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.API_RETRY_DELAY || '1000'),
  });
}
