/**
 * CPC Assignment Strategy Service
 *
 * Pluggable strategy system for determining a patent's primary CPC code.
 * Replaces the simplistic "first CPC encountered" approach with intelligent
 * strategies that consider inventive designation, taxonomy fit, and portfolio context.
 *
 * Strategies:
 * - first-inventive: deterministic, picks main inventive CPC (default)
 * - cluster-fit: prefers CPCs that align with well-populated sectors
 * - discovery: prefers CPCs NOT well-represented in existing sectors
 * - portfolio-overlap: prefers CPCs shared with competitor portfolios
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================================================
// Types
// ============================================================================

export type CpcStrategyName = 'first-inventive' | 'cluster-fit' | 'discovery' | 'portfolio-overlap';

export interface CpcStrategyInput {
  patentId: string;
  cpcCodes: Array<{
    code: string;
    isInventive: boolean;
    isMainCpc?: boolean;
  }>;
  portfolioId?: string;
}

export interface CpcStrategyResult {
  primaryCpc: string;
  strategy: CpcStrategyName;
  confidence: number;  // 0-1
  reasoning?: string;
}

interface SectorCpcStats {
  /** CPC prefix -> count of patents with that prefix in the sector */
  prefixCounts: Map<string, number>;
  totalPatents: number;
}

// ============================================================================
// Strategy Implementations
// ============================================================================

/**
 * first-inventive: Default deterministic strategy.
 * From inventive CPCs: pick main-cpc first, then longest code (most specific).
 * Fallback to additional CPCs if no inventive.
 */
function firstInventive(input: CpcStrategyInput): CpcStrategyResult {
  const inventive = input.cpcCodes.filter(c => c.isInventive);
  const additional = input.cpcCodes.filter(c => !c.isInventive);

  if (inventive.length > 0) {
    // Prefer main inventive CPC
    const mainInventive = inventive.find(c => c.isMainCpc);
    if (mainInventive) {
      return {
        primaryCpc: mainInventive.code,
        strategy: 'first-inventive',
        confidence: 1.0,
        reasoning: 'Main inventive CPC',
      };
    }
    // Pick longest (most specific) inventive CPC
    const sorted = [...inventive].sort((a, b) => b.code.length - a.code.length);
    return {
      primaryCpc: sorted[0].code,
      strategy: 'first-inventive',
      confidence: 0.9,
      reasoning: `Most specific inventive CPC (${inventive.length} inventive total)`,
    };
  }

  // Fallback to additional CPCs
  if (additional.length > 0) {
    const mainAdditional = additional.find(c => c.isMainCpc);
    return {
      primaryCpc: (mainAdditional || additional[0]).code,
      strategy: 'first-inventive',
      confidence: 0.5,
      reasoning: 'No inventive CPCs; using additional CPC',
    };
  }

  // No CPCs at all — shouldn't happen but handle gracefully
  return {
    primaryCpc: input.cpcCodes[0]?.code || '',
    strategy: 'first-inventive',
    confidence: 0.1,
    reasoning: 'Fallback — no designation data',
  };
}

/**
 * cluster-fit: Prefers inventive CPCs that align with well-populated sectors.
 * Scores each CPC by how many existing patents share that CPC prefix.
 */
