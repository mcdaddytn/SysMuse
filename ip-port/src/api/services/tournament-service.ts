/**
 * Tournament Execution Service
 *
 * Specialized service for POS-style patent tournaments:
 * - Comparative ranking within clusters (not just scoring)
 * - Explicit advancement based on cluster_ranking results
 * - Context preservation between rounds
 * - All output saved to output/tournaments/ for inspection
 *
 * Tournament Flow:
 * 1. Input: Top N patents from V2/V3 scoring
 * 2. Round 1: Cluster patents, evaluate with Round 1 template
 * 3. Extract advancing patents from cluster_ranking (top 2-3 per cluster)
 * 4. Round 2: Re-cluster advancers, evaluate with Round 2 template (includes R1 context)
 * 5. Final: Synthesize all finalists with Final template
 * 6. Output: Save all JSON to output/tournaments/{id}/, optionally create focus area
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  callLlm,
  loadEnrichedPatents,
  buildPromptForTemplate,
  parseStructuredResponse,
  SYSTEM_MESSAGE_STRUCTURED,
  DEFAULT_DELIMITER_START,
  DEFAULT_DELIMITER_END,
} from './prompt-template-service.js';
import type { StructuredQuestion } from './prompt-template-service.js';
import { scoreWithCustomConfig } from './scoring-service.js';

const prisma = new PrismaClient();

const RATE_LIMIT_MS = 2500;
const OUTPUT_DIR = path.join(process.cwd(), 'output', 'tournaments');

// Ensure tournaments output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface TournamentInput {
  sourceType: 'v2' | 'v3' | 'super_sector';
  sourceId?: string;           // super_sector name if applicable
  topN: number;                // how many patents to pull from source
  offset?: number;             // skip first N patents (for testing different segments)
  llmEnhancedOnly: boolean;    // require LLM data
}

export interface TournamentRoundConfig {
  templateId: string;
  advanceCount: number;        // How many to advance from each cluster (e.g., 2-3)
  clusterSize: number;         // Patents per cluster (e.g., 10)
}

export interface TournamentConfig {
  name: string;
  description?: string;
  round1: TournamentRoundConfig;
  round2: TournamentRoundConfig;
  finalTemplateId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 Types - Variable rounds with dark horse support
// ─────────────────────────────────────────────────────────────────────────────

export interface TournamentV2RoundConfig {
  templateId: string;
  clusterSize: number;         // Patents per cluster
  advanceCount: number;        // Max patents to advance per cluster (may be fewer if threshold not met)
  includeDarkHorse: boolean;   // Whether to also advance dark horse if not in top N
  relevanceThreshold?: number; // Minimum composite score to advance (0-20 scale, default 0 = advance all)
}

export interface TournamentV2Config {
  name: string;
  description?: string;
  superSector?: string;        // Which super-sector to pull from
  rounds: TournamentV2RoundConfig[];  // Variable number of rounds
  finalTemplateId: string;
}

export interface V2ClusterResult {
  clusterId: string;
  clusterIndex: number;
  patentIds: string[];
  llmResponse: Record<string, unknown>;
  parsedFields: Record<string, unknown>;
  clusterRanking: string[];    // Ordered patent IDs from LLM
  advancingPatents: string[];  // Top N from ranking
  darkHorse?: string;          // Dark horse patent ID if identified
  darkHorseRationale?: string; // Why this is a dark horse
  rawResponse?: string;
  tokensUsed: number;
}

export interface V2RoundResult {
  roundNumber: number;
  templateId: string;
  clusters: V2ClusterResult[];
  advancingPatentIds: string[];
  darkHorseIds: string[];      // Which patents advanced as dark horses
  totalTokens: number;
  startedAt: Date;
  completedAt: Date;
}

export interface TournamentV2Result {
  tournamentId: string;
  config: TournamentV2Config;
  input: TournamentInput;
  inputPatentIds: string[];
  rounds: V2RoundResult[];
  finalSynthesis: {
    llmResponse: Record<string, unknown>;
    parsedFields: Record<string, unknown>;
    tokensUsed: number;
  };
  summary: {
    tier1Patents: string[];
    tier2Patents: string[];
    tier3Patents: string[];
    darkHorseWinners: string[];
    executiveSummary: string;
    keyJuryNarrative: string;
  };
  totalTokensUsed: number;
  startedAt: Date;
  completedAt: Date;
  outputDir: string;
}

export interface ClusterResult {
  clusterId: string;
  clusterIndex: number;
  patentIds: string[];
  llmResponse: Record<string, unknown>;
  parsedFields: Record<string, unknown>;
  clusterRanking: string[];    // Ordered patent IDs from LLM
  advancingPatents: string[];  // Top N from ranking
  rawResponse?: string;
  tokensUsed: number;
}

export interface RoundResult {
  roundNumber: number;
  templateId: string;
  clusters: ClusterResult[];
  advancingPatentIds: string[];
  totalTokens: number;
  startedAt: Date;
  completedAt: Date;
}

export interface TournamentResult {
  tournamentId: string;
  config: TournamentConfig;
  input: TournamentInput;
  inputPatentIds: string[];
  round1: RoundResult;
  round2: RoundResult;
  finalSynthesis: {
    llmResponse: Record<string, unknown>;
    parsedFields: Record<string, unknown>;
    tokensUsed: number;
  };
  summary: {
    tier1Patents: string[];
    tier2Patents: string[];
    tier3Patents: string[];
    executiveSummary: string;
    keyJuryNarrative: string;
  };
  totalTokensUsed: number;
  startedAt: Date;
  completedAt: Date;
  outputDir: string;
}

export interface TournamentStatus {
  tournamentId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR';
  currentPhase: string;
  progress: {
    round1: { total: number; completed: number };
    round2: { total: number; completed: number };
    final: boolean;
  };
  error?: string;
}

// In-memory tracking of running tournaments
const runningTournaments = new Map<string, TournamentStatus>();

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateTournamentId(): string {
  const date = new Date().toISOString().split('T')[0];
  const rand = Math.random().toString(36).substring(2, 8);
  return `pos-${date}-${rand}`;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load patent IDs from V2 scoring, V3 scoring, or super-sector.
 */
