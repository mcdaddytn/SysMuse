#!/usr/bin/env npx tsx
/**
 * Formula Engine Regression Tests
 *
 * Verifies that the new formula engine produces identical scores to:
 *   1. scorePatent() from scoring-service.ts (V2 with hardcoded profiles)
 *   2. scoreWithCustomConfig() from scoring-service.ts (V2 Enhanced)
 *   3. calculateCompositeScore() from scoring-template-service.ts (LLM Composite)
 *
 * Run: npx tsx scripts/test-formula-engine.ts
 */

import {
  scorePatent,
  CITATION_WEIGHTS,
  type PatentMetrics,
  type ScoringProfile,
} from '../src/api/services/scoring-service.js';

import { calculateCompositeScore } from '../src/api/services/scoring-template-service.js';

import {
  evaluateFormula,
  metricTerm,
  linearScaling,
  sqrtScaling,
  rangeScaling,
} from '../src/api/services/formula-engine.js';

import type {
  FormulaStructure,
  ScalingConfig,
} from '../src/api/services/formula-types.js';

// =============================================================================
// Test fixtures — sample patents with known metric values
// =============================================================================

const PATENT_WITH_ALL_DATA: PatentMetrics = {
  patent_id: 'US-10000001-B2',
  competitor_citations: 12,
  forward_citations: 45,
  adjusted_forward_citations: 38.5, // competitor×1.5 + neutral×1.0 + affiliate×0.25
  years_remaining: 8,
  competitor_count: 3,
  competitor_density: 0.6,
  affiliate_citations: 5,
  neutral_citations: 20,
  total_forward_citations: 45,
  has_citation_data: true,
  eligibility_score: 4,
  validity_score: 3,
  claim_breadth: 4,
  enforcement_clarity: 5,
  design_around_difficulty: 3,
  market_relevance_score: 4,
  ipr_risk_score: 2,
  prosecution_quality_score: 4,
};

const PATENT_NO_LLM: PatentMetrics = {
  patent_id: 'US-10000002-B2',
  competitor_citations: 8,
  forward_citations: 120,
  adjusted_forward_citations: 95,
  years_remaining: 12,
  competitor_count: 5,
  competitor_density: 0.45,
  affiliate_citations: 10,
  neutral_citations: 60,
  total_forward_citations: 120,
  has_citation_data: true,
  // No LLM or API scores
};

const PATENT_EXPIRED: PatentMetrics = {
  patent_id: 'US-10000003-B2',
  competitor_citations: 25,
  forward_citations: 200,
  adjusted_forward_citations: 180,
  years_remaining: 0,
  competitor_count: 4,
  competitor_density: 0.8,
  affiliate_citations: 2,
  neutral_citations: 100,
  total_forward_citations: 200,
  has_citation_data: true,
  eligibility_score: 5,
  validity_score: 5,
  claim_breadth: 5,
  enforcement_clarity: 4,
  design_around_difficulty: 5,
  market_relevance_score: 5,
};

const PATENT_LOW_SCORES: PatentMetrics = {
  patent_id: 'US-10000004-B2',
  competitor_citations: 1,
  forward_citations: 3,
  adjusted_forward_citations: 2,
  years_remaining: 2,
  competitor_count: 1,
  competitor_density: 0.1,
  affiliate_citations: 1,
  neutral_citations: 2,
  total_forward_citations: 3,
  has_citation_data: true,
  eligibility_score: 2,
  validity_score: 1,
  claim_breadth: 2,
  enforcement_clarity: 1,
  design_around_difficulty: 2,
  market_relevance_score: 1,
};

const TEST_PATENTS = [PATENT_WITH_ALL_DATA, PATENT_NO_LLM, PATENT_EXPIRED, PATENT_LOW_SCORES];

// =============================================================================
// V2 formula definition — matches scoring-service.ts hardcoded logic
// =============================================================================

