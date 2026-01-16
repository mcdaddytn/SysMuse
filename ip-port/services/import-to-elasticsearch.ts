/**
 * Import Existing JSON Data into ElasticSearch
 *
 * Reads the existing portfolio and analysis JSON files and indexes them
 * into ElasticSearch for text search.
 *
 * Usage:
 *   npx tsx services/import-to-elasticsearch.ts [options]
 *
 * Options:
 *   --portfolio     Import full Broadcom portfolio (with abstracts)
 *   --priority      Import priority analysis results
 *   --competitors   Import competitor portfolios
 *   --all           Import all available data
 *   --recreate      Delete and recreate index first
 */

import * as fs from 'fs';
import * as path from 'path';
import { createElasticsearchService, ElasticsearchService } from './elasticsearch-service.js';
import * as dotenv from 'dotenv';

dotenv.config();

const OUTPUT_DIR = './output';

interface ImportStats {
  source: string;
  total: number;
  indexed: number;
  skipped: number;
  errors: number;
}

// Normalize assignee names to identify competitors
const COMPETITOR_PATTERNS: Record<string, string[]> = {
  'Apple': ['APPLE INC', 'APPLE COMPUTER'],
  'Microsoft': ['MICROSOFT CORPORATION', 'MICROSOFT TECHNOLOGY'],
  'Google': ['GOOGLE LLC', 'GOOGLE INC', 'ALPHABET'],
  'Amazon': ['AMAZON TECHNOLOGIES', 'AMAZON.COM', 'AMAZON INC'],
  'Netflix': ['NETFLIX INC', 'NETFLIX, INC'],
  'Disney': ['DISNEY ENTERPRISES', 'WALT DISNEY', 'THE WALT DISNEY'],
  'Comcast': ['COMCAST CABLE', 'COMCAST CORPORATION'],
  'Roku': ['ROKU INC', 'ROKU, INC'],
  'Sony': ['SONY CORPORATION', 'SONY INTERACTIVE', 'SONY GROUP'],
  'Warner': ['WARNER BROS', 'WARNERMEDIA', 'TIME WARNER'],
  'Meta': ['META PLATFORMS', 'FACEBOOK', 'FACEBOOK INC'],
  'ByteDance': ['BYTEDANCE', 'TIKTOK'],
};

function normalizeAssignee(assignee: string): string | undefined {
  const upper = assignee.toUpperCase();
  for (const [normalized, patterns] of Object.entries(COMPETITOR_PATTERNS)) {
    if (patterns.some(p => upper.includes(p))) {
      return normalized;
    }
  }
  return undefined;
}

async function importPortfolio(
  es: ElasticsearchService,
  filename: string
): Promise<ImportStats> {
  const filepath = path.join(OUTPUT_DIR, filename);
  const stats: ImportStats = { source: filename, total: 0, indexed: 0, skipped: 0, errors: 0 };

  if (!fs.existsSync(filepath)) {
    console.log(`File not found: ${filepath}`);
    return stats;
  }

  console.log(`\nImporting portfolio from ${filename}...`);
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  const patents = data.patents || data;

  stats.total = patents.length;

  // Process in batches
  const batchSize = 500;
  for (let i = 0; i < patents.length; i += batchSize) {
    const batch = patents.slice(i, i + batchSize);

    const docs = batch
      .filter((p: any) => p.patent_id && p.patent_title)
      .map((p: any) => ({
        patent_id: p.patent_id,
        title: p.patent_title,
        abstract: p.patent_abstract || undefined,
        grant_date: p.patent_date || undefined,
        assignee: p.assignees?.[0]?.assignee_organization || undefined,
        assignee_normalized: p.assignees?.[0]?.assignee_organization
          ? normalizeAssignee(p.assignees[0].assignee_organization)
          : undefined,
        cpc_codes: p.cpc_current?.map((c: any) => c.cpc_group_id).filter(Boolean) || [],
        cpc_classes: p.cpc_current?.map((c: any) => c.cpc_class_id).filter(Boolean) || [],
        forward_citations: p.patent_num_times_cited_by_us_patents || 0,
        backward_citations: p.patent_num_us_patents_cited || 0,
        inventors: p.inventors?.map((inv: any) =>
          `${inv.inventor_name_first || ''} ${inv.inventor_name_last || ''}`.trim()
        ).filter(Boolean) || []
      }));

    if (docs.length > 0) {
      const result = await es.bulkIndex(docs);
      stats.indexed += result.indexed;
      stats.errors += result.errors;
    }

    stats.skipped = stats.total - stats.indexed - stats.errors;

    // Progress
    const progress = Math.min(100, Math.round((i + batch.length) / patents.length * 100));
    process.stdout.write(`\r  Progress: ${progress}% (${stats.indexed} indexed)`);
  }

  console.log(`\n  Completed: ${stats.indexed} indexed, ${stats.skipped} skipped, ${stats.errors} errors`);
  return stats;
}

