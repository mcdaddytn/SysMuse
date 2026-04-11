/**
 * V3 Two-pass internal infringement scoring engine.
 *
 * Uses 10-component template-based scoring (1-5 scale) with sector-specific
 * terminology mappings and guidance. Templates resolve: default → super-sector.
 *
 * Pass 1 (screening):  patent claims + 15K doc chars → 10 component scores
 * Pass 2 (deep):       ALL independent claims + full doc → 10 component scores
 * Final:               0.3 × pass1 + 0.7 × pass2
 *
 * Results cached to: cache/infringement-scores/{company}/{product}/{patentId}.json
 * LLM I/O saved to: cache/infringement-llm-io/{company}/{product}/{patentId}/
 * Also updates product cache: document.patentScores[patentId]
 *
 * Usage:
 *   npx tsx scripts/score-infringement.ts [options]
 *
 *   # Score specific patent against specific product
 *   --patent <id> --company <slug> --product <slug>
 *
 *   # Score all patents in a sector against all products for a company
 *   --sector <name> --company <slug>
 *
 *   # Bulk: all patent-target pairs from vendor summary that have product docs
 *   --from-targets <csv-path>
 *
 *   # Filter by super-sector (used with --from-targets)
 *   --super-sector <key>  e.g., SDN_NETWORK, WIRELESS, SECURITY
 *
 *   # Calibration mode: only score pairs that have existing Patlytics scores
 *   --calibrate
 *
 *   # Options
 *   --max-docs-per-product <n>  Cap docs per product (0 = no limit, default)
 *   --pass0-only           Run pass0 summary screening only (no pass1/pass2)
 *   --pass0                Enable pass0 as screening gate before pass1+pass2
 *   --pass0-threshold <n>  Pairs below this skip pass1+pass2 (default: 0.10)
 *   --pass1-only           Only run screening pass
 *   --min-pass1 <n>        Threshold for Pass 2 (default: 0.25)
 *   --multi-doc            Aggregate all GLSSD2 docs for pass2 (richer evidence)
 *   --concurrency <n>      Parallel LLM calls (default: 3)
 *   --dry-run              Show pairs without scoring
 *   --force                Re-score even if cached
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAllProductCaches,
  readProductCache,
  writeProductCache,
  slugify,
  normalizePatentId,
  type ProductCache,
  type DocumentPatentScore,
} from '../src/api/services/patlytics-cache-service.js';
import {
  extractClaimsText,
  findXmlPath,
  parsePatentClaims,
  type PatentClaim,
} from '../src/api/services/patent-xml-parser-service.js';

const anthropic = new Anthropic();

// ── Constants ──────────────────────────────────────────────────────────────

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const LLM_IO_DIR = path.resolve('./cache/infringement-llm-io');
const SUMMARIES_V2_DIR = path.resolve('./cache/product-summaries-v2');
const TEMPLATES_DIR = path.resolve('./config/infringement-templates');
const SUPER_SECTORS_CONFIG = path.resolve('./config/super-sectors.json');
const GLSSD2_BASE = '/Volumes/GLSSD2/data/products/docs';
const XML_DIR = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
const SOURCE_VERSION = 'internal-v3';
const MAX_DOC_TEXT_LENGTH = 300_000;
const PASS1_DOC_CHARS = 15_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;
const MODEL = 'claude-sonnet-4-20250514';

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

interface InfringementScore {
  patentId: string;
  companySlug: string;
  productSlug: string;
  documentSlug: string;
  documentName: string;
  superSector: string | null;
  templateVersion: number;
  pass0?: PassResult | null;
  pass1: PassResult;
  pass1Rationale: string;
  pass2: PassResult | null;
  finalScore: number;
  narrative: string | null;
  strongestClaim: number | null;
  keyGaps: string[] | null;
  model: string;
  sourceVersion: string;
  scoredAt: string;
  llmIoPath: string;
}

interface ScoringPair {
  patentId: string;
  companySlug: string;
  companyName: string;
  productSlug: string;
  productName: string;
  documentName: string;
  docSlug: string;
  textPath: string;
  summaryPath: string | null;
  sector: string | null;
}

interface Config {
  patent: string | null;
  company: string | null;
  product: string | null;
  sector: string | null;
  superSector: string | null;
  fromTargets: string | null;
  calibrate: boolean;
  pass0Only: boolean;
  pass0: boolean;
  pass0Threshold: number;
  pass1Only: boolean;
  minPass1: number;
  maxDocsPerProduct: number;
  concurrency: number;
  dryRun: boolean;
  force: boolean;
  multiDoc: boolean;
}

// ── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    patent: null,
    company: null,
    product: null,
    sector: null,
    superSector: null,
    fromTargets: null,
    calibrate: false,
    pass0Only: false,
    pass0: false,
    pass0Threshold: 0.10,
    pass1Only: false,
    minPass1: 0.25,
    maxDocsPerProduct: 0,
    concurrency: 3,
    dryRun: false,
    force: false,
    multiDoc: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--patent' && args[i + 1]) config.patent = args[++i];
    else if (arg === '--company' && args[i + 1]) config.company = args[++i];
    else if (arg === '--product' && args[i + 1]) config.product = args[++i];
    else if (arg === '--sector' && args[i + 1]) config.sector = args[++i];
    else if (arg === '--super-sector' && args[i + 1]) config.superSector = args[++i];
    else if (arg === '--from-targets' && args[i + 1]) config.fromTargets = args[++i];
    else if (arg === '--calibrate') config.calibrate = true;
    else if (arg === '--pass0-only') config.pass0Only = true;
    else if (arg === '--pass0') config.pass0 = true;
    else if (arg === '--pass0-threshold' && args[i + 1]) config.pass0Threshold = parseFloat(args[++i]);
    else if (arg === '--pass1-only') config.pass1Only = true;
    else if (arg === '--min-pass1' && args[i + 1]) config.minPass1 = parseFloat(args[++i]);
    else if (arg === '--max-docs-per-product' && args[i + 1]) config.maxDocsPerProduct = parseInt(args[++i], 10);
    else if (arg === '--concurrency' && args[i + 1]) config.concurrency = parseInt(args[++i], 10);
    else if (arg === '--dry-run') config.dryRun = true;
    else if (arg === '--force') config.force = true;
    else if (arg === '--multi-doc') config.multiDoc = true;
  }

  return config;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** Cap docs per product by file size (prefer richest docs). Returns the capped array. */
