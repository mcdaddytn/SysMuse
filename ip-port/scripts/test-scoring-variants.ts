/**
 * Ad-Hoc Scoring Variant Test Harness
 *
 * Tests different summarization strategies on specific patent×product pairs
 * to measure improvement over baseline scoring.
 *
 * Variants:
 *   --baseline       Raw doc only (current control-group behavior)
 *   --with-summary   Prepend single-doc summary to pass1 (matches production pipeline)
 *   --multi-doc      Aggregate all GLSSD2 docs for the product, summarize, use as context
 *   --patent-guided  Multi-doc + patent-claim-focused summarization
 *   --all-variants   Run all of the above
 *
 * Usage:
 *   npx tsx scripts/test-scoring-variants.ts \
 *     --patent 11489510 --company qorvo-inc --product tqq0041 --all-variants
 *
 *   npx tsx scripts/test-scoring-variants.ts --batch worst-pairs
 *
 *   npx tsx scripts/test-scoring-variants.ts --batch worst-pairs --dry-run
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

// ── Constants ──────────────────────────────────────────────────────────────

const CONTROL_DIR = path.resolve('./cache/calibration-control');
const RESULTS_V3_DIR = path.join(CONTROL_DIR, 'results-v3');
const VARIANTS_DIR = path.resolve('./cache/scoring-variants');
const LLM_IO_DIR = path.resolve('./cache/scoring-variants-llm-io');
const SUMMARIES_V2_DIR = path.resolve('./cache/product-summaries-v2');
const TEMPLATES_DIR = path.resolve('./config/infringement-templates');
const SUPER_SECTORS_CONFIG = path.resolve('./config/super-sectors.json');
const GLSSD2_BASE = '/Volumes/GLSSD2/data/products/docs';
const XML_DIR = process.env.USPTO_PATENT_GRANT_XML_DIR || '';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;
const MAX_DOC_TEXT_LENGTH = 300_000;
const PASS1_DOC_CHARS = 15_000;
const MAX_TEXT_LENGTH_SUMMARIZE = 100_000;

// ── Types ──────────────────────────────────────────────────────────────────

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
  score: number;
  normalized: number;
  reasoning: string;
}

interface PassResult {
  compositeScore: number;
  components: Record<string, ComponentScore>;
}

interface VariantResult {
  variant: string;
  patentId: string;
  companySlug: string;
  productSlug: string;
  superSector: string | null;
  pass1: PassResult;
  pass2: PassResult | null;
  finalScore: number;
  docCount: number;
  totalTextLength: number;
  summaryUsed: boolean;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  scoredAt: string;
}

interface ComparisonResult {
  patentId: string;
  companySlug: string;
  productSlug: string;
  patlyticsScore: number;
  baselineScore: number | null;
  variants: Record<string, {
    finalScore: number;
    error: number;
    improvement: number;
    pass1Score: number;
    pass2Score: number | null;
    docCount: number;
  }>;
  bestVariant: string;
  bestError: number;
}

interface BatchPair {
  patentId: string;
  companySlug: string;
  productSlug: string;
  patlyticsScore: number;
  controlDocSlug: string;
  controlTextPath: string;
  glssd2Dir: string | null;
}

interface Config {
  patent: string | null;
  company: string | null;
  product: string | null;
  variants: Set<string>;
  batch: string | null;
  dryRun: boolean;
  force: boolean;
  concurrency: number;
}

// ── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    patent: null,
    company: null,
    product: null,
    variants: new Set(),
    batch: null,
    dryRun: false,
    force: false,
    concurrency: 1,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--patent' && args[i + 1]) config.patent = args[++i];
    else if (arg === '--company' && args[i + 1]) config.company = args[++i];
    else if (arg === '--product' && args[i + 1]) config.product = args[++i];
    else if (arg === '--baseline') config.variants.add('baseline');
    else if (arg === '--with-summary') config.variants.add('with-summary');
    else if (arg === '--multi-doc') config.variants.add('multi-doc');
    else if (arg === '--patent-guided') config.variants.add('patent-guided');
    else if (arg === '--all-variants') {
      config.variants.add('baseline');
      config.variants.add('with-summary');
      config.variants.add('multi-doc');
      config.variants.add('patent-guided');
    }
    else if (arg === '--batch' && args[i + 1]) config.batch = args[++i];
    else if (arg === '--dry-run') config.dryRun = true;
    else if (arg === '--force') config.force = true;
    else if (arg === '--concurrency' && args[i + 1]) config.concurrency = parseInt(args[++i], 10);
  }

  // Default to all variants if none specified
  if (config.variants.size === 0 && !config.batch) {
    config.variants.add('baseline');
  }

  return config;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Template Loading (reused from score-control-group.ts) ─────────────────

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

    const prefixMap: Array<{ prefix: string; sector: string }> = [];
    for (const [sectorKey, sectorData] of Object.entries(taxonomy.sectors) as [string, any][]) {
      for (const prefix of sectorData.cpcPrefixes || []) {
        prefixMap.push({ prefix: prefix.replace(/\/$/, ''), sector: sectorKey });
      }
    }
    prefixMap.sort((a, b) => b.prefix.length - a.prefix.length);

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
  } catch { return null; }
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

function loadPatentCpcCodes(patentId: string): string[] {
  try {
    const p = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(p)) {
      const patent = JSON.parse(fs.readFileSync(p, 'utf-8'));
      return (patent.cpc_current || []).map((c: any) => c.cpc_group_id || c.cpc_subclass_id || '').filter(Boolean);
    }
  } catch {}
  return [];
}

function formatClaims(claims: PatentClaim[], max: number = 5): string {
  return claims.slice(0, max).map(c => `Claim ${c.number}: ${c.text}`).join('\n\n');
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

  return {
    text: response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map(b => b.text).join(''),
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
  variant: string,
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
  fs.writeFileSync(path.join(dir, `${ts}-${variant}-${passName}-prompt.txt`), prompt);
  fs.writeFileSync(path.join(dir, `${ts}-${variant}-${passName}-response.json`), JSON.stringify({
    rawText: result.text,
    parsed,
    model: MODEL,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
  }, null, 2));
}

// ── Prompt Construction (reused from score-control-group.ts) ──────────────

function buildInfringementPrompt(
  template: InfringementTemplate,
  claimsText: string,
  patentAbstract: string | null,
  docText: string,
  passName: string,
): string {
  const parts: string[] = [];

  parts.push(`You are a patent infringement analyst. Assess whether a product's capabilities align with patent claims by scoring ${template.questions.length} specific dimensions.`);

  if (template.scoringGuidance.length > 0) {
    parts.push('\n## Scoring Guidelines\n');
    parts.push(template.scoringGuidance.map(g => `- ${g}`).join('\n'));
  }

  if (template.terminologyMappings && template.terminologyMappings.length > 0) {
    parts.push('\n## Terminology Mappings (Patent \u2192 Product)\n');
    parts.push('Patent claims use formal language. Product docs use implementation language. Use these mappings:');
    for (const m of template.terminologyMappings) {
      parts.push(`- "${m.patentTerm}" = ${m.productTerms.map(t => `"${t}"`).join(', ')}`);
    }
  }

  if (template.necessaryImplicationGuidance) {
    parts.push('\n## Necessary Implication Guidance\n');
    parts.push(template.necessaryImplicationGuidance);
  }

  parts.push('\n## Patent Claims\n');
  parts.push(claimsText);
  if (patentAbstract) {
    parts.push(`\nPatent Abstract: ${patentAbstract}`);
  }

  parts.push(`\n## Product Documentation${passName === 'pass1' ? ' (first 15K chars)' : ''}\n`);
  parts.push(docText);

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

  parts.push('## Response Format\n');
  parts.push('Respond as JSON (no markdown fencing):');
  parts.push('{');
  parts.push(template.questions.map(q =>
    `  "${q.fieldName}": { "score": <1-5>, "reasoning": "<2-3 sentences>" }`
  ).join(',\n'));
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
    const normalized = (score - 1) / 4;
    components[q.fieldName] = { score, normalized, reasoning: raw.reasoning || '' };
    weightedSum += normalized * q.weight;
    totalWeight += q.weight;
  }

  return {
    compositeScore: totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 1000) / 1000 : 0,
    components,
  };
}

// ── Summary Formatting (FIXED — includes ALL fields) ──────────────────────

function formatFullSummary(summary: any): string {
  const s = summary?.summary || summary?.unifiedProfile;
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

// ── Multi-Doc Aggregation ──────────────────────────────────────────────────

interface DocSource {
  filename: string;
  path: string;
  type: 'txt' | 'html';
  size: number;
}

/**
 * Find all readable doc files for a product from GLSSD2 + control-group cache.
 * Returns .txt files (ready to use) and .html files (will strip tags).
 * PDFs without .txt extraction are skipped.
 */