async function importPriorityResults(
  es: ElasticsearchService,
  filename: string
): Promise<ImportStats> {
  const filepath = path.join(OUTPUT_DIR, filename);
  const stats: ImportStats = { source: filename, total: 0, indexed: 0, skipped: 0, errors: 0 };

  if (!fs.existsSync(filepath)) {
    console.log(`File not found: ${filepath}`);
    return stats;
  }

  console.log(`\nImporting priority results from ${filename}...`);
  const patents = JSON.parse(fs.readFileSync(filepath, 'utf-8'));

  stats.total = patents.length;

  const docs = patents.map((p: any) => ({
    patent_id: p.patent_id,
    title: p.title,
    grant_date: p.date || undefined,
    assignee: p.assignee || undefined,
    forward_citations: p.forward_citations || 0,
    competitor_citations: p.competitor_citations || 0,
    competitors_citing: p.competitors || [],
    enhanced_score: p.enhanced_score || 0,
    remaining_years: p.remaining_years || 0,
    tier: getTier(p.enhanced_score, p.competitor_citations, p.remaining_years)
  }));

  const result = await es.bulkIndex(docs);
  stats.indexed = result.indexed;
  stats.errors = result.errors;

  console.log(`  Completed: ${stats.indexed} indexed, ${stats.errors} errors`);
  return stats;
}

async function importCitationOverlap(
  es: ElasticsearchService,
  filename: string
): Promise<ImportStats> {
  const filepath = path.join(OUTPUT_DIR, filename);
  const stats: ImportStats = { source: filename, total: 0, indexed: 0, skipped: 0, errors: 0 };

  if (!fs.existsSync(filepath)) {
    console.log(`File not found: ${filepath}`);
    return stats;
  }

  console.log(`\nImporting citation overlap from ${filename}...`);
  const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  const results = data.results || data;

  stats.total = results.length;

  const docs = results.map((r: any) => ({
    patent_id: r.broadcom_patent_id,
    title: r.broadcom_title,
    grant_date: r.broadcom_date || undefined,
    assignee: r.broadcom_assignee || undefined,
    forward_citations: r.forward_citations || r.total_citing_patents || 0,
    competitor_citations: r.competitor_citations || 0,
    competitors_citing: extractCompetitors(r.competitor_cites || []),
    enhanced_score: r.enhanced_score || (r.original_score + (r.competitor_citations * 15)),
    remaining_years: r.remaining_years || 0,
    tier: getTier(r.enhanced_score, r.competitor_citations, r.remaining_years)
  }));

  const result = await es.bulkIndex(docs);
  stats.indexed = result.indexed;
  stats.errors = result.errors;

  console.log(`  Completed: ${stats.indexed} indexed, ${stats.errors} errors`);
  return stats;
}

function extractCompetitors(cites: any[]): string[] {
  const competitors = new Set<string>();
  for (const cite of cites) {
    const assignee = cite.assignee || '';
    const normalized = normalizeAssignee(assignee);
    if (normalized) {
      competitors.add(normalized);
    }
  }
  return Array.from(competitors);
}

function getTier(score: number, competitorCites: number, remainingYears: number): number | undefined {
  if (competitorCites >= 10) return 1;
  if (competitorCites > 0 && remainingYears >= 2) return 2;
  if (competitorCites > 0) return 3;
  return undefined;
}

