/**
 * Check Enrichment Status
 *
 * Analyzes the enrichment status of patents in the portfolio.
 * Shows citation data, LLM analysis, and other enrichment coverage.
 *
 * Usage:
 *   npx tsx scripts/check-enrichment-status.ts --affiliate "Brocade Communications"
 *   npx tsx scripts/check-enrichment-status.ts --super-sector "SDN & Network Infrastructure"
 *   npx tsx scripts/check-enrichment-status.ts --sector "network-switching"
 *   npx tsx scripts/check-enrichment-status.ts --all
 *   npx tsx scripts/check-enrichment-status.ts --affiliate "Brocade Communications" --output status.json
 *
 * Outputs:
 *   - Total patent count matching filter
 *   - Citation enrichment coverage
 *   - LLM analysis coverage
 *   - Breakdown by sector/affiliate
 *   - List of patent IDs needing enrichment
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const LLM_CACHE_DIR = path.join(process.cwd(), 'cache/llm-scores');
const CITATION_CACHE_DIR = path.join(process.cwd(), 'cache/citation-classification');

interface Patent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  affiliate: string;
  primary_sector: string;
  super_sector: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  competitor_citations?: number;
  has_citation_data?: boolean;
  has_llm_data?: boolean;
  [key: string]: any;
}

interface EnrichmentStatus {
  filter: {
    type: 'affiliate' | 'super_sector' | 'sector' | 'all';
    value: string;
  };
  timestamp: string;
  summary: {
    totalPatents: number;
    withCitationData: number;
    withLlmData: number;
    withLlmCache: number;
    needsCitations: number;
    needsLlm: number;
    avgForwardCitations: number;
    avgRemainingYears: number;
    activePatents: number;
    expiredPatents: number;
  };
  bySuperSector: Array<{
    name: string;
    count: number;
    withLlm: number;
    withCitations: number;
  }>;
  byAffiliate: Array<{
    name: string;
    count: number;
    withLlm: number;
    withCitations: number;
  }>;
  patentIdsNeedingLlm: string[];
  patentIdsNeedingCitations: string[];
  topPriorityForLlm: Array<{
    patent_id: string;
    title: string;
    score: number;
    forward_citations: number;
    remaining_years: number;
  }>;
}

/**
 * Load portfolio from latest streaming candidates file
 */
function loadPortfolio(): Patent[] {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found in output/');
  }

  console.log(`Loading portfolio from: ${files[0]}`);
  const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, files[0]), 'utf-8'));
  return data.candidates || [];
}

/**
 * Load LLM cache patent IDs
 */
