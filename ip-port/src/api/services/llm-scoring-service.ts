/**
 * LLM Scoring Service
 *
 * Uses Claude to score patents against their sector-specific templates.
 * Produces both numeric scores and reasoning text for each metric.
 */

import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveEffectiveTemplate,
  savePatentScore,
  ScoringQuestion,
  MetricScore,
  ScoreCalculationResult,
  calculateCompositeScore,
  getMergedTemplateForSector,
  getMergedTemplateForSubSector,
  loadSubSectorTemplates,
  matchSubSectorTemplate,
  MergedTemplate
} from './scoring-template-service.js';
import { extractClaimsText, getClaimsStats } from './patent-xml-parser-service.js';
import { loadAllClassifications } from './scoring-service.js';

const prisma = new PrismaClient();

// Initialize Anthropic client
const anthropic = new Anthropic();

// ============================================================================
// Types
// ============================================================================

export interface PatentForScoring {
  patent_id: string;
  patent_title: string;
  abstract?: string | null;
  primary_sub_sector_id?: string;
  primary_sub_sector_name?: string;
  primary_sector?: string;
  super_sector?: string;
  cpc_codes?: string[];
  claims_text?: string;  // If available
  // LLM enrichment data
  llm_summary?: string | null;
  llm_prior_art_problem?: string | null;
  llm_technical_solution?: string | null;
}

export interface ScoringResult {
  patentId: string;
  subSectorId: string;
  success: boolean;
  metrics?: Record<string, MetricScore>;
  compositeScore?: number;
  error?: string;
  tokenUsage?: { input: number; output: number };
}

export interface BatchScoringResult {
  total: number;
  successful: number;
  failed: number;
  results: ScoringResult[];
  totalTokens: { input: number; output: number };
}

/**
 * Context options for controlling what data is included in scoring prompts
 */
export interface ContextOptions {
  includeAbstract?: boolean;
  includeLlmSummary?: boolean;
  includeClaims?: 'none' | 'independent_only' | 'all';
  maxClaimTokens?: number;
  maxClaims?: number;
}

export const DEFAULT_CONTEXT_OPTIONS: ContextOptions = {
  includeAbstract: true,
  includeLlmSummary: true,
  includeClaims: 'independent_only',
  maxClaimTokens: 800,
  maxClaims: 5,
};

/**
 * Scoring filter for controlling which patents to score.
 * Replaces the binary onlyUnscored/rescore flags.
 */
export type ScoringFilter = 'unscored' | 'stale' | 'unscored_or_stale' | 'all';

/**
 * Comparison result for A/B testing
 */
export interface ComparisonResult {
  patentId: string;
  baselineScore: ScoringResult;
  claimsScore: ScoringResult;
  scoreDelta: number;
  metricDeltas: Record<string, number>;
  claimsTokensUsed: number;
}

// ============================================================================
// Patent Data Enrichment (from file caches)
// ============================================================================

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
 * Load LLM enrichment data from cache.
 * Checks file cache first (legacy ~31K patents), then falls back to
 * PatentSubSectorScore.metrics for patents scored by the new pipeline.
 */
function loadLlmData(patentId: string): { summary?: string; prior_art_problem?: string; technical_solution?: string } | null {
  // 1. Try legacy file cache
  try {
    const cachePath = path.join(process.cwd(), 'cache/llm-scores', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return {
        summary: data.summary || null,
        prior_art_problem: data.prior_art_problem || null,
        technical_solution: data.technical_solution || null,
      };
    }
  } catch {
    // Cache file unreadable
  }

  // 2. Fallback: check PatentSubSectorScore metrics for text questions from new pipeline
  // This is sync-friendly because enrichment runs before scoring, so we check
  // if a previous scoring pass already produced these text fields.
  try {
    // Use synchronous query pattern — read from file cache of DB scores
    const dbCachePath = path.join(process.cwd(), 'cache/llm-scores-db', `${patentId}.json`);
    if (fs.existsSync(dbCachePath)) {
      const metrics = JSON.parse(fs.readFileSync(dbCachePath, 'utf-8'));
      const summary = metrics.patent_summary?.reasoning;
      const priorArt = metrics.prior_art_problem?.reasoning;
      const techSolution = metrics.technical_solution?.reasoning;
      if (summary || priorArt || techSolution) {
        return {
          summary: summary || null,
          prior_art_problem: priorArt || null,
          technical_solution: techSolution || null,
        };
      }
    }
  } catch {
    // DB cache file unreadable
  }

  return null;
}

/**
 * Load claims text from USPTO XML files
 */
function loadClaims(patentId: string, options: ContextOptions): string | null {
  if (options.includeClaims === 'none') {
    return null;
  }

  const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';

  return extractClaimsText(patentId, xmlDir, {
    independentOnly: options.includeClaims === 'independent_only',
    maxClaims: options.maxClaims || 5,
    maxTokens: options.maxClaimTokens || 800,
  });
}

/**
 * Enrich patent with full data from file caches (abstract, LLM data, claims, etc.)
 */
async function enrichPatentData(
  patent: PatentForScoring,
  contextOptions: ContextOptions = DEFAULT_CONTEXT_OPTIONS
): Promise<PatentForScoring> {
  const abstract = contextOptions.includeAbstract ? loadAbstract(patent.patent_id) : null;
  const llmData = contextOptions.includeLlmSummary ? loadLlmData(patent.patent_id) : null;
  const claimsText = loadClaims(patent.patent_id, contextOptions);

  return {
    ...patent,
    abstract: abstract || patent.abstract,
    llm_summary: llmData?.summary || null,
    llm_prior_art_problem: llmData?.prior_art_problem || null,
    llm_technical_solution: llmData?.technical_solution || null,
    claims_text: claimsText || patent.claims_text,
  };
}

/**
 * Batch enrich multiple patents
 */
async function enrichPatentBatch(
  patents: PatentForScoring[],
  contextOptions: ContextOptions = DEFAULT_CONTEXT_OPTIONS
): Promise<PatentForScoring[]> {
  return patents.map(patent => {
    const abstract = contextOptions.includeAbstract ? loadAbstract(patent.patent_id) : null;
    const llmData = contextOptions.includeLlmSummary ? loadLlmData(patent.patent_id) : null;
    const claimsText = loadClaims(patent.patent_id, contextOptions);

    return {
      ...patent,
      abstract: abstract || patent.abstract,
      llm_summary: llmData?.summary || null,
      llm_prior_art_problem: llmData?.prior_art_problem || null,
      llm_technical_solution: llmData?.technical_solution || null,
      claims_text: claimsText || patent.claims_text,
    };
  });
}

// ============================================================================
// Prompt Construction
// ============================================================================

/**
 * Build the scoring prompt for a patent
 * Supports both legacy (questions array) and new (MergedTemplate) formats
 */