function findProductDocs(companySlug: string, productSlug: string, controlTextPath?: string): DocSource[] {
  const docs: DocSource[] = [];
  const seen = new Set<string>();

  // 1. Check GLSSD2 directory
  const glssd2Dir = path.join(GLSSD2_BASE, companySlug, productSlug);
  if (fs.existsSync(glssd2Dir)) {
    const files = fs.readdirSync(glssd2Dir).filter(f => !f.startsWith('._'));
    for (const file of files) {
      const fullPath = path.join(glssd2Dir, file);
      const ext = path.extname(file).toLowerCase();
      if (ext === '.txt') {
        docs.push({ filename: file, path: fullPath, type: 'txt', size: fs.statSync(fullPath).size });
        seen.add(file);
      } else if (ext === '.html') {
        docs.push({ filename: file, path: fullPath, type: 'html', size: fs.statSync(fullPath).size });
        seen.add(file);
      }
      // PDFs: check if a .txt sibling exists
      else if (ext === '.pdf') {
        const txtSibling = fullPath.replace(/\.pdf$/, '.txt');
        if (fs.existsSync(txtSibling) && !seen.has(file.replace(/\.pdf$/, '.txt'))) {
          docs.push({ filename: file.replace(/\.pdf$/, '.txt'), path: txtSibling, type: 'txt', size: fs.statSync(txtSibling).size });
          seen.add(file.replace(/\.pdf$/, '.txt'));
        }
      }
    }
  }

  // 2. Add the control-group text if available and not already included
  if (controlTextPath && fs.existsSync(controlTextPath)) {
    const basename = path.basename(controlTextPath);
    if (!seen.has(basename)) {
      docs.push({ filename: basename, path: controlTextPath, type: 'txt', size: fs.statSync(controlTextPath).size });
    }
  }

  return docs;
}