/**
 * Build the V2 formula structure matching scorePatent() exactly.
 *
 * scorePatent uses NORMALIZERS (hardcoded per metric) not the scaling toggle.
 * The scoring profiles use weights 0-0.25 that sum to ~1.0.
 * sparseHandling: renormalize matches the renormFactor = totalWeight/availableWeight pattern.
 *
 * Key difference: scorePatent() does NOT normalize weights first (they already sum to ~1).
 * It computes: baseScore = Σ(norm_i × weight_i × (totalWeight / availableWeight))
 */
function buildV2HardcodedFormula(): FormulaStructure {
  return {
    version: 1,
    outputScale: 100,
    terms: [
      metricTerm('competitor_citations', linearScaling(20)),
      metricTerm('adjusted_forward_citations', sqrtScaling(900)),
      metricTerm('years_remaining', linearScaling(15)),
      metricTerm('competitor_count', linearScaling(5)),
      metricTerm('competitor_density', linearScaling(1)),
      metricTerm('eligibility_score', rangeScaling(1, 5), { sparseGroup: 'llm' }),
      metricTerm('validity_score', rangeScaling(1, 5), { sparseGroup: 'llm' }),
      metricTerm('claim_breadth', rangeScaling(1, 5), { sparseGroup: 'llm' }),
      metricTerm('enforcement_clarity', rangeScaling(1, 5), { sparseGroup: 'llm' }),
      metricTerm('design_around_difficulty', rangeScaling(1, 5), { sparseGroup: 'llm' }),
      metricTerm('market_relevance_score', rangeScaling(1, 5), { sparseGroup: 'llm' }),
      metricTerm('ipr_risk_score', rangeScaling(1, 5), { sparseGroup: 'api' }),
      metricTerm('prosecution_quality_score', rangeScaling(1, 5), { sparseGroup: 'api' }),
    ],
    multipliers: [
      {
        attribute: 'years_remaining',
        fn: 'linear_floor',
        params: { floor: 0.3, ceiling: 1.0, scale: 15, exponent: 0.8 },
      },
    ],
    sparseHandling: 'renormalize',
  };
}

/**
 * Build the V2 Enhanced formula structure matching scoreWithCustomConfig().
 *
 * scoreWithCustomConfig first normalizes weights to sum to 1 (normalizedWeights[key] = value/totalWeight),
 * then computes renormFactor = 1/availableWeight (where availableWeight is sum of normalized weights of present metrics).
 * baseScore = Σ(norm_i × normalizedWeight_i × renormFactor)
 *
 * The formula engine with sparseHandling='renormalize' does:
 * baseScore = Σ(norm_i × (w_i/totalW) × (1/availW))
 *
 * This is identical because normalizedWeight_i = w_i/totalW, and renormFactor = 1/availableWeight
 * where availableWeight is computed from normalizedWeights (which sum to 1 minus missing).
 *
 * However, the existing code also applies scaling per-metric (linear/log/sqrt) via normalizeWithScaling().
 * For the V2 Enhanced case, scaling overrides come from the frontend config.
 *
 * The formula definition uses default scaling configs matching the NORMALIZERS,
 * and the engine accepts scalingOverrides for frontend-driven scaling changes.
 */
function buildV2EnhancedFormula(): FormulaStructure {
  // Same structure as hardcoded V2 — the difference is in how weights are supplied
  // (as integers summing to 100 from frontend, vs fractions summing to ~1 from profiles)
  return buildV2HardcodedFormula();
}

// =============================================================================
// LLM Composite formula definition — matches scoring-template-service.ts
// =============================================================================

function buildLlmCompositeFormula(): FormulaStructure {
  return {
    version: 1,
    outputScale: 100,
    terms: [
      metricTerm('technical_novelty', rangeScaling(1, 10)),
      metricTerm('claim_breadth', rangeScaling(1, 10)),
      metricTerm('design_around_difficulty', rangeScaling(1, 10)),
      metricTerm('market_relevance', rangeScaling(1, 10)),
      metricTerm('implementation_clarity', rangeScaling(1, 10)),
      metricTerm('standards_relevance', rangeScaling(1, 10)),
      metricTerm('unique_value', rangeScaling(1, 10)),
    ],
    multipliers: [],
    sparseHandling: 'zero',
  };
}

