/**
 * Generate v2 summaries for control group documents.
 *
 * The control group docs live at cache/calibration-control/texts/ (not in the
 * Patlytics product cache), so the main summarize-product-docs-v2.ts doesn't
 * find them. This script reads the manifest, deduplicates by doc, and runs the
 * same sector-agnostic summarization prompt, saving results to
 * cache/product-summaries-v2/{company}/{product}/{docSlug}.json — where
 * score-control-group.ts expects them.
 *
 * Usage:
 *   npx tsx scripts/summarize-control-group-docs.ts [options]
 *     --concurrency <n>  Parallel LLM calls (default: 3)
 *     --dry-run          Show what would be summarized
 *     --force            Re-summarize even if cached
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

const CONTROL_DIR = path.resolve('./cache/calibration-control');
const SUMMARIES_DIR = path.resolve('./cache/product-summaries-v2');
const QUARANTINE_PATH = path.resolve('./cache/doc-quality-screening/results.json');
const MAX_TEXT_LENGTH = 100_000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;
const MODEL = 'claude-sonnet-4-20250514';

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
  concurrency: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  return {
    concurrency: (() => { const i = args.indexOf('--concurrency'); return i >= 0 ? parseInt(args[i + 1], 10) : 3; })(),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
  };
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

// ── LLM Call ─────────────────────────────────────────────────────────────

async function summarizeDoc(
  text: string,
  documentName: string,
  companySlug: string,
): Promise<any> {
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

// ── Main ─────────────────────────────────────────────────────────────────

interface SumTask {
  companySlug: string;
  productSlug: string;
  docSlug: string;
  documentName: string;
  textPath: string;
  outputPath: string;
  textSize: number;
}

async function main() {
  const config = parseArgs();

  console.log('=== Control Group Doc Summarization (v2) ===');

  const manifestPath = path.join(CONTROL_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('No manifest found. Run build-control-group.ts first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Load quarantine data
  const quarantinedPaths = new Set<string>();
  if (fs.existsSync(QUARANTINE_PATH)) {
    const qData = JSON.parse(fs.readFileSync(QUARANTINE_PATH, 'utf-8'));
    for (const r of qData.results) {
      if (r.quarantined) quarantinedPaths.add(r.textPath);
    }
  }

  // Deduplicate by (company, product, docSlug) — many pairs share the same doc
  const seen = new Set<string>();
  const tasks: SumTask[] = [];

  for (const pair of manifest.pairs) {
    const key = `${pair.companySlug}/${pair.productSlug}/${pair.docSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Skip quarantined
    if (quarantinedPaths.has(pair.textPath)) continue;

    // Skip missing/tiny
    if (!fs.existsSync(pair.textPath)) continue;
    const stat = fs.statSync(pair.textPath);
    if (stat.size < 500) continue;

    const outputPath = path.join(SUMMARIES_DIR, pair.companySlug, pair.productSlug, `${pair.docSlug}.json`);

    // Skip if already summarized (unless --force)
    if (fs.existsSync(outputPath) && !config.force) continue;

    tasks.push({
      companySlug: pair.companySlug,
      productSlug: pair.productSlug,
      docSlug: pair.docSlug,
      documentName: pair.documentName,
      textPath: pair.textPath,
      outputPath,
      textSize: stat.size,
    });
  }

  console.log(`Docs to summarize: ${tasks.length} (${(tasks.reduce((s, t) => s + t.textSize, 0) / 1024 / 1024).toFixed(1)} MB text)`);
  console.log(`Concurrency: ${config.concurrency}`);
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.force) console.log('MODE: FORCE');

  if (config.dryRun) {
    for (const t of tasks) {
      console.log(`  ${t.companySlug}/${t.productSlug}/${t.docSlug} (${(t.textSize / 1024).toFixed(0)}KB)`);
    }
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
        const text = fs.readFileSync(task.textPath, 'utf-8');
        if (text.trim().length < 100) {
          console.log(`  SKIP ${task.docSlug} — text too short`);
          return;
        }

        console.log(`  ${task.companySlug}/${task.docSlug.substring(0, 40)} (${(task.textSize / 1024).toFixed(0)}KB)`);
        const { summary, inputTokens, outputTokens } = await summarizeDoc(text, task.documentName, task.companySlug);

        const result = {
          documentName: task.documentName,
          companySlug: task.companySlug,
          productSlug: task.productSlug,
          sourceTextPath: task.textPath,
          sourceTextLength: text.length,
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
