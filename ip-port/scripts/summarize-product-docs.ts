/**
 * LLM-powered summarization of extracted product documentation.
 *
 * For each extracted doc, calls Claude Sonnet 4 to produce a structured summary
 * focused on SDN/NFV/virtualization features relevant to patent assertion.
 *
 * Usage:
 *   npx tsx scripts/summarize-product-docs.ts [options]
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

const SUMMARIES_DIR = path.resolve('./cache/product-doc-summaries');
const MAX_TEXT_LENGTH = 100_000; // ~25K tokens, fits comfortably in context

interface DocSummary {
  documentName: string;
  companySlug: string;
  productSlug: string;
  productName: string;
  sourceTextPath: string;
  sourceTextLength: number;
  summary: {
    keyTechnologies: string[];
    sdnNfvFeatures: string[];
    networkSecurityCapabilities: string[];
    virtualSwitchingRouting: string[];
    hypervisorVmManagement: string[];
    otherRelevantFeatures: string[];
    executiveSummary: string;
  };
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

function summaryPath(companySlug: string, productSlug: string, docSlug: string): string {
  return path.join(SUMMARIES_DIR, companySlug, productSlug, `${docSlug}.json`);
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const SUMMARIZE_PROMPT = `You are a patent litigation analyst reviewing product documentation to identify technology implementations that may be relevant to patent infringement analysis.

Analyze the following product documentation and extract structured information. Focus on concrete technical implementations, not marketing language.

Respond with a JSON object (no markdown fencing) with these fields:

{
  "keyTechnologies": ["List of key technology implementations described in this document"],
  "sdnNfvFeatures": ["SDN and NFV features: software-defined networking controllers, network function virtualization, programmable data planes, overlay networks, etc."],
  "networkSecurityCapabilities": ["Network security features: firewalls, microsegmentation, intrusion detection, security policies, encryption, access control, etc."],
  "virtualSwitchingRouting": ["Virtual switching and routing: virtual switches, logical routers, VXLAN/GENEVE tunneling, BGP/OSPF, traffic forwarding, flow tables, etc."],
  "hypervisorVmManagement": ["Hypervisor and VM management: VM lifecycle, live migration, resource scheduling, memory management, CPU allocation, storage virtualization, etc."],
  "otherRelevantFeatures": ["Other potentially patent-relevant technical features not covered above"],
  "executiveSummary": "2-3 sentence summary of the document's key technical content and its relevance to SDN/NFV patent assertion"
}

If a category has no relevant content, use an empty array [].
Be specific — reference actual feature names, protocols, and implementation details from the document.`;

async function summarizeDoc(
  text: string,
  documentName: string,
  productName: string,
  companyName: string
): Promise<DocSummary['summary']> {
  // Truncate if needed
  const truncated = text.length > MAX_TEXT_LENGTH
    ? text.substring(0, MAX_TEXT_LENGTH) + '\n\n[... truncated ...]'
    : text;

  const response = await anthropic.messages.create({
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

  const responseText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  try {
    return JSON.parse(responseText);
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error(`Failed to parse LLM response as JSON: ${responseText.substring(0, 200)}`);
  }
}

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

async function main() {
  const config = parseArgs();

  console.log('=== Product Doc Summarization ===');
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
    console.log('\n(Dry run — no LLM calls made)');
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

        const result: DocSummary = {
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
        console.log(`    Saved summary → ${path.relative(process.cwd(), task.outputPath)}`);
        completed++;
      } catch (err) {
        console.error(`    Failed: ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    });

    await Promise.all(promises);
  }

  console.log('\n=== Summarization Complete ===');
  console.log(`Completed: ${completed}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${tasks.length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
