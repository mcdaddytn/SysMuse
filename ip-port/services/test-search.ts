/**
 * Quick test of ElasticSearch search functionality
 */

import { createElasticsearchService } from './elasticsearch-service.js';

async function test() {
  const es = createElasticsearchService();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ELASTICSEARCH SEARCH TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Test 1: Basic search
  console.log('=== Search: "video streaming codec" ===\n');
  const results = await es.search('video streaming codec', { size: 10 });
  console.log(`Found: ${results.total} results\n`);

  for (const hit of results.hits.slice(0, 5)) {
    console.log(`${hit.patent_id}: ${hit.title}`);
    console.log(`  Score: ${hit.score.toFixed(2)}`);
    if (hit.abstract) {
      console.log(`  ${hit.abstract.substring(0, 120)}...`);
    }
    console.log();
  }

  // Test 2: Adaptive bitrate
  console.log('\n=== Search: "adaptive bitrate" ===\n');
  const results2 = await es.search('adaptive bitrate', { size: 5 });
  console.log(`Found: ${results2.total} results\n`);
  for (const hit of results2.hits.slice(0, 3)) {
    console.log(`${hit.patent_id}: ${hit.title}`);
  }

  // Test 3: DRM / content protection
  console.log('\n=== Search: "content protection DRM encryption" ===\n');
  const results3 = await es.search('content protection DRM encryption', { size: 5 });
  console.log(`Found: ${results3.total} results\n`);
  for (const hit of results3.hits.slice(0, 3)) {
    console.log(`${hit.patent_id}: ${hit.title}`);
    if (hit.abstract) console.log(`  ${hit.abstract.substring(0, 100)}...`);
  }

  // Test 4: Similar patents
  console.log('\n=== Patents similar to 10200706 (Pipelined video decoder) ===\n');
  const similar = await es.findSimilar('10200706', { size: 5 });
  console.log(`Found ${similar.total} similar patents\n`);
  for (const hit of similar.hits) {
    console.log(`${hit.patent_id}: ${hit.title}`);
    console.log(`  Similarity: ${hit.score.toFixed(2)}`);
  }

  // Test 5: Significant terms
  console.log('\n=== Significant terms from Tier 1 patents ===\n');
  const terms = await es.extractSignificantTerms({ tier: 1 }, { size: 15 });
  if (terms.length > 0) {
    for (const t of terms) {
      console.log(`  ${t.term}: ${t.docCount} docs (score: ${t.score.toFixed(2)})`);
    }
  } else {
    console.log('  (No tier data in index - run with competitor data)');
  }

  // Test 6: CPC distribution
  console.log('\n=== CPC Class Distribution ===\n');
  const cpc = await es.getTermFrequencies({}, { field: 'cpc_classes', size: 10 });
  for (const t of cpc) {
    console.log(`  ${t.term}: ${t.count} patents`);
  }

  // Stats
  const stats = await es.getStats();
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Index Stats: ${stats.docCount.toLocaleString()} documents, ${(stats.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

test().catch(console.error);