async function importStreamingBatches(es: ElasticsearchService): Promise<ImportStats> {
  const streamingDir = path.join(OUTPUT_DIR, 'streaming-video');
  const stats: ImportStats = { source: 'streaming-video batches', total: 0, indexed: 0, skipped: 0, errors: 0 };

  if (!fs.existsSync(streamingDir)) {
    console.log(`Directory not found: ${streamingDir}`);
    return stats;
  }

  const batchFiles = fs.readdirSync(streamingDir)
    .filter(f => f.startsWith('patents-batch-') && f.endsWith('.json'))
    .sort();

  console.log(`\nImporting ${batchFiles.length} streaming batch files...`);

  for (const file of batchFiles) {
    const filepath = path.join(streamingDir, file);
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const patents = data.patents || data;

    stats.total += patents.length;

    const docs = patents
      .filter((p: any) => p.patent_id && p.patent_title)
      .map((p: any) => ({
        patent_id: p.patent_id,
        title: p.patent_title,
        abstract: p.patent_abstract || undefined,
        grant_date: p.patent_date || undefined,
        assignee: p.assignees?.[0]?.assignee_organization || undefined,
        cpc_codes: p.cpc_current?.map((c: any) => c.cpc_group_id).filter(Boolean) || [],
        cpc_classes: p.cpc_current?.map((c: any) => c.cpc_class_id).filter(Boolean) || [],
        forward_citations: p.patent_num_times_cited_by_us_patents || 0,
        backward_citations: p.patent_num_us_patents_cited || 0,
        inventors: p.inventors?.map((inv: any) =>
          `${inv.inventor_name_first || ''} ${inv.inventor_name_last || ''}`.trim()
        ).filter(Boolean) || []
      }));

    if (docs.length > 0) {
      const result = await es.bulkIndex(docs);
      stats.indexed += result.indexed;
      stats.errors += result.errors;
    }

    process.stdout.write(`\r  Processed: ${file} (${stats.indexed} total indexed)`);
  }

  stats.skipped = stats.total - stats.indexed - stats.errors;
  console.log(`\n  Completed: ${stats.indexed} indexed, ${stats.skipped} skipped, ${stats.errors} errors`);
  return stats;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const es = createElasticsearchService();

  // Check ES health
  const healthy = await es.healthCheck();
  if (!healthy) {
    console.error('ElasticSearch is not available. Start it with: docker compose up -d');
    process.exit(1);
  }

  // Recreate index if requested
  if (args.has('--recreate')) {
    await es.recreateIndex();
  } else {
    await es.createIndex();
  }

  const allStats: ImportStats[] = [];
  const importAll = args.has('--all') || args.size === 0;

  // Import priority results (has competitor info)
  if (importAll || args.has('--priority')) {
    // Try different file names
    const priorityFiles = [
      'priority-all-2026-01-15.json',
      'priority-tier1-2026-01-15.json',
    ];
    for (const file of priorityFiles) {
      if (fs.existsSync(path.join(OUTPUT_DIR, file))) {
        allStats.push(await importPriorityResults(es, file));
      }
    }
  }

  // Import citation overlap (has detailed competitor cites)
  if (importAll || args.has('--overlap')) {
    const overlapFiles = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.startsWith('citation-overlap-') && f.endsWith('.json'));
    for (const file of overlapFiles) {
      allStats.push(await importCitationOverlap(es, file));
    }
  }

  // Import full portfolio (has abstracts)
  if (importAll || args.has('--portfolio')) {
    const portfolioFile = 'broadcom-portfolio-2026-01-15.json';
    if (fs.existsSync(path.join(OUTPUT_DIR, portfolioFile))) {
      allStats.push(await importPortfolio(es, portfolioFile));
    }
  }

  // Import streaming video batches
  if (importAll || args.has('--streaming')) {
    allStats.push(await importStreamingBatches(es));
  }

  // Summary
  console.log('\n========================================');
  console.log('IMPORT SUMMARY');
  console.log('========================================');

  let totalIndexed = 0;
  for (const stat of allStats) {
    console.log(`${stat.source}: ${stat.indexed}/${stat.total} indexed`);
    totalIndexed += stat.indexed;
  }

  const finalStats = await es.getStats();
  console.log('----------------------------------------');
  console.log(`Total documents in index: ${finalStats.docCount}`);
  console.log(`Index size: ${(finalStats.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log('========================================');
}

main().catch(console.error);