function capDocsBySize<T extends { textPath: string }>(docs: T[], maxDocs: number): T[] {
  if (maxDocs <= 0 || docs.length <= maxDocs) return docs;
  return docs
    .map(d => {
      let size = 0;
      try { size = fs.statSync(d.textPath).size; } catch {}
      return { doc: d, size };
    })
    .sort((a, b) => b.size - a.size)
    .slice(0, maxDocs)
    .map(d => d.doc);
}

function scoreCachePath(companySlug: string, productSlug: string, patentId: string): string {
  return path.join(SCORES_DIR, companySlug, productSlug, `${patentId}.json`);
}

function readScoreCache(companySlug: string, productSlug: string, patentId: string): InfringementScore | null {
  const filePath = scoreCachePath(companySlug, productSlug, patentId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeScoreCache(score: InfringementScore): void {
  const filePath = scoreCachePath(score.companySlug, score.productSlug, score.patentId);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(score, null, 2));
}

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

/** Map sector name → super-sector key using config/super-sectors.json */
function sectorToSuperSector(sectorName: string): string | null {
  const config = getSuperSectorConfig();
  for (const [key, ss] of Object.entries(config.superSectors) as [string, any][]) {
    if (ss.sectors.includes(sectorName)) return key;
  }
  return config.unmappedSectorDefault || null;
}

/** Map CPC codes → sector (longest prefix match) → super-sector using taxonomy config */
function cpcToSuperSector(patentId: string): string | null {
  try {
    const patentPath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (!fs.existsSync(patentPath)) return null;
    const patent = JSON.parse(fs.readFileSync(patentPath, 'utf-8'));
    const cpcs: string[] = (patent.cpc_current || []).map((c: any) => c.cpc_group_id || c.cpc_subclass_id || '');
    if (cpcs.length === 0) return null;

    const taxonomy = getTaxonomyConfig();

    // Build flat list of (cpcPrefix, sectorKey) sorted by prefix length desc
    const prefixMap: Array<{ prefix: string; sector: string }> = [];
    for (const [sectorKey, sectorData] of Object.entries(taxonomy.sectors) as [string, any][]) {
      for (const prefix of sectorData.cpcPrefixes || []) {
        prefixMap.push({ prefix: prefix.replace(/\/$/, ''), sector: sectorKey });
      }
    }
    prefixMap.sort((a, b) => b.prefix.length - a.prefix.length);

    // Longest CPC prefix match across all patent CPC codes
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

function loadPatentAbstract(patentId: string): string | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8')).patent_abstract || null;
    }
  } catch {}
  return null;
}

function loadPatentClaims(patentId: string): PatentClaim[] {
  if (!XML_DIR) return [];
  const xmlPath = findXmlPath(patentId, XML_DIR);
  if (!xmlPath) return [];
  return parsePatentClaims(xmlPath).independentClaims;
}

function formatClaimsForPrompt(claims: PatentClaim[], maxClaims: number = 5): string {
  return claims.slice(0, maxClaims).map(c => `Claim ${c.number}: ${c.text}`).join('\n\n');
}

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

// ── Multi-Doc Aggregation (GLSSD2) ──────────────────────────────────────────

interface DocSource {
  filename: string;
  path: string;
  type: 'txt' | 'html';
  size: number;
}

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

function readDocText(doc: DocSource): string {
  const raw = fs.readFileSync(doc.path, 'utf-8');
  if (doc.type === 'html') return stripHtml(raw);
  return raw;
}

