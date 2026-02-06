/**
 * Patent Fetch Service
 *
 * Resolves patent data from multiple sources (portfolio, PatentsView cache,
 * parent-details cache) and fetches missing patents from the PatentsView API.
 *
 * This is the foundation service that enables non-portfolio patent access
 * throughout the system.
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeAffiliate } from '../utils/affiliate-normalizer.js';
import { getPrimarySector, getSuperSector, getSuperSectorDisplayName } from '../utils/sector-mapper.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DataSource = 'portfolio' | 'patentsview_cache' | 'parent_details_cache';

export interface ResolvedPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  abstract?: string | null;
  affiliate?: string;
  super_sector?: string;
  primary_sector?: string;
  cpc_codes?: string[];
  forward_citations?: number;
  remaining_years?: number;
  score?: number;
  in_portfolio: boolean;
  data_source: DataSource;
  [key: string]: unknown;
}

export interface PatentPreview {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  abstract?: string | null;
  affiliate: string;
  super_sector: string;
  primary_sector?: string;
  cpc_codes: string[];
  forward_citations: number;
  remaining_years: number;
  score: number;
  in_portfolio: boolean;
  data_source: DataSource;
  competitor_citations?: number;
  affiliate_citations?: number;
  neutral_citations?: number;
  competitor_count?: number;
  competitor_names?: string[];
}

export interface FetchResult {
  fetched: string[];
  alreadyCached: string[];
  failed: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache paths
// ─────────────────────────────────────────────────────────────────────────────

const PATENTSVIEW_CACHE_DIR = path.join(process.cwd(), 'cache/api/patentsview/patent');
const PARENT_DETAILS_CACHE_DIR = path.join(process.cwd(), 'cache/patent-families/parent-details');

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio access (lazy import to avoid circular dependency)
// ─────────────────────────────────────────────────────────────────────────────

// We need access to loadPatents() from patents.routes.ts. To avoid circular
// imports, we use a registration pattern: patents.routes.ts calls
// registerPortfolioLoader() at startup.

type PortfolioLoaderFn = () => any[];
let portfolioLoader: PortfolioLoaderFn | null = null;
let portfolioMapCache: Map<string, any> | null = null;
let portfolioMapCacheTime = 0;
const PORTFOLIO_MAP_TTL = 5 * 60 * 1000; // 5 minutes

export function registerPortfolioLoader(loader: PortfolioLoaderFn): void {
  portfolioLoader = loader;
  portfolioMapCache = null; // Invalidate on re-registration
}

function getPortfolioMap(): Map<string, any> {
  const now = Date.now();
  if (portfolioMapCache && (now - portfolioMapCacheTime) < PORTFOLIO_MAP_TTL) {
    return portfolioMapCache;
  }

  if (!portfolioLoader) {
    console.warn('[PatentFetch] No portfolio loader registered — portfolio patents unavailable');
    return new Map();
  }

  try {
    const patents = portfolioLoader();
    portfolioMapCache = new Map(patents.map(p => [p.patent_id, p]));
    portfolioMapCacheTime = now;
    return portfolioMapCache;
  } catch (e) {
    console.warn('[PatentFetch] Failed to load portfolio:', e);
    return new Map();
  }
}

export function invalidatePortfolioMapCache(): void {
  portfolioMapCache = null;
  portfolioMapCacheTime = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: calculate remaining years from grant date
// ─────────────────────────────────────────────────────────────────────────────

function calculateRemainingYears(patentDate: string): number {
  if (!patentDate) return 0;
  const grantDate = new Date(patentDate);
  const expirationDate = new Date(grantDate);
  expirationDate.setFullYear(expirationDate.getFullYear() + 20);
  const now = new Date();
  const diffMs = expirationDate.getTime() - now.getTime();
  const years = diffMs / (365.25 * 24 * 60 * 60 * 1000);
  return Math.round(Math.max(0, years) * 10) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core resolution functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load patent data from PatentsView API cache file
 */
