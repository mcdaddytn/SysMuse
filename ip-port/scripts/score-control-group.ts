/**
 * V3 Infringement Scoring — Control Group Calibration
 *
 * Runs the 10-component template-based infringement scoring against the
 * calibration control group (same docs Patlytics scored).
 *
 * Key changes from v2:
 * - 10 weighted component questions on 1-5 scale (not binary YES/PARTIAL/NO)
 * - Template inheritance: default → super-sector (terminology, guidance)
 * - Full LLM I/O capture for auditing
 * - Per-component correlation analysis vs Patlytics
 * - Two-pass blending: 0.3 × pass1 + 0.7 × pass2
 *
 * Usage:
 *   npx tsx scripts/score-control-group.ts [options]
 *     --concurrency <n>   Parallel LLM calls (default: 5)
 *     --pass1-only        Only run screening pass
 *     --dry-run           Show pairs without scoring
 *     --force             Re-score even if cached
 *     --skip-quarantined  Skip quarantined docs (default: on)
 *     --include-quarantined  Force-include quarantined docs (for comparison)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  extractClaimsText,
  findXmlPath,
  parsePatentClaims,
  type PatentClaim,
} from '../src/api/services/patent-xml-parser-service.js';

const anthropic = new Anthropic();

const CONTROL_DIR = path.resolve('./cache/calibration-control');
const RESULTS_DIR = path.join(CONTROL_DIR, 'results-v3');
const LLM_IO_DIR = path.resolve('./cache/infringement-llm-io');
const SUMMARIES_V2_DIR = path.resolve('./cache/product-summaries-v2');
const TEMPLATES_DIR = path.resolve('./config/infringement-templates');
const SUPER_SECTORS_CONFIG = path.resolve('./config/super-sectors.json');
const QUARANTINE_RESULTS_PATH = path.resolve('./cache/doc-quality-screening/results.json');
const XML_DIR = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;
const MAX_DOC_TEXT_LENGTH = 300_000;
const MIN_TEXT_BYTES = 500;
const PASS1_DOC_CHARS = 15_000;
const PASS2_THRESHOLD = 0.25;
const MODEL = 'claude-sonnet-4-20250514';

// ── Types ──────────────────────────────────────────────────────────────────

interface ManifestPair {
  patentId: string;
  companySlug: string;
  productSlug: string;
  documentName: string;
  docSlug: string;
  patlyticsScore: number;
  patlyticsNarrative: string | null;
  isPdf: boolean;
  textPath: string;
}

interface QuestionDef {
  fieldName: string;
  displayName: string;
  weight: number;
  question: string;
  scale: { min: number; max: number };
  anchors: Record<string, string>;
  reasoningPrompt: string;
}

interface InfringementTemplate {
  id: string;
  name: string;
  version: number;
  scoringGuidance: string[];
  questions: QuestionDef[];
  terminologyMappings?: Array<{ patentTerm: string; productTerms: string[] }>;
  necessaryImplicationGuidance?: string;
  inheritanceChain: string[];
}

interface ComponentScore {
  score: number;         // 1-5 raw
  normalized: number;    // 0.0-1.0
  reasoning: string;
}

interface PassResult {
  compositeScore: number;
  components: Record<string, ComponentScore>;
}

interface ControlResult {
  patentId: string;
  companySlug: string;
  productSlug: string;
  docSlug: string;
  documentName: string;
  patlyticsScore: number;
  superSector: string | null;
  templateVersion: number;
  pass1: PassResult;
  pass2: PassResult | null;
  finalScore: number;
  textLength: number;
  model: string;
  scoredAt: string;
  llmIoPath: string;
}

interface Config {
  concurrency: number;
  pass1Only: boolean;
  dryRun: boolean;
  force: boolean;
  skipQuarantined: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const includeQuarantined = args.includes('--include-quarantined');
  return {
    concurrency: (() => { const i = args.indexOf('--concurrency'); return i >= 0 ? parseInt(args[i + 1], 10) : 5; })(),
    pass1Only: args.includes('--pass1-only'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    skipQuarantined: !includeQuarantined, // default on unless --include-quarantined
  };
}

// ── Quarantine Loading ───────────────────────────────────────────────────

interface QuarantineInfo {
  quarantinedPaths: Set<string>;
  reasonByPath: Map<string, string>;
}

function loadQuarantineResults(): QuarantineInfo | null {
  if (!fs.existsSync(QUARANTINE_RESULTS_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(QUARANTINE_RESULTS_PATH, 'utf-8'));
    const quarantinedPaths = new Set<string>();
    const reasonByPath = new Map<string, string>();
    for (const r of data.results) {
      if (r.quarantined) {
        quarantinedPaths.add(r.textPath);
        reasonByPath.set(r.textPath, r.reason);
      }
    }
    return { quarantinedPaths, reasonByPath };
  } catch {
    return null;
  }
}

function ensureDir(d: string) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ── Template Loading ──────────────────────────────────────────────────────

function loadDefaultTemplate(): any {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'default.json'), 'utf-8'));
}

function loadSuperSectorTemplate(superSectorKey: string): any | null {
  const dir = path.join(TEMPLATES_DIR, 'super-sectors');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const t = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
    if (t.superSectorKey === superSectorKey) return t;
  }
  return null;
}

function resolveTemplate(superSectorKey: string | null): InfringementTemplate {
  const base = loadDefaultTemplate();
  const questions: QuestionDef[] = [...base.questions];
  const scoringGuidance: string[] = [...(base.scoringGuidance || [])];
  const inheritanceChain: string[] = [base.id];
  let terminologyMappings = undefined;
  let necessaryImplicationGuidance = undefined;

  if (superSectorKey) {
    const ssTemplate = loadSuperSectorTemplate(superSectorKey);
    if (ssTemplate) {
      inheritanceChain.push(ssTemplate.id);
      scoringGuidance.push(...(ssTemplate.scoringGuidance || []));
      terminologyMappings = ssTemplate.terminologyMappings;
      necessaryImplicationGuidance = ssTemplate.necessaryImplicationGuidance;

      // Apply question overrides (weight changes, reasoning prompt changes)
      if (ssTemplate.questionOverrides) {
        for (const override of ssTemplate.questionOverrides) {
          const idx = questions.findIndex(q => q.fieldName === override.fieldName);
          if (idx >= 0) {
            if (override.weight !== undefined) questions[idx] = { ...questions[idx], weight: override.weight };
            if (override.reasoningPrompt) questions[idx] = { ...questions[idx], reasoningPrompt: override.reasoningPrompt };
          }
        }
      }
    }
  }

  // Normalize weights to sum to 1.0
  const totalWeight = questions.reduce((sum, q) => sum + q.weight, 0);
  if (totalWeight > 0 && Math.abs(totalWeight - 1.0) > 0.01) {
    for (const q of questions) {
      q.weight = Math.round((q.weight / totalWeight) * 1000) / 1000;
    }
  }

  return {
    id: inheritanceChain[inheritanceChain.length - 1],
    name: base.name,
    version: base.version,
    scoringGuidance,
    questions,
    terminologyMappings,
    necessaryImplicationGuidance,
    inheritanceChain,
  };
}

// ── Super-Sector Resolution (taxonomy-driven) ────────────────────────────

const SECTOR_TAXONOMY_CONFIG = path.resolve('./config/sector-taxonomy-cpc-only.json');

let _taxonomyConfig: any = null;
function getTaxonomyConfig(): any {
  if (!_taxonomyConfig) {
    _taxonomyConfig = JSON.parse(fs.readFileSync(SECTOR_TAXONOMY_CONFIG, 'utf-8'));
  }
  return _taxonomyConfig;
}

let _superSectorConfig: any = null;
function getSuperSectorConfig(): any {
  if (!_superSectorConfig) {
    _superSectorConfig = JSON.parse(fs.readFileSync(SUPER_SECTORS_CONFIG, 'utf-8'));
  }
  return _superSectorConfig;
}

/** Map CPC codes → sector (longest prefix match) → super-sector using taxonomy config */
function resolveSuperSector(patentId: string): string | null {
  try {
    const patentPath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (!fs.existsSync(patentPath)) return null;
    const patent = JSON.parse(fs.readFileSync(patentPath, 'utf-8'));
    const cpcs: string[] = (patent.cpc_current || []).map((c: any) => c.cpc_group_id || c.cpc_subclass_id || '');
    if (cpcs.length === 0) return null;

    const taxonomy = getTaxonomyConfig();

    // Build flat list of (cpcPrefix, sectorKey) sorted by prefix length desc (most specific first)
    const prefixMap: Array<{ prefix: string; sector: string }> = [];
    for (const [sectorKey, sectorData] of Object.entries(taxonomy.sectors) as [string, any][]) {
      for (const prefix of sectorData.cpcPrefixes || []) {
        // Normalize: remove trailing slash for matching
        prefixMap.push({ prefix: prefix.replace(/\/$/, ''), sector: sectorKey });
      }
    }
    prefixMap.sort((a, b) => b.prefix.length - a.prefix.length);

    // Find best matching sector: longest CPC prefix match across all patent CPC codes
    let bestSector: string | null = null;
    let bestPrefixLen = 0;
    for (const cpc of cpcs) {
      const normalized = cpc.replace(/\//g, '');
      for (const { prefix, sector } of prefixMap) {
        const normalizedPrefix = prefix.replace(/\//g, '');
        if (normalized.startsWith(normalizedPrefix) && normalizedPrefix.length > bestPrefixLen) {
          bestSector = sector;
          bestPrefixLen = normalizedPrefix.length;
        }
      }
    }

    if (!bestSector) return null;

    // Look up super-sector from super-sectors.json (matches template system keys)
    const ssConfig = getSuperSectorConfig();
    for (const [ssKey, ssData] of Object.entries(ssConfig.superSectors) as [string, any][]) {
      if (ssData.sectors.includes(bestSector)) return ssKey;
    }

    return null;
  } catch {
    return null;
  }
}

// ── Product Summary Loading ─────────────────────────────────────────────────

function loadProductSummary(companySlug: string, productSlug: string, docSlug: string): any | null {
  const filePath = path.join(SUMMARIES_V2_DIR, companySlug, productSlug, `${docSlug}.json`);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function formatSummaryForPrompt(summary: any): string {
  const s = summary?.summary;
  if (!s) return '';
  const parts: string[] = [];
  if (s.executiveSummary) parts.push(`Overview: ${s.executiveSummary}`);
  if (s.implementedTechnologies?.length) {
    parts.push('Key Technologies:');
    for (const t of s.implementedTechnologies) {
      parts.push(`  - ${t.feature} [${t.category}]: ${t.claimRelevantDetail}`);
    }
  }
  if (s.standards?.length) parts.push(`Standards: ${s.standards.join(', ')}`);
  if (s.protocols?.length) parts.push(`Protocols: ${s.protocols.join(', ')}`);
  if (s.architectureComponents?.length) parts.push(`Architecture: ${s.architectureComponents.join(', ')}`);
  if (s.interfaces?.length) parts.push(`Interfaces: ${s.interfaces.join(', ')}`);
  if (s.signalProcessing?.length) parts.push(`Signal Processing: ${s.signalProcessing.join(', ')}`);
  if (s.dataHandling?.length) parts.push(`Data Handling: ${s.dataHandling.join(', ')}`);
  if (s.securityFeatures?.length) parts.push(`Security: ${s.securityFeatures.join(', ')}`);
  return parts.join('\n');
}

// ── LLM ────────────────────────────────────────────────────────────────────

interface LLMCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

async function callLLM(prompt: string, maxTokens: number = 4096): Promise<LLMCallResult> {
  const start = Date.now();
  let response: Anthropic.Messages.Message | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      break;
    } catch (err: any) {
      const status = err?.status || err?.error?.status;
      if ((status === 429 || status === 529 || err?.message?.includes('overloaded')) && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * RETRY_BASE_DELAY));
        continue;
      }
      throw err;
    }
  }
  if (!response) throw new Error('No response');

  const text = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    text,
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
    durationMs: Date.now() - start,
  };
}

