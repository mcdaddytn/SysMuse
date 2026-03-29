/**
 * Formula Engine — Pure Computation
 *
 * Evaluates a FormulaStructure against raw metric values and weights.
 * No database access, no data loading — just math.
 *
 * Must reproduce existing scoring exactly:
 *   - V2 Enhanced: scoreWithCustomConfig() in scoring-service.ts
 *   - LLM Composite: calculateCompositeScore() in scoring-template-service.ts
 */

import type {
  FormulaStructure,
  FormulaTerm,
  MetricTerm,
  GroupTerm,
  ConstantTerm,
  ScalingConfig,
  ScalingFn,
  FormulaMultiplier,
  MultiplierFn,
  SparseHandling,
  FormulaResult,
} from './formula-types.js';

// =============================================================================
// Scaling functions
// =============================================================================

/**
 * Apply a scaling function to normalize a raw value to [0, 1].
 */
export function applyScaling(value: number, config: ScalingConfig): number {
  const p = config.params;
  let result: number;

  switch (config.fn) {
    case 'linear': {
      // min(1, (v - min) / (max - min))
      const min = p.min ?? 0;
      const max = p.max ?? 1;
      const range = max - min;
      result = range > 0 ? (value - min) / range : 0;
      break;
    }

    case 'sqrt': {
      // min(1, sqrt(v) / sqrt(max))  — matches existing SCALING_FUNCTIONS.sqrt
      const max = p.max ?? 1;
      result = max > 0 ? Math.sqrt(value) / Math.sqrt(max) : 0;
      break;
    }

    case 'log': {
      // min(1, log10(v+1) / log10(max+1))  — matches existing SCALING_FUNCTIONS.log
      const max = p.max ?? 100;
      result = max > 0 ? Math.log10(value + 1) / Math.log10(max + 1) : 0;
      break;
    }

    case 'nroot': {
      // min(1, v^(1/n) / max^(1/n))
      const n = p.n ?? 2;
      const max = p.max ?? 1;
      result = max > 0 ? Math.pow(value, 1 / n) / Math.pow(max, 1 / n) : 0;
      break;
    }

    case 'range': {
      // (v - inputMin) / (inputMax - inputMin), clamped to [0,1]
      // Matches LLM score normalization: (v-1)/4 for 1-5, (v-1)/9 for 1-10
      const inputMin = p.inputMin ?? 0;
      const inputMax = p.inputMax ?? 1;
      const range = inputMax - inputMin;
      result = range > 0 ? (value - inputMin) / range : 0;
      break;
    }

    case 'sigmoid': {
      const midpoint = p.midpoint ?? 0;
      const steepness = p.steepness ?? 1;
      result = 1 / (1 + Math.exp(-(value - midpoint) * steepness));
      break;
    }

    case 'step': {
      // Discrete bucketing: thresholds[i] and values[i]
      // thresholds must be sorted ascending; values has len(thresholds)+1 entries
      // value < thresholds[0] → values[0]
      // thresholds[i-1] <= value < thresholds[i] → values[i]
      // value >= thresholds[last] → values[last]
      const thresholds = p.thresholds as unknown as number[] ?? [];
      const values = p.values as unknown as number[] ?? [0, 1];
      let bucket = 0;
      for (let i = 0; i < thresholds.length; i++) {
        if (value >= thresholds[i]) bucket = i + 1;
      }
      result = values[Math.min(bucket, values.length - 1)] ?? 0;
      break;
    }

    case 'raw': {
      result = value;
      break;
    }

    default:
      result = value;
  }

  // Clamp to [0, 1] unless raw
  if (config.fn !== 'raw') {
    result = Math.max(0, Math.min(1, result));
  }

  return result;
}

// =============================================================================
// Multiplier functions
// =============================================================================

/**
 * Apply a post-summation multiplier.
 */
export function applyMultiplier(value: number, multiplier: FormulaMultiplier): number {
  const p = multiplier.params;

  switch (multiplier.fn) {
    case 'linear_floor': {
      // floor + (ceiling - floor) * pow(min(1, max(0, v) / scale), exponent)
      // Matches computeYearMultiplier: 0.3 + 0.7 * pow(min(1, years/15), 0.8)
      const floor = p.floor ?? 0;
      const ceiling = p.ceiling ?? 1;
      const scale = p.scale ?? 1;
      const exponent = p.exponent ?? 1;
      const factor = Math.min(1, Math.max(0, value) / scale);
      return floor + (ceiling - floor) * Math.pow(factor, exponent);
    }

    default:
      return 1;
  }
}

// =============================================================================
// Term evaluation helpers
// =============================================================================

interface TermResult {
  attribute: string;
  weightKey: string;
  normalizedValue: number;
  rawWeight: number;
  isSparse: boolean;
  isAvailable: boolean;
}

/**
 * Flatten a term tree into a list of (attribute, weight, normalizedValue) tuples.
 * Group terms apply their group weight as a multiplier on inner weights.
 */
