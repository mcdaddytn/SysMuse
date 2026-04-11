/**
 * Generate v2 summaries for production product documents.
 *
 * Scans product caches for documents with extracted text, optionally filtered
 * by company or super-sector. Also discovers GLSSD2 docs. Runs the same
 * sector-agnostic summarization prompt used by summarize-product-docs-v2.ts.
 *
 * Saves results to: cache/product-summaries-v2/{company}/{product}/{docSlug}.json
 *
 * Usage:
 *   npx tsx scripts/summarize-production-docs.ts [options]
 *     --company <slug>        Single company
 *     --super-sector <key>    SECURITY, WIRELESS, etc.
 *     --source patlytics|glssd2|both  (default: both)
 *     --model <id>            LLM model (default: claude-haiku-4-5-20251001)
 *     --concurrency <n>       Default 3
 *     --dry-run               Show what would be summarized
 *     --force                 Re-summarize even if cached
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  getAllProductCaches,
  readProductCache,
  slugify,
} from '../src/api/services/patlytics-cache-service.js';

const anthropic = new Anthropic();

const SUMMARIES_DIR = path.resolve('./cache/product-summaries-v2');
const SUPER_SECTORS_CONFIG = path.resolve('./config/super-sectors.json');
const GLSSD2_BASE = '/Volumes/GLSSD2/data/products/docs';
const MAX_TEXT_LENGTH = 100_000;
const MIN_TEXT_BYTES = 500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;
let MODEL = 'claude-haiku-4-5-20251001';

// ── Summarization Prompt (same as summarize-product-docs-v2.ts) ─────────

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
      "feature": "Short feature name (e.g., 'OFDMA resource scheduling')",
      "category": "Category (e.g., 'wireless', 'semiconductor', 'networking', 'security', 'software', 'signal-processing', 'data-management', 'cloud', 'hardware')",
      "claimRelevantDetail": "Implementation detail using patent-claim-style language (e.g., 'a method for allocating resource units to a plurality of stations based on channel state information, comprising receiving scheduling requests and determining resource block assignments')"
    }
  ],

  "standards": ["List of standards referenced (e.g., 'IEEE 802.11ax', '3GPP Release 16', 'PCIe 5.0')"],
  "protocols": ["List of protocols used (e.g., 'OFDMA', 'MIMO', 'BGP', 'VXLAN', 'TLS 1.3')"],

  "architectureComponents": ["Key structural components (e.g., 'baseband processor', 'RF front-end', 'DPI engine', 'packet classifier')"],
  "interfaces": ["Hardware/software interfaces (e.g., 'PCIe 4.0', 'QSFP28', 'SFP+', 'REST API', 'gRPC')"],

  "signalProcessing": ["Signal processing methods (e.g., 'beamforming', 'LDPC encoding', 'FFT/IFFT', 'noise cancellation')"],
  "dataHandling": ["Data processing methods (e.g., 'packet classification', 'deep packet inspection', 'flow table lookup', 'hash-based load balancing')"],
  "securityFeatures": ["Security implementations (e.g., 'AES-256 encryption', 'TrustZone', 'MACsec', 'IPsec tunnel mode')"],

  "executiveSummary": "3-4 sentence technical summary focusing on what the product DOES (methods and functions), what it CONTAINS (structural elements), and how it OPERATES (data flow and processing steps). Use patent-relevant language."
}

Rules:
- If a category has no relevant content, use an empty array [].
- Be SPECIFIC — reference actual feature names, parameter values, and implementation details.
- For implementedTechnologies, aim for 5-15 features depending on document richness.
- The claimRelevantDetail field is the most important — write it as if describing the feature to a patent examiner.
- Omit purely marketing content (award mentions, customer testimonials, pricing).`;

// ── CLI ──────────────────────────────────────────────────────────────────

interface Config {
  company: string | null;
  superSector: string | null;
  source: 'patlytics' | 'glssd2' | 'both';
  model: string;
  concurrency: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config: Config = {
    company: null,
    superSector: null,
    source: 'both',
    model: MODEL,
    concurrency: 3,
    dryRun: false,
    force: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--company' && args[i + 1]) config.company = args[++i];
    else if (arg === '--super-sector' && args[i + 1]) config.superSector = args[++i];
    else if (arg === '--source' && args[i + 1]) {
      const v = args[++i];
      if (v === 'patlytics' || v === 'glssd2' || v === 'both') config.source = v;
    }
    else if (arg === '--model' && args[i + 1]) config.model = args[++i];
    else if (arg === '--concurrency' && args[i + 1]) config.concurrency = parseInt(args[++i], 10);
    else if (arg === '--dry-run') config.dryRun = true;
    else if (arg === '--force') config.force = true;
  }

  return config;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
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

// ── Junk Detection (from screen-doc-quality.ts patterns) ─────────────────

const JUNK_PATTERNS = [
  /sign\s*in|log\s*in|log\s*out|sign\s*up/i,
  /cookie\s*(policy|consent|preferences|notice)/i,
  /terms\s+of\s+(use|service)/i,
  /privacy\s+policy/i,
  /copyright\s+©?\s*\d{4}/i,
  /subscribe|newsletter|follow\s+us\s+on/i,
  /breadcrumb|sidebar|footer|header/i,
  /download\s+(free|now|save|share|print|embed)/i,
  /about\s+scribd|join\s+our\s+team|adchoices/i,
  /get\s+our\s+free\s+apps/i,
  /we\s+take\s+content\s+rights\s+seriously/i,
  /uploaded\s+by\s+\w+/i,
  /ai-enhanced\s+(title|description)/i,
  /^\s*\d+[KMB]?\s+views?\s/i,
  /^\s*\d+\s+ratings?\s/i,
  /share\s+this\s+document/i,
  /^\s*\d+:\d{2}\s+/,
  /^\s*search\s+in\s+video\s*$/i,
  /^\s*transcript\s*$/i,
  /^\s*chapters\s*$/i,
];

function computeJunkLineRatio(text: string): number {
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return 1;
  let junkLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3) { junkLines++; continue; }
    if (JUNK_PATTERNS.some(p => p.test(trimmed))) junkLines++;
  }
  return junkLines / lines.length;
}

// ── Super-Sector Resolution ──────────────────────────────────────────────

let _superSectorConfig: any = null;
function getSuperSectorConfig(): any {
  if (!_superSectorConfig) {
    _superSectorConfig = JSON.parse(fs.readFileSync(SUPER_SECTORS_CONFIG, 'utf-8'));
  }
  return _superSectorConfig;
}

/** Get all company slugs that have products in a given super-sector's sectors. */
function getCompaniesForSuperSector(superSectorKey: string): Set<string> {
  const ssConfig = getSuperSectorConfig();
  const ss = ssConfig.superSectors[superSectorKey];
  if (!ss) return new Set();

  // For super-sector filtering, we need to check which companies have target CSVs
  // or products in the relevant sectors. Since we filter by product docs anyway,
  // we return all companies and let the doc discovery handle it.
  // The super-sector filter is best-effort via sector mapping.
  return new Set(); // empty = no filter (all companies)
}

