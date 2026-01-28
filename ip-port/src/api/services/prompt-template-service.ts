/**
 * Prompt Template Service
 *
 * Handles template variable substitution and LLM execution for
 * both free-form and structured (typed question) prompt templates.
 * Templates are object-type-agnostic — they bind to patents, focus areas,
 * or future object types via placeholder substitution.
 */

import { PrismaClient } from '@prisma/client';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const CACHE_BASE_DIR = path.join(process.cwd(), 'cache/focus-area-prompts');
const RATE_LIMIT_MS = 2000;

export const SYSTEM_MESSAGE_FREE_FORM = `You are a patent analysis assistant. Analyze the provided information and respond with valid JSON. If you cannot produce valid JSON, respond with your analysis as plain text.`;

export const SYSTEM_MESSAGE_STRUCTURED = `You are a patent analysis assistant. You will be given a set of questions about patent information. Answer each question precisely in the requested format. Return ONLY valid JSON matching the exact schema specified. Do not include markdown formatting or explanation outside the JSON.`;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single question in a structured prompt template
 */
export interface StructuredQuestion {
  fieldName: string;
  question: string;
  answerType: 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'TEXT' | 'ENUM' | 'TEXT_ARRAY';
  constraints?: {
    min?: number;
    max?: number;
    maxSentences?: number;
    maxItems?: number;
    options?: string[];
  };
  description?: string;
}

/**
 * Result file structure stored on disk
 */
export interface PromptResult {
  templateId: string;
  templateType: 'FREE_FORM' | 'STRUCTURED';
  patentId: string | null;
  model: string;
  promptSent: string;
  response: Record<string, unknown> | null;
  /** Typed fields extracted from structured response */
  fields?: Record<string, unknown>;
  rawText?: string;
  inputTokens?: number;
  outputTokens?: number;
  executedAt: string;
}

// Available fields per object type for variable substitution
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

// Default delimiters (avoids conflicts with JSON braces and code)
export const DEFAULT_DELIMITER_START = '<<';
export const DEFAULT_DELIMITER_END = '>>';

export interface FieldInfo {
  field: string;
  placeholder: string;
  description: string;
}

export function getFieldsForObjectType(
  objectType: string,
  delimiterStart = DEFAULT_DELIMITER_START,
  delimiterEnd = DEFAULT_DELIMITER_END
): FieldInfo[] {
  const fields: FieldInfo[] = [];

  // Patent fields
  for (const f of PATENT_FIELDS) {
    fields.push({
      field: f,
      placeholder: `${delimiterStart}patent.${f}${delimiterEnd}`,
      description: `Patent ${f.replace(/_/g, ' ')}`
    });
  }

  // Focus area fields (for collective mode)
  for (const f of FOCUS_AREA_FIELDS) {
    fields.push({
      field: f,
      placeholder: `${delimiterStart}focusArea.${f}${delimiterEnd}`,
      description: `Focus area ${f}`
    });
  }

  return fields;
}

export { PATENT_FIELDS, FOCUS_AREA_FIELDS };

// ─────────────────────────────────────────────────────────────────────────────
// Structured Question → Prompt Assembly
// ─────────────────────────────────────────────────────────────────────────────

function formatAnswerTypeInstruction(q: StructuredQuestion): string {
  switch (q.answerType) {
    case 'INTEGER': {
      const range = q.constraints?.min !== undefined && q.constraints?.max !== undefined
        ? ` (${q.constraints.min}-${q.constraints.max})`
        : '';
      return `integer${range}`;
    }
    case 'FLOAT': {
      const range = q.constraints?.min !== undefined && q.constraints?.max !== undefined
        ? ` (${q.constraints.min}-${q.constraints.max})`
        : '';
      return `number${range}`;
    }
    case 'BOOLEAN':
      return 'boolean (true/false)';
    case 'TEXT': {
      const limit = q.constraints?.maxSentences
        ? ` (max ${q.constraints.maxSentences} sentences)`
        : '';
      return `string${limit}`;
    }
    case 'ENUM': {
      const opts = q.constraints?.options?.map(o => `"${o}"`).join(', ') || '';
      return `one of: [${opts}]`;
    }
    case 'TEXT_ARRAY': {
      const limit = q.constraints?.maxItems ? ` (max ${q.constraints.maxItems} items)` : '';
      return `array of strings${limit}`;
    }
    default:
      return 'string';
  }
}