// =============================================================================
// Test runner
// =============================================================================

let passed = 0;
let failed = 0;

function assert(label: string, actual: number, expected: number, tolerance: number = 0.01) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) {
    passed++;
    console.log(`  ✓ ${label}: ${actual} ≈ ${expected} (diff=${diff.toFixed(6)})`);
  } else {
    failed++;
    console.error(`  ✗ ${label}: ${actual} ≠ ${expected} (diff=${diff.toFixed(6)}, tolerance=${tolerance})`);
  }
}

function metricsToRaw(m: PatentMetrics): Record<string, number | undefined> {
  return {
    competitor_citations: m.competitor_citations,
    adjusted_forward_citations: m.adjusted_forward_citations,
    years_remaining: m.years_remaining,
    competitor_count: m.competitor_count,
    competitor_density: m.competitor_density,
    eligibility_score: m.eligibility_score,
    validity_score: m.validity_score,
    claim_breadth: m.claim_breadth,
    enforcement_clarity: m.enforcement_clarity,
    design_around_difficulty: m.design_around_difficulty,
    market_relevance_score: m.market_relevance_score,
    ipr_risk_score: m.ipr_risk_score,
    prosecution_quality_score: m.prosecution_quality_score,
  };
}

// =============================================================================
// Test 1: V2 hardcoded profiles — scorePatent() vs evaluateFormula()
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 1: V2 Hardcoded Profiles — scorePatent() vs evaluateFormula()');
console.log('═══════════════════════════════════════════════════════════════\n');

// Import the profiles from scoring-service
// We need to access them — they're not exported, so we define matching weights here.
const PROFILE_WEIGHTS: Record<string, Record<string, number>> = {
  executive: {
    competitor_citations: 0.25,
    adjusted_forward_citations: 0.11,
    years_remaining: 0.17,
    competitor_count: 0.05,
    competitor_density: 0.05,
    eligibility_score: 0.05,
    validity_score: 0.05,
    claim_breadth: 0.04,
    enforcement_clarity: 0.04,
    design_around_difficulty: 0.04,
    market_relevance_score: 0.05,
    ipr_risk_score: 0.05,
    prosecution_quality_score: 0.05,
  },
  aggressive: {
    competitor_citations: 0.22,
    adjusted_forward_citations: 0.02,
    years_remaining: 0.08,
    competitor_count: 0.02,
    competitor_density: 0.04,
    eligibility_score: 0.10,
    validity_score: 0.07,
    claim_breadth: 0.04,
    enforcement_clarity: 0.17,
    design_around_difficulty: 0.09,
    market_relevance_score: 0.03,
    ipr_risk_score: 0.07,
    prosecution_quality_score: 0.05,
  },
  conservative: {
    competitor_citations: 0.08,
    adjusted_forward_citations: 0.10,
    years_remaining: 0.08,
    competitor_count: 0.02,
    competitor_density: 0.04,
    eligibility_score: 0.07,
    validity_score: 0.18,
    claim_breadth: 0.13,
    enforcement_clarity: 0.04,
    design_around_difficulty: 0.08,
    market_relevance_score: 0.03,
    ipr_risk_score: 0.07,
    prosecution_quality_score: 0.08,
  },
};

const v2Formula = buildV2HardcodedFormula();
const profiles: ScoringProfile[] = [
  { id: 'executive', displayName: 'Executive', description: '', category: 'balanced', weights: PROFILE_WEIGHTS.executive },
  { id: 'aggressive', displayName: 'Aggressive', description: '', category: 'aggressive', weights: PROFILE_WEIGHTS.aggressive },
  { id: 'conservative', displayName: 'Conservative', description: '', category: 'conservative', weights: PROFILE_WEIGHTS.conservative },
];

for (const profile of profiles) {
  console.log(`\n  Profile: ${profile.id}`);
  for (const patent of TEST_PATENTS) {
    const oldResult = scorePatent(patent, profile);
    const newResult = evaluateFormula(v2Formula, profile.weights, metricsToRaw(patent));

    assert(
      `${patent.patent_id} (${profile.id})`,
      newResult.score,
      oldResult.score,
    );
  }
}

