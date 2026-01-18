/**
 * Raw Metrics CSV Export (for Excel Formula-Based Scoring)
 *
 * Exports patent data with raw metrics only - no pre-calculated scores.
 * Designed for import into Excel workbook where formulas calculate scores.
 *
 * Data Sources:
 * - multi-score-analysis: Base patent data (10k+ patents)
 * - sector analysis: Sector assignments and competitor details (76 patents)
 * - LLM v1/v2: Basic LLM scores (222 patents)
 * - LLM v3: Enhanced cross-sector signals (76 patents)
 * - IPR risk: PTAB IPR history (when available)
 * - Prosecution history: File wrapper data (when available)
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

interface LLMv3Analysis {
  // V3 cross-sector signals
  implementation_type?: string;
  standards_relevance?: string;
  standards_bodies?: string[];
  market_segment?: string;
  implementation_complexity?: string;
  claim_type_primary?: string;
  geographic_scope?: string;
  lifecycle_stage?: string;
  // V2 fields
  technology_category?: string;
  product_types?: string[];
  likely_implementers?: string[];
  detection_method?: string;
  // Scores
  claim_clarity_score?: number;
  market_relevance_score?: number;
  trend_alignment_score?: number;
  evidence_accessibility_score?: number;
  investigation_priority_score?: number;
  // Text
  summary?: string;
  prior_art_problem?: string;
  technical_solution?: string;
  // Base scores
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  confidence?: number;
}

interface IPRRiskData {
  has_ipr_history: boolean;
  petitions_filed: number;
  petitions_instituted: number;
  ipr_risk_score: number;
  ipr_risk_category: string;
  petitioner_names: string[];
}

interface ProsecutionData {
  office_actions_count: number;
  rce_count: number;
  time_to_grant_months: number | null;
  prosecution_quality_score: number;
  prosecution_quality_category: string;
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

function loadLLMAnalysisV1(): Map<string, any> {
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
    const records = data.records || data.patents || [];
    for (const record of records) {
      if (record.llm_eligibility_score !== undefined) {
        llmMap.set(record.patent_id, {
          eligibility_score: record.llm_eligibility_score,
          validity_score: record.llm_validity_score,
          claim_breadth: record.llm_claim_breadth,
          enforcement_clarity: record.llm_enforcement_clarity,
          design_around_difficulty: record.llm_design_around_difficulty,
          confidence: record.llm_confidence,
          analysis_summary: record.llm_summary,
          prior_art_problem: record.llm_prior_art_problem,
          technical_solution: record.llm_technical_solution,
        });
      }
    }
    console.log(`Loaded LLM v1 analysis for ${llmMap.size} patents`);
  }

  return llmMap;
}

function loadLLMAnalysisV3(): Map<string, LLMv3Analysis> {
  const llmMap = new Map<string, LLMv3Analysis>();
  const llmDir = './output/llm-analysis-v3';

  if (!fs.existsSync(llmDir)) {
    return llmMap;
  }

  // Load ALL combined-v3 files and merge them (newest data wins for duplicates)
  const files = fs.readdirSync(llmDir)
    .filter(f => f.startsWith('combined-v3-') && f.endsWith('.json'))
    .sort(); // Oldest first, so newer data overwrites older for same patent

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(llmDir, file), 'utf-8'));
    for (const analysis of data.analyses || []) {
      llmMap.set(analysis.patent_id, analysis);
    }
  }

  if (llmMap.size > 0) {
    console.log(`Loaded LLM v3 analysis for ${llmMap.size} patents (from ${files.length} files)`);
  }

  return llmMap;
}

function loadSectorAnalysis(): Map<string, { sector: string; sectorName: string; competitorsCiting: string[]; competitorCitations: number }> {
  const sectorMap = new Map();
  const sectorDir = './output/sectors';

  if (!fs.existsSync(sectorDir)) {
    return sectorMap;
  }

  const files = fs.readdirSync(sectorDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  const sectorFiles = new Map<string, string>();
  for (const f of files) {
    const match = f.match(/^([a-z-]+)-analysis-/);
    if (match && !sectorFiles.has(match[1])) {
      sectorFiles.set(match[1], f);
    }
  }

  let totalPatents = 0;
  for (const [sectorId, fileName] of sectorFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(sectorDir, fileName), 'utf-8'));
    const sectorName = data.sectorName || sectorId;

    for (const result of data.results || []) {
      sectorMap.set(result.patent_id, {
        sector: sectorId,
        sectorName: sectorName,
        competitorsCiting: result.competitors_citing || [],
        competitorCitations: result.competitor_citations || 0
      });
      totalPatents++;
    }
  }
  console.log(`Loaded sector analysis for ${totalPatents} patents across ${sectorFiles.size} sectors`);

  return sectorMap;
}

function loadIPRRiskData(): Map<string, IPRRiskData> {
  const iprMap = new Map<string, IPRRiskData>();
  const iprDir = './output/ipr';

  if (!fs.existsSync(iprDir)) {
    return iprMap;
  }

  const files = fs.readdirSync(iprDir)
    .filter(f => f.startsWith('ipr-risk-check-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(iprDir, files[0]), 'utf-8'));
    for (const result of data.results || []) {
      iprMap.set(result.patent_id, {
        has_ipr_history: result.has_ipr_history,
        petitions_filed: result.petitions_filed,
        petitions_instituted: result.petitions_instituted,
        ipr_risk_score: result.ipr_risk_score,
        ipr_risk_category: result.ipr_risk_category,
        petitioner_names: result.petitioner_names || [],
      });
    }
    console.log(`Loaded IPR risk data for ${iprMap.size} patents`);
  }

  return iprMap;
}

function loadProsecutionData(): Map<string, ProsecutionData> {
  const prosMap = new Map<string, ProsecutionData>();
  const prosDir = './output/prosecution';

  if (!fs.existsSync(prosDir)) {
    return prosMap;
  }

  const files = fs.readdirSync(prosDir)
    .filter(f => f.startsWith('prosecution-history-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(prosDir, files[0]), 'utf-8'));
    for (const result of data.results || []) {
      if (!result.error) {
        prosMap.set(result.patent_id, {
          office_actions_count: result.office_actions_count,
          rce_count: result.rce_count,
          time_to_grant_months: result.time_to_grant_months,
          prosecution_quality_score: result.prosecution_quality_score,
          prosecution_quality_category: result.prosecution_quality_category,
        });
      }
    }
    console.log(`Loaded prosecution history for ${prosMap.size} patents`);
  }

  return prosMap;
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
  const llmV1 = loadLLMAnalysisV1();
  const llmV3 = loadLLMAnalysisV3();
  const sectorAnalysis = loadSectorAnalysis();
  const iprData = loadIPRRiskData();
  const prosData = loadProsecutionData();

  console.log(`\nProcessing ${patents.length} patents...`);
  console.log(`Cluster assignments: ${clusterMap.size}`);
  console.log(`LLM v1 analyses: ${llmV1.size}`);
  console.log(`LLM v3 analyses: ${llmV3.size}`);
  console.log(`Sector analyses: ${sectorAnalysis.size}`);
  console.log(`IPR risk data: ${iprData.size}`);
  console.log(`Prosecution data: ${prosData.size}`);

  // CSV columns - comprehensive with all data sources
  const columns = [
    // Core patent data
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
    // LLM scores (1-5 scale)
    'eligibility_score',
    'validity_score',
    'claim_breadth',
    'claim_clarity_score',
    'enforcement_clarity',
    'design_around_difficulty',
    'evidence_accessibility',
    'market_relevance',
    'trend_alignment',
    'investigation_priority',
    'llm_confidence',
    // V3 cross-sector signals
    'implementation_type',
    'standards_relevance',
    'standards_bodies',
    'market_segment',
    'implementation_complexity',
    'claim_type_primary',
    'geographic_scope',
    'lifecycle_stage',
    'technology_category',
    'detection_method',
    // IPR risk
    'ipr_risk_score',
    'ipr_risk_category',
    'ipr_petitions_filed',
    'ipr_petitioners',
    // Prosecution history
    'prosecution_quality_score',
    'prosecution_quality_category',
    'office_actions_count',
    'rce_count',
    'time_to_grant_months',
    // LLM text outputs
    'analysis_summary',
    'prior_art_problem',
    'product_types',
    'likely_implementers',
  ];

  const rows: string[] = [];
  rows.push(columns.join(','));

  // Sort by competitor_citations descending for initial order
  const sortedPatents = [...patents].sort((a, b) =>
    (b.competitor_citations || 0) - (a.competitor_citations || 0)
  );

  for (const patent of sortedPatents) {
    const v1 = llmV1.get(patent.patent_id);
    const v3 = llmV3.get(patent.patent_id);
    const clusterInfo = clusterMap.get(patent.patent_id);
    const sectorInfo = sectorAnalysis.get(patent.patent_id);
    const ipr = iprData.get(patent.patent_id);
    const pros = prosData.get(patent.patent_id);

    // Merge competitor data - prefer sector analysis, fallback to multi-score
    const competitorsCiting = sectorInfo?.competitorsCiting
      || (patent as any).competitors
      || (patent as any).topCompetitors
      || [];
    const competitorCitations = sectorInfo?.competitorCitations
      || patent.competitor_citations
      || 0;

    // Sector name - prefer sector analysis, then cluster, then 'General'
    const sectorName = sectorInfo?.sectorName
      || clusterInfo?.name
      || 'General';

    // Prefer V3 LLM data when available, fallback to V1
    const llm = v3 || v1 || {};

    const row = [
      // Core patent data
      patent.patent_id,
      escapeCSV(patent.title),
      patent.grant_date || (patent as any).date || '',
      escapeCSV(patent.assignee),
      patent.years_remaining?.toFixed(1) || (patent as any).remaining_years?.toFixed(1) || '',
      patent.forward_citations?.toString() || '',
      competitorCitations.toString(),
      escapeCSV(Array.isArray(competitorsCiting) ? competitorsCiting.join('; ') : competitorsCiting),
      escapeCSV(sectorName),
      escapeCSV((patent.cpc_codes || []).slice(0, 5).join('; ')),
      // LLM scores
      (llm.eligibility_score ?? '').toString(),
      (llm.validity_score ?? '').toString(),
      (llm.claim_breadth ?? '').toString(),
      (llm.claim_clarity_score ?? '').toString(),
      (llm.enforcement_clarity ?? '').toString(),
      (llm.design_around_difficulty ?? '').toString(),
      (llm.evidence_accessibility_score ?? '').toString(),
      (llm.market_relevance_score ?? '').toString(),
      (llm.trend_alignment_score ?? '').toString(),
      (llm.investigation_priority_score ?? '').toString(),
      (llm.confidence ?? '').toString(),
      // V3 cross-sector signals
      escapeCSV(llm.implementation_type || ''),
      escapeCSV(llm.standards_relevance || ''),
      escapeCSV((llm.standards_bodies || []).join('; ')),
      escapeCSV(llm.market_segment || ''),
      escapeCSV(llm.implementation_complexity || ''),
      escapeCSV(llm.claim_type_primary || ''),
      escapeCSV(llm.geographic_scope || ''),
      escapeCSV(llm.lifecycle_stage || ''),
      escapeCSV(llm.technology_category || ''),
      escapeCSV(llm.detection_method || ''),
      // IPR risk
      (ipr?.ipr_risk_score ?? '').toString(),
      escapeCSV(ipr?.ipr_risk_category || ''),
      (ipr?.petitions_filed ?? '').toString(),
      escapeCSV((ipr?.petitioner_names || []).join('; ')),
      // Prosecution history
      (pros?.prosecution_quality_score ?? '').toString(),
      escapeCSV(pros?.prosecution_quality_category || ''),
      (pros?.office_actions_count ?? '').toString(),
      (pros?.rce_count ?? '').toString(),
      (pros?.time_to_grant_months ?? '').toString(),
      // LLM text outputs
      escapeCSV(llm.summary || llm.analysis_summary || ''),
      escapeCSV(llm.prior_art_problem || ''),
      escapeCSV((llm.product_types || []).join('; ')),
      escapeCSV((llm.likely_implementers || []).join('; ')),
    ];

    rows.push(row.join(','));
  }

  fs.writeFileSync(outputPath, rows.join('\n'));
  console.log(`\nExported ${rows.length - 1} patents to: ${outputPath}`);

  // Summary of data coverage
  let withV3 = 0, withIPR = 0, withPros = 0;
  for (const patent of patents) {
    if (llmV3.has(patent.patent_id)) withV3++;
    if (iprData.has(patent.patent_id)) withIPR++;
    if (prosData.has(patent.patent_id)) withPros++;
  }

  console.log(`\nData Coverage:`);
  console.log(`  Patents with V3 LLM: ${withV3}/${patents.length}`);
  console.log(`  Patents with IPR data: ${withIPR}/${patents.length}`);
  console.log(`  Patents with Prosecution data: ${withPros}/${patents.length}`);
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