/** Strip HTML tags for plain text extraction */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Read text from a doc source */
function readDocText(doc: DocSource): string {
  const raw = fs.readFileSync(doc.path, 'utf-8');
  if (doc.type === 'html') return stripHtml(raw);
  return raw;
}

/** Aggregate all product docs into a single text blob */
function aggregateProductDocs(docs: DocSource[], maxTotalLength: number = MAX_DOC_TEXT_LENGTH): string {
  const parts: string[] = [];
  let totalLen = 0;

  for (const doc of docs) {
    const text = readDocText(doc);
    if (text.length < 100) continue;

    const header = `\n--- Document: ${doc.filename} (${(doc.size / 1024).toFixed(1)}KB) ---\n`;
    if (totalLen + text.length + header.length > maxTotalLength) {
      const remaining = maxTotalLength - totalLen - header.length - 50;
      if (remaining > 500) {
        parts.push(header + text.substring(0, remaining) + '\n[... truncated ...]');
        totalLen = maxTotalLength;
      }
      break;
    }

    parts.push(header + text);
    totalLen += header.length + text.length;
  }

  return parts.join('\n');
}

// ── Summarization (from summarize-product-docs-v2.ts) ─────────────────────

const SUMMARIZE_PROMPT = `You are a patent infringement analyst extracting technical implementation details from product documentation. Your goal is to identify concrete features and methods that could map to patent claim elements.

Focus on IMPLEMENTATION DETAILS, not marketing language. Use terminology that maps to patent claims:
- Method steps ("receiving", "processing", "transmitting", "determining")
- Structural elements ("a processor configured to", "a memory storing instructions")
- Functional descriptions ("whereby", "such that", "for the purpose of")

Analyze the document and respond with a JSON object (no markdown fencing):

{
  "productName": "Name of the product",
  "companyName": "Name of the company",
  "documentType": "datasheet|whitepaper|reference-manual|user-guide|application-note|presentation|video-transcript|webpage|other",

  "implementedTechnologies": [
    {
      "feature": "Short feature name",
      "category": "Category",
      "claimRelevantDetail": "Implementation detail using patent-claim-style language"
    }
  ],

  "standards": ["List of standards referenced"],
  "protocols": ["List of protocols used"],
  "architectureComponents": ["Key structural components"],
  "interfaces": ["Hardware/software interfaces"],
  "signalProcessing": ["Signal processing methods"],
  "dataHandling": ["Data processing methods"],
  "securityFeatures": ["Security implementations"],

  "executiveSummary": "3-4 sentence technical summary focusing on what the product DOES, what it CONTAINS, and how it OPERATES."
}

Rules:
- If a category has no relevant content, use an empty array [].
- Be SPECIFIC — reference actual feature names, parameter values, and implementation details.
- For implementedTechnologies, aim for 5-15 features depending on document richness.
- The claimRelevantDetail field is the most important.
- Omit purely marketing content.`;

async function summarizeText(
  text: string,
  productName: string,
  companyName: string,
  focusAreas?: string,
): Promise<any> {
  const truncated = text.length > MAX_TEXT_LENGTH_SUMMARIZE
    ? text.substring(0, MAX_TEXT_LENGTH_SUMMARIZE) + '\n\n[... truncated ...]'
    : text;

  let prompt = `${SUMMARIZE_PROMPT}

Product: ${productName} (${companyName})

--- DOCUMENT TEXT ---
${truncated}
--- END DOCUMENT TEXT ---`;

  if (focusAreas) {
    prompt += `\n\n${focusAreas}`;
  }

  const result = await callLLM(prompt, 4096);
  return parseJSON(result.text);
}

// ── Cross-Doc Synthesis (Stage 2 — new) ───────────────────────────────────

