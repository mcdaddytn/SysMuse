/**
 * Extract text from downloaded product documentation (PDF and HTML).
 *
 * Iterates docs in /Volumes/GLSSD2/data/products/docs/{company}/{product}/,
 * extracts text, and saves {docSlug}.txt alongside originals.
 * Updates product cache with extractedTextPath.
 *
 * Usage:
 *   npx tsx scripts/process-product-docs.ts [options]
 *     --company <slug>      Process only one company
 *     --product <slug>      Process only one product (requires --company)
 *     --docs-dir <path>     Override docs directory
 *     --dry-run             Show what would be processed
 *     --force               Re-extract even if .txt already exists
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import {
  getAllProductCaches,
  readProductCache,
  writeProductCache,
  slugify,
  type ProductCache,
} from '../src/api/services/patlytics-cache-service.js';

const DEFAULT_DOCS_DIR = '/Volumes/GLSSD2/data/products/docs/';

interface Config {
  docsDir: string;
  company: string | null;
  product: string | null;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let docsDir = DEFAULT_DOCS_DIR;
  let company: string | null = null;
  let product: string | null = null;
  let dryRun = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--docs-dir' && args[i + 1]) docsDir = args[++i];
    else if (arg === '--company' && args[i + 1]) company = args[++i];
    else if (arg === '--product' && args[i + 1]) product = args[++i];
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--force') force = true;
  }

  return { docsDir, company, product, dryRun, force };
}

function extractPdf(filePath: string): string {
  try {
    const text = execSync(`pdftotext -layout "${filePath}" -`, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    }).toString('utf-8');
    return text.trim();
  } catch (err) {
    console.error(`    pdftotext failed: ${err instanceof Error ? err.message : err}`);
    return '';
  }
}

function extractHtml(filePath: string): string {
  const html = fs.readFileSync(filePath, 'utf-8');
  // Strip script/style tags and their content, then all other tags
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

function extractText(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return extractPdf(filePath);
  if (ext === '.html' || ext === '.htm') return extractHtml(filePath);
  if (ext === '.txt') return fs.readFileSync(filePath, 'utf-8').trim();
  // For unknown types, try reading as text
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

async function main() {
  const config = parseArgs();

  console.log('=== Product Doc Text Extraction ===');
  console.log(`Docs dir: ${config.docsDir}`);
  if (config.company) console.log(`Company filter: ${config.company}`);
  if (config.product) console.log(`Product filter: ${config.product}`);
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.force) console.log('MODE: FORCE (re-extract all)');

  let products = getAllProductCaches();
  if (config.company) {
    products = products.filter(p => p.companySlug === config.company);
  }
  if (config.product) {
    products = products.filter(p => p.productSlug === config.product);
  }

  if (products.length === 0) {
    console.log('\nNo products found in cache.');
    return;
  }

  console.log(`\nFound ${products.length} products to process\n`);

  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const productMeta of products) {
    const product = readProductCache(productMeta.companySlug, productMeta.productSlug);
    if (!product) continue;

    console.log(`\n--- ${product.companyName} / ${product.productName} ---`);

    let productModified = false;

    for (const doc of product.documents) {
      if (doc.downloadStatus !== 'completed' || !doc.localPath) continue;

      // Resolve actual file path (download script may have appended extension)
      let actualPath = doc.localPath;
      if (!fs.existsSync(actualPath)) {
        // Try common extensions
        for (const ext of ['.html', '.pdf', '.txt', '.htm', '.xml', '.json']) {
          if (fs.existsSync(actualPath + ext)) {
            actualPath = actualPath + ext;
            break;
          }
        }
      }

      // Determine text output path
      const docDir = path.dirname(actualPath);
      const docBase = path.basename(actualPath, path.extname(actualPath));
      const txtPath = path.join(docDir, `${docBase}.txt`);

      // Skip if already extracted (unless --force)
      if (fs.existsSync(txtPath) && !config.force) {
        totalSkipped++;
        continue;
      }

      if (!fs.existsSync(actualPath)) {
        console.log(`  [MISSING] ${doc.documentName} — file not found: ${doc.localPath}`);
        totalFailed++;
        continue;
      }

      if (config.dryRun) {
        console.log(`  [DRY] ${doc.documentName} (${path.extname(actualPath)})`);
        totalSkipped++;
        continue;
      }

      console.log(`  Extracting: ${doc.documentName} (${path.extname(actualPath)})`);
      const text = extractText(actualPath);

      if (text.length === 0) {
        console.log(`    Empty extraction — skipping`);
        totalFailed++;
        continue;
      }

      fs.writeFileSync(txtPath, text);
      console.log(`    Saved ${(text.length / 1024).toFixed(1)} KB → ${path.basename(txtPath)}`);

      // Update product cache with extracted text path
      (doc as any).extractedTextPath = txtPath;
      productModified = true;
      totalProcessed++;
    }

    if (productModified && !config.dryRun) {
      writeProductCache(product.companySlug, product.productSlug, product);
    }
  }

  console.log('\n=== Extraction Summary ===');
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Skipped:   ${totalSkipped}`);
  console.log(`Failed:    ${totalFailed}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
