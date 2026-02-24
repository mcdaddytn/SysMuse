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
import { loadAllClassifications } from '../services/scoring-service.js';
import { resolvePatent, resolvePatents, resolvePatentPreview, hasPatentData, registerPortfolioLoader } from '../services/patent-fetch-service.js';
import { enrichCandidatesWithCpcDesignation, parsePatentXml, analyzeCpcCooccurrence, findXmlPath } from '../services/patent-xml-parser-service.js';
import * as patentDataService from '../services/patent-data-service.js';
import { repairEnrichmentFlags } from './batch-jobs.routes.js';
import type { PatentFilters, PaginationOptions } from '../services/patent-data-service.js';
import { getActiveSnapshotScores } from './scores.routes.js';

const prisma = new PrismaClient();

const router = Router();

// Pre-load super-sector lookup at module init (async, non-blocking)
// This ensures the cache is warm before loadPatents() needs it synchronously.
loadSuperSectorLookup().catch(() => {});

// ─────────────────────────────────────────────────────────────────────────────
// Active Snapshot Score Cache
// ─────────────────────────────────────────────────────────────────────────────

// Cache for active snapshot scores (loaded from database)
let snapshotV2Scores: Map<string, number> | null = null;
let snapshotV3Scores: Map<string, number> | null = null;
let snapshotScoreCacheExpiry = 0;
const SNAPSHOT_SCORE_CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Load active V2 snapshot scores from database
 */
async function loadActiveV2SnapshotScores(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const activeSnapshot = await prisma.scoreSnapshot.findFirst({
    where: { scoreType: 'V2', isActive: true },
    select: { id: true },
  });

  if (activeSnapshot) {
    const scores = await prisma.patentScoreEntry.findMany({
      where: { snapshotId: activeSnapshot.id },
      select: { patentId: true, score: true },
    });
    for (const s of scores) {
      map.set(s.patentId, s.score);
    }
    console.log(`[Patents] Loaded ${map.size} V2 snapshot scores`);
  }

  return map;
}

/**
 * Load active V3 snapshot scores from database
 */
async function loadActiveV3SnapshotScores(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  const activeSnapshot = await prisma.scoreSnapshot.findFirst({
    where: { scoreType: 'V3', isActive: true },
    select: { id: true },
  });

  if (activeSnapshot) {
    const scores = await prisma.patentScoreEntry.findMany({
      where: { snapshotId: activeSnapshot.id },
      select: { patentId: true, score: true },
    });
    for (const s of scores) {
      map.set(s.patentId, s.score);
    }
    console.log(`[Patents] Loaded ${map.size} V3 snapshot scores`);
  }

  return map;
}

/**
 * Preload active snapshot scores (call at startup and when caches are cleared)
 */
export async function preloadSnapshotScores(): Promise<void> {
  try {
    const [v2, v3] = await Promise.all([
      loadActiveV2SnapshotScores(),
      loadActiveV3SnapshotScores(),
    ]);
    snapshotV2Scores = v2;
    snapshotV3Scores = v3;
    snapshotScoreCacheExpiry = Date.now() + SNAPSHOT_SCORE_CACHE_TTL;
    console.log(`[Patents] Snapshot scores preloaded: V2=${v2.size}, V3=${v3.size}`);
  } catch (err) {
    console.error('[Patents] Failed to preload snapshot scores:', err);
  }
}

/**
 * Clear snapshot score cache (call when snapshots are modified)
 */
export function clearSnapshotScoreCache(): void {
  snapshotV2Scores = null;
  snapshotV3Scores = null;
  snapshotScoreCacheExpiry = 0;
  console.log('[Patents] Snapshot score cache cleared');
}

/**
 * Clear snapshot score cache AND reload from DB (awaitable).
 * Call from save/activate/deactivate endpoints to ensure fresh scores
 * are available before responding. Also invalidates the patents cache
 * so the next loadPatents() call rebuilds with fresh scores.
 */
export async function clearAndReloadSnapshotScores(): Promise<void> {
  clearSnapshotScoreCache();
  patentsCache = null;
  lastLoadTime = 0;
  await preloadSnapshotScores();
}

/**
 * Get cached snapshot scores (returns null if not loaded or expired)
 */
function getSnapshotScores(): { v2: Map<string, number> | null; v3: Map<string, number> | null } {
  const now = Date.now();
  if (now > snapshotScoreCacheExpiry) {
    // Cache expired, trigger async refresh but return current (possibly stale) data
    preloadSnapshotScores().catch(console.error);
  }
  return { v2: snapshotV2Scores, v3: snapshotV3Scores };
}

// Preload snapshot scores at module load
preloadSnapshotScores().catch(console.error);

// ─────────────────────────────────────────────────────────────────────────────
// Enrichment cache invalidation
// All enrichment flags are now DB-backed (hasLlmData, hasProsecutionData,
// hasXmlData, hasIprData, hasFamilyData). Directory scanning was removed.
// This function is kept for callers that signal enrichment data has changed.
// ─────────────────────────────────────────────────────────────────────────────

// Export for cache invalidation from other routes
export function invalidateEnrichmentCache(): void {
  console.log('[Patents] Enrichment cache invalidated');
}

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

// Cache the loaded data
let patentsCache: Patent[] | null = null;
let lastLoadTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Clear all patent-related caches (called from reload endpoint and snapshot operations)
 */
export async function clearPatentsCache(): Promise<void> {
  patentsCache = null;
  lastLoadTime = 0;
  fullLlmCache = null;
  fullLlmCacheLoadTime = 0;
  cpcDescriptionsCache = null;
  // Clear snapshot score cache and reload from DB before returning
  await clearAndReloadSnapshotScores();
  console.log('[Patents] Caches cleared');
}

/**
 * Load patents from the candidates file and enrich with affiliate/sector
 */
