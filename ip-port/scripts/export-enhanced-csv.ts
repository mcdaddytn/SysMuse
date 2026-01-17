/**
 * Enhanced CSV Export with Sectors and Multiple Weighted Scores
 *
 * Exports patent rankings with:
 * - Discovery strategy provenance
 * - Emergent sector from clustering
 * - Multiple pre-calculated weighted scores
 * - All raw metrics for custom Excel manipulation
 *
 * Usage: npx tsx scripts/export-enhanced-csv.ts [output-file]
 */

import * as fs from 'fs';
import * as path from 'path';

interface ScoringWeights {
  [metric: string]: number;
}

interface WeightProfile {
  name: string;
  description: string;
  weights: ScoringWeights;
}

interface ScoringConfig {
  profiles: Record<string, WeightProfile>;
}

interface ClusterDefinition {
  id: number;
  name: string;
  patentIds: string[];
  searchTerms: string[];
  competitorCitations: number;
}

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
  // LLM v1 scores
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  // LLM v2 scores (if available)
  market_relevance_score?: number;
  trend_alignment_score?: number;
  evidence_accessibility_score?: number;
  investigation_priority_score?: number;
  // Calculated
  litigationScore?: number;
  licensingScore?: number;
  overallActionableScore?: number;
}

interface CompetitorConfig {
  discoveryStrategies: Record<string, {
    name: string;
    parameters?: {
      patentCount?: number;
      extractedTerms?: string[];
    };
  }>;
}

/**
 * Load scoring weights configuration
 */
