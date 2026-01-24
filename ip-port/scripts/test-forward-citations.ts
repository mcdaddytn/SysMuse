/**
 * Test forward citations caching
 */

import * as dotenv from 'dotenv';
import { createCachedPatentsViewClient } from '../clients/cached-clients.js';
import { getCacheStats, isApiCached } from '../services/cache-service.js';

dotenv.config();

// Test patents (known to have citations)
const TEST_PATENTS = [
  '10000000',  // From earlier test
  '9747249',   // Nicira/VMware
  '9762619',   // Another VMware patent
];

async function main() {
  console.log('=== Forward Citations Cache Test ===\n');

  const client = createCachedPatentsViewClient();

  for (const patentId of TEST_PATENTS) {
    console.log(`\nPatent ${patentId}:`);

    // Check cache status
    const wasCached = await isApiCached('patentsview', 'forward-citations', patentId);
    console.log(`  Forward citations cached: ${wasCached}`);

    // Get forward citations
    console.log('  Fetching forward citations...');
    const startTime = Date.now();
    const result = await client.getForwardCitations(patentId);
    const elapsed = Date.now() - startTime;

    console.log(`  Total hits: ${result.total_hits}`);
    console.log(`  Citing patents: ${result.citing_patent_ids.length}`);
    console.log(`  Time: ${elapsed}ms ${wasCached ? '(from cache)' : '(from API)'}`);

    if (result.citing_patent_ids.length > 0) {
      console.log(`  First 3 citing IDs: ${result.citing_patent_ids.slice(0, 3).join(', ')}`);
    }
  }

  // Show cache stats
  console.log('\n--- Cache Statistics ---');
  const stats = await getCacheStats();
  console.log(`API Cache: ${stats.apiCache.count} entries, ${(stats.apiCache.totalSize / 1024).toFixed(2)} KB`);

  // Run again to show cache hits
  console.log('\n=== Second Run (all should be cached) ===');
  for (const patentId of TEST_PATENTS) {
    const startTime = Date.now();
    const result = await client.getForwardCitations(patentId);
    const elapsed = Date.now() - startTime;
    console.log(`Patent ${patentId}: ${result.total_hits} citations, ${elapsed}ms (cached)`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