export function loadPatents(): Patent[] {
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

  // Get snapshot scores (from active database snapshots if available)
  // V2 and V3 scores require active snapshots - no fallback computation
  // Patents without snapshot scores show 0 and fall to bottom when sorting
  const snapshotScores = getSnapshotScores();
  const hasV2Snapshot = snapshotScores.v2 && snapshotScores.v2.size > 0;
  const hasV3Snapshot = snapshotScores.v3 && snapshotScores.v3.size > 0;

  if (hasV2Snapshot) {
    console.log(`[Patents] Using active V2 snapshot scores (${snapshotScores.v2!.size} patents)`);
  }
  if (hasV3Snapshot) {
    console.log(`[Patents] Using active V3 snapshot scores (${snapshotScores.v3!.size} patents)`);
  }

  // Enrich patents with affiliate, super_sector, citation classification, LLM data, and computed scores
  patentsCache = data.candidates.map((p: RawPatent): Patent => {
    const classification = classifications.get(p.patent_id);
    const llm = llmData.get(p.patent_id);
    const competitorCites = classification?.competitor_citations ?? 0;

    // Get V2 score from snapshot only (no fallback - patents without V2 Enhanced scores show 0)
    const v2Score = hasV2Snapshot && snapshotScores.v2!.has(p.patent_id)
      ? snapshotScores.v2!.get(p.patent_id)!
      : 0;

    // Get V3 score from snapshot only (no fallback - patents without V3 scores show 0)
    const v3Score = hasV3Snapshot && snapshotScores.v3!.has(p.patent_id)
      ? snapshotScores.v3!.get(p.patent_id)!
      : 0;

    return {
      ...p,
      affiliate: normalizeAffiliate(p.assignee),
      super_sector: p.super_sector
        ? resolveSuperSectorDisplay(p.super_sector)
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

  const scoreSource = hasV2Snapshot || hasV3Snapshot
    ? ` (V2:${hasV2Snapshot ? 'snapshot' : 'calc'}, V3:${hasV3Snapshot ? 'snapshot' : 'calc'})`
    : '';
  console.log(`[Patents] Loaded ${patentsCache.length} patents with affiliate/sector/citation/v2/v3 enrichment${scoreSource}`);
  return patentsCache;
}

// Register portfolio loader with patent-fetch-service for cross-module access
registerPortfolioLoader(loadPatents);

// ─── DB-cached super-sector lookup (replaces config reads) ──────────────────

let superSectorLookupCache: {
  nameToDisplay: Map<string, string>;     // canonical → display
  sectorToSuperDisplay: Map<string, string>; // sector name → super-sector display name
} | null = null;
let superSectorLookupTime = 0;
const SUPER_SECTOR_CACHE_TTL = 60_000; // 1 minute

async function loadSuperSectorLookup() {
  const now = Date.now();
  if (superSectorLookupCache && (now - superSectorLookupTime) < SUPER_SECTOR_CACHE_TTL) {
    return superSectorLookupCache;
  }
  const superSectors = await prisma.superSector.findMany({
    include: { sectors: { select: { name: true } } },
  });
  const nameToDisplay = new Map<string, string>();
  const sectorToSuperDisplay = new Map<string, string>();
  for (const ss of superSectors) {
    nameToDisplay.set(ss.name, ss.displayName);
    for (const s of ss.sectors) {
      sectorToSuperDisplay.set(s.name, ss.displayName);
    }
  }
  superSectorLookupCache = { nameToDisplay, sectorToSuperDisplay };
  superSectorLookupTime = now;
  return superSectorLookupCache;
}

/**
 * Resolve any super-sector value (canonical or display) to display name.
 * Sync — uses the pre-loaded cache from loadSuperSectorLookup().
 */
function resolveSuperSectorDisplay(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  if (!superSectorLookupCache) return value;
  // Try canonical → display
  const display = superSectorLookupCache.nameToDisplay.get(value);
  if (display) return display;
  // Already a display name? Check if it's a known value
  for (const d of superSectorLookupCache.nameToDisplay.values()) {
    if (d === value) return value;
  }
  return value;
}

/**
 * Infer super-sector display name from a primary sector name.
 * Uses DB-cached lookup.
 */
function inferSuperSector(sector: string): string {
  if (!superSectorLookupCache) return 'Unknown';
  return superSectorLookupCache.sectorToSuperDisplay.get(sector) || 'Unknown';
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
 * GET /api/patents/enrichment-summary
 * Portfolio enrichment coverage broken down by tier
 */
router.get('/enrichment-summary', async (_req: Request, res: Response) => {
  try {
    const tierSize = Math.min(10000, Math.max(500, parseInt(_req.query.tierSize as string) || 5000));
    const portfolioId = _req.query.portfolioId as string | undefined;
    const forceRefresh = _req.query.forceRefresh === 'true';

    // When forceRefresh, sync DB flags from file cache first
    if (forceRefresh) {
      await repairEnrichmentFlags();
    }

    const patents = await patentDataService.getPatentsForEnrichment(portfolioId);

    // Sort by score descending, then by grant date descending (newest first as tiebreaker)
    // This matches the sort order used in analyzeGaps() for consistent tier assignment
    const sorted = [...patents].sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      // When scores are equal (including both 0/null), sort by grant date descending
      const da = a.grant_date || '';
      const db = b.grant_date || '';
      return db.localeCompare(da);
    });

    // IPR/family now use DB flags (hasIprData, hasFamilyData) — no dir scans needed

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
        xml: number; xmlPct: number;
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

      // All enrichment flags now from Postgres
      // LLM: use quarantine to exclude LLM-ineligible patents (no abstract, no sector)
      const llmEligible = tierPatents.filter(p => !(p.quarantine as any)?.llm);
      const llmCount = llmEligible.filter(p => p.has_llm_data).length;
      const llmDenominator = llmEligible.length || 1;
      const prosCount = tierPatents.filter(p => p.has_prosecution_data).length;
      const iprCount = tierPatents.filter(p => p.has_ipr_data).length;
      const familyCount = tierPatents.filter(p => p.has_family_data).length;
      // XML: use quarantine to exclude ineligible patents
      const xmlEligible = tierPatents.filter(p => !(p.quarantine as any)?.xml);
      const xmlCount = xmlEligible.filter(p => p.has_xml_data).length;
      const xmlDenominator = xmlEligible.length || 1; // avoid division by zero
      const tierQuarantineCounts = {
        total: tierPatents.filter(p => p.is_quarantined).length,
        xml: tierPatents.filter(p => (p.quarantine as any)?.xml).length,
        llm: tierPatents.filter(p => (p.quarantine as any)?.llm).length,
      };

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
          llmPct: Math.round(llmCount / llmDenominator * 1000) / 10,
          prosecution: prosCount,
          prosecutionPct: Math.round(prosCount / tierPatents.length * 1000) / 10,
          ipr: iprCount,
          iprPct: Math.round(iprCount / tierPatents.length * 1000) / 10,
          family: familyCount,
          familyPct: Math.round(familyCount / tierPatents.length * 1000) / 10,
          xml: xmlCount,
          xmlPct: Math.round(xmlCount / xmlDenominator * 1000) / 10,
        },
        quarantineCounts: tierQuarantineCounts,
        topAffiliates,
        topSuperSectors,
      });
    }

    // Count totals scoped to the patent list
    const llmEligibleAll = patents.filter(p => !(p.quarantine as any)?.llm);
    const llmTotal = llmEligibleAll.filter(p => p.has_llm_data).length;
    const prosTotal = patents.filter(p => p.has_prosecution_data).length;
    const iprTotal = patents.filter(p => p.has_ipr_data).length;
    const familyTotal = patents.filter(p => p.has_family_data).length;
    const xmlEligibleAll = patents.filter(p => !(p.quarantine as any)?.xml);
    const xmlTotal = xmlEligibleAll.filter(p => p.has_xml_data).length;
    const totalQuarantineCounts = {
      total: patents.filter(p => p.is_quarantined).length,
      xml: patents.filter(p => (p.quarantine as any)?.xml).length,
      llm: patents.filter(p => (p.quarantine as any)?.llm).length,
    };

    res.json({
      totalPatents: sorted.length,
      tierSize,
      enrichmentTotals: {
        llm: llmTotal,
        prosecution: prosTotal,
        ipr: iprTotal,
        family: familyTotal,
        xml: xmlTotal,
      },
      quarantineCounts: totalQuarantineCounts,
      tiers,
    });
  } catch (error) {
    console.error('Error computing enrichment summary:', error);
    res.status(500).json({ error: 'Failed to compute enrichment summary' });
  }
});