function loadScoringWeights(): ScoringConfig {
  const configPath = './config/scoring-weights.json';
  if (!fs.existsSync(configPath)) {
    console.warn('Warning: scoring-weights.json not found, using defaults');
    return {
      profiles: {
        default: {
          name: 'Default',
          description: 'Default balanced scoring',
          weights: {
            competitor_citations: 0.25,
            forward_citations: 0.10,
            years_remaining: 0.15,
            eligibility_score: 0.15,
            validity_score: 0.15,
            claim_breadth: 0.10,
            enforcement_clarity: 0.10
          }
        }
      }
    };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Load cluster definitions for sector assignment
 */
function loadClusterDefinitions(): Map<string, ClusterDefinition> {
  const clusterMap = new Map<string, ClusterDefinition>();

  // Find most recent cluster definitions file
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

  // Build patent -> cluster mapping
  for (const cluster of data.clusters || []) {
    const patentIds = cluster.patentIds || [];
    for (const patentId of patentIds) {
      clusterMap.set(patentId, {
        id: cluster.id,
        name: cluster.name,
        patentIds: patentIds,
        searchTerms: cluster.centroidTerms?.map((t: any) => t.term) || [],
        competitorCitations: cluster.totalCompetitorCitations || 0
      });
    }
  }

  return clusterMap;
}

/**
 * Load competitor config for discovery strategies
 */
function loadCompetitorConfig(): CompetitorConfig {
  const configPath = './config/competitors.json';
  if (!fs.existsSync(configPath)) {
    return { discoveryStrategies: {} };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Load patent data from various sources
 */
function loadPatentData(): PatentData[] {
  // Try to load from multi-score analysis first
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

  // Fall back to tier-litigation files
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

/**
 * Load LLM analysis results if available
 */
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

/**
 * Normalize a metric value to 0-1 range
 */
function normalize(value: number | undefined, maxValue: number, useLog: boolean = false): number {
  if (value === undefined || value === null) return 0;
  if (useLog) {
    return Math.min(1, Math.sqrt(value) / maxValue);
  }
  return Math.min(1, value / maxValue);
}

/**
 * Calculate weighted score using a profile
 */
function calculateWeightedScore(patent: PatentData, llm: any, weights: ScoringWeights): number {
  let score = 0;
  let totalWeight = 0;

  for (const [metric, weight] of Object.entries(weights)) {
    let normalizedValue = 0;

    switch (metric) {
      case 'competitor_citations':
        normalizedValue = normalize(patent.competitor_citations, 20);
        break;
      case 'forward_citations':
        normalizedValue = normalize(patent.forward_citations, 30, true);
        break;
      case 'years_remaining':
        normalizedValue = normalize(patent.years_remaining, 15);
        break;
      case 'eligibility_score':
        normalizedValue = normalize(llm?.eligibility_score || patent.eligibility_score, 5);
        break;
      case 'validity_score':
        normalizedValue = normalize(llm?.validity_score || patent.validity_score, 5);
        break;
      case 'claim_breadth':
        normalizedValue = normalize(llm?.claim_breadth || patent.claim_breadth, 5);
        break;
      case 'enforcement_clarity':
        normalizedValue = normalize(llm?.enforcement_clarity || patent.enforcement_clarity, 5);
        break;
      case 'design_around_difficulty':
        normalizedValue = normalize(llm?.design_around_difficulty || patent.design_around_difficulty, 5);
        break;
      case 'market_relevance_score':
        normalizedValue = normalize(llm?.market_relevance_score || patent.market_relevance_score, 5);
        break;
      case 'trend_alignment_score':
        normalizedValue = normalize(llm?.trend_alignment_score || patent.trend_alignment_score, 5);
        break;
      case 'evidence_accessibility_score':
        normalizedValue = normalize(llm?.evidence_accessibility_score || patent.evidence_accessibility_score, 5);
        break;
      case 'investigation_priority_score':
        normalizedValue = normalize(llm?.investigation_priority_score || patent.investigation_priority_score, 5);
        break;
    }

    // Only count metrics that have values
    if (normalizedValue > 0 || (patent as any)[metric] !== undefined || (llm as any)?.[metric] !== undefined) {
      score += normalizedValue * weight;
      totalWeight += weight;
    }
  }

  // Renormalize if not all metrics available
  if (totalWeight > 0 && totalWeight < 1) {
    score = score / totalWeight;
  }

  return Math.round(score * 100 * 10) / 10; // Round to 1 decimal
}

/**
 * Determine discovery strategy for a patent
 */
function getDiscoveryStrategy(patent: PatentData, clusterInfo: ClusterDefinition | undefined): string {
  // If in a cluster, use the cluster strategy
  if (clusterInfo) {
    return `hybrid-cluster-${clusterInfo.id}`;
  }

  // Check if it came from citation overlap
  if (patent.competitor_citations && patent.competitor_citations > 0) {
    return 'citation-overlap';
  }

  // Default
  return 'initial-portfolio';
}

/**
 * Export to CSV
 */
function exportToCSV(outputPath: string): void {
  console.log('Loading data sources...');

  const scoringConfig = loadScoringWeights();
  const clusterMap = loadClusterDefinitions();
  const patents = loadPatentData();
  const llmAnalysis = loadLLMAnalysis();

  console.log(`\nProcessing ${patents.length} patents...`);
  console.log(`Cluster assignments: ${clusterMap.size}`);
  console.log(`Weight profiles: ${Object.keys(scoringConfig.profiles).join(', ')}`);

  // CSV header
  const columns = [
    'rank',
    'patent_id',
    'title',
    'grant_date',
    'assignee',
    'years_remaining',
    'forward_citations',
    'competitor_citations',
    'competitors_citing',
    'discovery_strategy',
    'sector',
    'sector_terms',
    'cpc_codes',
    // LLM scores
    'eligibility_score',
    'validity_score',
    'claim_breadth',
    'enforcement_clarity',
    'design_around_difficulty',
    'market_relevance',
    'trend_alignment',
    'evidence_accessibility',
    // Pre-calculated weighted scores
    'score_default',
    'score_litigation',
    'score_licensing',
    'score_product_discovery',
    'score_defensive',
    'score_quick_wins'
  ];

  const rows: string[][] = [];
  rows.push(columns);

  // Sort patents by default score
  const sortedPatents = patents.map((patent, idx) => {
    const llm = llmAnalysis.get(patent.patent_id);
    const defaultScore = calculateWeightedScore(patent, llm, scoringConfig.profiles.default?.weights || {});
    return { patent, llm, defaultScore, idx };
  }).sort((a, b) => b.defaultScore - a.defaultScore);

  // Generate rows
  for (let i = 0; i < sortedPatents.length; i++) {
    const { patent, llm } = sortedPatents[i];
    const clusterInfo = clusterMap.get(patent.patent_id);

    const row = [
      (i + 1).toString(),
      patent.patent_id,
      `"${(patent.title || '').replace(/"/g, '""')}"`,
      patent.grant_date || '',
      `"${(patent.assignee || '').replace(/"/g, '""')}"`,
      (patent.years_remaining ?? '').toString(),
      (patent.forward_citations ?? '').toString(),
      (patent.competitor_citations ?? '').toString(),
      `"${(patent.competitors_citing || []).join('; ')}"`,
      getDiscoveryStrategy(patent, clusterInfo),
      clusterInfo?.name || '',
      `"${(clusterInfo?.searchTerms || []).slice(0, 5).join(', ')}"`,
      `"${(patent.cpc_codes || []).slice(0, 5).join('; ')}"`,
      // LLM scores
      (llm?.eligibility_score ?? patent.eligibility_score ?? '').toString(),
      (llm?.validity_score ?? patent.validity_score ?? '').toString(),
      (llm?.claim_breadth ?? patent.claim_breadth ?? '').toString(),
      (llm?.enforcement_clarity ?? patent.enforcement_clarity ?? '').toString(),
      (llm?.design_around_difficulty ?? patent.design_around_difficulty ?? '').toString(),
      (llm?.market_relevance_score ?? patent.market_relevance_score ?? '').toString(),
      (llm?.trend_alignment_score ?? patent.trend_alignment_score ?? '').toString(),
      (llm?.evidence_accessibility_score ?? patent.evidence_accessibility_score ?? '').toString(),
      // Weighted scores
      calculateWeightedScore(patent, llm, scoringConfig.profiles.default?.weights || {}).toString(),
      calculateWeightedScore(patent, llm, scoringConfig.profiles.litigation_focused?.weights || {}).toString(),
      calculateWeightedScore(patent, llm, scoringConfig.profiles.licensing_focused?.weights || {}).toString(),
      calculateWeightedScore(patent, llm, scoringConfig.profiles.product_discovery?.weights || {}).toString(),
      calculateWeightedScore(patent, llm, scoringConfig.profiles.defensive?.weights || {}).toString(),
      calculateWeightedScore(patent, llm, scoringConfig.profiles.quick_wins?.weights || {}).toString()
    ];

    rows.push(row);
  }

  // Write CSV
  const csvContent = rows.map(row => row.join(',')).join('\n');
  fs.writeFileSync(outputPath, csvContent);

  console.log(`\nExported ${rows.length - 1} patents to: ${outputPath}`);

  // Summary statistics
  const sectors = new Map<string, number>();
  const strategies = new Map<string, number>();

  for (const { patent } of sortedPatents) {
    const clusterInfo = clusterMap.get(patent.patent_id);
    const sector = clusterInfo?.name || 'Unclustered';
    const strategy = getDiscoveryStrategy(patent, clusterInfo);

    sectors.set(sector, (sectors.get(sector) || 0) + 1);
    strategies.set(strategy, (strategies.get(strategy) || 0) + 1);
  }

  console.log('\nSector Distribution:');
  for (const [sector, count] of [...sectors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${sector}: ${count}`);
  }

  console.log('\nDiscovery Strategy Distribution:');
  for (const [strategy, count] of [...strategies.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${strategy}: ${count}`);
  }
}

/**
 * Main
 */
async function main() {
  const args = process.argv.slice(2);
  const timestamp = new Date().toISOString().split('T')[0];
  const outputPath = args[0] || `./output/patents-enhanced-${timestamp}.csv`;

  console.log('='.repeat(60));
  console.log('Enhanced CSV Export');
  console.log('='.repeat(60));

  exportToCSV(outputPath);

  console.log('\n' + '='.repeat(60));
  console.log('Export Complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
