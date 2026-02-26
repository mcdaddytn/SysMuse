/**
 * USPTO Open Data Portal - Office Action Text API Client
 *
 * Returns extracted text from office action documents.
 * No PDF parsing needed — USPTO provides pre-extracted text.
 *
 * Coverage: 12-series filing numbers and newer.
 * For older patents, use the PDF download + pdftotext fallback
 * (see prosecution-document-service.ts).
 *
 * API Documentation: https://data.uspto.gov/apis/
 * Requires: USPTO ODP API Key (same key as File Wrapper + PTAB)
 */

import { BaseAPIClient } from './base-client.js';
import type {
  OATextApiResponse,
  OATextRecord,
} from '../types/office-action-types.js';

const OA_BASE_URL = 'https://api.uspto.gov/api/v1/patent';
const DS_API_BASE_URL = 'https://developer.uspto.gov/ds-api';

export interface OATextConfig {
  apiKey: string;
  rateLimit?: number;       // requests per minute (default 60)
  retryAttempts?: number;   // default 3
  retryDelay?: number;      // ms, default 1000
}

/**
 * Raw API response shape
 */
interface RawOATextResponse {
  recordTotalQuantity?: number;
  count?: number;
  results?: any[];
  officeActions?: any[];
  officeActionTexts?: any[];
  // DS-API response shape
  response?: {
    numFound?: number;
    start?: number;
    docs?: any[];
  };
}

export class OATextClient extends BaseAPIClient {
  constructor(config: OATextConfig) {
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
   * Get extracted office action text by application number.
   * Returns pre-extracted text for each office action.
   */
  async getOfficeActionText(applicationNumber: string): Promise<OATextApiResponse> {
    const cleanAppNumber = applicationNumber.replace(/[^0-9]/g, '');

    // Strategy 1: ODP API (POST with JSON filters)
    try {
      const body = {
        filters: [
          { name: 'applicationNumber', value: [cleanAppNumber] }
        ],
        pagination: { offset: 0, limit: 50 }
      };

      const raw = await this.retryRequest<RawOATextResponse>(async () => {
        return this.post<RawOATextResponse>(
          '/office-actions/texts/search',
          body,
          this.getHeaders()
        );
      });

      return this.mapResponse(raw);
    } catch (odpErr: any) {
      // Strategy 2: Legacy DS-API (form-urlencoded with Solr criteria, no auth needed)
      // Note: DS-API dataset is 'oa_actions' and uses 'patentApplicationNumber'
      try {
        const raw = await this.retryRequest<RawOATextResponse>(async () => {
          return this.postFormUrlEncoded<RawOATextResponse>(
            DS_API_BASE_URL + '/oa_actions/v1/records',
            { criteria: `patentApplicationNumber:${cleanAppNumber}`, start: '0', rows: '50' }
          );
        });

        return this.mapResponse(raw);
      } catch (dsErr: any) {
        console.error(`[OAText] Both APIs failed for ${applicationNumber}:`,
          `ODP: ${odpErr?.message || odpErr}`,
          `DS-API: ${dsErr?.message || dsErr}`);
        return { totalRecords: 0, officeActions: [] };
      }
    }
  }

  /**
   * Get office action text by patent number.
   * Resolves patent → application, then fetches text.
   */
  async getOfficeActionTextByPatent(patentNumber: string): Promise<OATextApiResponse> {
    const cleanPatentNum = patentNumber.replace(/[^0-9A-Za-z]/g, '');

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
        console.warn(`[OAText] No application found for patent ${patentNumber}`);
        return { totalRecords: 0, officeActions: [] };
      }

      const appNumber = apps[0].applicationNumberText || apps[0].applicationNumber;
      if (!appNumber) {
        return { totalRecords: 0, officeActions: [] };
      }

      return this.getOfficeActionText(appNumber);
    } catch (err: any) {
      console.error(`[OAText] Failed to resolve patent ${patentNumber}:`, err?.message || err);
      return { totalRecords: 0, officeActions: [] };
    }
  }

  /**
   * Map raw API response to our typed structure
   */
  private mapResponse(raw: RawOATextResponse): OATextApiResponse {
    const records = raw.response?.docs || raw.results || raw.officeActions || raw.officeActionTexts || [];
    const total = raw.response?.numFound || raw.recordTotalQuantity || raw.count || records.length;
    return {
      totalRecords: total,
      officeActions: records.map((r: any) => this.mapTextRecord(r)),
    };
  }

  private mapTextRecord(raw: any): OATextRecord {
    // DS-API wraps values in arrays (Solr convention)
    const unwrap = (v: any) => Array.isArray(v) ? v[0] : v;

    return {
      applicationNumber: unwrap(raw.applicationNumber) || unwrap(raw.applicationNumberText) || unwrap(raw.patentApplicationNumber) || '',
      mailDate: unwrap(raw.mailDate) || unwrap(raw.mailRoomDate) || unwrap(raw.submissionDate) || unwrap(raw.officialDate) || '',
      documentCode: unwrap(raw.documentCode) || unwrap(raw.legacyDocumentCodeIdentifier) || unwrap(raw.documentCodeDescriptionText) || '',
      text: unwrap(raw.text) || unwrap(raw.bodyText) || unwrap(raw.extractedText) || unwrap(raw.officeActionText) || '',
      pageCount: raw.pageCount || raw.documentPages || undefined,
    };
  }
}

/**
 * Create an OA Text client using environment config
 */
export function createOATextClient(): OATextClient {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  if (!apiKey) {
    throw new Error('USPTO_ODP_API_KEY environment variable is required');
  }
  return new OATextClient({
    apiKey,
    rateLimit: parseInt(process.env.API_RATE_LIMIT || '60'),
    retryAttempts: parseInt(process.env.API_RETRY_ATTEMPTS || '3'),
    retryDelay: parseInt(process.env.API_RETRY_DELAY || '1000'),
  });
}
