/**
 * Sector-agnostic LLM-powered product doc summarization (v2).
 *
 * Replaces the SDN/NFV-specific summarize-product-docs.ts with a general-purpose
 * technical extraction prompt that focuses on patent-claim-relevant language.
 *
 * Usage:
 *   npx tsx scripts/summarize-product-docs-v2.ts [options]
 *     --company <slug>      Summarize only one company
 *     --product <slug>      Summarize only one product (requires --company)
 *     --concurrency <n>     Parallel LLM calls (default: 3)
 *     --dry-run             Show what would be summarized
 *     --force               Re-summarize even if summary already exists
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
const MAX_TEXT_LENGTH = 100_000; // ~25K tokens

// ── Types ──────────────────────────────────────────────────────────────────

interface TechFeature {
  feature: string;
  category: string;
  claimRelevantDetail: string;
}

interface ProductTechSummary {
  productName: string;
  companyName: string;
  documentType: string;

  implementedTechnologies: TechFeature[];

  standards: string[];
  protocols: string[];

  architectureComponents: string[];
  interfaces: string[];

  signalProcessing: string[];
  dataHandling: string[];
  securityFeatures: string[];

  executiveSummary: string;
}

interface DocSummaryV2 {
  documentName: string;
  companySlug: string;
  productSlug: string;
  productName: string;
  sourceTextPath: string;
  sourceTextLength: number;
  summary: ProductTechSummary;
  model: string;
  summarizedAt: string;
}

interface Config {
  company: string | null;
  product: string | null;
  concurrency: number;
  dryRun: boolean;
  force: boolean;
}

// ── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let company: string | null = null;
  let product: string | null = null;
  let concurrency = 3;
  let dryRun = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--company' && args[i + 1]) company = args[++i];
    else if (arg === '--product' && args[i + 1]) product = args[++i];
    else if (arg === '--concurrency' && args[i + 1]) concurrency = parseInt(args[++i], 10);
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--force') force = true;
  }

  return { company, product, concurrency, dryRun, force };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function summaryPath(companySlug: string, productSlug: string, docSlug: string): string {
  return path.join(SUMMARIES_DIR, companySlug, productSlug, `${docSlug}.json`);
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ── Summarization Prompt ───────────────────────────────────────────────────

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

// ── LLM Call ───────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;

async function summarizeDoc(
  text: string,
  documentName: string,
  productName: string,
  companyName: string
): Promise<ProductTechSummary> {
  const truncated = text.length > MAX_TEXT_LENGTH
    ? text.substring(0, MAX_TEXT_LENGTH) + '\n\n[... truncated ...]'
    : text;

  let response: Anthropic.Messages.Message | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `${SUMMARIZE_PROMPT}

Document: "${documentName}"
Product: ${productName} (${companyName})

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
        console.log(`  Rate limited, retrying in ${delay / 1000}s...`);
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

  try {
    return JSON.parse(responseText);
  } catch {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error(`Failed to parse LLM response as JSON: ${responseText.substring(0, 200)}`);
  }
}

// ── Task Definition ────────────────────────────────────────────────────────

interface SummarizeTask {
  companySlug: string;
  companyName: string;
  productSlug: string;
  productName: string;
  documentName: string;
  docSlug: string;
  textPath: string;
  outputPath: string;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  console.log('=== Product Doc Summarization v2 (Sector-Agnostic) ===');
  if (config.company) console.log(`Company filter: ${config.company}`);
  if (config.product) console.log(`Product filter: ${config.product}`);
  console.log(`Concurrency: ${config.concurrency}`);
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.force) console.log('MODE: FORCE (re-summarize all)');

  let products = getAllProductCaches();
  if (config.company) products = products.filter(p => p.companySlug === config.company);
  if (config.product) products = products.filter(p => p.productSlug === config.product);

  if (products.length === 0) {
    console.log('\nNo products found.');
    return;
  }

  // Build task list
  const tasks: SummarizeTask[] = [];

  for (const productMeta of products) {
    const product = readProductCache(productMeta.companySlug, productMeta.productSlug);
    if (!product) continue;

    for (const doc of product.documents) {
      if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

      const docBase = path.basename(doc.localPath, path.extname(doc.localPath));
      const docSlug = slugify(doc.documentName || docBase);

      // Check for extracted text
      const textPath = (doc as any).extractedTextPath ||
        path.join(path.dirname(doc.localPath), `${docBase}.txt`);

      if (!fs.existsSync(textPath)) continue;

      const outputPath = summaryPath(product.companySlug, product.productSlug, docSlug);

      // Skip if already summarized (unless --force)
      if (fs.existsSync(outputPath) && !config.force) continue;

      tasks.push({
        companySlug: product.companySlug,
        companyName: product.companyName,
        productSlug: product.productSlug,
        productName: product.productName,
        documentName: doc.documentName,
        docSlug,
        textPath,
        outputPath,
      });
    }
  }

  console.log(`\nDocuments to summarize: ${tasks.length}`);

  if (tasks.length === 0) {
    console.log('Nothing to summarize.');
    return;
  }

  if (config.dryRun) {
    for (const task of tasks) {
      const textSize = fs.statSync(task.textPath).size;
      console.log(`  [DRY] ${task.companyName}/${task.productName}: ${task.documentName} (${(textSize / 1024).toFixed(1)} KB)`);
    }
    console.log(`\n(Dry run — no LLM calls made)`);
    return;
  }

  // Process in concurrent batches
  let completed = 0;
  let failed = 0;

  for (let i = 0; i < tasks.length; i += config.concurrency) {
    const batch = tasks.slice(i, i + config.concurrency);
    console.log(`\n--- Batch ${Math.floor(i / config.concurrency) + 1} (${batch.length} docs) ---`);

    const promises = batch.map(async (task) => {
      try {
        console.log(`  Summarizing: ${task.documentName}`);
        const text = fs.readFileSync(task.textPath, 'utf-8');

        if (text.trim().length < 100) {
          console.log(`    Skipping — text too short (${text.length} chars)`);
          return;
        }

        const summary = await summarizeDoc(text, task.documentName, task.productName, task.companyName);

        const result: DocSummaryV2 = {
          documentName: task.documentName,
          companySlug: task.companySlug,
          productSlug: task.productSlug,
          productName: task.productName,
          sourceTextPath: task.textPath,
          sourceTextLength: text.length,
          summary,
          model: 'claude-sonnet-4-20250514',
          summarizedAt: new Date().toISOString(),
        };

        ensureDir(path.dirname(task.outputPath));
        fs.writeFileSync(task.outputPath, JSON.stringify(result, null, 2));
        console.log(`    Saved → ${path.relative(process.cwd(), task.outputPath)}`);
        completed++;
      } catch (err) {
        console.error(`    Failed: ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    });

    await Promise.all(promises);
  }

  console.log('\n=== Summarization v2 Complete ===');
  console.log(`Completed: ${completed}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${tasks.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
