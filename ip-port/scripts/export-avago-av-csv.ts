/**
 * Export Avago A/V Citation Overlap Results to CSV
 *
 * Merges all batch results and exports to a single CSV for analysis.
 *
 * Usage: npx tsx scripts/export-avago-av-csv.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface CitationResult {
  avago_patent_id: string;
  avago_title: string;
  avago_date: string;
  cpc_codes: string[];
  forward_citations: number;
  total_citing_patents: number;
  competitor_citations: number;
  competitor_cites: Array<{
    patent_id: string;
    patent_title: string;
    patent_date: string;
    assignee: string;
    competitor_name: string;
    competitor_category: string;
  }>;
  competitors_citing: string[];
}

interface BatchResult {
  generated_at: string;
  range: { start: number; end: number };
  patents_analyzed: number;
  patents_with_competitor_citations: number;
  total_competitor_citations: number;
  competitor_breakdown: Record<string, number>;
  results: CitationResult[];
}

function loadAllBatches(): CitationResult[] {
  const outputDir = './output/avago-av';
  const batchFiles = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('avago-av-citation-overlap-') && f.endsWith('.json'))
    .sort();

  console.log(`Found ${batchFiles.length} batch files`);

  const allResults: CitationResult[] = [];
  const seenPatents = new Set<string>();

  for (const file of batchFiles) {
    const data: BatchResult = JSON.parse(
      fs.readFileSync(path.join(outputDir, file), 'utf-8')
    );

    for (const result of data.results) {
      if (result.competitor_citations > 0 && !seenPatents.has(result.avago_patent_id)) {
        allResults.push(result);
        seenPatents.add(result.avago_patent_id);
      }
    }
  }

  return allResults;
}

function escapeCSV(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function calculateYearsRemaining(grantDate: string): number {
  const grant = new Date(grantDate);
  const now = new Date();
  const yearsElapsed = (now.getTime() - grant.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, 20 - yearsElapsed);
}

function exportToCSV(): void {
  const results = loadAllBatches();

  // Sort by competitor citations descending
  results.sort((a, b) => b.competitor_citations - a.competitor_citations);

  console.log(`\nTotal patents with competitor citations: ${results.length}`);

  // Calculate summary stats
  const totalCitations = results.reduce((sum, r) => sum + r.competitor_citations, 0);
  const competitorCounts: Record<string, number> = {};

  for (const result of results) {
    for (const cite of result.competitor_cites) {
      competitorCounts[cite.competitor_name] = (competitorCounts[cite.competitor_name] || 0) + 1;
    }
  }

  console.log(`Total competitor citations: ${totalCitations}`);
  console.log('\nTop Competitors:');
  Object.entries(competitorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([name, count]) => console.log(`  ${name}: ${count}`));

  // CSV columns
  const columns = [
    'rank',
    'patent_id',
    'title',
    'grant_date',
    'years_remaining',
    'forward_citations',
    'competitor_citations',
    'competitors_citing',
    'top_competitor',
    'top_competitor_count',
    'cpc_codes',
    'discovery_strategy'
  ];

  const rows: string[] = [];
  rows.push(columns.join(','));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const yearsRemaining = calculateYearsRemaining(r.avago_date);

    // Calculate top competitor for this patent
    const patentCompetitorCounts: Record<string, number> = {};
    for (const cite of r.competitor_cites) {
      patentCompetitorCounts[cite.competitor_name] = (patentCompetitorCounts[cite.competitor_name] || 0) + 1;
    }
    const topCompetitor = Object.entries(patentCompetitorCounts)
      .sort((a, b) => b[1] - a[1])[0];

    const row = [
      (i + 1).toString(),
      r.avago_patent_id,
      escapeCSV(r.avago_title),
      r.avago_date,
      yearsRemaining.toFixed(1),
      r.forward_citations.toString(),
      r.competitor_citations.toString(),
      escapeCSV(r.competitors_citing.join('; ')),
      topCompetitor?.[0] || '',
      topCompetitor?.[1]?.toString() || '',
      escapeCSV(r.cpc_codes.slice(0, 5).join('; ')),
      'term-extraction-avago-av'
    ];

    rows.push(row.join(','));
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const outputPath = `./output/avago-av/avago-av-priority-${timestamp}.csv`;
  fs.writeFileSync(outputPath, rows.join('\n'));

  console.log(`\nExported to: ${outputPath}`);

  // Also create a summary JSON
  const summary = {
    generated_at: new Date().toISOString(),
    total_patents_analyzed: 923,
    patents_with_citations: results.length,
    total_competitor_citations: totalCitations,
    hit_rate: `${(results.length / 923 * 100).toFixed(1)}%`,
    competitor_breakdown: Object.entries(competitorCounts)
      .sort((a, b) => b[1] - a[1])
      .reduce((obj, [k, v]) => ({ ...obj, [k]: v }), {}),
    top_patents: results.slice(0, 25).map(r => ({
      patent_id: r.avago_patent_id,
      title: r.avago_title,
      competitor_citations: r.competitor_citations,
      competitors: r.competitors_citing,
      cpc_codes: r.cpc_codes.slice(0, 3)
    }))
  };

  const summaryPath = `./output/avago-av/avago-av-summary-${timestamp}.json`;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Summary saved to: ${summaryPath}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('Avago A/V Citation Overlap Export');
  console.log('='.repeat(60));

  exportToCSV();

  console.log('\n' + '='.repeat(60));
  console.log('Export Complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