async function synthesizeMultiDocProfile(
  perDocSummaries: Array<{ filename: string; summary: any }>,
  productName: string,
  companyName: string,
): Promise<any> {
  const summaryTexts = perDocSummaries.map(d => {
    const s = d.summary;
    const parts: string[] = [`\n### Document: ${d.filename}`];
    if (s.documentType) parts.push(`Type: ${s.documentType}`);
    if (s.executiveSummary) parts.push(`Summary: ${s.executiveSummary}`);
    if (s.implementedTechnologies?.length) {
      parts.push('Technologies:');
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
  }).join('\n');

  const prompt = `Given per-document technical summaries for ${productName} by ${companyName}, create a unified product technical profile that merges all evidence.

For each technology/capability, note which document(s) provide evidence.
Resolve conflicts (if doc A says "supports X" and doc B says "deprecated X", note both).
Prioritize implementation specifics over marketing claims.

--- PER-DOCUMENT SUMMARIES (${perDocSummaries.length} documents) ---
${summaryTexts}
--- END SUMMARIES ---

Respond with a JSON object (no markdown fencing):

{
  "productName": "${productName}",
  "companyName": "${companyName}",
  "docCount": ${perDocSummaries.length},
  "docTypes": { "<type>": <count>, ... },

  "implementedTechnologies": [
    {
      "feature": "Short feature name",
      "category": "Category",
      "claimRelevantDetail": "Merged implementation detail with source references",
      "sources": ["doc1.pdf", "doc2.html"]
    }
  ],

  "standards": ["Merged list of standards"],
  "protocols": ["Merged list of protocols"],
  "architectureComponents": ["Merged architecture components"],
  "interfaces": ["Merged interfaces"],
  "signalProcessing": ["Merged signal processing methods"],
  "dataHandling": ["Merged data handling methods"],
  "securityFeatures": ["Merged security features"],

  "executiveSummary": "4-6 sentence unified technical summary covering the full product capability set."
}

Rules:
- Merge and deduplicate across documents. If multiple docs describe the same feature, combine the details.
- For implementedTechnologies, aim for 10-25 features that cover the product's full capability set.
- Include "sources" array to trace features back to original documents.
- Prioritize technical specifics over marketing claims.`;

  const result = await callLLM(prompt, 8192);
  return parseJSON(result.text);
}

// ── Patent-Guided Focus Areas ──────────────────────────────────────────────

function buildPatentFocusAreas(
  claims: PatentClaim[],
  abstract: string | null,
  cpcCodes: string[],
  superSector: string | null,
): string {
  const parts: string[] = [];
  parts.push('FOCUS AREAS for this analysis (from patent context):');

  if (superSector) {
    parts.push(`- Patent technology domain: ${superSector}`);
  }

  // Extract key terms from claims
  const claimTexts = claims.slice(0, 3).map(c => c.text).join(' ');
  const technicalTerms = extractKeyTerms(claimTexts);
  if (technicalTerms.length > 0) {
    parts.push(`- Key patent terms to look for: [${technicalTerms.map(t => `"${t}"`).join(', ')}]`);
  }

  if (cpcCodes.length > 0) {
    parts.push(`- CPC classification codes: ${cpcCodes.slice(0, 5).join(', ')}`);
  }

  parts.push('\nWhen extracting implementedTechnologies, prioritize any features related to these focus areas. If the document describes implementations of these specific technologies, provide extra detail in claimRelevantDetail.');

  return parts.join('\n');
}

/** Extract key technical terms from patent claim text */
function extractKeyTerms(text: string): string[] {
  const terms = new Set<string>();

  // Multi-word technical phrases
  const phrasePatterns = [
    /(?:acoustic|piezoelectric|interdigital|electromechanical|resonat\w+|filter\w*|transducer\w*)/gi,
    /(?:packet\s+\w+|flow\s+\w+|routing\s+\w+|forwarding\s+\w+|tunnel\w*|encapsulat\w+)/gi,
    /(?:virtual\w*\s+\w+|container\w*|orchestrat\w+|provision\w+|automat\w+)/gi,
    /(?:encrypt\w+|authenticat\w+|cipher\w*|certificat\w*|key\s+\w+)/gi,
    /(?:semiconductor|substrate|wafer|epitaxial|deposition|etch\w*|lithograph\w*)/gi,
    /(?:RF|radio\s+frequency|antenna|beamform\w*|MIMO|OFDM\w*)/gi,
    /(?:processor|memory|cache|bus|interface|controller|register)/gi,
    /(?:network\s+\w+|SDN|software[- ]defined|cloud\s+\w+)/gi,
  ];

  for (const pattern of phrasePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const m of matches) {
        if (m.length > 3) terms.add(m.toLowerCase());
      }
    }
  }

  return Array.from(terms).slice(0, 15);
}

// ── Batch Pair Definitions ─────────────────────────────────────────────────

