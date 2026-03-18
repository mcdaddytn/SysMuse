/**
 * Download product documents referenced in Patlytics heatmap data.
 *
 * Usage:
 *   npx tsx scripts/download-patlytics-docs.ts [options]
 *     --docs-dir <path>     (default: /Volumes/GLSSD2/data/products/docs/)
 *     --company <slug>      Download only for one company
 *     --limit <n>           Max documents to download
 *     --min-score <n>       Only download docs with patent score >= n (default: 0, all)
 *     --hot-only            Shorthand for --min-score 0.80
 *     --dry-run             Show URLs without downloading
 *     --concurrency <n>     Parallel downloads (default: 3)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  slugify,
  getAllProductCaches,
  readProductCache,
  writeProductCache,
  type ProductCache,
  type ProductDocument,
} from '../src/api/services/patlytics-cache-service.js';

// ── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_DOCS_DIR = '/Volumes/GLSSD2/data/products/docs/';

interface DownloadArgs {
  docsDir: string;
  company: string | null;
  limit: number;
  minScore: number;
  dryRun: boolean;
  concurrency: number;
}

function parseArgs(): DownloadArgs {
  const args = process.argv.slice(2);
  let docsDir = DEFAULT_DOCS_DIR;
  let company: string | null = null;
  let limit = Infinity;
  let minScore = 0;
  let dryRun = false;
  let concurrency = 3;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--docs-dir' && args[i + 1]) {
      docsDir = args[++i];
    } else if (arg === '--company' && args[i + 1]) {
      company = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (arg === '--min-score' && args[i + 1]) {
      minScore = parseFloat(args[++i]);
    } else if (arg === '--hot-only') {
      minScore = 0.80;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[++i], 10);
    }
  }

  return { docsDir, company, limit, minScore, dryRun, concurrency };
}

// ── Download Helpers ───────────────────────────────────────────────────────

function guessExtension(contentType: string | null, url: string): string {
  if (contentType) {
    if (contentType.includes('pdf')) return '.pdf';
    if (contentType.includes('html')) return '.html';
    if (contentType.includes('xml')) return '.xml';
    if (contentType.includes('json')) return '.json';
    if (contentType.includes('plain')) return '.txt';
    if (contentType.includes('csv')) return '.csv';
    if (contentType.includes('word') || contentType.includes('docx')) return '.docx';
    if (contentType.includes('excel') || contentType.includes('xlsx')) return '.xlsx';
    if (contentType.includes('png')) return '.png';
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  }

  // Try to guess from URL
  const urlPath = new URL(url).pathname;
  const ext = path.extname(urlPath);
  if (ext && ext.length <= 5) return ext;

  return '.html'; // Default fallback
}

async function downloadFile(
  url: string,
  destPath: string
): Promise<{ success: boolean; error?: string; contentType?: string }> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status} ${response.statusText}` };
    }

    const contentType = response.headers.get('content-type');
    const buffer = Buffer.from(await response.arrayBuffer());

    // Ensure directory exists
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // If no extension in destPath, add one based on content type
    let finalPath = destPath;
    if (!path.extname(destPath)) {
      finalPath = destPath + guessExtension(contentType, url);
    }

    fs.writeFileSync(finalPath, buffer);
    return { success: true, contentType: contentType ?? undefined };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

interface DownloadTask {
  product: ProductCache;
  docIndex: number;
  doc: ProductDocument;
  url: string;
  destPath: string;
}

async function processDownloadBatch(
  tasks: DownloadTask[],
  dryRun: boolean
): Promise<{ completed: number; failed: number; skipped: number }> {
  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const task of tasks) {
    if (dryRun) {
      console.log(`  [DRY] ${task.doc.documentName}`);
      console.log(`         URL: ${task.url}`);
      console.log(`         Dest: ${task.destPath}`);
      skipped++;
      continue;
    }

    console.log(`  Downloading: ${task.doc.documentName}`);
    console.log(`    URL: ${task.url}`);

    const result = await downloadFile(task.url, task.destPath);

    if (result.success) {
      task.doc.localPath = task.destPath;
      task.doc.downloadStatus = 'completed';
      console.log(`    ✓ Saved (${result.contentType})`);
      completed++;
    } else {
      // Try fallback URL if available
      if (task.doc.patlyticsStoredUrl && task.url !== task.doc.patlyticsStoredUrl) {
        console.log(`    ✗ Failed: ${result.error}. Trying Patlytics CDN...`);
        const fallback = await downloadFile(task.doc.patlyticsStoredUrl, task.destPath);
        if (fallback.success) {
          task.doc.localPath = task.destPath;
          task.doc.downloadStatus = 'completed';
          console.log(`    ✓ Saved from CDN (${fallback.contentType})`);
          completed++;
        } else {
          task.doc.downloadStatus = 'failed';
          task.doc.downloadError = `Primary: ${result.error}; CDN: ${fallback.error}`;
          console.log(`    ✗ Both URLs failed: ${fallback.error}`);
          failed++;
        }
      } else {
        task.doc.downloadStatus = 'failed';
        task.doc.downloadError = result.error;
        console.log(`    ✗ Failed: ${result.error}`);
        failed++;
      }
    }

    // Save product cache after each download to preserve progress
    writeProductCache(task.product.companySlug, task.product.productSlug, task.product);
  }

  return { completed, failed, skipped };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('=== Patlytics Document Download ===');
  console.log(`Docs dir: ${config.docsDir}`);
  if (config.dryRun) console.log('MODE: DRY RUN');
  if (config.company) console.log(`Company filter: ${config.company}`);
  if (config.minScore > 0) console.log(`Min doc score: ${config.minScore}`);
  if (config.limit < Infinity) console.log(`Limit: ${config.limit}`);

  // Load all product caches
  let products = getAllProductCaches();

  if (config.company) {
    products = products.filter(p => p.companySlug === config.company);
  }

  if (products.length === 0) {
    console.log('\nNo products found in cache. Run import-patlytics-heatmaps.ts first.');
    return;
  }

  console.log(`\nFound ${products.length} products with documents`);

  // Build download task list
  const tasks: DownloadTask[] = [];

  for (const product of products) {
    // Re-read fresh copy so we can mutate and save
    const freshProduct = readProductCache(product.companySlug, product.productSlug);
    if (!freshProduct) continue;

    for (let i = 0; i < freshProduct.documents.length; i++) {
      const doc = freshProduct.documents[i];

      // Skip already completed or explicitly skipped
      if (doc.downloadStatus === 'completed' || doc.downloadStatus === 'skipped') continue;

      // Apply score filter: check if any patent score meets the threshold
      if (config.minScore > 0) {
        const scores = Object.values(doc.patentScores || {}) as { score: number }[];
        const maxDocScore = scores.length > 0 ? Math.max(...scores.map(s => s.score)) : 0;
        if (maxDocScore < config.minScore) continue;
      }

      // Need at least one URL
      const url = doc.documentUrl || doc.patlyticsStoredUrl;
      if (!url) {
        doc.downloadStatus = 'skipped';
        doc.downloadError = 'No URL available';
        continue;
      }

      const docSlug = slugify(doc.documentName || `document-${i}`);
      const destDir = path.join(config.docsDir, freshProduct.companySlug, freshProduct.productSlug);
      const destPath = path.join(destDir, docSlug);

      tasks.push({
        product: freshProduct,
        docIndex: i,
        doc,
        url,
        destPath,
      });

      if (tasks.length >= config.limit) break;
    }

    if (tasks.length >= config.limit) break;
  }

  console.log(`Documents to download: ${tasks.length}`);

  if (tasks.length === 0) {
    console.log('Nothing to download.');
    return;
  }

  // Process in batches for concurrency
  let totalCompleted = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (let i = 0; i < tasks.length; i += config.concurrency) {
    const batch = tasks.slice(i, i + config.concurrency);
    console.log(`\n--- Batch ${Math.floor(i / config.concurrency) + 1} (${batch.length} files) ---`);

    // Run batch concurrently
    const promises = batch.map(task =>
      processDownloadBatch([task], config.dryRun)
    );
    const results = await Promise.all(promises);

    for (const r of results) {
      totalCompleted += r.completed;
      totalFailed += r.failed;
      totalSkipped += r.skipped;
    }
  }

  console.log('\n=== Download Summary ===');
  console.log(`Completed: ${totalCompleted}`);
  console.log(`Failed:    ${totalFailed}`);
  console.log(`Skipped:   ${totalSkipped}`);

  if (config.dryRun) {
    console.log('\n(Dry run — no files were downloaded)');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
