/**
 * Batch Fetch Patent Records from PatentsView API
 *
 * Downloads full patent records (including abstracts) for all portfolio patents.
 * Each patent is cached individually to cache/api/patentsview/patent/{id}.json
 *
 * Strategy:
 * - Reads patent IDs from the latest streaming-candidates file
 * - Skips patents already cached on disk (resume support)
 * - Batches 100 IDs per API request (~290 requests for 28,913 patents)
 * - Requests maximum useful fields per request (abstract, assignees, inventors, CPC, etc.)
 * - Respects PatentsView rate limit (45 req/min) with conservative 1.5s spacing
 *
 * Usage:
 *   npx tsx scripts/batch-fetch-patents.ts [options]
 *
 * Options:
 *   --dry-run        Count uncached patents without fetching
 *   --batch-size N   Patents per API request (default: 100, max: 100)
 *   --delay N        Milliseconds between requests (default: 1500)
 *   --start N        Start at Nth uncached patent (for manual offset)
 *   --limit N        Max number of API requests to make
 *   --force          Re-fetch even if cache file exists
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const PATENTSVIEW_API_URL = 'https://search.patentsview.org/api/v1/patent/';
const CACHE_DIR = './cache/api/patentsview/patent';
const OUTPUT_DIR = './output';

// Fields to request — maximize data per API call
// Note: PatentsView API v1 uses dot-notation for sub-entities.
// Some fields differ from response keys (e.g., application.application_number → response.application.application_number)
const PATENT_FIELDS = [
  // Core patent info
  'patent_id',
  'patent_title',
  'patent_abstract',
  'patent_date',
  'patent_type',
  'withdrawn',

  // Application info (sub-entity)
  'application.application_number',
  'application.filing_date',

  // Assignees (full details)
  'assignees.assignee_id',
  'assignees.assignee_type',
  'assignees.assignee_organization',
  'assignees.assignee_individual_name_first',
  'assignees.assignee_individual_name_last',
  'assignees.assignee_city',
  'assignees.assignee_state',
  'assignees.assignee_country',
  'assignees.assignee_sequence',

  // Inventors
  'inventors.inventor_id',
  'inventors.inventor_name_first',
  'inventors.inventor_name_last',
  'inventors.inventor_city',
  'inventors.inventor_state',
  'inventors.inventor_country',
  'inventors.inventor_sequence',

  // CPC classifications (current)
  'cpc_current.cpc_sequence',
  'cpc_current.cpc_class_id',
  'cpc_current.cpc_subclass_id',
  'cpc_current.cpc_group_id',

  // WIPO classification
  'wipo.wipo_field_id',
  'wipo.wipo_sequence',

  // Citation counts
  'patent_num_times_cited_by_us_patents',
  'patent_num_us_patents_cited',
  'patent_num_us_applications_cited',
  'patent_num_foreign_documents_cited',
  'patent_num_total_documents_cited',
];

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

interface Args {
  dryRun: boolean;
  batchSize: number;
  delayMs: number;
  start: number;
  limit: number | null;
  force: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    dryRun: false,
    batchSize: 100,
    delayMs: 1500,
    start: 0,
    limit: null,
    force: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--dry-run': args.dryRun = true; break;
      case '--force': args.force = true; break;
      case '--batch-size': args.batchSize = Math.min(100, parseInt(argv[++i])); break;
      case '--delay': args.delayMs = parseInt(argv[++i]); break;
      case '--start': args.start = parseInt(argv[++i]); break;
      case '--limit': args.limit = parseInt(argv[++i]); break;
    }
  }

  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core functions
// ─────────────────────────────────────────────────────────────────────────────

function loadPatentIds(): string[] {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found in output/');
  }

  const filepath = path.join(OUTPUT_DIR, files[0]);
  console.log(`Reading patent IDs from: ${files[0]}`);

  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  const candidates = data.candidates || [];
  return candidates.map((c: any) => c.patent_id).filter(Boolean);
}

function isCached(patentId: string): boolean {
  return fs.existsSync(path.join(CACHE_DIR, `${patentId}.json`));
}

function saveToCache(patent: any): void {
  const filepath = path.join(CACHE_DIR, `${patent.patent_id}.json`);
  fs.writeFileSync(filepath, JSON.stringify(patent, null, 2));
}

async function fetchBatch(patentIds: string[], apiKey: string): Promise<any[]> {
  const body = {
    q: { _or: patentIds.map(id => ({ patent_id: id })) },
    f: PATENT_FIELDS,
    o: { size: patentIds.length },
  };

  const response = await fetch(PATENTSVIEW_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as any;
  return data.patents || [];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const apiKey = process.env.PATENTSVIEW_API_KEY;

  if (!apiKey) {
    console.error('PATENTSVIEW_API_KEY not set in .env');
    process.exit(1);
  }

  // Ensure cache directory exists
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log('\n' + '═'.repeat(65));
  console.log('     BATCH FETCH PATENT RECORDS (Option A)');
  console.log('═'.repeat(65));

  // Load all patent IDs
  const allIds = loadPatentIds();
  console.log(`Total portfolio patents: ${allIds.length.toLocaleString()}`);

  // Determine which need fetching
  let uncachedIds: string[];
  if (args.force) {
    uncachedIds = allIds;
    console.log(`Force mode: will re-fetch all ${uncachedIds.length.toLocaleString()} patents`);
  } else {
    uncachedIds = allIds.filter(id => !isCached(id));
    const cachedCount = allIds.length - uncachedIds.length;
    console.log(`Already cached: ${cachedCount.toLocaleString()}`);
    console.log(`Need fetching:  ${uncachedIds.length.toLocaleString()}`);
  }

  // Apply start offset
  if (args.start > 0) {
    uncachedIds = uncachedIds.slice(args.start);
    console.log(`Starting at offset ${args.start}: ${uncachedIds.length.toLocaleString()} remaining`);
  }

  // Calculate batches
  const totalBatches = Math.ceil(uncachedIds.length / args.batchSize);
  const effectiveBatches = args.limit ? Math.min(totalBatches, args.limit) : totalBatches;
  const effectivePatents = Math.min(uncachedIds.length, effectiveBatches * args.batchSize);
  const estimatedTimeMin = (effectiveBatches * args.delayMs) / 1000 / 60;

  console.log(`\nBatch size:        ${args.batchSize}`);
  console.log(`API requests:      ${effectiveBatches.toLocaleString()} of ${totalBatches.toLocaleString()}`);
  console.log(`Patents to fetch:  ${effectivePatents.toLocaleString()}`);
  console.log(`Delay between:     ${args.delayMs}ms (~${Math.round(60000 / args.delayMs)} req/min)`);
  console.log(`Estimated time:    ${estimatedTimeMin.toFixed(1)} minutes`);

  if (args.dryRun) {
    console.log('\n[DRY RUN] No API calls made.');
    process.exit(0);
  }

  if (uncachedIds.length === 0) {
    console.log('\nAll patents already cached. Nothing to fetch.');
    process.exit(0);
  }

  // Execute batches
  console.log('\n' + '─'.repeat(65));
  console.log('FETCHING');
  console.log('─'.repeat(65));

  const startTime = Date.now();
  let totalFetched = 0;
  let totalSaved = 0;
  let totalErrors = 0;
  let abstractCount = 0;
  let batchNum = 0;

  for (let i = 0; i < uncachedIds.length; i += args.batchSize) {
    batchNum++;
    if (args.limit && batchNum > args.limit) break;

    const batchIds = uncachedIds.slice(i, i + args.batchSize);
    const batchLabel = `[${batchNum}/${effectiveBatches}]`;

    try {
      const patents = await fetchBatch(batchIds, apiKey);
      totalFetched += patents.length;

      // Save each patent individually
      for (const patent of patents) {
        saveToCache(patent);
        totalSaved++;
        if (patent.patent_abstract) abstractCount++;
      }

      // Log missing patents in this batch
      const returnedIds = new Set(patents.map((p: any) => p.patent_id));
      const missing = batchIds.filter(id => !returnedIds.has(id));
      const missingNote = missing.length > 0 ? ` (${missing.length} not found)` : '';

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = totalSaved / elapsed;
      const eta = (effectivePatents - totalSaved) / rate;

      process.stdout.write(
        `\r  ${batchLabel} Saved: ${totalSaved.toLocaleString()} | ` +
        `Abstracts: ${abstractCount.toLocaleString()} | ` +
        `${rate.toFixed(0)} p/s | ` +
        `ETA: ${(eta / 60).toFixed(1)}m${missingNote}     `
      );

    } catch (err: any) {
      totalErrors++;
      console.error(`\n  ${batchLabel} ERROR: ${err.message}`);

      // On rate limit (429), wait longer
      if (err.message.includes('429')) {
        console.log('  Rate limited — waiting 60s...');
        await sleep(60000);
        i -= args.batchSize; // Retry this batch
        batchNum--;
        continue;
      }

      // On server error (5xx), wait and retry once
      if (err.message.includes('5')) {
        console.log('  Server error — waiting 10s and retrying...');
        await sleep(10000);
        i -= args.batchSize; // Retry this batch
        batchNum--;
        totalErrors--; // Don't count retry
        continue;
      }
    }

    // Rate limit delay (skip after last batch)
    if (i + args.batchSize < uncachedIds.length) {
      await sleep(args.delayMs);
    }
  }

  // Summary
  const elapsed = (Date.now() - startTime) / 1000 / 60;
  const finalCachedCount = allIds.filter(id => isCached(id)).length;

  console.log('\n\n' + '─'.repeat(65));
  console.log('COMPLETE');
  console.log('─'.repeat(65));
  console.log(`  Time:              ${elapsed.toFixed(1)} minutes`);
  console.log(`  API requests:      ${batchNum}`);
  console.log(`  Patents fetched:   ${totalFetched.toLocaleString()}`);
  console.log(`  Patents saved:     ${totalSaved.toLocaleString()}`);
  console.log(`  With abstracts:    ${abstractCount.toLocaleString()} (${(abstractCount / Math.max(totalSaved, 1) * 100).toFixed(1)}%)`);
  console.log(`  Errors:            ${totalErrors}`);
  console.log(`  Cache coverage:    ${finalCachedCount.toLocaleString()} / ${allIds.length.toLocaleString()} (${(finalCachedCount / allIds.length * 100).toFixed(1)}%)`);
  console.log('\nNext steps:');
  console.log('  1. Re-import to ES with abstracts:');
  console.log('     npx tsx services/import-to-elasticsearch.ts --recreate --candidates');
  console.log('  2. Verify in UI: abstracts should appear in search results and patent detail');
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
