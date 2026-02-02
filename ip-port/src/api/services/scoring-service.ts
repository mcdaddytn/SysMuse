/**
 * Scoring Service (P-0b)
 *
 * Implements V3 patent scoring with configurable weight profiles and
 * citation-aware weighting (Session 13).
 *
 * Formula:
 *   score = Σ(normalized_metric × adjusted_weight) × year_multiplier × 100
 *
 * Normalization:
 *   competitor_citations:         min(1, cc / 20)
 *   adjusted_forward_citations:   min(1, sqrt(adj_fc) / 30)
 *     where adj_fc = competitor×1.5 + neutral×1.0 + affiliate×0.25
 *   competitor_density:           competitor / (competitor + neutral)  [0-1]
 *   years_remaining:              min(1, years / 15)
 *   competitor_count:             min(1, count / 5)
 *   LLM scores (1-5):            (score - 1) / 4
 *
 * Citation-aware weighting (addresses VMware self-citation inflation):
 *   Competitor citations boosted 1.5× (strong external validation)
 *   Neutral citations baseline 1.0×
 *   Affiliate citations discounted to 0.25× (self-citation)
 *   See docs/CITATION_CATEGORIZATION_PROBLEM.md
 *
 * Year multiplier:
 *   0.3 + 0.7 × (yearsFactor ^ 0.8)
 *   where yearsFactor = min(1, years / 15)
 *
 * When LLM metrics are unavailable (~65% of patents), their weights
 * are redistributed proportionally among available metrics.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoringProfile {
  id: string;
  displayName: string;
  description: string;
  category: string;
  weights: Record<string, number>;
}

export interface PatentMetrics {
  patent_id: string;
  // Quantitative (always available for patents with citation data)
  competitor_citations: number;
  forward_citations: number;
  adjusted_forward_citations: number; // Weighted: competitor×1.5 + neutral×1.0 + affiliate×0.25
  years_remaining: number;
  competitor_count: number;
  competitor_density: number; // competitor / (competitor + neutral), 0-1
  // Citation breakdown (from classification pipeline)
  affiliate_citations: number;
  neutral_citations: number;
  total_forward_citations: number;
  has_citation_data: boolean;
  // LLM scores (sparse — only ~27% of patents)
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  market_relevance_score?: number;
  // API-derived scores (from PTAB and File Wrapper)
  ipr_risk_score?: number;
  prosecution_quality_score?: number;
}

export interface ScoredPatent {
  patent_id: string;
  score: number;
  rank?: number;
  normalized_metrics: Record<string, number>;
  year_multiplier: number;
  base_score: number;
  metrics_used: string[];
  profile_id: string;
}

export interface SectorSummary {
  sector: string;
  sector_name: string;
  super_sector: string;
  patent_count: number;
  avg_score: number;
  damages_rating: number;
  top_patents: Array<{ patent_id: string; score: number; title: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Citation weighting — adjusts forward citations by source type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citation source weights for adjusted_forward_citations.
 * Competitor citations are boosted (strong external validation signal).
 * Affiliate citations are deeply discounted (self-citation / internal R&D).
 * Neutral citations are baseline.
 *
 * Addresses VMware self-citation inflation: VMware patents average 16.5%
 * self-citation rate vs 1.7% for non-VMware (see CITATION_CATEGORIZATION_PROBLEM.md).
 */
export const CITATION_WEIGHTS = {
  competitor: 1.5,   // 50% boost — competitors building on/around this tech
  neutral: 1.0,      // Baseline — general external interest
  affiliate: 0.25,   // 75% discount — self-citation / internal continuity
};

// ─────────────────────────────────────────────────────────────────────────────
// Normalization functions
// ─────────────────────────────────────────────────────────────────────────────

const NORMALIZERS: Record<string, (value: number) => number> = {
  competitor_citations: (v) => Math.min(1, v / 20),
  forward_citations: (v) => Math.min(1, Math.sqrt(v) / 30),
  // Adjusted forward citations: same shape as forward_citations but accounts
  // for potentially higher values from competitor boost (max 1.5× raw total)
  adjusted_forward_citations: (v) => Math.min(1, Math.sqrt(v) / 30),
  years_remaining: (v) => Math.min(1, v / 15),
  competitor_count: (v) => Math.min(1, v / 5),
  // Competitor density: already 0-1 (ratio of competitor to external citations)
  competitor_density: (v) => Math.min(1, v),
  // LLM scores: 1-5 → 0-1 (1 is worst, 5 is best)
  eligibility_score: (v) => Math.max(0, (v - 1) / 4),
  validity_score: (v) => Math.max(0, (v - 1) / 4),
  claim_breadth: (v) => Math.max(0, (v - 1) / 4),
  enforcement_clarity: (v) => Math.max(0, (v - 1) / 4),
  design_around_difficulty: (v) => Math.max(0, (v - 1) / 4),
  market_relevance_score: (v) => Math.max(0, (v - 1) / 4),
  // API-derived scores: 1-5 → 0-1 (same scale as LLM)
  ipr_risk_score: (v) => Math.max(0, (v - 1) / 4),
  prosecution_quality_score: (v) => Math.max(0, (v - 1) / 4),
};

const LLM_METRICS = new Set([
  'eligibility_score',
  'validity_score',
  'claim_breadth',
  'enforcement_clarity',
  'design_around_difficulty',
  'market_relevance_score',
]);

// API-derived metrics (from PTAB and File Wrapper — sparse like LLM)
const API_METRICS = new Set([
  'ipr_risk_score',
  'prosecution_quality_score',
]);

