/**
 * Patent API Routes
 *
 * Serves patent data from the cached portfolio
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeAffiliate, getAllAffiliates } from '../utils/affiliate-normalizer.js';
import { getSuperSectorDisplayName, getAllSuperSectors } from '../utils/sector-mapper.js';
import { loadAllClassifications, scoreAllPatents, getDefaultProfileId } from '../services/scoring-service.js';

const prisma = new PrismaClient();

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Full LLM data loader (includes text fields beyond just numeric scores)
// ─────────────────────────────────────────────────────────────────────────────

interface FullLlmData {
  patent_id: string;
  // V1 attorney text fields
  summary?: string;
  prior_art_problem?: string;
  technical_solution?: string;
  // Legal viability scores
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  claim_clarity_score?: number;
  // Enforcement scores
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  evidence_accessibility_score?: number;
  // Market scores
  market_relevance_score?: number;
  trend_alignment_score?: number;
  // Investigation
  investigation_priority_score?: number;
  detection_method?: string;
  // Classification
  technology_category?: string;
  implementation_type?: string;
  standards_relevance?: string;
  market_segment?: string;
  implementation_complexity?: string;
  claim_type_primary?: string;
  geographic_scope?: string;
  lifecycle_stage?: string;
  // Arrays
  product_types?: string[];
  likely_implementers?: string[];
  standards_bodies?: string[];
  // Meta
  confidence?: number;
  source?: string;
  // Computed sub-scores
  legal_viability_score?: number;
  enforcement_potential_score?: number;
  market_value_score?: number;
}

let fullLlmCache: Map<string, FullLlmData> | null = null;
let fullLlmCacheLoadTime = 0;
const LLM_CACHE_TTL = 5 * 60 * 1000;

function loadAllFullLlmData(): Map<string, FullLlmData> {
  const now = Date.now();
  if (fullLlmCache && (now - fullLlmCacheLoadTime) < LLM_CACHE_TTL) {
    return fullLlmCache;
  }

  fullLlmCache = new Map();
  const llmDir = path.join(process.cwd(), 'cache/llm-scores');

  if (fs.existsSync(llmDir)) {
    const files = fs.readdirSync(llmDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(llmDir, file), 'utf-8'));
        fullLlmCache.set(data.patent_id, data);
      } catch {
        // skip invalid files
      }
    }
  }

  fullLlmCacheLoadTime = now;
  console.log(`[Patents] Loaded full LLM data for ${fullLlmCache.size} patents`);
  return fullLlmCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// CPC descriptions loader
// ─────────────────────────────────────────────────────────────────────────────

let cpcDescriptionsCache: Record<string, string> | null = null;

function loadCpcDescriptions(): Record<string, string> {
  if (cpcDescriptionsCache) return cpcDescriptionsCache;

  try {
    const configPath = path.join(process.cwd(), 'config/cpc-descriptions.json');
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cpcDescriptionsCache = data.codes || {};
  } catch {
    cpcDescriptionsCache = {};
  }

  return cpcDescriptionsCache!;
}

/**
 * Resolve CPC code to its description, trying progressively shorter prefixes
 */
function resolveCpcDescription(code: string): string | null {
  const descriptions = loadCpcDescriptions();

  // Try exact match first, then progressively shorter prefixes
  let lookup = code;
  while (lookup.length >= 3) {
    if (descriptions[lookup]) return descriptions[lookup];
    lookup = lookup.slice(0, -1);
  }

  return null;
}

// Types
interface RawPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  cpc_codes?: string[];
  sector?: string;
  super_sector?: string;
}

interface Patent extends RawPatent {
  affiliate: string;
  super_sector: string;
  primary_sector?: string;
  competitor_citations?: number;
  affiliate_citations?: number;
  neutral_citations?: number;
  competitor_count?: number;
  competitor_names?: string[];
  // Citation-aware scoring (Session 13)
  adjusted_forward_citations?: number;
  competitor_density?: number;
  has_citation_data?: boolean;
  // Computed scores
  v2_score?: number;
  v3_score?: number;
  // LLM data
  has_llm_data?: boolean;
  // Attorney text fields
  llm_summary?: string;
  llm_prior_art_problem?: string;
  llm_technical_solution?: string;
  // Classification
  llm_technology_category?: string;
  llm_implementation_type?: string;
  llm_standards_relevance?: string;
  llm_market_segment?: string;
  llm_detection_method?: string;
  llm_implementation_complexity?: string;
  llm_claim_type_primary?: string;
  llm_geographic_scope?: string;
  llm_lifecycle_stage?: string;
  // Numeric scores
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  claim_clarity_score?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  evidence_accessibility_score?: number;
  market_relevance_score?: number;
  trend_alignment_score?: number;
  investigation_priority_score?: number;
  llm_confidence?: number;
  // Computed sub-scores
  legal_viability_score?: number;
  enforcement_potential_score?: number;
  market_value_score?: number;
}

interface CandidatesFile {
  metadata: {
    totalPatents: number;
    activePatents: number;
    expiredPatents: number;
  };
  candidates: Patent[];
}

// V2 scoring defaults (same as scores.routes.ts)
const DEFAULT_V2_WEIGHTS = { citation: 50, years: 30, competitor: 20 };

/**
 * Calculate v2 score with default weights (same formula as scores.routes.ts)
 */
