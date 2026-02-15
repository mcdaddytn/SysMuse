/**
 * Patent Family Exploration Service
 *
 * BFS-based patent family traversal from a seed patent.
 * Uses cached citation data with optional live API fallback.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeAffiliate } from '../utils/affiliate-normalizer.js';
import { getCompetitorMatcher, type CompetitorMatch } from '../../../services/competitor-config.js';
import { fetchAndCachePatents, hasPatentData } from './patent-fetch-service.js';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  primary_sector?: string;
  super_sector?: string;
  cpc_codes?: string[];
}

interface ExplorationConfig {
  seedPatentId: string;
  maxAncestorDepth: number;
  maxDescendantDepth: number;
  includeSiblings: boolean;
  includeCousins: boolean;
  limitToSectors: string[];
  limitToCpcPrefixes: string[];
  limitToFocusAreas: string[];
  requireInPortfolio: boolean;
}

interface MemberRecord {
  patentId: string;
  relationToSeed: string;
  generationDepth: number;
  inPortfolio: boolean;
}

export interface PatentDetail {
  patent_id: string;
  patent_title?: string;
  assignee?: string;
  patent_date?: string;
  primary_sector?: string;
  super_sector?: string;
  forward_citations?: number;
  score?: number;
  cpc_codes?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Seed Exploration Types
// ─────────────────────────────────────────────────────────────────────────────

export type MergeStrategy = 'UNION' | 'INTERSECTION';

export interface MultiSeedConfig {
  seedPatentIds: string[];
  maxAncestorDepth: number;
  maxDescendantDepth: number;
  includeSiblings: boolean;
  includeCousins: boolean;
  limitToSectors: string[];
  limitToCpcPrefixes: string[];
  limitToCompetitors: string[];
  limitToAffiliates: string[];
  requireInPortfolio: boolean;
  mergeStrategy: MergeStrategy;
  minFilingYear?: number;
}

export interface PreviewResult {
  estimatedMembers: {
    total: number;
    parents: number;
    children: number;
    siblings: number;
    seeds: number;
  };
  seedOverlap: {
    sharedCitationsCount: number;
    commonSectors: string[];
  };
  cachedDataAvailable: number;
  estimatedApiCalls: number;
  seedDetails: Array<{
    patentId: string;
    title?: string;
    inPortfolio: boolean;
    hasCachedCitations: boolean;
  }>;
}

export type DataRetrievalStatus =
  | 'portfolio'       // Data from portfolio (complete)
  | 'cached'          // Data retrieved and cached
  | 'not_attempted'   // Not yet attempted to retrieve
  | 'not_found'       // Attempted but not found (too recent, invalid ID)
  | 'partial';        // Some data available but incomplete

export interface EnrichedFamilyMember {
  patentId: string;
  relationToSeed: string;
  generationDepth: number;
  inPortfolio: boolean;
  patentTitle: string;
  assignee: string;
  patentDate: string;
  primarySector: string;
  superSector: string;
  forwardCitations?: number;
  score?: number;
  affiliate: string;
  competitorMatch?: CompetitorMatch | null;
  seedPatentIds: string[];  // Which seeds this was discovered from
  remainingYears?: number;
  dataStatus: DataRetrievalStatus;  // Status of patent data retrieval
  dataStatusReason?: string;        // Explanation (e.g., "Too recent for PatentsView")
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio cache (same pattern as patents.routes.ts)
// ─────────────────────────────────────────────────────────────────────────────

let portfolioCache: Map<string, PortfolioPatent> | null = null;
let portfolioCacheTime = 0;
const PORTFOLIO_TTL = 5 * 60 * 1000;

export function loadPortfolioMap(): Map<string, PortfolioPatent> {
  const now = Date.now();
  if (portfolioCache && (now - portfolioCacheTime) < PORTFOLIO_TTL) {
    return portfolioCache;
  }

  const outputDir = './output';
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    portfolioCache = new Map();
    portfolioCacheTime = now;
    return portfolioCache;
  }

  const filePath = path.join(outputDir, files[0]);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  portfolioCache = new Map();
  for (const p of data.candidates) {
    portfolioCache.set(p.patent_id, p);
  }

  portfolioCacheTime = now;
  console.log(`[PatentFamily] Loaded portfolio map: ${portfolioCache.size} patents`);
  return portfolioCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache loading functions
// ─────────────────────────────────────────────────────────────────────────────

export function loadCachedForwardCitations(patentId: string): string[] | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/api/patentsview/forward-citations', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.citing_patent_ids || [];
    }
  } catch { /* skip */ }
  return null;
}

export function loadCachedBackwardCitations(patentId: string): string[] | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/patent-families/parents', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.parent_patent_ids || [];
    }
  } catch { /* skip */ }
  return null;
}

export function loadPatentDetail(patentId: string, portfolioMap: Map<string, PortfolioPatent>): PatentDetail | null {
  // Portfolio first
  const portfolioPatent = portfolioMap.get(patentId);
  if (portfolioPatent) {
    return {
      patent_id: portfolioPatent.patent_id,
      patent_title: portfolioPatent.patent_title,
      assignee: portfolioPatent.assignee,
      patent_date: portfolioPatent.patent_date,
      primary_sector: portfolioPatent.primary_sector,
      super_sector: portfolioPatent.super_sector,
      forward_citations: portfolioPatent.forward_citations,
      score: portfolioPatent.score,
      cpc_codes: portfolioPatent.cpc_codes,
    };
  }

  // Fallback to parent-details cache
  try {
    const detailPath = path.join(process.cwd(), 'cache/patent-families/parent-details', `${patentId}.json`);
    if (fs.existsSync(detailPath)) {
      const data = JSON.parse(fs.readFileSync(detailPath, 'utf-8'));
      return {
        patent_id: patentId,
        patent_title: data.patent_title,
        assignee: data.assignee,
        patent_date: data.patent_date,
        cpc_codes: data.cpc_codes,
      };
    }
  } catch { /* skip */ }

  // Fallback to patentsview patent cache
  try {
    const pvPath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(pvPath)) {
      const data = JSON.parse(fs.readFileSync(pvPath, 'utf-8'));
      const cpcCodes = data.cpc_current?.map((c: any) => c.cpc_group_id || c.cpc_subgroup_id).filter(Boolean) || [];
      return {
        patent_id: patentId,
        patent_title: data.patent_title,
        assignee: data.assignees?.[0]?.assignee_organization || data.assignees?.[0]?.assignee_individual || '',
        patent_date: data.patent_date,
        cpc_codes: cpcCodes,
        forward_citations: data.patent_num_times_cited_by_us_patents,
      };
    }
  } catch { /* skip */ }

  return null;
}

