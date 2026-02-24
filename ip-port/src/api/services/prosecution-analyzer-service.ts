/**
 * Prosecution Analyzer Service
 *
 * LLM-powered analysis of office action documents and applicant responses.
 * Follows llm-scoring-service.ts patterns: Anthropic SDK, retry for 429/529,
 * configurable concurrency, token tracking.
 *
 * Two LLM analysis prompts:
 *   1. Office Action Analysis: Extract rejected claims, statutory basis, cited prior art
 *   2. Applicant Response Analysis: Extract amendments, estoppel risk, arguments
 *
 * Cache: cache/prosecution-analysis/{patentId}.json
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ProsecutionTimelineData,
  OfficeActionAnalysis,
  ApplicantResponseAnalysis,
  ClaimRejection,
  PriorArtReference,
  ClaimAmendment,
  EstoppelArgument,
  SurvivedBasis,
} from '../../../types/office-action-types.js';
import type { ProsecutionDocument } from './prosecution-document-service.js';
import {
  CachedOARejectionClient,
  createCachedOARejectionClient,
} from '../../../clients/cached-clients.js';

const anthropic = new Anthropic();

const PROSECUTION_ANALYSIS_CACHE_DIR = path.join(process.cwd(), 'cache/prosecution-analysis');

// Default model for prosecution analysis
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export interface ProsecutionAnalyzerOptions {
  model?: string;
  concurrency?: number;       // Max parallel LLM calls (default 3)
  skipExisting?: boolean;     // Skip if cached (default true)
}

/**
 * Analyze prosecution documents for a single patent.
 * Returns structured timeline data with claim-level detail.
 */
export async function analyzeProsecutionForPatent(
  patentId: string,
  applicationNumber: string,
  officeActions: ProsecutionDocument[],
  applicantResponses: ProsecutionDocument[],
  options: ProsecutionAnalyzerOptions = {}
): Promise<ProsecutionTimelineData> {
  const { model = DEFAULT_MODEL, skipExisting = true } = options;

  // Check cache
  const cachePath = path.join(PROSECUTION_ANALYSIS_CACHE_DIR, `${patentId}.json`);
  if (skipExisting && fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return cached as ProsecutionTimelineData;
    } catch {
      // Corrupted cache — re-analyze
    }
  }

  // 1. Try structured API data first (no LLM needed for rejections)
  const rejectionClient = createCachedOARejectionClient();
  let structuredRejections: OfficeActionAnalysis[] = [];

  try {
    const rejResp = await rejectionClient.getRejections(applicationNumber);
    if (rejResp.totalRecords > 0) {
      structuredRejections = mapApiRejectionsToAnalysis(rejResp.rejections);
    }
  } catch {
    // API not available — will rely on LLM analysis
  }

  // 2. LLM analysis of office action text
  const llmOAAnalyses: OfficeActionAnalysis[] = [];
  for (const oa of officeActions) {
    if (oa.text && oa.text.length > 100) {
      try {
        const analysis = await analyzeOfficeAction(oa, model);
        llmOAAnalyses.push(analysis);
      } catch (err: any) {
        console.error(`[ProsAnalyzer] Failed to analyze OA for ${patentId} (${oa.documentDate}):`, err.message);
      }
    }
  }

  // 3. LLM analysis of applicant responses
  const responseAnalyses: ApplicantResponseAnalysis[] = [];
  for (const resp of applicantResponses) {
    if (resp.text && resp.text.length > 100) {
      try {
        const analysis = await analyzeApplicantResponse(resp, model);
        responseAnalyses.push(analysis);
      } catch (err: any) {
        console.error(`[ProsAnalyzer] Failed to analyze response for ${patentId} (${resp.documentDate}):`, err.message);
      }
    }
  }

  // 4. Merge structured + LLM analyses (prefer structured where available)
  const mergedOAs = mergeOfficeActionAnalyses(structuredRejections, llmOAAnalyses);

  // 5. Derive aggregate fields
  const allCitedArt = deriveCitedPriorArt(mergedOAs);
  const allNarrowed = deriveNarrowedClaims(responseAnalyses);
  const allEstoppel = deriveEstoppelArguments(responseAnalyses);
  const survivedBases = deriveSurvivedBases(mergedOAs, responseAnalyses);

  // 6. Calculate prosecution score (1-5)
  const totalRejections = mergedOAs.filter(oa =>
    oa.actionType === 'non-final' || oa.actionType === 'final'
  ).length;
  const totalRCEs = responseAnalyses.filter(r => r.responseType === 'rce').length;
  const prosecutionScore = calculateProsecutionScore(totalRejections, totalRCEs, allEstoppel.length);

  const dataSources = new Set<'api_structured' | 'api_text_llm' | 'pdf_llm'>();
  if (structuredRejections.length > 0) dataSources.add('api_structured');
  for (const oa of officeActions) {
    if (oa.source === 'api_text') dataSources.add('api_text_llm');
    if (oa.source === 'pdf_pdftotext') dataSources.add('pdf_llm');
  }

  const timeline: ProsecutionTimelineData = {
    patentId,
    applicationNumber,
    totalActions: mergedOAs.length,
    totalRejections,
    totalRCEs,
    timeToGrantMonths: null, // Populated by caller from file wrapper data
    prosecutionScore,
    officeActions: mergedOAs,
    responses: responseAnalyses,
    citedPriorArt: allCitedArt,
    narrowedClaims: allNarrowed,
    estoppelArguments: allEstoppel,
    survivedBases,
    analyzedAt: new Date().toISOString(),
    llmModel: model,
    documentCount: officeActions.length + applicantResponses.length,
    dataSources: Array.from(dataSources),
  };

  // Save to cache
  fs.mkdirSync(PROSECUTION_ANALYSIS_CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(timeline, null, 2));

  return timeline;
}