const QUANTITATIVE_METRICS = new Set([
  'competitor_citations',
  'forward_citations',
  'adjusted_forward_citations',
  'years_remaining',
  'competitor_count',
  'competitor_density',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Profiles
// ─────────────────────────────────────────────────────────────────────────────

const PROFILES: ScoringProfile[] = [
  {
    id: 'executive',
    displayName: 'Executive',
    description: 'Balanced scoring for executive-level portfolio overview. Uses adjusted citations (affiliate-discounted).',
    category: 'balanced',
    weights: {
      competitor_citations: 0.25,
      adjusted_forward_citations: 0.11, // was forward_citations: 0.13
      years_remaining: 0.17,
      competitor_count: 0.05,           // was 0.08, gave 0.03 to competitor_density
      competitor_density: 0.05,         // NEW: measures competitive concentration
      eligibility_score: 0.05,
      validity_score: 0.05,
      claim_breadth: 0.04,
      enforcement_clarity: 0.04,
      design_around_difficulty: 0.04,
      market_relevance_score: 0.05,
      ipr_risk_score: 0.05,
      prosecution_quality_score: 0.05,
    },
  },
  {
    id: 'aggressive',
    displayName: 'Aggressive Litigator',
    description: 'Litigation-focused, prioritizes enforcement and competitor citations. Uses adjusted citations.',
    category: 'aggressive',
    weights: {
      competitor_citations: 0.22,
      adjusted_forward_citations: 0.02, // was forward_citations: 0.04
      years_remaining: 0.08,
      competitor_count: 0.02,           // was 0.04
      competitor_density: 0.04,         // NEW: strong signal for litigation targeting
      eligibility_score: 0.10,
      validity_score: 0.07,
      claim_breadth: 0.04,
      enforcement_clarity: 0.17,
      design_around_difficulty: 0.09,
      market_relevance_score: 0.03,
      ipr_risk_score: 0.07,
      prosecution_quality_score: 0.05,
    },
  },
  {
    id: 'moderate',
    displayName: 'Balanced Strategist',
    description: 'Even distribution for licensing negotiations and portfolio management. Uses adjusted citations.',
    category: 'moderate',
    weights: {
      competitor_citations: 0.17,
      adjusted_forward_citations: 0.06, // was forward_citations: 0.08
      years_remaining: 0.13,
      competitor_count: 0.02,           // was 0.04
      competitor_density: 0.04,         // NEW
      eligibility_score: 0.10,
      validity_score: 0.10,
      claim_breadth: 0.07,
      enforcement_clarity: 0.08,
      design_around_difficulty: 0.07,
      market_relevance_score: 0.05,
      ipr_risk_score: 0.05,
      prosecution_quality_score: 0.06,
    },
  },
  {
    id: 'conservative',
    displayName: 'Defensive Counsel',
    description: 'Emphasizes validity and breadth for cross-licensing leverage. Uses adjusted citations.',
    category: 'conservative',
    weights: {
      competitor_citations: 0.08,
      adjusted_forward_citations: 0.10, // was forward_citations: 0.12
      years_remaining: 0.08,
      competitor_count: 0.02,           // was 0.04
      competitor_density: 0.04,         // NEW
      eligibility_score: 0.07,
      validity_score: 0.18,
      claim_breadth: 0.13,
      enforcement_clarity: 0.04,
      design_around_difficulty: 0.08,
      market_relevance_score: 0.03,
      ipr_risk_score: 0.07,
      prosecution_quality_score: 0.08,
    },
  },
  {
    id: 'licensing',
    displayName: 'Licensing Focus',
    description: 'Broad coverage and market presence for licensing campaigns. Uses adjusted citations.',
    category: 'licensing',
    weights: {
      competitor_citations: 0.25,
      adjusted_forward_citations: 0.06, // was forward_citations: 0.08
      years_remaining: 0.17,
      competitor_count: 0.05,           // was 0.08
      competitor_density: 0.05,         // NEW: which tech spaces have competitor interest
      eligibility_score: 0.07,
      validity_score: 0.06,
      claim_breadth: 0.08,
      enforcement_clarity: 0.04,
      design_around_difficulty: 0.00,
      market_relevance_score: 0.08,
      ipr_risk_score: 0.05,
      prosecution_quality_score: 0.04,
    },
  },
  {
    id: 'quick_wins',
    displayName: 'Quick Wins',
    description: 'High-confidence, clear enforcement opportunities. Uses adjusted citations.',
    category: 'quick_wins',
    weights: {
      competitor_citations: 0.17,
      adjusted_forward_citations: 0.02, // was forward_citations: 0.04
      years_remaining: 0.08,
      competitor_count: 0.02,           // was 0.04
      competitor_density: 0.04,         // NEW
      eligibility_score: 0.15,
      validity_score: 0.14,
      claim_breadth: 0.04,
      enforcement_clarity: 0.17,
      design_around_difficulty: 0.00,
      market_relevance_score: 0.03,
      ipr_risk_score: 0.07,
      prosecution_quality_score: 0.07,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

const CLASSIFICATION_CACHE_DIR = path.join(process.cwd(), 'cache/citation-classification');
const LLM_SCORES_DIR = path.join(process.cwd(), 'cache/llm-scores');
const CANDIDATES_DIR = path.join(process.cwd(), 'output');

interface CitationClassification {
  patent_id: string;
  total_forward_citations: number;
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
  competitor_count: number;
  competitor_names: string[];
  has_citation_data: boolean;
}

interface LlmScores {
  patent_id: string;
  eligibility_score: number;
  validity_score: number;
  claim_breadth: number;
  enforcement_clarity: number;
  design_around_difficulty: number;
  market_relevance_score?: number;
  source?: string; // e.g. 'v3', 'v2', 'import'
}

interface IprRiskData {
  patent_id: string;
  ipr_risk_score: number;
  ipr_risk_category: string;
  has_ipr_history: boolean;
}

interface ProsecutionData {
  patent_id: string;
  prosecution_quality_score: number;
  prosecution_quality_category: string;
}

// In-memory caches
let classificationCache: Map<string, CitationClassification> | null = null;
let llmScoresCache: Map<string, LlmScores> | null = null;
let iprScoresCache: Map<string, IprRiskData> | null = null;
let prosecutionScoresCache: Map<string, ProsecutionData> | null = null;
let candidatesCache: any[] | null = null;

/**
 * Load citation classification for a single patent
 */
function loadClassification(patentId: string): CitationClassification | null {
  const filepath = path.join(CLASSIFICATION_CACHE_DIR, `${patentId}.json`);
  if (!fs.existsSync(filepath)) return null;
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

/**
 * Load all citation classifications into memory (for batch scoring)
 */
export function loadAllClassifications(): Map<string, CitationClassification> {
  if (classificationCache) return classificationCache;

  classificationCache = new Map();

  // Try loading the summary file first (faster)
  const summaryFiles = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('citation-classification-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (summaryFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, summaryFiles[0]), 'utf-8'));
    for (const result of data.results) {
      classificationCache.set(result.patent_id, result);
    }
    return classificationCache;
  }

  // Fallback: read individual files
  if (fs.existsSync(CLASSIFICATION_CACHE_DIR)) {
    const files = fs.readdirSync(CLASSIFICATION_CACHE_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(CLASSIFICATION_CACHE_DIR, file), 'utf-8'));
      classificationCache.set(data.patent_id, data);
    }
  }

  return classificationCache;
}

/**
 * Load all LLM scores into memory (for batch scoring)
 * Reads from cache/llm-scores/ directory (individual per-patent JSON files)
 * Also checks output/llm-analysis-v3/ for combined output files
 */
export function loadAllLlmScores(): Map<string, LlmScores> {
  if (llmScoresCache) return llmScoresCache;

  llmScoresCache = new Map();

  // Try combined output files first (from LLM analysis runs)
  const llmOutputDir = path.join(process.cwd(), 'output/llm-analysis-v3');
  if (fs.existsSync(llmOutputDir)) {
    const combinedFiles = fs.readdirSync(llmOutputDir)
      .filter(f => f.startsWith('combined-v3-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of combinedFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(llmOutputDir, file), 'utf-8'));
        for (const analysis of data.analyses || []) {
          if (!llmScoresCache.has(analysis.patent_id)) {
            llmScoresCache.set(analysis.patent_id, {
              patent_id: analysis.patent_id,
              eligibility_score: analysis.eligibility_score,
              validity_score: analysis.validity_score,
              claim_breadth: analysis.claim_breadth,
              enforcement_clarity: analysis.enforcement_clarity,
              design_around_difficulty: analysis.design_around_difficulty,
              market_relevance_score: analysis.market_relevance_score,
              source: 'v3-analysis',
            });
          }
        }
      } catch (e) {
        console.warn(`Failed to load LLM combined file ${file}:`, e);
      }
    }
  }

  // Also check v2 and v1 output directories
  for (const subdir of ['llm-analysis-v2', 'llm-analysis', 'vmware-llm-analysis']) {
    const dir = path.join(process.cwd(), 'output', subdir);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('combined-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        for (const analysis of data.analyses || []) {
          if (!llmScoresCache.has(analysis.patent_id)) {
            llmScoresCache.set(analysis.patent_id, {
              patent_id: analysis.patent_id,
              eligibility_score: analysis.eligibility_score,
              validity_score: analysis.validity_score,
              claim_breadth: analysis.claim_breadth,
              enforcement_clarity: analysis.enforcement_clarity,
              design_around_difficulty: analysis.design_around_difficulty,
              market_relevance_score: analysis.market_relevance_score,
              source: subdir,
            });
          }
        }
      } catch (e) {
        console.warn(`Failed to load LLM file ${file} from ${subdir}:`, e);
      }
    }
  }

  // Load per-patent cache files (from import script or on-demand analysis)
  if (fs.existsSync(LLM_SCORES_DIR)) {
    const files = fs.readdirSync(LLM_SCORES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(LLM_SCORES_DIR, file), 'utf-8'));
        // Per-patent files override combined files (they may be more recent)
        llmScoresCache.set(data.patent_id, {
          patent_id: data.patent_id,
          eligibility_score: data.eligibility_score,
          validity_score: data.validity_score,
          claim_breadth: data.claim_breadth,
          enforcement_clarity: data.enforcement_clarity,
          design_around_difficulty: data.design_around_difficulty,
          market_relevance_score: data.market_relevance_score,
          source: data.source || 'cache',
        });
      } catch (e) {
        // skip invalid files
      }
    }
  }

  console.log(`[Scoring] Loaded LLM scores for ${llmScoresCache.size} patents`);
  return llmScoresCache;
}

