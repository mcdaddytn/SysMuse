/**
 * Enrichment Planner
 *
 * Uses revAIQ currency gaps to plan enrichment runs. Determines which patents
 * need enrichment, at which taxonomy levels, and estimates cost.
 *
 * This is a planning/analysis layer — it does NOT execute enrichment.
 * The actual LLM scoring is handled by llm-scoring-service.ts.
 */

import { PrismaClient } from '@prisma/client';
import { computeCurrencyGaps, getCurrentVersions, type CurrencyGapResult } from './currency-service.js';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface EnrichmentPlan {
  /** Scope of the enrichment */
  scope: {
    taxonomyPath: string;
    portfolioId: string;
    portfolioName: string;
  };

  /** Current revAIQ versions for this path */
  latestRevAIQ: string;

  /** What needs enrichment */
  summary: {
    totalPatents: number;
    currentPatents: number;
    needsEnrichment: number;
    neverScored: number;
    staleByLevel: {
      portfolio: number;
      superSector: number;
      sector: number;
      subSector: number;
    };
  };

  /** Cost estimate */
  costEstimate: {
    patentsToProcess: number;
    avgQuestionsPerPatent: number;
    estimatedTokensPerPatent: number;
    estimatedTotalTokens: number;
    estimatedCost: CostEstimate;
  };

  /** Recommended enrichment batches */
  batches: EnrichmentBatch[];
}

export interface CostEstimate {
  /** Cost in USD at different model tiers */
  sonnet: number;
  haiku: number;
  opus: number;
  /** Model used for default estimate */
  defaultModel: string;
  defaultCost: number;
}

export interface EnrichmentBatch {
  name: string;
  description: string;
  patentCount: number;
  questionsPerPatent: number;
  estimatedTokens: number;
  priority: 'high' | 'medium' | 'low';
  staleLevels: string[];
  patentIds?: string[];
}

// =============================================================================
// Model pricing (per 1M tokens, as of March 2026)
// =============================================================================

const MODEL_PRICING = {
  // Input / Output per 1M tokens
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-opus-4-6': { input: 15.00, output: 75.00 },
};

const AVG_INPUT_TOKENS_PER_PATENT = 2500;   // Patent context + questions
const AVG_OUTPUT_TOKENS_PER_PATENT = 1500;  // Scores + reasoning per question
const AVG_QUESTIONS_PER_PATENT = 12;        // Typical merged template

// =============================================================================
// Core planning
// =============================================================================

/**
 * Create an enrichment plan for a taxonomy scope within a portfolio.
 *
 * @param portfolioId   Portfolio to plan enrichment for
 * @param taxonomyPath  Taxonomy path (e.g., "WIRELESS", "WIRELESS/rf-acoustic")
 * @param options       Planning options
 */