/**
 * Determine the data retrieval status for a patent
 */
function getPatentDataStatus(
  patentId: string,
  portfolioMap: Map<string, PortfolioPatent>,
  detail: PatentDetail | null
): { status: DataRetrievalStatus; reason?: string } {
  // In portfolio = complete data
  if (portfolioMap.has(patentId)) {
    return { status: 'portfolio' };
  }

  // Check if we have cached data
  const pvCachePath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
  const parentDetailsCachePath = path.join(process.cwd(), 'cache/patent-families/parent-details', `${patentId}.json`);

  if (detail && detail.patent_title) {
    // We have data - determine source
    if (fs.existsSync(pvCachePath)) {
      return { status: 'cached' };
    }
    if (fs.existsSync(parentDetailsCachePath)) {
      return { status: 'cached' };
    }
    return { status: 'cached' };
  }

  // No data - check if we attempted to fetch
  // Check if patent is in the "failed" list (very recent patents)
  const patentNum = parseInt(patentId, 10);
  if (patentNum >= 12000000) {
    // Patents in 12M+ range are from 2024+ and may not be in PatentsView yet
    return { status: 'not_found', reason: 'Too recent for PatentsView database' };
  }

  // Check if PatentsView cache exists but is empty/failed
  if (fs.existsSync(pvCachePath)) {
    return { status: 'partial', reason: 'Cached but incomplete data' };
  }

  return { status: 'not_attempted' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live API fallback (lazy import to avoid startup failures if no key)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchForwardCitationsLive(patentId: string): Promise<string[] | null> {
  try {
    const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
    const client = createPatentsViewClient();
    const result = await client.getForwardCitations(patentId);

    // Cache the result for future use
    const cacheDir = path.join(process.cwd(), 'cache/api/patentsview/forward-citations');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, `${patentId}.json`),
      JSON.stringify(result, null, 2)
    );

    return result.citing_patent_ids;
  } catch (err) {
    console.warn(`[PatentFamily] Live API fetch failed for forward citations of ${patentId}:`, err);
    return null;
  }
}