function parseJSON(text: string): any {
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try { return JSON.parse(text.substring(jsonStart, jsonEnd + 1)); } catch {}
  }
  throw new Error(`JSON parse failed: ${text.substring(0, 200)}`);
}

// ── LLM I/O Capture ────────────────────────────────────────────────────────

function saveLLMIO(
  companySlug: string,
  productSlug: string,
  patentId: string,
  passName: string,
  prompt: string,
  result: LLMCallResult,
  parsed: any,
): void {
  const dir = path.join(LLM_IO_DIR, companySlug, productSlug, patentId);
  ensureDir(dir);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  // Save prompt as readable text
  fs.writeFileSync(path.join(dir, `${ts}-${passName}-prompt.txt`), prompt);

  // Save response as structured JSON
  fs.writeFileSync(path.join(dir, `${ts}-${passName}-response.json`), JSON.stringify({
    rawText: result.text,
    parsed,
    model: MODEL,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
  }, null, 2));
}

// ── Patent Loading ─────────────────────────────────────────────────────────

function loadPatentClaims(patentId: string): PatentClaim[] {
  if (!XML_DIR) return [];
  const xmlPath = findXmlPath(patentId, XML_DIR);
  if (!xmlPath) return [];
  return parsePatentClaims(xmlPath).independentClaims;
}

