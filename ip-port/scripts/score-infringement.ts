/**
 * Two-pass internal infringement scoring engine.
 *
 * Pass 1 (screening):  patent claims + product tech summary → preliminary score
 * Pass 2 (deep):       ALL independent claims + full product doc text → final score + narrative
 *
 * Results cached to: cache/infringement-scores/{company}/{product}/{patentId}.json
 * Also updates product cache: document.patentScores[patentId] with sourceFile="internal-v1"
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
 *   # Calibration mode: only score pairs that have existing Patlytics scores
 *   --calibrate
 *
 *   # Options
 *   --pass1-only           Only run screening pass
 *   --min-pass1 <n>        Threshold for Pass 2 (default: 0.30)
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
const SUMMARIES_V2_DIR = path.resolve('./cache/product-summaries-v2');
const XML_DIR = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
const SOURCE_VERSION = 'internal-v1';
const MAX_DOC_TEXT_LENGTH = 300_000; // ~75K tokens for deep analysis
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

// ── Types ──────────────────────────────────────────────────────────────────

interface ClaimElementAnalysis {
  element: string;
  status: 'DISCLOSED' | 'PARTIALLY' | 'NOT_DISCLOSED';
  evidence: string;
}

interface ClaimAnalysis {
  claimNumber: number;
  elements: ClaimElementAnalysis[];
  claimScore: number;
}

interface InfringementScore {
  patentId: string;
  companySlug: string;
  productSlug: string;
  documentSlug: string;
  documentName: string;
  pass1Score: number;
  pass1Rationale: string;
  finalScore: number | null;
  claimAnalysis: ClaimAnalysis[] | null;
  narrative: string | null;
  strongestClaim: number | null;
  keyGaps: string[] | null;
  model: string;
  sourceVersion: string;
  scoredAt: string;
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
}

interface Config {
  patent: string | null;
  company: string | null;
  product: string | null;
  sector: string | null;
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
    fromTargets: null,
    calibrate: false,
    pass1Only: false,
    minPass1: 0.30,
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

function loadProductSummary(companySlug: string, productSlug: string, docSlug: string): any | null {
  const filePath = path.join(SUMMARIES_V2_DIR, companySlug, productSlug, `${docSlug}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function loadPatentAbstract(patentId: string): string | null {
  try {
    const cachePath = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return data.patent_abstract || null;
    }
  } catch { /* ignore */ }
  return null;
}

function loadPatentClaims(patentId: string): PatentClaim[] {
  if (!XML_DIR) return [];
  const xmlPath = findXmlPath(patentId, XML_DIR);
  if (!xmlPath) return [];
  const claimsData = parsePatentClaims(xmlPath);
  return claimsData.independentClaims;
}

function formatClaimsForPrompt(claims: PatentClaim[], maxClaims: number = 5): string {
  const selected = claims.slice(0, maxClaims);
  return selected.map(c => `Claim ${c.number}: ${c.text}`).join('\n\n');
}

function formatSummaryForPrompt(summary: any): string {
  const s = summary?.summary;
  if (!s) return '(No technical summary available)';

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
  if (s.signalProcessing?.length) parts.push(`Signal Processing: ${s.signalProcessing.join(', ')}`);
  if (s.dataHandling?.length) parts.push(`Data Handling: ${s.dataHandling.join(', ')}`);
  if (s.securityFeatures?.length) parts.push(`Security: ${s.securityFeatures.join(', ')}`);

  return parts.join('\n');
}

// ── LLM Calls ──────────────────────────────────────────────────────────────