function calculateV2Score(forwardCitations: number, remainingYears: number, competitorCites: number): number {
  const totalWeight = DEFAULT_V2_WEIGHTS.citation + DEFAULT_V2_WEIGHTS.years + DEFAULT_V2_WEIGHTS.competitor;
  const citationNorm = DEFAULT_V2_WEIGHTS.citation / totalWeight;
  const yearsNorm = DEFAULT_V2_WEIGHTS.years / totalWeight;
  const competitorNorm = DEFAULT_V2_WEIGHTS.competitor / totalWeight;

  const citationScore = Math.log10(forwardCitations + 1) * 30 * citationNorm;
  const yearsScore = Math.min(remainingYears / 20, 1) * 100 * yearsNorm;
  const competitorScore = competitorCites * 15 * competitorNorm;

  return Math.round((citationScore + yearsScore + competitorScore) * 100) / 100;
}

// Cache the loaded data
let patentsCache: Patent[] | null = null;
let lastLoadTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear all patent-related caches (called from reload endpoint)
 */
export function clearPatentsCache(): void {
  patentsCache = null;
  lastLoadTime = 0;
  fullLlmCache = null;
  fullLlmCacheLoadTime = 0;
  cpcDescriptionsCache = null;
  console.log('[Patents] Caches cleared');
}

/**
 * Load patents from the candidates file and enrich with affiliate/sector
 */
function loadPatents(): Patent[] {
  const now = Date.now();

  // Return cached data if still valid
  if (patentsCache && (now - lastLoadTime) < CACHE_TTL) {
    return patentsCache;
  }

  // Find the most recent candidates file
  const outputDir = './output';
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No candidates file found. Run: npm run download:portfolio');
  }

  const filePath = path.join(outputDir, files[0]);
  console.log(`[Patents] Loading from: ${filePath}`);

  const data: CandidatesFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Load citation classifications
  const classifications = loadAllClassifications();

  // Load enrichment data
  const llmData = loadAllFullLlmData();

  // Load V3 scores (uses default profile)
  let v3ScoresMap: Map<string, number> = new Map();
  try {
    const v3Scored = scoreAllPatents(getDefaultProfileId());
    v3ScoresMap = new Map(v3Scored.map(s => [s.patent_id, s.score]));
  } catch (e) {
    console.warn('[Patents] Could not load v3 scores:', e);
  }

  // Enrich patents with affiliate, super_sector, citation classification, LLM data, and computed scores
  patentsCache = data.candidates.map((p: RawPatent): Patent => {
    const classification = classifications.get(p.patent_id);
    const llm = llmData.get(p.patent_id);
    const competitorCites = classification?.competitor_citations ?? 0;

    // Compute v2 score with default weights
    const v2Score = calculateV2Score(p.forward_citations, p.remaining_years, competitorCites);

    // Get pre-computed v3 score
    const v3Score = v3ScoresMap.get(p.patent_id) ?? 0;

    return {
      ...p,
      affiliate: normalizeAffiliate(p.assignee),
      super_sector: p.super_sector
        ? getSuperSectorDisplayName(p.super_sector)
        : (p.sector ? inferSuperSector(p.sector) : 'Unknown'),
      primary_sector: (p as any).primary_sector,
      competitor_citations: competitorCites,
      affiliate_citations: classification?.affiliate_citations ?? 0,
      neutral_citations: classification?.neutral_citations ?? 0,
      competitor_count: classification?.competitor_count ?? 0,
      competitor_names: classification?.competitor_names ?? [],
      // Citation-aware scoring (Session 13)
      adjusted_forward_citations: Math.round((
        competitorCites * 1.5 +
        (classification?.neutral_citations ?? 0) * 1.0 +
        (classification?.affiliate_citations ?? 0) * 0.25
      ) * 100) / 100,
      competitor_density: (() => {
        const cc = competitorCites;
        const nc = classification?.neutral_citations ?? 0;
        return (cc + nc) > 0 ? Math.round(cc / (cc + nc) * 1000) / 1000 : 0;
      })(),
      has_citation_data: classification?.has_citation_data ?? false,
      // Computed scores
      v2_score: v2Score,
      v3_score: v3Score,
      // LLM data
      has_llm_data: !!llm,
      // Attorney text fields
      llm_summary: llm?.summary,
      llm_prior_art_problem: llm?.prior_art_problem,
      llm_technical_solution: llm?.technical_solution,
      // Classification
      llm_technology_category: llm?.technology_category,
      llm_implementation_type: llm?.implementation_type,
      llm_standards_relevance: llm?.standards_relevance,
      llm_market_segment: llm?.market_segment,
      llm_detection_method: llm?.detection_method,
      llm_implementation_complexity: llm?.implementation_complexity,
      llm_claim_type_primary: llm?.claim_type_primary,
      llm_geographic_scope: llm?.geographic_scope,
      llm_lifecycle_stage: llm?.lifecycle_stage,
      // Numeric scores
      eligibility_score: llm?.eligibility_score,
      validity_score: llm?.validity_score,
      claim_breadth: llm?.claim_breadth,
      claim_clarity_score: llm?.claim_clarity_score,
      enforcement_clarity: llm?.enforcement_clarity,
      design_around_difficulty: llm?.design_around_difficulty,
      evidence_accessibility_score: llm?.evidence_accessibility_score,
      market_relevance_score: llm?.market_relevance_score,
      trend_alignment_score: llm?.trend_alignment_score,
      investigation_priority_score: llm?.investigation_priority_score,
      llm_confidence: llm?.confidence,
      // Computed sub-scores
      legal_viability_score: llm?.legal_viability_score,
      enforcement_potential_score: llm?.enforcement_potential_score,
      market_value_score: llm?.market_value_score,
    };
  });

  lastLoadTime = now;

  console.log(`[Patents] Loaded ${patentsCache.length} patents with affiliate/sector/citation/v2/v3 enrichment`);
  return patentsCache;
}