function loadPatentAbstract(patentId: string): string | null {
  try {
    const p = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')).patent_abstract || null;
  } catch {}
  return null;
}

function formatClaims(claims: PatentClaim[], max: number = 5): string {
  return claims.slice(0, max).map(c => `Claim ${c.number}: ${c.text}`).join('\n\n');
}

// ── Prompt Construction ────────────────────────────────────────────────────

function buildInfringementPrompt(
  template: InfringementTemplate,
  claimsText: string,
  patentAbstract: string | null,
  docText: string,
  passName: string,
): string {
  const parts: string[] = [];

  // System instruction
  parts.push(`You are a patent infringement analyst. Assess whether a product's capabilities align with patent claims by scoring ${template.questions.length} specific dimensions.`);

  // Scoring guidance
  if (template.scoringGuidance.length > 0) {
    parts.push('\n## Scoring Guidelines\n');
    parts.push(template.scoringGuidance.map(g => `- ${g}`).join('\n'));
  }

  // Terminology mappings
  if (template.terminologyMappings && template.terminologyMappings.length > 0) {
    parts.push('\n## Terminology Mappings (Patent → Product)\n');
    parts.push('Patent claims use formal language. Product docs use implementation language. Use these mappings:');
    for (const m of template.terminologyMappings) {
      parts.push(`- "${m.patentTerm}" = ${m.productTerms.map(t => `"${t}"`).join(', ')}`);
    }
  }

  // Necessary implication guidance
  if (template.necessaryImplicationGuidance) {
    parts.push('\n## Necessary Implication Guidance\n');
    parts.push(template.necessaryImplicationGuidance);
  }

  // Patent info
  parts.push('\n## Patent Claims\n');
  parts.push(claimsText);
  if (patentAbstract) {
    parts.push(`\nPatent Abstract: ${patentAbstract}`);
  }

  // Product documentation
  parts.push(`\n## Product Documentation${passName === 'pass1' ? ' (first 15K chars)' : ''}\n`);
  parts.push(docText);

  // Questions
  parts.push('\n## Scoring Questions\n');
  parts.push('For each question below, provide a score (1-5) and 2-3 sentences of reasoning.\n');

  for (let i = 0; i < template.questions.length; i++) {
    const q = template.questions[i];
    parts.push(`### ${i + 1}. ${q.displayName} (fieldName: "${q.fieldName}", weight: ${q.weight})`);
    parts.push(`Question: ${q.question}`);
    parts.push('Anchors:');
    for (const [score, desc] of Object.entries(q.anchors)) {
      parts.push(`  ${score} = ${desc}`);
    }
    parts.push(`Reasoning guidance: ${q.reasoningPrompt}`);
    parts.push('');
  }

  // Response format
  parts.push('## Response Format\n');
  parts.push('Respond as JSON (no markdown fencing):');
  parts.push('{');
  const fieldExamples = template.questions.map(q =>
    `  "${q.fieldName}": { "score": <1-5>, "reasoning": "<2-3 sentences>" }`
  );
  parts.push(fieldExamples.join(',\n'));
  parts.push('}');

  return parts.join('\n');
}