function getWorstPairs(): BatchPair[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(CONTROL_DIR, 'manifest.json'), 'utf-8'));

  const pairDefs = [
    // SEMICONDUCTOR
    { patentId: '11489510', companySlug: 'qorvo-inc', productSlug: 'tqq0041', patlyticsScore: 0.66 },
    { patentId: '11018651', companySlug: 'skyworks-solutions-inc', productSlug: 'sky50313', patlyticsScore: 0.65 },
    { patentId: '8981852', companySlug: 'texas-instruments', productSlug: 'lmv232', patlyticsScore: 0.67 },
    { patentId: '8436516', companySlug: 'murata-manufacturing', productSlug: 'tc-saw-filters', patlyticsScore: 0.75 },
    { patentId: '8587132', companySlug: 'amkor-technology', productSlug: 'fcbga', patlyticsScore: 0.59 },
    // NETWORKING
    { patentId: '9083609', companySlug: 'palo-alto-networks', productSlug: 'panorama', patlyticsScore: 0.83 },
    { patentId: '10887156', companySlug: 'hpe-hewlett-packard-enterprise', productSlug: 'hpe-aruba-networking-edgeconnect-sd-wan', patlyticsScore: 0.79 },
    { patentId: '12034587', companySlug: 'arista-networks', productSlug: 'cloudvision', patlyticsScore: 0.74 },
  ];

  return pairDefs.map(def => {
    // Find the control doc from manifest
    const manifestPair = manifest.pairs.find((p: any) =>
      p.patentId === def.patentId && p.companySlug === def.companySlug
    );

    const controlDocSlug = manifestPair?.docSlug || '';
    const controlTextPath = manifestPair?.textPath || '';

    // Check GLSSD2 directory
    const glssd2Dir = path.join(GLSSD2_BASE, def.companySlug, def.productSlug);
    const hasGlssd2 = fs.existsSync(glssd2Dir);

    return {
      ...def,
      controlDocSlug,
      controlTextPath,
      glssd2Dir: hasGlssd2 ? glssd2Dir : null,
    };
  });
}

// ── Load Baseline from Cached V3 Results ───────────────────────────────────