export async function loadInputPatents(input: TournamentInput): Promise<string[]> {
  if (input.sourceType === 'v2') {
    // Use V2 Enhanced scoring
    const config = {
      weights: {
        competitor_citations: 15,
        adjusted_forward_citations: 15,
        years_remaining: 10,
        competitor_count: 5,
        competitor_density: 5,
        eligibility_score: 10,
        validity_score: 10,
        claim_breadth: 5,
        enforcement_clarity: 5,
        design_around_difficulty: 5,
        market_relevance_score: 10,
        ipr_risk_score: 2.5,
        prosecution_quality_score: 2.5,
      },
      scaling: {} as Record<string, string>,
      invert: { ipr_risk_score: true } as Record<string, boolean>,
      topN: input.topN === 0 ? 15000 : input.topN, // 0 means all, cap at 15000
      llmEnhancedOnly: input.llmEnhancedOnly,
    };

    const scored = scoreWithCustomConfig(config);
    return scored.map(p => p.patent_id);
  }

  if (input.sourceType === 'v3') {
    // TODO: Implement V3 scoring integration
    throw new Error('V3 scoring source not yet implemented');
  }

  if (input.sourceType === 'super_sector' && input.sourceId) {
    // Load from streaming-candidates filtered by super_sector
    const candidatesDir = path.join(process.cwd(), 'output');
    const files = fs.readdirSync(candidatesDir)
      .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length === 0) {
      throw new Error('No streaming-candidates file found');
    }

    const data = JSON.parse(fs.readFileSync(path.join(candidatesDir, files[0]), 'utf-8'));
    const candidates = data.candidates as Array<{ patent_id: string; super_sector?: string }>;

    const allMatching = candidates.filter(c => c.super_sector === input.sourceId);
    const offset = input.offset || 0;
    const limit = input.topN || 1000;
    const filtered = allMatching.slice(offset, offset + limit);

    console.log(`[Tournament] Super-sector "${input.sourceId}": ${allMatching.length} total, offset ${offset}, taking ${filtered.length}`);
    return filtered.map(c => c.patent_id);
  }

  throw new Error(`Unknown source type: ${input.sourceType}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cluster Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a single cluster evaluation.
 */
async function executeCluster(
  clusterIndex: number,
  patentIds: string[],
  templateId: string,
  roundContext?: {
    roundNumber: number;
    previousResults?: Map<string, Record<string, unknown>>;
  }
): Promise<ClusterResult> {
  const template = await prisma.promptTemplate.findUniqueOrThrow({
    where: { id: templateId },
  });

  const questions = template.questions as StructuredQuestion[] || [];
  const delimStart = template.delimiterStart || DEFAULT_DELIMITER_START;
  const delimEnd = template.delimiterEnd || DEFAULT_DELIMITER_END;

  // Load enriched patent data
  const patents = loadEnrichedPatents(patentIds);

  // Build patent data for prompt - include previous round results if available
  let patentDataJson = '';
  for (const pid of patentIds) {
    const p = patents.get(pid) || { patent_id: pid };
    const patentInfo: Record<string, unknown> = { ...p };

    // Add previous round context if available
    if (roundContext?.previousResults?.has(pid)) {
      const prevResult = roundContext.previousResults.get(pid)!;
      patentInfo.round1_key_strength = prevResult.key_strength;
      patentInfo.round1_key_weakness = prevResult.key_weakness;
      patentInfo.round1_dark_horse_potential = prevResult.dark_horse_potential;
      patentInfo.round1_overall_pos_potential = prevResult.overall_pos_potential;
      patentInfo.round1_connectivity_layer_score = prevResult.connectivity_layer_score;
    }

    patentDataJson += JSON.stringify(patentInfo, null, 2) + '\n\n';
  }

  // Build prompt - substitute cluster.patentData
  let promptText = template.promptText || '';
  const startEsc = delimStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endEsc = delimEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patentDataPattern = new RegExp(`${startEsc}cluster\\.patentData${endEsc}`, 'g');
  promptText = promptText.replace(patentDataPattern, patentDataJson);

  // For Round 2, also substitute round1Results - ONLY for patents in this cluster
  if (roundContext?.roundNumber === 2 && roundContext.previousResults) {
    const clusterRound1Results = patentIds
      .filter(pid => roundContext.previousResults!.has(pid))
      .map(pid => ({
        patent_id: pid,
        key_strength: roundContext.previousResults!.get(pid)!.key_strength,
        key_weakness: roundContext.previousResults!.get(pid)!.key_weakness,
        overall_pos_potential: roundContext.previousResults!.get(pid)!.overall_pos_potential,
        connectivity_layer_score: roundContext.previousResults!.get(pid)!.connectivity_layer_score,
      }));
    const round1ResultsJson = JSON.stringify(clusterRound1Results, null, 2);
    const round1Pattern = new RegExp(`${startEsc}cluster\\.round1Results${endEsc}`, 'g');
    promptText = promptText.replace(round1Pattern, round1ResultsJson);
  }

  // Build question instructions for structured response
  const questionInstructions = questions.map((q, i) => {
    let instruction = `${i + 1}. ${q.fieldName}: ${q.question}`;
    if (q.answerType === 'INTEGER' && q.constraints) {
      instruction += ` (Integer ${q.constraints.min}-${q.constraints.max})`;
    } else if (q.answerType === 'ENUM' && q.constraints?.options) {
      instruction += ` (One of: ${q.constraints.options.join(', ')})`;
    } else if (q.answerType === 'TEXT_ARRAY') {
      instruction += ` (Array of strings)`;
    } else if (q.answerType === 'TEXT') {
      instruction += ` (Text)`;
    }
    return instruction;
  }).join('\n');

  const fullPrompt = `${promptText}

For EACH patent, provide structured responses in JSON format.
Return a JSON object with patent_id as keys, each containing answers to:

${questionInstructions}

Return valid JSON only, no markdown code blocks.`;

  // Call LLM (uses generous default maxTokens to avoid truncation)
  const llmResult = await callLlm(fullPrompt, template.llmModel, SYSTEM_MESSAGE_STRUCTURED);

  // Parse response
  let parsedFields: Record<string, unknown> = {};
  let clusterRanking: string[] = [];

  if (llmResult.response) {
    parsedFields = llmResult.response as Record<string, unknown>;

    // Extract cluster_ranking from the response
    // The LLM should return this as an array of patent IDs
    if (parsedFields.cluster_ranking && Array.isArray(parsedFields.cluster_ranking)) {
      clusterRanking = parsedFields.cluster_ranking as string[];
    } else {
      // Try to find it nested in per-patent responses
      for (const [key, value] of Object.entries(parsedFields)) {
        if (key === 'cluster_ranking' || key === 'ranking') {
          if (Array.isArray(value)) {
            clusterRanking = value as string[];
            break;
          }
        }
        // Check if it's a patent entry with cluster_ranking
        if (typeof value === 'object' && value && 'cluster_ranking' in value) {
          const cr = (value as Record<string, unknown>).cluster_ranking;
          if (Array.isArray(cr)) {
            clusterRanking = cr as string[];
            break;
          }
        }
      }
    }

    // Fallback: if no explicit ranking, try to rank by overall_pos_potential scores
    if (clusterRanking.length === 0) {
      const patentScores: Array<{ id: string; score: number }> = [];
      for (const pid of patentIds) {
        const patentResult = parsedFields[pid] as Record<string, unknown> | undefined;
        if (patentResult && typeof patentResult.overall_pos_potential === 'number') {
          patentScores.push({ id: pid, score: patentResult.overall_pos_potential });
        } else {
          patentScores.push({ id: pid, score: 0 });
        }
      }
      patentScores.sort((a, b) => b.score - a.score);
      clusterRanking = patentScores.map(p => p.id);
    }
  }

  const tokensUsed = (llmResult.inputTokens || 0) + (llmResult.outputTokens || 0);

  return {
    clusterId: `cluster-${clusterIndex.toString().padStart(3, '0')}`,
    clusterIndex,
    patentIds,
    llmResponse: llmResult.response || {},
    parsedFields,
    clusterRanking,
    advancingPatents: [], // Will be set by caller based on advanceCount
    rawResponse: llmResult.rawText,
    tokensUsed,
  };
}

/**
 * Execute a single cluster evaluation for V2 tournament (with dark horse extraction).
 */
async function executeClusterV2(
  clusterIndex: number,
  patentIds: string[],
  templateId: string,
  roundContext?: {
    roundNumber: number;
    previousRoundResults?: Map<string, Record<string, unknown>>[];  // All previous rounds
    superSector?: string;
  }
): Promise<V2ClusterResult> {
  const template = await prisma.promptTemplate.findUniqueOrThrow({
    where: { id: templateId },
  });

  const questions = template.questions as StructuredQuestion[] || [];
  const delimStart = template.delimiterStart || DEFAULT_DELIMITER_START;
  const delimEnd = template.delimiterEnd || DEFAULT_DELIMITER_END;

  // Load enriched patent data
  const patents = loadEnrichedPatents(patentIds);

  // DEBUG: Log first few patent titles to verify they're being loaded
  console.log(`[Tournament DEBUG] Cluster ${clusterIndex} - Loading ${patentIds.length} patents`);
  for (let i = 0; i < Math.min(3, patentIds.length); i++) {
    const p = patents.get(patentIds[i]);
    console.log(`  PATENT_${i + 1}: "${p?.patent_title?.slice(0, 60) || 'NO TITLE'}"...`);
  }

  // Create numbered references to prevent hallucination
  // LLM will see PATENT_1, PATENT_2, etc. and must return those exact keys
  const numberToId = new Map<string, string>();  // PATENT_1 -> actual_patent_id
  const idToNumber = new Map<string, string>();  // actual_patent_id -> PATENT_1
  patentIds.forEach((pid, idx) => {
    const numberedKey = `PATENT_${idx + 1}`;
    numberToId.set(numberedKey, pid);
    idToNumber.set(pid, numberedKey);
  });

  // Build patent data for prompt with NUMBERED keys instead of patent_ids
  let patentDataJson = '';
  patentIds.forEach((pid, idx) => {
    const p = patents.get(pid) || { patent_id: pid };
    const numberedKey = `PATENT_${idx + 1}`;

    // Build patent info with numbered key as identifier
    // TITLE is capitalized and first to force LLM to read it
    const patentInfo: Record<string, unknown> = {
      ID: numberedKey,  // Use numbered key as the identifier
      TITLE: p.patent_title || '',  // CAPS to emphasize - LLM MUST use this exact title
      ABSTRACT: p.abstract || '',  // Include abstract for context - critical for evaluation
      assignee: p.assignee || '',
      primary_sector: p.primary_sector || '',
      cpc_codes: p.cpc_codes || [],
    };

    // Add LLM-enriched fields if available (summary, technical_solution complement the abstract)
    if (p.summary) patentInfo.llm_summary = p.summary;
    if (p.technical_solution) patentInfo.technical_solution = p.technical_solution;
    if (p.market_segment) patentInfo.market_segment = p.market_segment;

    // Add context from all previous rounds
    if (roundContext?.previousRoundResults) {
      for (let r = 0; r < roundContext.previousRoundResults.length; r++) {
        const roundResults = roundContext.previousRoundResults[r];
        if (roundResults.has(pid)) {
          const prevResult = roundResults.get(pid)!;
          const prefix = `round${r + 1}_`;
          patentInfo[`${prefix}key_strength`] = prevResult.key_strength || prevResult.key_strength_refined;
          patentInfo[`${prefix}key_weakness`] = prevResult.key_weakness || prevResult.validity_concerns;
          patentInfo[`${prefix}overall_pos_potential`] = prevResult.overall_pos_potential;
          patentInfo[`${prefix}dark_horse_potential`] = prevResult.dark_horse_potential;
        }
      }
    }

    patentDataJson += JSON.stringify(patentInfo, null, 2) + '\n\n';
  });

  // Build prompt - substitute placeholders
  let promptText = template.promptText || '';
  const startEsc = delimStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endEsc = delimEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Replace cluster.patentData
  const patentDataPattern = new RegExp(`${startEsc}cluster\\.patentData${endEsc}`, 'g');
  promptText = promptText.replace(patentDataPattern, patentDataJson);

  // Replace cluster.patentIdList with numbered keys (PATENT_1, PATENT_2, ...)
  const numberedKeyList = Array.from(numberToId.keys()).join(', ');
  const patentIdListPattern = new RegExp(`${startEsc}cluster\\.patentIdList${endEsc}`, 'g');
  promptText = promptText.replace(patentIdListPattern, numberedKeyList);

  // Replace super_sector if present
  if (roundContext?.superSector) {
    const superSectorPattern = new RegExp(`${startEsc}super_sector${endEsc}`, 'g');
    promptText = promptText.replace(superSectorPattern, roundContext.superSector);
  }

  // For rounds 2+, also substitute round1Results (combined context)
  if (roundContext?.roundNumber && roundContext.roundNumber >= 2 && roundContext.previousRoundResults) {
    const clusterPrevResults = patentIds
      .filter(pid => roundContext.previousRoundResults!.some(r => r.has(pid)))
      .map(pid => {
        const result: Record<string, unknown> = { patent_id: pid };
        // Combine all previous round results for this patent
        for (let r = 0; r < roundContext.previousRoundResults!.length; r++) {
          const roundResults = roundContext.previousRoundResults![r];
          if (roundResults.has(pid)) {
            const prevResult = roundResults.get(pid)!;
            const prefix = `round${r + 1}_`;
            Object.entries(prevResult).forEach(([k, v]) => {
              result[`${prefix}${k}`] = v;
            });
          }
        }
        return result;
      });
    const prevResultsJson = JSON.stringify(clusterPrevResults, null, 2);
    const round1Pattern = new RegExp(`${startEsc}cluster\\.round1Results${endEsc}`, 'g');
    promptText = promptText.replace(round1Pattern, prevResultsJson);
  }

  // Build question instructions for structured response
  const questionInstructions = questions.map((q, i) => {
    let instruction = `${i + 1}. ${q.fieldName}: ${q.question}`;
    if (q.answerType === 'INTEGER' && q.constraints) {
      instruction += ` (Integer ${q.constraints.min}-${q.constraints.max})`;
    } else if (q.answerType === 'ENUM' && q.constraints?.options) {
      instruction += ` (One of: ${q.constraints.options.join(', ')})`;
    } else if (q.answerType === 'TEXT_ARRAY') {
      instruction += ` (Array of strings)`;
    } else if (q.answerType === 'TEXT') {
      instruction += ` (Text)`;
    }
    return instruction;
  }).join('\n');

  // Build the valid numbered keys list for the prompt
  const validNumberedKeys = Array.from(numberToId.keys()).join(', ');

  const fullPrompt = `${promptText}

IMPORTANT: Each patent is identified by a numbered key (${validNumberedKeys}).
You MUST use ONLY these exact keys in your response. Do NOT invent patent numbers.

For EACH patent, provide structured responses in JSON format.
Return a JSON object using the patent's numbered key (PATENT_1, PATENT_2, etc.) as keys, each containing answers to:

${questionInstructions}

Also include at the TOP LEVEL (not per-patent):
- cluster_ranking: Array of ALL patent keys (PATENT_1, PATENT_2, etc.) ordered from strongest to weakest
- top_dark_horse: Single patent key of the best dark horse candidate (outside top advancing patents)
- dark_horse_rationale: Why this dark horse deserves consideration

Return valid JSON only, no markdown code blocks.`;

  // DEBUG: Log a sample of the prompt to verify patent data is included
  const promptPreview = patentDataJson.slice(0, 500);
  console.log(`[Tournament DEBUG] Prompt preview (patent data section):\n${promptPreview}...`);

  // Call LLM
  const llmResult = await callLlm(fullPrompt, template.llmModel, SYSTEM_MESSAGE_STRUCTURED);

  // Parse response and map numbered keys back to actual patent IDs
  let parsedFields: Record<string, unknown> = {};
  let clusterRanking: string[] = [];
  let darkHorse: string | undefined;
  let darkHorseRationale: string | undefined;

  if (llmResult.response) {
    const rawResponse = llmResult.response as Record<string, unknown>;

    // Extract cluster_ranking (will be PATENT_1, PATENT_2, etc.)
    let rawRanking: string[] = [];
    if (rawResponse.cluster_ranking && Array.isArray(rawResponse.cluster_ranking)) {
      rawRanking = rawResponse.cluster_ranking as string[];
    }

    // VALIDATION: Check if LLM returned valid numbered keys
    const invalidKeys = rawRanking.filter(key => !numberToId.has(key));
    if (invalidKeys.length > 0) {
      throw new Error(
        `LLM hallucinated ${invalidKeys.length} patent keys. ` +
        `Invalid: [${invalidKeys.slice(0, 3).join(', ')}]. ` +
        `Valid keys: [${validNumberedKeys}]. ` +
        `Tournament terminated to prevent bad data.`
      );
    }

    // Map numbered keys back to actual patent IDs
    clusterRanking = rawRanking.map(key => numberToId.get(key)!);

    // Extract dark horse / latent value candidate (also a numbered key)
    // Try new field names first, fall back to legacy
    let rawDarkHorse: string | undefined;
    if (rawResponse.latent_value_candidate && typeof rawResponse.latent_value_candidate === 'string') {
      rawDarkHorse = rawResponse.latent_value_candidate;
      // Use latent value reasoning if available
      if (rawResponse.latent_value_reasoning && typeof rawResponse.latent_value_reasoning === 'string') {
        darkHorseRationale = rawResponse.latent_value_reasoning;
      }
    } else if (rawResponse.top_dark_horse && typeof rawResponse.top_dark_horse === 'string') {
      rawDarkHorse = rawResponse.top_dark_horse;
      if (rawResponse.dark_horse_rationale && typeof rawResponse.dark_horse_rationale === 'string') {
        darkHorseRationale = rawResponse.dark_horse_rationale;
      }
    }

    // Validate and map dark horse (allow "NONE" as valid response for no dark horse)
    if (rawDarkHorse && rawDarkHorse.toUpperCase() !== 'NONE') {
      if (!numberToId.has(rawDarkHorse)) {
        throw new Error(
          `LLM hallucinated dark horse key "${rawDarkHorse}". ` +
          `Valid keys: [${validNumberedKeys}] or "NONE". ` +
          `Tournament terminated.`
        );
      }
      darkHorse = numberToId.get(rawDarkHorse);
    }
    // If "NONE", darkHorse remains undefined

    // Map per-patent results from numbered keys back to actual IDs
    for (const [numberedKey, actualId] of numberToId) {
      if (rawResponse[numberedKey]) {
        parsedFields[actualId] = rawResponse[numberedKey];
      }
    }

    if (clusterRanking.length === 0) {
      // Fallback: if no explicit ranking, try to rank by overall_pos_potential scores
      const patentScores: Array<{ id: string; score: number }> = [];
      for (const pid of patentIds) {
        const patentResult = parsedFields[pid] as Record<string, unknown> | undefined;
        if (patentResult && typeof patentResult.overall_pos_potential === 'number') {
          patentScores.push({ id: pid, score: patentResult.overall_pos_potential });
        } else {
          patentScores.push({ id: pid, score: 0 });
        }
      }
      patentScores.sort((a, b) => b.score - a.score);
      clusterRanking = patentScores.map(p => p.id);
    }
  }

  const tokensUsed = (llmResult.inputTokens || 0) + (llmResult.outputTokens || 0);

  return {
    clusterId: `cluster-${clusterIndex.toString().padStart(3, '0')}`,
    clusterIndex,
    patentIds,
    llmResponse: llmResult.response || {},
    parsedFields,
    clusterRanking,
    advancingPatents: [], // Will be set by caller based on advanceCount + dark horse
    darkHorse,
    darkHorseRationale,
    rawResponse: llmResult.rawText,
    tokensUsed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Round Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a full round of cluster evaluations.
 */
async function executeRound(
  roundNumber: number,
  patentIds: string[],
  roundConfig: TournamentRoundConfig,
  tournamentId: string,
  previousResults?: Map<string, Record<string, unknown>>
): Promise<RoundResult> {
  const startedAt = new Date();

  // Create clusters
  const clusters = chunkArray(patentIds, roundConfig.clusterSize);
  const clusterResults: ClusterResult[] = [];
  let totalTokens = 0;

  console.log(`[Tournament ${tournamentId}] Round ${roundNumber}: ${clusters.length} clusters of ${roundConfig.clusterSize}`);

  // Update status
  const status = runningTournaments.get(tournamentId);
  if (status) {
    status.currentPhase = `Round ${roundNumber}`;
    if (roundNumber === 1) {
      status.progress.round1.total = clusters.length;
    } else {
      status.progress.round2.total = clusters.length;
    }
  }

  // Execute each cluster
  for (let i = 0; i < clusters.length; i++) {
    console.log(`[Tournament ${tournamentId}] Round ${roundNumber}, Cluster ${i + 1}/${clusters.length}`);

    const result = await executeCluster(
      i,
      clusters[i],
      roundConfig.templateId,
      { roundNumber, previousResults }
    );

    // Determine advancing patents (top N from ranking)
    result.advancingPatents = result.clusterRanking.slice(0, roundConfig.advanceCount);

    clusterResults.push(result);
    totalTokens += result.tokensUsed;

    // Update progress
    if (status) {
      if (roundNumber === 1) {
        status.progress.round1.completed = i + 1;
      } else {
        status.progress.round2.completed = i + 1;
      }
    }

    // Save cluster result to disk
    const roundDir = path.join(OUTPUT_DIR, tournamentId, `round-${roundNumber}`);
    if (!fs.existsSync(roundDir)) {
      fs.mkdirSync(roundDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(roundDir, `${result.clusterId}.json`),
      JSON.stringify(result, null, 2)
    );

    // Rate limiting
    if (i < clusters.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  // Collect all advancing patents
  const advancingPatentIds = clusterResults.flatMap(c => c.advancingPatents);

  // Save round summary
  const roundResult: RoundResult = {
    roundNumber,
    templateId: roundConfig.templateId,
    clusters: clusterResults,
    advancingPatentIds,
    totalTokens,
    startedAt,
    completedAt: new Date(),
  };

  const roundDir = path.join(OUTPUT_DIR, tournamentId, `round-${roundNumber}`);
  // Ensure directory exists even if there were 0 clusters
  if (!fs.existsSync(roundDir)) {
    fs.mkdirSync(roundDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(roundDir, 'round-summary.json'),
    JSON.stringify({
      roundNumber,
      templateId: roundConfig.templateId,
      clusterCount: clusters.length,
      advanceCount: roundConfig.advanceCount,
      inputPatentCount: patentIds.length,
      advancingPatentCount: advancingPatentIds.length,
      advancingPatentIds,
      totalTokens,
      startedAt,
      completedAt: roundResult.completedAt,
    }, null, 2)
  );

  console.log(`[Tournament ${tournamentId}] Round ${roundNumber} complete: ${advancingPatentIds.length} patents advancing`);

  return roundResult;
}

/**
 * Execute a full round of V2 cluster evaluations (with dark horse support).
 */
async function executeRoundV2(
  roundNumber: number,
  patentIds: string[],
  roundConfig: TournamentV2RoundConfig,
  tournamentId: string,
  previousRoundResults?: Map<string, Record<string, unknown>>[],
  superSector?: string
): Promise<V2RoundResult> {
  const startedAt = new Date();

  // Create clusters
  const clusters = chunkArray(patentIds, roundConfig.clusterSize);
  const clusterResults: V2ClusterResult[] = [];
  let totalTokens = 0;
  const darkHorseIds: string[] = [];

  console.log(`[Tournament ${tournamentId}] Round ${roundNumber}: ${clusters.length} clusters of ${roundConfig.clusterSize}`);

  // Update status
  const status = runningTournaments.get(tournamentId);
  if (status) {
    status.currentPhase = `Round ${roundNumber}`;
    // Update appropriate round progress
    if (roundNumber === 1) {
      status.progress.round1.total = clusters.length;
    } else {
      status.progress.round2.total = clusters.length;
    }
  }

  // Execute each cluster
  for (let i = 0; i < clusters.length; i++) {
    console.log(`[Tournament ${tournamentId}] Round ${roundNumber}, Cluster ${i + 1}/${clusters.length}`);

    const result = await executeClusterV2(
      i,
      clusters[i],
      roundConfig.templateId,
      { roundNumber, previousRoundResults, superSector }
    );

    // Determine advancing patents with threshold-based filtering
    const threshold = roundConfig.relevanceThreshold || 0;
    let advancingCandidates: string[] = [];

    if (threshold > 0) {
      // Filter by composite score - only advance patents meeting threshold (0-20 scale)
      for (const patentKey of result.clusterRanking) {
        const patentId = patentKey; // Already mapped to actual ID at this point
        const patentData = result.parsedFields[patentId] as Record<string, unknown> | undefined;
        // Check new layered composite scores first, fall back to legacy pos_relevance_score
        const compositeScore = patentData?.stack_composite_score
          ?? patentData?.verified_composite_score
          ?? patentData?.final_composite_score
          ?? patentData?.pos_relevance_score
          ?? patentData?.verified_pos_relevance
          ?? patentData?.final_pos_relevance
          ?? 20; // Default high if no score found (legacy behavior)

        if (typeof compositeScore === 'number' && compositeScore >= threshold) {
          advancingCandidates.push(patentId);
        }
      }
      // Cap at advanceCount
      advancingCandidates = advancingCandidates.slice(0, roundConfig.advanceCount);
    } else {
      // No threshold - use traditional top N approach
      advancingCandidates = result.clusterRanking.slice(0, roundConfig.advanceCount);
    }

    result.advancingPatents = [...advancingCandidates];

    // Add dark horse / latent value candidate if configured, not already advancing, and meets threshold
    if (roundConfig.includeDarkHorse && result.darkHorse) {
      if (!result.advancingPatents.includes(result.darkHorse)) {
        // Check if dark horse / latent value meets threshold
        const darkHorseData = result.parsedFields[result.darkHorse] as Record<string, unknown> | undefined;
        // Use new composite scores, fall back to legacy scores
        const darkHorseScore = darkHorseData?.stack_composite_score
          ?? darkHorseData?.verified_composite_score
          ?? darkHorseData?.final_composite_score
          ?? darkHorseData?.pos_relevance_score
          ?? darkHorseData?.verified_pos_relevance
          ?? 20;
        // For latent value candidates, also consider the latent_value_score bonus
        const latentValueBonus = darkHorseData?.latent_value_score ?? 0;
        const effectiveScore = typeof darkHorseScore === 'number' ? darkHorseScore + (typeof latentValueBonus === 'number' ? latentValueBonus : 0) : darkHorseScore;

        if (threshold === 0 || (typeof effectiveScore === 'number' && effectiveScore >= threshold)) {
          result.advancingPatents.push(result.darkHorse);
          darkHorseIds.push(result.darkHorse);
          console.log(`[Tournament ${tournamentId}] R${roundNumber} C${i + 1}: Dark horse/latent value advancing: ${result.darkHorse} (score: ${effectiveScore})`);
        } else {
          console.log(`[Tournament ${tournamentId}] R${roundNumber} C${i + 1}: Dark horse ${result.darkHorse} below threshold (${effectiveScore} < ${threshold})`);
        }
      }
    }

    // Log if cluster has few/no advancing patents
    if (result.advancingPatents.length === 0) {
      console.log(`[Tournament ${tournamentId}] R${roundNumber} C${i + 1}: No patents met relevance threshold (${threshold})`);
    } else if (result.advancingPatents.length < roundConfig.advanceCount) {
      console.log(`[Tournament ${tournamentId}] R${roundNumber} C${i + 1}: Only ${result.advancingPatents.length}/${roundConfig.advanceCount} met threshold`);
    }

    clusterResults.push(result);
    totalTokens += result.tokensUsed;

    // Update progress
    if (status) {
      if (roundNumber === 1) {
        status.progress.round1.completed = i + 1;
      } else {
        status.progress.round2.completed = i + 1;
      }
    }

    // Save cluster result to disk
    const roundDir = path.join(OUTPUT_DIR, tournamentId, `round-${roundNumber}`);
    if (!fs.existsSync(roundDir)) {
      fs.mkdirSync(roundDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(roundDir, `${result.clusterId}.json`),
      JSON.stringify(result, null, 2)
    );

    // Rate limiting
    if (i < clusters.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  // Collect all advancing patents (preserving order but avoiding duplicates)
  const advancingPatentIds = clusterResults.flatMap(c => c.advancingPatents);

  // Save round summary
  const roundResult: V2RoundResult = {
    roundNumber,
    templateId: roundConfig.templateId,
    clusters: clusterResults,
    advancingPatentIds,
    darkHorseIds,
    totalTokens,
    startedAt,
    completedAt: new Date(),
  };

  const roundDir = path.join(OUTPUT_DIR, tournamentId, `round-${roundNumber}`);
  // Ensure directory exists even if there were 0 clusters
  if (!fs.existsSync(roundDir)) {
    fs.mkdirSync(roundDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(roundDir, 'round-summary.json'),
    JSON.stringify({
      roundNumber,
      templateId: roundConfig.templateId,
      clusterCount: clusters.length,
      advanceCount: roundConfig.advanceCount,
      includeDarkHorse: roundConfig.includeDarkHorse,
      inputPatentCount: patentIds.length,
      advancingPatentCount: advancingPatentIds.length,
      darkHorseCount: darkHorseIds.length,
      darkHorseIds,
      advancingPatentIds,
      totalTokens,
      startedAt,
      completedAt: roundResult.completedAt,
    }, null, 2)
  );

  console.log(`[Tournament ${tournamentId}] Round ${roundNumber} complete: ${advancingPatentIds.length} advancing (${darkHorseIds.length} dark horses)`);

  return roundResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// Final Synthesis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute final synthesis with all round context.
 */
async function executeFinalSynthesis(
  finalistIds: string[],
  templateId: string,
  tournamentId: string,
  round1Results: Map<string, Record<string, unknown>>,
  round2Results: Map<string, Record<string, unknown>>
): Promise<{
  llmResponse: Record<string, unknown>;
  parsedFields: Record<string, unknown>;
  tokensUsed: number;
}> {
  const template = await prisma.promptTemplate.findUniqueOrThrow({
    where: { id: templateId },
  });

  const questions = template.questions as StructuredQuestion[] || [];
  const delimStart = template.delimiterStart || DEFAULT_DELIMITER_START;
  const delimEnd = template.delimiterEnd || DEFAULT_DELIMITER_END;

  // Load enriched patent data
  const patents = loadEnrichedPatents(finalistIds);

  // Build finalist data with all context
  let finalistDataJson = '';
  for (const pid of finalistIds) {
    const p = patents.get(pid) || { patent_id: pid };
    const patentInfo: Record<string, unknown> = { ...p };

    // Add Round 1 context
    if (round1Results.has(pid)) {
      const r1 = round1Results.get(pid)!;
      patentInfo.round1_overall_pos_potential = r1.overall_pos_potential;
      patentInfo.round1_key_strength = r1.key_strength;
      patentInfo.round1_key_weakness = r1.key_weakness;
    }

    // Add Round 2 context
    if (round2Results.has(pid)) {
      const r2 = round2Results.get(pid)!;
      patentInfo.round2_overall_pos_potential = r2.overall_pos_potential;
      patentInfo.round2_key_strength_refined = r2.key_strength_refined;
      patentInfo.round2_litigation_readiness = r2.litigation_readiness;
    }

    finalistDataJson += JSON.stringify(patentInfo, null, 2) + '\n\n';
  }

  // Build prompt
  let promptText = template.promptText || '';
  const startEsc = delimStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endEsc = delimEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Replace finalists.patentData
  const finalistPattern = new RegExp(`${startEsc}finalists\\.patentData${endEsc}`, 'g');
  promptText = promptText.replace(finalistPattern, finalistDataJson);

  // Replace finalists.round1Results
  const r1Json = JSON.stringify(
    Array.from(round1Results.entries())
      .filter(([pid]) => finalistIds.includes(pid))
      .map(([pid, result]) => ({ patent_id: pid, ...result })),
    null,
    2
  );
  const r1Pattern = new RegExp(`${startEsc}finalists\\.round1Results${endEsc}`, 'g');
  promptText = promptText.replace(r1Pattern, r1Json);

  // Replace finalists.round2Results
  const r2Json = JSON.stringify(
    Array.from(round2Results.entries())
      .filter(([pid]) => finalistIds.includes(pid))
      .map(([pid, result]) => ({ patent_id: pid, ...result })),
    null,
    2
  );
  const r2Pattern = new RegExp(`${startEsc}finalists\\.round2Results${endEsc}`, 'g');
  promptText = promptText.replace(r2Pattern, r2Json);

  // Build question instructions
  const questionInstructions = questions.map((q, i) => {
    let instruction = `${i + 1}. ${q.fieldName}: ${q.question}`;
    if (q.answerType === 'INTEGER' && q.constraints) {
      instruction += ` (Integer ${q.constraints.min}-${q.constraints.max})`;
    } else if (q.answerType === 'ENUM' && q.constraints?.options) {
      instruction += ` (One of: ${q.constraints.options.join(', ')})`;
    } else if (q.answerType === 'TEXT_ARRAY') {
      instruction += ` (Array of strings)`;
    } else if (q.answerType === 'TEXT') {
      instruction += ` (Text)`;
    }
    return instruction;
  }).join('\n');

  const fullPrompt = `${promptText}

Provide your strategic synthesis in JSON format with the following fields:

${questionInstructions}

Return valid JSON only, no markdown code blocks.`;

  // Call LLM (uses generous default maxTokens to avoid truncation)
  const llmResult = await callLlm(fullPrompt, template.llmModel, SYSTEM_MESSAGE_STRUCTURED);

  const parsedFields = llmResult.response || {};
  const tokensUsed = (llmResult.inputTokens || 0) + (llmResult.outputTokens || 0);

  // Save final synthesis
  const finalDir = path.join(OUTPUT_DIR, tournamentId);
  fs.writeFileSync(
    path.join(finalDir, 'final-synthesis.json'),
    JSON.stringify({
      templateId,
      finalistCount: finalistIds.length,
      finalistIds,
      llmResponse: llmResult.response,
      parsedFields,
      rawResponse: llmResult.rawText,
      tokensUsed,
      executedAt: new Date().toISOString(),
    }, null, 2)
  );

  console.log(`[Tournament ${tournamentId}] Final synthesis complete (${tokensUsed} tokens)`);

  return {
    llmResponse: llmResult.response || {},
    parsedFields,
    tokensUsed,
  };
}

/**
 * Execute V2 final synthesis with all round context.
 */
async function executeFinalSynthesisV2(
  finalistIds: string[],
  templateId: string,
  tournamentId: string,
  allRoundResults: Map<string, Record<string, unknown>>[],
  superSector?: string
): Promise<{
  llmResponse: Record<string, unknown>;
  parsedFields: Record<string, unknown>;
  tokensUsed: number;
}> {
  const template = await prisma.promptTemplate.findUniqueOrThrow({
    where: { id: templateId },
  });

  const questions = template.questions as StructuredQuestion[] || [];
  const delimStart = template.delimiterStart || DEFAULT_DELIMITER_START;
  const delimEnd = template.delimiterEnd || DEFAULT_DELIMITER_END;

  // Load enriched patent data
  const patents = loadEnrichedPatents(finalistIds);

  // Create numbered references to prevent hallucination
  const numberToId = new Map<string, string>();
  const idToNumber = new Map<string, string>();
  finalistIds.forEach((pid, idx) => {
    const numberedKey = `PATENT_${idx + 1}`;
    numberToId.set(numberedKey, pid);
    idToNumber.set(pid, numberedKey);
  });

  // Build finalist data with NUMBERED keys
  let finalistDataJson = '';
  finalistIds.forEach((pid, idx) => {
    const p = patents.get(pid) || { patent_id: pid };
    const numberedKey = `PATENT_${idx + 1}`;

    // Build patent info with numbered key as identifier
    const patentInfo: Record<string, unknown> = {
      ID: numberedKey,
      title: p.patent_title || '',
      assignee: p.assignee || '',
      primary_sector: p.primary_sector || '',
    };

    // Add LLM-enriched fields if available
    if (p.summary) patentInfo.summary = p.summary;
    if (p.technical_solution) patentInfo.technical_solution = p.technical_solution;

    // Add context from all rounds
    for (let r = 0; r < allRoundResults.length; r++) {
      const roundResults = allRoundResults[r];
      if (roundResults.has(pid)) {
        const result = roundResults.get(pid)!;
        const prefix = `round${r + 1}_`;
        Object.entries(result).forEach(([k, v]) => {
          patentInfo[`${prefix}${k}`] = v;
        });
      }
    }

    finalistDataJson += JSON.stringify(patentInfo, null, 2) + '\n\n';
  });

  // Build prompt
  let promptText = template.promptText || '';
  const startEsc = delimStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endEsc = delimEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Replace cluster.patentData with finalistDataJson
  const patternData = new RegExp(`${startEsc}cluster\\.patentData${endEsc}`, 'g');
  promptText = promptText.replace(patternData, finalistDataJson);

  // Also replace finalists.patentData
  const finalistPattern = new RegExp(`${startEsc}finalists\\.patentData${endEsc}`, 'g');
  promptText = promptText.replace(finalistPattern, finalistDataJson);

  // Replace cluster.patentIdList with numbered keys
  const numberedKeyList = Array.from(numberToId.keys()).join(', ');
  const patentIdListPattern = new RegExp(`${startEsc}cluster\\.patentIdList${endEsc}`, 'g');
  promptText = promptText.replace(patentIdListPattern, numberedKeyList);

  // Replace super_sector
  if (superSector) {
    const superSectorPattern = new RegExp(`${startEsc}super_sector${endEsc}`, 'g');
    promptText = promptText.replace(superSectorPattern, superSector);
  }

  // Replace cluster.round1Results with all round context
  const allResultsJson = JSON.stringify(
    finalistIds.map(pid => {
      const result: Record<string, unknown> = { patent_id: pid };
      for (let r = 0; r < allRoundResults.length; r++) {
        const roundResults = allRoundResults[r];
        if (roundResults.has(pid)) {
          const prevResult = roundResults.get(pid)!;
          Object.entries(prevResult).forEach(([k, v]) => {
            result[`round${r + 1}_${k}`] = v;
          });
        }
      }
      return result;
    }),
    null,
    2
  );
  const round1Pattern = new RegExp(`${startEsc}cluster\\.round1Results${endEsc}`, 'g');
  promptText = promptText.replace(round1Pattern, allResultsJson);

  // Build question instructions
  const questionInstructions = questions.map((q, i) => {
    let instruction = `${i + 1}. ${q.fieldName}: ${q.question}`;
    if (q.answerType === 'INTEGER' && q.constraints) {
      instruction += ` (Integer ${q.constraints.min}-${q.constraints.max})`;
    } else if (q.answerType === 'ENUM' && q.constraints?.options) {
      instruction += ` (One of: ${q.constraints.options.join(', ')})`;
    } else if (q.answerType === 'TEXT_ARRAY') {
      instruction += ` (Array of strings)`;
    } else if (q.answerType === 'TEXT') {
      instruction += ` (Text)`;
    }
    return instruction;
  }).join('\n');

  const fullPrompt = `${promptText}

Provide your strategic synthesis in JSON format with the following fields:

${questionInstructions}

Return valid JSON only, no markdown code blocks.`;

  // Call LLM
  const llmResult = await callLlm(fullPrompt, template.llmModel, SYSTEM_MESSAGE_STRUCTURED);

  const rawResponse = llmResult.response || {};
  const tokensUsed = (llmResult.inputTokens || 0) + (llmResult.outputTokens || 0);

  // Map numbered keys back to actual patent IDs in tier arrays
  const parsedFields: Record<string, unknown> = { ...rawResponse };

  // Helper to map numbered keys to actual IDs
  const mapKeys = (arr: unknown[]): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr.map(key => {
      if (typeof key === 'string' && numberToId.has(key)) {
        return numberToId.get(key)!;
      }
      return String(key);  // Keep as-is if not a numbered key
    });
  };

  // Map tier arrays to actual IDs
  if (rawResponse.tier1_patents && Array.isArray(rawResponse.tier1_patents)) {
    parsedFields.tier1_patents = mapKeys(rawResponse.tier1_patents);
  }
  if (rawResponse.tier2_patents && Array.isArray(rawResponse.tier2_patents)) {
    parsedFields.tier2_patents = mapKeys(rawResponse.tier2_patents);
  }
  if (rawResponse.tier3_patents && Array.isArray(rawResponse.tier3_patents)) {
    parsedFields.tier3_patents = mapKeys(rawResponse.tier3_patents);
  }
  if (rawResponse.recommended_lead_patents && Array.isArray(rawResponse.recommended_lead_patents)) {
    parsedFields.recommended_lead_patents = mapKeys(rawResponse.recommended_lead_patents);
  }
  if (rawResponse.dark_horse_winners && Array.isArray(rawResponse.dark_horse_winners)) {
    parsedFields.dark_horse_winners = mapKeys(rawResponse.dark_horse_winners);
  }

  // Save final synthesis
  const finalDir = path.join(OUTPUT_DIR, tournamentId);
  fs.writeFileSync(
    path.join(finalDir, 'final-synthesis.json'),
    JSON.stringify({
      templateId,
      finalistCount: finalistIds.length,
      finalistIds,
      numberToIdMapping: Object.fromEntries(numberToId),  // Save mapping for reference
      llmResponse: rawResponse,
      parsedFields,
      rawResponse: llmResult.rawText,
      tokensUsed,
      executedAt: new Date().toISOString(),
    }, null, 2)
  );

  console.log(`[Tournament ${tournamentId}] Final synthesis complete (${tokensUsed} tokens)`);

  return {
    llmResponse: llmResult.response || {},
    parsedFields,
    tokensUsed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Tournament Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a complete POS tournament.
 */
export async function executeTournament(
  config: TournamentConfig,
  input: TournamentInput
): Promise<TournamentResult> {
  const tournamentId = generateTournamentId();
  const startedAt = new Date();

  // Initialize status tracking
  const status: TournamentStatus = {
    tournamentId,
    status: 'RUNNING',
    currentPhase: 'Loading input',
    progress: {
      round1: { total: 0, completed: 0 },
      round2: { total: 0, completed: 0 },
      final: false,
    },
  };
  runningTournaments.set(tournamentId, status);

  // Create output directory
  const tournamentDir = path.join(OUTPUT_DIR, tournamentId);
  fs.mkdirSync(tournamentDir, { recursive: true });

  try {
    // Save config
    fs.writeFileSync(
      path.join(tournamentDir, 'config.json'),
      JSON.stringify({ config, input, startedAt: startedAt.toISOString() }, null, 2)
    );

    console.log(`[Tournament ${tournamentId}] Starting tournament: ${config.name}`);

    // Load input patents
    status.currentPhase = 'Loading patents';
    const inputPatentIds = await loadInputPatents(input);
    console.log(`[Tournament ${tournamentId}] Loaded ${inputPatentIds.length} input patents`);

    fs.writeFileSync(
      path.join(tournamentDir, 'input-patents.json'),
      JSON.stringify({ count: inputPatentIds.length, patentIds: inputPatentIds }, null, 2)
    );

    // Execute Round 1
    const round1Result = await executeRound(
      1,
      inputPatentIds,
      config.round1,
      tournamentId
    );

    // Build Round 1 results map for context passing
    const round1ResultsMap = new Map<string, Record<string, unknown>>();
    for (const cluster of round1Result.clusters) {
      for (const pid of cluster.patentIds) {
        const patentResult = cluster.parsedFields[pid] as Record<string, unknown> | undefined;
        if (patentResult) {
          round1ResultsMap.set(pid, patentResult);
        }
      }
    }

    // Execute Round 2 with advancing patents
    const round2Result = await executeRound(
      2,
      round1Result.advancingPatentIds,
      config.round2,
      tournamentId,
      round1ResultsMap
    );

    // Build Round 2 results map
    const round2ResultsMap = new Map<string, Record<string, unknown>>();
    for (const cluster of round2Result.clusters) {
      for (const pid of cluster.patentIds) {
        const patentResult = cluster.parsedFields[pid] as Record<string, unknown> | undefined;
        if (patentResult) {
          round2ResultsMap.set(pid, patentResult);
        }
      }
    }

    // Execute Final Synthesis
    status.currentPhase = 'Final synthesis';
    const finalSynthesis = await executeFinalSynthesis(
      round2Result.advancingPatentIds,
      config.finalTemplateId,
      tournamentId,
      round1ResultsMap,
      round2ResultsMap
    );
    status.progress.final = true;

    // Extract summary from final synthesis
    const finalFields = finalSynthesis.parsedFields as Record<string, unknown>;
    const summary = {
      tier1Patents: (finalFields.tier1_patents as string[]) || [],
      tier2Patents: (finalFields.tier2_patents as string[]) || [],
      tier3Patents: (finalFields.tier3_patents as string[]) || [],
      executiveSummary: (finalFields.executive_summary as string) || '',
      keyJuryNarrative: (finalFields.key_jury_narrative as string) || '',
    };

    const completedAt = new Date();
    const totalTokensUsed = round1Result.totalTokens + round2Result.totalTokens + finalSynthesis.tokensUsed;

    // Build final result
    const result: TournamentResult = {
      tournamentId,
      config,
      input,
      inputPatentIds,
      round1: round1Result,
      round2: round2Result,
      finalSynthesis,
      summary,
      totalTokensUsed,
      startedAt,
      completedAt,
      outputDir: tournamentDir,
    };

    // Save summary
    fs.writeFileSync(
      path.join(tournamentDir, 'summary.json'),
      JSON.stringify({
        tournamentId,
        name: config.name,
        inputPatentCount: inputPatentIds.length,
        round1AdvancingCount: round1Result.advancingPatentIds.length,
        round2AdvancingCount: round2Result.advancingPatentIds.length,
        tier1Count: summary.tier1Patents.length,
        tier2Count: summary.tier2Patents.length,
        tier3Count: summary.tier3Patents.length,
        totalTokensUsed,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        summary,
      }, null, 2)
    );

    // Update status
    status.status = 'COMPLETE';
    status.currentPhase = 'Complete';

    console.log(`[Tournament ${tournamentId}] Tournament complete!`);
    console.log(`  Input: ${inputPatentIds.length} patents`);
    console.log(`  Round 1 → ${round1Result.advancingPatentIds.length} advancing`);
    console.log(`  Round 2 → ${round2Result.advancingPatentIds.length} finalists`);
    console.log(`  Tier 1: ${summary.tier1Patents.length} patents`);
    console.log(`  Total tokens: ${totalTokensUsed}`);
    console.log(`  Output: ${tournamentDir}`);

    return result;

  } catch (error) {
    status.status = 'ERROR';
    status.error = error instanceof Error ? error.message : String(error);

    // Save error to disk
    fs.writeFileSync(
      path.join(tournamentDir, 'error.json'),
      JSON.stringify({
        error: status.error,
        timestamp: new Date().toISOString(),
      }, null, 2)
    );

    console.error(`[Tournament ${tournamentId}] Error:`, error);
    throw error;
  }
}

/**
 * Execute a complete V2 tournament (variable rounds with dark horse support).
 */
export async function executeTournamentV2(
  config: TournamentV2Config,
  input: TournamentInput
): Promise<TournamentV2Result> {
  const tournamentId = generateTournamentId();
  const startedAt = new Date();

  // Initialize status tracking
  const status: TournamentStatus = {
    tournamentId,
    status: 'RUNNING',
    currentPhase: 'Loading input',
    progress: {
      round1: { total: 0, completed: 0 },
      round2: { total: 0, completed: 0 },
      final: false,
    },
  };
  runningTournaments.set(tournamentId, status);

  // Create output directory
  const tournamentDir = path.join(OUTPUT_DIR, tournamentId);
  fs.mkdirSync(tournamentDir, { recursive: true });

  try {
    // Save config
    fs.writeFileSync(
      path.join(tournamentDir, 'config.json'),
      JSON.stringify({
        version: 'v2',
        config,
        input,
        startedAt: startedAt.toISOString(),
      }, null, 2)
    );

    console.log(`[Tournament ${tournamentId}] Starting V2 tournament: ${config.name}`);
    console.log(`[Tournament ${tournamentId}] ${config.rounds.length} rounds configured`);

    // Load input patents
    status.currentPhase = 'Loading patents';
    const inputPatentIds = await loadInputPatents(input);
    console.log(`[Tournament ${tournamentId}] Loaded ${inputPatentIds.length} input patents`);

    fs.writeFileSync(
      path.join(tournamentDir, 'input-patents.json'),
      JSON.stringify({ count: inputPatentIds.length, patentIds: inputPatentIds }, null, 2)
    );

    // Execute each round
    const roundResults: V2RoundResult[] = [];
    const allRoundResultsMaps: Map<string, Record<string, unknown>>[] = [];
    let currentPatentIds = inputPatentIds;

    for (let r = 0; r < config.rounds.length; r++) {
      const roundConfig = config.rounds[r];
      const roundNumber = r + 1;

      const roundResult = await executeRoundV2(
        roundNumber,
        currentPatentIds,
        roundConfig,
        tournamentId,
        allRoundResultsMaps.length > 0 ? allRoundResultsMaps : undefined,
        config.superSector
      );

      roundResults.push(roundResult);

      // Build results map for this round
      const roundResultsMap = new Map<string, Record<string, unknown>>();
      for (const cluster of roundResult.clusters) {
        for (const pid of cluster.patentIds) {
          const patentResult = cluster.parsedFields[pid] as Record<string, unknown> | undefined;
          if (patentResult) {
            roundResultsMap.set(pid, patentResult);
          }
        }
      }
      allRoundResultsMaps.push(roundResultsMap);

      // Advance to next round
      currentPatentIds = roundResult.advancingPatentIds;

      console.log(`[Tournament ${tournamentId}] Round ${roundNumber}: ${currentPatentIds.length} advancing`);
    }

    // Execute Final Synthesis
    status.currentPhase = 'Final synthesis';
    const finalSynthesis = await executeFinalSynthesisV2(
      currentPatentIds,
      config.finalTemplateId,
      tournamentId,
      allRoundResultsMaps,
      config.superSector
    );
    status.progress.final = true;

    // Extract summary from final synthesis
    const finalFields = finalSynthesis.parsedFields as Record<string, unknown>;
    const summary = {
      tier1Patents: (finalFields.tier1_patents as string[]) || [],
      tier2Patents: (finalFields.tier2_patents as string[]) || [],
      tier3Patents: (finalFields.tier3_patents as string[]) || [],
      darkHorseWinners: (finalFields.dark_horse_winners as string[]) || [],
      executiveSummary: (finalFields.executive_summary as string) || '',
      keyJuryNarrative: (finalFields.key_jury_narrative as string) || '',
    };

    const completedAt = new Date();
    const totalTokensUsed = roundResults.reduce((sum, r) => sum + r.totalTokens, 0) + finalSynthesis.tokensUsed;

    // Collect all dark horses across all rounds
    const allDarkHorses = roundResults.flatMap(r => r.darkHorseIds);

    // Build final result
    const result: TournamentV2Result = {
      tournamentId,
      config,
      input,
      inputPatentIds,
      rounds: roundResults,
      finalSynthesis,
      summary,
      totalTokensUsed,
      startedAt,
      completedAt,
      outputDir: tournamentDir,
    };

    // Save summary
    fs.writeFileSync(
      path.join(tournamentDir, 'summary.json'),
      JSON.stringify({
        version: 'v2',
        tournamentId,
        name: config.name,
        superSector: config.superSector,
        inputPatentCount: inputPatentIds.length,
        roundCount: roundResults.length,
        roundAdvancing: roundResults.map((r, i) => ({
          round: i + 1,
          advancing: r.advancingPatentIds.length,
          darkHorses: r.darkHorseIds.length,
        })),
        finalistCount: currentPatentIds.length,
        tier1Count: summary.tier1Patents.length,
        tier2Count: summary.tier2Patents.length,
        tier3Count: summary.tier3Patents.length,
        darkHorseWinnerCount: summary.darkHorseWinners.length,
        allDarkHorses,
        totalTokensUsed,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
        summary,
      }, null, 2)
    );

    // Update status
    status.status = 'COMPLETE';
    status.currentPhase = 'Complete';

    console.log(`[Tournament ${tournamentId}] V2 Tournament complete!`);
    console.log(`  Input: ${inputPatentIds.length} patents`);
    for (let i = 0; i < roundResults.length; i++) {
      console.log(`  Round ${i + 1} → ${roundResults[i].advancingPatentIds.length} advancing (${roundResults[i].darkHorseIds.length} dark horses)`);
    }
    console.log(`  Finalists: ${currentPatentIds.length}`);
    console.log(`  Tier 1: ${summary.tier1Patents.length} patents`);
    console.log(`  Dark horse winners: ${summary.darkHorseWinners.length}`);
    console.log(`  Total tokens: ${totalTokensUsed}`);
    console.log(`  Output: ${tournamentDir}`);

    return result;

  } catch (error) {
    status.status = 'ERROR';
    status.error = error instanceof Error ? error.message : String(error);

    // Save error to disk
    fs.writeFileSync(
      path.join(tournamentDir, 'error.json'),
      JSON.stringify({
        error: status.error,
        timestamp: new Date().toISOString(),
      }, null, 2)
    );

    console.error(`[Tournament ${tournamentId}] Error:`, error);
    throw error;
  }
}

/**
 * Get tournament status.
 */
export function getTournamentStatus(tournamentId: string): TournamentStatus | undefined {
  return runningTournaments.get(tournamentId);
}

/**
 * List completed tournaments from disk.
 */
export function listTournaments(): Array<{
  tournamentId: string;
  name: string;
  inputPatentCount: number;
  tier1Count: number;
  completedAt: string;
}> {
  if (!fs.existsSync(OUTPUT_DIR)) {
    return [];
  }

  const tournaments: Array<{
    tournamentId: string;
    name: string;
    inputPatentCount: number;
    tier1Count: number;
    completedAt: string;
  }> = [];

  const dirs = fs.readdirSync(OUTPUT_DIR);
  for (const dir of dirs) {
    const summaryPath = path.join(OUTPUT_DIR, dir, 'summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        tournaments.push({
          tournamentId: summary.tournamentId || dir,
          name: summary.name || 'Unknown',
          inputPatentCount: summary.inputPatentCount || 0,
          tier1Count: summary.tier1Count || 0,
          completedAt: summary.completedAt || '',
        });
      } catch {
        // Skip invalid summary files
      }
    }
  }

  return tournaments.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
}

/**
 * Get full tournament result from disk.
 */
export function getTournamentResult(tournamentId: string): Record<string, unknown> | null {
  const summaryPath = path.join(OUTPUT_DIR, tournamentId, 'summary.json');
  if (!fs.existsSync(summaryPath)) {
    return null;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));

  // Load final synthesis
  const finalPath = path.join(OUTPUT_DIR, tournamentId, 'final-synthesis.json');
  const finalSynthesis = fs.existsSync(finalPath)
    ? JSON.parse(fs.readFileSync(finalPath, 'utf-8'))
    : null;

  return {
    ...summary,
    finalSynthesis,
  };
}
