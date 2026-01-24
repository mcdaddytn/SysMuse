/**
 * Test script for cache service
 * Fetches a patent from PatentsView API and caches the result
 */

import { createPatentsViewClient } from '../clients/patentsview-client.js';
import {
  isApiCached,
  getApiCache,
  setApiCache,
  getCacheStats
} from '../services/cache-service.js';

const TEST_PATENT_ID = '10000000';

async function main() {
  console.log('=== Cache Service Test ===\n');

  // Check if already cached
  const cached = await isApiCached('patentsview', 'patent', TEST_PATENT_ID);
  console.log(`Patent ${TEST_PATENT_ID} cached: ${cached}`);

  if (cached) {
    console.log('\nReading from cache...');
    const data = await getApiCache('patentsview', 'patent', TEST_PATENT_ID);
    console.log('Cached data:', JSON.stringify(data, null, 2).slice(0, 500) + '...');
  } else {
    console.log('\nFetching from API...');

    const client = createPatentsViewClient();
    const response = await client.getPatent(TEST_PATENT_ID, [
      'patent_id',
      'patent_title',
      'patent_abstract',
      'patent_date',
      'assignees.assignee_organization'
    ]);

    if (response) {
      console.log(`Patent title: ${response.patent_title}`);
      console.log(`Grant date: ${response.patent_date}`);

      // Cache the response
      console.log('\nCaching response...');
      await setApiCache({
        endpoint: 'patentsview',
        requestType: 'patent',
        requestKey: TEST_PATENT_ID,
        data: response,
        statusCode: 200
      });
      console.log('Cached successfully!');
    } else {
      console.log('Patent not found');
    }
  }

  // Show stats
  console.log('\n--- Cache Statistics ---');
  const stats = await getCacheStats();
  console.log(`API Cache: ${stats.apiCache.count} entries, ${(stats.apiCache.totalSize / 1024).toFixed(2)} KB`);
  console.log(`LLM Cache: ${stats.llmCache.count} entries`);

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