/** Find all readable doc files for a product from GLSSD2. */
function findGlssd2Docs(companySlug: string, productSlug: string): DocSource[] {
  const docs: DocSource[] = [];
  const glssd2Dir = path.join(GLSSD2_BASE, companySlug, productSlug);
  if (!fs.existsSync(glssd2Dir)) return docs;

  const seen = new Set<string>();
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
    } else if (ext === '.pdf') {
      const txtSibling = fullPath.replace(/\.pdf$/, '.txt');
      if (fs.existsSync(txtSibling) && !seen.has(file.replace(/\.pdf$/, '.txt'))) {
        docs.push({ filename: file.replace(/\.pdf$/, '.txt'), path: txtSibling, type: 'txt', size: fs.statSync(txtSibling).size });
        seen.add(file.replace(/\.pdf$/, '.txt'));
      }
    }
  }

  return docs;
}

/** Aggregate all product docs into a single text blob for pass2 */
function aggregateProductDocs(docs: DocSource[], primaryTextPath: string, maxTotalLength: number = MAX_DOC_TEXT_LENGTH): string {
  const parts: string[] = [];
  let totalLen = 0;
  const primaryBasename = path.basename(primaryTextPath);

  // Put the primary doc first
  for (const doc of docs) {
    if (doc.filename === primaryBasename || doc.path === primaryTextPath) continue;
    // Process non-primary docs below
  }

  // Start with primary doc text
  if (fs.existsSync(primaryTextPath)) {
    const primaryText = fs.readFileSync(primaryTextPath, 'utf-8');
    const header = `\n--- Primary Document ---\n`;
    parts.push(header + primaryText);
    totalLen += header.length + primaryText.length;
  }

  // Add supplementary docs
  for (const doc of docs) {
    if (doc.filename === primaryBasename || doc.path === primaryTextPath) continue;
    const text = readDocText(doc);
    if (text.length < 100) continue;

    const header = `\n--- Supplementary: ${doc.filename} (${(doc.size / 1024).toFixed(1)}KB) ---\n`;
    if (totalLen + text.length + header.length > maxTotalLength) {
      const remaining = maxTotalLength - totalLen - header.length - 50;
      if (remaining > 500) {
        parts.push(header + text.substring(0, remaining) + '\n[... truncated ...]');
      }
      break;
    }

    parts.push(header + text);
    totalLen += header.length + text.length;
  }

  return parts.join('\n');
}

