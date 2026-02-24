/**
 * Prosecution Detail Enrichment Script
 *
 * Retrieves claim-level prosecution analysis for patents using a hybrid multi-API strategy:
 *   1. Office Action Rejection API → structured JSON (fastest, no LLM needed)
 *   2. Office Action Text API → extracted text for LLM analysis (12-series filings)
 *   3. PDF download + pdftotext → fallback for older patents
 *   4. LLM analysis on text → extract estoppel risk, examiner reasoning, amendment significance
 *   5. Merge all sources → ProsecutionTimelineData → save to cache + DB
 *
 * Usage:
 *   npx tsx scripts/enrich-prosecution-detail.ts [patent-ids-file] [--skip-existing]
 *   npx tsx scripts/enrich-prosecution-detail.ts --top 50
 *
 * Follows check-prosecution-history.ts patterns: batch file input, --skip-existing,
 * flag buffering, server cache invalidation.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { retrieveProsecutionDocuments, checkPdftotextAvailable } from '../src/api/services/prosecution-document-service.js';
import { analyzeProsecutionForPatent } from '../src/api/services/prosecution-analyzer-service.js';

dotenv.config();

// ─── Server communication ────────────────────────────────────────────────────

async function invalidateServerCache(): Promise<void> {
  try {
    const response = await fetch('http://localhost:3001/api/patents/invalidate-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.ok) {
      console.log('\n[Cache] Server enrichment cache invalidated');
    } else {
      console.log('\n[Cache] Failed to invalidate cache (server may not be running)');
    }
  } catch {
    console.log('\n[Cache] Could not contact server to invalidate cache');
  }
}

const flagBuffer: string[] = [];
const FLAG_BUFFER_SIZE = 10;

async function flushFlagBuffer(): Promise<void> {
  if (flagBuffer.length === 0) return;
  const ids = flagBuffer.splice(0, flagBuffer.length);
  try {
    await fetch('http://localhost:3001/api/patents/set-enrichment-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patentIds: ids, flag: 'hasProsecutionDetail' }),
    });
  } catch {
    // Non-fatal — repair endpoint can backfill later
  }
}

async function setFlagInline(patentId: string): Promise<void> {
  flagBuffer.push(patentId);
  if (flagBuffer.length >= FLAG_BUFFER_SIZE) {
    await flushFlagBuffer();
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const skipExisting = args.includes('--skip-existing');
  const topArg = args.find(a => a.startsWith('--top'));
  const topN = topArg ? parseInt(args[args.indexOf(topArg) + 1] || '50') : 0;

  // Load patent IDs from batch file or stdin
  let patentIds: string[] = [];
  const batchFile = args.find(a => !a.startsWith('--') && fs.existsSync(a));

  if (batchFile) {
    const content = fs.readFileSync(batchFile, 'utf-8');
    patentIds = JSON.parse(content);
    console.log(`[ProsDetail] Loaded ${patentIds.length} patent IDs from ${batchFile}`);
  } else if (topN > 0) {
    console.log(`[ProsDetail] --top ${topN} requires a batch file. Use the job queue to generate one.`);
    process.exit(1);
  } else {
    console.log('Usage: npx tsx scripts/enrich-prosecution-detail.ts <batch-file.json> [--skip-existing]');
    process.exit(1);
  }

  // Check pdftotext availability
  const hasPdftotext = await checkPdftotextAvailable();
  if (!hasPdftotext) {
    console.warn('[ProsDetail] WARNING: pdftotext not found. PDF fallback will be unavailable.');
    console.warn('[ProsDetail] Install: brew install poppler (macOS) or apt-get install poppler-utils (Linux)');
  }

  const model = process.env.LLM_MODEL || 'claude-sonnet-4-20250514';
  console.log(`[ProsDetail] Model: ${model}`);
  console.log(`[ProsDetail] Skip existing: ${skipExisting}`);
  console.log(`[ProsDetail] Starting enrichment for ${patentIds.length} patents...`);

  let completed = 0;
  let successful = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  const startTime = Date.now();

  for (const patentId of patentIds) {
    try {
      // Check if already analyzed
      if (skipExisting) {
        const cachePath = path.join(process.cwd(), 'cache/prosecution-analysis', `${patentId}.json`);
        if (fs.existsSync(cachePath)) {
          skipped++;
          completed++;
          if (completed % 10 === 0) {
            printProgress(completed, patentIds.length, successful, skipped, failed, startTime);
          }
          continue;
        }
      }

      // Step 1: Retrieve prosecution documents (hybrid: API text + PDF fallback)
      const docs = await retrieveProsecutionDocuments(patentId, {
        includeResponses: true,
        skipExisting: true,
      });

      if (docs.officeActions.length === 0 && docs.errors.length === 0) {
        // No prosecution documents found (might be a very new or pre-2001 patent)
        skipped++;
        completed++;
        continue;
      }

      if (docs.errors.length > 0) {
        for (const err of docs.errors) {
          console.warn(`[ProsDetail] ${patentId}: ${err}`);
        }
      }

      // Step 2: LLM analysis + merge with structured API data
      const timeline = await analyzeProsecutionForPatent(
        patentId,
        docs.applicationNumber,
        docs.officeActions,
        docs.applicantResponses,
        { model, skipExisting }
      );

      // Step 3: Set enrichment flag
      await setFlagInline(patentId);

      successful++;
      console.log(`[ProsDetail] ${patentId}: ${timeline.totalActions} OAs, ${timeline.totalRejections} rejections, ${timeline.estoppelArguments.length} estoppel risks, score=${timeline.prosecutionScore}`);
    } catch (err: any) {
      failed++;
      const msg = `${patentId}: ${err.message || err}`;
      errors.push(msg);
      console.error(`[ProsDetail] FAILED: ${msg}`);
    }

    completed++;
    if (completed % 10 === 0 || completed === patentIds.length) {
      printProgress(completed, patentIds.length, successful, skipped, failed, startTime);
    }
  }

  // Flush remaining flags
  await flushFlagBuffer();

  // Final report
  const elapsed = (Date.now() - startTime) / 1000;
  console.log('\n' + '='.repeat(60));
  console.log(`[ProsDetail] COMPLETE`);
  console.log(`  Total:      ${patentIds.length}`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Skipped:    ${skipped}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Time:       ${elapsed.toFixed(1)}s (${(elapsed / Math.max(1, successful)).toFixed(1)}s/patent)`);
  if (errors.length > 0) {
    console.log(`\n  Errors:`);
    for (const err of errors.slice(0, 20)) {
      console.log(`    - ${err}`);
    }
    if (errors.length > 20) {
      console.log(`    ... and ${errors.length - 20} more`);
    }
  }
  console.log('='.repeat(60));

  // Invalidate server cache
  await invalidateServerCache();
}

function printProgress(
  completed: number,
  total: number,
  successful: number,
  skipped: number,
  failed: number,
  startTime: number
) {
  const pct = Math.round((completed / total) * 100);
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = elapsed > 0 ? (completed / elapsed * 3600).toFixed(0) : '?';
  const remaining = elapsed > 0 ? ((total - completed) / (completed / elapsed)).toFixed(0) : '?';
  console.log(`  Progress: ${completed}/${total} (${pct}%) | ok=${successful} skip=${skipped} fail=${failed} | ${rate}/hr | ETA ${remaining}s`);
}

main().catch(err => {
  console.error('[ProsDetail] Fatal error:', err);
  process.exit(1);
});
