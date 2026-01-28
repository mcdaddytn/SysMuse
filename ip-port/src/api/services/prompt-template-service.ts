/**
 * Prompt Template Service
 *
 * Handles template variable substitution and LLM execution for
 * user-defined prompt templates on focus area patents.
 */

import { PrismaClient } from '@prisma/client';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const CACHE_BASE_DIR = path.join(process.cwd(), 'cache/focus-area-prompts');
const RATE_LIMIT_MS = 2000;

const SYSTEM_MESSAGE = `You are a patent analysis assistant. Analyze the provided patent information and respond with valid JSON. If you cannot produce valid JSON, respond with your analysis as plain text.`;

// Available patent fields for variable substitution
const PATENT_FIELDS = [
  'patent_id', 'patent_title', 'abstract', 'patent_date', 'assignee',
  'affiliate', 'super_sector', 'primary_sector',
  'cpc_codes', 'forward_citations', 'remaining_years',
  'score', 'competitor_citations', 'competitor_names',
  'summary', 'technology_category', 'prior_art_problem', 'technical_solution',
  'implementation_type', 'standards_relevance', 'market_segment',
  'detection_method', 'implementation_complexity', 'claim_type_primary',
  'geographic_scope', 'lifecycle_stage',
  'eligibility_score', 'validity_score', 'claim_breadth',
  'enforcement_clarity', 'design_around_difficulty',
  'market_relevance_score', 'trend_alignment_score',
  'investigation_priority_score', 'llm_confidence'
];

const FOCUS_AREA_FIELDS = ['name', 'description', 'patentIDs', 'patentCount', 'patentData'];

export { PATENT_FIELDS, FOCUS_AREA_FIELDS };

/**
 * Result file structure stored on disk
 */