/**
 * Load all IPR risk scores from batch output files and per-patent cache.
 * Sources (later entries override earlier):
 *   1. output/ipr/ipr-risk-check-*.json (batch output)
 *   2. cache/ipr-scores/<patent_id>.json (per-patent cache, overrides batch)
 */
export function loadAllIprScores(): Map<string, IprRiskData> {
  if (iprScoresCache) return iprScoresCache;

  iprScoresCache = new Map();

  // 1. Load from batch output files
  const iprDir = path.join(process.cwd(), 'output/ipr');
  if (fs.existsSync(iprDir)) {
    const files = fs.readdirSync(iprDir)
      .filter(f => f.startsWith('ipr-risk-check-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(iprDir, file), 'utf-8'));
        for (const result of data.results || []) {
          if (!iprScoresCache.has(result.patent_id)) {
            iprScoresCache.set(result.patent_id, {
              patent_id: result.patent_id,
              ipr_risk_score: result.ipr_risk_score,
              ipr_risk_category: result.ipr_risk_category,
              has_ipr_history: result.has_ipr_history,
            });
          }
        }
      } catch (e) {
        console.warn(`Failed to load IPR file ${file}:`, e);
      }
    }
  }

  // 2. Load per-patent cache files (override batch)
  const iprCacheDir = path.join(process.cwd(), 'cache/ipr-scores');
  if (fs.existsSync(iprCacheDir)) {
    const files = fs.readdirSync(iprCacheDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(iprCacheDir, file), 'utf-8'));
        iprScoresCache.set(data.patent_id, {
          patent_id: data.patent_id,
          ipr_risk_score: data.ipr_risk_score,
          ipr_risk_category: data.ipr_risk_category,
          has_ipr_history: data.has_ipr_history,
        });
      } catch (e) {
        // skip invalid files
      }
    }
  }

  console.log(`[Scoring] Loaded IPR risk scores for ${iprScoresCache.size} patents`);
  return iprScoresCache;
}

