/**
 * Formula Structure Types
 *
 * Defines the JSON tree stored in FormulaDefinition.structure.
 * The formula engine evaluates these structures against raw metric values
 * and weight profiles to produce scores.
 */

// =============================================================================
// Top-level formula structure
// =============================================================================

export interface FormulaStructure {
  /** Schema version for forward compatibility */
  version: 1;

  /** Final output scale (e.g., 100 for 0-100 range) */
  outputScale: number;

  /** Additive terms — the core of the formula */
  terms: FormulaTerm[];

  /** Post-summation multipliers (e.g., year_multiplier) */
  multipliers?: FormulaMultiplier[];

  /** How to handle missing sparse metrics */
  sparseHandling: SparseHandling;
}

// =============================================================================
// Formula terms — the tree nodes
// =============================================================================

export type FormulaTerm = MetricTerm | GroupTerm | ConstantTerm;

/**
 * A single metric contribution to the score.
 * Looks up a raw value, applies scaling, multiplies by weight.
 */
export interface MetricTerm {
  type: 'metric';

  /** Raw metric name: "competitor_citations", "eligibility_score" */
  attribute: string;

  /** Key into WeightProfile.weights (same as attribute by convention) */
  weightKey: string;

  /** Normalization/scaling function */
  scaling: ScalingConfig;

  /** If true, normalized = 1 - normalized */
  invert?: boolean;

  /** Sparse group identifier — marks metrics that may be missing.
   *  "llm" | "api" | any string. Used by sparseHandling logic. */
  sparseGroup?: string;
}

/**
 * A group of terms with a group-level weight.
 * Enables hierarchical formula organization:
 *   0.50 × [Portfolio Questions]
 *   0.20 × [Citation Group]
 *   0.20 × [Sector Questions]
 */
export interface GroupTerm {
  type: 'group';

  /** Display name: "portfolio_questions", "citation_group" */
  name: string;

  /** Key into WeightProfile.weights for the group-level weight */
  weightKey: string;

  /** Nested terms within this group */
  terms: FormulaTerm[];

  /** If true, inner weights are relative (normalized to sum to 1 within group) */
  normalize: boolean;

  /** Override sparse handling within this group */
  sparseHandling?: SparseHandling;
}

/**
 * A fixed constant contribution (rarely used, but supports offset terms).
 */
export interface ConstantTerm {
  type: 'constant';
  value: number;
  weightKey: string;
}

// =============================================================================
// Scaling configuration
// =============================================================================

export interface ScalingConfig {
  /** Scaling function name */
  fn: ScalingFn;

  /** Function-specific parameters */
  params: Record<string, number>;
}

export type ScalingFn =
  | 'linear'   // min(1, (v - min) / (max - min))
  | 'sqrt'     // min(1, sqrt(v) / sqrt(max))
  | 'log'      // min(1, log10(v+1) / log10(max+1))
  | 'nroot'    // min(1, v^(1/n) / max^(1/n))
  | 'range'    // (v - inputMin) / (inputMax - inputMin), clamped to [0,1]
  | 'sigmoid'  // 1 / (1 + exp(-(v - midpoint) * steepness))
  | 'step'     // discrete bucketing by thresholds
  | 'raw';     // identity (no transformation)

// =============================================================================
// Multipliers — post-summation adjustments
// =============================================================================

export interface FormulaMultiplier {
  /** Raw metric used as input to the multiplier */
  attribute: string;

  /** Named multiplier function */
  fn: MultiplierFn;

  /** Function-specific parameters */
  params: Record<string, number>;
}

export type MultiplierFn =
  | 'linear_floor';  // floor + (ceiling - floor) * pow(min(1, v/scale), exponent)

// =============================================================================
// Sparse handling
// =============================================================================

/**
 * How the formula handles missing metric values:
 * - 'renormalize': Redistribute missing weights proportionally among available metrics.
 *                  (Current V2 behavior — maintains score comparability when LLM data is sparse)
 * - 'zero':        Missing metrics contribute 0; denominator uses only metrics with data.
 *                  (Current LLM composite behavior — all scored patents have all metrics)
 * - 'skip':        Exclude the patent entirely if any required metric is missing.
 */
export type SparseHandling = 'renormalize' | 'zero' | 'skip';

// =============================================================================
// Engine result
// =============================================================================

export interface FormulaResult {
  /** Final score (0-100 typically) */
  score: number;

  /** Pre-multiplier weighted sum */
  baseScore: number;

  /** Normalized metric values (0-1 each) */
  normalizedMetrics: Record<string, number>;

  /** Which metrics contributed to the score */
  metricsUsed: string[];

  /** Multiplier values applied */
  multiplierValues: Record<string, number>;

  /** Weight renormalization factor (for sparseHandling='renormalize') */
  renormFactor?: number;
}