/**
 * Infer super-sector from primary sector name
 * This is a fallback when super_sector is not explicitly set
 */
function inferSuperSector(sector: string): string {
  // Try to load from super-sectors config
  try {
    const configPath = path.join(process.cwd(), 'config/super-sectors.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    for (const [superSectorKey, superSectorData] of Object.entries(config.superSectors) as [string, any][]) {
      if (superSectorData.sectors.includes(sector)) {
        return superSectorData.displayName;
      }
    }
  } catch (e) {
    // Config not found, return Unknown
  }

  return 'Unknown';
}

/**
 * Load abstract from PatentsView API cache
 */
function loadAbstract(patentId: string): string | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.patent_abstract || null;
    }
  } catch {
    // Cache file unreadable
  }
  return null;
}

/**
 * Apply filters to patents array
 */
function applyFilters(patents: Patent[], filters: Record<string, string | string[] | undefined>): Patent[] {
  let result = patents;

  // Search filter (searches patent_id, title, assignee, affiliate)
  if (filters.search) {
    const searchLower = (filters.search as string).toLowerCase();
    result = result.filter(p =>
      p.patent_id.toLowerCase().includes(searchLower) ||
      p.patent_title.toLowerCase().includes(searchLower) ||
      p.assignee.toLowerCase().includes(searchLower) ||
      p.affiliate.toLowerCase().includes(searchLower)
    );
  }

  // Affiliate filter (normalized entity names)
  if (filters.affiliates) {
    const affiliateList = Array.isArray(filters.affiliates)
      ? filters.affiliates
      : [filters.affiliates];
    result = result.filter(p =>
      affiliateList.some(a => p.affiliate.toLowerCase() === a.toLowerCase())
    );
  }

  // Assignee filter (raw USPTO names)
  if (filters.assignees) {
    const assigneeList = Array.isArray(filters.assignees)
      ? filters.assignees
      : [filters.assignees];
    result = result.filter(p =>
      assigneeList.some(a => p.assignee.toLowerCase().includes(a.toLowerCase()))
    );
  }

  // Super-sector filter
  if (filters.superSectors) {
    const sectorList = Array.isArray(filters.superSectors)
      ? filters.superSectors
      : [filters.superSectors];
    result = result.filter(p =>
      sectorList.some(s => p.super_sector.toLowerCase() === s.toLowerCase())
    );
  }

  // Date range filter
  if (filters.dateStart) {
    result = result.filter(p => p.patent_date >= filters.dateStart!);
  }
  if (filters.dateEnd) {
    result = result.filter(p => p.patent_date <= filters.dateEnd!);
  }

  // Score range filter (supports different score fields: score, v2_score, v3_score)
  const scoreField = (filters.scoreField as string) || 'score';
  if (filters.scoreMin) {
    const min = parseFloat(filters.scoreMin as string);
    result = result.filter(p => {
      const val = (p as any)[scoreField];
      return val !== undefined && val !== null && val >= min;
    });
  }
  if (filters.scoreMax) {
    const max = parseFloat(filters.scoreMax as string);
    result = result.filter(p => {
      const val = (p as any)[scoreField];
      return val !== undefined && val !== null && val <= max;
    });
  }

  // Remaining years filter
  if (filters.yearsMin) {
    const min = parseFloat(filters.yearsMin as string);
    result = result.filter(p => p.remaining_years >= min);
  }
  if (filters.yearsMax) {
    const max = parseFloat(filters.yearsMax as string);
    result = result.filter(p => p.remaining_years <= max);
  }

  // Primary sector filter (single or array)
  if (filters.primarySectors) {
    const sectorList = Array.isArray(filters.primarySectors)
      ? filters.primarySectors
      : [filters.primarySectors];
    result = result.filter(p =>
      sectorList.some(s => p.primary_sector === s)
    );
  } else if (filters.sector) {
    const sectorFilter = filters.sector as string;
    result = result.filter(p => p.primary_sector === sectorFilter);
  }

  // Competitor citations range filter
  if (filters.competitorCitesMin) {
    const min = parseFloat(filters.competitorCitesMin as string);
    result = result.filter(p => (p.competitor_citations ?? 0) >= min);
  }
  if (filters.competitorCitesMax) {
    const max = parseFloat(filters.competitorCitesMax as string);
    result = result.filter(p => (p.competitor_citations ?? 0) <= max);
  }

  // Forward citations range filter
  if (filters.forwardCitesMin) {
    const min = parseFloat(filters.forwardCitesMin as string);
    result = result.filter(p => p.forward_citations >= min);
  }
  if (filters.forwardCitesMax) {
    const max = parseFloat(filters.forwardCitesMax as string);
    result = result.filter(p => p.forward_citations <= max);
  }

  // Has competitor citations filter (legacy, subsumed by competitorCitesMin)
  if (filters.hasCompetitorCites === 'true') {
    result = result.filter(p => (p.competitor_citations ?? 0) > 0);
  }

  // Active only filter (remaining_years > 0, legacy, subsumed by yearsMin)
  if (filters.activeOnly === 'true') {
    result = result.filter(p => p.remaining_years > 0);
  }

  return result;
}

/**
 * Apply sorting to patents array
 */