/**
 * Load all prosecution quality scores from batch output files and per-patent cache.
 * Sources (later entries override earlier):
 *   1. output/prosecution/prosecution-history-*.json (batch output)
 *   2. cache/prosecution-scores/<patent_id>.json (per-patent cache, overrides batch)
 */
export function loadAllProsecutionScores(): Map<string, ProsecutionData> {
  if (prosecutionScoresCache) return prosecutionScoresCache;

  prosecutionScoresCache = new Map();

  // 1. Load from batch output files
  const prosDir = path.join(process.cwd(), 'output/prosecution');
  if (fs.existsSync(prosDir)) {
    const files = fs.readdirSync(prosDir)
      .filter(f => f.startsWith('prosecution-history-') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(prosDir, file), 'utf-8'));
        for (const result of data.results || []) {
          if (!prosecutionScoresCache.has(result.patent_id) && !result.error) {
            prosecutionScoresCache.set(result.patent_id, {
              patent_id: result.patent_id,
              prosecution_quality_score: result.prosecution_quality_score,
              prosecution_quality_category: result.prosecution_quality_category,
            });
          }
        }
      } catch (e) {
        console.warn(`Failed to load prosecution file ${file}:`, e);
      }
    }
  }

  // 2. Load per-patent cache files (override batch)
  const prosCacheDir = path.join(process.cwd(), 'cache/prosecution-scores');
  if (fs.existsSync(prosCacheDir)) {
    const files = fs.readdirSync(prosCacheDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(prosCacheDir, file), 'utf-8'));
        if (!data.error) {
          prosecutionScoresCache.set(data.patent_id, {
            patent_id: data.patent_id,
            prosecution_quality_score: data.prosecution_quality_score,
            prosecution_quality_category: data.prosecution_quality_category,
          });
        }
      } catch (e) {
        // skip invalid files
      }
    }
  }

  console.log(`[Scoring] Loaded prosecution quality scores for ${prosecutionScoresCache.size} patents`);
  return prosecutionScoresCache;
}

/**
 * Load portfolio candidates
 */
function loadCandidates(): any[] {
  if (candidatesCache) return candidatesCache;

  const files = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found in output/');
  }

  const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, files[0]), 'utf-8'));
  candidatesCache = data.candidates;
  return candidatesCache!;
}

/**
 * Clear caches (for testing or reload)
 */
