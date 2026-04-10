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
 *   --pass1-only           Only run screening pass
 *   --min-pass1 <n>        Threshold for Pass 2 (default: 0.25)
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
  pass1Only: boolean;
  minPass1: number;
  concurrency: number;
  dryRun: boolean;
  force: boolean;
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
    pass1Only: false,
    minPass1: 0.25,
    concurrency: 3,
    dryRun: false,
    force: false,
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
    else if (arg === '--pass1-only') config.pass1Only = true;
    else if (arg === '--min-pass1' && args[i + 1]) config.minPass1 = parseFloat(args[++i]);
    else if (arg === '--concurrency' && args[i + 1]) config.concurrency = parseInt(args[++i], 10);
    else if (arg === '--dry-run') config.dryRun = true;
    else if (arg === '--force') config.force = true;
  }

  return config;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
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

// ── Super-Sector Resolution ────────────────────────────────────────────────

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

/** Map CPC codes to super-sector using heuristic */
function cpcToSuperSector(patentId: string): string | null {
  try {
    const patentPath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (!fs.existsSync(patentPath)) return null;
    const patent = JSON.parse(fs.readFileSync(patentPath, 'utf-8'));
    const cpcs: string[] = (patent.cpc_current || []).map((c: any) => c.cpc_group_id || c.cpc_subclass_id || '');

    const subclasses = new Set(cpcs.map(c => c.substring(0, 4)));
    if (subclasses.has('H04L')) {
      const securityGroups = cpcs.some(c => c.startsWith('H04L9/') || c.startsWith('H04L63/'));
      return securityGroups ? 'SECURITY' : 'SDN_NETWORK';
    }
    if (subclasses.has('H04W')) return 'WIRELESS';
    if (subclasses.has('H04N')) return 'VIDEO_STREAMING';
    if (subclasses.has('H01L') || subclasses.has('H01S')) return 'SEMICONDUCTOR';
    if (subclasses.has('G06F') || subclasses.has('G06Q')) return 'COMPUTING';
    if (subclasses.has('G06K') || subclasses.has('G06V') || subclasses.has('G06T')) return 'IMAGING';
    if (subclasses.has('H04B')) return 'WIRELESS';
    if (subclasses.has('G10L') || subclasses.has('H04R')) return 'AUDIO';
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
  productSlug: string
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
  return pairs;
}

function discoverPairsFromTargets(csvPath: string, superSectorFilter: string | null): ScoringPair[] {
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
      for (const product of products) {
        for (const doc of product.documents) {
          if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

          const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
          const docSlug = slugify(doc.documentName || docBase);
          const textPath = (doc as any).extractedTextPath ||
            path.join(path.dirname(doc.localPath), `${docBase}.txt`);
          if (!fs.existsSync(textPath)) continue;

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
      productDocsMap.set(cacheKey, docPairs);
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

function discoverPairsForSectorCompany(sector: string, companySlug: string): ScoringPair[] {
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

    for (const doc of product.documents) {
      if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

      const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
      const docSlug = slugify(doc.documentName || docBase);
      const textPath = (doc as any).extractedTextPath ||
        path.join(path.dirname(doc.localPath), `${docBase}.txt`);
      if (!fs.existsSync(textPath)) continue;

      const summaryFile = path.join(SUMMARIES_V2_DIR, product.companySlug, product.productSlug, `${docSlug}.json`);

      for (const patentId of patentIds) {
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

  // Build doc text for Pass 1: product summary (if available) + first 15K of doc
  const rawText = fs.readFileSync(pair.textPath, 'utf-8');
  let pass1DocText = rawText.substring(0, PASS1_DOC_CHARS);

  // Optionally prepend product summary
  if (pair.summaryPath) {
    const summary = loadProductSummary(pair.companySlug, pair.productSlug, pair.docSlug);
    const summaryText = formatSummaryForPrompt(summary);
    if (summaryText) {
      pass1DocText = `${summaryText}\n\n--- Document Text (first 15K chars) ---\n${pass1DocText}`;
    }
  }

  // ── Pass 1 ──
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
    const truncDoc = rawText.length > MAX_DOC_TEXT_LENGTH
      ? rawText.substring(0, MAX_DOC_TEXT_LENGTH) + '\n\n[... document truncated ...]'
      : rawText;

    const p2Prompt = buildInfringementPrompt(template, allClaimsText, abstract, truncDoc, 'pass2');
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
  if (config.pass1Only) console.log('MODE: Pass 1 only (screening)');
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.force) console.log('MODE: FORCE (re-score all)');
  if (config.calibrate) console.log('MODE: CALIBRATION (Patlytics-scored pairs only)');
  if (config.superSector) console.log(`FILTER: Super-sector = ${config.superSector}`);

  // Discover pairs
  let pairs: ScoringPair[] = [];

  if (config.calibrate) {
    pairs = discoverCalibrationPairs();
    console.log(`\nCalibration pairs found: ${pairs.length}`);
  } else if (config.patent && config.company && config.product) {
    pairs = discoverPairsForPatentProduct(config.patent, config.company, config.product);
    console.log(`\nPairs for patent ${config.patent} × ${config.company}/${config.product}: ${pairs.length}`);
  } else if (config.sector && config.company) {
    pairs = discoverPairsForSectorCompany(config.sector, config.company);
    console.log(`\nPairs for sector ${config.sector} × ${config.company}: ${pairs.length}`);
  } else if (config.fromTargets) {
    pairs = discoverPairsFromTargets(config.fromTargets, config.superSector);
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

  for (let i = 0; i < pairs.length; i += config.concurrency) {
    const batch = pairs.slice(i, i + config.concurrency);
    console.log(`\n--- Batch ${Math.floor(i / config.concurrency) + 1}/${Math.ceil(pairs.length / config.concurrency)} (${batch.length} pairs) ---`);

    const promises = batch.map(async (pair) => {
      try {
        const result = await scorePair(pair, config);
        if (!result) return;

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
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${pairs.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
