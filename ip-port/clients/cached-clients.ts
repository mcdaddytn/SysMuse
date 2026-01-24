/**
 * Cached API Client Wrappers
 *
 * Automatically caches API responses to file system with database metadata.
 * Use these instead of the raw clients when you want caching.
 */

import {
  PatentsViewClient,
  createPatentsViewClient,
  Patent,
  PatentResponse,
  PatentQueryOptions,
} from './patentsview-client.js';

import {
  FileWrapperClient,
  createFileWrapperClient,
  PatentFileWrapperRecord,
  FileHistoryDocument,
  DocumentsResponse,
} from './odp-file-wrapper-client.js';

import {
  PTABClient,
  createPTABClient,
  PTABTrial,
  PTABTrialSearchResponse,
  PTABDocumentsResponse,
} from './odp-ptab-client.js';

import {
  isApiCached,
  getApiCache,
  setApiCache,
  getCachePath,
} from '../services/cache-service.js';

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// CACHED PATENTSVIEW CLIENT
// =============================================================================

export class CachedPatentsViewClient {
  private client: PatentsViewClient;
  private useCache: boolean;

  constructor(client?: PatentsViewClient, useCache: boolean = true) {
    this.client = client || createPatentsViewClient();
    this.useCache = useCache;
  }

  /**
   * Get a single patent by ID (cached)
   */
  async getPatent(patentId: string, fields?: string[]): Promise<Patent | null> {
    const cacheKey = patentId;
    const requestType = fields ? `patent-${fields.sort().join('-').slice(0, 50)}` : 'patent';

    if (this.useCache) {
      // Check cache
      const cached = await getApiCache<Patent>('patentsview', requestType, cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Fetch from API
    const result = await this.client.getPatent(patentId, fields);

    if (result && this.useCache) {
      await setApiCache({
        endpoint: 'patentsview',
        requestType,
        requestKey: cacheKey,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get patent citations (cached)
   */
  async getPatentCitations(patentId: string): Promise<{
    backward: any[];
    forward: any[];
    counts: {
      usPatentsCited: number;
      usApplicationsCited: number;
      foreignDocumentsCited: number;
      totalCited: number;
      timesCitedByUSPatents: number;
    };
  }> {
    const requestType = 'citations';

    if (this.useCache) {
      const cached = await getApiCache('patentsview', requestType, patentId);
      if (cached) {
        return cached as any;
      }
    }

    const result = await this.client.getPatentCitations(patentId);

    if (this.useCache) {
      await setApiCache({
        endpoint: 'patentsview',
        requestType,
        requestKey: patentId,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get forward citations - patents that cite this patent (cached)
   * This is the expensive query used in overnight runs
   */
  async getForwardCitations(
    patentId: string,
    maxResults: number = 500
  ): Promise<{
    total_hits: number;
    citing_patent_ids: string[];
  }> {
    const requestType = 'forward-citations';

    if (this.useCache) {
      const cached = await getApiCache<{ total_hits: number; citing_patent_ids: string[] }>(
        'patentsview', requestType, patentId
      );
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getForwardCitations(patentId, maxResults);

    if (this.useCache) {
      await setApiCache({
        endpoint: 'patentsview',
        requestType,
        requestKey: patentId,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get details of citing patents for a given patent (cached)
   * Combines forward citations lookup + patent details
   */
  async getCitingPatentDetails(
    patentId: string,
    fields?: string[]
  ): Promise<{
    total_hits: number;
    citing_patents: Patent[];
  }> {
    const requestType = 'citing-patent-details';

    if (this.useCache) {
      const cached = await getApiCache<{ total_hits: number; citing_patents: Patent[] }>(
        'patentsview', requestType, patentId
      );
      if (cached) {
        return cached;
      }
    }

    // First get forward citations
    const forwardCitations = await this.getForwardCitations(patentId);

    // Then get details of citing patents
    const citingPatents = forwardCitations.citing_patent_ids.length > 0
      ? await this.client.getPatentsBatch(
          forwardCitations.citing_patent_ids,
          fields || ['patent_id', 'patent_title', 'patent_date', 'assignees']
        )
      : [];

    const result = {
      total_hits: forwardCitations.total_hits,
      citing_patents: citingPatents,
    };

    if (this.useCache) {
      await setApiCache({
        endpoint: 'patentsview',
        requestType,
        requestKey: patentId,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Search patents (NOT cached by default - queries vary too much)
   * Use getPatent() for individual patents after search
   */
  async searchPatents(queryOptions: PatentQueryOptions): Promise<PatentResponse> {
    return this.client.searchPatents(queryOptions);
  }

  /**
   * Paginated search (NOT cached - use for discovery, cache individual results)
   */
  searchPaginated(
    queryOptions: PatentQueryOptions,
    pageSize?: number
  ): AsyncGenerator<Patent[], void, unknown> {
    return this.client.searchPaginated(queryOptions, pageSize);
  }

  /**
   * Search by assignee (NOT cached)
   */
  async searchByAssignee(
    assigneeOrg: string,
    additionalQuery?: any,
    fields?: string[]
  ): Promise<PatentResponse> {
    return this.client.searchByAssignee(assigneeOrg, additionalQuery, fields);
  }

  /**
   * Search by date range (NOT cached)
   */
  async searchByDateRange(
    startDate: string,
    endDate: string,
    additionalQuery?: any,
    fields?: string[]
  ): Promise<PatentResponse> {
    return this.client.searchByDateRange(startDate, endDate, additionalQuery, fields);
  }

  /** Get underlying client for advanced usage */
  getRawClient(): PatentsViewClient {
    return this.client;
  }

  /**
   * Get full portfolio of patents with caching (for overnight runs)
   *
   * Caches paginated results so subsequent runs are instant.
   * On new machine: copy cache folder, run sync, then this loads from cache.
   *
   * @param queryName - Unique name for this query (e.g., 'broadcom-portfolio')
   * @param assignees - List of assignee organizations to search
   * @param options - Additional options
   */
  async getPortfolioPatents(
    queryName: string,
    assignees: string[],
    options?: {
      fields?: string[];
      pageSize?: number;
      rateLimitMs?: number;
      onProgress?: (fetched: number, fromCache: boolean, latestDate?: string) => void;
      forceRefresh?: boolean;
    }
  ): Promise<{
    patents: Patent[];
    fromCache: boolean;
    pagesFromCache: number;
    pagesFromApi: number;
  }> {
    const cacheDir = getCachePath('api', 'patentsview', 'portfolio-query', queryName);
    const manifestPath = path.join(cacheDir, '_manifest.json');

    // Default options
    const fields = options?.fields || [
      'patent_id',
      'patent_title',
      'patent_date',
      'assignees.assignee_organization',
      'patent_num_times_cited_by_us_patents',
    ];
    const pageSize = options?.pageSize || 500;
    const rateLimitMs = options?.rateLimitMs || 1400;

    // Check for existing manifest
    let manifest: {
      queryName: string;
      assigneeCount: number;
      complete: boolean;
      totalPatents: number;
      pages: number;
      lastUpdated: string;
    } | null = null;

    if (fs.existsSync(manifestPath) && !options?.forceRefresh) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    }

    // If complete, load all from cache
    if (manifest?.complete && !options?.forceRefresh) {
      const patents: Patent[] = [];
      for (let i = 1; i <= manifest.pages; i++) {
        const pagePath = path.join(cacheDir, `page-${String(i).padStart(4, '0')}.json`);
        if (fs.existsSync(pagePath)) {
          const pageData = JSON.parse(fs.readFileSync(pagePath, 'utf-8'));
          patents.push(...pageData.patents);
        }
      }
      return {
        patents,
        fromCache: true,
        pagesFromCache: manifest.pages,
        pagesFromApi: 0,
      };
    }

    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Find which pages we already have
    let startPage = 1;
    let existingPatents: Patent[] = [];
    let lastPatentId: string | undefined;

    if (manifest && !options?.forceRefresh) {
      // Load existing pages
      for (let i = 1; i <= manifest.pages; i++) {
        const pagePath = path.join(cacheDir, `page-${String(i).padStart(4, '0')}.json`);
        if (fs.existsSync(pagePath)) {
          const pageData = JSON.parse(fs.readFileSync(pagePath, 'utf-8'));
          existingPatents.push(...pageData.patents);
          lastPatentId = pageData.lastPatentId;
          startPage = i + 1;
        } else {
          break; // Stop at first missing page
        }
      }
    }

    // Build query
    const query = {
      _or: assignees.map(assignee => ({
        'assignees.assignee_organization': assignee
      }))
    };

    const allPatents: Patent[] = [...existingPatents];
    let pageCount = startPage - 1;
    let pagesFromCache = pageCount;
    let pagesFromApi = 0;

    options?.onProgress?.(allPatents.length, pagesFromCache > 0, undefined);

    // Fetch remaining pages
    try {
      for await (const page of this.client.searchPaginated(
        {
          query,
          fields,
          sort: [{ patent_date: 'desc' }],
          options: {
            after: lastPatentId,
          },
        },
        pageSize
      )) {
        pageCount++;
        pagesFromApi++;

        // Cache this page
        const pagePath = path.join(cacheDir, `page-${String(pageCount).padStart(4, '0')}.json`);
        const pageData = {
          page: pageCount,
          patents: page,
          lastPatentId: page[page.length - 1]?.patent_id,
          fetchedAt: new Date().toISOString(),
        };
        fs.writeFileSync(pagePath, JSON.stringify(pageData, null, 2));

        allPatents.push(...page);

        // Update manifest
        const newManifest = {
          queryName,
          assigneeCount: assignees.length,
          complete: false,
          totalPatents: allPatents.length,
          pages: pageCount,
          lastUpdated: new Date().toISOString(),
        };
        fs.writeFileSync(manifestPath, JSON.stringify(newManifest, null, 2));

        options?.onProgress?.(allPatents.length, false, page[page.length - 1]?.patent_date);

        // Rate limit between API calls
        await new Promise(r => setTimeout(r, rateLimitMs));
      }

      // Mark as complete
      const finalManifest = {
        queryName,
        assigneeCount: assignees.length,
        complete: true,
        totalPatents: allPatents.length,
        pages: pageCount,
        lastUpdated: new Date().toISOString(),
      };
      fs.writeFileSync(manifestPath, JSON.stringify(finalManifest, null, 2));

    } catch (err: any) {
      // Save progress even on error
      console.error(`\nError during portfolio fetch: ${err.message}`);
      console.log(`Progress saved. ${allPatents.length} patents cached in ${pageCount} pages.`);
    }

    return {
      patents: allPatents,
      fromCache: pagesFromCache > 0 && pagesFromApi === 0,
      pagesFromCache,
      pagesFromApi,
    };
  }
}

// =============================================================================
// CACHED FILE WRAPPER CLIENT
// =============================================================================

export class CachedFileWrapperClient {
  private client: FileWrapperClient;
  private useCache: boolean;

  constructor(client?: FileWrapperClient, useCache: boolean = true) {
    this.client = client || createFileWrapperClient();
    this.useCache = useCache;
  }

  /**
   * Get application by application number (cached)
   */
  async getApplication(applicationNumber: string): Promise<PatentFileWrapperRecord | null> {
    const requestType = 'application';

    if (this.useCache) {
      const cached = await getApiCache<PatentFileWrapperRecord>('file-wrapper', requestType, applicationNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getApplication(applicationNumber);

    if (result && this.useCache) {
      await setApiCache({
        endpoint: 'file-wrapper',
        requestType,
        requestKey: applicationNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get application by patent number (cached)
   */
  async getApplicationByPatentNumber(patentNumber: string): Promise<PatentFileWrapperRecord | null> {
    const requestType = 'application-by-patent';

    if (this.useCache) {
      const cached = await getApiCache<PatentFileWrapperRecord>('file-wrapper', requestType, patentNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getApplicationByPatentNumber(patentNumber);

    if (result && this.useCache) {
      await setApiCache({
        endpoint: 'file-wrapper',
        requestType,
        requestKey: patentNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get documents for an application (cached)
   */
  async getDocuments(applicationNumber: string): Promise<DocumentsResponse> {
    const requestType = 'documents';

    if (this.useCache) {
      const cached = await getApiCache<DocumentsResponse>('file-wrapper', requestType, applicationNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getDocuments(applicationNumber);

    if (this.useCache) {
      await setApiCache({
        endpoint: 'file-wrapper',
        requestType,
        requestKey: applicationNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get office actions for an application (cached)
   */
  async getOfficeActions(applicationNumber: string): Promise<FileHistoryDocument[]> {
    const requestType = 'office-actions';

    if (this.useCache) {
      const cached = await getApiCache<FileHistoryDocument[]>('file-wrapper', requestType, applicationNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getOfficeActions(applicationNumber);

    if (this.useCache) {
      await setApiCache({
        endpoint: 'file-wrapper',
        requestType,
        requestKey: applicationNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get prosecution timeline (cached)
   */
  async getProsecutionTimeline(applicationNumber: string): Promise<any> {
    const requestType = 'timeline';

    if (this.useCache) {
      const cached = await getApiCache('file-wrapper', requestType, applicationNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getProsecutionTimeline(applicationNumber);

    if (this.useCache) {
      await setApiCache({
        endpoint: 'file-wrapper',
        requestType,
        requestKey: applicationNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /** Get underlying client for advanced usage */
  getRawClient(): FileWrapperClient {
    return this.client;
  }
}

// =============================================================================
// CACHED PTAB CLIENT
// =============================================================================

export class CachedPTABClient {
  private client: PTABClient;
  private useCache: boolean;

  constructor(client?: PTABClient, useCache: boolean = true) {
    this.client = client || createPTABClient();
    this.useCache = useCache;
  }

  /**
   * Get trial by trial number (cached)
   */
  async getTrial(trialNumber: string): Promise<PTABTrial | null> {
    const requestType = 'trial';

    if (this.useCache) {
      const cached = await getApiCache<PTABTrial>('ptab', requestType, trialNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getTrial(trialNumber);

    if (result && this.useCache) {
      await setApiCache({
        endpoint: 'ptab',
        requestType,
        requestKey: trialNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Search IPRs by patent number (cached per patent)
   */
  async searchIPRsByPatent(patentNumber: string): Promise<PTABTrialSearchResponse> {
    const requestType = 'ipr-by-patent';

    if (this.useCache) {
      const cached = await getApiCache<PTABTrialSearchResponse>('ptab', requestType, patentNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.searchIPRsByPatent(patentNumber);

    if (this.useCache) {
      await setApiCache({
        endpoint: 'ptab',
        requestType,
        requestKey: patentNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Get documents for a trial (cached)
   */
  async getTrialDocuments(trialNumber: string): Promise<PTABDocumentsResponse> {
    const requestType = 'trial-documents';

    if (this.useCache) {
      const cached = await getApiCache<PTABDocumentsResponse>('ptab', requestType, trialNumber);
      if (cached) {
        return cached;
      }
    }

    const result = await this.client.getTrialDocuments(trialNumber);

    if (this.useCache) {
      await setApiCache({
        endpoint: 'ptab',
        requestType,
        requestKey: trialNumber,
        data: result,
        statusCode: 200,
      });
    }

    return result;
  }

  /**
   * Search trials (NOT cached - queries vary)
   */
  async searchTrials(query: any): Promise<PTABTrialSearchResponse> {
    return this.client.searchTrials(query);
  }

  /**
   * Get instituted IPRs in date range (NOT cached)
   */
  async getInstitutedIPRs(startDate: string, endDate: string): Promise<PTABTrialSearchResponse> {
    return this.client.getInstitutedIPRs(startDate, endDate);
  }

  /**
   * Search by petitioner (NOT cached)
   */
  async searchByPetitioner(petitionerName: string): Promise<PTABTrialSearchResponse> {
    return this.client.searchByPetitioner(petitionerName);
  }

  /** Get underlying client for advanced usage */
  getRawClient(): PTABClient {
    return this.client;
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create a cached PatentsView client
 */
export function createCachedPatentsViewClient(useCache: boolean = true): CachedPatentsViewClient {
  return new CachedPatentsViewClient(undefined, useCache);
}

/**
 * Create a cached File Wrapper client
 */
export function createCachedFileWrapperClient(useCache: boolean = true): CachedFileWrapperClient {
  return new CachedFileWrapperClient(undefined, useCache);
}

/**
 * Create a cached PTAB client
 */
export function createCachedPTABClient(useCache: boolean = true): CachedPTABClient {
  return new CachedPTABClient(undefined, useCache);
}

// =============================================================================
// CONVENIENCE: Batch operations with caching
// =============================================================================

/**
 * Fetch multiple patents with caching
 * Returns both cached and newly fetched patents
 */
export async function fetchPatentsBatch(
  patentIds: string[],
  fields?: string[],
  options?: {
    concurrency?: number;
    onProgress?: (completed: number, total: number, cached: number) => void;
  }
): Promise<{
  patents: Map<string, Patent>;
  cached: number;
  fetched: number;
  failed: string[];
}> {
  const client = createCachedPatentsViewClient();
  const patents = new Map<string, Patent>();
  const failed: string[] = [];
  let cached = 0;
  let fetched = 0;

  const concurrency = options?.concurrency || 5;
  const chunks: string[][] = [];

  for (let i = 0; i < patentIds.length; i += concurrency) {
    chunks.push(patentIds.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (id) => {
        try {
          // Check if cached first (without fetching)
          const wasCached = await isApiCached('patentsview', 'patent', id);
          const patent = await client.getPatent(id, fields);

          if (patent) {
            patents.set(id, patent);
            if (wasCached) cached++;
            else fetched++;
          } else {
            failed.push(id);
          }
        } catch (err) {
          failed.push(id);
        }
      })
    );

    if (options?.onProgress) {
      options.onProgress(patents.size + failed.length, patentIds.length, cached);
    }
  }

  return { patents, cached, fetched, failed };
}