// ── LLM Calls ──────────────────────────────────────────────────────────────

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
      const isRetryable = status === 429 || status === 529 || err?.message?.includes('overloaded');
      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt + 1) * RETRY_BASE_DELAY;
        console.log(`    Rate limited, retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  if (!response) throw new Error('No response from LLM');

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
  throw new Error(`Failed to parse LLM JSON: ${text.substring(0, 200)}`);
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
  fs.writeFileSync(path.join(dir, `${ts}-${passName}-prompt.txt`), prompt);
  fs.writeFileSync(path.join(dir, `${ts}-${passName}-response.json`), JSON.stringify({
    rawText: result.text,
    parsed,
    model: MODEL,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    durationMs: result.durationMs,
  }, null, 2));
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

  parts.push(`You are a patent infringement analyst. Assess whether a product's capabilities align with patent claims by scoring ${template.questions.length} specific dimensions.`);

  if (template.scoringGuidance.length > 0) {
    parts.push('\n## Scoring Guidelines\n');
    parts.push(template.scoringGuidance.map(g => `- ${g}`).join('\n'));
  }

  if (template.terminologyMappings && template.terminologyMappings.length > 0) {
    parts.push('\n## Terminology Mappings (Patent → Product)\n');
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

  const docLabel = passName === 'pass0' ? ' (summary only)' : passName === 'pass1' ? ' (first 15K chars)' : '';
  parts.push(`\n## Product Documentation${docLabel}\n`);
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

// ── Pair Discovery ─────────────────────────────────────────────────────────

function discoverCalibrationPairs(): ScoringPair[] {
  const pairs: ScoringPair[] = [];
  const products = getAllProductCaches();

  for (const productMeta of products) {
    const product = readProductCache(productMeta.companySlug, productMeta.productSlug);
    if (!product) continue;

    for (const doc of product.documents) {
      if (!doc.patentScores || Object.keys(doc.patentScores).length === 0) continue;
      if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

      const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
      const docSlug = slugify(doc.documentName || docBase);
      const textPath = (doc as any).extractedTextPath ||
        path.join(path.dirname(doc.localPath), `${docBase}.txt`);
      if (!fs.existsSync(textPath)) continue;

      const summaryFile = path.join(SUMMARIES_V2_DIR, product.companySlug, product.productSlug, `${docSlug}.json`);

      for (const patentId of Object.keys(doc.patentScores)) {
        const existing = doc.patentScores[patentId];
        if (existing.sourceFile === SOURCE_VERSION) continue;

        pairs.push({
          patentId,
          companySlug: product.companySlug,
          companyName: product.companyName,
          productSlug: product.productSlug,
          productName: product.productName,
          documentName: doc.documentName,
          docSlug,
          textPath,
          summaryPath: fs.existsSync(summaryFile) ? summaryFile : null,
          sector: null,
        });
      }
    }
  }
  return pairs;
}

function discoverPairsForPatentProduct(
  patentId: string,
  companySlug: string,
  productSlug: string,
  maxDocsPerProduct: number = 0,
): ScoringPair[] {
  const pairs: ScoringPair[] = [];
  const product = readProductCache(companySlug, productSlug);
  if (!product) return pairs;

  for (const doc of product.documents) {
    if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

    const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
    const docSlug = slugify(doc.documentName || docBase);
    const textPath = (doc as any).extractedTextPath ||
      path.join(path.dirname(doc.localPath), `${docBase}.txt`);
    if (!fs.existsSync(textPath)) continue;

    const summaryFile = path.join(SUMMARIES_V2_DIR, companySlug, productSlug, `${docSlug}.json`);

    pairs.push({
      patentId,
      companySlug: product.companySlug,
      companyName: product.companyName,
      productSlug: product.productSlug,
      productName: product.productName,
      documentName: doc.documentName,
      docSlug,
      textPath,
      summaryPath: fs.existsSync(summaryFile) ? summaryFile : null,
      sector: null,
    });
  }
  return capDocsBySize(pairs, maxDocsPerProduct);
}

function discoverPairsFromTargets(csvPath: string, superSectorFilter: string | null, maxDocsPerProduct: number = 0): ScoringPair[] {
  const pairs: ScoringPair[] = [];
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const findCol = (...names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const patentIdx = findCol('patent_id', 'PatentId', 'patentId');
  const companyIdx = findCol('company_slug', 'target_company_slug', 'Target');
  const productIdx = findCol('product_slug', 'target_product_slug', 'TargetProduct');
  const sectorIdx = findCol('Sector', 'sector', 'sector_name');

  if (patentIdx === -1 || companyIdx === -1) {
    console.error(`CSV must have patent_id/PatentId and company_slug/Target columns. Found: ${header.join(', ')}`);
    return pairs;
  }

  // Build super-sector lookup if filtering
  let sectorToSS: Map<string, string> | null = null;
  if (superSectorFilter) {
    sectorToSS = new Map();
    const ssConfig = getSuperSectorConfig();
    for (const [key, ss] of Object.entries(ssConfig.superSectors) as [string, any][]) {
      for (const sector of ss.sectors) {
        sectorToSS.set(sector, key);
      }
    }
  }

  // Load all product caches once
  console.log('Loading product caches...');
  const allProducts = getAllProductCaches();
  const productsByCompany = new Map<string, ProductCache[]>();
  for (const p of allProducts) {
    const existing = productsByCompany.get(p.companySlug) || [];
    existing.push(p);
    productsByCompany.set(p.companySlug, existing);
  }
  console.log(`  Loaded ${allProducts.length} products across ${productsByCompany.size} companies`);

  const productDocsMap = new Map<string, ScoringPair[]>();
  let filteredBySuperSector = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const rawPatentId = cols[patentIdx];
    const rawCompany = cols[companyIdx];
    const rawProduct = productIdx !== -1 ? cols[productIdx] : null;
    const sectorName = sectorIdx !== -1 ? cols[sectorIdx] : null;

    if (!rawPatentId || !rawCompany) continue;

    // Super-sector filter
    if (superSectorFilter && sectorToSS && sectorName) {
      const pairSS = sectorToSS.get(sectorName);
      if (pairSS !== superSectorFilter) {
        filteredBySuperSector++;
        continue;
      }
    }

    const patentId = normalizePatentId(rawPatentId).patentId;
    const companySlug = slugify(rawCompany);
    const productSlug = rawProduct ? slugify(rawProduct) : null;

    const cacheKey = productSlug ? `${companySlug}/${productSlug}` : companySlug;

    if (!productDocsMap.has(cacheKey)) {
      let products = productsByCompany.get(companySlug) || [];
      if (productSlug) products = products.filter(p => p.productSlug === productSlug);

      const docPairs: ScoringPair[] = [];
      const seenDocKeys = new Set<string>();

      // 1) Patlytics product cache docs
      for (const product of products) {
        for (const doc of product.documents) {
          if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

          const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
          const docSlug = slugify(doc.documentName || docBase);
          const textPath = (doc as any).extractedTextPath ||
            path.join(path.dirname(doc.localPath), `${docBase}.txt`);
          if (!fs.existsSync(textPath)) continue;

          const docKey = `${product.companySlug}/${product.productSlug}/${docSlug}`;
          if (seenDocKeys.has(docKey)) continue;
          seenDocKeys.add(docKey);

          const summaryFile = path.join(SUMMARIES_V2_DIR, product.companySlug, product.productSlug, `${docSlug}.json`);

          docPairs.push({
            patentId: '',
            companySlug: product.companySlug,
            companyName: product.companyName,
            productSlug: product.productSlug,
            productName: product.productName,
            documentName: doc.documentName,
            docSlug,
            textPath,
            summaryPath: fs.existsSync(summaryFile) ? summaryFile : null,
            sector: null,
          });
        }
      }

      // 2) GLSSD2 docs (supplements Patlytics cache)
      if (fs.existsSync(GLSSD2_BASE)) {
        const glssd2CompanyDir = path.join(GLSSD2_BASE, companySlug);
        if (fs.existsSync(glssd2CompanyDir)) {
          let glssd2Products: string[];
          try {
            glssd2Products = fs.readdirSync(glssd2CompanyDir).filter(d => {
              if (d.startsWith('.') || d.startsWith('._')) return false;
              try { return fs.statSync(path.join(glssd2CompanyDir, d)).isDirectory(); } catch { return false; }
            });
          } catch { glssd2Products = []; }
          if (productSlug) glssd2Products = glssd2Products.filter(d => d === productSlug);

          for (const gProductSlug of glssd2Products) {
            const gProductDir = path.join(glssd2CompanyDir, gProductSlug);
            let files: string[];
            try { files = fs.readdirSync(gProductDir).filter(f => !f.startsWith('._')); } catch { continue; }

            for (const file of files) {
              const ext = path.extname(file).toLowerCase();
              if (ext !== '.txt' && ext !== '.html') continue;

              const fullPath = path.join(gProductDir, file);
              const gDocBase = path.basename(file, ext);
              const gDocSlug = slugify(gDocBase);
              const docKey = `${companySlug}/${gProductSlug}/${gDocSlug}`;
              if (seenDocKeys.has(docKey)) continue;
              seenDocKeys.add(docKey);

              const summaryFile = path.join(SUMMARIES_V2_DIR, companySlug, gProductSlug, `${gDocSlug}.json`);

              docPairs.push({
                patentId: '',
                companySlug,
                companyName: rawCompany,
                productSlug: gProductSlug,
                productName: gProductSlug,
                documentName: gDocBase,
                docSlug: gDocSlug,
                textPath: fullPath,
                summaryPath: fs.existsSync(summaryFile) ? summaryFile : null,
                sector: null,
              });
            }
          }
        }
      }

      productDocsMap.set(cacheKey, capDocsBySize(docPairs, maxDocsPerProduct));
    }

    const docTemplates = productDocsMap.get(cacheKey) || [];
    for (const template of docTemplates) {
      pairs.push({ ...template, patentId, sector: sectorName || null });
    }
  }

  if (superSectorFilter) {
    console.log(`  Filtered out ${filteredBySuperSector} pairs not in ${superSectorFilter}`);
  }

  return pairs;
}

function discoverPairsForSectorCompany(sector: string, companySlug: string, maxDocsPerProduct: number = 0): ScoringPair[] {
  const sectorScoresDir = path.resolve('./cache/patent-sector-scores');
  const sectorFile = path.join(sectorScoresDir, `${sector}.json`);

  if (!fs.existsSync(sectorFile)) {
    console.error(`Sector file not found: ${sectorFile}`);
    return [];
  }

  const sectorData = JSON.parse(fs.readFileSync(sectorFile, 'utf-8'));
  const patentIds: string[] = (sectorData.patents || []).map((p: any) => p.patent_id || p.patentId);

  const pairs: ScoringPair[] = [];
  const products = getAllProductCaches().filter(p => p.companySlug === companySlug);

  for (const pm of products) {
    const product = readProductCache(pm.companySlug, pm.productSlug);
    if (!product) continue;

    // Collect docs for this product, then cap
    let productDocs: Array<{ docSlug: string; documentName: string; textPath: string; summaryPath: string | null }> = [];
    for (const doc of product.documents) {
      if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

      const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
      const docSlug = slugify(doc.documentName || docBase);
      const textPath = (doc as any).extractedTextPath ||
        path.join(path.dirname(doc.localPath), `${docBase}.txt`);
      if (!fs.existsSync(textPath)) continue;

      const summaryFile = path.join(SUMMARIES_V2_DIR, product.companySlug, product.productSlug, `${docSlug}.json`);
      productDocs.push({
        docSlug,
        documentName: doc.documentName,
        textPath,
        summaryPath: fs.existsSync(summaryFile) ? summaryFile : null,
      });
    }

    productDocs = capDocsBySize(productDocs, maxDocsPerProduct);

    for (const doc of productDocs) {
      for (const patentId of patentIds) {
        pairs.push({
          patentId,
          companySlug: product.companySlug,
          companyName: product.companyName,
          productSlug: product.productSlug,
          productName: product.productName,
          documentName: doc.documentName,
          docSlug: doc.docSlug,
          textPath: doc.textPath,
          summaryPath: doc.summaryPath,
          sector,
        });
      }
    }
  }
  return pairs;
}

// ── Scoring Pipeline ───────────────────────────────────────────────────────

const MIN_DOC_TEXT_BYTES = 500;

async function scorePair(pair: ScoringPair, config: Config): Promise<InfringementScore | null> {
  try {
    const stat = fs.statSync(pair.textPath);
    if (stat.size < MIN_DOC_TEXT_BYTES) {
      console.log(`    Skipping ${pair.docSlug} — text too small (${stat.size} bytes)`);
      return null;
    }
  } catch { return null; }

  const claims = loadPatentClaims(pair.patentId);
  if (claims.length === 0) {
    console.log(`    No claims found for patent ${pair.patentId}, skipping`);
    return null;
  }

  // Resolve super-sector: from sector name (CSV), or CPC codes
  let superSector: string | null = null;
  if (pair.sector) {
    superSector = sectorToSuperSector(pair.sector);
  }
  if (!superSector) {
    superSector = cpcToSuperSector(pair.patentId);
  }

  const template = resolveTemplate(superSector);
  const claimsText = formatClaimsForPrompt(claims, 5);
  const abstract = loadPatentAbstract(pair.patentId);

  const rawText = fs.readFileSync(pair.textPath, 'utf-8');

  // ── Pass 0: summary-only screening (cheap pre-filter) ──
  let pass0Result: PassResult | null = null;

  if ((config.pass0 || config.pass0Only) && pair.summaryPath) {
    const summary = loadProductSummary(pair.companySlug, pair.productSlug, pair.docSlug);
    const summaryText = formatSummaryForPrompt(summary);

    if (summaryText) {
      console.log(`    Pass 0: ${pair.patentId} × ${pair.documentName} (summary screen)`);
      const p0Prompt = buildInfringementPrompt(template, claimsText, abstract, summaryText, 'pass0');
      const p0Response = await callLLM(p0Prompt, 4096);
      const p0Parsed = parseJSON(p0Response.text);
      pass0Result = computePassResult(p0Parsed, template.questions);

      saveLLMIO(pair.companySlug, pair.productSlug, pair.patentId, 'pass0', p0Prompt, p0Response, p0Parsed);
      console.log(`      P0=${pass0Result.compositeScore.toFixed(2)} (SS=${superSector || '?'})`);

      if (config.pass0Only) {
        // Return pass0 as the final score — no pass1/pass2
        const topComp = Object.entries(pass0Result.components)
          .sort((a, b) => b[1].normalized - a[1].normalized)
          .slice(0, 3)
          .map(([name, c]) => `${name}=${c.score}/5`).join(', ');
        return {
          patentId: pair.patentId,
          companySlug: pair.companySlug,
          productSlug: pair.productSlug,
          documentSlug: pair.docSlug,
          documentName: pair.documentName,
          superSector,
          templateVersion: template.version,
          pass0: pass0Result,
          pass1: pass0Result,
          pass1Rationale: `pass0-only: ${topComp}`,
          pass2: null,
          finalScore: pass0Result.compositeScore,
          narrative: null,
          strongestClaim: null,
          keyGaps: null,
          model: MODEL,
          sourceVersion: SOURCE_VERSION,
          scoredAt: new Date().toISOString(),
          llmIoPath: path.join(LLM_IO_DIR, pair.companySlug, pair.productSlug, pair.patentId),
        };
      }

      if (pass0Result.compositeScore < config.pass0Threshold) {
        console.log(`      Pass0 filtered (${pass0Result.compositeScore.toFixed(2)} < ${config.pass0Threshold})`);
        return {
          patentId: pair.patentId,
          companySlug: pair.companySlug,
          productSlug: pair.productSlug,
          documentSlug: pair.docSlug,
          documentName: pair.documentName,
          superSector,
          templateVersion: template.version,
          pass0: pass0Result,
          pass1: pass0Result,
          pass1Rationale: 'pass0-filtered',
          pass2: null,
          finalScore: pass0Result.compositeScore,
          narrative: null,
          strongestClaim: null,
          keyGaps: null,
          model: MODEL,
          sourceVersion: SOURCE_VERSION,
          scoredAt: new Date().toISOString(),
          llmIoPath: path.join(LLM_IO_DIR, pair.companySlug, pair.productSlug, pair.patentId),
        };
      }
      // Pass0 passed threshold — fall through to pass1
    } else {
      console.log(`    Skipped pass0 (no summary text) for ${pair.docSlug}`);
    }
  } else if ((config.pass0 || config.pass0Only) && !pair.summaryPath) {
    if (config.pass0Only) {
      console.log(`    Skipped pass0-only (no summary) for ${pair.docSlug}`);
      return null;
    }
    console.log(`    Skipped pass0 (no summary) for ${pair.docSlug}`);
  }

  // ── Pass 1: first 15K of doc ──
  const pass1DocText = rawText.substring(0, PASS1_DOC_CHARS);
  console.log(`    Pass 1: ${pair.patentId} × ${pair.documentName}`);
  const p1Prompt = buildInfringementPrompt(template, claimsText, abstract, pass1DocText, 'pass1');
  const p1Response = await callLLM(p1Prompt, 4096);
  const p1Parsed = parseJSON(p1Response.text);
  const pass1 = computePassResult(p1Parsed, template.questions);

  saveLLMIO(pair.companySlug, pair.productSlug, pair.patentId, 'pass1', p1Prompt, p1Response, p1Parsed);
  console.log(`      P1=${pass1.compositeScore.toFixed(2)} (SS=${superSector || '?'})`);

  // Build pass1 rationale from top components
  const topComponents = Object.entries(pass1.components)
    .sort((a, b) => b[1].normalized - a[1].normalized)
    .slice(0, 3);
  const pass1Rationale = topComponents.map(([name, c]) =>
    `${name}=${c.score}/5`
  ).join(', ');

  const result: InfringementScore = {
    patentId: pair.patentId,
    companySlug: pair.companySlug,
    productSlug: pair.productSlug,
    documentSlug: pair.docSlug,
    documentName: pair.documentName,
    superSector,
    templateVersion: template.version,
    pass0: pass0Result,
    pass1,
    pass1Rationale,
    pass2: null,
    finalScore: pass1.compositeScore,
    narrative: null,
    strongestClaim: null,
    keyGaps: null,
    model: MODEL,
    sourceVersion: SOURCE_VERSION,
    scoredAt: new Date().toISOString(),
    llmIoPath: path.join(LLM_IO_DIR, pair.companySlug, pair.productSlug, pair.patentId),
  };

  // ── Pass 2: deep analysis if above threshold ──
  if (!config.pass1Only && pass1.compositeScore >= config.minPass1) {
    console.log(`    Pass 2: Deep analysis (pass1 ${pass1.compositeScore.toFixed(2)} >= ${config.minPass1})`);
    const allClaimsText = formatClaimsForPrompt(claims, 10);

    // Build pass2 doc text: multi-doc aggregation or single-doc
    let pass2DocText: string;
    if (config.multiDoc) {
      const glssd2Docs = findGlssd2Docs(pair.companySlug, pair.productSlug);
      if (glssd2Docs.length > 1) {
        pass2DocText = aggregateProductDocs(glssd2Docs, pair.textPath, MAX_DOC_TEXT_LENGTH);
        console.log(`      Multi-doc: ${glssd2Docs.length} docs aggregated (${(pass2DocText.length / 1024).toFixed(0)}KB)`);
      } else {
        pass2DocText = rawText.length > MAX_DOC_TEXT_LENGTH
          ? rawText.substring(0, MAX_DOC_TEXT_LENGTH) + '\n\n[... document truncated ...]'
          : rawText;
      }
    } else {
      pass2DocText = rawText.length > MAX_DOC_TEXT_LENGTH
        ? rawText.substring(0, MAX_DOC_TEXT_LENGTH) + '\n\n[... document truncated ...]'
        : rawText;
    }

    const p2Prompt = buildInfringementPrompt(template, allClaimsText, abstract, pass2DocText, 'pass2');
    const p2Response = await callLLM(p2Prompt, 8192);
    const p2Parsed = parseJSON(p2Response.text);
    const pass2 = computePassResult(p2Parsed, template.questions);

    saveLLMIO(pair.companySlug, pair.productSlug, pair.patentId, 'pass2', p2Prompt, p2Response, p2Parsed);

    result.pass2 = pass2;
    // Blend: 0.3 × pass1 + 0.7 × pass2
    result.finalScore = Math.round((pass1.compositeScore * 0.3 + pass2.compositeScore * 0.7) * 1000) / 1000;

    // Extract narrative from holistic assessment
    const holistic = pass2.components['overall_infringement_likelihood'];
    result.narrative = holistic?.reasoning || null;

    // Extract key gaps from claim element coverage reasoning
    const coverage = pass2.components['claim_element_coverage'];
    if (coverage?.reasoning) {
      const gapMatch = coverage.reasoning.match(/missing|not found|absent|gap|lack/i);
      if (gapMatch) result.keyGaps = [coverage.reasoning];
    }

    console.log(`      P2=${pass2.compositeScore.toFixed(2)}, Final=${result.finalScore.toFixed(2)}`);
  }

  return result;
}

// ── Product Cache Update ───────────────────────────────────────────────────

function updateProductCache(score: InfringementScore): void {
  const product = readProductCache(score.companySlug, score.productSlug);
  if (!product) return;

  for (const doc of product.documents) {
    const docBase = doc.localPath ? path.basename(doc.localPath, path.extname(doc.localPath)) : '';
    const docSlug = slugify(doc.documentName || docBase);

    if (docSlug === score.documentSlug) {
      if (!doc.patentScores) doc.patentScores = {};

      doc.patentScores[score.patentId] = {
        score: score.finalScore,
        narrative: score.narrative ?? score.pass1Rationale,
        sourceFile: SOURCE_VERSION,
      } as DocumentPatentScore;

      writeProductCache(score.companySlug, score.productSlug, product);
      return;
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  console.log('=== V3 Internal Infringement Scoring Engine ===');
  console.log(`XML Dir: ${XML_DIR || '(not set)'}`);
  console.log(`Pass 1 threshold: ${config.minPass1}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log(`Templates: ${TEMPLATES_DIR}/`);
  console.log(`LLM I/O: ${LLM_IO_DIR}/`);
  if (config.pass0Only) console.log('MODE: Pass 0 only (summary screening)');
  else if (config.pass0) console.log(`MODE: Pass 0 gate (threshold: ${config.pass0Threshold})`);
  if (config.pass1Only) console.log('MODE: Pass 1 only (screening)');
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.force) console.log('MODE: FORCE (re-score all)');
  if (config.calibrate) console.log('MODE: CALIBRATION (Patlytics-scored pairs only)');
  if (config.maxDocsPerProduct > 0) console.log(`DOC CAP: max ${config.maxDocsPerProduct} docs per product`);
  if (config.superSector) console.log(`FILTER: Super-sector = ${config.superSector}`);

  // Discover pairs
  let pairs: ScoringPair[] = [];

  if (config.calibrate) {
    pairs = discoverCalibrationPairs();
    console.log(`\nCalibration pairs found: ${pairs.length}`);
  } else if (config.patent && config.company && config.product) {
    pairs = discoverPairsForPatentProduct(config.patent, config.company, config.product, config.maxDocsPerProduct);
    console.log(`\nPairs for patent ${config.patent} × ${config.company}/${config.product}: ${pairs.length}`);
  } else if (config.sector && config.company) {
    pairs = discoverPairsForSectorCompany(config.sector, config.company, config.maxDocsPerProduct);
    console.log(`\nPairs for sector ${config.sector} × ${config.company}: ${pairs.length}`);
  } else if (config.fromTargets) {
    pairs = discoverPairsFromTargets(config.fromTargets, config.superSector, config.maxDocsPerProduct);
    console.log(`\nPairs from targets CSV: ${pairs.length}`);
  } else {
    console.error('\nError: Specify --calibrate, --patent+--company+--product, --sector+--company, or --from-targets');
    process.exit(1);
  }

  // Filter cached
  if (!config.force) {
    const before = pairs.length;
    pairs = pairs.filter(p => !readScoreCache(p.companySlug, p.productSlug, p.patentId));
    if (before !== pairs.length) {
      console.log(`Filtered to ${pairs.length} uncached pairs (${before - pairs.length} already scored)`);
    }
  }

  if (pairs.length === 0) {
    console.log('No pairs to score.');
    return;
  }

  if (config.dryRun) {
    const byCompany = new Map<string, number>();
    const bySuperSector = new Map<string, number>();
    for (const p of pairs) {
      byCompany.set(p.companyName, (byCompany.get(p.companyName) || 0) + 1);
      const ss = p.sector ? (sectorToSuperSector(p.sector) || 'UNKNOWN') : (cpcToSuperSector(p.patentId) || 'UNKNOWN');
      bySuperSector.set(ss, (bySuperSector.get(ss) || 0) + 1);
    }
    console.log('\nPairs by company:');
    for (const [company, count] of [...byCompany.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${company}: ${count} pairs`);
    }
    console.log('\nPairs by super-sector:');
    for (const [ss, count] of [...bySuperSector.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ss}: ${count} pairs`);
    }

    const pass1Cost = pairs.length * 0.01;
    const estimatedPass2 = Math.round(pairs.length * 0.3);
    const pass2Cost = estimatedPass2 * 0.05;
    console.log(`\nEstimated costs:`);
    console.log(`  Pass 1 screening: ${pairs.length} pairs × $0.01 = $${pass1Cost.toFixed(2)}`);
    console.log(`  Pass 2 deep (~30%): ~${estimatedPass2} pairs × $0.05 = $${pass2Cost.toFixed(2)}`);
    console.log(`  Total: ~$${(pass1Cost + pass2Cost).toFixed(2)}`);
    console.log('\n(Dry run — no LLM calls made)');
    return;
  }

  // Process in concurrent batches
  let completed = 0;
  let failed = 0;
  let pass2Count = 0;
  let pass0Screened = 0;
  let pass0Filtered = 0;
  let pass0NoSummary = 0;

  for (let i = 0; i < pairs.length; i += config.concurrency) {
    const batch = pairs.slice(i, i + config.concurrency);
    console.log(`\n--- Batch ${Math.floor(i / config.concurrency) + 1}/${Math.ceil(pairs.length / config.concurrency)} (${batch.length} pairs) ---`);

    const promises = batch.map(async (pair) => {
      try {
        const result = await scorePair(pair, config);
        if (!result) {
          if ((config.pass0 || config.pass0Only) && !pair.summaryPath) pass0NoSummary++;
          return;
        }

        // Track pass0 stats
        if (result.pass0) {
          pass0Screened++;
          if (result.pass1Rationale === 'pass0-filtered') pass0Filtered++;
        }

        writeScoreCache(result);
        updateProductCache(result);

        completed++;
        if (result.pass2 !== null) pass2Count++;
      } catch (err) {
        console.error(`    Failed ${pair.patentId}×${pair.docSlug}: ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    });

    await Promise.all(promises);
  }

  console.log('\n=== Scoring Complete ===');
  console.log(`Completed: ${completed} (${pass2Count} went to Pass 2)`);
  if (config.pass0 || config.pass0Only) {
    console.log(`Pass0: screened ${pass0Screened}, filtered ${pass0Filtered} (below ${config.pass0Threshold}), ${pass0NoSummary} skipped (no summary)`);
  }
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${pairs.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