function flattenTerms(
  terms: FormulaTerm[],
  weights: Record<string, number>,
  rawMetrics: Record<string, number | undefined>,
  scalingOverrides?: Record<string, ScalingConfig>,
  groupMultiplier: number = 1,
): TermResult[] {
  const results: TermResult[] = [];

  for (const term of terms) {
    switch (term.type) {
      case 'metric': {
        const rawWeight = (weights[term.weightKey] ?? 0) * groupMultiplier;
        const rawValue = rawMetrics[term.attribute];
        const isSparse = term.sparseGroup != null;
        const isAvailable = rawValue !== undefined && rawValue !== null;

        let normalizedValue = 0;
        if (isAvailable) {
          const scaling = scalingOverrides?.[term.attribute] ?? term.scaling;
          normalizedValue = applyScaling(rawValue, scaling);
          if (term.invert) {
            normalizedValue = 1 - normalizedValue;
          }
        }

        results.push({
          attribute: term.attribute,
          weightKey: term.weightKey,
          normalizedValue,
          rawWeight,
          isSparse,
          isAvailable,
        });
        break;
      }

      case 'group': {
        const groupWeight = weights[term.weightKey] ?? 1;
        const effectiveGroupMultiplier = groupMultiplier * groupWeight;

        if (term.normalize) {
          // Inner weights are relative — normalize them to sum to 1 within the group
          const innerWeightSum = term.terms.reduce((sum, t) => {
            if (t.type === 'metric' || t.type === 'constant') {
              return sum + (weights[t.weightKey] ?? 0);
            }
            return sum + (weights[(t as GroupTerm).weightKey] ?? 0);
          }, 0);

          if (innerWeightSum > 0) {
            // Temporarily adjust weights for inner terms
            const adjustedWeights = { ...weights };
            for (const innerTerm of term.terms) {
              const key = innerTerm.type === 'group' ? innerTerm.weightKey : (innerTerm as MetricTerm | ConstantTerm).weightKey;
              if (adjustedWeights[key] !== undefined) {
                adjustedWeights[key] = (adjustedWeights[key] ?? 0) / innerWeightSum;
              }
            }
            results.push(...flattenTerms(term.terms, adjustedWeights, rawMetrics, scalingOverrides, effectiveGroupMultiplier));
          }
        } else {
          results.push(...flattenTerms(term.terms, weights, rawMetrics, scalingOverrides, effectiveGroupMultiplier));
        }
        break;
      }

      case 'constant': {
        const rawWeight = (weights[term.weightKey] ?? 0) * groupMultiplier;
        results.push({
          attribute: `__constant_${term.weightKey}`,
          weightKey: term.weightKey,
          normalizedValue: term.value,
          rawWeight,
          isSparse: false,
          isAvailable: true,
        });
        break;
      }
    }
  }

  return results;
}

// =============================================================================
// Main evaluation function
// =============================================================================

/**
 * Evaluate a formula against raw metrics and weights.
 *
 * @param structure   The FormulaStructure from FormulaDefinition.structure
 * @param weights     Weight values from WeightProfile.weights (Record<string, number>)
 * @param rawMetrics  Raw metric values per patent (undefined = missing)
 * @param scalingOverrides  Optional per-metric scaling overrides (for frontend scaling toggles)
 * @returns FormulaResult with score, breakdown, and metadata
 */