function applySorting(patents: Patent[], sortBy: string, descending: boolean): Patent[] {
  const sorted = [...patents];

  sorted.sort((a, b) => {
    let aVal = (a as any)[sortBy];
    let bVal = (b as any)[sortBy];

    // Handle string comparison
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return descending
        ? bVal.localeCompare(aVal)
        : aVal.localeCompare(bVal);
    }

    // Handle numeric comparison
    aVal = aVal ?? 0;
    bVal = bVal ?? 0;
    return descending ? bVal - aVal : aVal - bVal;
  });

  return sorted;
}

/**
 * GET /api/patents/enrichment-summary
 * Portfolio enrichment coverage broken down by tier
 */
router.get('/enrichment-summary', (_req: Request, res: Response) => {
  try {
    const tierSize = Math.min(10000, Math.max(500, parseInt(_req.query.tierSize as string) || 5000));

    const patents = loadPatents();

    // Sort by score descending (same as the CLI script)
    const sorted = [...patents].sort((a, b) => b.score - a.score);

    // Load enrichment cache sets
    const llmDir = path.join(process.cwd(), 'cache/llm-scores');
    const prosDir = path.join(process.cwd(), 'cache/prosecution-scores');
    const iprDir = path.join(process.cwd(), 'cache/ipr-scores');
    const familyDir = path.join(process.cwd(), 'cache/patent-families/parents');

    function getCacheSet(dir: string): Set<string> {
      if (!fs.existsSync(dir)) return new Set();
      return new Set(
        fs.readdirSync(dir)
          .filter(f => f.endsWith('.json'))
          .map(f => f.replace('.json', ''))
      );
    }

    const llmSet = getCacheSet(llmDir);
    const prosSet = getCacheSet(prosDir);
    const iprSet = getCacheSet(iprDir);
    const familySet = getCacheSet(familyDir);

    // Helper functions
    function median(values: number[]): number {
      if (values.length === 0) return 0;
      const s = [...values].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    function avg(values: number[]): number {
      return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    }
    function sum(values: number[]): number {
      return values.reduce((s, v) => s + v, 0);
    }

    // Build tiers
    const tiers: Array<{
      tierLabel: string;
      count: number;
      scoreRange: string;
      expired: number;
      active3yr: number;
      yearsRemaining: { avg: number; median: number };
      forwardCitations: { avg: number; total: number };
      competitorCitations: { avg: number; total: number };
      enrichment: {
        llm: number; llmPct: number;
        prosecution: number; prosecutionPct: number;
        ipr: number; iprPct: number;
        family: number; familyPct: number;
      };
      topAffiliates: Array<{ name: string; count: number; pct: number }>;
      topSuperSectors: Array<{ name: string; count: number; pct: number }>;
    }> = [];

    for (let i = 0; i < sorted.length; i += tierSize) {
      const tierPatents = sorted.slice(i, i + tierSize);
      const tierNum = Math.floor(i / tierSize) + 1;
      const start = i + 1;
      const end = Math.min(i + tierSize, sorted.length);

      const ids = tierPatents.map(p => p.patent_id);
      const years = tierPatents.map(p => p.remaining_years ?? 0);
      const fc = tierPatents.map(p => p.forward_citations ?? 0);
      const cc = tierPatents.map(p => p.competitor_citations ?? 0);

      const llmCount = ids.filter(id => llmSet.has(id)).length;
      const prosCount = ids.filter(id => prosSet.has(id)).length;
      const iprCount = ids.filter(id => iprSet.has(id)).length;
      const familyCount = ids.filter(id => familySet.has(id)).length;

      // Affiliate breakdown
      const affCounts: Record<string, number> = {};
      for (const p of tierPatents) {
        affCounts[p.affiliate] = (affCounts[p.affiliate] || 0) + 1;
      }
      const topAffiliates = Object.entries(affCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({
          name, count,
          pct: Math.round(count / tierPatents.length * 1000) / 10
        }));

      // Super-sector breakdown
      const ssCounts: Record<string, number> = {};
      for (const p of tierPatents) {
        ssCounts[p.super_sector] = (ssCounts[p.super_sector] || 0) + 1;
      }
      const topSuperSectors = Object.entries(ssCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, count]) => ({
          name, count,
          pct: Math.round(count / tierPatents.length * 1000) / 10
        }));

      const scores = tierPatents.map(p => p.score);

      tiers.push({
        tierLabel: `Tier ${tierNum} (${start.toLocaleString()}–${end.toLocaleString()})`,
        count: tierPatents.length,
        scoreRange: `${scores[scores.length - 1]?.toFixed(1) ?? '?'} – ${scores[0]?.toFixed(1) ?? '?'}`,
        expired: tierPatents.filter(p => (p.remaining_years ?? 0) <= 0).length,
        active3yr: tierPatents.filter(p => (p.remaining_years ?? 0) >= 3).length,
        yearsRemaining: {
          avg: Math.round(avg(years) * 10) / 10,
          median: Math.round(median(years) * 10) / 10,
        },
        forwardCitations: {
          avg: Math.round(avg(fc) * 10) / 10,
          total: sum(fc),
        },
        competitorCitations: {
          avg: Math.round(avg(cc) * 10) / 10,
          total: sum(cc),
        },
        enrichment: {
          llm: llmCount,
          llmPct: Math.round(llmCount / tierPatents.length * 1000) / 10,
          prosecution: prosCount,
          prosecutionPct: Math.round(prosCount / tierPatents.length * 1000) / 10,
          ipr: iprCount,
          iprPct: Math.round(iprCount / tierPatents.length * 1000) / 10,
          family: familyCount,
          familyPct: Math.round(familyCount / tierPatents.length * 1000) / 10,
        },
        topAffiliates,
        topSuperSectors,
      });
    }

    res.json({
      totalPatents: sorted.length,
      tierSize,
      enrichmentTotals: {
        llm: llmSet.size,
        prosecution: prosSet.size,
        ipr: iprSet.size,
        family: familySet.size,
      },
      tiers,
    });
  } catch (error) {
    console.error('Error computing enrichment summary:', error);
    res.status(500).json({ error: 'Failed to compute enrichment summary' });
  }
});

