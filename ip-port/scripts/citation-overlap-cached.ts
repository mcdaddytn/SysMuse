/**
 * Citation Overlap Analysis - Cached Version
 *
 * Uses cached API clients to avoid redundant API calls.
 * Cached responses are stored in cache/api/patentsview/
 *
 * Usage:
 *   npx tsx scripts/citation-overlap-cached.ts [--start N] [--limit N] [--dry-run]
 *
 * Options:
 *   --start N   Start from patent index N (default: 0)
 *   --limit N   Process only N patents (default: all)
 *   --dry-run   Check cache status without making API calls
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { createCachedPatentsViewClient } from '../clients/cached-clients.js';
import { CompetitorMatcher } from '../services/competitor-config.js';
import { getCacheStats, isApiCached } from '../services/cache-service.js';

dotenv.config();

const OUTPUT_DIR = './output';
const DATE_STAMP = new Date().toISOString().slice(0, 10);

// Load competitor config
const competitorMatcher = new CompetitorMatcher();

interface CitingPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  competitor_name?: string;
}

interface OverlapResult {
  patent_id: string;
  patent_title: string;
  assignee: string;
  patent_date: string;
  original_score: number;
  forward_citations: number;
  remaining_years: number;
  total_citing_patents: number;
  competitor_citations: number;
  competitor_cites: CitingPatent[];
  enhanced_score: number;
}

function parseArgs(): { start: number; limit: number | null; dryRun: boolean } {
  const args = process.argv.slice(2);
  let start = 0;
  let limit: number | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) {
      start = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { start, limit, dryRun };
}

async function loadPortfolio(): Promise<any[]> {
  // Try to load the most recent candidates file
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates-*.json file found in output/');
  }

  const filePath = `${OUTPUT_DIR}/${files[0]}`;
  console.log(`Loading portfolio from: ${filePath}`);

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.candidates || data;
}

async function checkCacheStatus(patents: any[]): Promise<{ cached: number; uncached: number }> {
  let cached = 0;
  let uncached = 0;

  for (const patent of patents) {
    const isCached = await isApiCached('patentsview', 'forward-citations', patent.patent_id);
    if (isCached) {
      cached++;
    } else {
      uncached++;
    }
  }

  return { cached, uncached };
}

async function main() {
  const { start, limit, dryRun } = parseArgs();

  console.log('\n' + '═'.repeat(65));
  console.log('     CITATION OVERLAP ANALYSIS - CACHED VERSION');
  console.log('═'.repeat(65));
  console.log(`\n${competitorMatcher.getSummary()}\n`);

  // Load portfolio
  const allPatents = await loadPortfolio();
  const endIndex = limit ? Math.min(start + limit, allPatents.length) : allPatents.length;
  const patents = allPatents.slice(start, endIndex);

  console.log(`Portfolio: ${allPatents.length.toLocaleString()} total patents`);
  console.log(`Processing: patents ${start} to ${endIndex} (${patents.length} patents)`);

  // Show cache stats
  const cacheStats = await getCacheStats();
  console.log(`\nCache status: ${cacheStats.apiCache.count} API entries, ${(cacheStats.apiCache.totalSize / 1024 / 1024).toFixed(2)} MB`);

  // Check cache status for this batch
  console.log('\nChecking cache status for this batch...');
  const status = await checkCacheStatus(patents);
  console.log(`  Cached: ${status.cached} patents`);
  console.log(`  Need API calls: ${status.uncached} patents`);

  if (dryRun) {
    console.log('\n[DRY RUN] Exiting without making API calls.');
    const estimatedTime = (status.uncached * 3) / 60; // ~3 seconds per uncached patent (2 API calls)
    console.log(`Estimated time for uncached patents: ${estimatedTime.toFixed(1)} minutes`);
    process.exit(0);
  }

  // Create cached client
  const client = createCachedPatentsViewClient();

  const results: OverlapResult[] = [];
  let processed = 0;
  let fromCache = 0;
  let fromApi = 0;
  let withCompetitorCites = 0;
  let totalCompetitorCites = 0;

  const startTime = Date.now();
  const RATE_LIMIT_MS = 3000; // 3 seconds between uncached patents (each makes ~2 API calls)
  let lastApiCall = 0;

  for (const patent of patents) {
    const wasCached = await isApiCached('patentsview', 'forward-citations', patent.patent_id);

    // Rate limit for uncached requests
    if (!wasCached) {
      const timeSinceLastCall = Date.now() - lastApiCall;
      if (timeSinceLastCall < RATE_LIMIT_MS) {
        await new Promise(r => setTimeout(r, RATE_LIMIT_MS - timeSinceLastCall));
      }
    }

    // Get citing patent details (will use cache if available)
    const citingData = await client.getCitingPatentDetails(patent.patent_id);

    if (wasCached) {
      fromCache++;
    } else {
      fromApi++;
      lastApiCall = Date.now();
    }

    // Filter for competitor citations
    const competitorCites: CitingPatent[] = [];
    for (const citingPatent of citingData.citing_patents) {
      const assignee = citingPatent.assignees?.[0]?.assignee_organization || '';
      const match = competitorMatcher.matchCompetitor(assignee);

      if (match) {
        competitorCites.push({
          patent_id: citingPatent.patent_id,
          patent_title: citingPatent.patent_title || '',
          patent_date: citingPatent.patent_date || '',
          assignee,
          competitor_name: match.company,
        });
      }
    }

    if (competitorCites.length > 0) {
      withCompetitorCites++;
      totalCompetitorCites += competitorCites.length;
    }

    // Calculate enhanced score
    const competitorBonus = competitorCites.length * 15;
    const enhancedScore = (patent.score || 0) + competitorBonus;

    results.push({
      patent_id: patent.patent_id,
      patent_title: patent.patent_title || '',
      assignee: patent.assignee || '',
      patent_date: patent.patent_date || '',
      original_score: patent.score || 0,
      forward_citations: patent.forward_citations || 0,
      remaining_years: patent.remaining_years || 0,
      total_citing_patents: citingData.total_hits,
      competitor_citations: competitorCites.length,
      competitor_cites: competitorCites,
      enhanced_score: enhancedScore,
    });

    processed++;

    // Progress update
    if (processed % 10 === 0 || processed === patents.length) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const remaining = (patents.length - processed) / rate;

      process.stdout.write(
        `\r  Progress: ${processed}/${patents.length} | ` +
        `Cache: ${fromCache} | API: ${fromApi} | ` +
        `Competitor cites: ${totalCompetitorCites} | ` +
        `ETA: ${(remaining / 60).toFixed(1)}m     `
      );
    }
  }

  console.log('\n');

  // Summary
  const elapsed = (Date.now() - startTime) / 1000 / 60;
  console.log('─'.repeat(65));
  console.log('SUMMARY');
  console.log('─'.repeat(65));
  console.log(`  Patents processed: ${processed}`);
  console.log(`  From cache: ${fromCache} (${(fromCache / processed * 100).toFixed(1)}%)`);
  console.log(`  From API: ${fromApi}`);
  console.log(`  Time: ${elapsed.toFixed(1)} minutes`);
  console.log(`  Patents with competitor citations: ${withCompetitorCites}`);
  console.log(`  Total competitor citations found: ${totalCompetitorCites}`);

  // Competitor breakdown
  const competitorCounts = new Map<string, number>();
  for (const result of results) {
    for (const cite of result.competitor_cites) {
      const name = cite.competitor_name || 'Unknown';
      competitorCounts.set(name, (competitorCounts.get(name) || 0) + 1);
    }
  }

  if (competitorCounts.size > 0) {
    console.log('\nCompetitor Breakdown:');
    const sorted = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 10)) {
      console.log(`  ${name}: ${count}`);
    }
  }

  // Sort by enhanced score
  results.sort((a, b) => b.enhanced_score - a.enhanced_score);

  // Save results
  const outputFile = `${OUTPUT_DIR}/citation-overlap-cached-${start}-${endIndex}-${DATE_STAMP}.json`;
  fs.writeFileSync(outputFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      range: { start, end: endIndex },
      totalAnalyzed: results.length,
      fromCache,
      fromApi,
      elapsedMinutes: elapsed,
    },
    results,
  }, null, 2));

  console.log(`\nResults saved to: ${outputFile}`);

  // Final cache stats
  const finalStats = await getCacheStats();
  console.log(`\nFinal cache: ${finalStats.apiCache.count} entries, ${(finalStats.apiCache.totalSize / 1024 / 1024).toFixed(2)} MB`);

  process.exit(0);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