/**
 * GET /api/patents/sector-enrichment
 * Enrichment coverage broken down by super-sector (for top N patents per sector)
 */
router.get('/sector-enrichment', async (_req: Request, res: Response) => {
  try {
    // topPerSector: 0 = all patents, otherwise limit to that number
    const rawTopPerSector = parseInt(_req.query.topPerSector as string);
    const topPerSector = rawTopPerSector === 0 ? Infinity : Math.max(100, rawTopPerSector || 500);
    const portfolioId = _req.query.portfolioId as string | undefined;
    const forceRefresh = _req.query.forceRefresh === 'true';

    if (forceRefresh) {
      await repairEnrichmentFlags();
    }

    const patents = await patentDataService.getPatentsForEnrichment(portfolioId);

    // Group by super_sector
    const bySector: Record<string, typeof patents> = {};
    for (const p of patents) {
      const ss = p.super_sector || 'Unknown';
      if (!bySector[ss]) bySector[ss] = [];
      bySector[ss].push(p);
    }

    // Build sector summaries
    const sectors = Object.entries(bySector)
      .map(([name, sectorPatents]) => {
        // Sort by score descending, then grant date descending (matches analyzeGaps order)
        const sorted = [...sectorPatents].sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const aDate = a.grant_date || '';
          const bDate = b.grant_date || '';
          return bDate.localeCompare(aDate);
        });
        const top = topPerSector === Infinity ? sorted : sorted.slice(0, topPerSector);
        const ids = top.map(p => p.patent_id);

        // All enrichment flags now from Postgres
        // LLM: use quarantine to exclude LLM-ineligible patents
        const llmEligible = top.filter(p => !(p.quarantine as any)?.llm);
        const llmCount = llmEligible.filter(p => p.has_llm_data).length;
        const llmDenominator = llmEligible.length || 1;
        const prosCount = top.filter(p => p.has_prosecution_data).length;
        const iprCount = top.filter(p => p.has_ipr_data).length;
        const familyCount = top.filter(p => p.has_family_data).length;
        const xmlEligible = top.filter(p => !(p.quarantine as any)?.xml);
        const xmlCount = xmlEligible.filter(p => p.has_xml_data).length;
        const xmlDenominator = xmlEligible.length || 1;

        const checked = top.length;
        const scoreMin = top[top.length - 1]?.score ?? 0;
        const scoreMax = top[0]?.score ?? 0;

        // Gaps (patents needing enrichment)
        const llmGap = llmEligible.filter(p => !p.has_llm_data).length;
        const prosGap = top.filter(p => !p.has_prosecution_data).length;
        const iprGap = top.filter(p => !p.has_ipr_data).length;
        const familyGap = top.filter(p => !p.has_family_data).length;
        const xmlGap = xmlEligible.filter(p => !p.has_xml_data).length;

        const sectorQuarantineCounts = {
          total: top.filter(p => p.is_quarantined).length,
          xml: top.filter(p => (p.quarantine as any)?.xml).length,
          llm: top.filter(p => (p.quarantine as any)?.llm).length,
        };

        return {
          name,
          totalPatents: sectorPatents.length,
          checkedPatents: checked,
          scoreRange: `${scoreMin.toFixed(1)} – ${scoreMax.toFixed(1)}`,
          enrichment: {
            llm: llmCount,
            llmPct: Math.round(llmCount / llmDenominator * 1000) / 10,
            prosecution: prosCount,
            prosecutionPct: Math.round(prosCount / checked * 1000) / 10,
            ipr: iprCount,
            iprPct: Math.round(iprCount / checked * 1000) / 10,
            family: familyCount,
            familyPct: Math.round(familyCount / checked * 1000) / 10,
            xml: xmlCount,
            xmlPct: Math.round(xmlCount / xmlDenominator * 1000) / 10,
          },
          gaps: {
            llm: llmGap,
            prosecution: prosGap,
            ipr: iprGap,
            family: familyGap,
            xml: xmlGap,
          },
          quarantineCounts: sectorQuarantineCounts,
        };
      })
      .sort((a, b) => b.totalPatents - a.totalPatents);

    res.json({
      totalPatents: patents.length,
      topPerSector,
      sectors,
    });
  } catch (error) {
    console.error('Error computing sector enrichment:', error);
    res.status(500).json({ error: 'Failed to compute sector enrichment' });
  }
});