function loadFromPatentsViewCache(patentId: string): ResolvedPatent | null {
  const cachePath = path.join(PATENTSVIEW_CACHE_DIR, `${patentId}.json`);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));

    // Handle both raw API response and wrapped formats
    // Some cache files store { patents: [patent] }, others store the patent directly
    const data = raw.patents ? raw.patents[0] : raw;

    const assignee = data.assignees?.[0]?.assignee_organization || data.assignee || 'Unknown';
    const cpcData = data.cpc_current || data.cpc || [];
    const cpcCodes = cpcData
      .map((c: any) => c.cpc_subgroup_id || c.cpc_group_id || '')
      .filter(Boolean);

    const primarySector = getPrimarySector(cpcCodes) || 'general';
    const superSectorKey = getSuperSector(primarySector) || 'Unknown';
    const superSector = getSuperSectorDisplayName(superSectorKey);

    return {
      patent_id: patentId,
      patent_title: data.patent_title || '',
      patent_date: data.patent_date || '',
      assignee,
      abstract: data.patent_abstract || null,
      affiliate: normalizeAffiliate(assignee),
      super_sector: superSector,
      primary_sector: primarySector,
      cpc_codes: cpcCodes,
      forward_citations: data.patent_num_times_cited_by_us_patents || 0,
      remaining_years: calculateRemainingYears(data.patent_date || ''),
      score: 0,
      in_portfolio: false,
      data_source: 'patentsview_cache',
    };
  } catch (e) {
    console.warn(`[PatentFetch] Failed to read PatentsView cache for ${patentId}:`, e);
    return null;
  }
}

/**
 * Load patent data from parent-details cache file (minimal data)
 */
function loadFromParentDetailsCache(patentId: string): ResolvedPatent | null {
  const cachePath = path.join(PARENT_DETAILS_CACHE_DIR, `${patentId}.json`);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const assignee = data.assignee || 'Unknown';

    return {
      patent_id: patentId,
      patent_title: data.patent_title || '',
      patent_date: data.patent_date || '',
      assignee,
      abstract: data.patent_abstract || null,
      affiliate: normalizeAffiliate(assignee),
      super_sector: 'Unknown',
      primary_sector: undefined,
      cpc_codes: [],
      forward_citations: 0,
      remaining_years: calculateRemainingYears(data.patent_date || ''),
      score: 0,
      in_portfolio: false,
      data_source: 'parent_details_cache',
    };
  } catch (e) {
    console.warn(`[PatentFetch] Failed to read parent-details cache for ${patentId}:`, e);
    return null;
  }
}

/**
 * Resolve a single patent from any available source.
 *
 * Priority: portfolio → PatentsView cache → parent-details cache
 */
export function resolvePatent(patentId: string): ResolvedPatent | null {
  // 1. Check portfolio
  const portfolioMap = getPortfolioMap();
  const portfolioPatent = portfolioMap.get(patentId);
  if (portfolioPatent) {
    return {
      ...portfolioPatent,
      in_portfolio: true,
      data_source: 'portfolio' as DataSource,
    };
  }

  // 2. Check PatentsView API cache
  const pvCached = loadFromPatentsViewCache(patentId);
  if (pvCached) return pvCached;

  // 3. Check parent-details cache
  const pdCached = loadFromParentDetailsCache(patentId);
  if (pdCached) return pdCached;

  return null;
}

/**
 * Resolve multiple patents (batch version).
 * Loads portfolio once, then resolves each ID.
 */
export function resolvePatents(patentIds: string[]): Map<string, ResolvedPatent> {
  const result = new Map<string, ResolvedPatent>();
  const portfolioMap = getPortfolioMap();

  for (const id of patentIds) {
    // Portfolio
    const portfolioPatent = portfolioMap.get(id);
    if (portfolioPatent) {
      result.set(id, {
        ...portfolioPatent,
        in_portfolio: true,
        data_source: 'portfolio' as DataSource,
      });
      continue;
    }

    // PatentsView cache
    const pvCached = loadFromPatentsViewCache(id);
    if (pvCached) {
      result.set(id, pvCached);
      continue;
    }

    // Parent-details cache
    const pdCached = loadFromParentDetailsCache(id);
    if (pdCached) {
      result.set(id, pdCached);
    }
  }

  return result;
}

/**
 * Resolve a patent into the lighter PatentPreview shape.
 */
export function resolvePatentPreview(patentId: string): PatentPreview | null {
  const resolved = resolvePatent(patentId);
  if (!resolved) return null;

  return {
    patent_id: resolved.patent_id,
    patent_title: resolved.patent_title,
    patent_date: resolved.patent_date,
    assignee: resolved.assignee,
    abstract: resolved.abstract,
    affiliate: resolved.affiliate || 'Unknown',
    super_sector: resolved.super_sector || 'Unknown',
    primary_sector: resolved.primary_sector,
    cpc_codes: resolved.cpc_codes || [],
    forward_citations: (resolved.forward_citations as number) || 0,
    remaining_years: (resolved.remaining_years as number) || 0,
    score: (resolved.score as number) || 0,
    in_portfolio: resolved.in_portfolio,
    data_source: resolved.data_source,
    competitor_citations: resolved.competitor_citations as number | undefined,
    affiliate_citations: resolved.affiliate_citations as number | undefined,
    neutral_citations: resolved.neutral_citations as number | undefined,
    competitor_count: resolved.competitor_count as number | undefined,
    competitor_names: resolved.competitor_names as string[] | undefined,
  };
}