// =============================================================================
// Test 2: V2 Enhanced — scoreWithCustomConfig() math verification
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 2: V2 Enhanced — weight normalization + scaling');
console.log('═══════════════════════════════════════════════════════════════\n');

// V2 Enhanced uses integer weights that get normalized to sum to 1.
// The formula engine with sparseHandling='renormalize' should handle this identically.
const v2EnhancedWeights: Record<string, number> = {
  competitor_citations: 20,
  adjusted_forward_citations: 10,
  years_remaining: 15,
  competitor_count: 5,
  competitor_density: 5,
  eligibility_score: 5,
  validity_score: 5,
  claim_breadth: 4,
  enforcement_clarity: 6,
  design_around_difficulty: 5,
  market_relevance_score: 5,
  ipr_risk_score: 5,
  prosecution_quality_score: 5,
};

// Manually compute scoreWithCustomConfig result for verification
function manualV2Enhanced(
  rawMetrics: Record<string, number | undefined>,
  weights: Record<string, number>,
): number {
  const LLM = new Set(['eligibility_score', 'validity_score', 'claim_breadth', 'enforcement_clarity', 'design_around_difficulty', 'market_relevance_score']);
  const API = new Set(['ipr_risk_score', 'prosecution_quality_score']);
  const MAX_VALUES: Record<string, number> = {
    competitor_citations: 20,
    adjusted_forward_citations: 900,
    years_remaining: 15,
    competitor_count: 5,
    competitor_density: 1,
  };

  const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
  const normalizedWeights: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) {
    normalizedWeights[k] = totalWeight > 0 ? v / totalWeight : 0;
  }

  let availableWeight = 0;
  const normalizedMetrics: Record<string, number> = {};
  const metricsUsed: string[] = [];

  for (const [metricName, weight] of Object.entries(normalizedWeights)) {
    if (weight <= 0) continue;
    const rawValue = rawMetrics[metricName];
    const isSparse = LLM.has(metricName) || API.has(metricName);
    if (isSparse && (rawValue === undefined || rawValue === null)) continue;

    // Normalize: LLM/API = (v-1)/4, quantitative = linear
    let normalized: number;
    if (LLM.has(metricName) || API.has(metricName)) {
      const base = Math.max(0, ((rawValue ?? 0) - 1) / 4);
      normalized = Math.min(1, base); // linear scaling of 0-1 value
    } else {
      const max = MAX_VALUES[metricName] || 100;
      const val = rawValue ?? 0;
      // Default scaling is 'linear': min(1, v/max)
      if (metricName === 'adjusted_forward_citations') {
        // Default uses 'sqrt' scaling
        normalized = max > 0 ? Math.min(1, Math.sqrt(val) / Math.sqrt(max)) : 0;
      } else {
        normalized = Math.min(1, val / max);
      }
    }
    normalized = Math.max(0, Math.min(1, normalized));

    normalizedMetrics[metricName] = normalized;
    metricsUsed.push(metricName);
    availableWeight += weight;
  }

  let baseScore = 0;
  const renormFactor = availableWeight > 0 ? 1 / availableWeight : 0;
  for (const metricName of metricsUsed) {
    const weight = normalizedWeights[metricName] ?? 0;
    baseScore += normalizedMetrics[metricName] * weight * renormFactor;
  }

  const yearsRemaining = (rawMetrics['years_remaining'] ?? 0) as number;
  const yearsFactor = Math.min(1, Math.max(0, yearsRemaining) / 15);
  const yearMultiplier = 0.3 + 0.7 * Math.pow(yearsFactor, 0.8);

  return Math.round(baseScore * yearMultiplier * 100 * 100) / 100;
}

// Build V2 Enhanced formula — same structure, but note sqrt scaling for adjusted_forward_citations
const v2EnhancedFormula: FormulaStructure = {
  ...buildV2HardcodedFormula(),
  // Override adjusted_forward_citations to use sqrt (matching DEFAULT_V2_ENHANCED_CONFIG.scaling)
};

