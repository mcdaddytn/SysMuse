/**
 * Scoring Service (P-0b)
 *
 * Implements V3 patent scoring with configurable weight profiles.
 *
 * Formula:
 *   score = Σ(normalized_metric × adjusted_weight) × year_multiplier × 100
 *
 * Normalization:
 *   competitor_citations:    min(1, cc / 20)
 *   forward_citations:       min(1, sqrt(fc) / 30)
 *   years_remaining:         min(1, years / 15)
 *   competitor_count:        min(1, count / 5)
 *   LLM scores (1-5):       (score - 1) / 4
 *
 * Year multiplier:
 *   0.3 + 0.7 × (yearsFactor ^ 0.8)
 *   where yearsFactor = min(1, years / 15)
 *
 * When LLM metrics are unavailable (95% of patents), their weights
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
  years_remaining: number;
  competitor_count: number;
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
// Normalization functions
// ─────────────────────────────────────────────────────────────────────────────

const NORMALIZERS: Record<string, (value: number) => number> = {
  competitor_citations: (v) => Math.min(1, v / 20),
  forward_citations: (v) => Math.min(1, Math.sqrt(v) / 30),
  years_remaining: (v) => Math.min(1, v / 15),
  competitor_count: (v) => Math.min(1, v / 5),
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
  'years_remaining',
  'competitor_count',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Profiles
// ─────────────────────────────────────────────────────────────────────────────

const PROFILES: ScoringProfile[] = [
  {
    id: 'executive',
    displayName: 'Executive',
    description: 'Balanced scoring for executive-level portfolio overview',
    category: 'balanced',
    weights: {
      competitor_citations: 0.25,
      forward_citations: 0.13,
      years_remaining: 0.17,
      competitor_count: 0.08,
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
    description: 'Litigation-focused, prioritizes enforcement and competitor citations',
    category: 'aggressive',
    weights: {
      competitor_citations: 0.22,
      forward_citations: 0.04,
      years_remaining: 0.08,
      competitor_count: 0.04,
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
    description: 'Even distribution for licensing negotiations and portfolio management',
    category: 'moderate',
    weights: {
      competitor_citations: 0.17,
      forward_citations: 0.08,
      years_remaining: 0.13,
      competitor_count: 0.04,
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
    description: 'Emphasizes validity and breadth for cross-licensing leverage',
    category: 'conservative',
    weights: {
      competitor_citations: 0.08,
      forward_citations: 0.12,
      years_remaining: 0.08,
      competitor_count: 0.04,
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
    description: 'Broad coverage and market presence for licensing campaigns',
    category: 'licensing',
    weights: {
      competitor_citations: 0.25,
      forward_citations: 0.08,
      years_remaining: 0.17,
      competitor_count: 0.08,
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
    description: 'High-confidence, clear enforcement opportunities',
    category: 'quick_wins',
    weights: {
      competitor_citations: 0.17,
      forward_citations: 0.04,
      years_remaining: 0.08,
      competitor_count: 0.04,
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
  return {
    patent_id: candidate.patent_id,
    competitor_citations: classification?.competitor_citations ?? 0,
    forward_citations: candidate.forward_citations ?? classification?.total_forward_citations ?? 0,
    years_remaining: candidate.remaining_years ?? 0,
    competitor_count: classification?.competitor_count ?? 0,
    affiliate_citations: classification?.affiliate_citations ?? 0,
    neutral_citations: classification?.neutral_citations ?? 0,
    total_forward_citations: classification?.total_forward_citations ?? candidate.forward_citations ?? 0,
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
