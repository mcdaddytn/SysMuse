/**
 * USPTO Bulk Data Indexing Script
 *
 * Indexes USPTO weekly patent grant XML files into the ip_portfolio_uspto
 * database. Extracts all fields (title, abstract, inventors, CPCs, dates,
 * backward citations) so import is a single-step database query.
 *
 * Usage:
 *   npx tsx scripts/index-uspto-bulk.ts --start 2025 --end 2015
 *   npx tsx scripts/index-uspto-bulk.ts --start 2014 --end 2005
 *   npx tsx scripts/index-uspto-bulk.ts --status
 *   npx tsx scripts/index-uspto-bulk.ts --forward-citations
 *   npx tsx scripts/index-uspto-bulk.ts --forward-citations --start 2025 --end 2005
 *   npx tsx scripts/index-uspto-bulk.ts --force
 */
import 'dotenv/config';
import {
  indexAll,
  computeForwardCitations,
  getIndexStatus,
} from '../src/api/services/uspto-index-service.js';
import { disconnectUsptoPrisma } from '../src/lib/uspto-prisma.js';

async function main() {
  const args = process.argv.slice(2);

  const startYear = args.includes('--start')
    ? parseInt(args[args.indexOf('--start') + 1])
    : new Date().getFullYear();
  const endYear = args.includes('--end')
    ? parseInt(args[args.indexOf('--end') + 1])
    : 2015;
  const force = args.includes('--force');
  const statusOnly = args.includes('--status');
  const forwardOnly = args.includes('--forward-citations');

  // CPC section filter
  const cpcSections = args.includes('--cpc-sections')
    ? args[args.indexOf('--cpc-sections') + 1].split(',')
    : ['H', 'G', 'B'];

  const log = (msg: string) => console.log(msg);

  try {
    if (statusOnly) {
      const status = await getIndexStatus(startYear, endYear);
      console.log('\n=== USPTO Index Status ===');
      console.log(`Weekly files in range: ${status.totalWeeklyFiles}`);
      console.log(`Files indexed: ${status.indexedFiles}`);
      console.log(`Total patents (pre-filter): ${status.totalPatents.toLocaleString()}`);
      console.log(`Filtered patents (in index): ${status.filteredPatents.toLocaleString()}`);
      console.log('\nBy year:');
      for (const y of status.byYear) {
        console.log(`  ${y.year}: ${y.files} files, ${y.patents.toLocaleString()} patents`);
      }
      return;
    }

    if (forwardOnly) {
      console.log('\n=== Computing Forward Citations ===');
      const t = Date.now();
      const result = await computeForwardCitations({
        startYear,
        endYear: Math.min(endYear, 2005),
        onProgress: log,
      });
      console.log(`\nDone in ${((Date.now() - t) / 1000).toFixed(1)}s`);
      console.log(`  Cited patents: ${result.totalCited.toLocaleString()}`);
      console.log(`  Updates applied: ${result.updated.toLocaleString()}`);
      return;
    }

    // Main indexing
    console.log('\n=== USPTO Bulk Data Indexing ===');
    console.log(`Year range: ${startYear} → ${endYear}`);
    console.log(`CPC sections: ${cpcSections.join(', ')} + unclassified`);
    console.log(`Force re-index: ${force}`);
    console.log('');

    const t = Date.now();
    const result = await indexAll({
      startYear,
      endYear,
      force,
      cpcSections,
      includeUnclassified: true,
      onProgress: log,
    });

    const elapsed = ((Date.now() - t) / 1000).toFixed(1);
    console.log(`\n=== Indexing Complete (${elapsed}s) ===`);
    console.log(`  Files processed: ${result.filesProcessed}`);
    console.log(`  Files skipped: ${result.filesSkipped}`);
    console.log(`  Files failed: ${result.filesFailed}`);
    console.log(`  Total patents: ${result.totalPatents.toLocaleString()}`);
    console.log(`  After CPC filter: ${result.filteredPatents.toLocaleString()}`);

    // Show overall status
    const status = await getIndexStatus();
    console.log(`\n  Overall index: ${status.filteredPatents.toLocaleString()} patents across ${status.indexedFiles} files`);
  } finally {
    await disconnectUsptoPrisma();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
