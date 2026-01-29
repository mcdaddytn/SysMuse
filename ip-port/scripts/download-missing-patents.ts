/**
 * Download Missing Patents
 *
 * Downloads patents from a gap analysis and adds them to the portfolio.
 * Uses the output from research-assignee-gaps.ts as input.
 *
 * Usage:
 *   npx tsx scripts/download-missing-patents.ts --input gaps-brocade-communications.json
 *   npx tsx scripts/download-missing-patents.ts --input gaps-brocade-communications.json --affiliate "Brocade"
 *   npx tsx scripts/download-missing-patents.ts --patent-ids 10003552,10015113,10015900 --affiliate "Brocade"
 *   npx tsx scripts/download-missing-patents.ts --input gaps-brocade-communications.json --dry-run
 *
 * Actions:
 *   1. Fetches full patent details from PatentsView
 *   2. Caches patent data to cache/api/patentsview/patent/
 *   3. Adds patents to streaming-candidates file
 *   4. Assigns affiliate and sector based on config
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createPatentsViewClient, Patent, PatentsViewClient } from '../clients/patentsview-client.js';

dotenv.config();

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const CACHE_DIR = path.join(process.cwd(), 'cache/api/patentsview/patent');

// Load sector mapper functions
import { getPrimarySector, getSuperSector } from '../src/api/utils/sector-mapper.js';

interface GapAnalysisResult {
  searchTerm: string;
  missingPatentIds: string[];
}

interface PortfolioAffiliate {
  displayName: string;
  patterns: string[];
}

interface PortfolioAffiliatesConfig {
  affiliates: Record<string, PortfolioAffiliate>;
}

interface StreamingCandidate {
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
  affiliate: string;
}

/**
 * Load portfolio affiliates config
 */