// ── LLM Call ─────────────────────────────────────────────────────────────

async function summarizeDoc(
  text: string,
  documentName: string,
  companySlug: string,
): Promise<{ summary: any; inputTokens: number; outputTokens: number }> {
  const truncated = text.length > MAX_TEXT_LENGTH
    ? text.substring(0, MAX_TEXT_LENGTH) + '\n\n[... truncated ...]'
    : text;

  let response: Anthropic.Messages.Message | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `${SUMMARIZE_PROMPT}

Document: "${documentName}"
Company: ${companySlug}

--- DOCUMENT TEXT ---
${truncated}
--- END DOCUMENT TEXT ---`
        }],
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

  const responseText = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    summary: parseJSON(responseText),
    inputTokens: response.usage?.input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

// ── Task Discovery ───────────────────────────────────────────────────────

interface SumTask {
  companySlug: string;
  productSlug: string;
  docSlug: string;
  documentName: string;
  textPath: string;
  outputPath: string;
  textSize: number;
  source: 'patlytics' | 'glssd2';
}

function discoverPatlyticsDocTasks(config: Config): SumTask[] {
  const tasks: SumTask[] = [];
  const allProducts = getAllProductCaches();

  for (const productMeta of allProducts) {
    if (config.company && productMeta.companySlug !== config.company) continue;

    const product = readProductCache(productMeta.companySlug, productMeta.productSlug);
    if (!product) continue;

    for (const doc of product.documents) {
      if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

      const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
      const docSlug = slugify(doc.documentName || docBase);
      const textPath = (doc as any).extractedTextPath ||
        path.join(path.dirname(doc.localPath), `${docBase}.txt`);

      if (!fs.existsSync(textPath)) continue;

      let stat: fs.Stats;
      try { stat = fs.statSync(textPath); } catch { continue; }
      if (stat.size < MIN_TEXT_BYTES) continue;

      const outputPath = path.join(SUMMARIES_DIR, product.companySlug, product.productSlug, `${docSlug}.json`);
      if (fs.existsSync(outputPath) && !config.force) continue;

      // Quality pre-screen: skip junk
      try {
        const text = fs.readFileSync(textPath, 'utf-8');
        const junkRatio = computeJunkLineRatio(text);
        if (junkRatio > 0.30) continue;
      } catch { continue; }

      tasks.push({
        companySlug: product.companySlug,
        productSlug: product.productSlug,
        docSlug,
        documentName: doc.documentName,
        textPath,
        outputPath,
        textSize: stat.size,
        source: 'patlytics',
      });
    }
  }

  return tasks;
}