/**
 * GET /api/patents
 * List patents with pagination, filtering, and sorting
 * Optional: portfolioId, focusAreaId query params
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '50',
      sortBy = 'score',
      descending = 'true',
      focusAreaId,
      portfolioId,
      ...rawFilters
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string)));
    const isDescending = descending === 'true';

    // Map query string filters to typed PatentFilters
    const filters: PatentFilters = {};
    for (const [key, val] of Object.entries(rawFilters)) {
      if (val === undefined || val === '') continue;
      if (Array.isArray(val)) {
        (filters as any)[key] = val;
      } else if (typeof val === 'string') {
        // Numeric fields
        if (key.endsWith('Min') || key.endsWith('Max')) {
          (filters as any)[key] = parseFloat(val);
        } else if (key === 'affiliates' || key === 'superSectors' || key === 'assignees' ||
                   key === 'primarySectors' || key === 'competitorNames' || key === 'cpcCodes' ||
                   key === 'subSectors') {
          (filters as any)[key] = [val];
        } else {
          (filters as any)[key] = val;
        }
      }
    }

    // Look up active snapshot scores for this portfolio
    const snapshotScores = await getActiveSnapshotScores(portfolioId as string | undefined);

    const result = await patentDataService.getPatents({
      portfolioId: portfolioId as string | undefined,
      focusAreaId: focusAreaId as string | undefined,
      pagination: { page: pageNum, limit: limitNum, sortBy: sortBy as string, descending: isDescending },
      filters,
      snapshotScores: { v2: snapshotScores.v2Scores, v3: snapshotScores.v3Scores },
    });

    res.json(result);
  } catch (error) {
    console.error('Error loading patents:', error);
    res.status(500).json({ error: 'Failed to load patents' });
  }
});

/**
 * GET /api/patents/stats
 * Get portfolio statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.query.portfolioId as string | undefined;
    const stats = await patentDataService.getPatentStats(portfolioId);
    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * GET /api/patents/affiliates
 * Get list of affiliates (normalized entities) with patent counts
 */