// ============================================================================
// LLM Analysis Prompts
// ============================================================================

const OFFICE_ACTION_SYSTEM_PROMPT = `You are an expert patent prosecution analyst. Analyze the following office action text and extract structured data about rejections. Return a JSON object with the following structure:

{
  "actionType": "non-final" | "final" | "advisory" | "other",
  "claimRejections": [
    {
      "claimNumber": <number>,
      "isIndependent": <boolean>,
      "statutoryBasis": "101" | "102" | "103" | "112" | "double-patenting" | "other",
      "rejectionType": "<string describing type>",
      "citedReferences": ["<reference designations>"],
      "limitationsAddressed": ["<specific claim limitations>"]
    }
  ],
  "citedPriorArt": [
    {
      "designation": "<patent number or NPL citation>",
      "referenceType": "us-patent" | "us-publication" | "foreign-patent" | "npl",
      "title": "<if available>",
      "date": "<if available>",
      "relevantClaims": [<claim numbers>],
      "citationPurpose": "primary" | "secondary" | "teaching",
      "relevanceDescription": "<brief description of what this reference teaches>"
    }
  ],
  "examinerReasoning": "<summary of examiner's key reasoning>",
  "keyArguments": ["<key arguments made by examiner>"]
}

Be precise about claim numbers, statutory bases, and cited references. If information is unclear, omit it rather than guessing.`;

const APPLICANT_RESPONSE_SYSTEM_PROMPT = `You are an expert patent prosecution analyst. Analyze the following applicant response/amendment and extract structured data. Return a JSON object with the following structure:

{
  "responseType": "amendment" | "rce" | "after-final" | "appeal-brief" | "other",
  "claimAmendments": [
    {
      "claimNumber": <number>,
      "amendmentType": "narrowed" | "broadened" | "cancelled" | "new" | "rewritten",
      "narrowingDescription": "<what narrowing was done>",
      "addressedRejection": "<which statutory basis this addresses>"
    }
  ],
  "arguments": ["<key arguments presented>"],
  "estoppelRisk": {
    "level": "HIGH" | "MEDIUM" | "LOW" | "NONE",
    "estoppelArguments": [
      {
        "claimNumber": <number>,
        "argumentType": "narrowing-amendment" | "distinguishing-argument" | "disclaimer" | "admission",
        "description": "<what was said or done>",
        "scopeImpact": "<how this affects claim scope>",
        "severity": "HIGH" | "MEDIUM" | "LOW"
      }
    ],
    "summary": "<brief summary of estoppel risk>"
  }
}

Focus on identifying prosecution estoppel risks: narrowing amendments, distinguishing arguments, and admissions that could limit claim scope in litigation. A narrowing amendment that adds a specific limitation creates HIGH estoppel risk. An argument distinguishing prior art creates MEDIUM risk. Simply arguing the examiner misread the claims is LOW risk.`;