function discoverGlssd2DocTasks(config: Config): SumTask[] {
  const tasks: SumTask[] = [];

  if (!fs.existsSync(GLSSD2_BASE)) {
    console.log('GLSSD2 not mounted — skipping GLSSD2 doc discovery');
    return tasks;
  }

  let companyDirs: string[];
  try {
    companyDirs = fs.readdirSync(GLSSD2_BASE).filter(d => {
      if (d.startsWith('.') || d.startsWith('._')) return false;
      return fs.statSync(path.join(GLSSD2_BASE, d)).isDirectory();
    });
  } catch { return tasks; }

  if (config.company) {
    companyDirs = companyDirs.filter(d => d === config.company);
  }

  for (const companySlug of companyDirs) {
    const companyDir = path.join(GLSSD2_BASE, companySlug);
    let productDirs: string[];
    try {
      productDirs = fs.readdirSync(companyDir).filter(d => {
        if (d.startsWith('.') || d.startsWith('._')) return false;
        return fs.statSync(path.join(companyDir, d)).isDirectory();
      });
    } catch { continue; }

    for (const productSlug of productDirs) {
      const productDir = path.join(companyDir, productSlug);
      let files: string[];
      try { files = fs.readdirSync(productDir).filter(f => !f.startsWith('._')); } catch { continue; }

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (ext !== '.txt' && ext !== '.html') continue;

        const fullPath = path.join(productDir, file);
        let stat: fs.Stats;
        try { stat = fs.statSync(fullPath); } catch { continue; }
        if (stat.size < MIN_TEXT_BYTES) continue;

        const docBase = path.basename(file, ext);
        const docSlug = slugify(docBase);
        const outputPath = path.join(SUMMARIES_DIR, companySlug, productSlug, `${docSlug}.json`);
        if (fs.existsSync(outputPath) && !config.force) continue;

        // Quality pre-screen
        try {
          let text = fs.readFileSync(fullPath, 'utf-8');
          if (ext === '.html') text = stripHtml(text);
          if (text.length < MIN_TEXT_BYTES) continue;
          const junkRatio = computeJunkLineRatio(text);
          if (junkRatio > 0.30) continue;
        } catch { continue; }

        tasks.push({
          companySlug,
          productSlug,
          docSlug,
          documentName: docBase,
          textPath: fullPath,
          outputPath,
          textSize: stat.size,
          source: 'glssd2',
        });
      }
    }
  }

  return tasks;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  // Apply model override
  MODEL = config.model;

  console.log('=== Production Doc Summarization (v2) ===');
  console.log(`Model: ${MODEL}`);
  console.log(`Source: ${config.source}`);
  if (config.company) console.log(`Company: ${config.company}`);
  if (config.superSector) console.log(`Super-sector: ${config.superSector}`);
  console.log(`Concurrency: ${config.concurrency}`);
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.force) console.log('MODE: FORCE');

  // Discover tasks
  let tasks: SumTask[] = [];

  if (config.source === 'patlytics' || config.source === 'both') {
    const pTasks = discoverPatlyticsDocTasks(config);
    console.log(`Patlytics docs to summarize: ${pTasks.length}`);
    tasks.push(...pTasks);
  }

  if (config.source === 'glssd2' || config.source === 'both') {
    const gTasks = discoverGlssd2DocTasks(config);
    console.log(`GLSSD2 docs to summarize: ${gTasks.length}`);
    tasks.push(...gTasks);
  }

  // Deduplicate by output path (patlytics and glssd2 may overlap)
  const seen = new Set<string>();
  tasks = tasks.filter(t => {
    if (seen.has(t.outputPath)) return false;
    seen.add(t.outputPath);
    return true;
  });

  const totalSize = tasks.reduce((s, t) => s + t.textSize, 0);
  console.log(`\nTotal docs to summarize: ${tasks.length} (${(totalSize / 1024 / 1024).toFixed(1)} MB text)`);
  const isHaiku = MODEL.includes('haiku');
  const costPerDoc = isHaiku ? 0.002 : 0.02;
  const estimatedCost = tasks.length * costPerDoc;
  console.log(`Estimated cost: ~$${estimatedCost.toFixed(2)} (~$${costPerDoc}/doc, ${isHaiku ? 'Haiku' : 'Sonnet'})`);

  if (config.dryRun) {
    const byCompany = new Map<string, number>();
    const bySource = new Map<string, number>();
    for (const t of tasks) {
      byCompany.set(t.companySlug, (byCompany.get(t.companySlug) || 0) + 1);
      bySource.set(t.source, (bySource.get(t.source) || 0) + 1);
    }
    console.log('\nBy company:');
    for (const [company, count] of [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${company}: ${count}`);
    }
    if (byCompany.size > 20) console.log(`  ... and ${byCompany.size - 20} more`);
    console.log('\nBy source:');
    for (const [source, count] of [...bySource.entries()]) {
      console.log(`  ${source}: ${count}`);
    }
    console.log('\n(Dry run — no LLM calls made)');
    return;
  }

  if (tasks.length === 0) {
    console.log('Nothing to summarize (all already cached).');
    return;
  }

  let completed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < tasks.length; i += config.concurrency) {
    const batch = tasks.slice(i, i + config.concurrency);
    const batchNum = Math.floor(i / config.concurrency) + 1;
    const totalBatches = Math.ceil(tasks.length / config.concurrency);
    console.log(`\n--- Batch ${batchNum}/${totalBatches} ---`);

    const promises = batch.map(async (task) => {
      try {
        let text = fs.readFileSync(task.textPath, 'utf-8');
        if (task.textPath.endsWith('.html')) text = stripHtml(text);
        if (text.trim().length < 100) {
          console.log(`  SKIP ${task.docSlug} — text too short`);
          return;
        }

        console.log(`  ${task.companySlug}/${task.docSlug.substring(0, 40)} (${(task.textSize / 1024).toFixed(0)}KB, ${task.source})`);
        const { summary, inputTokens, outputTokens } = await summarizeDoc(text, task.documentName, task.companySlug);

        const result = {
          documentName: task.documentName,
          companySlug: task.companySlug,
          productSlug: task.productSlug,
          sourceTextPath: task.textPath,
          sourceTextLength: text.length,
          source: task.source,
          summary,
          model: MODEL,
          summarizedAt: new Date().toISOString(),
          inputTokens,
          outputTokens,
        };

        ensureDir(path.dirname(task.outputPath));
        fs.writeFileSync(task.outputPath, JSON.stringify(result, null, 2));
        console.log(`    OK (${inputTokens}+${outputTokens} tokens)`);
        completed++;
      } catch (err) {
        console.error(`    FAILED ${task.docSlug}: ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    });

    await Promise.all(promises);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n=== Summary Complete ===');
  console.log(`Completed: ${completed}  Failed: ${failed}  Time: ${elapsed}s`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