function formatJsonType(q: StructuredQuestion): string {
  switch (q.answerType) {
    case 'INTEGER':
    case 'FLOAT':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    case 'TEXT':
    case 'ENUM':
      return '"string"';
    case 'TEXT_ARRAY':
      return '["string"]';
    default:
      return '"string"';
  }
}

/**
 * Build an LLM prompt from structured questions and input data.
 * Substitutes placeholders in each question's text and assembles
 * a prompt that instructs the LLM to return typed JSON.
 */
export function buildStructuredPrompt(
  questions: StructuredQuestion[],
  patent: PatentData | null,
  focusArea: { name: string; description?: string | null } | null,
  patentIds: string[],
  patents: Map<string, PatentData>,
  contextFields: string[],
  delimiterStart = DEFAULT_DELIMITER_START,
  delimiterEnd = DEFAULT_DELIMITER_END
): string {
  const lines: string[] = [];

  // Provide context data
  if (patent) {
    lines.push('Analyze the following patent:\n');
    lines.push(`Patent ID: ${patent.patent_id}`);
    if (patent.patent_title) lines.push(`Title: ${patent.patent_title}`);
    if (patent.abstract) lines.push(`Abstract: ${patent.abstract}`);
    if (patent.patent_date) lines.push(`Grant Date: ${patent.patent_date}`);
    if (patent.cpc_codes) {
      const codes = Array.isArray(patent.cpc_codes) ? patent.cpc_codes.join(', ') : patent.cpc_codes;
      lines.push(`CPC Codes: ${codes}`);
    }
    lines.push('');
  }

  lines.push('Answer each of the following questions:\n');

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    // Substitute any placeholders in the question text using configured delimiters
    const questionText = substituteVariables(
      q.question,
      patent,
      focusArea,
      patentIds,
      patents,
      contextFields,
      delimiterStart,
      delimiterEnd
    );

    const typeStr = formatAnswerTypeInstruction(q);
    const desc = q.description ? ` — ${q.description}` : '';
    lines.push(`${i + 1}. "${q.fieldName}" (${typeStr}): ${questionText}${desc}`);
  }

  // JSON schema instruction
  lines.push('\nReturn ONLY valid JSON in this exact format:');
  lines.push('{');
  for (const q of questions) {
    lines.push(`  "${q.fieldName}": ${formatJsonType(q)},`);
  }
  lines.push('}');

  return lines.join('\n');
}

/**
 * Parse and validate typed fields from an LLM JSON response against the question schema.
 */
export function parseStructuredResponse(
  response: Record<string, unknown>,
  questions: StructuredQuestion[]
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const q of questions) {
    const raw = response[q.fieldName];
    if (raw === undefined || raw === null) {
      fields[q.fieldName] = null;
      continue;
    }

    switch (q.answerType) {
      case 'INTEGER': {
        const n = typeof raw === 'number' ? Math.round(raw) : parseInt(String(raw));
        if (!isNaN(n)) {
          const clamped = q.constraints?.min !== undefined && q.constraints?.max !== undefined
            ? Math.max(q.constraints.min, Math.min(q.constraints.max, n))
            : n;
          fields[q.fieldName] = clamped;
        } else {
          fields[q.fieldName] = null;
        }
        break;
      }
      case 'FLOAT': {
        const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
        fields[q.fieldName] = isNaN(n) ? null : n;
        break;
      }
      case 'BOOLEAN':
        fields[q.fieldName] = typeof raw === 'boolean' ? raw : raw === 'true';
        break;
      case 'TEXT':
      case 'ENUM':
        fields[q.fieldName] = String(raw);
        break;
      case 'TEXT_ARRAY':
        fields[q.fieldName] = Array.isArray(raw) ? raw.map(String) : [String(raw)];
        break;
      default:
        fields[q.fieldName] = raw;
    }
  }

  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patent Data Loading