// ── Score Computation ──────────────────────────────────────────────────────

function computePassResult(
  parsed: Record<string, { score: number; reasoning: string }>,
  questions: QuestionDef[],
): PassResult {
  const components: Record<string, ComponentScore> = {};
  let weightedSum = 0;
  let totalWeight = 0;

  for (const q of questions) {
    const raw = parsed[q.fieldName];
    if (!raw || typeof raw.score !== 'number') {
      components[q.fieldName] = { score: 0, normalized: 0, reasoning: 'Not scored by LLM' };
      continue;
    }

    const score = Math.max(1, Math.min(5, Math.round(raw.score)));
    const normalized = (score - 1) / 4; // 1→0.00, 2→0.25, 3→0.50, 4→0.75, 5→1.00
    components[q.fieldName] = {
      score,
      normalized,
      reasoning: raw.reasoning || '',
    };
    weightedSum += normalized * q.weight;
    totalWeight += q.weight;
  }

  const compositeScore = totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 1000) / 1000
    : 0;

  return { compositeScore, components };
}

// ── Scoring ────────────────────────────────────────────────────────────────

async function scorePair(pair: ManifestPair, config: Config): Promise<ControlResult | null> {
  const textPath = pair.textPath;
  if (!fs.existsSync(textPath)) return null;
  const stat = fs.statSync(textPath);
  if (stat.size < MIN_TEXT_BYTES) return null;

  const claims = loadPatentClaims(pair.patentId);
  if (claims.length === 0) return null;

  const claimsText = formatClaims(claims, 5);
  const abstract = loadPatentAbstract(pair.patentId);
  const docText = fs.readFileSync(textPath, 'utf-8');

  // Resolve super-sector and template
  const superSector = resolveSuperSector(pair.patentId);
  const template = resolveTemplate(superSector);

  // ── Pass 1: 10 questions against first 15K chars (no summary — pass0 handles screening) ──
  const p1DocText = docText.substring(0, PASS1_DOC_CHARS);
  const p1Prompt = buildInfringementPrompt(template, claimsText, abstract, p1DocText, 'pass1');
  const p1Response = await callLLM(p1Prompt, 4096);
  const p1Parsed = parseJSON(p1Response.text);
  const pass1 = computePassResult(p1Parsed, template.questions);

  // Save LLM I/O
  saveLLMIO(pair.companySlug, pair.productSlug, pair.patentId, 'pass1', p1Prompt, p1Response, p1Parsed);

  const result: ControlResult = {
    patentId: pair.patentId,
    companySlug: pair.companySlug,
    productSlug: pair.productSlug,
    docSlug: pair.docSlug,
    documentName: pair.documentName,
    patlyticsScore: pair.patlyticsScore,
    superSector,
    templateVersion: template.version,
    pass1,
    pass2: null,
    finalScore: pass1.compositeScore,
    textLength: docText.length,
    model: MODEL,
    scoredAt: new Date().toISOString(),
    llmIoPath: path.join(LLM_IO_DIR, pair.companySlug, pair.productSlug, pair.patentId),
  };

  // ── Pass 2: full doc if pass1 >= threshold (always run for control group) ──
  if (!config.pass1Only) {
    const truncDoc = docText.length > MAX_DOC_TEXT_LENGTH
      ? docText.substring(0, MAX_DOC_TEXT_LENGTH) + '\n\n[... truncated ...]'
      : docText;
    const allClaimsText = formatClaims(claims, 10);
    const p2Prompt = buildInfringementPrompt(template, allClaimsText, abstract, truncDoc, 'pass2');
    const p2Response = await callLLM(p2Prompt, 8192);
    const p2Parsed = parseJSON(p2Response.text);
    const pass2 = computePassResult(p2Parsed, template.questions);

    saveLLMIO(pair.companySlug, pair.productSlug, pair.patentId, 'pass2', p2Prompt, p2Response, p2Parsed);

    result.pass2 = pass2;
    // Blend: 0.3 × pass1 + 0.7 × pass2
    result.finalScore = Math.round((pass1.compositeScore * 0.3 + pass2.compositeScore * 0.7) * 1000) / 1000;
  }

  return result;
}

