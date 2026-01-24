/**
 * Test cached API clients
 */

import {
  createCachedPatentsViewClient,
} from '../clients/cached-clients.js';
import { getCacheStats, isApiCached } from '../services/cache-service.js';

async function main() {
  console.log('=== Cached Clients Test ===\n');

  const client = createCachedPatentsViewClient();

  // Test 1: Fetch a patent (should use existing cache from earlier test)
  console.log('Test 1: Fetching patent 10000000 (should be cached)...');
  const isCached1 = await isApiCached('patentsview', 'patent', '10000000');
  console.log(`  Is cached: ${isCached1}`);
  const patent1 = await client.getPatent('10000000');
  console.log(`  Title: ${patent1?.patent_title}`);

  // Test 2: Fetch same patent again to verify cache
  console.log('\nTest 2: Fetching patent 10000000 again (verifying cache)...');
  const patent1Again = await client.getPatent('10000000');
  console.log(`  Title: ${patent1Again?.patent_title}`);

  // Show final stats
  console.log('\n--- Cache Statistics ---');
  const stats = await getCacheStats();
  console.log(`API Cache: ${stats.apiCache.count} entries, ${(stats.apiCache.totalSize / 1024).toFixed(2)} KB`);
  console.log(`LLM Cache: ${stats.llmCache.count} entries`);

  // List cached files
  console.log('\n--- Cached Files ---');
  const fs = await import('fs');
  const apiDir = 'cache/api/patentsview/patent';
  if (fs.existsSync(apiDir)) {
    const files = fs.readdirSync(apiDir);
    files.forEach(f => console.log(`  ${f}`));
  }

  console.log('\nCache test complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