for (const patent of TEST_PATENTS) {
  const raw = metricsToRaw(patent);
  const expected = manualV2Enhanced(raw, v2EnhancedWeights);
  const actual = evaluateFormula(v2EnhancedFormula, v2EnhancedWeights, raw);
  assert(
    `V2Enhanced ${patent.patent_id}`,
    actual.score,
    expected,
  );
}

// =============================================================================
// Test 3: LLM Composite — calculateCompositeScore() vs evaluateFormula()
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 3: LLM Composite — calculateCompositeScore() vs evaluateFormula()');
console.log('═══════════════════════════════════════════════════════════════\n');

interface ScoringQuestion {
  fieldName: string;
  displayName: string;
  question: string;
  answerType: 'numeric' | 'categorical' | 'text';
  scale?: { min: number; max: number };
  weight: number;
  requiresReasoning: boolean;
}

interface MetricScore {
  score: number;
  reasoning: string;
}

const PORTFOLIO_QUESTIONS: ScoringQuestion[] = [
  { fieldName: 'technical_novelty', displayName: 'Technical Novelty', question: '', answerType: 'numeric', scale: { min: 1, max: 10 }, weight: 0.20, requiresReasoning: false },
  { fieldName: 'claim_breadth', displayName: 'Claim Breadth', question: '', answerType: 'numeric', scale: { min: 1, max: 10 }, weight: 0.15, requiresReasoning: false },
  { fieldName: 'design_around_difficulty', displayName: 'Design Around', question: '', answerType: 'numeric', scale: { min: 1, max: 10 }, weight: 0.20, requiresReasoning: false },
  { fieldName: 'market_relevance', displayName: 'Market Relevance', question: '', answerType: 'numeric', scale: { min: 1, max: 10 }, weight: 0.15, requiresReasoning: false },
  { fieldName: 'implementation_clarity', displayName: 'Implementation Clarity', question: '', answerType: 'numeric', scale: { min: 1, max: 10 }, weight: 0.15, requiresReasoning: false },
  { fieldName: 'standards_relevance', displayName: 'Standards Relevance', question: '', answerType: 'numeric', scale: { min: 1, max: 10 }, weight: 0.15, requiresReasoning: false },
  { fieldName: 'unique_value', displayName: 'Unique Value', question: '', answerType: 'numeric', scale: { min: 1, max: 10 }, weight: 0.10, requiresReasoning: false },
];

const TEST_LLM_METRICS: Record<string, MetricScore>[] = [
  // High scores
  {
    technical_novelty: { score: 8, reasoning: '' },
    claim_breadth: { score: 7, reasoning: '' },
    design_around_difficulty: { score: 9, reasoning: '' },
    market_relevance: { score: 6, reasoning: '' },
    implementation_clarity: { score: 7, reasoning: '' },
    standards_relevance: { score: 5, reasoning: '' },
    unique_value: { score: 8, reasoning: '' },
  },
  // Low scores
  {
    technical_novelty: { score: 2, reasoning: '' },
    claim_breadth: { score: 3, reasoning: '' },
    design_around_difficulty: { score: 1, reasoning: '' },
    market_relevance: { score: 4, reasoning: '' },
    implementation_clarity: { score: 2, reasoning: '' },
    standards_relevance: { score: 3, reasoning: '' },
    unique_value: { score: 1, reasoning: '' },
  },
  // Mixed scores
  {
    technical_novelty: { score: 10, reasoning: '' },
    claim_breadth: { score: 1, reasoning: '' },
    design_around_difficulty: { score: 5, reasoning: '' },
    market_relevance: { score: 5, reasoning: '' },
    implementation_clarity: { score: 10, reasoning: '' },
    standards_relevance: { score: 1, reasoning: '' },
    unique_value: { score: 5, reasoning: '' },
  },
  // Partial data (some missing)
  {
    technical_novelty: { score: 7, reasoning: '' },
    claim_breadth: { score: 6, reasoning: '' },
    design_around_difficulty: { score: 8, reasoning: '' },
  },
];

