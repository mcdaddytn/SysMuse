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

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PortfolioPatent {
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

interface PatentDetail {
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
// Portfolio cache (same pattern as patents.routes.ts)
// ─────────────────────────────────────────────────────────────────────────────

let portfolioCache: Map<string, PortfolioPatent> | null = null;
let portfolioCacheTime = 0;
const PORTFOLIO_TTL = 5 * 60 * 1000;

function loadPortfolioMap(): Map<string, PortfolioPatent> {
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

function loadCachedForwardCitations(patentId: string): string[] | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/api/patentsview/forward-citations', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.citing_patent_ids || [];
    }
  } catch { /* skip */ }
  return null;
}

function loadCachedBackwardCitations(patentId: string): string[] | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/patent-families/parents', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.parent_patent_ids || [];
    }
  } catch { /* skip */ }
  return null;
}

function loadPatentDetail(patentId: string, portfolioMap: Map<string, PortfolioPatent>): PatentDetail | null {
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
      return {
        patent_id: patentId,
        patent_title: data.patent_title,
        assignee: data.assignees?.[0]?.assignee_organization || '',
        patent_date: data.patent_date,
      };
    }
  } catch { /* skip */ }

  return null;
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

    // Get backward citations via the patent's us_patent_citations field
    const result = await client.searchPatents({
      query: { patent_id: patentId },
      fields: ['patent_id', 'us_patent_citations'],
    });

    if (result.patents.length === 0) return [];

    const patent = result.patents[0];
    const parentIds = (patent.us_patent_citations || [])
      .map((c: any) => c.cited_patent_id || c.cited_patent_number)
      .filter(Boolean) as string[];

    // Cache the result
    const cacheDir = path.join(process.cwd(), 'cache/patent-families/parents');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, `${patentId}.json`),
      JSON.stringify({ patent_id: patentId, parent_patent_ids: parentIds }, null, 2)
    );

    return parentIds;
  } catch (err) {
    console.warn(`[PatentFamily] Live API fetch failed for backward citations of ${patentId}:`, err);
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

async function getForwardCitations(patentId: string, allowLive: boolean): Promise<string[]> {
  const cached = loadCachedForwardCitations(patentId);
  if (cached !== null) return cached;
  if (allowLive) {
    const live = await fetchForwardCitationsLive(patentId);
    if (live !== null) return live;
  }
  return [];
}

async function getBackwardCitations(patentId: string, allowLive: boolean): Promise<string[]> {
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