async function analyzeOfficeAction(
  doc: ProsecutionDocument,
  model: string
): Promise<OfficeActionAnalysis> {
  const truncatedText = doc.text.slice(0, 15000); // Limit context size

  const response = await callLlmWithRetry(model, OFFICE_ACTION_SYSTEM_PROMPT,
    `Analyze this office action from ${doc.documentDate} (${doc.documentCode}):\n\n${truncatedText}`
  );

  const parsed = parseJsonResponse(response);

  return {
    mailDate: doc.documentDate,
    documentCode: doc.documentCode,
    actionType: parsed.actionType || 'other',
    claimRejections: (parsed.claimRejections || []).map((r: any): ClaimRejection => ({
      claimNumber: r.claimNumber || 0,
      isIndependent: r.isIndependent ?? false,
      statutoryBasis: r.statutoryBasis || 'other',
      rejectionType: r.rejectionType || '',
      citedReferences: r.citedReferences || [],
      limitationsAddressed: r.limitationsAddressed,
      wasOvercome: undefined,
    })),
    citedPriorArt: (parsed.citedPriorArt || []).map((r: any): PriorArtReference => ({
      designation: r.designation || '',
      referenceType: r.referenceType || 'us-patent',
      title: r.title,
      date: r.date,
      relevantClaims: r.relevantClaims || [],
      citationPurpose: r.citationPurpose || 'primary',
      relevanceDescription: r.relevanceDescription,
    })),
    examinerReasoning: parsed.examinerReasoning || '',
    keyArguments: parsed.keyArguments || [],
    analysisSource: doc.source === 'api_text' ? 'api_text_llm' : 'pdf_llm',
  };
}

async function analyzeApplicantResponse(
  doc: ProsecutionDocument,
  model: string
): Promise<ApplicantResponseAnalysis> {
  const truncatedText = doc.text.slice(0, 15000);

  const response = await callLlmWithRetry(model, APPLICANT_RESPONSE_SYSTEM_PROMPT,
    `Analyze this applicant response from ${doc.documentDate} (${doc.documentCode}):\n\n${truncatedText}`
  );

  const parsed = parseJsonResponse(response);

  return {
    filingDate: doc.documentDate,
    responseType: parsed.responseType || 'other',
    claimAmendments: (parsed.claimAmendments || []).map((a: any): ClaimAmendment => ({
      claimNumber: a.claimNumber || 0,
      amendmentType: a.amendmentType || 'narrowed',
      narrowingDescription: a.narrowingDescription,
      addressedRejection: a.addressedRejection,
    })),
    arguments: parsed.arguments || [],
    estoppelRisk: {
      level: parsed.estoppelRisk?.level || 'NONE',
      estoppelArguments: (parsed.estoppelRisk?.estoppelArguments || []).map((e: any): EstoppelArgument => ({
        claimNumber: e.claimNumber || 0,
        argumentType: e.argumentType || 'narrowing-amendment',
        description: e.description || '',
        scopeImpact: e.scopeImpact || '',
        severity: e.severity || 'LOW',
      })),
      summary: parsed.estoppelRisk?.summary || '',
    },
  };
}

// ============================================================================
// LLM Calling with Retry
// ============================================================================