async function callLLM(prompt: string, model: string = 'claude-sonnet-4-20250514', maxTokens: number = 4096): Promise<string> {
  let response: Anthropic.Messages.Message | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await anthropic.messages.create({
        model,
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

  return response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

function parseJSON(text: string): any {
  // Try direct parse
  try { return JSON.parse(text); } catch {}
  // Try markdown fenced JSON
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  // Try to find JSON object in text (model sometimes adds reasoning before JSON)
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try { return JSON.parse(text.substring(jsonStart, jsonEnd + 1)); } catch {}
  }
  throw new Error(`Failed to parse LLM JSON: ${text.substring(0, 200)}`);
}

// ── Pass 1: Summary-Based Screening ────────────────────────────────────────

const PASS1_PROMPT = `You are a patent infringement screening analyst assessing whether a product's described capabilities align with patent claims.

CRITICAL CONTEXT: Patent claims use abstract, functional language (e.g., "network operating system," "flow entries," "managed switching elements"). Product documentation uses concrete implementation language (e.g., "cloud management console," "routing policies," "network devices"). Your job is to see through terminology differences and assess FUNCTIONAL alignment.

A product that manages network state via policies IS functionally equivalent to one that uses "flow tables," even if the term "flow table" never appears. A cloud service that centralizes network control IS a form of "network operating system." Focus on WHAT the system does, not what it's CALLED.

Scoring guidelines — use the FULL range:
- 0.80-1.0: The product clearly implements the core method/system described in the claims. Most claim functions are present even if described differently.
- 0.60-0.79: Strong functional overlap. The product operates in the same technology domain and implements most of the claimed functions, though some specifics differ or aren't fully documented.
- 0.40-0.59: Moderate overlap. The product shares the technology domain and implements some claimed functions, but significant architectural differences or gaps exist.
- 0.20-0.39: Weak overlap. Tangential technology area, few functional parallels.
- 0.00-0.19: No meaningful functional overlap.

Respond as JSON (no markdown fencing):
{
  "score": 0.XX,
  "rationale": "2-3 sentence explanation of functional alignment and key gaps"
}`;

async function runPass1(
  claims: string,
  productSummary: string,
  patentAbstract: string | null
): Promise<{ score: number; rationale: string }> {
  const abstractSection = patentAbstract
    ? `\nPatent Abstract: ${patentAbstract}\n`
    : '';

  const prompt = `${PASS1_PROMPT}

--- PATENT CLAIMS ---
${claims}
${abstractSection}
--- PRODUCT TECHNICAL SUMMARY ---
${productSummary}
--- END ---`;

  const responseText = await callLLM(prompt, 'claude-sonnet-4-20250514', 1024);
  const result = parseJSON(responseText);
  return {
    score: typeof result.score === 'number' ? result.score : 0,
    rationale: result.rationale || '',
  };
}

// ── Pass 2: Full-Text Deep Analysis ────────────────────────────────────────

const PASS2_PROMPT = `You are a patent infringement analyst. Determine whether the product described in this documentation practices the claimed invention.

CRITICAL CONTEXT ON TERMINOLOGY:
Patent claims use formal, abstract language. Product documentation uses practical, implementation-specific language. These describe the SAME things differently:
- Patent: "network operating system" → Product: "management platform," "control plane," "orchestrator"
- Patent: "flow entries/flow tables" → Product: "routing rules," "forwarding policies," "ACLs," "route tables"
- Patent: "managed switching elements" → Product: "switches," "routers," "network devices," "nodes"
- Patent: "logical datapath set" → Product: "virtual network," "VRF," "tenant network," "overlay"
This applies across ALL technology domains, not just networking.

ANALYSIS STEPS:
1. First, identify what the patent claims are fundamentally about (the core method/system).
2. Then assess: Does this product implement that core method/system?
3. For each claim element, determine disclosure:
   - DISCLOSED: The document describes this function/component (even with different terminology)
   - PARTIALLY: The product would necessarily include this as part of its described architecture, OR a functional equivalent exists
   - NOT_DISCLOSED: No evidence and no reasonable inference possible

SCORING — HOW TO WEIGHT ELEMENTS:
- DISCLOSED elements count fully toward the score
- PARTIALLY elements count at 60-80% (they represent real functional alignment)
- NOT_DISCLOSED elements count at 0%
- If most elements are PARTIALLY with a few DISCLOSED: score should be 0.60-0.80
- If most elements are PARTIALLY with some NOT_DISCLOSED: score should be 0.40-0.65
- Only score below 0.20 if the product has NO functional relationship to the patent

AFTER element analysis, step back and assess: "Would someone skilled in the art, reading this product documentation, recognize that this product likely practices the claimed invention?" If yes, your score should be at least 0.60 even if specific implementation details aren't documented.

Respond as JSON (no markdown fencing):
{
  "score": 0.XX,
  "claimAnalysis": [
    {
      "claimNumber": 1,
      "elements": [
        { "element": "...", "status": "DISCLOSED|PARTIALLY|NOT_DISCLOSED", "evidence": "..." }
      ],
      "claimScore": 0.XX
    }
  ],
  "narrative": "2-4 sentence summary of functional alignment between the product and patent claims.",
  "strongestClaim": 1,
  "keyGaps": ["List of claim elements with NO functional equivalent in the documentation"]
}`;

async function runPass2(
  claims: string,
  fullDocText: string,
  patentAbstract: string | null
): Promise<{
  score: number;
  claimAnalysis: ClaimAnalysis[];
  narrative: string;
  strongestClaim: number;
  keyGaps: string[];
}> {
  // Truncate doc text if needed
  const truncatedDoc = fullDocText.length > MAX_DOC_TEXT_LENGTH
    ? fullDocText.substring(0, MAX_DOC_TEXT_LENGTH) + '\n\n[... document truncated ...]'
    : fullDocText;

  const abstractSection = patentAbstract
    ? `\nPatent Abstract: ${patentAbstract}\n`
    : '';

  const prompt = `${PASS2_PROMPT}

--- PATENT CLAIMS ---
${claims}
${abstractSection}
--- PRODUCT DOCUMENTATION ---
${truncatedDoc}
--- END ---`;

  const responseText = await callLLM(prompt, 'claude-sonnet-4-20250514', 8192);
  const result = parseJSON(responseText);

  return {
    score: typeof result.score === 'number' ? result.score : 0,
    claimAnalysis: result.claimAnalysis || [],
    narrative: result.narrative || '',
    strongestClaim: result.strongestClaim || 1,
    keyGaps: result.keyGaps || [],
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
        // Only include if the existing score is from Patlytics (no sourceFile or not internal-v1)
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
    });
  }

  return pairs;
}