function loadBaselineResult(companySlug: string, docSlug: string, patentId: string): any | null {
  const filename = `${companySlug}_${docSlug}_${patentId}.json`;
  const filePath = path.join(RESULTS_V3_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

// ── Core Scoring Function ──────────────────────────────────────────────────

async function scoreVariant(
  variant: string,
  patentId: string,
  companySlug: string,
  productSlug: string,
  controlTextPath: string,
  controlDocSlug: string,
): Promise<VariantResult> {
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Load patent data
  const claims = loadPatentClaims(patentId);
  if (claims.length === 0) throw new Error(`No claims found for patent ${patentId}`);

  const abstract = loadPatentAbstract(patentId);
  const superSector = resolveSuperSector(patentId);
  const template = resolveTemplate(superSector);
  const claimsText = formatClaims(claims, 5);

  // Determine doc text based on variant
  let pass1DocText: string;
  let docCount = 1;
  let totalTextLength = 0;
  let summaryUsed = false;

  if (variant === 'baseline') {
    // Raw control doc only
    const rawText = fs.readFileSync(controlTextPath, 'utf-8');
    totalTextLength = rawText.length;
    pass1DocText = rawText.substring(0, PASS1_DOC_CHARS);

  } else if (variant === 'with-summary') {
    // Single control doc + summary prepended (matches production pipeline)
    const rawText = fs.readFileSync(controlTextPath, 'utf-8');
    totalTextLength = rawText.length;

    // Check for existing v2 summary
    const summaryFile = path.join(SUMMARIES_V2_DIR, companySlug, productSlug, `${controlDocSlug}.json`);
    let summaryText = '';
    if (fs.existsSync(summaryFile)) {
      const summary = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
      summaryText = formatFullSummary(summary);
    } else {
      // Generate summary on the fly
      console.log(`    Generating summary for ${controlDocSlug}...`);
      const summaryResult = await summarizeText(rawText, productSlug, companySlug);
      summaryText = formatFullSummary({ summary: summaryResult });
      totalInputTokens += 1000; // approximate
    }

    if (summaryText) {
      pass1DocText = `## Product Technical Summary\n${summaryText}\n\n--- Document Text (first 15K chars) ---\n${rawText.substring(0, PASS1_DOC_CHARS)}`;
      summaryUsed = true;
    } else {
      pass1DocText = rawText.substring(0, PASS1_DOC_CHARS);
    }

  } else if (variant === 'multi-doc' || variant === 'patent-guided') {
    // Aggregate all available docs
    const docs = findProductDocs(companySlug, productSlug, controlTextPath);
    docCount = docs.length;

    if (docs.length === 0) {
      throw new Error(`No docs found for ${companySlug}/${productSlug}`);
    }

    console.log(`    Found ${docs.length} docs for ${companySlug}/${productSlug}`);

    // For multi-doc: summarize each doc, then synthesize
    const perDocSummaries: Array<{ filename: string; summary: any }> = [];

    for (const doc of docs) {
      const text = readDocText(doc);
      if (text.length < 200) continue;
      totalTextLength += text.length;

      console.log(`      Summarizing: ${doc.filename} (${(text.length / 1024).toFixed(1)}KB)`);

      let focusAreas: string | undefined;
      if (variant === 'patent-guided') {
        const cpcCodes = loadPatentCpcCodes(patentId);
        focusAreas = buildPatentFocusAreas(claims, abstract, cpcCodes, superSector);
      }

      const summary = await summarizeText(text, productSlug, companySlug, focusAreas);
      perDocSummaries.push({ filename: doc.filename, summary });
    }

    if (perDocSummaries.length === 0) {
      throw new Error(`No docs could be summarized for ${companySlug}/${productSlug}`);
    }

    // Stage 2: Cross-doc synthesis
    console.log(`    Synthesizing ${perDocSummaries.length} doc summaries...`);
    const profile = await synthesizeMultiDocProfile(perDocSummaries, productSlug, companySlug);

    const summaryText = formatFullSummary({ unifiedProfile: profile });
    summaryUsed = true;

    // Use the first doc's raw text as the primary evidence, with the synthesized profile prepended
    const primaryDoc = docs.find(d => d.path === controlTextPath) || docs[0];
    const primaryText = readDocText(primaryDoc);

    pass1DocText = `## Unified Product Technical Profile (from ${docCount} documents)\n${summaryText}\n\n--- Primary Document Text (first 15K chars) ---\n${primaryText.substring(0, PASS1_DOC_CHARS)}`;

  } else {
    throw new Error(`Unknown variant: ${variant}`);
  }

  // ── Pass 1 ──
  console.log(`    Pass 1 [${variant}]: scoring...`);
  const p1Prompt = buildInfringementPrompt(template, claimsText, abstract, pass1DocText, 'pass1');
  const p1Response = await callLLM(p1Prompt, 4096);
  const p1Parsed = parseJSON(p1Response.text);
  const pass1 = computePassResult(p1Parsed, template.questions);
  totalInputTokens += p1Response.inputTokens;
  totalOutputTokens += p1Response.outputTokens;

  saveLLMIO(variant, companySlug, productSlug, patentId, 'pass1', p1Prompt, p1Response, p1Parsed);
  console.log(`      P1=${pass1.compositeScore.toFixed(3)}`);

  // ── Pass 2: full doc ──
  const rawText = fs.readFileSync(controlTextPath, 'utf-8');
  let pass2DocText: string;

  if (variant === 'multi-doc' || variant === 'patent-guided') {
    // For multi-doc variants, aggregate all docs for pass2
    const docs = findProductDocs(companySlug, productSlug, controlTextPath);
    const aggregated = aggregateProductDocs(docs, MAX_DOC_TEXT_LENGTH);
    pass2DocText = aggregated;
  } else {
    // For baseline/with-summary, use the single control doc
    pass2DocText = rawText.length > MAX_DOC_TEXT_LENGTH
      ? rawText.substring(0, MAX_DOC_TEXT_LENGTH) + '\n\n[... truncated ...]'
      : rawText;
  }

  console.log(`    Pass 2 [${variant}]: deep analysis...`);
  const allClaimsText = formatClaims(claims, 10);
  const p2Prompt = buildInfringementPrompt(template, allClaimsText, abstract, pass2DocText, 'pass2');
  const p2Response = await callLLM(p2Prompt, 8192);
  const p2Parsed = parseJSON(p2Response.text);
  const pass2 = computePassResult(p2Parsed, template.questions);
  totalInputTokens += p2Response.inputTokens;
  totalOutputTokens += p2Response.outputTokens;

  saveLLMIO(variant, companySlug, productSlug, patentId, 'pass2', p2Prompt, p2Response, p2Parsed);

  // Blend: 0.3 x pass1 + 0.7 x pass2
  const finalScore = Math.round((pass1.compositeScore * 0.3 + pass2.compositeScore * 0.7) * 1000) / 1000;
  console.log(`      P2=${pass2.compositeScore.toFixed(3)} Final=${finalScore.toFixed(3)}`);

  return {
    variant,
    patentId,
    companySlug,
    productSlug,
    superSector,
    pass1,
    pass2,
    finalScore,
    docCount,
    totalTextLength,
    summaryUsed,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    durationMs: Date.now() - startTime,
    scoredAt: new Date().toISOString(),
  };
}

// ── Report Generation ──────────────────────────────────────────────────────

function generateComparisonReport(comparisons: ComparisonResult[]): string {
  const lines: string[] = [];
  lines.push('# Scoring Variant Comparison Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Per-pair results table
  lines.push('## Per-Pair Results');
  lines.push('');

  const allVariants = new Set<string>();
  for (const c of comparisons) {
    for (const v of Object.keys(c.variants)) allVariants.add(v);
  }
  const variantList = Array.from(allVariants).sort();

  // Header
  const header = ['Pair', 'Patlytics', 'Baseline', ...variantList.map(v => v === 'baseline' ? '' : v).filter(Boolean), 'Best'];
  lines.push('| ' + header.join(' | ') + ' |');
  lines.push('| ' + header.map(() => '---').join(' | ') + ' |');

  for (const c of comparisons) {
    const row: string[] = [
      `${c.companySlug}/${c.productSlug} x ${c.patentId}`,
      c.patlyticsScore.toFixed(2),
      c.baselineScore !== null ? `${c.baselineScore.toFixed(2)} (err=${Math.abs(c.patlyticsScore - c.baselineScore).toFixed(3)})` : 'N/A',
    ];

    for (const v of variantList) {
      if (v === 'baseline') continue;
      const vr = c.variants[v];
      if (vr) {
        row.push(`${vr.finalScore.toFixed(2)} (err=${vr.error.toFixed(3)}, ${vr.improvement >= 0 ? '+' : ''}${vr.improvement.toFixed(3)})`);
      } else {
        row.push('N/A');
      }
    }

    row.push(c.bestVariant);
    lines.push('| ' + row.join(' | ') + ' |');
  }

  // Aggregate metrics
  lines.push('');
  lines.push('## Aggregate Metrics');
  lines.push('');

  for (const v of variantList) {
    const errors = comparisons.filter(c => c.variants[v]).map(c => c.variants[v].error);
    const improvements = comparisons.filter(c => c.variants[v]).map(c => c.variants[v].improvement);
    if (errors.length === 0) continue;

    const avgErr = errors.reduce((a, b) => a + b, 0) / errors.length;
    const medianErr = [...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)];
    const improved = improvements.filter(i => i > 0.01).length;
    const regressed = improvements.filter(i => i < -0.01).length;

    lines.push(`### ${v}`);
    lines.push(`- Avg Error: ${avgErr.toFixed(3)}`);
    lines.push(`- Median Error: ${medianErr.toFixed(3)}`);
    lines.push(`- Improved: ${improved}/${errors.length}`);
    lines.push(`- Regressed: ${regressed}/${errors.length}`);
    lines.push('');
  }

  // Key observations placeholder
  lines.push('## Key Observations');
  lines.push('');
  lines.push('(To be filled after reviewing results)');

  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  console.log('=== Ad-Hoc Scoring Variant Test Harness ===');
  console.log(`Variants: ${Array.from(config.variants).join(', ') || '(batch mode)'}`);
  if (config.batch) console.log(`Batch: ${config.batch}`);
  if (config.dryRun) console.log('MODE: DRY RUN');

  let pairs: BatchPair[] = [];

  if (config.batch === 'worst-pairs') {
    pairs = getWorstPairs();
    // In batch mode, enable all variants
    config.variants.add('baseline');
    config.variants.add('with-summary');
    config.variants.add('multi-doc');
    config.variants.add('patent-guided');
  } else if (config.patent && config.company && config.product) {
    const manifest = JSON.parse(fs.readFileSync(path.join(CONTROL_DIR, 'manifest.json'), 'utf-8'));
    const manifestPair = manifest.pairs.find((p: any) =>
      p.patentId === config.patent && p.companySlug === config.company
    );

    const glssd2Dir = path.join(GLSSD2_BASE, config.company!, config.product!);
    pairs = [{
      patentId: config.patent!,
      companySlug: config.company!,
      productSlug: config.product!,
      patlyticsScore: manifestPair?.patlyticsScore || 0,
      controlDocSlug: manifestPair?.docSlug || '',
      controlTextPath: manifestPair?.textPath || '',
      glssd2Dir: fs.existsSync(glssd2Dir) ? glssd2Dir : null,
    }];
  } else {
    console.error('Usage: --batch worst-pairs OR --patent <id> --company <slug> --product <slug>');
    process.exit(1);
  }

  console.log(`\nPairs to test: ${pairs.length}`);
  console.log(`Variants per pair: ${config.variants.size}`);

  // Show pair details
  for (const pair of pairs) {
    const docs = findProductDocs(pair.companySlug, pair.productSlug, pair.controlTextPath);
    const baseline = loadBaselineResult(pair.companySlug, pair.controlDocSlug, pair.patentId);
    const ss = resolveSuperSector(pair.patentId) || '?';
    console.log(`  ${pair.patentId} x ${pair.companySlug}/${pair.productSlug}`);
    console.log(`    Patlytics=${pair.patlyticsScore.toFixed(2)} Baseline=${baseline?.finalScore?.toFixed(2) || 'N/A'} SS=${ss} Docs=${docs.length} GLSSD2=${pair.glssd2Dir ? 'yes' : 'no'}`);
  }

  if (config.dryRun) {
    const totalCalls = pairs.length * config.variants.size * 2; // 2 passes each
    const estimatedCost = totalCalls * 0.03;
    console.log(`\nEstimated LLM calls: ${totalCalls} (${pairs.length} pairs x ${config.variants.size} variants x 2 passes)`);
    console.log(`Estimated cost: ~$${estimatedCost.toFixed(2)}`);
    console.log('\n(Dry run -- no LLM calls made)');
    return;
  }

  ensureDir(VARIANTS_DIR);
  ensureDir(LLM_IO_DIR);

  const comparisons: ComparisonResult[] = [];

  for (const pair of pairs) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`PAIR: ${pair.patentId} x ${pair.companySlug}/${pair.productSlug}`);
    console.log(`${'='.repeat(70)}`);

    if (!pair.controlTextPath || !fs.existsSync(pair.controlTextPath)) {
      console.log(`  SKIP: No control text found at ${pair.controlTextPath}`);
      continue;
    }

    const baseline = loadBaselineResult(pair.companySlug, pair.controlDocSlug, pair.patentId);
    const baselineScore = baseline?.finalScore ?? null;

    const comparison: ComparisonResult = {
      patentId: pair.patentId,
      companySlug: pair.companySlug,
      productSlug: pair.productSlug,
      patlyticsScore: pair.patlyticsScore,
      baselineScore,
      variants: {},
      bestVariant: 'baseline',
      bestError: baselineScore !== null ? Math.abs(pair.patlyticsScore - baselineScore) : 999,
    };

    // Output dir for this pair
    const pairDir = path.join(VARIANTS_DIR, pair.companySlug, pair.productSlug, pair.patentId);
    ensureDir(pairDir);

    for (const variant of Array.from(config.variants)) {
      // Check cache
      const variantFile = path.join(pairDir, `${variant}.json`);
      if (fs.existsSync(variantFile) && !config.force) {
        console.log(`  [${variant}] Loading cached result...`);
        const cached = JSON.parse(fs.readFileSync(variantFile, 'utf-8'));
        const error = Math.abs(pair.patlyticsScore - cached.finalScore);
        const baselineError = baselineScore !== null ? Math.abs(pair.patlyticsScore - baselineScore) : error;
        comparison.variants[variant] = {
          finalScore: cached.finalScore,
          error,
          improvement: baselineError - error,
          pass1Score: cached.pass1.compositeScore,
          pass2Score: cached.pass2?.compositeScore ?? null,
          docCount: cached.docCount,
        };
        if (error < comparison.bestError) {
          comparison.bestError = error;
          comparison.bestVariant = variant;
        }
        continue;
      }

      try {
        console.log(`\n  [${variant}] Scoring...`);
        const result = await scoreVariant(
          variant,
          pair.patentId,
          pair.companySlug,
          pair.productSlug,
          pair.controlTextPath,
          pair.controlDocSlug,
        );

        // Save result
        fs.writeFileSync(variantFile, JSON.stringify(result, null, 2));
        console.log(`    Saved → ${path.relative(process.cwd(), variantFile)}`);

        const error = Math.abs(pair.patlyticsScore - result.finalScore);
        const baselineError = baselineScore !== null ? Math.abs(pair.patlyticsScore - baselineScore) : error;

        comparison.variants[variant] = {
          finalScore: result.finalScore,
          error,
          improvement: baselineError - error,
          pass1Score: result.pass1.compositeScore,
          pass2Score: result.pass2?.compositeScore ?? null,
          docCount: result.docCount,
        };

        if (error < comparison.bestError) {
          comparison.bestError = error;
          comparison.bestVariant = variant;
        }
      } catch (err) {
        console.error(`    FAILED [${variant}]: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Save comparison
    const comparisonFile = path.join(pairDir, 'comparison.json');
    fs.writeFileSync(comparisonFile, JSON.stringify(comparison, null, 2));
    comparisons.push(comparison);

    // Print per-pair summary
    console.log(`\n  Summary for ${pair.patentId} x ${pair.companySlug}:`);
    console.log(`    Patlytics: ${pair.patlyticsScore.toFixed(2)}`);
    if (baselineScore !== null) {
      console.log(`    Cached baseline: ${baselineScore.toFixed(3)} (err=${Math.abs(pair.patlyticsScore - baselineScore).toFixed(3)})`);
    }
    for (const [v, vr] of Object.entries(comparison.variants)) {
      const arrow = vr.improvement > 0.01 ? '\u2191' : vr.improvement < -0.01 ? '\u2193' : '\u2192';
      console.log(`    ${v}: ${vr.finalScore.toFixed(3)} (err=${vr.error.toFixed(3)} ${arrow}${Math.abs(vr.improvement).toFixed(3)} docs=${vr.docCount})`);
    }
    console.log(`    Best: ${comparison.bestVariant} (err=${comparison.bestError.toFixed(3)})`);
  }

  // Generate report
  if (comparisons.length > 0) {
    const report = generateComparisonReport(comparisons);
    const reportPath = path.join(VARIANTS_DIR, 'comparison-report.md');
    fs.writeFileSync(reportPath, report);
    console.log(`\nReport saved to: ${reportPath}`);

    // Print summary table
    console.log(`\n${'='.repeat(70)}`);
    console.log('SUMMARY');
    console.log(`${'='.repeat(70)}`);
    console.log(`${'Pair'.padEnd(55)} ${'Patlyt'.padStart(6)} ${'Base'.padStart(6)} ${'Best'.padStart(6)} ${'Variant'.padStart(15)}`);
    console.log('\u2500'.repeat(90));
    for (const c of comparisons) {
      const pairLabel = `${c.companySlug}/${c.productSlug} x ${c.patentId}`;
      console.log(
        `${pairLabel.substring(0, 54).padEnd(55)} ${c.patlyticsScore.toFixed(2).padStart(6)} ${(c.baselineScore?.toFixed(2) || 'N/A').padStart(6)} ${(c.bestError.toFixed(3)).padStart(6)} ${c.bestVariant.padStart(15)}`
      );
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