export function evaluateFormula(
  structure: FormulaStructure,
  weights: Record<string, number>,
  rawMetrics: Record<string, number | undefined>,
  scalingOverrides?: Record<string, ScalingConfig>,
): FormulaResult {
  // 1. Flatten the term tree
  const termResults = flattenTerms(structure.terms, weights, rawMetrics, scalingOverrides);

  // 2. Compute total and available weight sums
  let totalWeight = 0;
  let availableWeight = 0;
  const normalizedMetrics: Record<string, number> = {};
  const metricsUsed: string[] = [];

  for (const tr of termResults) {
    if (tr.rawWeight <= 0) continue;
    totalWeight += tr.rawWeight;

    if (tr.isSparse && !tr.isAvailable) {
      // Sparse metric missing — skip for available weight
      continue;
    }

    availableWeight += tr.rawWeight;
    normalizedMetrics[tr.attribute] = tr.normalizedValue;
    metricsUsed.push(tr.attribute);
  }

  // 3. Compute weighted sum based on sparse handling
  let baseScore = 0;
  let renormFactor: number | undefined;

  switch (structure.sparseHandling) {
    case 'renormalize': {
      // V2 Enhanced pattern (matches scoreWithCustomConfig exactly):
      //   1. Normalize weights to sum to 1: normW_i = w_i / totalWeight
      //   2. Compute availableNormWeight = Σ(normW_i) for available metrics only
      //   3. renormFactor = 1 / availableNormWeight
      //   4. baseScore = Σ(normalized_i × normW_i × renormFactor)
      //
      // This redistributes missing metric weights proportionally among available metrics.
      if (totalWeight > 0) {
        let availableNormWeight = 0;
        for (const tr of termResults) {
          if (tr.rawWeight <= 0) continue;
          if (tr.isSparse && !tr.isAvailable) continue;
          availableNormWeight += tr.rawWeight / totalWeight;
        }

        if (availableNormWeight > 0) {
          renormFactor = 1 / availableNormWeight;
          for (const tr of termResults) {
            if (tr.rawWeight <= 0) continue;
            if (tr.isSparse && !tr.isAvailable) continue;
            const normalizedWeight = tr.rawWeight / totalWeight;
            baseScore += tr.normalizedValue * normalizedWeight * renormFactor;
          }
        }
      }
      break;
    }

    case 'zero': {
      // LLM Composite pattern:
      //   Only include metrics with valid values AND weight > 0
      //   score = Σ(norm_i × w_i) / Σ(w_i for included)
      if (availableWeight > 0) {
        let weightedSum = 0;
        let includedWeight = 0;
        for (const tr of termResults) {
          if (tr.rawWeight <= 0) continue;
          if (!tr.isAvailable) continue;
          weightedSum += tr.normalizedValue * tr.rawWeight;
          includedWeight += tr.rawWeight;
        }
        baseScore = includedWeight > 0 ? weightedSum / includedWeight : 0;
      }
      break;
    }

    case 'skip': {
      // If any required (non-sparse) metric is missing, score is 0
      const allAvailable = termResults.every(tr =>
        tr.rawWeight <= 0 || tr.isAvailable
      );
      if (!allAvailable) {
        return {
          score: 0,
          baseScore: 0,
          normalizedMetrics,
          metricsUsed: [],
          multiplierValues: {},
          renormFactor: undefined,
        };
      }
      // All present — same as zero handling
      if (totalWeight > 0) {
        let weightedSum = 0;
        for (const tr of termResults) {
          if (tr.rawWeight <= 0) continue;
          weightedSum += tr.normalizedValue * tr.rawWeight;
        }
        baseScore = weightedSum / totalWeight;
      }
      break;
    }
  }

  // 4. Apply multipliers
  const multiplierValues: Record<string, number> = {};
  let multiplierProduct = 1;

  if (structure.multipliers) {
    for (const mult of structure.multipliers) {
      const rawValue = rawMetrics[mult.attribute] ?? 0;
      const multValue = applyMultiplier(rawValue, mult);
      multiplierValues[mult.attribute] = multValue;
      multiplierProduct *= multValue;
    }
  }

  // 5. Final score
  const finalScore = baseScore * multiplierProduct * structure.outputScale;

  return {
    score: Math.round(finalScore * 100) / 100, // 2 decimal places
    baseScore: Math.round(baseScore * 10000) / 10000,
    normalizedMetrics,
    metricsUsed,
    multiplierValues,
    renormFactor,
  };
}

// =============================================================================
// Formula structure builders — helpers for constructing FormulaStructure JSON
// =============================================================================

/** Create a metric term */
export function metricTerm(
  attribute: string,
  scaling: ScalingConfig,
  opts?: { weightKey?: string; sparseGroup?: string; invert?: boolean },
): MetricTerm {
  return {
    type: 'metric',
    attribute,
    weightKey: opts?.weightKey ?? attribute,
    scaling,
    ...(opts?.sparseGroup && { sparseGroup: opts.sparseGroup }),
    ...(opts?.invert && { invert: opts.invert }),
  };
}

/** Create a group term */
export function groupTerm(
  name: string,
  terms: FormulaTerm[],
  opts?: { weightKey?: string; normalize?: boolean; sparseHandling?: SparseHandling },
): GroupTerm {
  return {
    type: 'group',
    name,
    weightKey: opts?.weightKey ?? name,
    terms,
    normalize: opts?.normalize ?? false,
    ...(opts?.sparseHandling && { sparseHandling: opts.sparseHandling }),
  };
}

/** Shorthand for linear scaling: min(1, (v - min) / (max - min)) */
export function linearScaling(max: number, min: number = 0): ScalingConfig {
  return { fn: 'linear', params: { min, max } };
}

/** Shorthand for sqrt scaling: min(1, sqrt(v) / sqrt(max)) */
export function sqrtScaling(max: number): ScalingConfig {
  return { fn: 'sqrt', params: { max } };
}

/** Shorthand for log scaling: min(1, log10(v+1) / log10(max+1)) */
export function logScaling(max: number): ScalingConfig {
  return { fn: 'log', params: { max } };
}

/** Shorthand for range scaling: (v - inputMin) / (inputMax - inputMin) */
export function rangeScaling(inputMin: number, inputMax: number): ScalingConfig {
  return { fn: 'range', params: { inputMin, inputMax } };
}

/** Shorthand for raw (identity) scaling */
export function rawScaling(): ScalingConfig {
  return { fn: 'raw', params: {} };
}
