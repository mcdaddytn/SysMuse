/**
 * Overnight Analysis Runner
 *
 * Runs all pending analysis jobs sequentially for unattended overnight execution.
 * Jobs include:
 * 1. Citation overlap analysis (full portfolio)
 * 2. Multi-score recalculation
 * 3. CSV export
 *
 * Usage:
 *   npx tsx scripts/run-overnight-analysis.ts [--resume-from <batch>] [--dry-run]
 *
 * Estimated time: ~12-14 hours for full 15K patent citation overlap
 */

import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

const BATCH_SIZE = 500;
const TOTAL_PATENTS = 15276;
const OUTPUT_DIR = 'output';
const DATE_STAMP = new Date().toISOString().slice(0, 10);
const LOG_FILE = `${OUTPUT_DIR}/overnight-analysis-${DATE_STAMP}.log`;

interface JobResult {
  job: string;
  status: 'success' | 'error' | 'skipped';
  duration: number;
  message?: string;
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function runCommand(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    log(`Running: ${command} ${args.join(' ')}`);

    let stdout = '';
    let stderr = '';

    const proc = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      shell: true
    });

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // Print periodic updates
      if (text.includes('Progress') || text.includes('Complete') || text.includes('Found')) {
        log(text.trim());
      }
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ exitCode: code || 0, stdout, stderr });
    });
  });
}

async function checkAlreadyRun(start: number, end: number): Promise<boolean> {
  const pattern = `${OUTPUT_DIR}/citation-overlap-${start}-${end}-${DATE_STAMP}.json`;
  return fs.existsSync(pattern);
}

async function runCitationOverlapBatch(start: number, end: number, dryRun: boolean): Promise<JobResult> {
  const jobName = `citation-overlap-${start}-${end}`;

  if (await checkAlreadyRun(start, end)) {
    log(`Skipping ${jobName} - already completed today`);
    return { job: jobName, status: 'skipped', duration: 0, message: 'Already completed' };
  }

  if (dryRun) {
    log(`[DRY RUN] Would run: ${jobName}`);
    return { job: jobName, status: 'skipped', duration: 0, message: 'Dry run' };
  }

  const startTime = Date.now();

  const result = await runCommand('npx', [
    'tsx', 'examples/citation-overlap-batch.ts', String(start), String(end)
  ]);

  const duration = (Date.now() - startTime) / 1000 / 60; // minutes

  if (result.exitCode !== 0) {
    log(`ERROR in ${jobName}: ${result.stderr}`);
    return { job: jobName, status: 'error', duration, message: result.stderr };
  }

  log(`Completed ${jobName} in ${duration.toFixed(1)} minutes`);
  return { job: jobName, status: 'success', duration };
}

async function runMultiScoreAnalysis(dryRun: boolean): Promise<JobResult> {
  const jobName = 'multi-score-analysis';

  if (dryRun) {
    log(`[DRY RUN] Would run: ${jobName}`);
    return { job: jobName, status: 'skipped', duration: 0, message: 'Dry run' };
  }

  const startTime = Date.now();
  const result = await runCommand('npx', ['tsx', 'examples/multi-score-analysis.ts']);
  const duration = (Date.now() - startTime) / 1000 / 60;

  if (result.exitCode !== 0) {
    return { job: jobName, status: 'error', duration, message: result.stderr };
  }

  log(`Completed ${jobName} in ${duration.toFixed(1)} minutes`);
  return { job: jobName, status: 'success', duration };
}

async function runUnifiedTop250(dryRun: boolean): Promise<JobResult> {
  const jobName = 'unified-top250-v2';

  if (dryRun) {
    log(`[DRY RUN] Would run: ${jobName}`);
    return { job: jobName, status: 'skipped', duration: 0, message: 'Dry run' };
  }

  const startTime = Date.now();
  const result = await runCommand('npx', ['tsx', 'scripts/calculate-unified-top250-v2.ts']);
  const duration = (Date.now() - startTime) / 1000 / 60;

  if (result.exitCode !== 0) {
    return { job: jobName, status: 'error', duration, message: result.stderr };
  }

  log(`Completed ${jobName} in ${duration.toFixed(1)} minutes`);
  return { job: jobName, status: 'success', duration };
}

