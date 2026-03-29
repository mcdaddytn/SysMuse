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
  GroupScoreDetail,
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
  /** Which group this term belongs to (null for top-level ungrouped terms) */
  groupName: string | null;
  /** Per-group sparse handling override (null = use top-level) */
  groupSparseHandling: SparseHandling | null;
  /** The group-level weight (for group score reporting) */
  groupWeight: number;
}

/**
 * Flatten a term tree into a list of (attribute, weight, normalizedValue) tuples.
 * Group terms apply their group weight as a multiplier on inner weights.
 * Each result is tagged with its parent group for per-group sparse handling and score reporting.
 */
function flattenTerms(
  terms: FormulaTerm[],
  weights: Record<string, number>,
  rawMetrics: Record<string, number | undefined>,
  scalingOverrides?: Record<string, ScalingConfig>,
  groupMultiplier: number = 1,
  parentGroup: { name: string; sparseHandling: SparseHandling | null; weight: number } | null = null,
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
          groupName: parentGroup?.name ?? null,
          groupSparseHandling: parentGroup?.sparseHandling ?? null,
          groupWeight: parentGroup?.weight ?? 1,
        });
        break;
      }

      case 'group': {
        const groupWeight = weights[term.weightKey] ?? 1;
        const effectiveGroupMultiplier = groupMultiplier * groupWeight;
        const groupContext = {
          name: term.name,
          sparseHandling: term.sparseHandling ?? null,
          weight: groupWeight,
        };

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
            results.push(...flattenTerms(term.terms, adjustedWeights, rawMetrics, scalingOverrides, effectiveGroupMultiplier, groupContext));
          }
        } else {
          results.push(...flattenTerms(term.terms, weights, rawMetrics, scalingOverrides, effectiveGroupMultiplier, groupContext));
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
          groupName: parentGroup?.name ?? null,
          groupSparseHandling: parentGroup?.sparseHandling ?? null,
          groupWeight: parentGroup?.weight ?? 1,
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

  // 2. Check if any groups have their own sparse handling
  const hasGroupSparseOverrides = termResults.some(tr => tr.groupSparseHandling != null);

  // 3. Collect normalized metrics and metrics used
  const normalizedMetrics: Record<string, number> = {};
  const metricsUsed: string[] = [];
  for (const tr of termResults) {
    if (tr.rawWeight <= 0) continue;
    if (tr.isSparse && !tr.isAvailable) continue;
    normalizedMetrics[tr.attribute] = tr.normalizedValue;
    metricsUsed.push(tr.attribute);
  }

  // 4. Compute weighted sum
  let baseScore = 0;
  let renormFactor: number | undefined;
  let groupScores: Record<string, GroupScoreDetail> | undefined;

  if (hasGroupSparseOverrides) {
    // Per-group evaluation: partition terms by group, evaluate each with its sparse handling.
    // Each group computes its own internal weighted average (0-1), then the group-level
    // weight determines how much that group contributes to the total score.
    const groups = new Map<string | null, TermResult[]>();
    for (const tr of termResults) {
      const key = tr.groupName;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(tr);
    }

    // Compute total group weight sum for normalization
    let totalGroupWeight = 0;
    const groupWeightMap = new Map<string | null, number>();
    for (const [groupName, groupTerms] of groups) {
      const gWeight = groupTerms[0]?.groupWeight ?? 1;
      groupWeightMap.set(groupName, gWeight);
      totalGroupWeight += gWeight;
    }

    groupScores = {};
    for (const [groupName, groupTerms] of groups) {
      const sparseMode = groupTerms[0]?.groupSparseHandling ?? structure.sparseHandling;
      const groupContribution = computeGroupScore(groupTerms, sparseMode);
      const gWeight = groupWeightMap.get(groupName) ?? 1;
      const normalizedGroupWeight = totalGroupWeight > 0 ? gWeight / totalGroupWeight : 0;

      // Group contribution to base score = group's internal average × its share of total weight
      baseScore += groupContribution.score * normalizedGroupWeight;

      if (groupName != null) {
        groupScores[groupName] = {
          score: Math.round(groupContribution.score * 10000) / 10000,
          weight: gWeight,
          termsUsed: groupContribution.termsUsed,
          totalTerms: groupTerms.filter(t => t.rawWeight > 0).length,
        };
      }
    }
  } else {
    // No per-group overrides — use top-level sparse handling (Phase 1 behavior)
    let totalWeight = 0;
    let availableWeight = 0;

    for (const tr of termResults) {
      if (tr.rawWeight <= 0) continue;
      totalWeight += tr.rawWeight;
      if (tr.isSparse && !tr.isAvailable) continue;
      availableWeight += tr.rawWeight;
    }

    switch (structure.sparseHandling) {
      case 'renormalize': {
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

    // Even without per-group sparse overrides, report group scores if groups exist
    const groupNames = new Set(termResults.map(tr => tr.groupName).filter(n => n != null));
    if (groupNames.size > 0) {
      groupScores = {};
      for (const gn of groupNames) {
        const gTerms = termResults.filter(tr => tr.groupName === gn);
        const gUsed = gTerms.filter(tr => tr.rawWeight > 0 && !(tr.isSparse && !tr.isAvailable));
        const gTotal = gTerms.filter(tr => tr.rawWeight > 0);
        // Approximate group contribution: sum of (normalizedValue * normalizedWeight * renormFactor) for group terms
        let gScore = 0;
        for (const tr of gUsed) {
          if (structure.sparseHandling === 'renormalize' && totalWeight > 0 && renormFactor) {
            gScore += tr.normalizedValue * (tr.rawWeight / totalWeight) * renormFactor;
          } else if (structure.sparseHandling === 'zero' && availableWeight > 0) {
            gScore += tr.normalizedValue * tr.rawWeight / availableWeight;
          }
        }
        groupScores[gn!] = {
          score: Math.round(gScore * 10000) / 10000,
          weight: gTerms[0]?.groupWeight ?? 1,
          termsUsed: gUsed.length,
          totalTerms: gTotal.length,
        };
      }
    }
  }

  // 5. Apply multipliers
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

  // 6. Final score
  const finalScore = baseScore * multiplierProduct * structure.outputScale;

  return {
    score: Math.round(finalScore * 100) / 100, // 2 decimal places
    baseScore: Math.round(baseScore * 10000) / 10000,
    normalizedMetrics,
    metricsUsed,
    multiplierValues,
    renormFactor,
    ...(groupScores && Object.keys(groupScores).length > 0 && { groupScores }),
  };
}

/**
 * Compute the score contribution for a group of terms with a specific sparse handling mode.
 */
function computeGroupScore(
  terms: TermResult[],
  sparseHandling: SparseHandling,
): { score: number; termsUsed: number } {
  let totalWeight = 0;
  let availableWeight = 0;
  let termsUsed = 0;

  for (const tr of terms) {
    if (tr.rawWeight <= 0) continue;
    totalWeight += tr.rawWeight;
    if (tr.isSparse && !tr.isAvailable) continue;
    availableWeight += tr.rawWeight;
    termsUsed++;
  }

  let score = 0;

  switch (sparseHandling) {
    case 'renormalize': {
      if (totalWeight > 0) {
        let availableNormWeight = 0;
        for (const tr of terms) {
          if (tr.rawWeight <= 0) continue;
          if (tr.isSparse && !tr.isAvailable) continue;
          availableNormWeight += tr.rawWeight / totalWeight;
        }
        if (availableNormWeight > 0) {
          const renorm = 1 / availableNormWeight;
          for (const tr of terms) {
            if (tr.rawWeight <= 0) continue;
            if (tr.isSparse && !tr.isAvailable) continue;
            score += tr.normalizedValue * (tr.rawWeight / totalWeight) * renorm;
          }
        }
      }
      break;
    }

    case 'zero': {
      if (availableWeight > 0) {
        let weightedSum = 0;
        let includedWeight = 0;
        for (const tr of terms) {
          if (tr.rawWeight <= 0) continue;
          if (!tr.isAvailable) continue;
          weightedSum += tr.normalizedValue * tr.rawWeight;
          includedWeight += tr.rawWeight;
        }
        score = includedWeight > 0 ? weightedSum / includedWeight : 0;
      }
      break;
    }

    case 'skip': {
      const allAvailable = terms.every(tr => tr.rawWeight <= 0 || tr.isAvailable);
      if (!allAvailable) return { score: 0, termsUsed: 0 };
      if (totalWeight > 0) {
        let weightedSum = 0;
        for (const tr of terms) {
          if (tr.rawWeight <= 0) continue;
          weightedSum += tr.normalizedValue * tr.rawWeight;
        }
        score = weightedSum / totalWeight;
      }
      break;
    }
  }

  return { score, termsUsed };
}

// =============================================================================
// Formula structure builders — helpers for constructing FormulaStructure JSON
// =============================================================================

/** Create a metric term */
export function metricTerm(
  attribute: string,
  scaling: ScalingConfig,
  opts?: { weightKey?: string; sparseGroup?: string; invert?: boolean; displayName?: string },
): MetricTerm {
  return {
    type: 'metric',
    attribute,
    weightKey: opts?.weightKey ?? attribute,
    scaling,
    ...(opts?.displayName && { displayName: opts.displayName }),
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
