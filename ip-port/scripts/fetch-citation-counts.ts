/**
 * Fetch Citation Counts
 *
 * Fetches forward citation counts from PatentsView for patents missing this data.
 * Updates the streaming-candidates file with citation counts.
 *
 * Usage:
 *   npx tsx scripts/fetch-citation-counts.ts --affiliate "Brocade Communications"
 *   npx tsx scripts/fetch-citation-counts.ts --missing-only --limit 500
 *   npx tsx scripts/fetch-citation-counts.ts --patent-ids 10003552,10015113
 *   npx tsx scripts/fetch-citation-counts.ts --dry-run
 *
 * What it fetches:
 *   - patent_num_times_cited_by_us_patents (forward citation count)
 *   - Updates forward_citations field in portfolio
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createPatentsViewClient, PatentsViewClient } from '../clients/patentsview-client.js';

dotenv.config();

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const RATE_LIMIT_MS = 1400; // ~43 requests per minute

interface Patent {
  patent_id: string;
  forward_citations: number;
  [key: string]: any;
}

/**
 * Load portfolio
 */
function loadPortfolio(): { filename: string; data: any } {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found');
  }

  const filename = files[0];
  const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, filename), 'utf-8'));
  return { filename, data };
}

/**
 * Fetch citation count for a single patent
 */
async function fetchCitationCount(
  client: PatentsViewClient,
  patentId: string
): Promise<number | null> {
  try {
    const response = await client.searchPatents({
      query: { patent_id: patentId },
      fields: ['patent_id', 'patent_num_times_cited_by_us_patents'],
      options: { size: 1 }
    });

    if (response.patents.length > 0) {
      return response.patents[0].patent_num_times_cited_by_us_patents || 0;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const affiliateIdx = args.indexOf('--affiliate');
  const affiliateFilter = affiliateIdx !== -1 ? args[affiliateIdx + 1] : null;

  const patentIdsIdx = args.indexOf('--patent-ids');
  const patentIdsArg = patentIdsIdx !== -1 ? args[patentIdsIdx + 1] : null;

  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : null;

  const missingOnly = args.includes('--missing-only');
  const dryRun = args.includes('--dry-run');

  // Validate
  if (!affiliateFilter && !patentIdsArg && !missingOnly) {
    console.log(`
Fetch Citation Counts - Update forward citation counts from PatentsView

Usage:
  npx tsx scripts/fetch-citation-counts.ts --affiliate "Brocade Communications"
  npx tsx scripts/fetch-citation-counts.ts --missing-only --limit 500
  npx tsx scripts/fetch-citation-counts.ts --patent-ids 10003552,10015113

Options:
  --affiliate <name>    Filter to specific affiliate
  --patent-ids <ids>    Comma-separated list of patent IDs
  --missing-only        Only fetch for patents with forward_citations = 0
  --limit <n>           Max patents to process
  --dry-run             Preview without making changes
`);
    process.exit(1);
  }

  // Create client
  let client: PatentsViewClient;
  try {
    client = createPatentsViewClient();
  } catch (err) {
    console.error('Error: PATENTSVIEW_API_KEY environment variable not set');
    process.exit(1);
  }

  // Load portfolio
  const { filename, data } = loadPortfolio();
  const patents: Patent[] = data.candidates;

  console.log(`Portfolio: ${patents.length.toLocaleString()} patents`);
  console.log(`File: ${filename}`);

  // Determine which patents to process
  let toProcess: Patent[] = [];

  if (patentIdsArg) {
    const ids = new Set(patentIdsArg.split(',').map(id => id.trim()));
    toProcess = patents.filter(p => ids.has(p.patent_id));
    console.log(`\nFiltered to ${toProcess.length} specified patent IDs`);
  } else {
    toProcess = [...patents];

    if (affiliateFilter) {
      toProcess = toProcess.filter(p =>
        p.affiliate?.toLowerCase() === affiliateFilter.toLowerCase()
      );
      console.log(`\nFiltered to affiliate "${affiliateFilter}": ${toProcess.length} patents`);
    }

    if (missingOnly) {
      toProcess = toProcess.filter(p => !p.forward_citations || p.forward_citations === 0);
      console.log(`Filtered to missing citations: ${toProcess.length} patents`);
    }
  }

  if (limit && toProcess.length > limit) {
    toProcess = toProcess.slice(0, limit);
    console.log(`Limited to: ${toProcess.length} patents`);
  }

  if (toProcess.length === 0) {
    console.log('\nNo patents to process');
    return;
  }

  // Estimate time
  const estimatedMinutes = (toProcess.length * RATE_LIMIT_MS / 1000 / 60).toFixed(1);
  console.log(`\nEstimated time: ${estimatedMinutes} minutes`);

  if (dryRun) {
    console.log('\nDRY RUN - would process:');
    for (const p of toProcess.slice(0, 10)) {
      console.log(`  ${p.patent_id} | current: ${p.forward_citations || 0} | ${p.affiliate || 'Unknown'}`);
    }
    if (toProcess.length > 10) {
      console.log(`  ... and ${toProcess.length - 10} more`);
    }
    return;
  }

  // Process patents
  console.log('\nFetching citation counts...');
  const startTime = Date.now();
  let updated = 0;
  let errors = 0;
  let unchanged = 0;

  // Create a map for quick lookup
  const patentMap = new Map(patents.map(p => [p.patent_id, p]));

  for (let i = 0; i < toProcess.length; i++) {
    const patent = toProcess[i];
    const citationCount = await fetchCitationCount(client, patent.patent_id);

    if (citationCount !== null) {
      const existing = patentMap.get(patent.patent_id);
      if (existing) {
        if (existing.forward_citations !== citationCount) {
          existing.forward_citations = citationCount;
          updated++;
        } else {
          unchanged++;
        }
      }
    } else {
      errors++;
    }

    // Progress
    if ((i + 1) % 10 === 0 || i === toProcess.length - 1) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = (i + 1) / elapsed;
      const eta = (toProcess.length - i - 1) / rate;
      process.stdout.write(`\r  Progress: ${i + 1}/${toProcess.length} | updated: ${updated} | ${rate.toFixed(1)}/s | ETA: ${(eta / 60).toFixed(1)}m    `);
    }

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
  }
  console.log('');

  // Save updated portfolio
  if (updated > 0) {
    data.candidates = patents;
    data.metadata = data.metadata || {};
    data.metadata.lastCitationUpdate = new Date().toISOString();
    data.metadata.citationUpdateCount = (data.metadata.citationUpdateCount || 0) + updated;

    const outputPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\nSaved to: ${filename}`);
  }

  // Summary
  const elapsed = (Date.now() - startTime) / 1000 / 60;
  console.log('\n' + '='.repeat(60));
  console.log('COMPLETE');
  console.log('='.repeat(60));
  console.log(`Time:        ${elapsed.toFixed(1)} minutes`);
  console.log(`Processed:   ${toProcess.length}`);
  console.log(`Updated:     ${updated}`);
  console.log(`Unchanged:   ${unchanged}`);
  console.log(`Errors:      ${errors}`);

  if (updated > 0) {
    console.log('\nNext steps:');
    console.log('  1. Restart API server to reload portfolio');
    console.log('  2. Re-run scoring: POST /api/scores/reload');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