async function clusterFit(input: CpcStrategyInput): Promise<CpcStrategyResult> {
  const stats = await getSectorCpcStats();
  const inventive = input.cpcCodes.filter(c => c.isInventive);
  const candidates = inventive.length > 0 ? inventive : input.cpcCodes;

  if (candidates.length === 0) {
    return firstInventive(input);
  }

  // Score each CPC by how many sector patents share its 4-char prefix
  const scored = candidates.map(cpc => {
    const prefix = cpc.code.replace(/\//g, '').substring(0, 4);
    const count = stats.prefixCounts.get(prefix) || 0;
    return { cpc, score: count };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (best.score === 0) {
    // No cluster fit found — fall back
    return {
      ...firstInventive(input),
      strategy: 'cluster-fit',
      reasoning: 'No cluster fit; fell back to first-inventive',
    };
  }

  const confidence = Math.min(1.0, 0.5 + (best.score / stats.totalPatents) * 5);

  return {
    primaryCpc: best.cpc.code,
    strategy: 'cluster-fit',
    confidence,
    reasoning: `CPC prefix matches ${best.score} existing patents in taxonomy`,
  };
}

/**
 * discovery: Prefers inventive CPCs NOT well-represented in existing sectors.
 * Good for identifying taxonomy gaps.
 */
async function discovery(input: CpcStrategyInput): Promise<CpcStrategyResult> {
  const stats = await getSectorCpcStats();
  const inventive = input.cpcCodes.filter(c => c.isInventive);
  const candidates = inventive.length > 0 ? inventive : input.cpcCodes;

  if (candidates.length === 0) {
    return firstInventive(input);
  }

  // Score inversely: prefer CPCs with FEWER existing patents
  const scored = candidates.map(cpc => {
    const prefix = cpc.code.replace(/\//g, '').substring(0, 4);
    const count = stats.prefixCounts.get(prefix) || 0;
    // Lower count = higher novelty score
    const noveltyScore = count === 0 ? 1.0 : 1.0 / (1 + count);
    return { cpc, score: noveltyScore, count };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  const confidence = best.count === 0 ? 0.3 : Math.min(0.8, best.score);

  return {
    primaryCpc: best.cpc.code,
    strategy: 'discovery',
    confidence,
    reasoning: best.count === 0
      ? 'CPC prefix not represented in any existing sector (novel)'
      : `CPC prefix underrepresented (${best.count} patents)`,
  };
}

/**
 * portfolio-overlap: Prefers CPCs that appear frequently in a competitor portfolio.
 * Requires portfolioId parameter.
 */
async function portfolioOverlap(input: CpcStrategyInput): Promise<CpcStrategyResult> {
  if (!input.portfolioId) {
    return {
      ...firstInventive(input),
      strategy: 'portfolio-overlap',
      reasoning: 'No portfolioId provided; fell back to first-inventive',
    };
  }

  const inventive = input.cpcCodes.filter(c => c.isInventive);
  const candidates = inventive.length > 0 ? inventive : input.cpcCodes;

  if (candidates.length === 0) {
    return firstInventive(input);
  }

  // Get CPC frequency in the target portfolio
  const portfolioCpcs = await prisma.patentCpc.groupBy({
    by: ['cpcCode'],
    where: {
      patent: {
        portfolios: { some: { portfolioId: input.portfolioId } },
      },
    },
    _count: { cpcCode: true },
  });

  const cpcFrequency = new Map(portfolioCpcs.map(r => [r.cpcCode, r._count.cpcCode]));

  // Score each candidate by overlap frequency
  const scored = candidates.map(cpc => {
    const count = cpcFrequency.get(cpc.code) || 0;
    // Also check prefix overlap
    const prefix = cpc.code.replace(/\//g, '').substring(0, 4);
    let prefixCount = 0;
    for (const [code, freq] of cpcFrequency) {
      if (code.replace(/\//g, '').startsWith(prefix)) {
        prefixCount += freq;
      }
    }
    return { cpc, exactCount: count, prefixCount };
  });

  // Prefer exact match, then prefix overlap
  scored.sort((a, b) => {
    if (b.exactCount !== a.exactCount) return b.exactCount - a.exactCount;
    return b.prefixCount - a.prefixCount;
  });

  const best = scored[0];
  const totalInPortfolio = portfolioCpcs.reduce((sum, r) => sum + r._count.cpcCode, 0);
  const confidence = totalInPortfolio > 0
    ? Math.min(1.0, 0.3 + (best.prefixCount / totalInPortfolio) * 3)
    : 0.3;

  return {
    primaryCpc: best.cpc.code,
    strategy: 'portfolio-overlap',
    confidence,
    reasoning: best.exactCount > 0
      ? `Exact CPC match found ${best.exactCount} times in portfolio`
      : best.prefixCount > 0
        ? `CPC prefix matches ${best.prefixCount} entries in portfolio`
        : 'No overlap found in portfolio; picked best inventive CPC',
  };
}

// ============================================================================
// Dispatcher
// ============================================================================

/**
 * Assign a primary CPC to a patent using the specified strategy.
 */
export async function assignPrimaryCpc(
  input: CpcStrategyInput,
  strategy: CpcStrategyName = 'first-inventive'
): Promise<CpcStrategyResult> {
  if (input.cpcCodes.length === 0) {
    return {
      primaryCpc: '',
      strategy,
      confidence: 0,
      reasoning: 'No CPC codes available',
    };
  }

  switch (strategy) {
    case 'first-inventive':
      return firstInventive(input);
    case 'cluster-fit':
      return clusterFit(input);
    case 'discovery':
      return discovery(input);
    case 'portfolio-overlap':
      return portfolioOverlap(input);
    default:
      return firstInventive(input);
  }
}

// ============================================================================
// Shared Helpers
// ============================================================================

let sectorCpcStatsCache: SectorCpcStats | null = null;
let sectorCpcStatsCacheTime = 0;
const STATS_CACHE_TTL = 5 * 60 * 1000;

/**
 * Get aggregated CPC prefix statistics across all classified patents.
 */
async function getSectorCpcStats(): Promise<SectorCpcStats> {
  const now = Date.now();
  if (sectorCpcStatsCache && (now - sectorCpcStatsCacheTime) < STATS_CACHE_TTL) {
    return sectorCpcStatsCache;
  }

  // Count patents per 4-char CPC prefix for patents that have a sector assigned
  const patents = await prisma.patent.findMany({
    where: {
      primarySector: { not: null },
      NOT: { primarySector: 'general' },
    },
    select: {
      cpcCodes: { select: { cpcCode: true } },
    },
  });

  const prefixCounts = new Map<string, number>();
  for (const patent of patents) {
    const seen = new Set<string>();
    for (const cpc of patent.cpcCodes) {
      const prefix = cpc.cpcCode.replace(/\//g, '').substring(0, 4);
      if (!seen.has(prefix)) {
        seen.add(prefix);
        prefixCounts.set(prefix, (prefixCounts.get(prefix) || 0) + 1);
      }
    }
  }

  sectorCpcStatsCache = { prefixCounts, totalPatents: patents.length };
  sectorCpcStatsCacheTime = now;

  return sectorCpcStatsCache;
}

export function clearCpcStrategyCache(): void {
  sectorCpcStatsCache = null;
  sectorCpcStatsCacheTime = 0;
}
