/**
 * Metric Resolver Service
 *
 * Loads raw metric values from multiple database sources for formula evaluation.
 * Combines quantitative metrics (citations, years), LLM metrics (from PatentSubSectorScore),
 * and API metrics (IPR, prosecution) into a single rawMetrics map per patent.
 *
 * Unlike loadAllLlmScoresWithDb(), this resolver uses ORIGINAL template fieldNames
 * (not mapped V2 names), which is required for grouped-term formula evaluation.
 */

import { PrismaClient } from '@prisma/client';
import {
  loadCandidatesFromPostgres,
  loadAllClassifications,
  loadAllIprScores,
  loadAllProsecutionScores,
  buildMetrics,
  CITATION_WEIGHTS,
} from './scoring-service.js';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface ResolvedMetrics {
  patentId: string;
  rawMetrics: Record<string, number | undefined>;
  metadata: PatentMetadata;
}

export interface PatentMetadata {
  title: string;
  assignee: string;
  patentDate: string;
  sector: string;
  superSector: string;
  yearsRemaining: number;
  hasLlmData: boolean;
  hasTaxonomyScores: boolean;
}

// =============================================================================
// Core resolver
// =============================================================================

/**
 * Resolve raw metric values for all patents in a portfolio.
 *
 * Loads data from multiple sources:
 * 1. Quantitative: patent table + citation classifications
 * 2. LLM taxonomy metrics: PatentSubSectorScore.metrics JSON (original fieldNames)
 * 3. API metrics: IPR risk + prosecution quality scores
 *
 * @param portfolioId  Portfolio to load patents from
 * @param attributes   All metric fieldNames needed by the formula (for filtering)
 * @param options      Optional filtering
 */
export async function resolveMetricsForPortfolio(
  portfolioId: string,
  attributes: string[],
  options?: {
    llmEnhancedOnly?: boolean;
    subSectorId?: string;
    limit?: number;
  },
): Promise<ResolvedMetrics[]> {
  const attributeSet = new Set(attributes);

  // 1. Load quantitative data (patents + citation classifications)
  const candidates = await loadCandidatesFromPostgres(portfolioId);
  const classifications = loadAllClassifications();

  // 2. Load taxonomy-level LLM scores from PatentSubSectorScore
  const patentIds = candidates.map((c: any) => c.patent_id);
  const taxonomyScores = await loadTaxonomyScores(patentIds, options?.subSectorId);

  // 3. Load API metrics
  const iprScores = loadAllIprScores();
  const prosecutionScores = loadAllProsecutionScores();

  // 4. Assemble per-patent rawMetrics
  const results: ResolvedMetrics[] = [];

  for (const candidate of candidates) {
    const patentId = candidate.patent_id;
    const classification = classifications.get(patentId) ?? null;
    const taxonomyMetrics = taxonomyScores.get(patentId);
    const ipr = iprScores.get(patentId);
    const pros = prosecutionScores.get(patentId);

    const hasLlmData = taxonomyMetrics != null && Object.keys(taxonomyMetrics).length > 0;
    const hasTaxonomyScores = hasLlmData;

    // Filter: LLM-only mode
    if (options?.llmEnhancedOnly && !hasLlmData) continue;

    // Build quantitative metrics using existing buildMetrics helper
    const quantMetrics = buildMetrics(candidate, classification, null, null, null);

    // Assemble raw metrics map
    const rawMetrics: Record<string, number | undefined> = {};

    // Quantitative metrics (always available)
    if (attributeSet.has('competitor_citations')) rawMetrics.competitor_citations = quantMetrics.competitor_citations;
    if (attributeSet.has('adjusted_forward_citations')) rawMetrics.adjusted_forward_citations = quantMetrics.adjusted_forward_citations;
    if (attributeSet.has('years_remaining')) rawMetrics.years_remaining = quantMetrics.years_remaining;
    if (attributeSet.has('competitor_count')) rawMetrics.competitor_count = quantMetrics.competitor_count;
    if (attributeSet.has('competitor_density')) rawMetrics.competitor_density = quantMetrics.competitor_density;

    // API metrics (sparse)
    if (attributeSet.has('ipr_risk_score') && ipr) {
      rawMetrics.ipr_risk_score = (ipr as any).ipr_risk_score;
    }
    if (attributeSet.has('prosecution_quality_score') && pros) {
      rawMetrics.prosecution_quality_score = (pros as any).prosecution_quality_score;
    }

    // LLM taxonomy metrics (from PatentSubSectorScore.metrics JSON)
    // These use original template fieldNames — no V2 name mapping
    if (taxonomyMetrics) {
      for (const [fieldName, metricData] of Object.entries(taxonomyMetrics)) {
        if (attributeSet.has(fieldName) && metricData && typeof metricData === 'object') {
          const score = (metricData as any).score;
          if (typeof score === 'number') {
            rawMetrics[fieldName] = score;
          }
        }
      }
    }

    results.push({
      patentId,
      rawMetrics,
      metadata: {
        title: candidate.patent_title || '',
        assignee: candidate.assignee || '',
        patentDate: candidate.patent_date || '',
        sector: candidate.primary_sector || '',
        superSector: candidate.super_sector || '',
        yearsRemaining: quantMetrics.years_remaining,
        hasLlmData,
        hasTaxonomyScores,
      },
    });
  }

  // Apply limit if specified
  if (options?.limit && options.limit > 0) {
    return results.slice(0, options.limit);
  }

  return results;
}