/**
 * GET /api/patents
 * List patents with pagination, filtering, and sorting
 * Optional: focusAreaId query param to filter to a focus area's patents
 *   and merge membership metadata (fa_membership_type, fa_match_score)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '50',
      sortBy = 'score',
      descending = 'true',
      focusAreaId,
      ...filters
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string)));
    const isDescending = descending === 'true';

    // Load and filter patents
    let patents = loadPatents();

    // Focus-area scoping: restrict to patents in the focus area
    let faMetadata: Map<string, { membershipType: string; matchScore: number | null }> | null = null;
    if (focusAreaId && typeof focusAreaId === 'string') {
      const faPatents = await prisma.focusAreaPatent.findMany({
        where: { focusAreaId: focusAreaId },
        select: { patentId: true, membershipType: true, matchScore: true }
      });
      faMetadata = new Map(
        faPatents.map(fp => [fp.patentId, { membershipType: fp.membershipType, matchScore: fp.matchScore }])
      );
      const faPatentIds = new Set(faPatents.map(fp => fp.patentId));
      patents = patents.filter(p => faPatentIds.has(p.patent_id));
    }

    patents = applyFilters(patents, filters as Record<string, string>);

    // Get total before pagination
    const total = patents.length;

    // Sort
    patents = applySorting(patents, sortBy as string, isDescending);

    // Paginate
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedPatents = patents.slice(startIndex, startIndex + limitNum);

    // Merge focus-area metadata if present
    const data = faMetadata
      ? paginatedPatents.map(p => {
          const meta = faMetadata!.get(p.patent_id);
          return {
            ...p,
            fa_membership_type: meta?.membershipType ?? null,
            fa_match_score: meta?.matchScore ?? null
          };
        })
      : paginatedPatents;

    res.json({
      data,
      total,
      page: pageNum,
      rowsPerPage: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (error) {
    console.error('Error loading patents:', error);
    res.status(500).json({ error: 'Failed to load patents' });
  }
});

/**
 * GET /api/patents/stats
 * Get portfolio statistics
 */
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const patents = loadPatents();

    // Calculate statistics
    const active = patents.filter(p => p.remaining_years > 0);
    const expired = patents.filter(p => p.remaining_years <= 0);

    // Group by affiliate (normalized entity)
    const affiliateCounts: Record<string, number> = {};
    patents.forEach(p => {
      affiliateCounts[p.affiliate] = (affiliateCounts[p.affiliate] || 0) + 1;
    });

    // Top affiliates
    const topAffiliates = Object.entries(affiliateCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Group by super-sector
    const superSectorCounts: Record<string, number> = {};
    patents.forEach(p => {
      superSectorCounts[p.super_sector] = (superSectorCounts[p.super_sector] || 0) + 1;
    });

    // Super-sector breakdown
    const bySuperSector = Object.entries(superSectorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // Legacy: top assignees for backward compatibility
    const assigneeCounts: Record<string, number> = {};
    patents.forEach(p => {
      const assignee = p.assignee.split(',')[0].trim();
      assigneeCounts[assignee] = (assigneeCounts[assignee] || 0) + 1;
    });
    const topAssignees = Object.entries(assigneeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    res.json({
      total: patents.length,
      active: active.length,
      expired: expired.length,
      topAffiliates,
      topAssignees, // Legacy, kept for backward compatibility
      bySuperSector,
      dateRange: {
        oldest: patents[patents.length - 1]?.patent_date,
        newest: patents[0]?.patent_date
      }
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * GET /api/patents/affiliates
 * Get list of affiliates (normalized entities) with patent counts
 */
router.get('/affiliates', (_req: Request, res: Response) => {
  try {
    const patents = loadPatents();

    const affiliateCounts: Record<string, number> = {};
    patents.forEach(p => {
      affiliateCounts[p.affiliate] = (affiliateCounts[p.affiliate] || 0) + 1;
    });

    const affiliates = Object.entries(affiliateCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    res.json(affiliates);
  } catch (error) {
    console.error('Error getting affiliates:', error);
    res.status(500).json({ error: 'Failed to get affiliates' });
  }
});

/**
 * GET /api/patents/super-sectors
 * Get list of super-sectors with patent counts
 */
router.get('/super-sectors', (_req: Request, res: Response) => {
  try {
    const patents = loadPatents();

    const sectorCounts: Record<string, number> = {};
    patents.forEach(p => {
      sectorCounts[p.super_sector] = (sectorCounts[p.super_sector] || 0) + 1;
    });

    const superSectors = Object.entries(sectorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    res.json(superSectors);
  } catch (error) {
    console.error('Error getting super-sectors:', error);
    res.status(500).json({ error: 'Failed to get super-sectors' });
  }
});

/**
 * GET /api/patents/primary-sectors
 * Get list of primary sectors with patent counts
 */
router.get('/primary-sectors', (_req: Request, res: Response) => {
  try {
    const patents = loadPatents();

    const sectorCounts: Record<string, number> = {};
    patents.forEach(p => {
      const sector = p.primary_sector || 'unknown';
      sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    });

    const sectors = Object.entries(sectorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    res.json(sectors);
  } catch (error) {
    console.error('Error getting primary sectors:', error);
    res.status(500).json({ error: 'Failed to get primary sectors' });
  }
});

/**
 * GET /api/patents/assignees
 * Get list of unique assignees (raw USPTO names) for filtering
 */
router.get('/assignees', (_req: Request, res: Response) => {
  try {
    const patents = loadPatents();

    const assigneeCounts: Record<string, number> = {};
    patents.forEach(p => {
      assigneeCounts[p.assignee] = (assigneeCounts[p.assignee] || 0) + 1;
    });

    const assignees = Object.entries(assigneeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    res.json(assignees);
  } catch (error) {
    console.error('Error getting assignees:', error);
    res.status(500).json({ error: 'Failed to get assignees' });
  }
});

/**
 * GET /api/patents/cpc-descriptions
 * Get CPC code descriptions mapping
 * Optional query param: codes=G06F,H04L (comma-separated) for specific codes
 */
router.get('/cpc-descriptions', (req: Request, res: Response) => {
  try {
    const descriptions = loadCpcDescriptions();
    const { codes } = req.query;

    if (codes) {
      // Return only requested codes with resolved descriptions
      const codeList = (codes as string).split(',').map(c => c.trim());
      const resolved: Record<string, string | null> = {};
      for (const code of codeList) {
        resolved[code] = resolveCpcDescription(code);
      }
      res.json(resolved);
    } else {
      res.json(descriptions);
    }
  } catch (error) {
    console.error('Error getting CPC descriptions:', error);
    res.status(500).json({ error: 'Failed to get CPC descriptions' });
  }
});

/**
 * POST /api/patents/batch-preview
 * Get preview data for multiple patents at once
 * Body: { patentIds: string[] }
 */
router.post('/batch-preview', (req: Request, res: Response) => {
  try {
    const { patentIds } = req.body;

    if (!Array.isArray(patentIds)) {
      return res.status(400).json({ error: 'patentIds must be an array' });
    }

    // Limit to 100 patents per request
    const limitedIds = patentIds.slice(0, 100);
    const patents = loadPatents();

    const previews: Record<string, PatentPreview | null> = {};
    const patentMap = new Map(patents.map(p => [p.patent_id, p]));

    for (const id of limitedIds) {
      const patent = patentMap.get(id);
      if (patent) {
        previews[id] = {
          patent_id: patent.patent_id,
          patent_title: patent.patent_title,
          abstract: loadAbstract(patent.patent_id),
          patent_date: patent.patent_date,
          assignee: patent.assignee,
          affiliate: patent.affiliate,
          super_sector: patent.super_sector,
          primary_sector: patent.primary_sector,
          cpc_codes: (patent as any).cpc_codes || [],
          forward_citations: patent.forward_citations,
          remaining_years: patent.remaining_years,
          score: patent.score,
          competitor_citations: patent.competitor_citations,
          affiliate_citations: patent.affiliate_citations,
          neutral_citations: patent.neutral_citations,
          competitor_count: patent.competitor_count,
          competitor_names: patent.competitor_names,
          adjusted_forward_citations: patent.adjusted_forward_citations,
          competitor_density: patent.competitor_density,
        };
      } else {
        previews[id] = null;
      }
    }

    res.json({ previews });
  } catch (error) {
    console.error('Error getting batch previews:', error);
    res.status(500).json({ error: 'Failed to get batch previews' });
  }
});

interface PatentPreview {
  patent_id: string;
  patent_title: string;
  abstract?: string | null;
  patent_date: string;
  assignee: string;
  affiliate: string;
  super_sector: string;
  primary_sector?: string;
  cpc_codes: string[];
  forward_citations: number;
  remaining_years: number;
  score: number;
  competitor_citations?: number;
  affiliate_citations?: number;
  neutral_citations?: number;
  competitor_count?: number;
  competitor_names?: string[];
  adjusted_forward_citations?: number;
  competitor_density?: number;
}

/**
 * GET /api/patents/export
 * Export filtered patents as CSV.
 * Accepts same filter params as GET /api/patents.
 * Additionally accepts `columns` (comma-separated field names) to control output.
 * Returns all matching patents (no pagination).
 */
router.get('/export', (req: Request, res: Response) => {
  try {
    const {
      sortBy = 'score',
      descending = 'true',
      columns: columnParam,
      ...filters
    } = req.query;

    const isDescending = descending === 'true';

    // Load, filter, sort
    let patents = loadPatents();
    patents = applyFilters(patents, filters as Record<string, string>);
    patents = applySorting(patents, sortBy as string, isDescending);

    // Determine columns to export
    const allColumns = [
      { field: 'patent_id', label: 'Patent ID' },
      { field: 'patent_title', label: 'Title' },
      { field: 'patent_date', label: 'Grant Date' },
      { field: 'remaining_years', label: 'Years Left' },
      { field: 'affiliate', label: 'Affiliate' },
      { field: 'super_sector', label: 'Super-Sector' },
      { field: 'primary_sector', label: 'Primary Sector' },
      { field: 'assignee', label: 'Assignee (Raw)' },
      { field: 'forward_citations', label: 'Fwd Citations' },
      { field: 'competitor_citations', label: 'Competitor Cites' },
      { field: 'affiliate_citations', label: 'Affiliate Cites' },
      { field: 'neutral_citations', label: 'Neutral Cites' },
      { field: 'competitor_count', label: 'Competitors' },
      { field: 'competitor_names', label: 'Competitor Names' },
      { field: 'adjusted_forward_citations', label: 'Adj. Fwd Cites' },
      { field: 'competitor_density', label: 'Comp. Density' },
      { field: 'score', label: 'Base Score' },
      { field: 'v2_score', label: 'v2 Score' },
      { field: 'v3_score', label: 'v3 Score' },
      { field: 'consensus_score', label: 'Consensus' },
      { field: 'cpc_codes', label: 'CPC Codes' },
      { field: 'eligibility_score', label: 'Eligibility' },
      { field: 'validity_score', label: 'Validity' },
      { field: 'claim_breadth', label: 'Claim Breadth' },
      { field: 'enforcement_clarity', label: 'Enforcement Clarity' },
      { field: 'design_around_difficulty', label: 'Design-Around' },
      { field: 'claim_clarity_score', label: 'Claim Clarity' },
      { field: 'evidence_accessibility_score', label: 'Evidence Access' },
      { field: 'market_relevance_score', label: 'Market Relevance' },
      { field: 'trend_alignment_score', label: 'Trend Alignment' },
      { field: 'investigation_priority_score', label: 'Investigation Priority' },
      { field: 'llm_confidence', label: 'LLM Confidence' },
      { field: 'legal_viability_score', label: 'Legal Viability' },
      { field: 'enforcement_potential_score', label: 'Enforcement Potential' },
      { field: 'market_value_score', label: 'Market Value' },
      { field: 'has_llm_data', label: 'Has LLM Data' },
      { field: 'llm_summary', label: 'LLM Summary' },
      { field: 'llm_technology_category', label: 'Tech Category' },
      { field: 'llm_implementation_type', label: 'Implementation' },
      { field: 'llm_standards_relevance', label: 'Standards' },
      { field: 'llm_market_segment', label: 'Market Segment' },
      { field: 'llm_detection_method', label: 'Detection Method' },
    ];

    let exportColumns = allColumns;
    if (columnParam && typeof columnParam === 'string') {
      const requestedFields = columnParam.split(',').map(s => s.trim());
      exportColumns = requestedFields.map(field => {
        const known = allColumns.find(c => c.field === field);
        return known || { field, label: field };
      });
    }

    // Build CSV
    function escapeCSV(val: unknown): string {
      if (val === null || val === undefined) return '';
      if (Array.isArray(val)) return `"${val.join('; ')}"`;
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const header = exportColumns.map(c => escapeCSV(c.label)).join(',');
    const rows = patents.map(patent => {
      return exportColumns.map(col => {
        const value = (patent as Record<string, unknown>)[col.field];
        return escapeCSV(value);
      }).join(',');
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="patent-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting patents:', error);
    res.status(500).json({ error: 'Failed to export patents' });
  }
});

/**
 * GET /api/patents/:id/preview
 * Get lightweight preview data for a single patent
 */
router.get('/:id/preview', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patents = loadPatents();

    const patent = patents.find(p => p.patent_id === id);
    if (!patent) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    const preview: PatentPreview = {
      patent_id: patent.patent_id,
      patent_title: patent.patent_title,
      abstract: loadAbstract(patent.patent_id),
      patent_date: patent.patent_date,
      assignee: patent.assignee,
      affiliate: patent.affiliate,
      super_sector: patent.super_sector,
      primary_sector: patent.primary_sector,
      cpc_codes: (patent as any).cpc_codes || [],
      forward_citations: patent.forward_citations,
      remaining_years: patent.remaining_years,
      score: patent.score,
      competitor_citations: patent.competitor_citations,
      affiliate_citations: patent.affiliate_citations,
      neutral_citations: patent.neutral_citations,
      competitor_count: patent.competitor_count,
      competitor_names: patent.competitor_names,
      adjusted_forward_citations: patent.adjusted_forward_citations,
      competitor_density: patent.competitor_density,
    };

    res.json(preview);
  } catch (error) {
    console.error('Error getting patent preview:', error);
    res.status(500).json({ error: 'Failed to get patent preview' });
  }
});

/**
 * GET /api/patents/:id
 * Get single patent details
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patents = loadPatents();

    const patent = patents.find(p => p.patent_id === id);
    if (!patent) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    // Enrich with abstract from cache
    const abstract = loadAbstract(id);
    res.json({ ...patent, abstract });
  } catch (error) {
    console.error('Error getting patent:', error);
    res.status(500).json({ error: 'Failed to get patent' });
  }
});

/**
 * GET /api/patents/:id/citations
 * Get citation data for a patent (from cache)
 */
router.get('/:id/citations', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Load forward citations from cache
    const fwdCachePath = `./cache/api/patentsview/forward-citations/${id}.json`;
    const classificationPath = `./cache/citation-classification/${id}.json`;

    const forwardCitations = fs.existsSync(fwdCachePath)
      ? JSON.parse(fs.readFileSync(fwdCachePath, 'utf-8'))
      : null;

    const classification = fs.existsSync(classificationPath)
      ? JSON.parse(fs.readFileSync(classificationPath, 'utf-8'))
      : null;

    if (!forwardCitations) {
      res.json({
        patent_id: id,
        cached: false,
        total_hits: 0,
        citing_patent_ids: [],
        citing_patents: [],
        message: 'Forward citations not yet cached for this patent.',
        classification,
      });
      return;
    }

    // Look up patent details for citing patent IDs from the candidates cache
    const allPatents = loadPatents();
    const patentMap = new Map(allPatents.map(p => [p.patent_id, p]));

    const citingPatentIds: string[] = forwardCitations.citing_patent_ids || [];
    const citingPatents = citingPatentIds.map(citingId => {
      const p = patentMap.get(citingId);
      return {
        patent_id: citingId,
        patent_title: p?.patent_title || '',
        assignee: p?.assignee || '',
        patent_date: p?.patent_date || '',
        affiliate: p ? normalizeAffiliate(p.assignee) : '',
        in_portfolio: !!p,
      };
    });

    // Classify citing patents using classification data
    const competitorDetails = classification?.competitor_details || [];

    res.json({
      patent_id: id,
      cached: true,
      total_hits: forwardCitations.total_hits || citingPatentIds.length,
      citing_patent_ids: citingPatentIds,
      citing_patents: citingPatents,
      classification: classification ? {
        competitor_citations: classification.competitor_citations || 0,
        affiliate_citations: classification.affiliate_citations || 0,
        neutral_citations: classification.neutral_citations || 0,
        competitor_count: classification.competitor_count || 0,
        competitor_names: classification.competitor_names || [],
        competitor_details: competitorDetails,
      } : null,
    });
  } catch (error) {
    console.error('Error getting citations:', error);
    res.status(500).json({ error: 'Failed to get citations' });
  }
});

/**
 * GET /api/patents/:id/prosecution
 * Get prosecution history data for a patent (from cache)
 */
router.get('/:id/prosecution', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cachePath = `./cache/prosecution-scores/${id}.json`;

    if (!fs.existsSync(cachePath)) {
      res.json({
        patent_id: id,
        cached: false,
        message: 'Prosecution history not yet retrieved for this patent.',
      });
      return;
    }

    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    res.json({
      patent_id: id,
      cached: true,
      ...data,
    });
  } catch (error) {
    console.error('Error getting prosecution data:', error);
    res.status(500).json({ error: 'Failed to get prosecution data' });
  }
});

/**
 * GET /api/patents/:id/ptab
 * Get PTAB/IPR data for a patent (from cache)
 */
router.get('/:id/ptab', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cachePath = `./cache/ipr-scores/${id}.json`;

    if (!fs.existsSync(cachePath)) {
      res.json({
        patent_id: id,
        cached: false,
        message: 'IPR/PTAB data not yet retrieved for this patent.',
      });
      return;
    }

    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    res.json({
      patent_id: id,
      cached: true,
      ...data,
    });
  } catch (error) {
    console.error('Error getting PTAB data:', error);
    res.status(500).json({ error: 'Failed to get PTAB data' });
  }
});

/**
 * GET /api/patents/:id/llm
 * Get full LLM analysis data for a patent (from cache)
 */
router.get('/:id/llm', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cachePath = path.join(process.cwd(), 'cache/llm-scores', `${id}.json`);

    if (!fs.existsSync(cachePath)) {
      res.json({
        patent_id: id,
        cached: false,
        message: 'LLM analysis not yet available for this patent.',
      });
      return;
    }

    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    res.json({
      patent_id: id,
      cached: true,
      ...data,
    });
  } catch (error) {
    console.error('Error getting LLM data:', error);
    res.status(500).json({ error: 'Failed to get LLM data' });
  }
});

/**
 * GET /api/patents/:id/backward-citations
 * Get backward citations (parent patents) for a patent
 * Sources: cache/patent-families/parents/ and cache/patent-families/parent-details/
 */
router.get('/:id/backward-citations', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Load parent patent IDs
    const parentsPath = path.join(process.cwd(), 'cache/patent-families/parents', `${id}.json`);
    if (!fs.existsSync(parentsPath)) {
      res.json({
        patent_id: id,
        cached: false,
        parent_count: 0,
        parent_patents: [],
        message: 'Backward citation data not yet cached for this patent.',
      });
      return;
    }

    const parentsData = JSON.parse(fs.readFileSync(parentsPath, 'utf-8'));
    const parentIds: string[] = parentsData.parent_patent_ids || [];

    // Load portfolio data for in_portfolio checking
    const allPatents = loadPatents();
    const patentMap = new Map(allPatents.map(p => [p.patent_id, p]));

    // Enrich parent patents with details
    const parentPatents = parentIds.map(parentId => {
      // Check if parent is in portfolio
      const portfolioPatent = patentMap.get(parentId);

      // Try to load parent details from cache
      const detailPath = path.join(process.cwd(), 'cache/patent-families/parent-details', `${parentId}.json`);
      let details: any = null;
      if (fs.existsSync(detailPath)) {
        try {
          details = JSON.parse(fs.readFileSync(detailPath, 'utf-8'));
        } catch { /* skip */ }
      }

      return {
        patent_id: parentId,
        patent_title: portfolioPatent?.patent_title || details?.patent_title || '',
        assignee: portfolioPatent?.assignee || details?.assignee || '',
        patent_date: portfolioPatent?.patent_date || details?.patent_date || '',
        affiliate: portfolioPatent ? normalizeAffiliate(portfolioPatent.assignee) : '',
        in_portfolio: !!portfolioPatent,
      };
    });

    res.json({
      patent_id: id,
      cached: true,
      parent_count: parentIds.length,
      parent_patents: parentPatents,
    });
  } catch (error) {
    console.error('Error getting backward citations:', error);
    res.status(500).json({ error: 'Failed to get backward citations' });
  }
});

export default router;