function buildScoringPrompt(
  patent: PatentForScoring,
  templateOrQuestions: MergedTemplate | ScoringQuestion[]
): string {
  // Handle both old and new format
  const questions = Array.isArray(templateOrQuestions)
    ? templateOrQuestions
    : templateOrQuestions.questions;
  const scoringGuidance = Array.isArray(templateOrQuestions)
    ? []
    : (templateOrQuestions.scoringGuidance || []);
  const contextDescription = Array.isArray(templateOrQuestions)
    ? ''
    : (templateOrQuestions.contextDescription || '');

  // Separate numeric and text questions for different prompt formatting
  const numericQuestions = questions.filter(q => q.answerType !== 'text');
  const textQuestions = questions.filter(q => q.answerType === 'text');

  const numericPrompts = numericQuestions.map((q, i) => {
    let prompt = `${i + 1}. **${q.displayName}** (fieldName: "${q.fieldName}")
   Question: ${q.question}`;

    if (q.scale) {
      prompt += `\n   Scale: ${q.scale.min}-${q.scale.max}`;
    }

    if (q.reasoningPrompt) {
      prompt += `\n   Reasoning guidance: ${q.reasoningPrompt}`;
    }

    return prompt;
  }).join('\n\n');

  const textPrompts = textQuestions.map((q, i) => {
    return `${numericQuestions.length + i + 1}. **${q.displayName}** (fieldName: "${q.fieldName}")
   Question: ${q.question}`;
  }).join('\n\n');

  // Build context sections
  const hasLlmData = patent.llm_summary || patent.llm_prior_art_problem || patent.llm_technical_solution;

  let llmContextSection = '';
  if (hasLlmData) {
    llmContextSection = `
## AI Analysis Summary
${patent.llm_summary ? `**Summary:** ${patent.llm_summary}` : ''}
${patent.llm_prior_art_problem ? `**Problem Addressed:** ${patent.llm_prior_art_problem}` : ''}
${patent.llm_technical_solution ? `**Technical Solution:** ${patent.llm_technical_solution}` : ''}
`;
  }

  // Build scoring guidance section
  let guidanceSection = '';
  if (scoringGuidance.length > 0) {
    guidanceSection = `
## Scoring Guidelines

${scoringGuidance.map(g => `- ${g}`).join('\n')}
`;
  }

  // Build technology context section
  let techContextSection = '';
  if (contextDescription) {
    techContextSection = `
## Technology Context

${contextDescription}
`;
  }

  return `You are a patent analyst evaluating patents for litigation and licensing potential.
${guidanceSection}${techContextSection}
## Patent Information

**Patent ID:** ${patent.patent_id}
**Title:** ${patent.patent_title}
**Sector:** ${patent.super_sector} > ${patent.primary_sector}
**Sub-Sector:** ${patent.primary_sub_sector_name || 'Unassigned'}
${patent.cpc_codes?.length ? `**CPC Codes:** ${patent.cpc_codes.join(', ')}` : ''}

**Abstract:**
${patent.abstract || 'No abstract available.'}
${llmContextSection}
${patent.claims_text ? `\n## Key Claims\n${patent.claims_text}` : ''}

## Scoring Questions

For each numeric question below, provide:
1. A numeric score within the specified scale
2. A brief reasoning explaining your score (2-3 sentences)
3. A confidence level (high/medium/low)

${numericPrompts}
${textQuestions.length > 0 ? `
## Text Questions

For each text question below, provide a concise text response:

${textPrompts}
` : ''}
## Response Format

Respond with a JSON object containing the scores. Use this exact structure:

\`\`\`json
{
  "scores": {
    "${numericQuestions[0]?.fieldName || 'example_field'}": {
      "score": 7,
      "reasoning": "Brief explanation of the score...",
      "confidence": "high"
    }${textQuestions.length > 0 ? `,
    "${textQuestions[0]?.fieldName || 'text_field'}": {
      "text": "Your concise text response...",
      "confidence": "high"
    }` : ''}
  }
}
\`\`\`

Be objective and critical. Follow the scoring guidelines above.`;
}

// ============================================================================
// Response Parsing (shared by realtime and batch scoring)
// ============================================================================

/**
 * Parse an LLM scoring response into MetricScore records.
 * Used by both realtime scorePatent() and batch processBatchResults().
 */
export function parseScoreResponse(
  responseText: string,
  questions: ScoringQuestion[]
): { metrics: Record<string, MetricScore>; compositeScore: number } {
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonMatch) {
    throw new Error('Could not find JSON in response');
  }

  const parsed = JSON.parse(jsonMatch[1]);
  const scores = parsed.scores as Record<string, any>;

  // Build a lookup for question types
  const questionTypes = new Map(questions.map(q => [q.fieldName, q.answerType]));

  const metrics: Record<string, MetricScore> = {};
  for (const [fieldName, data] of Object.entries(scores)) {
    const answerType = questionTypes.get(fieldName);

    if (answerType === 'text') {
      // Text questions: store text in reasoning, score = 0
      metrics[fieldName] = {
        score: 0,
        reasoning: data.text || data.reasoning || '',
        confidence: data.confidence === 'high' ? 1.0 : data.confidence === 'medium' ? 0.7 : 0.5
      };
    } else {
      // Numeric questions: standard score + reasoning
      metrics[fieldName] = {
        score: data.score,
        reasoning: data.reasoning,
        confidence: data.confidence === 'high' ? 1.0 : data.confidence === 'medium' ? 0.7 : 0.5
      };
    }
  }

  const compositeScore = calculateCompositeScore(metrics, questions);
  return { metrics, compositeScore };
}

// ============================================================================
// LLM Scoring
// ============================================================================

/**
 * Score a single patent using the LLM
 */
