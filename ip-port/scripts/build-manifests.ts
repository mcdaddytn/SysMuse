/**
 * Build Manifests CLI
 *
 * One-time (or incremental) build of manifest files for all USPTO bulk XML data.
 * Creates lightweight .manifest.json alongside each weekly XML, then builds the
 * forward-counts.ndjson inverted index for true forward citation counts.
 *
 * Usage:
 *   npx tsx scripts/build-manifests.ts
 *   npx tsx scripts/build-manifests.ts --start-year 2025 --end-year 2020
 *   npx tsx scripts/build-manifests.ts --force
 *   npx tsx scripts/build-manifests.ts --forward-only
 */

import 'dotenv/config';

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const forwardOnly = args.includes('--forward-only');

  let startYear = new Date().getFullYear();
  let endYear = 2015;

  const startIdx = args.indexOf('--start-year');
  if (startIdx !== -1 && args[startIdx + 1]) startYear = parseInt(args[startIdx + 1]);

  const endIdx = args.indexOf('--end-year');
  if (endIdx !== -1 && args[endIdx + 1]) endYear = parseInt(args[endIdx + 1]);

  const { buildAllManifests, buildForwardCounts, getManifestStatus } = await import(
    '../src/api/services/manifest-builder-service.js'
  );

  const log = (msg: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

  // Show current status
  const status = getManifestStatus(startYear, endYear);
  console.log('\n=== Manifest Status ===');
  console.log(`Bulk data dir: ${status.bulkDataDir}`);
  console.log(`Weekly files: ${status.totalWeeklyFiles}`);
  console.log(`Manifests built: ${status.manifestsBuilt}`);
  console.log(`Manifests missing: ${status.manifestsMissing}`);
  console.log(`Forward counts: ${status.forwardCountsExist ? `${status.forwardCountPatents} patents` : 'not built'}`);
  console.log('');

  if (!forwardOnly) {
    console.log(`=== Building Manifests (${startYear}→${endYear}${force ? ', force rebuild' : ''}) ===`);
    const startTime = Date.now();
    const result = await buildAllManifests({
      startYear,
      endYear,
      force,
      onProgress: log,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nManifests: ${result.built} built, ${result.skipped} skipped, ${result.failed} failed (${elapsed}s)\n`);
  }

  console.log('=== Building Forward Citation Counts ===');
  const fcStart = Date.now();
  const fcResult = await buildForwardCounts({
    startYear,
    endYear,
    onProgress: log,
  });
  const fcElapsed = ((Date.now() - fcStart) / 1000).toFixed(1);
  console.log(`\nForward counts: ${fcResult.totalPatentsCited} unique cited patents (${fcElapsed}s)\n`);

  // Final status
  const finalStatus = getManifestStatus(startYear, endYear);
  console.log('=== Final Status ===');
  console.log(`Manifests: ${finalStatus.manifestsBuilt}/${finalStatus.totalWeeklyFiles}`);
  console.log(`Forward counts: ${finalStatus.forwardCountPatents} patents`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