function discoverPairsFromTargets(csvPath: string): ScoringPair[] {
  const pairs: ScoringPair[] = [];
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  // Parse CSV header — support multiple column name formats
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const findCol = (...names: string[]) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; }
    return -1;
  };
  const patentIdx = findCol('patent_id', 'PatentId', 'patentId');
  const companyIdx = findCol('company_slug', 'target_company_slug', 'Target');
  const productIdx = findCol('product_slug', 'target_product_slug', 'TargetProduct');

  if (patentIdx === -1 || companyIdx === -1) {
    console.error(`CSV must have patent_id/PatentId and company_slug/Target columns. Found: ${header.join(', ')}`);
    return pairs;
  }

  // Load all product caches once upfront, indexed by company slug
  console.log('Loading product caches...');
  const allProducts = getAllProductCaches();
  const productsByCompany = new Map<string, ProductCache[]>();
  for (const p of allProducts) {
    const existing = productsByCompany.get(p.companySlug) || [];
    existing.push(p);
    productsByCompany.set(p.companySlug, existing);
  }
  console.log(`  Loaded ${allProducts.length} products across ${productsByCompany.size} companies`);

  // Build a map of company+product → available docs (with text files)
  const productDocsMap = new Map<string, ScoringPair[]>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const rawPatentId = cols[patentIdx];
    const rawCompany = cols[companyIdx];
    const rawProduct = productIdx !== -1 ? cols[productIdx] : null;

    if (!rawPatentId || !rawCompany) continue;

    // Normalize patent ID: "US10396716B2" → "10396716"
    const patentId = normalizePatentId(rawPatentId).patentId;
    // Slugify company name: "Skyworks Solutions" → "skyworks-solutions"
    const companySlug = slugify(rawCompany);
    const productSlug = rawProduct ? slugify(rawProduct) : null;

    // Find available docs for this company/product
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
            patentId: '', // Will be filled per patent
            companySlug: product.companySlug,
            companyName: product.companyName,
            productSlug: product.productSlug,
            productName: product.productName,
            documentName: doc.documentName,
            docSlug,
            textPath,
            summaryPath: fs.existsSync(summaryFile) ? summaryFile : null,
          });
        }
      }
      productDocsMap.set(cacheKey, docPairs);
    }

    const docTemplates = productDocsMap.get(cacheKey) || [];
    for (const template of docTemplates) {
      pairs.push({ ...template, patentId });
    }
  }

  return pairs;
}

function discoverPairsForSectorCompany(sector: string, companySlug: string): ScoringPair[] {
  // Load patents in the sector
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
        });
      }
    }
  }

  return pairs;
}

// ── Scoring Pipeline ───────────────────────────────────────────────────────

const MIN_DOC_TEXT_BYTES = 500; // Skip stub files (YouTube pages, Scribd paywalls, etc.)

