/**
 * Download Full Portfolio - Cached Version
 *
 * Downloads ALL Broadcom portfolio patents using cached paginated queries.
 * Results are stored in cache/api/patentsview/portfolio-query/
 *
 * Key features:
 * - Each page of results is cached to disk
 * - Resume support: continues from last cached page on error
 * - New machine: copy cache folder, run sync, instant portfolio access
 *
 * Usage:
 *   npx tsx scripts/download-full-portfolio.ts [--force-refresh]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createCachedPatentsViewClient, CachedPatentsViewClient } from '../clients/cached-clients.js';
import { getCacheStats, getCachePath } from '../services/cache-service.js';

dotenv.config();

// Load sector mappings from config
interface SectorMapping {
  name: string;
  cpc_patterns: string[];
}

interface SuperSector {
  displayName: string;
  sectors: string[];
}

let sectorMappings: Record<string, SectorMapping> | null = null;
let superSectorMappings: Record<string, SuperSector> | null = null;
let sectorToSuperSector: Map<string, string> | null = null;

function loadSectorConfig() {
  if (!sectorMappings) {
    const configPath = path.join(process.cwd(), 'config/sector-breakout-v2.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    sectorMappings = config.sectorMappings;
  }
  return sectorMappings!;
}

function loadSuperSectorConfig() {
  if (!superSectorMappings) {
    const configPath = path.join(process.cwd(), 'config/super-sectors.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    superSectorMappings = config.superSectors;

    // Build sector to super-sector lookup
    sectorToSuperSector = new Map();
    for (const [superSectorKey, data] of Object.entries(config.superSectors) as [string, SuperSector][]) {
      for (const sector of data.sectors) {
        sectorToSuperSector.set(sector, superSectorKey);
      }
    }
  }
  return { superSectorMappings: superSectorMappings!, sectorToSuperSector: sectorToSuperSector! };
}

function getPrimarySectorFromCpc(cpcCodes: string[]): string {
  if (!cpcCodes || cpcCodes.length === 0) return 'general';

  const mappings = loadSectorConfig();

  // Build sorted list of patterns (longest first for most specific match)
  const sortedPatterns: { sectorKey: string; pattern: string }[] = [];
  for (const [sectorKey, sectorData] of Object.entries(mappings)) {
    for (const pattern of sectorData.cpc_patterns) {
      sortedPatterns.push({ sectorKey, pattern });
    }
  }
  sortedPatterns.sort((a, b) => b.pattern.length - a.pattern.length);

  // Find first matching sector
  for (const cpc of cpcCodes) {
    // Normalize CPC code (remove slashes for comparison)
    const normalizedCpc = cpc.replace('/', '');
    for (const { sectorKey, pattern } of sortedPatterns) {
      const normalizedPattern = pattern.replace('/', '');
      if (normalizedCpc.startsWith(normalizedPattern)) {
        return sectorKey;
      }
    }
  }

  return 'general';
}

function getSuperSectorFromPrimary(primarySector: string): string {
  const { superSectorMappings, sectorToSuperSector } = loadSuperSectorConfig();

  const superSectorKey = sectorToSuperSector.get(primarySector) || 'COMPUTING';
  return superSectorMappings[superSectorKey]?.displayName || 'Computing & Data';
}

const OUTPUT_DIR = './output';
const DATE_STAMP = new Date().toISOString().slice(0, 10);
const QUERY_NAME = 'broadcom-portfolio';

// All Broadcom portfolio assignees from config
const PORTFOLIO_ASSIGNEES = [
  // Broadcom
  'Broadcom Inc.', 'Broadcom Corporation', 'Broadcom Corp.',
  // Avago
  'Avago Technologies International Sales Pte. Limited',
  'Avago Technologies General IP (Singapore) Pte. Ltd.',
  'Avago Technologies Limited', 'Avago Technologies U.S. Inc.',
  'Avago Technologies', 'Avago Technologies Fiber IP (Singapore) Pte. Ltd.',
  // LSI
  'LSI Corporation', 'LSI Logic Corporation', 'LSI Logic',
  // Brocade
  'Brocade Communications Systems, Inc.', 'Brocade Communications Systems', 'Brocade',
  // CA Technologies
  'CA, Inc.', 'CA Technologies', 'Computer Associates International, Inc.', 'Computer Associates',
  // Symantec/Blue Coat
  'Symantec Corporation', 'Symantec Operating Corporation', 'Blue Coat Systems, Inc.',
  // VMware family
  'VMware LLC', 'VMware, Inc.', 'VMware, LLC', 'VMware International Limited', 'VMware',
  'Nicira, Inc.', 'Nicira Inc.', 'Nicira',
  'Avi Networks', 'Avi Networks Inc.',
  'Lastline, Inc.', 'Lastline Inc.',
  'PIVOTAL SOFTWARE, INC.', 'Pivotal Software, Inc.', 'Pivotal Software',
  'Carbon Black, Inc.', 'Carbon Black Inc.', 'Carbon Black',
  'NYANSA', 'Nyansa', 'Nyansa Inc', 'Nyansa, Inc.',
];

interface PatentCandidate {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  cpc_codes: string[];
  primary_sector: string;
  super_sector: string;
}

function parseArgs(): { forceRefresh: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  let forceRefresh = false;
  let limit: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force-refresh') {
      forceRefresh = true;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    }
  }

  return { forceRefresh, limit };
}

function calculateRemainingYears(grantDate: string): number {
  const grant = new Date(grantDate);
  const now = new Date();
  const expirationDate = new Date(grant);
  expirationDate.setFullYear(expirationDate.getFullYear() + 20);

  const remainingMs = expirationDate.getTime() - now.getTime();
  const remainingYears = remainingMs / (1000 * 60 * 60 * 24 * 365.25);

  return Math.max(0, remainingYears);
}

function calculateScore(citations: number, grantDate: string): number {
  const remainingYears = calculateRemainingYears(grantDate);
  const yearsFactor = Math.min(remainingYears / 10, 1.5);
  return citations * yearsFactor;
}

async function main() {
  const { forceRefresh, limit } = parseArgs();

  console.log('\n' + '═'.repeat(65));
  console.log('     FULL PORTFOLIO DOWNLOAD (CACHED)');
  console.log('═'.repeat(65));
  console.log(`\nDate: ${DATE_STAMP}`);
  console.log(`Assignees: ${PORTFOLIO_ASSIGNEES.length} variants`);
  console.log(`Query name: ${QUERY_NAME}`);
  console.log(`Force refresh: ${forceRefresh}`);

  // Check for existing cache
  const cacheDir = getCachePath('api', 'patentsview', 'portfolio-query', QUERY_NAME);
  const manifestPath = `${cacheDir}/_manifest.json`;

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    console.log(`\nExisting cache: ${manifest.totalPatents.toLocaleString()} patents, ${manifest.pages} pages`);
    console.log(`  Complete: ${manifest.complete}`);
    console.log(`  Last updated: ${manifest.lastUpdated}`);
    if (manifest.complete && !forceRefresh) {
      console.log('\nCache is complete. Use --force-refresh to re-download.');
    }
  } else {
    console.log('\nNo existing cache found. Starting fresh download.');
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const client = createCachedPatentsViewClient();
  const startTime = Date.now();

  console.log('\nFetching portfolio (sorted by date, newest first)...\n');

  // Use the cached portfolio method
  const result = await client.getPortfolioPatents(
    QUERY_NAME,
    PORTFOLIO_ASSIGNEES,
    {
      rateLimitMs: 1400,
      forceRefresh,
      onProgress: (fetched, fromCache, latestDate) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = fetched / Math.max(elapsed, 1);
        const source = fromCache ? '[CACHE]' : '[API]';
        process.stdout.write(
          `\r  ${source} ${fetched.toLocaleString()} patents | ` +
          `${rate.toFixed(0)} p/s | ` +
          `Latest: ${latestDate || 'loading...'}     `
        );
      },
    }
  );

  // Apply limit if specified (for testing)
  let patents = result.patents;
  if (limit && patents.length > limit) {
    patents = patents.slice(0, limit);
  }

  // Deduplicate patents (API may return same patent multiple times for OR queries)
  const beforeDedup = patents.length;
  const seenIds = new Set<string>();
  patents = patents.filter(p => {
    if (seenIds.has(p.patent_id)) {
      return false;
    }
    seenIds.add(p.patent_id);
    return true;
  });
  const duplicatesRemoved = beforeDedup - patents.length;
  if (duplicatesRemoved > 0) {
    console.log(`  Deduplicated: removed ${duplicatesRemoved.toLocaleString()} duplicate entries`);
  }

  // Convert to candidates format with CPC and sector data
  const candidates: PatentCandidate[] = patents.map(patent => {
    const assignee = patent.assignees?.[0]?.assignee_organization || 'Unknown';
    const forwardCitations = (patent as any).patent_num_times_cited_by_us_patents || 0;
    const grantDate = patent.patent_date || '2000-01-01';
    const remainingYears = calculateRemainingYears(grantDate);

    // Extract CPC codes
    const cpcCurrent = (patent as any).cpc_current || [];
    const cpcCodes: string[] = cpcCurrent.map((cpc: any) => cpc.cpc_group_id).filter(Boolean);

    // Compute sectors from CPC codes
    const primarySector = getPrimarySectorFromCpc(cpcCodes);
    const superSector = getSuperSectorFromPrimary(primarySector);

    return {
      patent_id: patent.patent_id,
      patent_title: patent.patent_title || '',
      patent_date: grantDate,
      assignee,
      forward_citations: forwardCitations,
      remaining_years: Math.round(remainingYears * 10) / 10,
      score: calculateScore(forwardCitations, grantDate),
      cpc_codes: cpcCodes,
      primary_sector: primarySector,
      super_sector: superSector,
    };
  });

  // Sort by date (newest first)
  candidates.sort((a, b) =>
    new Date(b.patent_date).getTime() - new Date(a.patent_date).getTime()
  );

  // Summary
  const elapsed = (Date.now() - startTime) / 1000 / 60;
  console.log('\n\n' + '─'.repeat(65));
  console.log('DOWNLOAD COMPLETE');
  console.log('─'.repeat(65));
  console.log(`  Total patents: ${candidates.length.toLocaleString()}`);
  console.log(`  Time: ${elapsed.toFixed(1)} minutes`);
  console.log(`  Pages from cache: ${result.pagesFromCache}`);
  console.log(`  Pages from API: ${result.pagesFromApi}`);
  console.log(`  Fully cached: ${result.fromCache}`);

  // Date range
  const newestDate = candidates[0]?.patent_date || 'N/A';
  const oldestDate = candidates[candidates.length - 1]?.patent_date || 'N/A';
  console.log(`  Date range: ${oldestDate} to ${newestDate}`);

  // Expired vs active
  const active = candidates.filter(p => p.remaining_years > 0);
  const expired = candidates.filter(p => p.remaining_years <= 0);
  console.log(`  Active patents: ${active.length.toLocaleString()} (${(active.length / candidates.length * 100).toFixed(1)}%)`);
  console.log(`  Expired patents: ${expired.length.toLocaleString()}`);

  // Top assignees
  const assigneeCounts = new Map<string, number>();
  candidates.forEach(p => {
    const name = p.assignee.split(',')[0].trim();
    assigneeCounts.set(name, (assigneeCounts.get(name) || 0) + 1);
  });

  console.log('\n  Top Assignees:');
  [...assigneeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([name, count]) => {
      console.log(`    ${name}: ${count.toLocaleString()}`);
    });

  // Super-sector distribution
  const superSectorCounts = new Map<string, number>();
  candidates.forEach(p => {
    superSectorCounts.set(p.super_sector, (superSectorCounts.get(p.super_sector) || 0) + 1);
  });

  console.log('\n  Super-Sectors:');
  [...superSectorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      console.log(`    ${name}: ${count.toLocaleString()}`);
    });

  // Save candidates file for analysis scripts (streaming-candidates format)
  const streamingFile = `${OUTPUT_DIR}/streaming-candidates-${DATE_STAMP}.json`;
  fs.writeFileSync(streamingFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      source: 'cached-portfolio',
      queryName: QUERY_NAME,
      totalPatents: candidates.length,
      activePatents: active.length,
      expiredPatents: expired.length,
      dateRange: { oldest: oldestDate, newest: newestDate },
      cacheInfo: {
        pagesFromCache: result.pagesFromCache,
        pagesFromApi: result.pagesFromApi,
        fullyCached: result.fromCache,
      },
    },
    candidates,
  }, null, 2));
  console.log(`\nSaved to: ${streamingFile}`);

  // Cache stats
  const stats = await getCacheStats();
  console.log(`\nCache: ${stats.apiCache.count} entries, ${(stats.apiCache.totalSize / 1024 / 1024).toFixed(2)} MB`);

  console.log('\n' + '─'.repeat(65));
  console.log('CACHE LOCATION');
  console.log('─'.repeat(65));
  console.log(`  ${cacheDir}/`);
  console.log('  └── _manifest.json    (completion status)');
  console.log('  └── page-0001.json    (first 500 patents)');
  console.log('  └── page-0002.json    (etc.)');
  console.log('\nTo use on new machine:');
  console.log('  1. Copy cache/ folder to new machine');
  console.log('  2. Run: npm run cache:sync');
  console.log('  3. Run: npm run download:portfolio  (loads from cache instantly)');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