// ─────────────────────────────────────────────────────────────────────────────

export interface PatentData {
  patent_id: string;
  [key: string]: unknown;
}

/**
 * Load enriched patent data from the candidates file and LLM cache.
 */
export function loadEnrichedPatents(patentIds: string[]): Map<string, PatentData> {
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
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Substitute <<patent.*>> and <<focusArea.*>> placeholders in prompt text.
 * Delimiters are configurable to avoid collisions with JSON or code in prompts.
 */
export function substituteVariables(
  promptText: string,
  patent: PatentData | null,
  focusArea: { name: string; description?: string | null } | null,
  patentIds: string[],
  patents: Map<string, PatentData>,
  contextFields: string[],
  delimiterStart = DEFAULT_DELIMITER_START,
  delimiterEnd = DEFAULT_DELIMITER_END
): string {
  let result = promptText;

  const startEsc = escapeRegex(delimiterStart);
  const endEsc = escapeRegex(delimiterEnd);

  const patentPattern = new RegExp(`${startEsc}patent\\.(\\w+)${endEsc}`, 'g');
  result = result.replace(patentPattern, (_match, field) => {
    if (!patent) return `${delimiterStart}patent.${field}${delimiterEnd}`;
    return getPatentFieldValue(patent, field);
  });

  const focusAreaPattern = new RegExp(`${startEsc}focusArea\\.(\\w+)${endEsc}`, 'g');
  result = result.replace(focusAreaPattern, (_match, field) => {
    if (!focusArea) return `${delimiterStart}focusArea.${field}${delimiterEnd}`;
    return getFocusAreaFieldValue(focusArea, field, patentIds, patents, contextFields);
  });

  return result;
}

/**
 * Build the final prompt text for a template, handling both free-form and structured modes.
 */
export function buildPromptForTemplate(
  template: {
    templateType: string;
    promptText: string | null;
    questions: unknown;
    delimiterStart?: string;
    delimiterEnd?: string;
  },
  patent: PatentData | null,
  focusArea: { name: string; description?: string | null } | null,
  patentIds: string[],
  patents: Map<string, PatentData>,
  contextFields: string[]
): string {
  const delimStart = template.delimiterStart || DEFAULT_DELIMITER_START;
  const delimEnd = template.delimiterEnd || DEFAULT_DELIMITER_END;

  if (template.templateType === 'STRUCTURED' && template.questions) {
    const questions = template.questions as StructuredQuestion[];
    return buildStructuredPrompt(questions, patent, focusArea, patentIds, patents, contextFields, delimStart, delimEnd);
  }

  // Free-form mode
  return substituteVariables(
    template.promptText || '',
    patent,
    focusArea,
    patentIds,
    patents,
    contextFields,
    delimStart,
    delimEnd
  );
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

export async function callLlm(
  promptText: string,
  modelName: string,
  systemMessage: string
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
    new SystemMessage(systemMessage),
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
    const template = await prisma.promptTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) throw new Error(`Template ${templateId} not found`);

    const focusArea = await prisma.focusArea.findUnique({
      where: { id: focusAreaId },
    });
    if (!focusArea) throw new Error(`Focus area ${focusAreaId} not found`);

    const faPatents = await prisma.focusAreaPatent.findMany({
      where: { focusAreaId },
      select: { patentId: true },
    });
    const patentIds = faPatents.map(p => p.patentId);

    const isStructured = template.templateType === 'STRUCTURED';
    const questions = isStructured ? (template.questions as StructuredQuestion[] || []) : [];
    const systemMsg = isStructured ? SYSTEM_MESSAGE_STRUCTURED : SYSTEM_MESSAGE_FREE_FORM;

    await prisma.promptTemplate.update({
      where: { id: templateId },
      data: {
        status: 'RUNNING',
        completedCount: 0,
        totalCount: template.executionMode === 'PER_PATENT' ? patentIds.length : 1,
        errorMessage: null,
      },
    });

    const patents = loadEnrichedPatents(patentIds);

    if (template.executionMode === 'PER_PATENT') {
      let completed = 0;

      for (const pid of patentIds) {
        const patent = patents.get(pid) || { patent_id: pid };
        const resolvedPrompt = buildPromptForTemplate(
          {
            ...template,
            delimiterStart: template.delimiterStart,
            delimiterEnd: template.delimiterEnd
          },
          patent, focusArea, patentIds, patents, template.contextFields
        );

        try {
          const llmResult = await callLlm(resolvedPrompt, template.llmModel, systemMsg);

          // For structured templates, parse typed fields
          let fields: Record<string, unknown> | undefined;
          if (isStructured && llmResult.response && questions.length > 0) {
            fields = parseStructuredResponse(llmResult.response, questions);
          }

          const promptResult: PromptResult = {
            templateId,
            templateType: template.templateType as 'FREE_FORM' | 'STRUCTURED',
            patentId: pid,
            model: template.llmModel,
            promptSent: resolvedPrompt,
            response: llmResult.response,
            fields,
            rawText: llmResult.response ? undefined : llmResult.rawText,
            inputTokens: llmResult.inputTokens,
            outputTokens: llmResult.outputTokens,
            executedAt: new Date().toISOString(),
          };

          saveResult(focusAreaId, templateId, promptResult);
        } catch (err) {
          const promptResult: PromptResult = {
            templateId,
            templateType: template.templateType as 'FREE_FORM' | 'STRUCTURED',
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

        if (completed < patentIds.length) {
          await sleep(RATE_LIMIT_MS);
        }
      }
    } else {
      // Collective execution
      const resolvedPrompt = buildPromptForTemplate(
        {
          ...template,
          delimiterStart: template.delimiterStart,
          delimiterEnd: template.delimiterEnd
        },
        null, focusArea, patentIds, patents, template.contextFields
      );

      try {
        const llmResult = await callLlm(resolvedPrompt, template.llmModel, systemMsg);

        let fields: Record<string, unknown> | undefined;
        if (isStructured && llmResult.response && questions.length > 0) {
          fields = parseStructuredResponse(llmResult.response, questions);
        }

        const promptResult: PromptResult = {
          templateId,
          templateType: template.templateType as 'FREE_FORM' | 'STRUCTURED',
          patentId: null,
          model: template.llmModel,
          promptSent: resolvedPrompt,
          response: llmResult.response,
          fields,
          rawText: llmResult.response ? undefined : llmResult.rawText,
          inputTokens: llmResult.inputTokens,
          outputTokens: llmResult.outputTokens,
          executedAt: new Date().toISOString(),
        };

        saveResult(focusAreaId, templateId, promptResult);
      } catch (err) {
        const promptResult: PromptResult = {
          templateId,
          templateType: template.templateType as 'FREE_FORM' | 'STRUCTURED',
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
      // DB update failed
    }
  }
}

/**
 * Preview a resolved prompt for a single patent without calling the LLM.
 */
export function previewTemplate(
  template: {
    templateType: string;
    promptText: string | null;
    questions: unknown;
    delimiterStart?: string;
    delimiterEnd?: string;
  },
  executionMode: string,
  contextFields: string[],
  focusArea: { name: string; description?: string | null } | null,
  patentIds: string[],
  previewPatentId?: string
): string {
  const patents = loadEnrichedPatents(patentIds);

  if (executionMode === 'PER_PATENT') {
    const pid = previewPatentId || patentIds[0];
    if (!pid) return template.promptText || '';
    const patent = patents.get(pid) || { patent_id: pid };
    return buildPromptForTemplate(template, patent, focusArea, patentIds, patents, contextFields);
  } else {
    return buildPromptForTemplate(template, null, focusArea, patentIds, patents, contextFields);
  }
}