export async function planEnrichment(
  portfolioId: string,
  taxonomyPath: string,
  options?: {
    topN?: number;           // Limit to top N patents by current score (default: all)
    includePatentIds?: boolean;  // Include patent IDs in batches (default: false, for summary only)
  },
): Promise<EnrichmentPlan> {
  // Get portfolio info
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: { id: true, name: true, displayName: true },
  });
  if (!portfolio) throw new Error(`Portfolio ${portfolioId} not found`);

  // Compute currency gaps
  const gaps = await computeCurrencyGaps(portfolioId, taxonomyPath);
  const latestVersions = await getCurrentVersions(taxonomyPath);

  // Determine question count per taxonomy level
  const questionCounts = await estimateQuestionCounts(taxonomyPath);
  const avgQuestions = questionCounts.total;

  // Calculate how many need enrichment
  const needsEnrichment = gaps.total - gaps.current;
  const patentsToProcess = options?.topN ? Math.min(needsEnrichment, options.topN) : needsEnrichment;

  // Build cost estimate
  const tokensPerPatent = AVG_INPUT_TOKENS_PER_PATENT + AVG_OUTPUT_TOKENS_PER_PATENT;
  const totalTokens = patentsToProcess * tokensPerPatent;

  const costEstimate: CostEstimate = {
    sonnet: estimateCost(totalTokens, 'claude-sonnet-4-20250514'),
    haiku: estimateCost(totalTokens, 'claude-haiku-4-5-20251001'),
    opus: estimateCost(totalTokens, 'claude-opus-4-6'),
    defaultModel: 'claude-sonnet-4-20250514',
    defaultCost: estimateCost(totalTokens, 'claude-sonnet-4-20250514'),
  };

  // Build enrichment batches (prioritized)
  const batches = buildBatches(gaps, options?.includePatentIds);

  return {
    scope: {
      taxonomyPath,
      portfolioId: portfolio.id,
      portfolioName: portfolio.displayName || portfolio.name,
    },
    latestRevAIQ: gaps.latestRevAIQ,
    summary: {
      totalPatents: gaps.total,
      currentPatents: gaps.current,
      needsEnrichment,
      neverScored: gaps.neverScored,
      staleByLevel: {
        portfolio: gaps.stalePortfolio,
        superSector: gaps.staleSuperSector,
        sector: gaps.staleSector,
        subSector: gaps.staleSubSector,
      },
    },
    costEstimate: {
      patentsToProcess,
      avgQuestionsPerPatent: avgQuestions,
      estimatedTokensPerPatent: tokensPerPatent,
      estimatedTotalTokens: totalTokens,
      estimatedCost: costEstimate,
    },
    batches,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function estimateCost(totalTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  if (!pricing) return 0;

  // Assume 60% input, 40% output token split
  const inputTokens = totalTokens * 0.6;
  const outputTokens = totalTokens * 0.4;

  const cost = (inputTokens / 1_000_000 * pricing.input) + (outputTokens / 1_000_000 * pricing.output);
  return Math.round(cost * 100) / 100; // Round to cents
}

async function estimateQuestionCounts(taxonomyPath: string): Promise<{
  portfolio: number;
  superSector: number;
  sector: number;
  subSector: number;
  total: number;
}> {
  const parts = taxonomyPath.split('/');

  // Look up QuestionVersion for each level to get question counts
  const counts = { portfolio: 0, superSector: 0, sector: 0, subSector: 0, total: 0 };

  const portfolioVer = await prisma.questionVersion.findFirst({
    where: { level: 'portfolio', scopeId: 'portfolio-default' },
    orderBy: { version: 'desc' },
  });
  counts.portfolio = portfolioVer?.questionCount ?? 7;

  if (parts[0]) {
    const ssVer = await prisma.questionVersion.findFirst({
      where: { level: 'super_sector', scopeId: parts[0].toLowerCase() },
      orderBy: { version: 'desc' },
    });
    counts.superSector = ssVer?.questionCount ?? 0;
  }

  if (parts[1]) {
    const secVer = await prisma.questionVersion.findFirst({
      where: { level: 'sector', scopeId: parts[1] },
      orderBy: { version: 'desc' },
    });
    counts.sector = secVer?.questionCount ?? 0;
  }

  if (parts[2]) {
    const subVer = await prisma.questionVersion.findFirst({
      where: { level: 'sub_sector', scopeId: parts[2] },
      orderBy: { version: 'desc' },
    });
    counts.subSector = subVer?.questionCount ?? 0;
  }

  counts.total = counts.portfolio + counts.superSector + counts.sector + counts.subSector;
  return counts;
}

function buildBatches(gaps: CurrencyGapResult, includePatentIds?: boolean): EnrichmentBatch[] {
  const batches: EnrichmentBatch[] = [];

  // Batch 1: Never-scored patents (highest priority)
  const neverScored = gaps.patents.filter(p => p.currentRevAIQ === null);
  if (neverScored.length > 0) {
    batches.push({
      name: 'Never Scored',
      description: `${neverScored.length} patents have never been LLM-scored in this taxonomy path`,
      patentCount: neverScored.length,
      questionsPerPatent: AVG_QUESTIONS_PER_PATENT,
      estimatedTokens: neverScored.length * (AVG_INPUT_TOKENS_PER_PATENT + AVG_OUTPUT_TOKENS_PER_PATENT),
      priority: 'high',
      staleLevels: ['all'],
      ...(includePatentIds && { patentIds: neverScored.map(p => p.patentId) }),
    });
  }

  // Batch 2: Stale at portfolio level (portfolio questions changed)
  const stalePortfolio = gaps.patents.filter(p =>
    p.currentRevAIQ !== null && p.staleLevels.includes('portfolio')
  );
  if (stalePortfolio.length > 0) {
    batches.push({
      name: 'Stale Portfolio Questions',
      description: `${stalePortfolio.length} patents need updated portfolio-level questions`,
      patentCount: stalePortfolio.length,
      questionsPerPatent: AVG_QUESTIONS_PER_PATENT,
      estimatedTokens: stalePortfolio.length * (AVG_INPUT_TOKENS_PER_PATENT + AVG_OUTPUT_TOKENS_PER_PATENT),
      priority: 'high',
      staleLevels: ['portfolio'],
      ...(includePatentIds && { patentIds: stalePortfolio.map(p => p.patentId) }),
    });
  }

  // Batch 3: Stale at taxonomy level only (sector/sub-sector questions changed)
  const staleTaxonomy = gaps.patents.filter(p =>
    p.currentRevAIQ !== null &&
    !p.staleLevels.includes('portfolio') &&
    (p.staleLevels.includes('super_sector') || p.staleLevels.includes('sector') || p.staleLevels.includes('sub_sector'))
  );
  if (staleTaxonomy.length > 0) {
    batches.push({
      name: 'Stale Taxonomy Questions',
      description: `${staleTaxonomy.length} patents need updated sector/sub-sector questions`,
      patentCount: staleTaxonomy.length,
      questionsPerPatent: AVG_QUESTIONS_PER_PATENT,
      estimatedTokens: staleTaxonomy.length * (AVG_INPUT_TOKENS_PER_PATENT + AVG_OUTPUT_TOKENS_PER_PATENT),
      priority: 'medium',
      staleLevels: [...new Set(staleTaxonomy.flatMap(p => p.staleLevels))],
      ...(includePatentIds && { patentIds: staleTaxonomy.map(p => p.patentId) }),
    });
  }

  return batches;
}