// =============================================================================
// Taxonomy score loading
// =============================================================================

/**
 * Load LLM taxonomy scores from PatentSubSectorScore table.
 * Returns a map of patentId → flat metrics map (fieldName → {score, reasoning}).
 *
 * If subSectorId is specified, only loads scores for that sub-sector.
 * Otherwise loads the best available score for each patent (preferring withClaims=true).
 */
async function loadTaxonomyScores(
  patentIds: string[],
  subSectorId?: string,
): Promise<Map<string, Record<string, any>>> {
  const result = new Map<string, Record<string, any>>();

  if (patentIds.length === 0) return result;

  // Query in batches to avoid Prisma parameter limits
  const BATCH_SIZE = 5000;
  for (let i = 0; i < patentIds.length; i += BATCH_SIZE) {
    const batch = patentIds.slice(i, i + BATCH_SIZE);

    const where: any = {
      patentId: { in: batch },
    };
    if (subSectorId) {
      where.subSectorId = subSectorId;
    }

    const scores = await prisma.patentSubSectorScore.findMany({
      where,
      select: {
        patentId: true,
        subSectorId: true,
        metrics: true,
        withClaims: true,
        compositeScore: true,
      },
      orderBy: [
        { withClaims: 'desc' },  // Prefer scores computed with claims
        { compositeScore: 'desc' },
      ],
    });

    // For each patent, take the best score record (first one due to ordering)
    for (const score of scores) {
      if (!result.has(score.patentId)) {
        result.set(score.patentId, score.metrics as Record<string, any>);
      }
    }
  }

  return result;
}

// =============================================================================
// Utility: extract attribute names from a FormulaStructure
// =============================================================================

import type { FormulaStructure, FormulaTerm, MetricTerm, GroupTerm } from './formula-types.js';

/**
 * Extract all metric attribute names referenced in a formula structure.
 * Walks the term tree including group terms.
 */
export function extractAttributes(structure: FormulaStructure): string[] {
  const attributes = new Set<string>();

  function walk(terms: FormulaTerm[]) {
    for (const term of terms) {
      if (term.type === 'metric') {
        attributes.add(term.attribute);
      } else if (term.type === 'group') {
        walk(term.terms);
      }
    }
  }

  walk(structure.terms);

  // Also include multiplier attributes
  if (structure.multipliers) {
    for (const mult of structure.multipliers) {
      attributes.add(mult.attribute);
    }
  }

  return Array.from(attributes);
}