// ── Analysis ───────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const d = Math.sqrt(dx2 * dy2);
  return d === 0 ? 0 : num / d;
}

function spearman(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = (arr: number[]) => {
    const sorted = [...arr].map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n; i++) ranks[sorted[i].i] = i + 1;
    return ranks;
  };
  return pearson(rank(xs), rank(ys));
}

function printMetricBlock(label: string, results: ControlResult[]) {
  const ps = results.map(r => r.patlyticsScore);
  const p1s = results.map(r => r.pass1.compositeScore);
  const finals = results.map(r => r.finalScore);

  console.log(`\n--- ${label} (N=${results.length}) ---`);
  console.log(`Patlytics mean: ${(ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(3)}`);
  console.log(`Pass 1 mean:    ${(p1s.reduce((a, b) => a + b, 0) / p1s.length).toFixed(3)}`);
  console.log(`Final mean:     ${(finals.reduce((a, b) => a + b, 0) / finals.length).toFixed(3)}`);

  const rP1 = pearson(ps, p1s);
  const rFinal = pearson(ps, finals);
  const sP1 = spearman(ps, p1s);
  const sFinal = spearman(ps, finals);
  const maeP1 = p1s.reduce((s, v, i) => s + Math.abs(v - ps[i]), 0) / ps.length;
  const maeFinal = finals.reduce((s, v, i) => s + Math.abs(v - ps[i]), 0) / ps.length;
  const biasP1 = p1s.reduce((s, v, i) => s + (v - ps[i]), 0) / ps.length;
  const biasFinal = finals.reduce((s, v, i) => s + (v - ps[i]), 0) / ps.length;

  console.log(`\n${'Metric'.padEnd(25)} ${'Pass 1'.padStart(10)} ${'Final'.padStart(10)}`);
  console.log(`${'─'.repeat(48)}`);
  console.log(`${'Pearson r'.padEnd(25)} ${rP1.toFixed(4).padStart(10)} ${rFinal.toFixed(4).padStart(10)}`);
  console.log(`${'Spearman ρ'.padEnd(25)} ${sP1.toFixed(4).padStart(10)} ${sFinal.toFixed(4).padStart(10)}`);
  console.log(`${'MAE'.padEnd(25)} ${maeP1.toFixed(4).padStart(10)} ${maeFinal.toFixed(4).padStart(10)}`);
  console.log(`${'Bias'.padEnd(25)} ${(biasP1 >= 0 ? '+' : '') + biasP1.toFixed(4)} ${(biasFinal >= 0 ? '+' : '') + biasFinal.toFixed(4)}`);

  const uniqueScores = new Set(finals.map(f => f.toFixed(3)));
  console.log(`\nUnique final scores: ${uniqueScores.size} (target: ≥10 for good discrimination)`);

  const within25 = finals.filter((f, i) => Math.abs(f - ps[i]) <= 0.25).length;
  const within15 = finals.filter((f, i) => Math.abs(f - ps[i]) <= 0.15).length;
  console.log(`Within 0.25 of Patlytics: ${within25}/${results.length} (${((within25 / results.length) * 100).toFixed(0)}%)`);
  console.log(`Within 0.15 of Patlytics: ${within15}/${results.length} (${((within15 / results.length) * 100).toFixed(0)}%)`);
}

