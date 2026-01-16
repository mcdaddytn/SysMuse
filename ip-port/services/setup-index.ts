/**
 * Setup ElasticSearch index with proper mapping
 */

import { createElasticsearchService } from './elasticsearch-service.js';

async function main() {
  const es = createElasticsearchService();

  console.log('Recreating index with proper mapping...');
  await es.recreateIndex();
  console.log('Done!');
}

main().catch(console.error);
