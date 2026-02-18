/**
 * Batch Score Overnight
 *
 * Submits batch scoring jobs via the Anthropic Batch API (50% cost savings).
 * Results arrive within 24h — process them the next morning.
 *
 * Usage:
 *   npx tsx scripts/batch-score-overnight.ts --all-video                    # All 7 VIDEO_STREAMING sectors
 *   npx tsx scripts/batch-score-overnight.ts --sectors video-codec,video-server-cdn
 *   npx tsx scripts/batch-score-overnight.ts --all-video --rescore          # Re-score already scored patents
 *   npx tsx scripts/batch-score-overnight.ts --all-video --limit 50         # Limit per sector
 *   npx tsx scripts/batch-score-overnight.ts --all-video --wait             # Poll until complete
 *   npx tsx scripts/batch-score-overnight.ts --status                       # Check all batch job statuses
 *   npx tsx scripts/batch-score-overnight.ts --process                      # Process all completed batches
 */

import {
  submitBatchScoring,
  checkBatchStatus,
  processBatchResults,
  listBatchJobs,
  DEFAULT_CONTEXT_OPTIONS,
  CLAIMS_CONTEXT_OPTIONS
} from '../src/api/services/llm-scoring-service.js';

const VIDEO_STREAMING_SECTORS = [
  'video-server-cdn',
  'video-client-processing',
  'video-codec',
  'video-broadcast',
  'video-storage',
  'video-drm-conditional',
  'display-control'
];

function parseArgs(): {
  sectors: string[];
  rescore: boolean;
  limit: number;
  wait: boolean;
  useClaims: boolean;
  model: string;
  status: boolean;
  process: boolean;
} {
  const args = process.argv.slice(2);
  let sectors: string[] = [];
  let rescore = false;
  let limit = 2000;
  let wait = false;
  let useClaims = false;
  let model = 'claude-sonnet-4-20250514';
  let status = false;
  let processResults = false;

  for (const arg of args) {
    if (arg === '--all-video') {
      sectors = [...VIDEO_STREAMING_SECTORS];
    } else if (arg.startsWith('--sectors=')) {
      sectors = arg.split('=')[1].split(',').map(s => s.trim());
    } else if (arg === '--rescore') {
      rescore = true;
    } else if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1]);
    } else if (arg === '--wait') {
      wait = true;
    } else if (arg === '--use-claims') {
      useClaims = true;
    } else if (arg.startsWith('--model=')) {
      model = arg.split('=')[1];
    } else if (arg === '--status') {
      status = true;
    } else if (arg === '--process') {
      processResults = true;
    }
  }

  return { sectors, rescore, limit, wait, useClaims, model, status, process: processResults };
}

async function showStatus(): Promise<void> {
  const jobs = listBatchJobs();

  if (jobs.length === 0) {
    console.log('No batch jobs found.');
    return;
  }

  console.log(`\n=== Batch Jobs (${jobs.length} total) ===\n`);

  for (const job of jobs) {
    // Check live status from Anthropic
    let liveStatus = job.status;
    try {
      const status = await checkBatchStatus(job.batchId);
      liveStatus = status.status;
    } catch {
      // API call failed, use cached status
    }

    const age = Math.round((Date.now() - new Date(job.submittedAt).getTime()) / 1000 / 60);
    const processed = job.results.processed ? ' [PROCESSED]' : '';

    console.log(`  ${job.batchId}`);
    console.log(`    Sector: ${job.sectorName} | Patents: ${job.patentCount} | Status: ${liveStatus}${processed}`);
    console.log(`    Submitted: ${job.submittedAt} (${age}m ago)`);
    if (job.results.processed) {
      console.log(`    Results: ${job.results.succeeded} succeeded, ${job.results.errored} errored`);
    }
    console.log('');
  }
}

