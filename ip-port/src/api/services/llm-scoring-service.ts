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
  includeClaims: 'none',
  maxClaimTokens: 800,
  maxClaims: 5,
};

export const CLAIMS_CONTEXT_OPTIONS: ContextOptions = {
  includeAbstract: true,
  includeLlmSummary: true,
  includeClaims: 'independent_only',
  maxClaimTokens: 800,
  maxClaims: 5,
};

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
 * Load LLM enrichment data from cache
 */
function loadLlmData(patentId: string): { summary?: string; prior_art_problem?: string; technical_solution?: string } | null {
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

  const questionPrompts = questions.map((q, i) => {
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

For each question below, provide:
1. A numeric score within the specified scale
2. A brief reasoning explaining your score (2-3 sentences)
3. A confidence level (high/medium/low)

${questionPrompts}

## Response Format

Respond with a JSON object containing the scores. Use this exact structure:

\`\`\`json
{
  "scores": {
    "${questions[0]?.fieldName || 'example_field'}": {
      "score": 7,
      "reasoning": "Brief explanation of the score...",
      "confidence": "high"
    }
    // ... one entry for each fieldName
  }
}
\`\`\`

Be objective and critical. Follow the scoring guidelines above.`;
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
  } = {}
): Promise<ScoringResult> {
  const {
    model = 'claude-sonnet-4-20250514',
    saveToDb = true,
    skipEnrichment = false,
    contextOptions = DEFAULT_CONTEXT_OPTIONS,
    template: providedTemplate
  } = options;

  // Enrich patent with full data from file caches
  const enrichedPatent = skipEnrichment ? patent : await enrichPatentData(patent, contextOptions);

  // Get sub-sector ID
  const subSectorId = enrichedPatent.primary_sub_sector_id || patent.primary_sub_sector_id;
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
    // Call Claude
    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Parse response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    // Extract JSON from response
    const jsonMatch = content.text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) {
      throw new Error('Could not find JSON in response');
    }

    const parsed = JSON.parse(jsonMatch[1]);
    const scores = parsed.scores as Record<string, { score: number; reasoning: string; confidence?: string }>;

    // Convert to MetricScore format
    const metrics: Record<string, MetricScore> = {};
    for (const [fieldName, data] of Object.entries(scores)) {
      metrics[fieldName] = {
        score: data.score,
        reasoning: data.reasoning,
        confidence: data.confidence === 'high' ? 1.0 : data.confidence === 'medium' ? 0.7 : 0.5
      };
    }

    // Calculate composite score
    const compositeScore = calculateCompositeScore(metrics, template.questions);

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
        withClaims: contextOptions.includeClaims !== 'none'
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

  } catch (error) {
    return {
      patentId: enrichedPatent.patent_id,
      subSectorId,
      success: false,
      error: (error as Error).message
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
  } = {}
): Promise<BatchScoringResult> {
  const { concurrency = 3, progressCallback, contextOptions = DEFAULT_CONTEXT_OPTIONS, template } = options;

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
      batch.map(patent => scorePatent(patent, { ...options, skipEnrichment: true, contextOptions, template }))
    );

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
      }
    }

    if (progressCallback) {
      progressCallback(results.length, patents.length);
    }

    // Small delay between batches to avoid rate limits
    if (i + concurrency < patents.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
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
    limit?: number;
    onlyUnscored?: boolean;
    minYear?: number;
    minScore?: number;
    excludeDesign?: boolean;
    prioritizeBy?: 'base' | 'v2';
    v2Weights?: V2Weights;
  } = {}
): Promise<PatentForScoring[]> {
  const { limit = 500, onlyUnscored = true, minYear, minScore, excludeDesign = true, prioritizeBy = 'base', v2Weights = DEFAULT_V2_WEIGHTS } = options;

  // Load candidates file
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
    throw new Error('Candidates file not found');
  }

  const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates = Array.isArray(fileContent) ? fileContent : fileContent.candidates;

  // Filter to this sector
  let filtered = candidates.filter((p: any) => p.primary_sector === sectorName);

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

  // Filter out already scored if requested
  if (onlyUnscored) {
    const scored = await prisma.patentSubSectorScore.findMany({
      select: { patentId: true }
    });
    const scoredIds = new Set(scored.map(s => s.patentId));
    filtered = filtered.filter((p: any) => !scoredIds.has(p.patent_id));
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
    minYear?: number;   // Filter to patents from this year or later
    minScore?: number;  // Filter to patents with base score >= this value
    excludeDesign?: boolean;  // Exclude design patents (D-prefix)
    prioritizeBy?: 'base' | 'v2';  // How to prioritize patents for scoring
    v2Weights?: V2Weights;  // Custom V2 weights when prioritizeBy='v2'
  } = {}
): Promise<BatchScoringResult> {
  const { limit = 2000, model, concurrency = 4, contextOptions = DEFAULT_CONTEXT_OPTIONS, rescore = false, minYear, minScore, excludeDesign = true, prioritizeBy = 'base', v2Weights } = options;

  console.log(`[LLM Scoring] Starting sector scoring for: ${sectorName}`);
  if (prioritizeBy === 'v2') {
    console.log(`[LLM Scoring] Prioritizing by V2 score`);
  }

  // Get patents to score
  const patents = await getPatentsForSectorScoring(sectorName, { limit, onlyUnscored: !rescore, minYear, minScore, excludeDesign, prioritizeBy, v2Weights });

  if (patents.length === 0) {
    console.log(`[LLM Scoring] No ${rescore ? '' : 'unscored '}patents found in sector: ${sectorName}`);
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

  // Get the merged template for this sector (from JSON config files)
  // First patent gives us the super-sector context
  const superSector = patents[0]?.super_sector || 'WIRELESS';
  const template = getMergedTemplateForSector(sectorName, superSector);
  console.log(`[LLM Scoring] Using template: ${template.inheritanceChain.join(' → ')} (${template.questions.length} questions)`);

  // Score the batch
  return scorePatentBatch(patents, {
    model,
    saveToDb: true,
    concurrency,
    contextOptions,
    template,
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

  // Score with baseline context (no claims)
  console.log(`[Compare] Scoring ${patent.patent_id} with baseline context...`);
  const baselineScore = await scorePatent(patent, {
    model,
    saveToDb: false,  // Don't save comparison scores
    contextOptions: DEFAULT_CONTEXT_OPTIONS
  });

  // Score with claims context
  console.log(`[Compare] Scoring ${patent.patent_id} with claims context (~${claimsTokens} tokens)...`);
  const claimsScore = await scorePatent(patent, {
    model,
    saveToDb: false,
    contextOptions: CLAIMS_CONTEXT_OPTIONS
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