/**
 * Quick check: does patent data exist in any source?
 */
export function hasPatentData(patentId: string): boolean {
  // Portfolio
  const portfolioMap = getPortfolioMap();
  if (portfolioMap.has(patentId)) return true;

  // PatentsView cache
  if (fs.existsSync(path.join(PATENTSVIEW_CACHE_DIR, `${patentId}.json`))) return true;

  // Parent-details cache
  if (fs.existsSync(path.join(PARENT_DETAILS_CACHE_DIR, `${patentId}.json`))) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch and cache from PatentsView API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch patents from PatentsView API, cache them, and optionally index in ES.
 *
 * For batches <= 100: 1 API call (~2 seconds)
 * For larger batches: multiple calls with rate limiting
 */
export async function fetchAndCachePatents(patentIds: string[]): Promise<FetchResult> {
  const result: FetchResult = {
    fetched: [],
    alreadyCached: [],
    failed: [],
  };

  // Filter out IDs that already have cached data
  const toFetch: string[] = [];
  for (const id of patentIds) {
    if (fs.existsSync(path.join(PATENTSVIEW_CACHE_DIR, `${id}.json`))) {
      result.alreadyCached.push(id);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) {
    console.log('[PatentFetch] All patents already cached');
    return result;
  }

  console.log(`[PatentFetch] Fetching ${toFetch.length} patents from PatentsView API...`);

  // Dynamically import PatentsView client (avoid loading at module init)
  const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
  const client = createPatentsViewClient();

  // Fetch in batches of 100 (PatentsView limit)
  const batchSize = 100;
  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);

    try {
      const patents = await client.getPatentsBatch(batch, [
        'patent_id',
        'patent_title',
        'patent_date',
        'patent_abstract',
        'patent_type',
        'withdrawn',
        'patent_num_times_cited_by_us_patents',
        'patent_num_us_patents_cited',
        'patent_num_total_documents_cited',
        'assignees',
        'inventors',
        'cpc_current',
        'application',
      ]);

      // Cache each patent
      const fetchedIds = new Set<string>();
      for (const patent of patents) {
        const pid = patent.patent_id;
        fetchedIds.add(pid);

        // Ensure cache directory exists
        if (!fs.existsSync(PATENTSVIEW_CACHE_DIR)) {
          fs.mkdirSync(PATENTSVIEW_CACHE_DIR, { recursive: true });
        }

        // Write cache file
        const cachePath = path.join(PATENTSVIEW_CACHE_DIR, `${pid}.json`);
        fs.writeFileSync(cachePath, JSON.stringify(patent, null, 2));
        result.fetched.push(pid);
      }

      // Track patents not returned by API (invalid IDs, etc.)
      for (const id of batch) {
        if (!fetchedIds.has(id)) {
          result.failed.push(id);
        }
      }
    } catch (e) {
      console.error(`[PatentFetch] API batch fetch failed:`, e);
      result.failed.push(...batch);
    }

    // Rate limiting between batches
    if (i + batchSize < toFetch.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Index into Elasticsearch (best-effort, don't fail if ES is down)
  if (result.fetched.length > 0) {
    try {
      await indexFetchedPatents(result.fetched);
    } catch (e) {
      console.warn('[PatentFetch] ES indexing failed (non-fatal):', e);
    }
  }

  console.log(`[PatentFetch] Done: ${result.fetched.length} fetched, ${result.alreadyCached.length} already cached, ${result.failed.length} failed`);
  return result;
}

/**
 * Index recently fetched patents into Elasticsearch
 */
async function indexFetchedPatents(patentIds: string[]): Promise<void> {
  const { createElasticsearchService } = await import('../../../services/elasticsearch-service.js');
  const es = createElasticsearchService();

  const docs: any[] = [];
  for (const id of patentIds) {
    const resolved = loadFromPatentsViewCache(id);
    if (!resolved) continue;

    docs.push({
      patent_id: resolved.patent_id,
      title: resolved.patent_title,
      abstract: resolved.abstract || undefined,
      grant_date: resolved.patent_date || undefined,
      assignee: resolved.assignee,
      assignee_normalized: resolved.affiliate || undefined,
      cpc_codes: resolved.cpc_codes || [],
      cpc_classes: (resolved.cpc_codes || []).map(c => c.substring(0, 4)),
      primary_sector: resolved.primary_sector || undefined,
      super_sector: resolved.super_sector || undefined,
      remaining_years: resolved.remaining_years || 0,
      forward_citations: resolved.forward_citations || 0,
    });
  }

  if (docs.length > 0) {
    const { indexed, errors } = await es.bulkIndex(docs);
    console.log(`[PatentFetch] ES indexed ${indexed} patents (${errors} errors)`);
  }
}