function printAnalysis(results: ControlResult[], quarantine?: QuarantineInfo | null) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`V3 COMPONENT-BASED CALIBRATION`);
  console.log(`${'='.repeat(70)}`);

  // If quarantine data is available, show both full and clean sets
  if (quarantine && quarantine.quarantinedPaths.size > 0) {
    const cleanResults = results.filter(r => {
      // Match by textPath from the control result
      const textPath = path.join(
        CONTROL_DIR, 'texts', r.companySlug, r.productSlug, `${r.docSlug}.txt`
      );
      return !quarantine.quarantinedPaths.has(textPath);
    });
    const quarantinedResults = results.filter(r => {
      const textPath = path.join(
        CONTROL_DIR, 'texts', r.companySlug, r.productSlug, `${r.docSlug}.txt`
      );
      return quarantine.quarantinedPaths.has(textPath);
    });

    printMetricBlock('Full Set (all scored pairs)', results);

    if (cleanResults.length > 0 && cleanResults.length < results.length) {
      printMetricBlock('Clean Set (quarantined excluded)', cleanResults);

      console.log(`\n  Quarantined pairs excluded from clean set: ${quarantinedResults.length}`);
      const reasonCounts = new Map<string, number>();
      for (const r of quarantinedResults) {
        const textPath = path.join(
          CONTROL_DIR, 'texts', r.companySlug, r.productSlug, `${r.docSlug}.txt`
        );
        const reason = quarantine.reasonByPath.get(textPath) || 'unknown';
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      }
      for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${reason}: ${count}`);
      }
    }
  } else {
    printMetricBlock('All Pairs', results);
  }

  const ps = results.map(r => r.patlyticsScore);

  // ── Per-Component Correlation Analysis ──
  console.log(`\n${'='.repeat(70)}`);
  console.log('PER-COMPONENT CORRELATION ANALYSIS');
  console.log(`${'='.repeat(70)}`);

  // Get all component field names from the first result
  const fieldNames = Object.keys(results[0].pass1.components);
  const passToUse = results[0].pass2 ? 'pass2' : 'pass1';

  console.log(`\n${'Component'.padEnd(30)} ${'Weight'.padStart(6)} ${'r'.padStart(8)} ${'Mean'.padStart(6)} ${'StdDev'.padStart(8)} ${'1s'.padStart(4)} ${'2s'.padStart(4)} ${'3s'.padStart(4)} ${'4s'.padStart(4)} ${'5s'.padStart(4)}`);
  console.log('─'.repeat(90));

  for (const fieldName of fieldNames) {
    const scores = results.map(r => {
      const pass = passToUse === 'pass2' && r.pass2 ? r.pass2 : r.pass1;
      return pass.components[fieldName]?.score || 0;
    });

    // Correlation of this component vs Patlytics
    const r = pearson(ps, scores);

    // Distribution
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    const dist = [0, 0, 0, 0, 0];
    for (const s of scores) {
      if (s >= 1 && s <= 5) dist[s - 1]++;
    }

    // Look up weight
    const template = resolveTemplate(null);
    const q = template.questions.find(q => q.fieldName === fieldName);
    const weight = q ? q.weight : 0;

    console.log(
      `${fieldName.padEnd(30)} ${weight.toFixed(2).padStart(6)} ${r.toFixed(4).padStart(8)} ${mean.toFixed(2).padStart(6)} ${stdDev.toFixed(2).padStart(8)} ${String(dist[0]).padStart(4)} ${String(dist[1]).padStart(4)} ${String(dist[2]).padStart(4)} ${String(dist[3]).padStart(4)} ${String(dist[4]).padStart(4)}`
    );
  }

  // ── Detail Table ──
  console.log(`\n${'='.repeat(70)}`);
  console.log('PAIR DETAILS (sorted by |Δ|)');
  console.log(`${'='.repeat(70)}`);

  console.log(`\n${'Patent'.padEnd(10)} ${'Company'.padEnd(22)} ${'SS'.padEnd(8)} ${'Patlytics'.padStart(9)} ${'Pass1'.padStart(7)} ${'Pass2'.padStart(7)} ${'Final'.padStart(7)} ${'Δ'.padStart(6)} ${'TextKB'.padStart(7)} ${'Q'.padStart(3)}`);
  console.log('─'.repeat(93));
  const sorted = [...results].sort((a, b) =>
    Math.abs(b.patlyticsScore - b.finalScore) - Math.abs(a.patlyticsScore - a.finalScore)
  );
  for (const r of sorted) {
    const delta = r.finalScore - r.patlyticsScore;
    const p2 = r.pass2 ? r.pass2.compositeScore.toFixed(2) : 'n/a';
    const ss = (r.superSector || '?').substring(0, 7);
    const textPath = path.join(
      CONTROL_DIR, 'texts', r.companySlug, r.productSlug, `${r.docSlug}.txt`
    );
    const isQ = quarantine?.quarantinedPaths.has(textPath) ? '!' : '';
    console.log(
      `${r.patentId.padEnd(10)} ${r.companySlug.substring(0, 21).padEnd(22)} ${ss.padEnd(8)} ${r.patlyticsScore.toFixed(2).padStart(9)} ${r.pass1.compositeScore.toFixed(2).padStart(7)} ${p2.padStart(7)} ${r.finalScore.toFixed(2).padStart(7)} ${(delta >= 0 ? '+' : '') + delta.toFixed(2)} ${(r.textLength / 1024).toFixed(0).padStart(6)}K ${isQ.padStart(3)}`
    );
  }

  // ── Worst Misses ──
  console.log(`\n${'='.repeat(70)}`);
  console.log('TOP 10 WORST MISSES (for calibration iteration)');
  console.log(`${'='.repeat(70)}`);
  const worst = sorted.slice(0, 10);
  for (const r of worst) {
    const delta = r.finalScore - r.patlyticsScore;
    const pass = r.pass2 || r.pass1;
    const textPath = path.join(
      CONTROL_DIR, 'texts', r.companySlug, r.productSlug, `${r.docSlug}.txt`
    );
    const qTag = quarantine?.quarantinedPaths.has(textPath)
      ? ` [QUARANTINED: ${quarantine.reasonByPath.get(textPath)}]` : '';
    console.log(`\n  ${r.patentId} × ${r.companySlug} (Δ=${(delta >= 0 ? '+' : '') + delta.toFixed(2)})${qTag}`);
    console.log(`    Patlytics=${r.patlyticsScore.toFixed(2)} Final=${r.finalScore.toFixed(2)} SS=${r.superSector || '?'}`);
    // Show component scores for worst misses
    const components = Object.entries(pass.components)
      .sort((a, b) => b[1].score - a[1].score);
    for (const [name, comp] of components) {
      console.log(`    ${name.padEnd(35)} ${comp.score}/5 (${comp.normalized.toFixed(2)})`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  const manifestPath = path.join(CONTROL_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('No control group manifest. Run build-control-group.ts --download first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  let pairs: ManifestPair[] = manifest.pairs;

  // Filter to pairs with extracted text
  pairs = pairs.filter(p => fs.existsSync(p.textPath) && fs.statSync(p.textPath).size >= MIN_TEXT_BYTES);

  // Load quarantine data
  const quarantine = loadQuarantineResults();
  let quarantineExcluded = 0;
  const quarantineReasonCounts = new Map<string, number>();

  if (config.skipQuarantined && quarantine) {
    const before = pairs.length;
    pairs = pairs.filter(p => {
      if (quarantine.quarantinedPaths.has(p.textPath)) {
        const reason = quarantine.reasonByPath.get(p.textPath) || 'unknown';
        quarantineReasonCounts.set(reason, (quarantineReasonCounts.get(reason) || 0) + 1);
        return false;
      }
      return true;
    });
    quarantineExcluded = before - pairs.length;
  }

  console.log(`=== V3 Control Group Scoring ===`);
  console.log(`Pairs with text: ${pairs.length}`);
  if (quarantineExcluded > 0) {
    console.log(`Excluded ${quarantineExcluded} quarantined pairs:`);
    for (const [reason, count] of [...quarantineReasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count}`);
    }
  } else if (config.skipQuarantined && !quarantine) {
    console.log(`Quarantine: no results.json found (run screen-doc-quality.ts first)`);
  } else if (!config.skipQuarantined) {
    console.log(`Quarantine: disabled (--include-quarantined)`);
  }
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Template: ${TEMPLATES_DIR}/default.json`);
  console.log(`LLM I/O: ${LLM_IO_DIR}/`);
  if (config.pass1Only) console.log('MODE: Pass 1 only');
  if (config.dryRun) console.log('MODE: DRY RUN');

  if (config.dryRun) {
    // Show pairs with super-sector resolution
    for (const p of pairs) {
      const ss = resolveSuperSector(p.patentId) || '?';
      const size = fs.statSync(p.textPath).size;
      console.log(`  ${p.patentId} × ${p.companySlug}/${p.docSlug.substring(0, 30)}: P=${p.patlyticsScore.toFixed(2)} SS=${ss} (${(size / 1024).toFixed(0)}K)`);
    }
    // Super-sector distribution
    const ssDist = new Map<string, number>();
    for (const p of pairs) {
      const ss = resolveSuperSector(p.patentId) || 'UNKNOWN';
      ssDist.set(ss, (ssDist.get(ss) || 0) + 1);
    }
    console.log('\nSuper-sector distribution:');
    for (const [ss, count] of [...ssDist.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ss}: ${count} pairs`);
    }
    return;
  }

  // Filter cached
  if (!config.force) {
    const before = pairs.length;
    pairs = pairs.filter(p => {
      const rp = path.join(RESULTS_DIR, `${p.companySlug}_${p.docSlug}_${p.patentId}.json`);
      return !fs.existsSync(rp);
    });
    if (before !== pairs.length) console.log(`Filtered to ${pairs.length} unscored (${before - pairs.length} cached)`);
  }

  if (pairs.length === 0) {
    console.log('All pairs already scored. Loading cached results for analysis...');
  }

  ensureDir(RESULTS_DIR);
  const results: ControlResult[] = [];
  let completed = 0, failed = 0;

  // Score uncached pairs
  for (let i = 0; i < pairs.length; i += config.concurrency) {
    const batch = pairs.slice(i, i + config.concurrency);
    console.log(`\n--- Batch ${Math.floor(i / config.concurrency) + 1}/${Math.ceil(pairs.length / config.concurrency)} ---`);

    const promises = batch.map(async (pair) => {
      try {
        const ss = resolveSuperSector(pair.patentId) || '?';
        console.log(`  ${pair.patentId} × ${pair.companySlug}/${pair.docSlug.substring(0, 25)} (P=${pair.patlyticsScore.toFixed(2)} SS=${ss})`);
        const result = await scorePair(pair, config);
        if (!result) { console.log(`    Skipped`); return; }

        const delta = result.finalScore - pair.patlyticsScore;
        console.log(`    P1=${result.pass1.compositeScore.toFixed(2)} F=${result.finalScore.toFixed(2)} Δ=${(delta >= 0 ? '+' : '') + delta.toFixed(2)}`);

        const rp = path.join(RESULTS_DIR, `${pair.companySlug}_${pair.docSlug}_${pair.patentId}.json`);
        fs.writeFileSync(rp, JSON.stringify(result, null, 2));
        results.push(result);
        completed++;
      } catch (err) {
        console.error(`    FAILED: ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    });
    await Promise.all(promises);
  }

  // Load all cached results (including from previous runs)
  if (fs.existsSync(RESULTS_DIR)) {
    for (const f of fs.readdirSync(RESULTS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8'));
      if (!results.find(x => x.patentId === r.patentId && x.docSlug === r.docSlug)) {
        results.push(r);
      }
    }
  }

  console.log(`\nCompleted: ${completed}, Failed: ${failed}, Total results: ${results.length}`);

  if (results.length > 0) {
    printAnalysis(results, quarantine);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