async function runExport(dryRun: boolean): Promise<JobResult> {
  const jobName = 'export-raw-metrics-csv';

  if (dryRun) {
    log(`[DRY RUN] Would run: ${jobName}`);
    return { job: jobName, status: 'skipped', duration: 0, message: 'Dry run' };
  }

  const startTime = Date.now();
  const result = await runCommand('npx', ['tsx', 'scripts/export-raw-metrics-csv.ts']);
  const duration = (Date.now() - startTime) / 1000 / 60;

  if (result.exitCode !== 0) {
    return { job: jobName, status: 'error', duration, message: result.stderr };
  }

  log(`Completed ${jobName} in ${duration.toFixed(1)} minutes`);
  return { job: jobName, status: 'success', duration };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const resumeFromIdx = args.indexOf('--resume-from');
  const resumeFrom = resumeFromIdx >= 0 ? parseInt(args[resumeFromIdx + 1]) : 0;

  log('═══════════════════════════════════════════════════════════════');
  log('           OVERNIGHT ANALYSIS RUNNER');
  log('═══════════════════════════════════════════════════════════════');
  log(`Date: ${DATE_STAMP}`);
  log(`Dry run: ${dryRun}`);
  log(`Resume from batch: ${resumeFrom}`);
  log(`Total patents: ${TOTAL_PATENTS}`);
  log(`Batch size: ${BATCH_SIZE}`);
  log(`Estimated batches: ${Math.ceil(TOTAL_PATENTS / BATCH_SIZE)}`);
  log(`Log file: ${LOG_FILE}`);
  log('');

  const results: JobResult[] = [];
  const overallStartTime = Date.now();

  // Phase 1: Citation Overlap Analysis
  log('\n=== PHASE 1: Citation Overlap Analysis ===\n');

  const totalBatches = Math.ceil(TOTAL_PATENTS / BATCH_SIZE);
  for (let i = resumeFrom; i < totalBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, TOTAL_PATENTS);

    log(`\nBatch ${i + 1}/${totalBatches}: ${start}-${end}`);
    const result = await runCitationOverlapBatch(start, end, dryRun);
    results.push(result);

    // Small delay between batches to avoid any rate limit issues
    if (!dryRun && result.status === 'success') {
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Phase 2: Multi-Score Recalculation
  log('\n=== PHASE 2: Multi-Score Recalculation ===\n');
  results.push(await runMultiScoreAnalysis(dryRun));

  // Phase 3: Unified Top 250
  log('\n=== PHASE 3: Unified Top 250 Calculation ===\n');
  results.push(await runUnifiedTop250(dryRun));

  // Phase 4: Export
  log('\n=== PHASE 4: Export CSV ===\n');
  results.push(await runExport(dryRun));

  // Summary
  const totalDuration = (Date.now() - overallStartTime) / 1000 / 60 / 60; // hours
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const skippedCount = results.filter(r => r.status === 'skipped').length;

  log('\n═══════════════════════════════════════════════════════════════');
  log('                        SUMMARY');
  log('═══════════════════════════════════════════════════════════════');
  log(`Total time: ${totalDuration.toFixed(2)} hours`);
  log(`Jobs successful: ${successCount}`);
  log(`Jobs with errors: ${errorCount}`);
  log(`Jobs skipped: ${skippedCount}`);

  if (errorCount > 0) {
    log('\nErrors:');
    results.filter(r => r.status === 'error').forEach(r => {
      log(`  - ${r.job}: ${r.message}`);
    });
  }

  log('\nOVERNIGHT ANALYSIS COMPLETE');
  log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  log(`FATAL ERROR: ${err.message}`);
  process.exit(1);
});