router.get('/affiliates', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.query.portfolioId as string | undefined;
    const affiliates = await patentDataService.getFilterOptions('affiliate', portfolioId);
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
router.get('/super-sectors', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.query.portfolioId as string | undefined;
    const superSectors = await patentDataService.getFilterOptions('superSector', portfolioId);
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
router.get('/primary-sectors', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.query.portfolioId as string | undefined;
    const sectors = await patentDataService.getFilterOptions('primarySector', portfolioId);
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
router.get('/assignees', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.query.portfolioId as string | undefined;
    const assignees = await patentDataService.getFilterOptions('assignee', portfolioId);
    res.json(assignees);
  } catch (error) {
    console.error('Error getting assignees:', error);
    res.status(500).json({ error: 'Failed to get assignees' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: New filter option endpoints for flexible filtering
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/patents/competitor-names
 * Get list of unique competitor names with citation counts
 */
router.get('/competitor-names', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.query.portfolioId as string | undefined;
    const competitorNames = await patentDataService.getCompetitorNames(portfolioId);
    res.json(competitorNames);
  } catch (error) {
    console.error('Error getting competitor names:', error);
    res.status(500).json({ error: 'Failed to get competitor names' });
  }
});

/**
 * GET /api/patents/cpc-codes
 * Get list of unique CPC codes with patent counts
 * Optional query param: level=section|class|subclass|group (default: subclass)
 */
router.get('/cpc-codes', async (req: Request, res: Response) => {
  try {
    const level = (req.query.level as string || 'subclass') as 'section' | 'class' | 'subclass' | 'group';
    const portfolioId = req.query.portfolioId as string | undefined;

    const cpcCounts = await patentDataService.getCpcCodeCounts(level, portfolioId);

    const cpcCodes = cpcCounts.map(({ code, count }) => ({
      code,
      count,
      description: resolveCpcDescription(code),
    }));

    res.json(cpcCodes);
  } catch (error) {
    console.error('Error getting CPC codes:', error);
    res.status(500).json({ error: 'Failed to get CPC codes' });
  }
});

/**
 * GET /api/patents/sub-sectors
 * Get list of unique sub-sectors with patent counts
 */
router.get('/sub-sectors', async (_req: Request, res: Response) => {
  try {
    const portfolioId = _req.query.portfolioId as string | undefined;
    const subSectors = await patentDataService.getSubSectorCounts(portfolioId);
    res.json(subSectors);
  } catch (error) {
    console.error('Error getting sub-sectors:', error);
    res.status(500).json({ error: 'Failed to get sub-sectors' });
  }
});

/**
 * GET /api/patents/filter-options
 * Get all available filter options in a single call (for FlexFilterBuilder)
 */
router.get('/filter-options', async (_req: Request, res: Response) => {
  try {
    const portfolioId = _req.query.portfolioId as string | undefined;
    const filterOptions = await patentDataService.getAllFilterOptions(portfolioId);

    // Add CPC descriptions
    const cpcCodesWithDesc = filterOptions.cpcCodes.map(({ code, count }) => ({
      code,
      count,
      description: resolveCpcDescription(code),
    }));

    res.json({
      ...filterOptions,
      cpcCodes: cpcCodesWithDesc,
    });
  } catch (error) {
    console.error('Error getting filter options:', error);
    res.status(500).json({ error: 'Failed to get filter options' });
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
router.post('/batch-preview', async (req: Request, res: Response) => {
  try {
    const { patentIds } = req.body;

    if (!Array.isArray(patentIds)) {
      return res.status(400).json({ error: 'patentIds must be an array' });
    }

    // Limit to 100 patents per request
    const limitedIds = patentIds.slice(0, 100);
    const patentMap = await patentDataService.getPatentsByIds(limitedIds);

    const previews: Record<string, PatentPreview | null> = {};

    for (const id of limitedIds) {
      const patent = patentMap.get(id);
      if (patent) {
        previews[id] = {
          patent_id: patent.patent_id,
          patent_title: patent.patent_title,
          abstract: patent.abstract || loadAbstract(id),
          patent_date: patent.patent_date,
          assignee: patent.assignee,
          affiliate: patent.affiliate,
          super_sector: patent.super_sector,
          primary_sector: patent.primary_sector,
          cpc_codes: patent.cpc_codes || [],
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
        // Fall back to other cache sources
        previews[id] = resolvePatentPreview(id);
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
router.get('/export', async (req: Request, res: Response) => {
  try {
    const {
      sortBy = 'score',
      descending = 'true',
      columns: columnParam,
      portfolioId,
      ...filterParams
    } = req.query;

    const isDescending = descending === 'true';

    // Parse filters from query params
    const filters: PatentFilters = {};
    if (filterParams.search) filters.search = filterParams.search as string;
    if (filterParams.affiliates) filters.affiliates = Array.isArray(filterParams.affiliates) ? filterParams.affiliates as string[] : [filterParams.affiliates as string];
    if (filterParams.assignees) filters.assignees = Array.isArray(filterParams.assignees) ? filterParams.assignees as string[] : [filterParams.assignees as string];
    if (filterParams.superSectors) filters.superSectors = Array.isArray(filterParams.superSectors) ? filterParams.superSectors as string[] : [filterParams.superSectors as string];
    if (filterParams.primarySectors) filters.primarySectors = Array.isArray(filterParams.primarySectors) ? filterParams.primarySectors as string[] : [filterParams.primarySectors as string];
    if (filterParams.subSectors) filters.subSectors = Array.isArray(filterParams.subSectors) ? filterParams.subSectors as string[] : [filterParams.subSectors as string];
    if (filterParams.competitorNames) filters.competitorNames = Array.isArray(filterParams.competitorNames) ? filterParams.competitorNames as string[] : [filterParams.competitorNames as string];
    if (filterParams.cpcCodes) filters.cpcCodes = Array.isArray(filterParams.cpcCodes) ? filterParams.cpcCodes as string[] : [filterParams.cpcCodes as string];
    if (filterParams.dateStart) filters.dateStart = filterParams.dateStart as string;
    if (filterParams.dateEnd) filters.dateEnd = filterParams.dateEnd as string;
    if (filterParams.scoreMin) filters.scoreMin = parseFloat(filterParams.scoreMin as string);
    if (filterParams.scoreMax) filters.scoreMax = parseFloat(filterParams.scoreMax as string);
    if (filterParams.hasLlmData) filters.hasLlmData = filterParams.hasLlmData as string;
    if (filterParams.isExpired) filters.isExpired = filterParams.isExpired as string;
    if (filterParams.activeOnly) filters.activeOnly = filterParams.activeOnly as string;
    if (filterParams.hasCompetitorCites) filters.hasCompetitorCites = filterParams.hasCompetitorCites as string;

    const exportSnapshotScores = await getActiveSnapshotScores(portfolioId as string | undefined);
    const patents = await patentDataService.getAllPatents({
      portfolioId: portfolioId as string | undefined,
      filters,
      sortBy: sortBy as string,
      descending: isDescending,
      snapshotScores: { v2: exportSnapshotScores.v2Scores, v3: exportSnapshotScores.v3Scores },
    });

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
      { field: 'is_quarantined', label: 'Quarantined' },
      { field: 'patent_id_numeric', label: 'Patent Number (Numeric)' },
    ];

    let exportColumns = allColumns;
    if (columnParam && typeof columnParam === 'string') {
      const requestedFields = (columnParam as string).split(',').map(s => s.trim());
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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3: Aggregation endpoint for analytics
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/patents/aggregate
 * Aggregate patents with groupBy and aggregation functions
 *
 * Body: {
 *   groupBy: string | string[],       // Field(s) to group by
 *   aggregations: [{ field, op }],    // Operations: count, sum, avg, min, max
 *   explodeArrays?: boolean,          // If true, explode array fields (e.g., competitor_names)
 *   filters?: Record<string, any>,    // Same filters as GET /api/patents
 *   portfolioId?: string,             // Optional portfolio scope
 *   sortBy?: string,                  // Sort by aggregation result field
 *   sortDesc?: boolean,               // Sort descending
 *   limit?: number                    // Limit results
 * }
 */
router.post('/aggregate', async (req: Request, res: Response) => {
  try {
    const {
      groupBy,
      aggregations = [],
      explodeArrays = false,
      filters = {},
      portfolioId,
      sortBy = 'count',
      sortDesc = true,
      limit = 100
    } = req.body;

    if (!groupBy) {
      return res.status(400).json({ error: 'groupBy is required' });
    }

    // Normalize groupBy to array
    const groupByFields = Array.isArray(groupBy) ? groupBy : [groupBy];

    // Load patents from Postgres with snapshot scores
    const aggSnapshotScores = await getActiveSnapshotScores(portfolioId);
    const patents = await patentDataService.getAllPatents({
      portfolioId,
      filters,
      snapshotScores: { v2: aggSnapshotScores.v2Scores, v3: aggSnapshotScores.v3Scores },
    });

    // Fields that are arrays and can be exploded
    const arrayFields = new Set(['competitor_names', 'cpc_codes']);

    // Build groups
    const groups = new Map<string, { key: Record<string, string>; patents: typeof patents }>();

    for (const patent of patents) {
      const keyValues: Record<string, string>[] = [{}];

      for (const field of groupByFields) {
        const val = (patent as any)[field];
        const newKeyValues: Record<string, string>[] = [];

        if (explodeArrays && arrayFields.has(field) && Array.isArray(val)) {
          if (val.length === 0) {
            for (const existing of keyValues) {
              newKeyValues.push({ ...existing, [field]: '(none)' });
            }
          } else {
            for (const existing of keyValues) {
              for (const item of val) {
                newKeyValues.push({ ...existing, [field]: String(item) });
              }
            }
          }
        } else {
          const strVal = Array.isArray(val) ? val.join(', ') : String(val ?? '(none)');
          for (const existing of keyValues) {
            newKeyValues.push({ ...existing, [field]: strVal });
          }
        }

        keyValues.length = 0;
        keyValues.push(...newKeyValues);
      }

      for (const keyObj of keyValues) {
        const keyStr = JSON.stringify(keyObj);
        if (!groups.has(keyStr)) {
          groups.set(keyStr, { key: keyObj, patents: [] });
        }
        groups.get(keyStr)!.patents.push(patent);
      }
    }

    // Compute aggregations
    interface AggResult { [key: string]: string | number; }
    const results: AggResult[] = [];

    for (const group of groups.values()) {
      const result: AggResult = { ...group.key, count: group.patents.length };

      for (const agg of aggregations) {
        const { field, op } = agg;
        const values = group.patents
          .map(p => (p as any)[field])
          .filter(v => v != null && typeof v === 'number') as number[];

        const aggKey = `${field}_${op}`;

        switch (op) {
          case 'sum':
            result[aggKey] = values.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            result[aggKey] = values.length > 0
              ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100
              : 0;
            break;
          case 'min':
            result[aggKey] = values.length > 0 ? Math.min(...values) : 0;
            break;
          case 'max':
            result[aggKey] = values.length > 0 ? Math.max(...values) : 0;
            break;
          case 'count_nonnull':
            result[aggKey] = values.length;
            break;
        }
      }

      results.push(result);
    }

    // Sort results
    results.sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
      return sortDesc ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });

    const limitedResults = results.slice(0, limit);

    res.json({
      groupBy: groupByFields,
      aggregations,
      explodeArrays,
      totalGroups: results.length,
      filteredPatents: patents.length,
      results: limitedResults
    });
  } catch (error) {
    console.error('Error aggregating patents:', error);
    res.status(500).json({ error: 'Failed to aggregate patents' });
  }
});

/**
 * POST /api/patents/aggregate/export
 * Export aggregation results as CSV
 */
router.post('/aggregate/export', async (req: Request, res: Response) => {
  try {
    const {
      groupBy,
      aggregations = [],
      explodeArrays = false,
      filters = {},
      portfolioId,
      sortBy = 'count',
      sortDesc = true
    } = req.body;

    if (!groupBy) {
      return res.status(400).json({ error: 'groupBy is required' });
    }

    const groupByFields = Array.isArray(groupBy) ? groupBy : [groupBy];

    const aggExpSnapshotScores = await getActiveSnapshotScores(portfolioId);
    const patents = await patentDataService.getAllPatents({
      portfolioId,
      filters,
      snapshotScores: { v2: aggExpSnapshotScores.v2Scores, v3: aggExpSnapshotScores.v3Scores },
    });

    // Same grouping logic as /aggregate
    const arrayFields = new Set(['competitor_names', 'cpc_codes']);
    const groups = new Map<string, { key: Record<string, string>; patents: typeof patents }>();

    for (const patent of patents) {
      const keyValues: Record<string, string>[] = [{}];

      for (const field of groupByFields) {
        const val = (patent as any)[field];
        const newKeyValues: Record<string, string>[] = [];

        if (explodeArrays && arrayFields.has(field) && Array.isArray(val)) {
          if (val.length === 0) {
            for (const existing of keyValues) {
              newKeyValues.push({ ...existing, [field]: '(none)' });
            }
          } else {
            for (const existing of keyValues) {
              for (const item of val) {
                newKeyValues.push({ ...existing, [field]: String(item) });
              }
            }
          }
        } else {
          const strVal = Array.isArray(val) ? val.join(', ') : String(val ?? '(none)');
          for (const existing of keyValues) {
            newKeyValues.push({ ...existing, [field]: strVal });
          }
        }

        keyValues.length = 0;
        keyValues.push(...newKeyValues);
      }

      for (const keyObj of keyValues) {
        const keyStr = JSON.stringify(keyObj);
        if (!groups.has(keyStr)) {
          groups.set(keyStr, { key: keyObj, patents: [] });
        }
        groups.get(keyStr)!.patents.push(patent);
      }
    }

    // Compute aggregations
    interface AggResult { [key: string]: string | number; }
    const results: AggResult[] = [];

    for (const group of groups.values()) {
      const result: AggResult = { ...group.key, count: group.patents.length };

      for (const agg of aggregations) {
        const { field, op } = agg;
        const values = group.patents
          .map(p => (p as any)[field])
          .filter(v => v != null && typeof v === 'number') as number[];

        const aggKey = `${field}_${op}`;

        switch (op) {
          case 'sum':
            result[aggKey] = values.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            result[aggKey] = values.length > 0
              ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 100) / 100
              : 0;
            break;
          case 'min':
            result[aggKey] = values.length > 0 ? Math.min(...values) : 0;
            break;
          case 'max':
            result[aggKey] = values.length > 0 ? Math.max(...values) : 0;
            break;
          case 'count_nonnull':
            result[aggKey] = values.length;
            break;
        }
      }

      results.push(result);
    }

    // Sort
    results.sort((a, b) => {
      const aVal = a[sortBy] ?? 0;
      const bVal = b[sortBy] ?? 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
      return sortDesc ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });

    if (results.length === 0) {
      return res.status(400).json({ error: 'No results to export' });
    }

    const columns = Object.keys(results[0]);

    function escapeCSV(val: unknown): string {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    const header = columns.map(c => escapeCSV(c)).join(',');
    const rows = results.map(row =>
      columns.map(col => escapeCSV(row[col])).join(',')
    );

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="patent-aggregate-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting aggregation:', error);
    res.status(500).json({ error: 'Failed to export aggregation' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Quarantine endpoints (must be before /:id routes to avoid param conflicts)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/patents/quarantine-summary
 * Get quarantine summary grouped by reason, optionally scoped to a portfolio.
 */
router.get('/quarantine-summary', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.query.portfolioId as string | undefined;

    const where: Record<string, any> = { isQuarantined: true };
    if (portfolioId) {
      where.portfolios = { some: { portfolioId } };
    }

    const patents = await prisma.patent.findMany({
      where,
      select: {
        patentId: true,
        title: true,
        grantDate: true,
        assignee: true,
        affiliate: true,
        quarantine: true,
        hasXmlData: true,
      },
    });

    // Group by reason
    const groups: Record<string, Array<{
      patentId: string; title: string; grantDate: string | null;
      assignee: string; affiliate: string | null;
    }>> = {};

    for (const p of patents) {
      const q = p.quarantine as Record<string, string> | null;
      if (!q) continue;
      for (const [coverageType, reason] of Object.entries(q)) {
        const key = `${coverageType}:${reason}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push({
          patentId: p.patentId,
          title: p.title,
          grantDate: p.grantDate,
          assignee: p.assignee,
          affiliate: p.affiliate,
        });
      }
    }

    const summary = Object.entries(groups)
      .map(([key, patents]) => {
        const [coverageType, reason] = key.split(':');
        return { coverageType, reason, count: patents.length, patents };
      })
      .sort((a, b) => b.count - a.count);

    res.json({
      totalQuarantined: patents.length,
      groups: summary,
    });
  } catch (error) {
    console.error('Error getting quarantine summary:', error);
    res.status(500).json({ error: 'Failed to get quarantine summary' });
  }
});

/**
 * GET /api/patents/:id/preview
 * Get lightweight preview data for a single patent
 */
router.get('/:id/preview', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const patent = await patentDataService.getPatent(id);
    if (patent) {
      const preview: PatentPreview = {
        patent_id: patent.patent_id,
        patent_title: patent.patent_title,
        abstract: patent.abstract || loadAbstract(id),
        patent_date: patent.patent_date,
        assignee: patent.assignee,
        affiliate: patent.affiliate,
        super_sector: patent.super_sector,
        primary_sector: patent.primary_sector,
        cpc_codes: patent.cpc_codes || [],
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
      return res.json(preview);
    }

    // Fall back to other cache sources
    const resolved = resolvePatentPreview(id);
    if (resolved) {
      return res.json(resolved);
    }

    return res.status(404).json({ error: 'Patent not found' });
  } catch (error) {
    console.error('Error getting patent preview:', error);
    res.status(500).json({ error: 'Failed to get patent preview' });
  }
});

/**
 * GET /api/patents/:id
 * Get single patent details
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Try Postgres first (source of truth)
    const patent = await patentDataService.getPatent(id);
    if (patent) {
      return res.json({ ...patent, in_portfolio: true });
    }

    // Fall back to other cache sources via patent-fetch-service
    const resolved = resolvePatent(id);
    if (resolved) {
      return res.json(resolved);
    }

    return res.status(404).json({ error: 'Patent not found' });
  } catch (error) {
    console.error('Error getting patent:', error);
    res.status(500).json({ error: 'Failed to get patent' });
  }
});

/**
 * GET /api/patents/:id/citations
 * Get citation data for a patent (from cache + Postgres)
 */
router.get('/:id/citations', async (req: Request, res: Response) => {
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

    // Look up patent details for citing patent IDs from Postgres
    const citingPatentIds: string[] = forwardCitations.citing_patent_ids || [];
    const patentMap = await patentDataService.getPatentsMini(citingPatentIds);

    const citingPatents = citingPatentIds.map(citingId => {
      const p = patentMap.get(citingId);
      if (p) {
        return {
          ...p,
          in_portfolio: true,
          has_cached_data: true,
        };
      }
      return {
        patent_id: citingId,
        patent_title: '',
        assignee: '',
        patent_date: '',
        affiliate: '',
        in_portfolio: false,
        has_cached_data: hasPatentData(citingId),
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
 * GET /api/patents/:id/prosecution-detail
 * Get claim-level prosecution analysis for a patent (from prosecution-analysis cache)
 */
router.get('/:id/prosecution-detail', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const cachePath = `./cache/prosecution-analysis/${id}.json`;

    if (!fs.existsSync(cachePath)) {
      res.json({
        patent_id: id,
        cached: false,
        message: 'Prosecution detail analysis not yet available for this patent.',
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
    console.error('Error getting prosecution detail:', error);
    res.status(500).json({ error: 'Failed to get prosecution detail' });
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
router.get('/:id/backward-citations', async (req: Request, res: Response) => {
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

    // Look up portfolio patents from Postgres
    const patentMap = await patentDataService.getPatentsMini(parentIds);

    // Enrich parent patents with details
    const parentPatents = parentIds.map(parentId => {
      const portfolioPatent = patentMap.get(parentId);

      if (portfolioPatent) {
        return {
          ...portfolioPatent,
          in_portfolio: true,
          has_cached_data: true,
        };
      }

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
        patent_title: details?.patent_title || '',
        assignee: details?.assignee || '',
        patent_date: details?.patent_date || '',
        affiliate: '',
        in_portfolio: false,
        has_cached_data: !!details || hasPatentData(parentId),
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

/**
 * POST /api/patents/enrich-cpc-designation
 * Enrich portfolio patents with CPC designation data (I = Inventive, A = Additional)
 * Uses USPTO bulk XML files to extract designation information
 * Body: { candidatesFile?: string, dryRun?: boolean }
 */
router.post('/enrich-cpc-designation', async (req: Request, res: Response) => {
  try {
    const { candidatesFile, dryRun = false } = req.body;
    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR;

    if (!xmlDir) {
      return res.status(400).json({
        error: 'USPTO_PATENT_GRANT_XML_DIR not set in environment',
        hint: 'Set this in .env to the directory containing USPTO patent XML files'
      });
    }

    console.log(`[CPC Enrichment] Starting enrichment (dryRun: ${dryRun})`);
    console.log(`[CPC Enrichment] XML directory: ${xmlDir}`);

    const result = await enrichCandidatesWithCpcDesignation(
      candidatesFile,
      xmlDir,
      {
        dryRun,
        progressCallback: (current, total) => {
          if (current % 5000 === 0) {
            console.log(`[CPC Enrichment] Progress: ${current}/${total} (${Math.round(current/total*100)}%)`);
          }
        }
      }
    );

    // Clear patents cache so next load picks up enriched data
    if (!dryRun) {
      await clearPatentsCache();
    }

    res.json({
      success: true,
      dryRun,
      result,
      coverage: {
        foundPct: Math.round(result.found / result.processed * 1000) / 10,
        inventivePct: Math.round(result.patentsWithInventive / result.found * 1000) / 10
      }
    });
  } catch (error) {
    console.error('[CPC Enrichment] Error:', error);
    res.status(500).json({ error: 'Failed to enrich CPC designations', message: (error as Error).message });
  }
});

/**
 * GET /api/patents/:id/cpc-designation
 * Get CPC designation data for a single patent from USPTO XML
 */
router.get('/:id/cpc-designation', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR;

    if (!xmlDir) {
      return res.status(400).json({
        error: 'USPTO_PATENT_GRANT_XML_DIR not set',
        fallback: 'CPC designation data requires USPTO bulk XML files'
      });
    }

    const xmlPath = findXmlPath(id, xmlDir);
    if (!xmlPath) {
      return res.status(404).json({
        patent_id: id,
        found: false,
        message: 'XML file not found for this patent',
        searchedPaths: [
          path.join(xmlDir, `US${id}.xml`),
          path.join(xmlDir, `US${id.padStart(8, '0')}.xml`)
        ]
      });
    }

    const cpcData = parsePatentXml(xmlPath);
    res.json({
      patent_id: id,
      found: true,
      xmlPath,
      ...cpcData
    });
  } catch (error) {
    console.error('Error getting CPC designation:', error);
    res.status(500).json({ error: 'Failed to get CPC designation' });
  }
});

/**
 * POST /api/patents/analyze-cpc-cooccurrence
 * Analyze CPC co-occurrence patterns in the portfolio
 * Used for grouping related CPCs under dominant inventive codes
 * Body: { minCooccurrence?: number, portfolioId?: string }
 */
router.post('/analyze-cpc-cooccurrence', async (_req: Request, res: Response) => {
  try {
    const { minCooccurrence = 10, portfolioId } = _req.body;
    const patents = await patentDataService.getAllPatents({ portfolioId });

    console.log(`[CPC Co-occurrence] Analyzing ${patents.length} patents (minCooccurrence: ${minCooccurrence})`);

    const cooccurrenceMap = analyzeCpcCooccurrence(patents, minCooccurrence);

    // Convert Map to serializable object and sort by patent count
    const results = Array.from(cooccurrenceMap.entries())
      .map(([cpc, stats]) => ({
        cpc,
        totalPatents: stats.totalPatents,
        cooccursWith: Array.from(stats.cooccurs.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20) // Top 20 co-occurring CPCs
          .map(([cooccurCpc, count]) => ({
            cpc: cooccurCpc,
            count,
            cooccurrencePct: Math.round(count / stats.totalPatents * 1000) / 10
          }))
      }))
      .filter(r => r.cooccursWith.length > 0)
      .sort((a, b) => b.totalPatents - a.totalPatents);

    res.json({
      analyzedPatents: patents.length,
      minCooccurrence,
      uniqueCpcs: cooccurrenceMap.size,
      cpcsWithCooccurrence: results.length,
      results: results.slice(0, 100) // Top 100 CPCs by patent count
    });
  } catch (error) {
    console.error('Error analyzing CPC co-occurrence:', error);
    res.status(500).json({ error: 'Failed to analyze CPC co-occurrence' });
  }
});

/**
 * POST /api/patents/set-enrichment-flag
 * Set a DB enrichment flag for a batch of patents.
 * Called by scripts (prosecution, IPR, LLM, family) after writing cache files.
 */
router.post('/set-enrichment-flag', async (req: Request, res: Response) => {
  try {
    const { patentIds, flag } = req.body;
    const validFlags = ['hasLlmData', 'hasProsecutionData', 'hasIprData', 'hasFamilyData', 'hasXmlData'] as const;
    type ValidFlag = typeof validFlags[number];

    if (!Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'patentIds must be a non-empty array' });
    }
    if (!validFlags.includes(flag as ValidFlag)) {
      return res.status(400).json({ error: `flag must be one of: ${validFlags.join(', ')}` });
    }

    const result = await prisma.patent.updateMany({
      where: { patentId: { in: patentIds }, [flag]: false },
      data: { [flag]: true },
    });

    if (result.count > 0) {
      invalidateEnrichmentCache();
    }

    res.json({ success: true, updated: result.count });
  } catch (error) {
    console.error('Error setting enrichment flag:', error);
    res.status(500).json({ error: 'Failed to set enrichment flag' });
  }
});

/**
 * POST /api/patents/invalidate-cache
 * Invalidate the enrichment cache (call after jobs complete)
 */
router.post('/invalidate-cache', (_req: Request, res: Response) => {
  try {
    invalidateEnrichmentCache();
    res.json({ success: true, message: 'Enrichment cache invalidated' });
  } catch (error) {
    console.error('Error invalidating cache:', error);
    res.status(500).json({ error: 'Failed to invalidate cache' });
  }
});

/**
 * POST /api/patents/:id/quarantine
 * Quarantine a patent for a specific coverage type.
 */
router.post('/:id/quarantine', async (req: Request, res: Response) => {
  try {
    const patentId = req.params.id;
    const { coverageType, reason } = req.body;

    if (!coverageType || !reason) {
      return res.status(400).json({ error: 'coverageType and reason are required' });
    }

    const patent = await prisma.patent.findUnique({
      where: { patentId },
      select: { quarantine: true },
    });

    if (!patent) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    const existing = (patent.quarantine as Record<string, string>) || {};
    const updated = { ...existing, [coverageType]: reason };

    await prisma.patent.update({
      where: { patentId },
      data: { quarantine: updated, isQuarantined: true },
    });

    res.json({ success: true, quarantine: updated });
  } catch (error) {
    console.error('Error quarantining patent:', error);
    res.status(500).json({ error: 'Failed to quarantine patent' });
  }
});

/**
 * DELETE /api/patents/:id/quarantine
 * Remove quarantine for a specific coverage type.
 */
router.delete('/:id/quarantine', async (req: Request, res: Response) => {
  try {
    const patentId = req.params.id;
    const { coverageType } = req.body;

    if (!coverageType) {
      return res.status(400).json({ error: 'coverageType is required' });
    }

    const patent = await prisma.patent.findUnique({
      where: { patentId },
      select: { quarantine: true },
    });

    if (!patent) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    const existing = (patent.quarantine as Record<string, string>) || {};
    delete existing[coverageType];

    const isQuarantined = Object.keys(existing).length > 0;

    await prisma.patent.update({
      where: { patentId },
      data: {
        quarantine: Object.keys(existing).length > 0 ? existing : null,
        isQuarantined,
      },
    });

    res.json({ success: true, quarantine: isQuarantined ? existing : null, isQuarantined });
  } catch (error) {
    console.error('Error unquarantining patent:', error);
    res.status(500).json({ error: 'Failed to unquarantine patent' });
  }
});

/**
 * POST /api/patents/bulk-quarantine
 * Bulk quarantine or unquarantine patents.
 */
router.post('/bulk-quarantine', async (req: Request, res: Response) => {
  try {
    const { patentIds, coverageType, reason, action } = req.body;

    if (!patentIds?.length || !coverageType || !action) {
      return res.status(400).json({ error: 'patentIds, coverageType, and action are required' });
    }

    if (action !== 'quarantine' && action !== 'unquarantine') {
      return res.status(400).json({ error: 'action must be "quarantine" or "unquarantine"' });
    }

    const patents = await prisma.patent.findMany({
      where: { patentId: { in: patentIds } },
      select: { patentId: true, quarantine: true },
    });

    let updated = 0;
    for (const p of patents) {
      const existing = (p.quarantine as Record<string, string>) || {};

      if (action === 'quarantine') {
        existing[coverageType] = reason || 'manual';
        await prisma.patent.update({
          where: { patentId: p.patentId },
          data: { quarantine: existing, isQuarantined: true },
        });
      } else {
        delete existing[coverageType];
        const isQuarantined = Object.keys(existing).length > 0;
        await prisma.patent.update({
          where: { patentId: p.patentId },
          data: {
            quarantine: Object.keys(existing).length > 0 ? existing : null,
            isQuarantined,
          },
        });
      }
      updated++;
    }

    res.json({ success: true, updated });
  } catch (error) {
    console.error('Error in bulk quarantine:', error);
    res.status(500).json({ error: 'Failed to bulk quarantine' });
  }
});

export default router;