export interface PromptResult {
  templateId: string;
  patentId: string | null;
  model: string;
  promptSent: string;
  response: Record<string, unknown> | null;
  rawText?: string;
  inputTokens?: number;
  outputTokens?: number;
  executedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patent Data Loading
// ─────────────────────────────────────────────────────────────────────────────

interface PatentData {
  patent_id: string;
  [key: string]: unknown;
}

/**
 * Load enriched patent data from the candidates file and LLM cache.
 * Mirrors the loadPatents() logic in patents.routes.ts.
 */
function loadEnrichedPatents(patentIds: string[]): Map<string, PatentData> {
  const result = new Map<string, PatentData>();
  const idSet = new Set(patentIds);

  // Load from streaming-candidates file
  const outputDir = path.join(process.cwd(), 'output');
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(outputDir, files[0]), 'utf-8'));
    for (const p of data.candidates || []) {
      if (idSet.has(p.patent_id)) {
        result.set(p.patent_id, p);
      }
    }
  }

  // Enrich with LLM analysis data
  const llmDir = path.join(process.cwd(), 'cache/llm-scores');
  if (fs.existsSync(llmDir)) {
    for (const pid of patentIds) {
      const llmPath = path.join(llmDir, `${pid}.json`);
      if (fs.existsSync(llmPath)) {
        try {
          const llmData = JSON.parse(fs.readFileSync(llmPath, 'utf-8'));
          const existing = result.get(pid) || { patent_id: pid };
          // Merge LLM fields into patent data
          result.set(pid, {
            ...existing,
            summary: llmData.summary,
            prior_art_problem: llmData.prior_art_problem,
            technical_solution: llmData.technical_solution,
            technology_category: llmData.technology_category,
            implementation_type: llmData.implementation_type,
            standards_relevance: llmData.standards_relevance,
            market_segment: llmData.market_segment,
            detection_method: llmData.detection_method,
            implementation_complexity: llmData.implementation_complexity,
            claim_type_primary: llmData.claim_type_primary,
            geographic_scope: llmData.geographic_scope,
            lifecycle_stage: llmData.lifecycle_stage,
            eligibility_score: llmData.eligibility_score,
            validity_score: llmData.validity_score,
            claim_breadth: llmData.claim_breadth,
            enforcement_clarity: llmData.enforcement_clarity,
            design_around_difficulty: llmData.design_around_difficulty,
            market_relevance_score: llmData.market_relevance_score,
            trend_alignment_score: llmData.trend_alignment_score,
            investigation_priority_score: llmData.investigation_priority_score,
            llm_confidence: llmData.confidence,
          });
        } catch {
          // skip invalid LLM files
        }
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Variable Substitution
// ─────────────────────────────────────────────────────────────────────────────

function getPatentFieldValue(patent: PatentData, field: string): string {
  const value = patent[field];
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

function getFocusAreaFieldValue(
  focusArea: { name: string; description?: string | null },
  field: string,
  patentIds: string[],
  patents: Map<string, PatentData>,
  contextFields: string[]
): string {
  switch (field) {
    case 'name':
      return focusArea.name;
    case 'description':
      return focusArea.description || '';
    case 'patentIDs':
      return patentIds.join(', ');
    case 'patentCount':
      return String(patentIds.length);
    case 'patentData': {
      const patentObjects = patentIds.map(pid => {
        const patent = patents.get(pid);
        if (!patent) return { patent_id: pid };
        if (contextFields.length === 0) return patent;
        const filtered: Record<string, unknown> = { patent_id: pid };
        for (const f of contextFields) {
          filtered[f] = patent[f];
        }
        return filtered;
      });
      return JSON.stringify(patentObjects, null, 2);
    }
    default:
      return '';
  }
}

/**
 * Substitute {patent.*} and {focusArea.*} placeholders in prompt text.
 */
export function substituteVariables(
  promptText: string,
  patent: PatentData | null,
  focusArea: { name: string; description?: string | null },
  patentIds: string[],
  patents: Map<string, PatentData>,
  contextFields: string[]
): string {
  let result = promptText;

  // Replace {patent.fieldName} placeholders
  result = result.replace(/\{patent\.(\w+)\}/g, (_match, field) => {
    if (!patent) return `{patent.${field}}`;
    return getPatentFieldValue(patent, field);
  });

  // Replace {focusArea.fieldName} placeholders
  result = result.replace(/\{focusArea\.(\w+)\}/g, (_match, field) => {
    return getFocusAreaFieldValue(focusArea, field, patentIds, patents, contextFields);
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result File I/O
// ─────────────────────────────────────────────────────────────────────────────

function getResultDir(focusAreaId: string, templateId: string): string {
  return path.join(CACHE_BASE_DIR, focusAreaId, templateId);
}

function getResultPath(focusAreaId: string, templateId: string, patentId: string | null): string {
  const dir = getResultDir(focusAreaId, templateId);
  const filename = patentId ? `${patentId}.json` : '_collective.json';
  return path.join(dir, filename);
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function saveResult(focusAreaId: string, templateId: string, result: PromptResult): void {
  const dir = getResultDir(focusAreaId, templateId);
  ensureDir(dir);
  const filePath = getResultPath(focusAreaId, templateId, result.patentId);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
}

export function loadResult(focusAreaId: string, templateId: string, patentId: string | null): PromptResult | null {
  const filePath = getResultPath(focusAreaId, templateId, patentId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function loadAllResults(focusAreaId: string, templateId: string): PromptResult[] {
  const dir = getResultDir(focusAreaId, templateId);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const results: PromptResult[] = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      results.push(data);
    } catch {
      // skip invalid files
    }
  }
  return results.sort((a, b) => {
    if (a.patentId && b.patentId) return a.patentId.localeCompare(b.patentId);
    return 0;
  });
}

export function deleteResults(focusAreaId: string, templateId: string): void {
  const dir = getResultDir(focusAreaId, templateId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM Execution
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callLlm(
  promptText: string,
  modelName: string
): Promise<{ response: Record<string, unknown> | null; rawText: string; inputTokens?: number; outputTokens?: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set in environment');
  }

  const model = new ChatAnthropic({
    apiKey,
    model: modelName,
    maxTokens: 4096,
    temperature: 0.3,
  });

  const messages = [
    new SystemMessage(SYSTEM_MESSAGE),
    new HumanMessage(promptText),
  ];

  const result = await model.invoke(messages);

  const rawText = typeof result.content === 'string'
    ? result.content
    : Array.isArray(result.content)
      ? result.content.map((c: { type: string; text?: string }) => c.type === 'text' ? c.text : '').join('')
      : String(result.content);

  // Try to parse as JSON
  let response: Record<string, unknown> | null = null;
  try {
    let jsonStr = rawText;
    if (jsonStr.includes('```json')) {
      jsonStr = jsonStr.split('```json')[1].split('```')[0].trim();
    } else if (jsonStr.includes('```')) {
      jsonStr = jsonStr.split('```')[1].split('```')[0].trim();
    }
    response = JSON.parse(jsonStr);
  } catch {
    // JSON parse failed, store as rawText only
  }

  const usage = result.usage_metadata;
  return {
    response,
    rawText,
    inputTokens: usage?.input_tokens,
    outputTokens: usage?.output_tokens,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a prompt template against focus area patents.
 * Runs in background — caller should not await this.
 */
export async function executeTemplate(templateId: string, focusAreaId: string): Promise<void> {
  try {
    // Load template
    const template = await prisma.promptTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) throw new Error(`Template ${templateId} not found`);

    // Load focus area
    const focusArea = await prisma.focusArea.findUnique({
      where: { id: focusAreaId },
    });
    if (!focusArea) throw new Error(`Focus area ${focusAreaId} not found`);

    // Load patent IDs
    const faPatents = await prisma.focusAreaPatent.findMany({
      where: { focusAreaId },
      select: { patentId: true },
    });
    const patentIds = faPatents.map(p => p.patentId);

    // Set status to RUNNING
    await prisma.promptTemplate.update({
      where: { id: templateId },
      data: {
        status: 'RUNNING',
        completedCount: 0,
        totalCount: template.executionMode === 'PER_PATENT' ? patentIds.length : 1,
        errorMessage: null,
      },
    });

    // Load enriched patent data
    const patents = loadEnrichedPatents(patentIds);

    if (template.executionMode === 'PER_PATENT') {
      // Per-patent execution
      let completed = 0;

      for (const pid of patentIds) {
        const patent = patents.get(pid) || { patent_id: pid };
        const resolvedPrompt = substituteVariables(
          template.promptText,
          patent,
          focusArea,
          patentIds,
          patents,
          template.contextFields
        );

        try {
          const llmResult = await callLlm(resolvedPrompt, template.llmModel);

          const promptResult: PromptResult = {
            templateId,
            patentId: pid,
            model: template.llmModel,
            promptSent: resolvedPrompt,
            response: llmResult.response,
            rawText: llmResult.response ? undefined : llmResult.rawText,
            inputTokens: llmResult.inputTokens,
            outputTokens: llmResult.outputTokens,
            executedAt: new Date().toISOString(),
          };

          saveResult(focusAreaId, templateId, promptResult);
        } catch (err) {
          // Save error result for this patent
          const promptResult: PromptResult = {
            templateId,
            patentId: pid,
            model: template.llmModel,
            promptSent: resolvedPrompt,
            response: null,
            rawText: `Error: ${err instanceof Error ? err.message : String(err)}`,
            executedAt: new Date().toISOString(),
          };
          saveResult(focusAreaId, templateId, promptResult);
        }

        completed++;
        await prisma.promptTemplate.update({
          where: { id: templateId },
          data: { completedCount: completed },
        });

        // Rate limit between calls
        if (completed < patentIds.length) {
          await sleep(RATE_LIMIT_MS);
        }
      }
    } else {
      // Collective execution
      const resolvedPrompt = substituteVariables(
        template.promptText,
        null,
        focusArea,
        patentIds,
        patents,
        template.contextFields
      );

      try {
        const llmResult = await callLlm(resolvedPrompt, template.llmModel);

        const promptResult: PromptResult = {
          templateId,
          patentId: null,
          model: template.llmModel,
          promptSent: resolvedPrompt,
          response: llmResult.response,
          rawText: llmResult.response ? undefined : llmResult.rawText,
          inputTokens: llmResult.inputTokens,
          outputTokens: llmResult.outputTokens,
          executedAt: new Date().toISOString(),
        };

        saveResult(focusAreaId, templateId, promptResult);
      } catch (err) {
        const promptResult: PromptResult = {
          templateId,
          patentId: null,
          model: template.llmModel,
          promptSent: resolvedPrompt,
          response: null,
          rawText: `Error: ${err instanceof Error ? err.message : String(err)}`,
          executedAt: new Date().toISOString(),
        };
        saveResult(focusAreaId, templateId, promptResult);
      }

      await prisma.promptTemplate.update({
        where: { id: templateId },
        data: { completedCount: 1 },
      });
    }

    // Mark complete
    await prisma.promptTemplate.update({
      where: { id: templateId },
      data: {
        status: 'COMPLETE',
        lastRunAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[PromptTemplate] Execution error for template ${templateId}:`, err);
    try {
      await prisma.promptTemplate.update({
        where: { id: templateId },
        data: {
          status: 'ERROR',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // DB update failed — nothing more we can do
    }
  }
}

/**
 * Preview a resolved prompt for a single patent without calling the LLM.
 */
export function previewTemplate(
  promptText: string,
  executionMode: string,
  contextFields: string[],
  focusArea: { name: string; description?: string | null },
  patentIds: string[],
  previewPatentId?: string
): string {
  const patents = loadEnrichedPatents(patentIds);

  if (executionMode === 'PER_PATENT') {
    const pid = previewPatentId || patentIds[0];
    if (!pid) return promptText;
    const patent = patents.get(pid) || { patent_id: pid };
    return substituteVariables(promptText, patent, focusArea, patentIds, patents, contextFields);
  } else {
    return substituteVariables(promptText, null, focusArea, patentIds, patents, contextFields);
  }
}