function loadLlmCacheIds(): Set<string> {
  if (!fs.existsSync(LLM_CACHE_DIR)) return new Set();

  return new Set(
    fs.readdirSync(LLM_CACHE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  );
}

/**
 * Load citation classification data
 */
function loadCitationData(): Map<string, any> {
  const map = new Map<string, any>();

  // Check for summary file in output
  const summaryFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('citation-classification-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (summaryFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, summaryFiles[0]), 'utf-8'));
    for (const result of data.results || []) {
      map.set(result.patent_id, result);
    }
  }

  return map;
}

/**
 * Filter patents based on criteria
 */
function filterPatents(
  patents: Patent[],
  filterType: 'affiliate' | 'super_sector' | 'sector' | 'all',
  filterValue: string
): Patent[] {
  if (filterType === 'all') return patents;

  return patents.filter(p => {
    switch (filterType) {
      case 'affiliate':
        return p.affiliate?.toLowerCase() === filterValue.toLowerCase();
      case 'super_sector':
        return p.super_sector?.toLowerCase() === filterValue.toLowerCase();
      case 'sector':
        return p.primary_sector?.toLowerCase() === filterValue.toLowerCase();
      default:
        return true;
    }
  });
}

/**
 * Analyze enrichment status
 */
function analyzeEnrichment(
  patents: Patent[],
  llmCacheIds: Set<string>,
  citationData: Map<string, any>,
  filterType: 'affiliate' | 'super_sector' | 'sector' | 'all',
  filterValue: string
): EnrichmentStatus {
  // Count enrichment coverage
  let withCitationData = 0;
  let withLlmData = 0;
  let withLlmCache = 0;
  let totalFwdCitations = 0;
  let totalYears = 0;
  let activePatents = 0;

  const needsLlm: string[] = [];
  const needsCitations: string[] = [];

  const sectorCounts: Record<string, { count: number; withLlm: number; withCitations: number }> = {};
  const affiliateCounts: Record<string, { count: number; withLlm: number; withCitations: number }> = {};

  for (const p of patents) {
    // Citation status
    const hasCitations = p.has_citation_data ||
                         (p.competitor_citations !== undefined && p.competitor_citations > 0) ||
                         citationData.has(p.patent_id);
    if (hasCitations) {
      withCitationData++;
    } else {
      needsCitations.push(p.patent_id);
    }

    // LLM status
    const hasLlm = p.has_llm_data || llmCacheIds.has(p.patent_id);
    if (p.has_llm_data) withLlmData++;
    if (llmCacheIds.has(p.patent_id)) withLlmCache++;
    if (!hasLlm) {
      needsLlm.push(p.patent_id);
    }

    // Aggregates
    totalFwdCitations += p.forward_citations || 0;
    totalYears += p.remaining_years || 0;
    if (p.remaining_years > 0) activePatents++;

    // By super-sector
    const ss = p.super_sector || 'Unknown';
    if (!sectorCounts[ss]) sectorCounts[ss] = { count: 0, withLlm: 0, withCitations: 0 };
    sectorCounts[ss].count++;
    if (hasLlm) sectorCounts[ss].withLlm++;
    if (hasCitations) sectorCounts[ss].withCitations++;

    // By affiliate
    const aff = p.affiliate || 'Unknown';
    if (!affiliateCounts[aff]) affiliateCounts[aff] = { count: 0, withLlm: 0, withCitations: 0 };
    affiliateCounts[aff].count++;
    if (hasLlm) affiliateCounts[aff].withLlm++;
    if (hasCitations) affiliateCounts[aff].withCitations++;
  }

  // Sort patents needing LLM by score (priority)
  const patentsNeedingLlm = patents
    .filter(p => !p.has_llm_data && !llmCacheIds.has(p.patent_id))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

  const topPriority = patentsNeedingLlm.slice(0, 20).map(p => ({
    patent_id: p.patent_id,
    title: p.patent_title?.substring(0, 60) || '',
    score: p.score || 0,
    forward_citations: p.forward_citations || 0,
    remaining_years: p.remaining_years || 0
  }));

  return {
    filter: { type: filterType, value: filterValue },
    timestamp: new Date().toISOString(),
    summary: {
      totalPatents: patents.length,
      withCitationData,
      withLlmData,
      withLlmCache,
      needsCitations: needsCitations.length,
      needsLlm: needsLlm.length,
      avgForwardCitations: patents.length > 0 ? Math.round(totalFwdCitations / patents.length * 10) / 10 : 0,
      avgRemainingYears: patents.length > 0 ? Math.round(totalYears / patents.length * 10) / 10 : 0,
      activePatents,
      expiredPatents: patents.length - activePatents
    },
    bySuperSector: Object.entries(sectorCounts)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.count - a.count),
    byAffiliate: Object.entries(affiliateCounts)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.count - a.count),
    patentIdsNeedingLlm: needsLlm,
    patentIdsNeedingCitations: needsCitations,
    topPriorityForLlm: topPriority
  };
}

/**
 * Print results to console
 */