async function scorePair(
  pair: ScoringPair,
  config: Config
): Promise<InfringementScore | null> {
  // Skip docs with too little text (stubs, failed extractions)
  try {
    const stat = fs.statSync(pair.textPath);
    if (stat.size < MIN_DOC_TEXT_BYTES) {
      console.log(`    Skipping ${pair.docSlug} — text too small (${stat.size} bytes)`);
      return null;
    }
  } catch {
    return null;
  }

  // Load patent claims
  const claims = loadPatentClaims(pair.patentId);
  if (claims.length === 0) {
    console.log(`    No claims found for patent ${pair.patentId}, skipping`);
    return null;
  }

  const claimsText = formatClaimsForPrompt(claims, 5);
  const abstract = loadPatentAbstract(pair.patentId);

  // Load product summary for Pass 1
  const summary = pair.summaryPath ? loadProductSummary(pair.companySlug, pair.productSlug, pair.docSlug) : null;
  const summaryText = summary
    ? formatSummaryForPrompt(summary)
    : null;

  // Use doc text for Pass 1 (15K chars provides good signal); append summary if available
  const rawText = fs.readFileSync(pair.textPath, 'utf-8');
  let pass1Input = rawText.substring(0, 15_000);
  if (summaryText) {
    pass1Input = `${summaryText}\n\n--- DOCUMENT TEXT (first 15K chars) ---\n${pass1Input}`;
  }

  // Pass 1: Screening
  console.log(`    Pass 1: ${pair.patentId} × ${pair.documentName}`);
  const pass1 = await runPass1(claimsText, pass1Input, abstract);
  console.log(`      Score: ${pass1.score.toFixed(2)} — ${pass1.rationale.substring(0, 80)}`);

  const result: InfringementScore = {
    patentId: pair.patentId,
    companySlug: pair.companySlug,
    productSlug: pair.productSlug,
    documentSlug: pair.docSlug,
    documentName: pair.documentName,
    pass1Score: pass1.score,
    pass1Rationale: pass1.rationale,
    finalScore: null,
    claimAnalysis: null,
    narrative: null,
    strongestClaim: null,
    keyGaps: null,
    model: 'claude-sonnet-4-20250514',
    sourceVersion: SOURCE_VERSION,
    scoredAt: new Date().toISOString(),
  };

  // Pass 2: Deep analysis if above threshold
  if (!config.pass1Only && pass1.score >= config.minPass1) {
    console.log(`    Pass 2: Deep analysis (pass1 ${pass1.score.toFixed(2)} >= ${config.minPass1})`);
    const allClaimsText = formatClaimsForPrompt(claims, 10); // More claims for deep analysis
    const fullDocText = fs.readFileSync(pair.textPath, 'utf-8');

    const pass2 = await runPass2(allClaimsText, fullDocText, abstract);
    // Use max of Pass 1 and Pass 2 — Pass 2 adds detail but shouldn't penalize
    // when it over-focuses on literal claim element matching
    result.finalScore = Math.max(pass1.score, pass2.score);
    result.claimAnalysis = pass2.claimAnalysis;
    result.narrative = pass2.narrative;
    result.strongestClaim = pass2.strongestClaim;
    result.keyGaps = pass2.keyGaps;

    console.log(`      P2: ${pass2.score.toFixed(2)}, Final: ${result.finalScore.toFixed(2)} — ${pass2.narrative.substring(0, 80)}`);
  }

  return result;
}

// ── Product Cache Update ───────────────────────────────────────────────────

function updateProductCache(score: InfringementScore): void {
  const product = readProductCache(score.companySlug, score.productSlug);
  if (!product) return;

  // Find the matching document
  for (const doc of product.documents) {
    const docBase = doc.localPath ? path.basename(doc.localPath, path.extname(doc.localPath)) : '';
    const docSlug = slugify(doc.documentName || docBase);

    if (docSlug === score.documentSlug) {
      if (!doc.patentScores) doc.patentScores = {};

      const effectiveScore = score.finalScore ?? score.pass1Score;
      const effectiveNarrative = score.narrative ?? score.pass1Rationale;

      doc.patentScores[score.patentId] = {
        score: effectiveScore,
        narrative: effectiveNarrative,
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

  console.log('=== Internal Infringement Scoring Engine ===');
  console.log(`XML Dir: ${XML_DIR || '(not set)'}`);
  console.log(`Pass 1 threshold: ${config.minPass1}`);
  console.log(`Concurrency: ${config.concurrency}`);
  if (config.pass1Only) console.log('MODE: Pass 1 only (screening)');
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.force) console.log('MODE: FORCE (re-score all)');
  if (config.calibrate) console.log('MODE: CALIBRATION (Patlytics-scored pairs only)');

  // Discover pairs to score
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
    pairs = discoverPairsFromTargets(config.fromTargets);
    console.log(`\nPairs from targets CSV: ${pairs.length}`);
  } else {
    console.error('\nError: Specify --calibrate, --patent+--company+--product, --sector+--company, or --from-targets');
    process.exit(1);
  }

  // Filter out already-cached pairs (unless --force)
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
    for (const p of pairs) {
      byCompany.set(p.companyName, (byCompany.get(p.companyName) || 0) + 1);
    }
    console.log('\nPairs by company:');
    for (const [company, count] of [...byCompany.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${company}: ${count} pairs`);
    }

    // Estimate costs
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

        // Save to cache
        writeScoreCache(result);

        // Update product cache
        updateProductCache(result);

        completed++;
        if (result.finalScore !== null) pass2Count++;
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