export function clearScoringCache(): void {
  classificationCache = null;
  llmScoresCache = null;
  iprScoresCache = null;
  prosecutionScoresCache = null;
  candidatesCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build PatentMetrics from candidate + classification + LLM + API data
 */
function buildMetrics(
  candidate: any,
  classification: CitationClassification | null,
  llmScores: LlmScores | null,
  iprData: IprRiskData | null,
  prosecutionData: ProsecutionData | null,
): PatentMetrics {
  const competitorCitations = classification?.competitor_citations ?? 0;
  const affiliateCitations = classification?.affiliate_citations ?? 0;
  const neutralCitations = classification?.neutral_citations ?? 0;
  const forwardCitations = candidate.forward_citations ?? classification?.total_forward_citations ?? 0;

  // Adjusted forward citations: weight by source type to discount self-citations
  // and boost competitor citations (see CITATION_CATEGORIZATION_PROBLEM.md)
  const adjustedForward = (
    competitorCitations * CITATION_WEIGHTS.competitor +
    neutralCitations * CITATION_WEIGHTS.neutral +
    affiliateCitations * CITATION_WEIGHTS.affiliate
  );

  // Competitor density: proportion of external (non-affiliate) citations from competitors
  // High density = technology squarely in competitive space
  const externalCitations = competitorCitations + neutralCitations;
  const competitorDensity = externalCitations > 0
    ? competitorCitations / externalCitations
    : 0;

  return {
    patent_id: candidate.patent_id,
    competitor_citations: competitorCitations,
    forward_citations: forwardCitations,
    adjusted_forward_citations: adjustedForward,
    years_remaining: candidate.remaining_years ?? 0,
    competitor_count: classification?.competitor_count ?? 0,
    competitor_density: competitorDensity,
    affiliate_citations: affiliateCitations,
    neutral_citations: neutralCitations,
    total_forward_citations: classification?.total_forward_citations ?? forwardCitations,
    has_citation_data: classification?.has_citation_data ?? false,
    // LLM scores (when available)
    eligibility_score: llmScores?.eligibility_score,
    validity_score: llmScores?.validity_score,
    claim_breadth: llmScores?.claim_breadth,
    enforcement_clarity: llmScores?.enforcement_clarity,
    design_around_difficulty: llmScores?.design_around_difficulty,
    market_relevance_score: llmScores?.market_relevance_score,
    // API-derived scores (when available)
    ipr_risk_score: iprData?.ipr_risk_score,
    prosecution_quality_score: prosecutionData?.prosecution_quality_score,
  };
}

/**
 * Compute year multiplier
 * Higher for patents with more remaining life
 * Even expired patents get a base multiplier of 0.3
 */
function computeYearMultiplier(yearsRemaining: number): number {
  const yearsFactor = Math.min(1, Math.max(0, yearsRemaining) / 15);
  return 0.3 + 0.7 * Math.pow(yearsFactor, 0.8);
}

/**
 * Score a single patent with a given profile
 */
export function scorePatent(metrics: PatentMetrics, profile: ScoringProfile): ScoredPatent {
  const normalizedMetrics: Record<string, number> = {};
  const metricsUsed: string[] = [];

  // Determine which metrics are available
  let availableWeight = 0;
  let totalWeight = 0;

  for (const [metricName, weight] of Object.entries(profile.weights)) {
    if (weight <= 0) continue;
    totalWeight += weight;

    const value = (metrics as any)[metricName];
    const isSparse = LLM_METRICS.has(metricName) || API_METRICS.has(metricName);

    if (isSparse && (value === undefined || value === null)) {
      // LLM/API metric missing — will redistribute weight
      continue;
    }

    availableWeight += weight;
    const normalizer = NORMALIZERS[metricName];
    if (normalizer) {
      normalizedMetrics[metricName] = normalizer(value ?? 0);
      metricsUsed.push(metricName);
    }
  }

  // Compute weighted sum with renormalization for missing metrics
  let baseScore = 0;
  const renormFactor = availableWeight > 0 ? totalWeight / availableWeight : 0;

  for (const metricName of metricsUsed) {
    const weight = profile.weights[metricName] ?? 0;
    const normalizedValue = normalizedMetrics[metricName] ?? 0;
    baseScore += normalizedValue * weight * renormFactor;
  }

  const yearMultiplier = computeYearMultiplier(metrics.years_remaining);
  const finalScore = baseScore * yearMultiplier * 100;

  return {
    patent_id: metrics.patent_id,
    score: Math.round(finalScore * 100) / 100, // 2 decimal places
    normalized_metrics: normalizedMetrics,
    year_multiplier: Math.round(yearMultiplier * 1000) / 1000,
    base_score: Math.round(baseScore * 10000) / 10000,
    metrics_used: metricsUsed,
    profile_id: profile.id,
  };
}

/**
 * Score all patents with a given profile
 */
export function scoreAllPatents(profileId: string): ScoredPatent[] {
  const profile = PROFILES.find(p => p.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`);
  }

  const candidates = loadCandidates();
  const classifications = loadAllClassifications();
  const llmScores = loadAllLlmScores();
  const iprScores = loadAllIprScores();
  const prosecutionScores = loadAllProsecutionScores();

  const scored: ScoredPatent[] = [];

  for (const candidate of candidates) {
    const classification = classifications.get(candidate.patent_id) ?? null;
    const llm = llmScores.get(candidate.patent_id) ?? null;
    const ipr = iprScores.get(candidate.patent_id) ?? null;
    const pros = prosecutionScores.get(candidate.patent_id) ?? null;
    const metrics = buildMetrics(candidate, classification, llm, ipr, pros);
    scored.push(scorePatent(metrics, profile));
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Assign ranks
  for (let i = 0; i < scored.length; i++) {
    scored[i].rank = i + 1;
  }

  return scored;
}

/**
 * Score patents within a specific sector for ranking
 */
export function scorePatentsBySector(profileId: string): Map<string, ScoredPatent[]> {
  const profile = PROFILES.find(p => p.id === profileId);
  if (!profile) {
    throw new Error(`Unknown profile: ${profileId}`);
  }

  const candidates = loadCandidates();
  const classifications = loadAllClassifications();
  const llmScores = loadAllLlmScores();
  const iprScores = loadAllIprScores();
  const prosecutionScores = loadAllProsecutionScores();
  const bySector = new Map<string, ScoredPatent[]>();

  for (const candidate of candidates) {
    const sector = candidate.primary_sector || 'general';
    const classification = classifications.get(candidate.patent_id) ?? null;
    const llm = llmScores.get(candidate.patent_id) ?? null;
    const ipr = iprScores.get(candidate.patent_id) ?? null;
    const pros = prosecutionScores.get(candidate.patent_id) ?? null;
    const metrics = buildMetrics(candidate, classification, llm, ipr, pros);
    const scored = scorePatent(metrics, profile);

    if (!bySector.has(sector)) {
      bySector.set(sector, []);
    }
    bySector.get(sector)!.push(scored);
  }

  // Sort within each sector and assign within-sector ranks
  for (const [_, patents] of bySector) {
    patents.sort((a, b) => b.score - a.score);
    for (let i = 0; i < patents.length; i++) {
      patents[i].rank = i + 1;
    }
  }

  return bySector;
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 Enhanced Scoring (custom weights, scaling, inversion)
// ─────────────────────────────────────────────────────────────────────────────

export type ScalingType = 'linear' | 'log' | 'sqrt';

export interface V2EnhancedConfig {
  weights: Record<string, number>;
  scaling: Record<string, ScalingType>;
  invert: Record<string, boolean>;
  topN: number;
  llmEnhancedOnly: boolean;
}

export interface V2EnhancedScoredPatent {
  patent_id: string;
  rank: number;
  rank_change?: number;
  score: number;
  normalized_metrics: Record<string, number>;
  raw_metrics: Record<string, number>;
  metrics_used: string[];
  year_multiplier: number;
  has_llm_data: boolean;
  // Patent metadata
  patent_title: string;
  patent_date: string;
  assignee: string;
  primary_sector: string;
  super_sector: string;
  years_remaining: number;
}

// Max values for normalization (used with scaling functions)
const METRIC_MAX_VALUES: Record<string, number> = {
  competitor_citations: 20,
  forward_citations: 900,
  adjusted_forward_citations: 900,
  years_remaining: 15,
  competitor_count: 5,
  competitor_density: 1,
  // LLM/API scores are 1-5, normalized separately
  eligibility_score: 4,
  validity_score: 4,
  claim_breadth: 4,
  enforcement_clarity: 4,
  design_around_difficulty: 4,
  market_relevance_score: 4,
  ipr_risk_score: 4,
  prosecution_quality_score: 4,
};

// Scaling functions
const SCALING_FUNCTIONS: Record<ScalingType, (value: number, max: number) => number> = {
  linear: (v, max) => Math.min(1, v / max),
  log: (v, max) => max > 0 ? Math.min(1, Math.log10(v + 1) / Math.log10(max + 1)) : 0,
  sqrt: (v, max) => max > 0 ? Math.min(1, Math.sqrt(v) / Math.sqrt(max)) : 0,
};

/**
 * Normalize a metric value with custom scaling and optional inversion
 */
function normalizeWithScaling(
  metricName: string,
  rawValue: number,
  scaling: ScalingType,
  invert: boolean
): number {
  // LLM/API scores are 1-5, need special handling
  const isScoreMetric = LLM_METRICS.has(metricName) || API_METRICS.has(metricName);

  let normalized: number;
  if (isScoreMetric) {
    // Convert 1-5 to 0-1, then apply scaling
    const base = Math.max(0, (rawValue - 1) / 4);
    // Scaling doesn't make much sense for 0-1 scores, but support it
    const scaleFunc = SCALING_FUNCTIONS[scaling];
    normalized = scaleFunc(base, 1);
  } else {
    const max = METRIC_MAX_VALUES[metricName] || 100;
    const scaleFunc = SCALING_FUNCTIONS[scaling];
    normalized = scaleFunc(rawValue, max);
  }

  // Apply inversion if requested
  if (invert) {
    normalized = 1 - normalized;
  }

  return Math.max(0, Math.min(1, normalized));
}

/**
 * Default V2 Enhanced configuration
 */
export const DEFAULT_V2_ENHANCED_CONFIG: V2EnhancedConfig = {
  weights: {
    // Quantitative (60% total)
    competitor_citations: 20,
    adjusted_forward_citations: 10,
    years_remaining: 15,
    competitor_count: 5,
    competitor_density: 5,
    // LLM-Derived (30% total)
    eligibility_score: 5,
    validity_score: 5,
    claim_breadth: 4,
    enforcement_clarity: 6,
    design_around_difficulty: 5,
    market_relevance_score: 5,
    // API-Derived (10% total)
    ipr_risk_score: 5,
    prosecution_quality_score: 5,
  },
  scaling: {
    competitor_citations: 'linear',
    adjusted_forward_citations: 'sqrt',
    years_remaining: 'linear',
    competitor_count: 'linear',
    competitor_density: 'linear',
    eligibility_score: 'linear',
    validity_score: 'linear',
    claim_breadth: 'linear',
    enforcement_clarity: 'linear',
    design_around_difficulty: 'linear',
    market_relevance_score: 'linear',
    ipr_risk_score: 'linear',
    prosecution_quality_score: 'linear',
  },
  invert: {},
  topN: 100,
  llmEnhancedOnly: true,
};

/**
 * V2 Enhanced built-in presets
 */
export const V2_ENHANCED_PRESETS = [
  {
    id: 'default',
    name: 'Default Balanced',
    description: 'Balanced weights across all metrics',
    isBuiltIn: true,
    weights: { ...DEFAULT_V2_ENHANCED_CONFIG.weights },
    scaling: { ...DEFAULT_V2_ENHANCED_CONFIG.scaling },
    invert: {},
  },
  {
    id: 'litigation',
    name: 'Litigation Focus',
    description: 'Emphasizes enforcement clarity and design-around difficulty',
    isBuiltIn: true,
    weights: {
      competitor_citations: 15,
      adjusted_forward_citations: 5,
      years_remaining: 10,
      competitor_count: 5,
      competitor_density: 5,
      eligibility_score: 8,
      validity_score: 7,
      claim_breadth: 5,
      enforcement_clarity: 15,
      design_around_difficulty: 10,
      market_relevance_score: 3,
      ipr_risk_score: 7,
      prosecution_quality_score: 5,
    },
    scaling: { ...DEFAULT_V2_ENHANCED_CONFIG.scaling },
    invert: {},
  },
  {
    id: 'licensing',
    name: 'Licensing Focus',
    description: 'Emphasizes claim breadth and market relevance',
    isBuiltIn: true,
    weights: {
      competitor_citations: 18,
      adjusted_forward_citations: 8,
      years_remaining: 15,
      competitor_count: 5,
      competitor_density: 4,
      eligibility_score: 5,
      validity_score: 5,
      claim_breadth: 10,
      enforcement_clarity: 4,
      design_around_difficulty: 3,
      market_relevance_score: 10,
      ipr_risk_score: 5,
      prosecution_quality_score: 3,
    },
    scaling: { ...DEFAULT_V2_ENHANCED_CONFIG.scaling },
    invert: {},
  },
  {
    id: 'defensive',
    name: 'Defensive',
    description: 'Emphasizes validity and IPR risk',
    isBuiltIn: true,
    weights: {
      competitor_citations: 10,
      adjusted_forward_citations: 8,
      years_remaining: 12,
      competitor_count: 3,
      competitor_density: 4,
      eligibility_score: 6,
      validity_score: 12,
      claim_breadth: 8,
      enforcement_clarity: 4,
      design_around_difficulty: 6,
      market_relevance_score: 4,
      ipr_risk_score: 12,
      prosecution_quality_score: 6,
    },
    scaling: { ...DEFAULT_V2_ENHANCED_CONFIG.scaling },
    invert: {},
  },
  {
    id: 'quick_wins',
    name: 'Quick Wins',
    description: 'High-confidence, clear enforcement opportunities',
    isBuiltIn: true,
    weights: {
      competitor_citations: 15,
      adjusted_forward_citations: 5,
      years_remaining: 8,
      competitor_count: 5,
      competitor_density: 5,
      eligibility_score: 12,
      validity_score: 10,
      claim_breadth: 4,
      enforcement_clarity: 15,
      design_around_difficulty: 3,
      market_relevance_score: 4,
      ipr_risk_score: 8,
      prosecution_quality_score: 6,
    },
    scaling: { ...DEFAULT_V2_ENHANCED_CONFIG.scaling },
    invert: {},
  },
];

/**
 * Score patents with V2 Enhanced custom configuration
 */
export function scoreWithCustomConfig(
  config: V2EnhancedConfig,
  previousRankings?: Map<string, number>
): V2EnhancedScoredPatent[] {
  const candidates = loadCandidates();
  const classifications = loadAllClassifications();
  const llmScores = loadAllLlmScores();
  const iprScores = loadAllIprScores();
  const prosecutionScores = loadAllProsecutionScores();

  // Normalize weights to sum to 1
  const totalWeight = Object.values(config.weights).reduce((sum, w) => sum + w, 0);
  const normalizedWeights: Record<string, number> = {};
  for (const [key, value] of Object.entries(config.weights)) {
    normalizedWeights[key] = totalWeight > 0 ? value / totalWeight : 0;
  }

  const scored: V2EnhancedScoredPatent[] = [];

  for (const candidate of candidates) {
    const patentId = candidate.patent_id;
    const classification = classifications.get(patentId) ?? null;
    const llm = llmScores.get(patentId) ?? null;
    const ipr = iprScores.get(patentId) ?? null;
    const pros = prosecutionScores.get(patentId) ?? null;

    const hasLlmData = llm !== null;

    // Filter to LLM-enhanced only if requested
    if (config.llmEnhancedOnly && !hasLlmData) {
      continue;
    }

    // Build raw metrics
    const metrics = buildMetrics(candidate, classification, llm, ipr, pros);
    const rawMetrics: Record<string, number> = {
      competitor_citations: metrics.competitor_citations,
      adjusted_forward_citations: metrics.adjusted_forward_citations,
      years_remaining: metrics.years_remaining,
      competitor_count: metrics.competitor_count,
      competitor_density: metrics.competitor_density,
    };

    // Add LLM metrics if available
    if (llm) {
      rawMetrics.eligibility_score = llm.eligibility_score;
      rawMetrics.validity_score = llm.validity_score;
      rawMetrics.claim_breadth = llm.claim_breadth;
      rawMetrics.enforcement_clarity = llm.enforcement_clarity;
      rawMetrics.design_around_difficulty = llm.design_around_difficulty;
      if (llm.market_relevance_score !== undefined) {
        rawMetrics.market_relevance_score = llm.market_relevance_score;
      }
    }

    // Add API metrics if available
    if (ipr) {
      rawMetrics.ipr_risk_score = ipr.ipr_risk_score;
    }
    if (pros) {
      rawMetrics.prosecution_quality_score = pros.prosecution_quality_score;
    }

    // Normalize and score
    const normalizedMetrics: Record<string, number> = {};
    const metricsUsed: string[] = [];
    let availableWeight = 0;

    for (const [metricName, weight] of Object.entries(normalizedWeights)) {
      if (weight <= 0) continue;

      const rawValue = rawMetrics[metricName];
      const isSparse = LLM_METRICS.has(metricName) || API_METRICS.has(metricName);

      if (isSparse && (rawValue === undefined || rawValue === null)) {
        continue;
      }

      const scaling = config.scaling[metricName] || 'linear';
      const invert = config.invert[metricName] || false;
      normalizedMetrics[metricName] = normalizeWithScaling(metricName, rawValue ?? 0, scaling, invert);
      metricsUsed.push(metricName);
      availableWeight += weight;
    }

    // Compute weighted sum with renormalization
    let baseScore = 0;
    const renormFactor = availableWeight > 0 ? 1 / availableWeight : 0;

    for (const metricName of metricsUsed) {
      const weight = normalizedWeights[metricName] ?? 0;
      const normalizedValue = normalizedMetrics[metricName] ?? 0;
      baseScore += normalizedValue * weight * renormFactor;
    }

    const yearMultiplier = computeYearMultiplier(metrics.years_remaining);
    const finalScore = baseScore * yearMultiplier * 100;

    scored.push({
      patent_id: patentId,
      rank: 0, // Will be set after sorting
      score: Math.round(finalScore * 100) / 100,
      normalized_metrics: normalizedMetrics,
      raw_metrics: rawMetrics,
      metrics_used: metricsUsed,
      year_multiplier: Math.round(yearMultiplier * 1000) / 1000,
      has_llm_data: hasLlmData,
      patent_title: candidate.patent_title || '',
      patent_date: candidate.patent_date || '',
      assignee: candidate.assignee || '',
      primary_sector: candidate.primary_sector || 'general',
      super_sector: candidate.super_sector || '',
      years_remaining: metrics.years_remaining,
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Assign ranks and calculate rank changes
  for (let i = 0; i < scored.length; i++) {
    scored[i].rank = i + 1;
    if (previousRankings) {
      const prevRank = previousRankings.get(scored[i].patent_id);
      if (prevRank !== undefined) {
        scored[i].rank_change = prevRank - scored[i].rank;
      }
    }
  }

  // Return top N
  return scored.slice(0, config.topN);
}

/**
 * Get V2 Enhanced presets in format expected by frontend
 */
export function getV2EnhancedPresets() {
  return V2_ENHANCED_PRESETS.map(preset => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    isBuiltIn: preset.isBuiltIn,
    config: {
      weights: preset.weights,
      scaling: preset.scaling,
      invert: preset.invert,
      topN: DEFAULT_V2_ENHANCED_CONFIG.topN,
      llmEnhancedOnly: DEFAULT_V2_ENHANCED_CONFIG.llmEnhancedOnly,
    },
  }));
}

/**
 * Get list of all available metrics for V2 Enhanced scoring
 * Returns flat array with category field for frontend consumption
 */
export function getV2EnhancedMetrics() {
  const defaultConfig = DEFAULT_V2_ENHANCED_CONFIG;

  const metrics = [
    // Quantitative metrics
    { key: 'competitor_citations', label: 'Competitor Citations', category: 'quantitative' as const, description: 'Citations from tracked competitors' },
    { key: 'adjusted_forward_citations', label: 'Adj. Forward Citations', category: 'quantitative' as const, description: 'Forward citations weighted by source (competitor > neutral > affiliate)' },
    { key: 'years_remaining', label: 'Years Remaining', category: 'quantitative' as const, description: 'Patent life remaining' },
    { key: 'competitor_count', label: 'Competitor Count', category: 'quantitative' as const, description: 'Number of distinct competitors citing' },
    { key: 'competitor_density', label: 'Competitor Density', category: 'quantitative' as const, description: 'Ratio of competitor to external citations' },
    // LLM metrics
    { key: 'eligibility_score', label: 'Eligibility', category: 'llm' as const, description: '35 USC 101 strength (1-5)' },
    { key: 'validity_score', label: 'Validity', category: 'llm' as const, description: 'Prior art defensibility (1-5)' },
    { key: 'claim_breadth', label: 'Claim Breadth', category: 'llm' as const, description: 'Scope of claims (1-5)' },
    { key: 'enforcement_clarity', label: 'Enforcement Clarity', category: 'llm' as const, description: 'Detectability of infringement (1-5)' },
    { key: 'design_around_difficulty', label: 'Design-Around Difficulty', category: 'llm' as const, description: 'Difficulty to design around (1-5)' },
    { key: 'market_relevance_score', label: 'Market Relevance', category: 'llm' as const, description: 'Commercial applicability (1-5)' },
    // API metrics
    { key: 'ipr_risk_score', label: 'IPR Risk', category: 'api' as const, description: 'PTAB challenge risk (5=safe, 1=risky)' },
    { key: 'prosecution_quality_score', label: 'Prosecution Quality', category: 'api' as const, description: 'File wrapper quality (1-5)' },
  ];

  return metrics.map(m => ({
    ...m,
    defaultWeight: defaultConfig.weights[m.key] ?? 0,
    defaultScaling: defaultConfig.scaling[m.key] ?? 'linear',
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all available profiles
 */
export function getProfiles(): ScoringProfile[] {
  return PROFILES;
}

/**
 * Get a specific profile by ID
 */
export function getProfile(profileId: string): ScoringProfile | undefined {
  return PROFILES.find(p => p.id === profileId);
}

/**
 * Get the default profile ID
 */
export function getDefaultProfileId(): string {
  return 'executive';
}

/**
 * Get LLM coverage statistics
 */
export function getLlmStats(): {
  total_patents: number;
  patents_with_llm: number;
  coverage_pct: number;
  patents_with_ipr: number;
  ipr_coverage_pct: number;
  patents_with_prosecution: number;
  prosecution_coverage_pct: number;
  patents_with_market_relevance: number;
  market_relevance_coverage_pct: number;
} {
  const candidates = loadCandidates();
  const llmScores = loadAllLlmScores();
  const iprScores = loadAllIprScores();
  const prosecutionScores = loadAllProsecutionScores();
  const total = candidates.length;

  // Count market_relevance separately (subset of LLM)
  let withMarketRelevance = 0;
  for (const [_, scores] of llmScores) {
    if (scores.market_relevance_score !== undefined && scores.market_relevance_score !== null) {
      withMarketRelevance++;
    }
  }

  return {
    total_patents: total,
    patents_with_llm: llmScores.size,
    coverage_pct: total > 0 ? Math.round(llmScores.size / total * 1000) / 10 : 0,
    patents_with_ipr: iprScores.size,
    ipr_coverage_pct: total > 0 ? Math.round(iprScores.size / total * 1000) / 10 : 0,
    patents_with_prosecution: prosecutionScores.size,
    prosecution_coverage_pct: total > 0 ? Math.round(prosecutionScores.size / total * 1000) / 10 : 0,
    patents_with_market_relevance: withMarketRelevance,
    market_relevance_coverage_pct: total > 0 ? Math.round(withMarketRelevance / total * 1000) / 10 : 0,
  };
}