export async function scorePatent(
  patent: PatentForScoring,
  options: {
    model?: string;
    saveToDb?: boolean;
    skipEnrichment?: boolean;
    contextOptions?: ContextOptions;
    template?: MergedTemplate;  // Pre-resolved template (for batch scoring by sector)
    sectorId?: string;  // Fallback ID for DB key when patent has no sub-sector
  } = {}
): Promise<ScoringResult> {
  const {
    model = 'claude-sonnet-4-20250514',
    saveToDb = true,
    skipEnrichment = false,
    contextOptions = DEFAULT_CONTEXT_OPTIONS,
    template: providedTemplate,
    sectorId
  } = options;

  // Enrich patent with full data from file caches
  const enrichedPatent = skipEnrichment ? patent : await enrichPatentData(patent, contextOptions);

  // Get sub-sector ID — fall back to sector name for sector-level scoring
  const subSectorId = enrichedPatent.primary_sub_sector_id || patent.primary_sub_sector_id || sectorId;
  if (!subSectorId && !providedTemplate) {
    return {
      patentId: patent.patent_id,
      subSectorId: '',
      success: false,
      error: 'Patent has no assigned sub-sector and no template provided'
    };
  }

  // Get effective template - use provided or resolve from sub-sector
  let template: MergedTemplate | { questions: ScoringQuestion[] } | null = providedTemplate || null;
  if (!template && subSectorId) {
    template = await resolveEffectiveTemplate(subSectorId);
  }
  if (!template) {
    return {
      patentId: enrichedPatent.patent_id,
      subSectorId: subSectorId || '',
      success: false,
      error: 'No scoring template found'
    };
  }

  // Build prompt with enriched data (supports both MergedTemplate and legacy format)
  const prompt = buildScoringPrompt(enrichedPatent, template as MergedTemplate);

  try {
    // Call Claude with retry for rate limits / overloaded
    let response: Anthropic.Message | null = null;
    const MAX_RETRIES = parseInt(process.env.LLM_MAX_RETRIES || '3');
    const retryBaseDelay = parseInt(process.env.LLM_RETRY_BASE_DELAY || '5000');
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        });
        break; // Success
      } catch (apiError: any) {
        const status = apiError?.status || apiError?.error?.status;
        const isRetryable = status === 429 || status === 529 || apiError?.message?.includes('overloaded');
        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * retryBaseDelay;
          console.log(`[LLM Scoring] Rate limited on ${patent.patent_id}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw apiError; // Non-retryable or exhausted retries
      }
    }
    if (!response) throw new Error('No response after retries');

    // Parse response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    const { metrics, compositeScore } = parseScoreResponse(content.text, template.questions);

    // Save to database if requested
    if (saveToDb) {
      // Check if this is a MergedTemplate (from JSON config) or legacy DB template
      const isMergedTemplate = 'inheritanceChain' in template;

      let templateId: string | undefined;
      let templateConfigId: string | undefined;
      let templateVersion = 1;

      if (isMergedTemplate) {
        // Using JSON config template
        const mergedTemplate = template as MergedTemplate;
        templateConfigId = mergedTemplate.inheritanceChain[mergedTemplate.inheritanceChain.length - 1];
        templateVersion = 1; // JSON templates don't have versions yet
      } else {
        // Legacy DB template
        templateId = (template as any).templateId;
        const dbTemplate = await prisma.scoringTemplate.findFirst({
          where: { id: templateId }
        });
        templateVersion = dbTemplate?.version || 1;
      }

      const result: ScoreCalculationResult = {
        patentId: enrichedPatent.patent_id,
        subSectorId,
        metrics,
        compositeScore,
        templateId,
        templateConfigId,
        templateVersion,
        withClaims: contextOptions.includeClaims !== 'none',
        llmModel: model,
        tokensUsed: response.usage.input_tokens + response.usage.output_tokens
      };

      await savePatentScore(result);
    }

    return {
      patentId: enrichedPatent.patent_id,
      subSectorId,
      success: true,
      metrics,
      compositeScore,
      tokenUsage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens
      }
    };

  } catch (error: any) {
    const errMsg = error?.message || error?.error?.message || JSON.stringify(error).substring(0, 300);
    console.error(`[LLM Scoring] Error scoring ${enrichedPatent.patent_id}: ${errMsg}`);
    return {
      patentId: enrichedPatent.patent_id,
      subSectorId,
      success: false,
      error: errMsg
    };
  }
}

/**
 * Score multiple patents in batch
 */
export async function scorePatentBatch(
  patents: PatentForScoring[],
  options: {
    model?: string;
    saveToDb?: boolean;
    concurrency?: number;
    progressCallback?: (completed: number, total: number) => void;
    contextOptions?: ContextOptions;
    template?: MergedTemplate;  // Pre-resolved template (for sector batch scoring)
    sectorId?: string;  // Fallback ID for DB key when patents have no sub-sector
  } = {}
): Promise<BatchScoringResult> {
  const envConcurrency = process.env.LLM_CONCURRENCY ? parseInt(process.env.LLM_CONCURRENCY) : undefined;
  const { concurrency = envConcurrency || 3, progressCallback, contextOptions = DEFAULT_CONTEXT_OPTIONS, template, sectorId } = options;

  const results: ScoringResult[] = [];
  let successful = 0;
  let failed = 0;
  let totalInput = 0;
  let totalOutput = 0;

  // Enrich all patents upfront for efficiency
  console.log(`[LLM Scoring] Enriching ${patents.length} patents with database data...`);
  const enrichedPatents = await enrichPatentBatch(patents, contextOptions);
  const enrichedCount = enrichedPatents.filter(p => p.abstract).length;
  const claimsCount = enrichedPatents.filter(p => p.claims_text).length;
  console.log(`[LLM Scoring] ${enrichedCount}/${patents.length} patents have abstracts, ${claimsCount} have claims`);

  // Process in batches with concurrency limit
  for (let i = 0; i < enrichedPatents.length; i += concurrency) {
    const batch = enrichedPatents.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(patent => scorePatent(patent, { ...options, skipEnrichment: true, contextOptions, template, sectorId: sectorId || patent.primary_sector }))
    );

    let batchFailed = 0;
    for (const result of batchResults) {
      results.push(result);
      if (result.success) {
        successful++;
        if (result.tokenUsage) {
          totalInput += result.tokenUsage.input;
          totalOutput += result.tokenUsage.output;
        }
      } else {
        failed++;
        batchFailed++;
      }
    }

    if (progressCallback) {
      progressCallback(results.length, patents.length);
    }

    // Delay between batches — increase if we're seeing failures (likely rate limited)
    if (i + concurrency < patents.length) {
      const successDelay = parseInt(process.env.LLM_INTER_BATCH_DELAY || '500');
      const delay = batchFailed > 0 ? 5000 : successDelay;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  return {
    total: patents.length,
    successful,
    failed,
    results,
    totalTokens: { input: totalInput, output: totalOutput }
  };
}

/**
 * Get patents from a sub-sector ready for scoring
 */
export async function getPatentsForScoring(
  subSectorId: string,
  options: { limit?: number; onlyUnscored?: boolean } = {}
): Promise<PatentForScoring[]> {
  const { limit = 10, onlyUnscored = true } = options;

  // Get sub-sector info
  const subSector = await prisma.subSector.findUnique({
    where: { id: subSectorId },
    include: {
      sector: {
        include: { superSector: true }
      }
    }
  });

  if (!subSector) {
    throw new Error(`Sub-sector not found: ${subSectorId}`);
  }

  // Build filter for unscored patents if requested
  let scoredPatentIds: string[] = [];
  if (onlyUnscored) {
    const scored = await prisma.patentSubSectorScore.findMany({
      where: { subSectorId },
      select: { patentId: true }
    });
    scoredPatentIds = scored.map(s => s.patentId);
  }

  // Query candidates file for patents in this sub-sector
  const fs = await import('fs');
  const path = await import('path');

  // Try multiple possible candidates file locations
  const possiblePaths = [
    path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json'),
    path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-24.json'),
    path.join(process.cwd(), 'data', 'streaming-candidates-2026-01-25.json')
  ];

  let candidatesPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      candidatesPath = p;
      break;
    }
  }

  if (!candidatesPath) {
    throw new Error('Candidates file not found. Tried: ' + possiblePaths.join(', '));
  }

  const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));

  // Handle both array format and object-with-candidates format
  const candidates = Array.isArray(fileContent) ? fileContent : fileContent.candidates;

  if (!Array.isArray(candidates)) {
    throw new Error('Invalid candidates file format - expected array or object with candidates array');
  }

  // Filter to this sub-sector
  const filtered = candidates.filter((p: any) => {
    if (p.primary_sub_sector_id !== subSectorId) return false;
    if (onlyUnscored && scoredPatentIds.includes(p.patent_id)) return false;
    return true;
  });

  // Take limit
  const selected = filtered.slice(0, limit);

  // Map to PatentForScoring
  return selected.map((p: any) => ({
    patent_id: p.patent_id,
    patent_title: p.patent_title,
    abstract: p.abstract,
    primary_sub_sector_id: p.primary_sub_sector_id,
    primary_sub_sector_name: p.primary_sub_sector_name,
    primary_sector: subSector.sector.name,
    super_sector: subSector.sector.superSector.name,
    cpc_codes: p.cpc_codes || []
  }));
}

/**
 * Score all patents in a sub-sector
 */
export async function scoreSubSector(
  subSectorId: string,
  options: {
    limit?: number;
    model?: string;
    progressCallback?: (completed: number, total: number, lastResult: ScoringResult) => void;
    contextOptions?: ContextOptions;
  } = {}
): Promise<BatchScoringResult> {
  const { limit = 50, model, progressCallback, contextOptions = DEFAULT_CONTEXT_OPTIONS } = options;

  // Get patents to score
  const patents = await getPatentsForScoring(subSectorId, { limit, onlyUnscored: true });

  if (patents.length === 0) {
    return {
      total: 0,
      successful: 0,
      failed: 0,
      results: [],
      totalTokens: { input: 0, output: 0 }
    };
  }

  console.log(`[LLM Scoring] Scoring ${patents.length} patents in sub-sector ${subSectorId}`);

  // Score the batch
  return scorePatentBatch(patents, {
    model,
    saveToDb: true,
    concurrency: 4,  // Increased for faster throughput
    contextOptions,
    progressCallback: (completed, total) => {
      console.log(`[LLM Scoring] Progress: ${completed}/${total}`);
    }
  });
}

/**
 * Get all patents in a sector ready for scoring
 */
// V2 scoring weights interface
export interface V2Weights {
  citation: number;
  years: number;
  competitor: number;
}

// Default V2 weights
const DEFAULT_V2_WEIGHTS: V2Weights = {
  citation: 50,
  years: 30,
  competitor: 20
};

// Calculate V2 score for a patent
function calculateV2Score(patent: any, weights: V2Weights): number {
  const totalWeight = weights.citation + weights.years + weights.competitor;
  if (totalWeight === 0) return 0;

  const citationNorm = weights.citation / totalWeight;
  const yearsNorm = weights.years / totalWeight;
  const competitorNorm = weights.competitor / totalWeight;

  // Forward citations: log scale
  const citationScore = Math.log10((patent.forward_citations || 0) + 1) * 30 * citationNorm;
  // Remaining years: linear scale (max 20 years)
  const yearsScore = Math.min((patent.remaining_years || 0) / 20, 1) * 100 * yearsNorm;
  // Competitor citations: direct multiplier
  const competitorScore = (patent.competitor_citations || 0) * 15 * competitorNorm;

  return citationScore + yearsScore + competitorScore;
}

export async function getPatentsForSectorScoring(
  sectorName: string,
  options: {
    portfolioId?: string;
    limit?: number;
    onlyUnscored?: boolean;
    scoringFilter?: ScoringFilter;
    minYear?: number;
    minScore?: number;
    excludeDesign?: boolean;
    prioritizeBy?: 'base' | 'v2';
    v2Weights?: V2Weights;
  } = {}
): Promise<PatentForScoring[]> {
  // Resolve scoringFilter from legacy flags for backward compatibility
  let resolvedFilter: ScoringFilter;
  if (options.scoringFilter) {
    resolvedFilter = options.scoringFilter;
  } else if (options.onlyUnscored === false) {
    resolvedFilter = 'all';
  } else {
    resolvedFilter = 'unscored';
  }

  const { portfolioId, limit = 500, minYear, minScore, excludeDesign = true, prioritizeBy = 'base', v2Weights = DEFAULT_V2_WEIGHTS } = options;

  let filtered: any[];

  if (portfolioId) {
    // ── PostgreSQL path: load from database ──
    console.log(`[LLM Scoring] Loading patents from portfolio ${portfolioId}, sector: ${sectorName}`);

    const dbPatents = await prisma.patent.findMany({
      where: {
        primarySector: sectorName,
        portfolios: { some: { portfolioId } },
      },
      select: {
        patentId: true,
        title: true,
        abstract: true,
        grantDate: true,
        baseScore: true,
        primarySector: true,
        superSector: true,
        primarySubSectorId: true,
        primarySubSectorName: true,
        cpcCodes: { select: { cpcCode: true } },
      },
    });

    // Map DB fields to the common format used by filtering/sorting below
    filtered = dbPatents.map(p => ({
      patent_id: p.patentId,
      patent_title: p.title,
      abstract: p.abstract,
      patent_date: p.grantDate,
      score: p.baseScore ?? 0,
      primary_sector: p.primarySector,
      super_sector: p.superSector,
      primary_sub_sector_id: p.primarySubSectorId,
      primary_sub_sector_name: p.primarySubSectorName,
      cpc_codes: p.cpcCodes.map(c => c.cpcCode),
    }));

    console.log(`[LLM Scoring] Found ${filtered.length} patents in sector ${sectorName} from portfolio`);
  } else {
    // ── Legacy file path: load from candidates file ──
    const possiblePaths = [
      path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json'),
      path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-24.json'),
    ];

    let candidatesPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        candidatesPath = p;
        break;
      }
    }

    if (!candidatesPath) {
      throw new Error('Candidates file not found. Provide a portfolioId to load from database instead.');
    }

    const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
    const candidates = Array.isArray(fileContent) ? fileContent : fileContent.candidates;
    filtered = candidates.filter((p: any) => p.primary_sector === sectorName);
  }

  // Filter by minimum year if specified
  if (minYear) {
    filtered = filtered.filter((p: any) => {
      const year = parseInt(p.patent_date?.substring(0, 4) || '0');
      return year >= minYear;
    });
    console.log(`[LLM Scoring] Filtered to patents from ${minYear}+: ${filtered.length} patents`);
  }

  // Filter by minimum base score if specified
  if (minScore !== undefined) {
    filtered = filtered.filter((p: any) => (p.score ?? 0) >= minScore);
    console.log(`[LLM Scoring] Filtered to score >= ${minScore}: ${filtered.length} patents`);
  }

  // Exclude design patents (D-prefix) if requested
  if (excludeDesign) {
    const beforeCount = filtered.length;
    filtered = filtered.filter((p: any) => !p.patent_id.startsWith('D'));
    const removed = beforeCount - filtered.length;
    if (removed > 0) {
      console.log(`[LLM Scoring] Excluded ${removed} design patents: ${filtered.length} remaining`);
    }
  }

  // Apply scoring filter (scoped to this sector + its sub-sector templates)
  if (resolvedFilter !== 'all') {
    // Build the set of subSectorId values that belong to this sector
    const sectorSubTemplates = loadSubSectorTemplates();
    const subSectorIds = Array.from(sectorSubTemplates.values())
      .filter(t => t.sectorName === sectorName && t.level === 'sub_sector')
      .map(t => t.id);
    const allSectorIds = [sectorName, ...subSectorIds];

    const scores = await prisma.patentSubSectorScore.findMany({
      where: { subSectorId: { in: allSectorIds } },
      select: { patentId: true, isStale: true }
    });

    if (resolvedFilter === 'unscored') {
      const scoredIds = new Set(scores.map(s => s.patentId));
      filtered = filtered.filter((p: any) => !scoredIds.has(p.patent_id));
    } else if (resolvedFilter === 'stale') {
      const staleIds = new Set(scores.filter(s => s.isStale).map(s => s.patentId));
      filtered = filtered.filter((p: any) => staleIds.has(p.patent_id));
    } else if (resolvedFilter === 'unscored_or_stale') {
      const scoredIds = new Set(scores.map(s => s.patentId));
      const staleIds = new Set(scores.filter(s => s.isStale).map(s => s.patentId));
      filtered = filtered.filter((p: any) => !scoredIds.has(p.patent_id) || staleIds.has(p.patent_id));
    }

    console.log(`[LLM Scoring] Scoring filter: ${resolvedFilter} (sector scope: ${allSectorIds.length} IDs) → ${filtered.length} patents after filter`);
  }

  // Sort by selected prioritization method
  if (prioritizeBy === 'v2') {
    // Load classifications to get competitor_citations for V2 scoring
    const classifications = loadAllClassifications();

    // Merge classification data and calculate V2 scores
    const withV2 = filtered.map((p: any) => {
      const cls = classifications.get(p.patent_id);
      const enriched = {
        ...p,
        competitor_citations: cls?.competitor_citations ?? 0,
        affiliate_citations: cls?.affiliate_citations ?? 0,
        neutral_citations: cls?.neutral_citations ?? 0,
      };
      return {
        ...enriched,
        _v2Score: calculateV2Score(enriched, v2Weights)
      };
    });
    withV2.sort((a: any, b: any) => (b._v2Score ?? 0) - (a._v2Score ?? 0));
    filtered = withV2;

    console.log(`[LLM Scoring] After sorting by V2 score (weights: cit=${v2Weights.citation}, yrs=${v2Weights.years}, comp=${v2Weights.competitor}), top 5 patents:`);
    filtered.slice(0, 5).forEach((p: any, i: number) => {
      console.log(`  ${i+1}. ${p.patent_id}: v2_score=${p._v2Score?.toFixed(1)}, base_score=${p.score}, comp_cites=${p.competitor_citations}`);
    });
  } else {
    // Sort by base score (default)
    filtered.sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0));

    console.log(`[LLM Scoring] After sorting by base score, top 5 patents:`);
    filtered.slice(0, 5).forEach((p: any, i: number) => {
      console.log(`  ${i+1}. ${p.patent_id}: base_score=${p.score}`);
    });
  }

  // Take limit
  const selected = filtered.slice(0, limit);

  // Map to PatentForScoring
  return selected.map((p: any) => ({
    patent_id: p.patent_id,
    patent_title: p.patent_title,
    abstract: p.abstract,
    primary_sub_sector_id: p.primary_sub_sector_id,
    primary_sub_sector_name: p.primary_sub_sector_name,
    primary_sector: p.primary_sector,
    super_sector: p.super_sector,
    cpc_codes: p.cpc_codes || []
  }));
}

/**
 * Score all patents in a sector
 */
export async function scoreSector(
  sectorName: string,
  options: {
    limit?: number;
    model?: string;
    concurrency?: number;
    contextOptions?: ContextOptions;
    rescore?: boolean;  // If true, score patents even if already scored
    scoringFilter?: ScoringFilter;
    minYear?: number;   // Filter to patents from this year or later
    minScore?: number;  // Filter to patents with base score >= this value
    excludeDesign?: boolean;  // Exclude design patents (D-prefix)
    prioritizeBy?: 'base' | 'v2';  // How to prioritize patents for scoring
    v2Weights?: V2Weights;  // Custom V2 weights when prioritizeBy='v2'
  } = {}
): Promise<BatchScoringResult> {
  const { limit = 2000, model, concurrency = 4, contextOptions = DEFAULT_CONTEXT_OPTIONS, rescore = false, scoringFilter, minYear, minScore, excludeDesign = true, prioritizeBy = 'base', v2Weights } = options;

  // Resolve scoringFilter: explicit param > legacy rescore flag
  const effectiveFilter: ScoringFilter = scoringFilter || (rescore ? 'all' : 'unscored');

  console.log(`[LLM Scoring] Starting sector scoring for: ${sectorName} (filter: ${effectiveFilter})`);
  if (prioritizeBy === 'v2') {
    console.log(`[LLM Scoring] Prioritizing by V2 score`);
  }

  // Get patents to score
  const patents = await getPatentsForSectorScoring(sectorName, { limit, scoringFilter: effectiveFilter, minYear, minScore, excludeDesign, prioritizeBy, v2Weights });

  if (patents.length === 0) {
    console.log(`[LLM Scoring] No patents found in sector: ${sectorName} (filter: ${effectiveFilter})`);
    return {
      total: 0,
      successful: 0,
      failed: 0,
      results: [],
      totalTokens: { input: 0, output: 0 }
    };
  }

  console.log(`[LLM Scoring] Found ${patents.length} patents to score in sector: ${sectorName}`);
  if (contextOptions.includeClaims !== 'none') {
    console.log(`[LLM Scoring] Using CLAIMS CONTEXT (${contextOptions.includeClaims})`);
  }

  // First patent gives us the super-sector context
  const superSector = patents[0]?.super_sector || 'WIRELESS';

  // Group patents by sub-sector template (if any sub-sector templates exist for this sector)
  const subSectorTemplates = loadSubSectorTemplates();
  const sectorSubTemplates = Array.from(subSectorTemplates.values())
    .filter(t => t.sectorName === sectorName && t.level === 'sub_sector');

  if (sectorSubTemplates.length > 0) {
    // Group patents by matching sub-sector template
    const groups = new Map<string | null, PatentForScoring[]>();  // null = no sub-sector match
    for (const patent of patents) {
      const matched = matchSubSectorTemplate(sectorName, patent.cpc_codes || []);
      const key = matched?.id || null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(patent);
    }

    console.log(`[LLM Scoring] Sub-sector grouping for ${sectorName}:`);
    for (const [subId, groupPatents] of groups) {
      console.log(`  ${subId || '(sector-level)'}: ${groupPatents.length} patents`);
    }

    // Score each group with its template
    const allResults: ScoringResult[] = [];
    let totalTokens = { input: 0, output: 0 };
    let totalCompleted = 0;

    for (const [subSectorId, groupPatents] of groups) {
      let template;
      if (subSectorId) {
        template = getMergedTemplateForSubSector(subSectorId, sectorName, superSector);
      } else {
        template = getMergedTemplateForSector(sectorName, superSector);
      }
      console.log(`[LLM Scoring] Scoring ${groupPatents.length} patents with template: ${template.inheritanceChain.join(' → ')} (${template.questions.length} questions)`);

      const result = await scorePatentBatch(groupPatents, {
        model,
        saveToDb: true,
        concurrency,
        contextOptions,
        template,
        sectorId: subSectorId || sectorName,
        progressCallback: (completed, total) => {
          const globalPct = Math.round(((totalCompleted + completed) / patents.length) * 100);
          console.log(`[LLM Scoring] Sector ${sectorName} [${subSectorId || 'sector-level'}]: ${completed}/${total} (${globalPct}% overall)`);
        }
      });

      allResults.push(...result.results);
      totalTokens.input += result.totalTokens.input;
      totalTokens.output += result.totalTokens.output;
      totalCompleted += groupPatents.length;
    }

    return {
      total: patents.length,
      successful: allResults.filter(r => r.success).length,
      failed: allResults.filter(r => !r.success).length,
      results: allResults,
      totalTokens
    };
  }

  // No sub-sector templates — use sector-level template (existing behavior)
  const template = getMergedTemplateForSector(sectorName, superSector);
  console.log(`[LLM Scoring] Using template: ${template.inheritanceChain.join(' → ')} (${template.questions.length} questions)`);

  // Score the batch
  return scorePatentBatch(patents, {
    model,
    saveToDb: true,
    concurrency,
    contextOptions,
    template,
    sectorId: sectorName,
    progressCallback: (completed, total) => {
      const pct = Math.round((completed / total) * 100);
      console.log(`[LLM Scoring] Sector ${sectorName}: ${completed}/${total} (${pct}%)`);
    }
  });
}

// ============================================================================
// Comparison Testing (Claims vs No-Claims)
// ============================================================================

/**
 * Score a single patent with both baseline and claims context
 * Returns comparison of scores
 */
export async function comparePatentScoring(
  patent: PatentForScoring,
  options: {
    model?: string;
  } = {}
): Promise<ComparisonResult> {
  const { model } = options;

  // Check if claims are available
  const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';
  const stats = getClaimsStats(patent.patent_id, xmlDir);
  const claimsTokens = stats?.estimatedTokens || 0;

  // Explicit no-claims baseline for A/B comparison
  const NO_CLAIMS_OPTIONS: ContextOptions = {
    ...DEFAULT_CONTEXT_OPTIONS,
    includeClaims: 'none',
  };

  // Score with baseline context (no claims)
  console.log(`[Compare] Scoring ${patent.patent_id} with baseline context...`);
  const baselineScore = await scorePatent(patent, {
    model,
    saveToDb: false,  // Don't save comparison scores
    contextOptions: NO_CLAIMS_OPTIONS
  });

  // Score with claims context
  console.log(`[Compare] Scoring ${patent.patent_id} with claims context (~${claimsTokens} tokens)...`);
  const claimsScore = await scorePatent(patent, {
    model,
    saveToDb: false,
    contextOptions: DEFAULT_CONTEXT_OPTIONS
  });

  // Calculate deltas
  const scoreDelta = (claimsScore.compositeScore || 0) - (baselineScore.compositeScore || 0);

  const metricDeltas: Record<string, number> = {};
  if (baselineScore.metrics && claimsScore.metrics) {
    for (const fieldName of Object.keys(baselineScore.metrics)) {
      const baseVal = baselineScore.metrics[fieldName]?.score || 0;
      const claimsVal = claimsScore.metrics[fieldName]?.score || 0;
      metricDeltas[fieldName] = claimsVal - baseVal;
    }
  }

  return {
    patentId: patent.patent_id,
    baselineScore,
    claimsScore,
    scoreDelta,
    metricDeltas,
    claimsTokensUsed: claimsTokens,
  };
}

/**
 * Run comparison test on multiple patents
 */
export async function runComparisonTest(
  patents: PatentForScoring[],
  options: {
    model?: string;
    progressCallback?: (completed: number, total: number) => void;
  } = {}
): Promise<{
  results: ComparisonResult[];
  summary: {
    totalPatents: number;
    avgScoreDelta: number;
    avgClaimsTokens: number;
    metricAnalysis: Record<string, {
      avgDelta: number;
      maxIncrease: number;
      maxDecrease: number;
      significantChanges: number;  // > 1 point difference
    }>;
  };
}> {
  const { model, progressCallback } = options;
  const results: ComparisonResult[] = [];

  for (let i = 0; i < patents.length; i++) {
    const patent = patents[i];

    try {
      const result = await comparePatentScoring(patent, { model });
      results.push(result);
    } catch (error) {
      console.error(`[Compare] Error scoring ${patent.patent_id}:`, error);
    }

    if (progressCallback) {
      progressCallback(i + 1, patents.length);
    }

    // Delay between comparisons to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Calculate summary statistics
  const avgScoreDelta = results.length > 0
    ? results.reduce((sum, r) => sum + r.scoreDelta, 0) / results.length
    : 0;

  const avgClaimsTokens = results.length > 0
    ? results.reduce((sum, r) => sum + r.claimsTokensUsed, 0) / results.length
    : 0;

  // Analyze by metric
  const metricAnalysis: Record<string, {
    avgDelta: number;
    maxIncrease: number;
    maxDecrease: number;
    significantChanges: number;
  }> = {};

  // Collect all metric names
  const allMetrics = new Set<string>();
  for (const result of results) {
    for (const metric of Object.keys(result.metricDeltas)) {
      allMetrics.add(metric);
    }
  }

  for (const metric of Array.from(allMetrics)) {
    const deltas = results.map(r => r.metricDeltas[metric] || 0);
    metricAnalysis[metric] = {
      avgDelta: deltas.reduce((a, b) => a + b, 0) / deltas.length,
      maxIncrease: Math.max(...deltas),
      maxDecrease: Math.min(...deltas),
      significantChanges: deltas.filter(d => Math.abs(d) > 1).length,
    };
  }

  return {
    results,
    summary: {
      totalPatents: results.length,
      avgScoreDelta,
      avgClaimsTokens,
      metricAnalysis,
    },
  };
}

/**
 * Get a test set of patents from completed scores
 * Selects patents across the score distribution
 */
export async function getComparisonTestSet(
  sectorName: string,
  options: { count?: number } = {}
): Promise<PatentForScoring[]> {
  const { count = 50 } = options;

  // Load candidates file to get sector mappings
  const possiblePaths = [
    path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json'),
  ];

  let candidatesPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      candidatesPath = p;
      break;
    }
  }

  if (!candidatesPath) {
    throw new Error('Candidates file not found');
  }

  const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates = Array.isArray(fileContent) ? fileContent : fileContent.candidates;

  // Filter candidates to target sector
  const sectorCandidates = candidates.filter((c: any) => c.primary_sector === sectorName);
  const patentIds = sectorCandidates.map((c: any) => c.patent_id);

  if (patentIds.length === 0) {
    throw new Error(`No patents found in sector: ${sectorName}`);
  }

  // Get scores for these patents
  const scores = await prisma.patentSubSectorScore.findMany({
    where: {
      patentId: { in: patentIds }
    },
    orderBy: { compositeScore: 'desc' }
  });

  if (scores.length === 0) {
    throw new Error(`No scored patents found in sector: ${sectorName}`);
  }

  // Select stratified sample across score distribution
  const selected: typeof scores = [];
  const quartileSize = Math.ceil(count / 4);

  // Top quartile
  selected.push(...scores.slice(0, quartileSize));

  // Upper-middle quartile
  const upperMidStart = Math.floor(scores.length * 0.25);
  selected.push(...scores.slice(upperMidStart, upperMidStart + quartileSize));

  // Lower-middle quartile
  const lowerMidStart = Math.floor(scores.length * 0.5);
  selected.push(...scores.slice(lowerMidStart, lowerMidStart + quartileSize));

  // Bottom quartile
  const bottomStart = Math.floor(scores.length * 0.75);
  selected.push(...scores.slice(bottomStart, bottomStart + quartileSize));

  // Limit to requested count and remove duplicates
  const seen = new Set<string>();
  const finalSelection = selected.filter(s => {
    if (seen.has(s.patentId)) return false;
    seen.add(s.patentId);
    return true;
  }).slice(0, count);

  // Map scores to PatentForScoring
  const patentMap = new Map(candidates.map((c: any) => [c.patent_id, c]));

  return finalSelection.map(score => {
    const candidate = patentMap.get(score.patentId) as any;
    return {
      patent_id: score.patentId,
      patent_title: candidate?.patent_title || '',
      primary_sub_sector_id: candidate?.primary_sub_sector_id || score.subSectorId,
      primary_sub_sector_name: candidate?.primary_sub_sector_name || '',
      primary_sector: candidate?.primary_sector || sectorName,
      super_sector: candidate?.super_sector || '',
      cpc_codes: candidate?.cpc_codes || [],
    };
  });
}

// ============================================================================
// Batch API Scoring (Anthropic Message Batches — 50% cost savings)
// ============================================================================

const BATCH_JOBS_DIR = path.join(process.cwd(), 'cache', 'batch-jobs');

export interface BatchJobMetadata {
  batchId: string;
  sectorName: string;
  superSector: string;
  portfolioId?: string;
  patentCount: number;
  model: string;
  templateInheritanceChain: string[];
  questionCount: number;
  withClaims: boolean;
  submittedAt: string;
  status: 'submitted' | 'in_progress' | 'ended' | 'failed';
  completedAt: string | null;
  // Sub-sector template mapping: patentId → subSectorId (null = sector-level)
  // Used by processBatchResults to pick the correct template per patent
  patentSubSectorMap?: Record<string, string | null>;
  results: {
    succeeded: number;
    errored: number;
    expired: number;
    canceled: number;
    processed: boolean;
    processedAt: string | null;
  };
}

function ensureBatchJobsDir(): void {
  if (!fs.existsSync(BATCH_JOBS_DIR)) {
    fs.mkdirSync(BATCH_JOBS_DIR, { recursive: true });
  }
}

function saveBatchMetadata(metadata: BatchJobMetadata): void {
  ensureBatchJobsDir();
  const filePath = path.join(BATCH_JOBS_DIR, `${metadata.batchId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
}

function loadBatchMetadata(batchId: string): BatchJobMetadata | null {
  const filePath = path.join(BATCH_JOBS_DIR, `${batchId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Submit a batch scoring job for a sector via the Anthropic Batch API.
 * Returns immediately with a batchId — results arrive within 24h at 50% cost.
 */
export async function submitBatchScoring(
  sectorName: string,
  options: {
    patentIds?: string[];
    portfolioId?: string;
    limit?: number;
    model?: string;
    rescore?: boolean;
    scoringFilter?: ScoringFilter;
    contextOptions?: ContextOptions;
    minYear?: number;
    minScore?: number;
    excludeDesign?: boolean;
    prioritizeBy?: 'base' | 'v2';
    v2Weights?: V2Weights;
  } = {}
): Promise<{ batchId: string; requestCount: number; sectorName: string }> {
  const {
    patentIds,
    portfolioId,
    limit = 2000,
    model = 'claude-sonnet-4-20250514',
    rescore = false,
    scoringFilter,
    contextOptions = DEFAULT_CONTEXT_OPTIONS,
    minYear,
    minScore,
    excludeDesign = true,
    prioritizeBy = 'base',
    v2Weights
  } = options;

  // Resolve scoringFilter: explicit param > legacy rescore flag
  const effectiveFilter: ScoringFilter = scoringFilter || (rescore ? 'all' : 'unscored');

  let patents: PatentForScoring[];

  if (patentIds && patentIds.length > 0) {
    // Pre-selected patent IDs (from batch-jobs system) — query directly from DB
    console.log(`[Batch] Preparing batch scoring for sector: ${sectorName} (${patentIds.length} pre-selected patents)`);

    const dbPatents = await prisma.patent.findMany({
      where: { patentId: { in: patentIds } },
      select: {
        patentId: true,
        title: true,
        abstract: true,
        primarySector: true,
        superSector: true,
        primarySubSectorId: true,
        primarySubSectorName: true,
        cpcCodes: { select: { cpcCode: true } },
      },
    });

    patents = dbPatents.map(p => ({
      patent_id: p.patentId,
      patent_title: p.title,
      abstract: p.abstract,
      primary_sector: p.primarySector || undefined,
      super_sector: p.superSector || undefined,
      primary_sub_sector_id: p.primarySubSectorId || undefined,
      primary_sub_sector_name: p.primarySubSectorName || undefined,
      cpc_codes: p.cpcCodes.map(c => c.cpcCode),
    }));
  } else {
    // Discovery mode — query patents for sector scoring
    console.log(`[Batch] Preparing batch scoring for sector: ${sectorName}${portfolioId ? ` (portfolio: ${portfolioId})` : ''} (filter: ${effectiveFilter})`);

    patents = await getPatentsForSectorScoring(sectorName, {
      portfolioId,
      limit,
      scoringFilter: effectiveFilter,
      minYear,
      minScore,
      excludeDesign,
      prioritizeBy,
      v2Weights
    });
  }

  if (patents.length === 0) {
    throw new Error(`No patents found in sector: ${sectorName}${patentIds ? ' (from pre-selected IDs)' : ` (filter: ${effectiveFilter})`}`);
  }

  console.log(`[Batch] Found ${patents.length} patents to score`);

  const superSector = patents[0]?.super_sector || 'WIRELESS';

  // 2. Enrich patents (before template grouping — need CPC codes for matching)
  const enrichedPatents = await enrichPatentBatch(patents, contextOptions);
  const enrichedCount = enrichedPatents.filter(p => p.abstract).length;
  console.log(`[Batch] ${enrichedCount}/${patents.length} patents have abstracts`);

  // 3. Group patents by sub-sector template match (same logic as run-sector-scoring.ts)
  const subSectorTemplates = loadSubSectorTemplates();
  const sectorSubTemplates = Array.from(subSectorTemplates.values())
    .filter(t => t.sectorName === sectorName && t.level === 'sub_sector');

  // Map each patent to its matched sub-sector (or null for sector-level)
  const patentSubSectorMap: Record<string, string | null> = {};
  const groups = new Map<string | null, PatentForScoring[]>();

  if (sectorSubTemplates.length > 0) {
    for (const patent of enrichedPatents) {
      const matched = matchSubSectorTemplate(sectorName, patent.cpc_codes || []);
      const key = matched?.id || null;
      patentSubSectorMap[patent.patent_id] = key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(patent);
    }
    console.log(`[Batch] ${sectorSubTemplates.length} sub-sector templates for ${sectorName}:`);
    for (const [subId, groupPatents] of groups) {
      console.log(`  ${subId || '(sector-level)'}: ${groupPatents.length} patents`);
    }
  } else {
    // No sub-sector templates — all patents use sector-level
    groups.set(null, enrichedPatents);
    for (const patent of enrichedPatents) {
      patentSubSectorMap[patent.patent_id] = null;
    }
  }

  // 4. Build batch requests with correct template per sub-sector group
  const requests: Array<{ custom_id: string; params: { model: string; max_tokens: number; messages: Array<{ role: 'user'; content: string }> } }> = [];
  let primaryTemplate: MergedTemplate | null = null;

  for (const [subSectorId, groupPatents] of groups) {
    let template: MergedTemplate;
    if (subSectorId) {
      template = getMergedTemplateForSubSector(subSectorId, sectorName, superSector);
    } else {
      template = getMergedTemplateForSector(sectorName, superSector);
    }
    if (!primaryTemplate) primaryTemplate = template;

    console.log(`[Batch] Building prompts for ${groupPatents.length} patents with template: ${template.inheritanceChain.join(' → ')} (${template.questions.length} questions)`);

    for (const patent of groupPatents) {
      requests.push({
        custom_id: `score_${sectorName}_${patent.patent_id}`,
        params: {
          model,
          max_tokens: 4096,
          messages: [
            {
              role: 'user' as const,
              content: buildScoringPrompt(patent, template)
            }
          ]
        }
      });
    }
  }

  console.log(`[Batch] Submitting ${requests.length} requests to Anthropic Batch API...`);

  // 5. Submit to Anthropic Batch API
  const batch = await anthropic.messages.batches.create({ requests });

  console.log(`[Batch] Submitted! Batch ID: ${batch.id}`);

  // 6. Save metadata (including per-patent sub-sector mapping for result processing)
  const template = primaryTemplate || getMergedTemplateForSector(sectorName, superSector);
  const metadata: BatchJobMetadata = {
    batchId: batch.id,
    sectorName,
    superSector,
    ...(portfolioId && { portfolioId }),
    patentCount: requests.length,
    model,
    templateInheritanceChain: template.inheritanceChain,
    questionCount: template.questions.length,
    withClaims: contextOptions.includeClaims !== 'none',
    submittedAt: new Date().toISOString(),
    status: 'submitted',
    completedAt: null,
    patentSubSectorMap,
    results: {
      succeeded: 0,
      errored: 0,
      expired: 0,
      canceled: 0,
      processed: false,
      processedAt: null
    }
  };
  saveBatchMetadata(metadata);

  return {
    batchId: batch.id,
    requestCount: requests.length,
    sectorName
  };
}

/**
 * Check the status of a batch scoring job.
 */
export async function checkBatchStatus(batchId: string): Promise<{
  batchId: string;
  status: string;
  requestCounts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  createdAt: string;
  endedAt: string | null;
  metadata: BatchJobMetadata | null;
}> {
  const batch = await anthropic.messages.batches.retrieve(batchId);
  const metadata = loadBatchMetadata(batchId);

  // Update local metadata status if changed
  if (metadata && batch.processing_status !== metadata.status) {
    metadata.status = batch.processing_status as BatchJobMetadata['status'];
    if (batch.ended_at) {
      metadata.completedAt = batch.ended_at;
    }
    saveBatchMetadata(metadata);
  }

  return {
    batchId: batch.id,
    status: batch.processing_status,
    requestCounts: batch.request_counts,
    createdAt: batch.created_at,
    endedAt: batch.ended_at,
    metadata
  };
}

/**
 * Process completed batch results — parse scores and save to DB.
 * Idempotent: safe to call multiple times.
 */
export async function processBatchResults(batchId: string): Promise<{
  processed: number;
  failed: number;
  errors: string[];
}> {
  const metadata = loadBatchMetadata(batchId);
  if (!metadata) {
    throw new Error(`No metadata found for batch ${batchId}. Was it submitted from this machine?`);
  }

  // Verify batch is complete
  const status = await checkBatchStatus(batchId);
  if (status.status !== 'ended') {
    throw new Error(`Batch ${batchId} is still ${status.status}. Wait for it to complete.`);
  }

  console.log(`[Batch] Processing results for batch ${batchId} (${metadata.sectorName}, ${metadata.patentCount} patents)`);

  // Build template cache: sub-sector ID → template (for per-patent lookup)
  const templateCache = new Map<string | null, MergedTemplate>();
  const sectorTemplate = getMergedTemplateForSector(metadata.sectorName, metadata.superSector);
  templateCache.set(null, sectorTemplate);

  // Pre-load sub-sector templates if this batch used them
  if (metadata.patentSubSectorMap) {
    const subSectorIds = new Set(Object.values(metadata.patentSubSectorMap).filter(v => v !== null));
    for (const subId of subSectorIds) {
      if (subId && !templateCache.has(subId)) {
        templateCache.set(subId, getMergedTemplateForSubSector(subId, metadata.sectorName, metadata.superSector));
      }
    }
    console.log(`[Batch] Loaded ${templateCache.size} templates (1 sector-level + ${templateCache.size - 1} sub-sector)`);
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Stream results from the batch
  const resultsIterator = await anthropic.messages.batches.results(batchId);
  for await (const result of resultsIterator) {
    const customId = result.custom_id;
    // Parse custom_id: "score_sectorName_patentId"
    // Patent IDs never contain underscores, but sector names do (e.g. video-codec).
    // Format: score_{sectorName}_{patentId} — split from the right to get patentId
    const lastUnderscore = customId.lastIndexOf('_');
    const patentId = customId.substring(lastUnderscore + 1);

    // Look up the correct template for this patent (sub-sector or sector-level)
    const subSectorId = metadata.patentSubSectorMap?.[patentId] ?? null;
    const template = templateCache.get(subSectorId) || sectorTemplate;

    if (result.result.type === 'succeeded') {
      try {
        const message = result.result.message;
        const content = message.content[0];
        if (content.type !== 'text') {
          throw new Error('Unexpected response type');
        }

        const { metrics, compositeScore } = parseScoreResponse(content.text, template.questions);

        // Extract token usage from batch result
        const tokensUsed = message.usage
          ? message.usage.input_tokens + message.usage.output_tokens
          : undefined;

        // Save to DB
        const scoreResult: ScoreCalculationResult = {
          patentId,
          subSectorId: metadata.sectorName,
          metrics,
          compositeScore,
          templateConfigId: template.inheritanceChain[template.inheritanceChain.length - 1],
          templateVersion: 1,
          withClaims: metadata.withClaims,
          llmModel: metadata.model,
          tokensUsed
        };

        await savePatentScore(scoreResult);
        processed++;

        if (processed % 50 === 0) {
          console.log(`[Batch] Processed ${processed} results...`);
        }
      } catch (err) {
        failed++;
        errors.push(`${patentId}: ${(err as Error).message}`);
      }
    } else {
      failed++;
      const errorType = result.result.type;
      errors.push(`${patentId}: batch result type=${errorType}`);
    }
  }

  console.log(`[Batch] Complete: ${processed} processed, ${failed} failed`);

  // Update metadata
  if (metadata) {
    metadata.results = {
      succeeded: processed,
      errored: failed,
      expired: 0,
      canceled: 0,
      processed: true,
      processedAt: new Date().toISOString()
    };
    saveBatchMetadata(metadata);
  }

  return { processed, failed, errors };
}

/**
 * List all batch jobs from local tracking files.
 */
export function listBatchJobs(): BatchJobMetadata[] {
  ensureBatchJobsDir();
  const files = fs.readdirSync(BATCH_JOBS_DIR).filter(f => f.endsWith('.json'));
  return files
    .map(f => JSON.parse(fs.readFileSync(path.join(BATCH_JOBS_DIR, f), 'utf-8')) as BatchJobMetadata)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

/**
 * Cancel a batch scoring job via the Anthropic API.
 */
export async function cancelBatch(batchId: string): Promise<{ batchId: string; status: string }> {
  const metadata = loadBatchMetadata(batchId);
  if (!metadata) {
    throw new Error(`No metadata found for batch ${batchId}`);
  }

  console.log(`[Batch] Cancelling batch: ${batchId}`);
  const batch = await anthropic.messages.batches.cancel(batchId);

  // Update local metadata
  metadata.status = batch.processing_status as BatchJobMetadata['status'];
  if (batch.ended_at) {
    metadata.completedAt = batch.ended_at;
  }
  saveBatchMetadata(metadata);

  return { batchId: batch.id, status: batch.processing_status };
}

/**
 * Refresh status of all non-ended batch jobs from the Anthropic API.
 * Returns the full updated list of all jobs.
 */
export async function refreshAllBatchStatuses(): Promise<BatchJobMetadata[]> {
  const jobs = listBatchJobs();
  const activeStatuses = new Set(['submitted', 'in_progress']);

  let refreshed = 0;
  for (const job of jobs) {
    if (activeStatuses.has(job.status)) {
      try {
        await checkBatchStatus(job.batchId);
        refreshed++;
      } catch (err) {
        console.error(`[Batch] Failed to refresh status for ${job.batchId}:`, err);
      }
    }
  }

  console.log(`[Batch] Refreshed ${refreshed} active batch jobs`);

  // Return fresh list after updates
  return listBatchJobs();
}

/**
 * Score a sample of patents through multiple models for comparison.
 * Returns per-patent scores by model + summary stats.
 */
export async function compareModels(
  sectorName: string,
  options: {
    models: string[];
    sampleSize?: number;
  }
): Promise<{
  sectorName: string;
  models: string[];
  sampleSize: number;
  results: Array<{
    patentId: string;
    patentTitle: string;
    scores: Record<string, { compositeScore: number; metrics: Record<string, MetricScore>; tokenUsage: { input: number; output: number } }>;
  }>;
  summary: Record<string, { avgScore: number; totalTokens: number; estimatedCostPer1k: number }>;
}> {
  const { models, sampleSize = 10 } = options;

  // Get stratified sample from scored patents
  const testSet = await getComparisonTestSet(sectorName, { count: sampleSize });
  if (testSet.length === 0) {
    throw new Error(`No scored patents found in sector: ${sectorName}`);
  }

  console.log(`[Compare Models] Scoring ${testSet.length} patents across ${models.length} models`);

  // Get template
  const superSector = testSet[0]?.super_sector || 'WIRELESS';
  const template = getMergedTemplateForSector(sectorName, superSector);

  const results: Array<{
    patentId: string;
    patentTitle: string;
    scores: Record<string, { compositeScore: number; metrics: Record<string, MetricScore>; tokenUsage: { input: number; output: number } }>;
  }> = [];

  const modelTotals: Record<string, { totalScore: number; totalTokens: number; count: number }> = {};
  for (const model of models) {
    modelTotals[model] = { totalScore: 0, totalTokens: 0, count: 0 };
  }

  for (const patent of testSet) {
    const patentScores: Record<string, { compositeScore: number; metrics: Record<string, MetricScore>; tokenUsage: { input: number; output: number } }> = {};

    for (const model of models) {
      try {
        const result = await scorePatent(patent, {
          model,
          saveToDb: false,
          template,
        });

        if (result.success && result.metrics && result.compositeScore !== undefined) {
          patentScores[model] = {
            compositeScore: result.compositeScore,
            metrics: result.metrics,
            tokenUsage: result.tokenUsage || { input: 0, output: 0 },
          };
          modelTotals[model].totalScore += result.compositeScore;
          modelTotals[model].totalTokens += (result.tokenUsage?.input || 0) + (result.tokenUsage?.output || 0);
          modelTotals[model].count++;
        }
      } catch (err) {
        console.error(`[Compare Models] Error scoring ${patent.patent_id} with ${model}:`, err);
      }

      // Small delay between model calls
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    results.push({
      patentId: patent.patent_id,
      patentTitle: patent.patent_title,
      scores: patentScores,
    });

    console.log(`[Compare Models] Completed ${results.length}/${testSet.length}`);
  }

  // Build summary
  const summary: Record<string, { avgScore: number; totalTokens: number; estimatedCostPer1k: number }> = {};
  const costPer1kTokens: Record<string, number> = {
    'claude-sonnet-4-20250514': 0.009,  // $3/MTok input + $15/MTok output avg
    'claude-haiku-4-5-20251001': 0.002,  // $0.80/MTok input + $4/MTok output avg
    'claude-opus-4-6': 0.045,           // $15/MTok input + $75/MTok output avg
  };

  for (const model of models) {
    const totals = modelTotals[model];
    summary[model] = {
      avgScore: totals.count > 0 ? Math.round((totals.totalScore / totals.count) * 100) / 100 : 0,
      totalTokens: totals.totalTokens,
      estimatedCostPer1k: (costPer1kTokens[model] || 0.01) * (totals.count > 0 ? totals.totalTokens / totals.count : 0),
    };
  }

  return { sectorName, models, sampleSize: testSet.length, results, summary };
}