async function processAllCompleted(): Promise<void> {
  const jobs = listBatchJobs();
  const unprocessed = jobs.filter(j => !j.results.processed);

  if (unprocessed.length === 0) {
    console.log('No unprocessed batch jobs found.');
    return;
  }

  console.log(`\nFound ${unprocessed.length} unprocessed batch jobs. Checking status...\n`);

  for (const job of unprocessed) {
    try {
      const status = await checkBatchStatus(job.batchId);

      if (status.status === 'ended') {
        console.log(`Processing ${job.batchId} (${job.sectorName}, ${job.patentCount} patents)...`);
        const result = await processBatchResults(job.batchId);
        console.log(`  Done: ${result.processed} processed, ${result.failed} failed`);
        if (result.errors.length > 0) {
          console.log(`  Errors: ${result.errors.slice(0, 5).join('; ')}${result.errors.length > 5 ? ` (+${result.errors.length - 5} more)` : ''}`);
        }
      } else {
        console.log(`Skipping ${job.batchId} (${job.sectorName}) — status: ${status.status}`);
      }
    } catch (err) {
      console.error(`Error processing ${job.batchId}:`, (err as Error).message);
    }
  }
}

async function submitJobs(config: ReturnType<typeof parseArgs>): Promise<void> {
  if (config.sectors.length === 0) {
    console.error('No sectors specified. Use --all-video or --sectors=sector1,sector2');
    console.error('\nAvailable VIDEO_STREAMING sectors:');
    VIDEO_STREAMING_SECTORS.forEach(s => console.error(`  ${s}`));
    process.exit(1);
  }

  const contextOptions = config.useClaims ? CLAIMS_CONTEXT_OPTIONS : DEFAULT_CONTEXT_OPTIONS;

  console.log(`\n=== Batch Scoring Submission ===`);
  console.log(`Sectors: ${config.sectors.join(', ')}`);
  console.log(`Model: ${config.model}`);
  console.log(`Rescore: ${config.rescore}`);
  console.log(`Limit per sector: ${config.limit}`);
  console.log(`Claims: ${config.useClaims}`);
  console.log('');

  const batchIds: string[] = [];

  for (const sector of config.sectors) {
    try {
      console.log(`Submitting ${sector}...`);
      const result = await submitBatchScoring(sector, {
        limit: config.limit,
        model: config.model,
        rescore: config.rescore,
        contextOptions,
      });

      console.log(`  Batch ID: ${result.batchId}`);
      console.log(`  Patents:  ${result.requestCount}`);
      batchIds.push(result.batchId);
    } catch (err) {
      console.error(`  Error submitting ${sector}:`, (err as Error).message);
    }
  }

  console.log(`\n=== Submitted ${batchIds.length}/${config.sectors.length} batch jobs ===`);
  console.log(`Batch IDs:`);
  batchIds.forEach(id => console.log(`  ${id}`));

  console.log(`\nCheck status later with:`);
  console.log(`  npx tsx scripts/batch-score-overnight.ts --status`);
  console.log(`\nProcess results when complete:`);
  console.log(`  npx tsx scripts/batch-score-overnight.ts --process`);

  // Wait mode: poll until all batches complete
  if (config.wait && batchIds.length > 0) {
    console.log(`\n=== Waiting for batch completion ===`);
    const pending = new Set(batchIds);

    while (pending.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 60000)); // Check every 60s

      for (const batchId of Array.from(pending)) {
        try {
          const status = await checkBatchStatus(batchId);
          const counts = status.requestCounts;
          console.log(`  ${batchId}: ${status.status} (${counts.succeeded} done, ${counts.processing} processing, ${counts.errored} errored)`);

          if (status.status === 'ended') {
            pending.delete(batchId);
            console.log(`  -> Batch complete! Processing results...`);
            const result = await processBatchResults(batchId);
            console.log(`  -> ${result.processed} processed, ${result.failed} failed`);
          }
        } catch (err) {
          console.error(`  Error checking ${batchId}:`, (err as Error).message);
        }
      }

      if (pending.size > 0) {
        console.log(`  ${pending.size} batches still running...`);
      }
    }

    console.log(`\n=== All batches complete! ===`);
  }
}

async function main(): Promise<void> {
  const config = parseArgs();

  if (config.status) {
    await showStatus();
  } else if (config.process) {
    await processAllCompleted();
  } else {
    await submitJobs(config);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