async function callLlmWithRetry(
  model: string,
  systemPrompt: string,
  userMessage: string,
  maxRetries: number = 3,
): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock?.text || '';
    } catch (err: any) {
      const status = err?.status || err?.statusCode;
      if ((status === 429 || status === 529) && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.warn(`[ProsAnalyzer] Rate limited (${status}), retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  return '';
}

function parseJsonResponse(text: string): any {
  // Extract JSON from possible markdown code blocks
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      // Fall through
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    console.warn('[ProsAnalyzer] Failed to parse LLM JSON response');
    return {};
  }
}

// ============================================================================
// Merging & Derivation
// ============================================================================

function mapApiRejectionsToAnalysis(rejections: any[]): OfficeActionAnalysis[] {
  // Group rejections by mail date + document code
  const groups = new Map<string, any[]>();
  for (const r of rejections) {
    const key = `${r.mailDate}-${r.documentCode}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return Array.from(groups.entries()).map(([key, rejs]) => {
    const [mailDate, documentCode] = key.split('-', 2);
    return {
      mailDate: mailDate || '',
      documentCode: documentCode || '',
      actionType: (documentCode === 'CTFR' ? 'final' : 'non-final') as any,
      claimRejections: rejs.map((r: any): ClaimRejection => ({
        claimNumber: r.claimNumbers?.[0] || 0,
        isIndependent: false,
        statutoryBasis: mapStatutoryBasis(r.statutoryBasis),
        rejectionType: r.rejectionType || '',
        citedReferences: (r.citedReferences || []).map((c: any) => c.referenceDesignation || c.referenceNumber || ''),
      })),
      citedPriorArt: rejs.flatMap((r: any) =>
        (r.citedReferences || []).map((c: any): PriorArtReference => ({
          designation: c.referenceDesignation || c.referenceNumber || '',
          referenceType: mapReferenceType(c.referenceType),
          relevantClaims: r.claimNumbers || [],
          citationPurpose: 'primary',
        }))
      ),
      examinerReasoning: '',
      keyArguments: [],
      analysisSource: 'api_structured' as const,
    };
  });
}

function mergeOfficeActionAnalyses(
  structured: OfficeActionAnalysis[],
  llm: OfficeActionAnalysis[]
): OfficeActionAnalysis[] {
  // Prefer structured where available (by date), augment with LLM for reasoning
  const byDate = new Map<string, OfficeActionAnalysis>();
  for (const oa of structured) {
    byDate.set(oa.mailDate, oa);
  }
  for (const oa of llm) {
    const existing = byDate.get(oa.mailDate);
    if (existing) {
      // Augment structured with LLM reasoning
      existing.examinerReasoning = oa.examinerReasoning || existing.examinerReasoning;
      existing.keyArguments = oa.keyArguments.length > 0 ? oa.keyArguments : existing.keyArguments;
      // Use LLM citedPriorArt if it has relevanceDescription
      if (oa.citedPriorArt.some(p => p.relevanceDescription)) {
        existing.citedPriorArt = oa.citedPriorArt;
      }
    } else {
      byDate.set(oa.mailDate, oa);
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.mailDate.localeCompare(b.mailDate));
}

function deriveCitedPriorArt(oas: OfficeActionAnalysis[]): PriorArtReference[] {
  const byDesignation = new Map<string, PriorArtReference>();
  for (const oa of oas) {
    for (const art of oa.citedPriorArt) {
      const existing = byDesignation.get(art.designation);
      if (existing) {
        // Merge relevant claims
        const claimSet = new Set([...existing.relevantClaims, ...art.relevantClaims]);
        existing.relevantClaims = Array.from(claimSet).sort((a, b) => a - b);
        if (!existing.relevanceDescription && art.relevanceDescription) {
          existing.relevanceDescription = art.relevanceDescription;
        }
      } else {
        byDesignation.set(art.designation, { ...art });
      }
    }
  }
  return Array.from(byDesignation.values());
}

function deriveNarrowedClaims(responses: ApplicantResponseAnalysis[]): ClaimAmendment[] {
  return responses.flatMap(r =>
    r.claimAmendments.filter(a => a.amendmentType === 'narrowed')
  );
}

function deriveEstoppelArguments(responses: ApplicantResponseAnalysis[]): EstoppelArgument[] {
  return responses.flatMap(r => r.estoppelRisk.estoppelArguments);
}

function deriveSurvivedBases(
  oas: OfficeActionAnalysis[],
  responses: ApplicantResponseAnalysis[]
): SurvivedBasis[] {
  // Find rejection bases that were addressed by amendments
  const bases = new Set<string>();
  for (const oa of oas) {
    for (const rej of oa.claimRejections) {
      bases.add(rej.statutoryBasis);
    }
  }

  const survived: SurvivedBasis[] = [];
  for (const basis of bases) {
    const addressingAmendments = responses.flatMap(r =>
      r.claimAmendments.filter(a => a.addressedRejection === basis)
    );
    if (addressingAmendments.length > 0) {
      survived.push({
        statutoryBasis: basis,
        claimNumbers: addressingAmendments.map(a => a.claimNumber),
        howOvercome: 'amendment',
        description: `Overcome via ${addressingAmendments.length} amendment(s)`,
      });
    }
  }

  return survived;
}

function calculateProsecutionScore(
  totalRejections: number,
  totalRCEs: number,
  estoppelCount: number
): number {
  // 5 = clean prosecution, 1 = difficult
  let score = 5;
  if (totalRejections >= 1) score -= 0.5;
  if (totalRejections >= 2) score -= 0.5;
  if (totalRejections >= 3) score -= 0.5;
  if (totalRejections >= 5) score -= 0.5;
  if (totalRCEs >= 1) score -= 0.5;
  if (totalRCEs >= 2) score -= 0.5;
  if (estoppelCount >= 1) score -= 0.5;
  if (estoppelCount >= 3) score -= 0.5;
  return Math.max(1, Math.min(5, Math.round(score)));
}

function mapStatutoryBasis(basis: string): ClaimRejection['statutoryBasis'] {
  if (!basis) return 'other';
  if (basis.includes('101')) return '101';
  if (basis.includes('102')) return '102';
  if (basis.includes('103')) return '103';
  if (basis.includes('112')) return '112';
  if (basis.toLowerCase().includes('double')) return 'double-patenting';
  return 'other';
}

function mapReferenceType(type: string): PriorArtReference['referenceType'] {
  if (!type) return 'us-patent';
  const lower = type.toLowerCase();
  if (lower.includes('us') && lower.includes('pub')) return 'us-publication';
  if (lower.includes('foreign')) return 'foreign-patent';
  if (lower.includes('npl') || lower.includes('non-patent')) return 'npl';
  return 'us-patent';
}

/**
 * Load cached prosecution analysis for a patent.
 */
export function loadCachedAnalysis(patentId: string): ProsecutionTimelineData | null {
  const cachePath = path.join(PROSECUTION_ANALYSIS_CACHE_DIR, `${patentId}.json`);
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
  } catch {
    return null;
  }
}