const llmFormula = buildLlmCompositeFormula();
const llmWeights: Record<string, number> = {};
for (const q of PORTFOLIO_QUESTIONS) {
  llmWeights[q.fieldName] = q.weight;
}

for (let i = 0; i < TEST_LLM_METRICS.length; i++) {
  const metrics = TEST_LLM_METRICS[i];
  const expected = calculateCompositeScore(metrics, PORTFOLIO_QUESTIONS);

  // Convert to raw metrics format
  const rawMetrics: Record<string, number | undefined> = {};
  for (const q of PORTFOLIO_QUESTIONS) {
    rawMetrics[q.fieldName] = metrics[q.fieldName]?.score;
  }

  const actual = evaluateFormula(llmFormula, llmWeights, rawMetrics);
  assert(
    `LLM Composite set ${i + 1}`,
    actual.score,
    expected,
  );
}

// =============================================================================
// Test 4: Edge cases
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 4: Edge Cases');
console.log('═══════════════════════════════════════════════════════════════\n');

// All zeros
{
  const allZeros: Record<string, number | undefined> = {
    competitor_citations: 0,
    adjusted_forward_citations: 0,
    years_remaining: 0,
    competitor_count: 0,
    competitor_density: 0,
  };
  const result = evaluateFormula(v2Formula, PROFILE_WEIGHTS.executive, allZeros);
  // With all quantitative at 0, sparse LLM missing → renormalize.
  // normalizedValues all 0, score should be 0 * yearMultiplier(0) * 100
  // yearMultiplier(0) = 0.3
  assert('All zeros score', result.score, 0);
  assert('All zeros yearMultiplier', result.multiplierValues.years_remaining, 0.3);
}

// Single metric formula
{
  const singleFormula: FormulaStructure = {
    version: 1,
    outputScale: 100,
    terms: [metricTerm('competitor_citations', linearScaling(20))],
    multipliers: [],
    sparseHandling: 'zero',
  };
  const result = evaluateFormula(
    singleFormula,
    { competitor_citations: 1 },
    { competitor_citations: 10 },
  );
  assert('Single metric (10/20)', result.score, 50);
}

// Empty weights
{
  const result = evaluateFormula(v2Formula, {}, metricsToRaw(PATENT_WITH_ALL_DATA));
  assert('Empty weights', result.score, 0);
}

// =============================================================================
// Test 5: Scaling functions
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 5: Scaling Function Verification');
console.log('═══════════════════════════════════════════════════════════════\n');

import { applyScaling } from '../src/api/services/formula-engine.js';

// Linear: min(1, v/max)
assert('linear(10, max=20)', applyScaling(10, linearScaling(20)), 0.5);
assert('linear(25, max=20)', applyScaling(25, linearScaling(20)), 1.0);
assert('linear(0, max=20)', applyScaling(0, linearScaling(20)), 0.0);

// Sqrt: min(1, sqrt(v)/sqrt(max))
assert('sqrt(100, max=900)', applyScaling(100, sqrtScaling(900)), 10 / 30);
assert('sqrt(900, max=900)', applyScaling(900, sqrtScaling(900)), 1.0);

// Range: (v-min)/(max-min)
assert('range(3, 1-5)', applyScaling(3, rangeScaling(1, 5)), 0.5);
assert('range(1, 1-5)', applyScaling(1, rangeScaling(1, 5)), 0.0);
assert('range(5, 1-5)', applyScaling(5, rangeScaling(1, 5)), 1.0);
assert('range(5.5, 1-10)', applyScaling(5.5, rangeScaling(1, 10)), 0.5);

// Log: min(1, log10(v+1)/log10(max+1))
import { logScaling } from '../src/api/services/formula-engine.js';
assert('log(99, max=99)', applyScaling(99, logScaling(99)), 1.0);
assert('log(9, max=99)', applyScaling(9, logScaling(99)), Math.log10(10) / Math.log10(100));

// Raw: identity
import { rawScaling } from '../src/api/services/formula-engine.js';
assert('raw(0.75)', applyScaling(0.75, rawScaling()), 0.75);

// =============================================================================
// Summary
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
