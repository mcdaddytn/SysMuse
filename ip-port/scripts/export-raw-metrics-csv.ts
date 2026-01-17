/**
 * Raw Metrics CSV Export (for Excel Formula-Based Scoring)
 *
 * Exports patent data with raw metrics only - no pre-calculated scores.
 * Designed for import into Excel workbook where formulas calculate scores.
 *
 * Usage: npx tsx scripts/export-raw-metrics-csv.ts [output-file]
 */

import * as fs from 'fs';
import * as path from 'path';

interface PatentData {
  patent_id: string;
  title: string;
  grant_date?: string;
  assignee?: string;
  years_remaining?: number;
  forward_citations?: number;
  competitor_citations?: number;
  competitors_citing?: string[];
  cpc_codes?: string[];
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  market_relevance_score?: number;
  trend_alignment_score?: number;
  evidence_accessibility_score?: number;
  investigation_priority_score?: number;
}

interface ClusterDefinition {
  id: number;
  name: string;
  patentIds: string[];
  searchTerms: string[];
}

function loadPatentData(): PatentData[] {
  const outputDir = './output';
  const multiScoreFiles = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (multiScoreFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(outputDir, multiScoreFiles[0]), 'utf-8'));
    console.log(`Loaded ${data.patents?.length || 0} patents from ${multiScoreFiles[0]}`);
    return data.patents || [];
  }

  const tierFiles = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('tier-litigation-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (tierFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(outputDir, tierFiles[0]), 'utf-8'));
    console.log(`Loaded ${data.length || 0} patents from ${tierFiles[0]}`);
    return data;
  }

  throw new Error('No patent data files found');
}

function loadClusterDefinitions(): Map<string, ClusterDefinition> {
  const clusterMap = new Map<string, ClusterDefinition>();
  const clusterDir = './output/clusters';

  if (!fs.existsSync(clusterDir)) {
    return clusterMap;
  }

  const files = fs.readdirSync(clusterDir)
    .filter(f => f.startsWith('cluster-definitions-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return clusterMap;
  }

  const data = JSON.parse(fs.readFileSync(path.join(clusterDir, files[0]), 'utf-8'));

  for (const cluster of data.clusters || []) {
    const patentIds = cluster.patentIds || [];
    for (const patentId of patentIds) {
      clusterMap.set(patentId, {
        id: cluster.id,
        name: cluster.name,
        patentIds: patentIds,
        searchTerms: cluster.centroidTerms?.map((t: any) => t.term) || []
      });
    }
  }

  return clusterMap;
}

function loadLLMAnalysis(): Map<string, any> {
  const llmMap = new Map<string, any>();
  const llmDir = './output/llm-analysis/combined';

  if (!fs.existsSync(llmDir)) {
    return llmMap;
  }

  const files = fs.readdirSync(llmDir)
    .filter(f => f.startsWith('combined-rankings-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(llmDir, files[0]), 'utf-8'));
    for (const patent of data.patents || []) {
      if (patent.llmAnalysis) {
        llmMap.set(patent.patent_id, patent.llmAnalysis);
      }
    }
    console.log(`Loaded LLM analysis for ${llmMap.size} patents`);
  }

  return llmMap;
}

function escapeCSV(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportToCSV(outputPath: string): void {
  console.log('Loading data sources...');

  const patents = loadPatentData();
  const clusterMap = loadClusterDefinitions();
  const llmAnalysis = loadLLMAnalysis();

  console.log(`\nProcessing ${patents.length} patents...`);
  console.log(`Cluster assignments: ${clusterMap.size}`);
  console.log(`LLM analyses: ${llmAnalysis.size}`);

  // CSV columns - raw metrics only, no calculated scores
  const columns = [
    'patent_id',
    'title',
    'grant_date',
    'assignee',
    'years_remaining',
    'forward_citations',
    'competitor_citations',
    'competitors_citing',
    'sector',
    'cpc_codes',
    // LLM v1 scores (raw 1-5)
    'eligibility_score',
    'validity_score',
    'claim_breadth',
    'enforcement_clarity',
    'design_around_difficulty',
    // LLM v2 scores if available
    'market_relevance',
    'trend_alignment',
    'evidence_accessibility',
    'investigation_priority',
    // LLM text outputs (for attorney review)
    'analysis_summary',
    'recommendations'
  ];

  const rows: string[] = [];
  rows.push(columns.join(','));

  // Sort by competitor_citations descending for initial order
  const sortedPatents = [...patents].sort((a, b) =>
    (b.competitor_citations || 0) - (a.competitor_citations || 0)
  );

  for (const patent of sortedPatents) {
    const llm = llmAnalysis.get(patent.patent_id);
    const clusterInfo = clusterMap.get(patent.patent_id);

    const row = [
      patent.patent_id,
      escapeCSV(patent.title),
      patent.grant_date || '',
      escapeCSV(patent.assignee),
      patent.years_remaining?.toFixed(1) || '',
      patent.forward_citations?.toString() || '',
      patent.competitor_citations?.toString() || '',
      escapeCSV((patent.competitors_citing || []).join('; ')),
      escapeCSV(clusterInfo?.name || ''),
      escapeCSV((patent.cpc_codes || []).slice(0, 5).join('; ')),
      // LLM scores
      (llm?.eligibility_score ?? patent.eligibility_score ?? '').toString(),
      (llm?.validity_score ?? patent.validity_score ?? '').toString(),
      (llm?.claim_breadth ?? patent.claim_breadth ?? '').toString(),
      (llm?.enforcement_clarity ?? patent.enforcement_clarity ?? '').toString(),
      (llm?.design_around_difficulty ?? patent.design_around_difficulty ?? '').toString(),
      (llm?.market_relevance_score ?? '').toString(),
      (llm?.trend_alignment_score ?? '').toString(),
      (llm?.evidence_accessibility_score ?? '').toString(),
      (llm?.investigation_priority_score ?? '').toString(),
      // Text outputs
      escapeCSV(llm?.analysis_summary || ''),
      escapeCSV(llm?.recommendations || '')
    ];

    rows.push(row.join(','));
  }

  fs.writeFileSync(outputPath, rows.join('\n'));
  console.log(`\nExported ${rows.length - 1} patents to: ${outputPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const timestamp = new Date().toISOString().split('T')[0];
  const outputPath = args[0] || `./output/patents-raw-metrics-${timestamp}.csv`;

  console.log('='.repeat(60));
  console.log('Raw Metrics CSV Export (for Excel)');
  console.log('='.repeat(60));

  exportToCSV(outputPath);

  console.log('\n' + '='.repeat(60));
  console.log('Export Complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