function printResults(status: EnrichmentStatus): void {
  const { summary, filter } = status;

  console.log('\n' + '='.repeat(70));
  console.log(`ENRICHMENT STATUS: ${filter.type === 'all' ? 'ALL PATENTS' : `${filter.type} = "${filter.value}"`}`);
  console.log('='.repeat(70));

  console.log('\nSummary:');
  console.log(`  Total patents:        ${summary.totalPatents.toLocaleString()}`);
  console.log(`  Active (>0 years):    ${summary.activePatents.toLocaleString()}`);
  console.log(`  Expired:              ${summary.expiredPatents.toLocaleString()}`);
  console.log(`  Avg fwd citations:    ${summary.avgForwardCitations}`);
  console.log(`  Avg years remaining:  ${summary.avgRemainingYears}`);

  console.log('\nEnrichment Coverage:');
  const citPct = summary.totalPatents > 0 ? (summary.withCitationData / summary.totalPatents * 100).toFixed(1) : 0;
  const llmPct = summary.totalPatents > 0 ? (summary.withLlmCache / summary.totalPatents * 100).toFixed(1) : 0;
  console.log(`  Citation data:        ${summary.withCitationData.toLocaleString()} / ${summary.totalPatents.toLocaleString()} (${citPct}%)`);
  console.log(`  LLM analysis:         ${summary.withLlmCache.toLocaleString()} / ${summary.totalPatents.toLocaleString()} (${llmPct}%)`);
  console.log(`  Needs citations:      ${summary.needsCitations.toLocaleString()}`);
  console.log(`  Needs LLM:            ${summary.needsLlm.toLocaleString()}`);

  if (status.bySuperSector.length > 1 || status.filter.type !== 'super_sector') {
    console.log('\nBy Super-Sector:');
    for (const ss of status.bySuperSector.slice(0, 10)) {
      const llmPct = ss.count > 0 ? Math.round(ss.withLlm / ss.count * 100) : 0;
      console.log(`  ${ss.name.padEnd(25)} ${ss.count.toString().padStart(5)} patents | LLM: ${llmPct}%`);
    }
  }

  if (status.byAffiliate.length > 1 || status.filter.type !== 'affiliate') {
    console.log('\nBy Affiliate:');
    for (const aff of status.byAffiliate.slice(0, 10)) {
      const llmPct = aff.count > 0 ? Math.round(aff.withLlm / aff.count * 100) : 0;
      console.log(`  ${aff.name.padEnd(25)} ${aff.count.toString().padStart(5)} patents | LLM: ${llmPct}%`);
    }
  }

  if (status.topPriorityForLlm.length > 0) {
    console.log('\nTop Priority for LLM Analysis (by score):');
    for (const p of status.topPriorityForLlm.slice(0, 10)) {
      console.log(`  ${p.patent_id} | score=${p.score.toFixed(1).padStart(6)} | cites=${p.forward_citations.toString().padStart(3)} | ${p.title}`);
    }
  }

  console.log('\nNext Steps:');
  if (summary.needsLlm > 0) {
    console.log(`  LLM enrichment: npx tsx scripts/run-llm-top-patents.ts --${status.filter.type === 'affiliate' ? 'affiliate' : status.filter.type === 'super_sector' ? 'super-sector' : 'sector'} "${status.filter.value}" --count ${Math.min(200, summary.needsLlm)}`);
  }
  if (summary.needsCitations > 0) {
    console.log(`  Citation enrichment: npx tsx scripts/enrich-citations.ts (will process all missing)`);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const affiliateIdx = args.indexOf('--affiliate');
  const affiliate = affiliateIdx !== -1 ? args[affiliateIdx + 1] : null;

  const superSectorIdx = args.indexOf('--super-sector');
  const superSector = superSectorIdx !== -1 ? args[superSectorIdx + 1] : null;

  const sectorIdx = args.indexOf('--sector');
  const sector = sectorIdx !== -1 ? args[sectorIdx + 1] : null;

  const allFlag = args.includes('--all');

  const outputIdx = args.indexOf('--output');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

  // Determine filter
  let filterType: 'affiliate' | 'super_sector' | 'sector' | 'all';
  let filterValue: string;

  if (affiliate) {
    filterType = 'affiliate';
    filterValue = affiliate;
  } else if (superSector) {
    filterType = 'super_sector';
    filterValue = superSector;
  } else if (sector) {
    filterType = 'sector';
    filterValue = sector;
  } else if (allFlag) {
    filterType = 'all';
    filterValue = 'all';
  } else {
    console.log(`
Check Enrichment Status - Analyze patent enrichment coverage

Usage:
  npx tsx scripts/check-enrichment-status.ts --affiliate "Brocade Communications"
  npx tsx scripts/check-enrichment-status.ts --super-sector "SDN & Network Infrastructure"
  npx tsx scripts/check-enrichment-status.ts --sector "network-switching"
  npx tsx scripts/check-enrichment-status.ts --all

Options:
  --affiliate <name>      Filter by affiliate (e.g., "Brocade Communications")
  --super-sector <name>   Filter by super-sector (e.g., "SDN & Network Infrastructure")
  --sector <name>         Filter by primary sector (e.g., "network-switching")
  --all                   Show status for entire portfolio
  --output <file>         Save results to JSON file in output/
`);
    process.exit(1);
  }

  // Load data
  const allPatents = loadPortfolio();
  const llmCacheIds = loadLlmCacheIds();
  const citationData = loadCitationData();

  console.log(`Portfolio: ${allPatents.length.toLocaleString()} patents`);
  console.log(`LLM cache: ${llmCacheIds.size.toLocaleString()} patents`);
  console.log(`Citation data: ${citationData.size.toLocaleString()} patents`);

  // Filter and analyze
  const filtered = filterPatents(allPatents, filterType, filterValue);

  if (filtered.length === 0) {
    console.log(`\nNo patents found matching ${filterType} = "${filterValue}"`);
    console.log('\nAvailable values:');

    if (filterType === 'affiliate') {
      const affiliates = [...new Set(allPatents.map(p => p.affiliate))].sort();
      affiliates.slice(0, 15).forEach(a => console.log(`  - ${a}`));
    } else if (filterType === 'super_sector') {
      const sectors = [...new Set(allPatents.map(p => p.super_sector))].sort();
      sectors.forEach(s => console.log(`  - ${s}`));
    }
    return;
  }

  const status = analyzeEnrichment(filtered, llmCacheIds, citationData, filterType, filterValue);

  // Output
  printResults(status);

  if (outputFile) {
    const outputPath = path.join(OUTPUT_DIR, outputFile);
    fs.writeFileSync(outputPath, JSON.stringify(status, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