function loadAffiliatesConfig(): PortfolioAffiliatesConfig {
  const configPath = path.join(process.cwd(), 'config/portfolio-affiliates.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Normalize assignee to affiliate
 */
function normalizeAffiliate(assignee: string, config: PortfolioAffiliatesConfig): string {
  const assigneeLower = assignee.toLowerCase();

  for (const [key, affiliate] of Object.entries(config.affiliates)) {
    for (const pattern of affiliate.patterns) {
      if (assigneeLower.includes(pattern.toLowerCase())) {
        return affiliate.displayName;
      }
    }
  }

  return 'Unknown';
}

/**
 * Calculate remaining years from grant date
 */
function calculateRemainingYears(grantDate: string): number {
  const grant = new Date(grantDate);
  const expiry = new Date(grant);
  expiry.setFullYear(expiry.getFullYear() + 20);

  const now = new Date();
  const remainingMs = expiry.getTime() - now.getTime();
  const remainingYears = remainingMs / (1000 * 60 * 60 * 24 * 365.25);

  return Math.max(0, Math.round(remainingYears * 10) / 10);
}

/**
 * Load latest streaming candidates file
 */
function loadStreamingCandidates(): { filename: string; data: any } {
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
 * Cache patent data
 */
function cachePatent(patent: Patent): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const filepath = path.join(CACHE_DIR, `${patent.patent_id}.json`);
  fs.writeFileSync(filepath, JSON.stringify({ patents: [patent] }, null, 2));
}

/**
 * Convert PatentsView patent to streaming candidate
 */
function patentToCandidate(
  patent: Patent,
  config: PortfolioAffiliatesConfig,
  affiliateOverride?: string
): StreamingCandidate {
  const assignee = patent.assignees?.[0]?.assignee_organization || 'Unknown';
  const affiliate = affiliateOverride || normalizeAffiliate(assignee, config);

  // Handle both cpc and cpc_current field formats
  const cpcData = (patent as any).cpc_current || patent.cpc || [];
  const cpcCodes = cpcData.map((c: any) => c.cpc_subgroup_id || c.cpc_group_id || '').filter(Boolean);
  const primarySector = getPrimarySector(cpcCodes) || 'unknown';
  const superSector = getSuperSector(primarySector) || 'Unknown';

  return {
    patent_id: patent.patent_id,
    patent_title: patent.patent_title || '',
    patent_date: patent.patent_date || '',
    assignee,
    forward_citations: 0, // Will be enriched later
    remaining_years: calculateRemainingYears(patent.patent_date || ''),
    score: 0, // Will be calculated later
    cpc_codes: cpcCodes,
    primary_sector: primarySector,
    super_sector: superSector,
    affiliate
  };
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const inputIdx = args.indexOf('--input');
  const inputFile = inputIdx !== -1 ? args[inputIdx + 1] : null;

  const patentIdsIdx = args.indexOf('--patent-ids');
  const patentIdsArg = patentIdsIdx !== -1 ? args[patentIdsIdx + 1] : null;

  const affiliateIdx = args.indexOf('--affiliate');
  const affiliateOverride = affiliateIdx !== -1 ? args[affiliateIdx + 1] : undefined;

  const dryRun = args.includes('--dry-run');

  // Validate
  if (!inputFile && !patentIdsArg) {
    console.log(`
Download Missing Patents - Add patents from gap analysis to portfolio

Usage:
  npx tsx scripts/download-missing-patents.ts --input gaps-brocade-communications.json
  npx tsx scripts/download-missing-patents.ts --input gaps-brocade-communications.json --affiliate "Brocade Communications"
  npx tsx scripts/download-missing-patents.ts --patent-ids 10003552,10015113 --affiliate "Brocade Communications"

Options:
  --input <file>      Gap analysis JSON file from output/ directory
  --patent-ids <ids>  Comma-separated list of patent IDs
  --affiliate <name>  Override affiliate assignment (use display name from config)
  --dry-run           Preview without making changes
`);
    process.exit(1);
  }

  // Get patent IDs to download
  let patentIds: string[] = [];

  if (inputFile) {
    const inputPath = path.join(OUTPUT_DIR, inputFile);
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: Input file not found: ${inputPath}`);
      process.exit(1);
    }
    const gapData: GapAnalysisResult = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    patentIds = gapData.missingPatentIds;
    console.log(`Loaded ${patentIds.length} missing patent IDs from ${inputFile}`);
  } else if (patentIdsArg) {
    patentIds = patentIdsArg.split(',').map(id => id.trim());
    console.log(`Processing ${patentIds.length} patent IDs from command line`);
  }

  if (patentIds.length === 0) {
    console.log('No patent IDs to process');
    return;
  }

  // Create client
  let client: PatentsViewClient;
  try {
    client = createPatentsViewClient();
  } catch (err) {
    console.error('Error: PATENTSVIEW_API_KEY environment variable not set');
    process.exit(1);
  }

  // Load config and current portfolio
  const config = loadAffiliatesConfig();
  const { filename: candidatesFilename, data: candidatesData } = loadStreamingCandidates();
  const existingIds = new Set(candidatesData.candidates.map((c: any) => c.patent_id));

  // Filter to truly missing patents
  const toDownload = patentIds.filter(id => !existingIds.has(id));
  console.log(`\n${patentIds.length} patent IDs total`);
  console.log(`${patentIds.length - toDownload.length} already in portfolio`);
  console.log(`${toDownload.length} to download\n`);

  if (toDownload.length === 0) {
    console.log('All patents already in portfolio!');
    return;
  }

  if (dryRun) {
    console.log('DRY RUN - would download:');
    console.log(`  ${toDownload.slice(0, 20).join(', ')}${toDownload.length > 20 ? '...' : ''}`);
    return;
  }

  // Download patents individually (batch queries have issues with PatentsView API)
  console.log('Downloading patent details from PatentsView...');
  const downloaded: StreamingCandidate[] = [];
  let errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toDownload.length; i++) {
    const patentId = toDownload[i];

    try {
      // Use minimal fields that work with the API
      const patent = await client.getPatent(patentId, [
        'patent_id',
        'patent_title',
        'patent_date',
        'assignees',
        'cpc_current'
      ]);

      if (patent) {
        // Cache patent
        cachePatent(patent);

        // Convert to candidate
        const candidate = patentToCandidate(patent, config, affiliateOverride);
        downloaded.push(candidate);
      } else {
        errors++;
      }

      // Progress update every 10 patents
      if ((i + 1) % 10 === 0 || i === toDownload.length - 1) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = (i + 1) / elapsed;
        const eta = (toDownload.length - i - 1) / rate;
        process.stdout.write(`\r  Progress: ${i + 1}/${toDownload.length} | ${downloaded.length} downloaded | ${rate.toFixed(1)}/s | ETA: ${(eta / 60).toFixed(1)}m    `);
      }
    } catch (err: any) {
      errors++;
      if (err.message?.includes('429')) {
        console.log('\n  Rate limited - waiting 60s...');
        await new Promise(resolve => setTimeout(resolve, 60000));
        i--; // Retry
      }
    }

    // Rate limiting - 45 req/min = ~1.3s between requests
    await new Promise(resolve => setTimeout(resolve, 1400));
  }
  console.log(''); // New line after progress

  // Add to streaming candidates
  console.log(`\nAdding ${downloaded.length} patents to portfolio...`);

  candidatesData.candidates.push(...downloaded);
  candidatesData.metadata = candidatesData.metadata || {};
  candidatesData.metadata.lastUpdated = new Date().toISOString();
  candidatesData.metadata.addedFromGapAnalysis = candidatesData.metadata.addedFromGapAnalysis || [];
  candidatesData.metadata.addedFromGapAnalysis.push({
    date: new Date().toISOString(),
    source: inputFile || 'manual',
    count: downloaded.length,
    affiliate: affiliateOverride || 'auto'
  });

  // Save updated file
  const outputPath = path.join(OUTPUT_DIR, candidatesFilename);
  fs.writeFileSync(outputPath, JSON.stringify(candidatesData, null, 2));

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('DOWNLOAD COMPLETE');
  console.log('='.repeat(60));
  console.log(`Patents downloaded:      ${downloaded.length}`);
  console.log(`Patents cached:          ${downloaded.length}`);
  console.log(`Portfolio file updated:  ${candidatesFilename}`);
  console.log(`New portfolio size:      ${candidatesData.candidates.length.toLocaleString()}`);

  // Show affiliate breakdown
  const affiliateCounts: Record<string, number> = {};
  for (const p of downloaded) {
    affiliateCounts[p.affiliate] = (affiliateCounts[p.affiliate] || 0) + 1;
  }
  console.log('\nAffiliate breakdown:');
  for (const [affiliate, count] of Object.entries(affiliateCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${affiliate}: ${count}`);
  }

  // Show sector breakdown
  const sectorCounts: Record<string, number> = {};
  for (const p of downloaded) {
    sectorCounts[p.super_sector] = (sectorCounts[p.super_sector] || 0) + 1;
  }
  console.log('\nSuper-sector breakdown:');
  for (const [sector, count] of Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${sector}: ${count}`);
  }

  console.log('\nNext steps:');
  console.log('  1. Restart the API server to reload portfolio');
  console.log('  2. Run citation enrichment: npx tsx scripts/enrich-citations.ts');
  console.log('  3. Run scoring: POST /api/scores/reload');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