async function fetchBackwardCitationsLive(patentId: string): Promise<string[] | null> {
  try {
    const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
    const client = createPatentsViewClient();

    // Get backward citations via the patent's us_patent_citations
    // Note: us_application_citations is not supported in search endpoint
    const result = await client.searchPatents({
      query: { patent_id: patentId },
      fields: ['patent_id', 'us_patent_citations'],
    });

    if (result.patents.length === 0) {
      // Patent not found - cache empty result
      const cacheDir = path.join(process.cwd(), 'cache/patent-families/parents');
      if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(
        path.join(cacheDir, `${patentId}.json`),
        JSON.stringify({
          patent_id: patentId,
          parent_patent_ids: [],
          parent_count: 0,
          fetched_at: new Date().toISOString(),
          note: 'Patent not found in PatentsView',
        }, null, 2)
      );
      return [];
    }

    const patent = result.patents[0];

    // Collect cited patents
    const citedPatentIds = (patent.us_patent_citations || [])
      .map((c: any) => c.cited_patent_id || c.cited_patent_number)
      .filter(Boolean) as string[];

    // Cache the result
    const cacheDir = path.join(process.cwd(), 'cache/patent-families/parents');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, `${patentId}.json`),
      JSON.stringify({
        patent_id: patentId,
        parent_patent_ids: citedPatentIds,
        parent_count: citedPatentIds.length,
        fetched_at: new Date().toISOString(),
      }, null, 2)
    );

    return citedPatentIds;
  } catch (err: any) {
    // Log at debug level for expected errors (patent not in database, API limits)
    const isExpected = err?.statusCode === 400 || err?.statusCode === 404;
    if (isExpected) {
      console.log(`[PatentFamily] No backward citations available for ${patentId} (${err?.statusCode || 'unknown'})`);
    } else {
      console.warn(`[PatentFamily] Live API fetch failed for backward citations of ${patentId}:`, err);
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter helpers
// ─────────────────────────────────────────────────────────────────────────────

function passesFilters(
  patentId: string,
  config: ExplorationConfig,
  portfolioMap: Map<string, PortfolioPatent>,
  focusAreaPatentIds: Set<string> | null,
): boolean {
  const portfolioPatent = portfolioMap.get(patentId);

  // requireInPortfolio
  if (config.requireInPortfolio && !portfolioPatent) {
    return false;
  }

  // limitToSectors
  if (config.limitToSectors.length > 0 && portfolioPatent) {
    const sector = portfolioPatent.primary_sector;
    if (!sector || !config.limitToSectors.includes(sector)) {
      return false;
    }
  }

  // limitToCpcPrefixes
  if (config.limitToCpcPrefixes.length > 0) {
    const cpcCodes = portfolioPatent?.cpc_codes || [];
    // Also try loading from detail cache
    let detail: PatentDetail | null = null;
    if (cpcCodes.length === 0) {
      detail = loadPatentDetail(patentId, portfolioMap);
    }
    const allCodes = cpcCodes.length > 0 ? cpcCodes : (detail?.cpc_codes || []);

    if (allCodes.length === 0) {
      // No CPC data available; if filter is set, exclude
      return false;
    }
    const matches = allCodes.some(code =>
      config.limitToCpcPrefixes.some(prefix => code.startsWith(prefix))
    );
    if (!matches) return false;
  }

  // limitToFocusAreas
  if (config.limitToFocusAreas.length > 0 && focusAreaPatentIds) {
    if (!focusAreaPatentIds.has(patentId)) {
      return false;
    }
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation labels
// ─────────────────────────────────────────────────────────────────────────────

const GENERATION_LABELS: Record<number, string> = {
  0: 'seed',
  '-1': 'parent',
  '-2': 'grandparent',
  1: 'child',
  2: 'grandchild',
};

function getRelationLabel(depth: number, isSibling: boolean): string {
  if (isSibling) return 'sibling';
  if (depth in GENERATION_LABELS) return GENERATION_LABELS[depth];
  if (depth < -2) return `ancestor-${Math.abs(depth)}`;
  if (depth > 2) return `descendant-${depth}`;
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// BFS Exploration
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FAMILY_SIZE = 500;

export async function getForwardCitations(patentId: string, allowLive: boolean): Promise<string[]> {
  const cached = loadCachedForwardCitations(patentId);
  if (cached !== null) return cached;
  if (allowLive) {
    const live = await fetchForwardCitationsLive(patentId);
    if (live !== null) return live;
  }
  return [];
}

export async function getBackwardCitations(patentId: string, allowLive: boolean): Promise<string[]> {
  const cached = loadCachedBackwardCitations(patentId);
  if (cached !== null) return cached;
  if (allowLive) {
    const live = await fetchBackwardCitationsLive(patentId);
    if (live !== null) return live;
  }
  return [];
}

export async function executeExploration(explorationId: string): Promise<void> {
  // Load exploration config
  const exploration = await prisma.patentFamilyExploration.findUnique({
    where: { id: explorationId },
  });

  if (!exploration) {
    throw new Error(`Exploration ${explorationId} not found`);
  }

  // Set status to RUNNING
  await prisma.patentFamilyExploration.update({
    where: { id: explorationId },
    data: { status: 'RUNNING' },
  });

  try {
    const config: ExplorationConfig = {
      seedPatentId: exploration.seedPatentId,
      maxAncestorDepth: exploration.maxAncestorDepth,
      maxDescendantDepth: exploration.maxDescendantDepth,
      includeSiblings: exploration.includeSiblings,
      includeCousins: exploration.includeCousins,
      limitToSectors: exploration.limitToSectors,
      limitToCpcPrefixes: exploration.limitToCpcPrefixes,
      limitToFocusAreas: exploration.limitToFocusAreas,
      requireInPortfolio: exploration.requireInPortfolio,
    };

    const portfolioMap = loadPortfolioMap();

    // Pre-load focus area patent IDs if needed
    let focusAreaPatentIds: Set<string> | null = null;
    if (config.limitToFocusAreas.length > 0) {
      const faPatents = await prisma.focusAreaPatent.findMany({
        where: { focusAreaId: { in: config.limitToFocusAreas } },
        select: { patentId: true },
      });
      focusAreaPatentIds = new Set(faPatents.map(fp => fp.patentId));
    }

    // Allow live API calls if the key is available
    const allowLive = !!process.env.PATENTSVIEW_API_KEY;

    const members: MemberRecord[] = [];
    const visited = new Set<string>();

    // Add seed as generation 0
    members.push({
      patentId: config.seedPatentId,
      relationToSeed: 'seed',
      generationDepth: 0,
      inPortfolio: portfolioMap.has(config.seedPatentId),
    });
    visited.add(config.seedPatentId);

    // BFS upward (ancestors)
    if (config.maxAncestorDepth > 0) {
      let frontier = [config.seedPatentId];

      for (let gen = -1; gen >= -config.maxAncestorDepth; gen--) {
        if (members.length >= MAX_FAMILY_SIZE) break;
        const nextFrontier: string[] = [];

        for (const pid of frontier) {
          if (members.length >= MAX_FAMILY_SIZE) break;

          const parents = await getBackwardCitations(pid, allowLive);

          for (const parentId of parents) {
            if (visited.has(parentId)) continue;
            if (members.length >= MAX_FAMILY_SIZE) break;

            if (!passesFilters(parentId, config, portfolioMap, focusAreaPatentIds)) {
              continue;
            }

            visited.add(parentId);
            members.push({
              patentId: parentId,
              relationToSeed: getRelationLabel(gen, false),
              generationDepth: gen,
              inPortfolio: portfolioMap.has(parentId),
            });
            nextFrontier.push(parentId);
          }
        }

        frontier = nextFrontier;
        if (frontier.length === 0) break;
      }
    }

    // BFS downward (descendants)
    if (config.maxDescendantDepth > 0) {
      let frontier = [config.seedPatentId];

      for (let gen = 1; gen <= config.maxDescendantDepth; gen++) {
        if (members.length >= MAX_FAMILY_SIZE) break;
        const nextFrontier: string[] = [];

        for (const pid of frontier) {
          if (members.length >= MAX_FAMILY_SIZE) break;

          const children = await getForwardCitations(pid, allowLive);

          for (const childId of children) {
            if (visited.has(childId)) continue;
            if (members.length >= MAX_FAMILY_SIZE) break;

            if (!passesFilters(childId, config, portfolioMap, focusAreaPatentIds)) {
              continue;
            }

            visited.add(childId);
            members.push({
              patentId: childId,
              relationToSeed: getRelationLabel(gen, false),
              generationDepth: gen,
              inPortfolio: portfolioMap.has(childId),
            });
            nextFrontier.push(childId);
          }
        }

        frontier = nextFrontier;
        if (frontier.length === 0) break;
      }
    }

    // Siblings: seed's parents' children (excluding seed)
    if (config.includeSiblings) {
      const seedParents = await getBackwardCitations(config.seedPatentId, allowLive);

      for (const parentId of seedParents) {
        if (members.length >= MAX_FAMILY_SIZE) break;

        const siblings = await getForwardCitations(parentId, allowLive);

        for (const siblingId of siblings) {
          if (visited.has(siblingId)) continue;
          if (members.length >= MAX_FAMILY_SIZE) break;

          if (!passesFilters(siblingId, config, portfolioMap, focusAreaPatentIds)) {
            continue;
          }

          visited.add(siblingId);
          members.push({
            patentId: siblingId,
            relationToSeed: 'sibling',
            generationDepth: 0,
            inPortfolio: portfolioMap.has(siblingId),
          });
        }
      }
    }

    // Delete existing members for this exploration (in case of re-run)
    await prisma.patentFamilyMember.deleteMany({
      where: { explorationId },
    });

    // Persist all members
    if (members.length > 0) {
      await prisma.patentFamilyMember.createMany({
        data: members.map(m => ({
          explorationId,
          patentId: m.patentId,
          relationToSeed: m.relationToSeed,
          generationDepth: m.generationDepth,
          inPortfolio: m.inPortfolio,
        })),
      });
    }

    // Update exploration status
    await prisma.patentFamilyExploration.update({
      where: { id: explorationId },
      data: {
        status: 'COMPLETE',
        discoveredCount: members.length,
      },
    });

    console.log(`[PatentFamily] Exploration ${explorationId} complete: ${members.length} members found`);
  } catch (err) {
    console.error(`[PatentFamily] Exploration ${explorationId} failed:`, err);
    await prisma.patentFamilyExploration.update({
      where: { id: explorationId },
      data: {
        status: 'ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      },
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD Operations
// ─────────────────────────────────────────────────────────────────────────────

export async function createExploration(params: {
  seedPatentId: string;
  name?: string;
  description?: string;
  maxAncestorDepth?: number;
  maxDescendantDepth?: number;
  includeSiblings?: boolean;
  includeCousins?: boolean;
  limitToSectors?: string[];
  limitToCpcPrefixes?: string[];
  limitToFocusAreas?: string[];
  requireInPortfolio?: boolean;
}) {
  return prisma.patentFamilyExploration.create({
    data: {
      seedPatentId: params.seedPatentId,
      name: params.name || `Family of ${params.seedPatentId}`,
      description: params.description,
      maxAncestorDepth: params.maxAncestorDepth ?? 2,
      maxDescendantDepth: params.maxDescendantDepth ?? 2,
      includeSiblings: params.includeSiblings ?? true,
      includeCousins: params.includeCousins ?? false,
      limitToSectors: params.limitToSectors ?? [],
      limitToCpcPrefixes: params.limitToCpcPrefixes ?? [],
      limitToFocusAreas: params.limitToFocusAreas ?? [],
      requireInPortfolio: params.requireInPortfolio ?? false,
    },
  });
}

export async function getExplorationWithMembers(explorationId: string) {
  const exploration = await prisma.patentFamilyExploration.findUnique({
    where: { id: explorationId },
    include: {
      members: {
        orderBy: [
          { generationDepth: 'asc' },
          { patentId: 'asc' },
        ],
      },
    },
  });

  if (!exploration) return null;

  const portfolioMap = loadPortfolioMap();

  // Enrich members with patent details
  const enrichedMembers = exploration.members.map(m => {
    const detail = loadPatentDetail(m.patentId, portfolioMap);
    return {
      id: m.id,
      patentId: m.patentId,
      relationToSeed: m.relationToSeed,
      generationDepth: m.generationDepth,
      inPortfolio: m.inPortfolio,
      patentTitle: detail?.patent_title || '',
      assignee: detail?.assignee || '',
      patentDate: detail?.patent_date || '',
      primarySector: detail?.primary_sector || '',
      superSector: detail?.super_sector || '',
      forwardCitations: detail?.forward_citations,
      score: detail?.score,
    };
  });

  // Build generation summary
  const generations: Record<number, { label: string; count: number }> = {};
  for (const m of enrichedMembers) {
    if (!generations[m.generationDepth]) {
      generations[m.generationDepth] = {
        label: m.relationToSeed,
        count: 0,
      };
    }
    generations[m.generationDepth].count++;
  }

  // Handle siblings separately (they share depth 0 with seed)
  const siblingCount = enrichedMembers.filter(m => m.relationToSeed === 'sibling').length;
  if (siblingCount > 0) {
    // Adjust seed count
    if (generations[0]) {
      generations[0].count -= siblingCount;
      generations[0].label = 'seed';
    }
    // Add sibling pseudo-generation using a special key
    (generations as any)['sibling'] = { label: 'sibling', count: siblingCount };
  }

  return {
    exploration: {
      id: exploration.id,
      seedPatentId: exploration.seedPatentId,
      name: exploration.name,
      description: exploration.description,
      maxAncestorDepth: exploration.maxAncestorDepth,
      maxDescendantDepth: exploration.maxDescendantDepth,
      includeSiblings: exploration.includeSiblings,
      includeCousins: exploration.includeCousins,
      limitToSectors: exploration.limitToSectors,
      limitToCpcPrefixes: exploration.limitToCpcPrefixes,
      limitToFocusAreas: exploration.limitToFocusAreas,
      requireInPortfolio: exploration.requireInPortfolio,
      status: exploration.status,
      discoveredCount: exploration.discoveredCount,
      errorMessage: exploration.errorMessage,
      createdAt: exploration.createdAt.toISOString(),
      updatedAt: exploration.updatedAt.toISOString(),
    },
    members: enrichedMembers,
    generations,
  };
}

export async function listExplorations(seedPatentId?: string) {
  const where = seedPatentId ? { seedPatentId } : {};
  return prisma.patentFamilyExploration.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { members: true } },
    },
  });
}

export async function deleteExploration(id: string) {
  return prisma.patentFamilyExploration.delete({
    where: { id },
  });
}

export async function getExplorationStatus(id: string) {
  return prisma.patentFamilyExploration.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      discoveredCount: true,
      errorMessage: true,
      updatedAt: true,
    },
  });
}

export async function addMembersToFocusArea(
  explorationId: string,
  focusAreaId: string,
  patentIds: string[],
) {
  // Verify the patents are members of this exploration
  const members = await prisma.patentFamilyMember.findMany({
    where: {
      explorationId,
      patentId: { in: patentIds },
    },
    select: { patentId: true },
  });

  const validIds = members.map(m => m.patentId);

  if (validIds.length === 0) {
    return { added: 0, total: 0 };
  }

  // Add to focus area (skip duplicates)
  let added = 0;
  for (const patentId of validIds) {
    try {
      await prisma.focusAreaPatent.create({
        data: {
          focusAreaId,
          patentId,
          membershipType: 'MANUAL',
        },
      });
      added++;
    } catch {
      // Unique constraint violation = already exists, skip
    }
  }

  // Update focus area patent count
  const total = await prisma.focusAreaPatent.count({
    where: { focusAreaId },
  });
  await prisma.focusArea.update({
    where: { id: focusAreaId },
    data: {
      patentCount: total,
      lastCalculatedAt: new Date(),
    },
  });

  return { added, total };
}

export function getCacheStatus(patentId: string) {
  const fwdPath = path.join(process.cwd(), 'cache/api/patentsview/forward-citations', `${patentId}.json`);
  const bwdPath = path.join(process.cwd(), 'cache/patent-families/parents', `${patentId}.json`);
  const detailPath = path.join(process.cwd(), 'cache/patent-families/parent-details', `${patentId}.json`);

  const portfolioMap = loadPortfolioMap();

  return {
    patentId,
    inPortfolio: portfolioMap.has(patentId),
    hasForwardCitations: fs.existsSync(fwdPath),
    hasBackwardCitations: fs.existsSync(bwdPath),
    hasParentDetails: fs.existsSync(detailPath),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Seed Exploration Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Preview multi-seed exploration results without executing full BFS
 */
export async function previewMultiSeedExploration(config: MultiSeedConfig): Promise<PreviewResult> {
  const portfolioMap = loadPortfolioMap();
  const allowLive = false; // Preview only uses cached data

  const seedDetails: PreviewResult['seedDetails'] = [];
  let totalParents = 0;
  let totalChildren = 0;
  let totalSiblings = 0;

  const allCitedPatents = new Set<string>();
  const allCitingPatents = new Set<string>();

  for (const seedPatentId of config.seedPatentIds) {
    const inPortfolio = portfolioMap.has(seedPatentId);
    const fwdPath = path.join(process.cwd(), 'cache/api/patentsview/forward-citations', `${seedPatentId}.json`);
    const bwdPath = path.join(process.cwd(), 'cache/patent-families/parents', `${seedPatentId}.json`);
    const hasCachedCitations = fs.existsSync(fwdPath) || fs.existsSync(bwdPath);
    const detail = loadPatentDetail(seedPatentId, portfolioMap);

    seedDetails.push({
      patentId: seedPatentId,
      title: detail?.patent_title,
      inPortfolio,
      hasCachedCitations,
    });

    // Count immediate parents (depth 1)
    const parents = await getBackwardCitations(seedPatentId, allowLive);
    totalParents += parents.length;
    parents.forEach(p => allCitedPatents.add(p));

    // Count immediate children (depth 1)
    const children = await getForwardCitations(seedPatentId, allowLive);
    totalChildren += children.length;
    children.forEach(c => allCitingPatents.add(c));

    // Estimate siblings
    if (config.includeSiblings) {
      for (const parentId of parents.slice(0, 3)) { // Sample first 3 parents
        const siblingCandidates = await getForwardCitations(parentId, allowLive);
        totalSiblings += siblingCandidates.length;
      }
    }
  }

  // Calculate seed overlap (shared citations indicate related patents)
  const sharedCitationsCount = config.seedPatentIds.length > 1
    ? [...allCitedPatents].filter(p => allCitingPatents.has(p)).length
    : 0;

  // Collect common sectors
  const sectorCounts = new Map<string, number>();
  for (const detail of seedDetails) {
    const patent = loadPatentDetail(detail.patentId, portfolioMap);
    if (patent?.primary_sector) {
      sectorCounts.set(patent.primary_sector, (sectorCounts.get(patent.primary_sector) || 0) + 1);
    }
  }
  const commonSectors = [...sectorCounts.entries()]
    .filter(([_, count]) => count > 1)
    .map(([sector]) => sector);

  const cachedDataAvailable = seedDetails.filter(s => s.hasCachedCitations).length;
  const estimatedApiCalls = (config.seedPatentIds.length - cachedDataAvailable) * 2; // 2 calls per seed (fwd + bwd)

  // Rough estimate: apply depth multiplier
  const depthMultiplier = (config.maxAncestorDepth + config.maxDescendantDepth) / 2;
  const estimatedTotal = Math.round(
    config.seedPatentIds.length +
    (totalParents * depthMultiplier) / config.seedPatentIds.length +
    (totalChildren * depthMultiplier) / config.seedPatentIds.length +
    totalSiblings / 3
  );

  return {
    estimatedMembers: {
      total: Math.min(estimatedTotal, MAX_FAMILY_SIZE),
      parents: Math.round(totalParents * depthMultiplier / config.seedPatentIds.length),
      children: Math.round(totalChildren * depthMultiplier / config.seedPatentIds.length),
      siblings: Math.round(totalSiblings / 3),
      seeds: config.seedPatentIds.length,
    },
    seedOverlap: {
      sharedCitationsCount,
      commonSectors,
    },
    cachedDataAvailable,
    estimatedApiCalls,
    seedDetails,
  };
}

/**
 * Execute multi-seed exploration with merge strategy
 */
export async function executeMultiSeedExploration(
  explorationId: string,
  config: MultiSeedConfig,
): Promise<EnrichedFamilyMember[]> {
  const portfolioMap = loadPortfolioMap();
  const allowLive = !!process.env.PATENTSVIEW_API_KEY;

  // Track which seeds discovered each patent
  const patentToSeeds = new Map<string, Set<string>>();
  const patentToRelation = new Map<string, { relation: string; depth: number }>();

  // Run BFS for each seed
  for (const seedPatentId of config.seedPatentIds) {
    const visited = new Set<string>();
    visited.add(seedPatentId);

    // Record seed
    if (!patentToSeeds.has(seedPatentId)) {
      patentToSeeds.set(seedPatentId, new Set());
    }
    patentToSeeds.get(seedPatentId)!.add(seedPatentId);
    patentToRelation.set(seedPatentId, { relation: 'seed', depth: 0 });

    // BFS upward (ancestors)
    if (config.maxAncestorDepth > 0) {
      let frontier = [seedPatentId];
      for (let gen = -1; gen >= -config.maxAncestorDepth; gen--) {
        const nextFrontier: string[] = [];
        for (const pid of frontier) {
          const parents = await getBackwardCitations(pid, allowLive);
          for (const parentId of parents) {
            if (!visited.has(parentId)) {
              visited.add(parentId);
              if (!patentToSeeds.has(parentId)) {
                patentToSeeds.set(parentId, new Set());
              }
              patentToSeeds.get(parentId)!.add(seedPatentId);
              if (!patentToRelation.has(parentId)) {
                patentToRelation.set(parentId, { relation: getRelationLabel(gen, false), depth: gen });
              }
              nextFrontier.push(parentId);
            } else {
              // Already visited - record this seed as another source
              patentToSeeds.get(parentId)?.add(seedPatentId);
            }
          }
        }
        frontier = nextFrontier;
        if (frontier.length === 0) break;
      }
    }

    // BFS downward (descendants)
    if (config.maxDescendantDepth > 0) {
      let frontier = [seedPatentId];
      for (let gen = 1; gen <= config.maxDescendantDepth; gen++) {
        const nextFrontier: string[] = [];
        for (const pid of frontier) {
          const children = await getForwardCitations(pid, allowLive);
          for (const childId of children) {
            if (!visited.has(childId)) {
              visited.add(childId);
              if (!patentToSeeds.has(childId)) {
                patentToSeeds.set(childId, new Set());
              }
              patentToSeeds.get(childId)!.add(seedPatentId);
              if (!patentToRelation.has(childId)) {
                patentToRelation.set(childId, { relation: getRelationLabel(gen, false), depth: gen });
              }
              nextFrontier.push(childId);
            } else {
              patentToSeeds.get(childId)?.add(seedPatentId);
            }
          }
        }
        frontier = nextFrontier;
        if (frontier.length === 0) break;
      }
    }

    // Siblings - find through available directions based on config
    // If ancestors > 0: siblings = children of parents (other patents citing same prior art)
    // If descendants > 0: co-siblings = other children of child's parents (patents with shared citing patents)
    if (config.includeSiblings) {
      const siblingCandidates = new Set<string>();

      // Method 1: Via parents (if we're traversing ancestors)
      // Siblings = other patents that cite the same prior art as seed
      if (config.maxAncestorDepth > 0) {
        const seedParents = await getBackwardCitations(seedPatentId, allowLive);
        for (const parentId of seedParents) {
          const siblingsViaParent = await getForwardCitations(parentId, allowLive);
          for (const sibId of siblingsViaParent) {
            if (sibId !== seedPatentId) siblingCandidates.add(sibId);
          }
        }
      }

      // Method 2: Via children (if we're traversing descendants)
      // Co-siblings = other patents cited by the same patents that cite seed
      // This is useful when seed has no parents (like patent 10944691)
      if (config.maxDescendantDepth > 0) {
        const seedChildren = await getForwardCitations(seedPatentId, allowLive);
        // Sample children to avoid explosion (first 10)
        const sampledChildren = seedChildren.slice(0, 10);
        for (const childId of sampledChildren) {
          const childParents = await getBackwardCitations(childId, allowLive);
          for (const coSiblingId of childParents) {
            if (coSiblingId !== seedPatentId) siblingCandidates.add(coSiblingId);
          }
        }
      }

      // Add all sibling candidates
      for (const siblingId of siblingCandidates) {
        if (!visited.has(siblingId)) {
          visited.add(siblingId);
          if (!patentToSeeds.has(siblingId)) {
            patentToSeeds.set(siblingId, new Set());
          }
          patentToSeeds.get(siblingId)!.add(seedPatentId);
          if (!patentToRelation.has(siblingId)) {
            patentToRelation.set(siblingId, { relation: 'sibling', depth: 0 });
          }
        } else {
          patentToSeeds.get(siblingId)?.add(seedPatentId);
        }
      }
    }
  }

  // Apply merge strategy
  const seedCount = config.seedPatentIds.length;
  const candidatePatents = [...patentToSeeds.entries()]
    .filter(([_, seeds]) => {
      if (config.mergeStrategy === 'INTERSECTION') {
        // Must be discovered by ALL seeds
        return seeds.size === seedCount;
      }
      // UNION: discovered by ANY seed
      return seeds.size > 0;
    })
    .map(([patentId, seeds]) => ({
      patentId,
      seedPatentIds: [...seeds],
      ...patentToRelation.get(patentId)!,
    }));

  // Apply filters and enrich
  const competitorMatcher = getCompetitorMatcher();
  const members: EnrichedFamilyMember[] = [];

  for (const candidate of candidatePatents) {
    if (members.length >= MAX_FAMILY_SIZE) break;

    const detail = loadPatentDetail(candidate.patentId, portfolioMap);
    const inPortfolio = portfolioMap.has(candidate.patentId);
    const assignee = detail?.assignee || '';
    const affiliate = normalizeAffiliate(assignee);
    const competitorMatch = competitorMatcher.matchCompetitor(assignee);

    // Apply filters
    if (config.requireInPortfolio && !inPortfolio) continue;

    if (config.limitToSectors.length > 0) {
      const sector = detail?.primary_sector;
      if (!sector || !config.limitToSectors.includes(sector)) continue;
    }

    if (config.limitToCompetitors.length > 0) {
      if (!competitorMatch || !config.limitToCompetitors.includes(competitorMatch.company)) continue;
    }

    if (config.limitToAffiliates.length > 0) {
      if (!config.limitToAffiliates.includes(affiliate) && affiliate !== 'Unknown') continue;
    }

    if (config.minFilingYear) {
      const year = detail?.patent_date ? parseInt(detail.patent_date.split('-')[0], 10) : 0;
      if (year < config.minFilingYear) continue;
    }

    // Calculate remaining years
    let remainingYears: number | undefined;
    if (detail?.patent_date) {
      const grantDate = new Date(detail.patent_date);
      const expiryDate = new Date(grantDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + 20);
      remainingYears = Math.max(0, (expiryDate.getTime() - Date.now()) / (365.25 * 24 * 60 * 60 * 1000));
    }

    // Get data retrieval status
    const { status: dataStatus, reason: dataStatusReason } = getPatentDataStatus(
      candidate.patentId,
      portfolioMap,
      detail
    );

    members.push({
      patentId: candidate.patentId,
      relationToSeed: candidate.relation,
      generationDepth: candidate.depth,
      inPortfolio,
      patentTitle: detail?.patent_title || '',
      assignee,
      patentDate: detail?.patent_date || '',
      primarySector: detail?.primary_sector || '',
      superSector: detail?.super_sector || '',
      forwardCitations: detail?.forward_citations,
      score: detail?.score,
      affiliate,
      competitorMatch,
      seedPatentIds: candidate.seedPatentIds,
      remainingYears,
      dataStatus,
      dataStatusReason,
    });
  }

  return members;
}

/**
 * Create a Focus Area from exploration results
 */
export async function createFocusAreaFromExploration(params: {
  explorationId?: string;
  name: string;
  description?: string;
  patentIds: string[];
  includeExternalPatents: boolean;
  ownerId: string;
}): Promise<{ focusArea: { id: string; name: string; patentCount: number }; added: number }> {
  const portfolioMap = loadPortfolioMap();

  // Filter patents based on includeExternalPatents
  const patentsToAdd = params.includeExternalPatents
    ? params.patentIds
    : params.patentIds.filter(id => portfolioMap.has(id));

  // Create the focus area
  const focusArea = await prisma.focusArea.create({
    data: {
      name: params.name,
      description: params.description,
      ownerId: params.ownerId,
      status: 'ACTIVE',
      searchScopeType: 'PATENT_FAMILY',
      searchScopeConfig: params.explorationId ? { explorationId: params.explorationId } : undefined,
      patentCount: patentsToAdd.length,
      lastCalculatedAt: new Date(),
    },
  });

  // Add patents to the focus area
  let added = 0;
  for (const patentId of patentsToAdd) {
    try {
      await prisma.focusAreaPatent.create({
        data: {
          focusAreaId: focusArea.id,
          patentId,
          membershipType: 'MANUAL',
        },
      });
      added++;
    } catch {
      // Skip duplicates
    }
  }

  // Update count
  await prisma.focusArea.update({
    where: { id: focusArea.id },
    data: { patentCount: added },
  });

  return {
    focusArea: {
      id: focusArea.id,
      name: focusArea.name,
      patentCount: added,
    },
    added,
  };
}

/**
 * Get competitor list for filtering
 */
export function getAvailableCompetitors(): string[] {
  const matcher = getCompetitorMatcher();
  return matcher.getAllCompanyNames();
}

/**
 * Get affiliate list for filtering
 */
export function getAvailableAffiliates(): { key: string; displayName: string }[] {
  const affiliatesPath = path.join(process.cwd(), 'config/portfolio-affiliates.json');
  try {
    const data = JSON.parse(fs.readFileSync(affiliatesPath, 'utf-8'));
    return Object.entries(data.affiliates as Record<string, { displayName: string }>)
      .map(([key, val]) => ({ key, displayName: val.displayName }));
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prosecution/IPR Enrichment Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LitigationIndicator {
  patentId: string;
  hasIPR: boolean;
  iprCount: number;
  iprTrials?: Array<{
    trialNumber: string;
    trialType: string;
    status?: string;
    petitionerName?: string;
    filingDate?: string;
    institutionDecision?: string;
  }>;
  hasProsecutionHistory: boolean;
  prosecutionStatus?: string;
  officeActionCount?: number;
  rejectionCount?: number;
}

export interface EnrichmentStatus {
  patentId: string;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
  hasIPR?: boolean;
  hasProsecutionHistory?: boolean;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prosecution/IPR Enrichment Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a patent has IPR/litigation history
 */
export async function checkPatentIPR(patentId: string): Promise<LitigationIndicator> {
  const cachePath = path.join(process.cwd(), 'cache/api/ptab', `${patentId}.json`);

  // Check cache first
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return {
        patentId,
        hasIPR: cached.trials?.length > 0,
        iprCount: cached.trials?.length || 0,
        iprTrials: cached.trials,
        hasProsecutionHistory: false,
      };
    } catch {
      // Fall through to API call
    }
  }

  // Try to use PTAB client if API key is available
  if (process.env.USPTO_ODP_API_KEY) {
    try {
      const { createPTABClient } = await import('../../../clients/odp-ptab-client.js');
      const client = createPTABClient();
      const response = await client.searchIPRsByPatent(patentId);

      const result = {
        patentId,
        hasIPR: response.trials.length > 0,
        iprCount: response.trials.length,
        iprTrials: response.trials.map(t => ({
          trialNumber: t.trialNumber,
          trialType: t.trialType,
          status: t.trialStatusText,
          petitionerName: t.petitionerPartyName,
          filingDate: t.filingDate,
          institutionDecision: t.institutionDecision,
        })),
        hasProsecutionHistory: false,
      };

      // Cache the result
      const cacheDir = path.dirname(cachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(cachePath, JSON.stringify({ trials: result.iprTrials }, null, 2));

      return result;
    } catch (err) {
      console.warn(`[PatentFamily] IPR check failed for ${patentId}:`, err);
    }
  }

  return {
    patentId,
    hasIPR: false,
    iprCount: 0,
    hasProsecutionHistory: false,
  };
}

/**
 * Check prosecution history for a patent
 */
export async function checkPatentProsecution(patentId: string): Promise<LitigationIndicator> {
  const cachePath = path.join(process.cwd(), 'cache/api/file-wrapper', `${patentId}.json`);

  // Check cache first
  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return {
        patentId,
        hasIPR: false,
        iprCount: 0,
        hasProsecutionHistory: true,
        prosecutionStatus: cached.status,
        officeActionCount: cached.officeActionCount,
        rejectionCount: cached.rejectionCount,
      };
    } catch {
      // Fall through to API call
    }
  }

  // Try to use File Wrapper client if API key is available
  if (process.env.USPTO_ODP_API_KEY) {
    try {
      const { createFileWrapperClient } = await import('../../../clients/odp-file-wrapper-client.js');
      const client = createFileWrapperClient();

      // Find application by patent number
      const app = await client.getApplicationByPatentNumber(patentId);
      if (!app) {
        return {
          patentId,
          hasIPR: false,
          iprCount: 0,
          hasProsecutionHistory: false,
        };
      }

      const appNumber = app.applicationNumberText;
      const [status, docs] = await Promise.all([
        client.getApplicationStatus(appNumber),
        client.getDocuments(appNumber).catch(() => ({ documents: [] })),
      ]);

      // Count office actions and rejections
      const officeActionCodes = ['CTNF', 'CTFR'];
      const officeActions = docs.documents?.filter(d =>
        officeActionCodes.includes(d.documentCode || '')
      ) || [];

      const result = {
        patentId,
        hasIPR: false,
        iprCount: 0,
        hasProsecutionHistory: true,
        prosecutionStatus: status.status,
        officeActionCount: officeActions.length,
        rejectionCount: officeActions.filter(d => d.documentCode === 'CTFR').length,
      };

      // Cache the result
      const cacheDir = path.dirname(cachePath);
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }
      fs.writeFileSync(cachePath, JSON.stringify({
        status: result.prosecutionStatus,
        officeActionCount: result.officeActionCount,
        rejectionCount: result.rejectionCount,
        applicationNumber: appNumber,
      }, null, 2));

      return result;
    } catch (err) {
      console.warn(`[PatentFamily] Prosecution check failed for ${patentId}:`, err);
    }
  }

  return {
    patentId,
    hasIPR: false,
    iprCount: 0,
    hasProsecutionHistory: false,
  };
}

/**
 * Batch enrich patents with litigation data
 */
export async function enrichWithLitigation(
  patentIds: string[],
  options: {
    includeIpr?: boolean;
    includeProsecution?: boolean;
  } = {}
): Promise<{
  enriched: number;
  indicators: LitigationIndicator[];
}> {
  const { includeIpr = true, includeProsecution = true } = options;
  const indicators: LitigationIndicator[] = [];
  let enriched = 0;

  for (const patentId of patentIds) {
    try {
      let indicator: LitigationIndicator = {
        patentId,
        hasIPR: false,
        iprCount: 0,
        hasProsecutionHistory: false,
      };

      if (includeIpr) {
        const iprData = await checkPatentIPR(patentId);
        indicator = { ...indicator, ...iprData };
      }

      if (includeProsecution) {
        const prosData = await checkPatentProsecution(patentId);
        indicator = {
          ...indicator,
          hasProsecutionHistory: prosData.hasProsecutionHistory,
          prosecutionStatus: prosData.prosecutionStatus,
          officeActionCount: prosData.officeActionCount,
          rejectionCount: prosData.rejectionCount,
        };
      }

      indicators.push(indicator);
      enriched++;
    } catch (err) {
      console.warn(`[PatentFamily] Enrichment failed for ${patentId}:`, err);
      indicators.push({
        patentId,
        hasIPR: false,
        iprCount: 0,
        hasProsecutionHistory: false,
      });
    }
  }

  return { enriched, indicators };
}

/**
 * Get cached litigation status for patents
 */
export function getCachedLitigationStatus(patentIds: string[]): EnrichmentStatus[] {
  return patentIds.map(patentId => {
    const iprPath = path.join(process.cwd(), 'cache/api/ptab', `${patentId}.json`);
    const prosPath = path.join(process.cwd(), 'cache/api/file-wrapper', `${patentId}.json`);

    const hasIPR = fs.existsSync(iprPath);
    const hasProsecution = fs.existsSync(prosPath);

    if (!hasIPR && !hasProsecution) {
      return { patentId, status: 'pending' as const };
    }

    return {
      patentId,
      status: 'complete' as const,
      hasIPR,
      hasProsecutionHistory: hasProsecution,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Patent Detail Fetching
// ─────────────────────────────────────────────────────────────────────────────

export interface FetchPatentDetailsResult {
  fetched: number;
  alreadyCached: number;
  failed: number;
  patentIds: {
    fetched: string[];
    alreadyCached: string[];
    failed: string[];
  };
}

/**
 * Fetch basic patent details for external patents that don't have data yet.
 * This is called before enrichment or when viewing patents in Family Explorer.
 */
export async function fetchMissingPatentDetails(
  patentIds: string[]
): Promise<FetchPatentDetailsResult> {
  const portfolioMap = loadPortfolioMap();

  // Find patents that need fetching (not in portfolio and not cached)
  const needsFetching: string[] = [];
  const alreadyCached: string[] = [];

  for (const patentId of patentIds) {
    // Skip portfolio patents - they have all the data
    if (portfolioMap.has(patentId)) {
      alreadyCached.push(patentId);
      continue;
    }

    // Check if we already have data
    if (hasPatentData(patentId)) {
      alreadyCached.push(patentId);
      continue;
    }

    needsFetching.push(patentId);
  }

  if (needsFetching.length === 0) {
    console.log(`[PatentFamily] All ${patentIds.length} patents already have data`);
    return {
      fetched: 0,
      alreadyCached: alreadyCached.length,
      failed: 0,
      patentIds: { fetched: [], alreadyCached, failed: [] },
    };
  }

  console.log(`[PatentFamily] Fetching details for ${needsFetching.length} patents...`);

  try {
    const result = await fetchAndCachePatents(needsFetching);

    return {
      fetched: result.fetched.length,
      alreadyCached: alreadyCached.length + result.alreadyCached.length,
      failed: result.failed.length,
      patentIds: {
        fetched: result.fetched,
        alreadyCached: [...alreadyCached, ...result.alreadyCached],
        failed: result.failed,
      },
    };
  } catch (err) {
    console.error('[PatentFamily] Failed to fetch patent details:', err);
    return {
      fetched: 0,
      alreadyCached: alreadyCached.length,
      failed: needsFetching.length,
      patentIds: { fetched: [], alreadyCached, failed: needsFetching },
    };
  }
}

/**
 * Enrich patents with both basic details AND litigation data.
 * This ensures patent title/assignee/etc are available before IPR/prosecution enrichment.
 */
export async function enrichPatentsWithDetails(
  patentIds: string[],
  options: {
    fetchBasicDetails?: boolean;
    includeIpr?: boolean;
    includeProsecution?: boolean;
  } = {}
): Promise<{
  detailsFetched: FetchPatentDetailsResult;
  litigation: { enriched: number; indicators: LitigationIndicator[] };
}> {
  const {
    fetchBasicDetails = true,
    includeIpr = true,
    includeProsecution = true
  } = options;

  // Step 1: Fetch basic patent details first
  let detailsFetched: FetchPatentDetailsResult = {
    fetched: 0,
    alreadyCached: patentIds.length,
    failed: 0,
    patentIds: { fetched: [], alreadyCached: patentIds, failed: [] },
  };

  if (fetchBasicDetails) {
    detailsFetched = await fetchMissingPatentDetails(patentIds);
  }

  // Step 2: Enrich with litigation data
  const litigation = await enrichWithLitigation(patentIds, { includeIpr, includeProsecution });

  return { detailsFetched, litigation };
}
