/**
 * Generate Heat Map Batch Strategy Summary
 *
 * Creates a comprehensive markdown summary of batch strategy, including:
 * - Overall strategy overview
 * - Per-batch analysis with strengths, expected competitors, and critiques
 * - Follow-up recommendations based on expected heat map findings
 *
 * Usage:
 *   npx tsx scripts/generate-batch-summary.ts
 *   npx tsx scripts/generate-batch-summary.ts --input output/heatmap-batches-LATEST.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// INTERFACES
// ============================================================================

interface BatchPatent {
  patent_id: string;
  title: string;
  overall_score: number;
  competitor_citations: number;
  years_remaining: number;
  super_sector: string;
  sector: string;
  claim_breadth: string;
}

interface Batch {
  batch_number: number;
  batch_name: string;
  patents: BatchPatent[];
}

interface BatchOutput {
  generated_date: string;
  config_file: string;
  total_batches: number;
  total_patents: number;
  batch_size: number;
  cost_per_patent: number;
  total_cost: number;
  selection_criteria: {
    min_years_remaining: number;
    min_overall_score: number;
    strategy: string;
  };
  sector_distribution: Record<string, number>;
  batches: Batch[];
}

interface CompetitorConfig {
  competitors: Record<string, {
    displayName: string;
    tier: number;
    sectors: string[];
    patterns: string[];
  }>;
}

interface SectorCompetitorMap {
  [sector: string]: string[];
}

// ============================================================================
// SECTOR TO COMPETITOR MAPPING
// ============================================================================

// Based on portfolio analysis - which competitors are active in which sectors
const SECTOR_COMPETITORS: SectorCompetitorMap = {
  // Security sectors
  'auth-ids': ['Microsoft', 'Google', 'Amazon', 'CrowdStrike', 'Palo Alto Networks', 'Okta'],
  'auth-firewall': ['Cisco', 'Palo Alto Networks', 'Fortinet', 'Check Point', 'Microsoft'],
  'auth-identity': ['Microsoft', 'Okta', 'Ping Identity', 'CyberArk', 'SailPoint'],
  'auth-access': ['Microsoft', 'Okta', 'CyberArk', 'BeyondTrust', 'Sailpoint'],
  'auth-network': ['Cisco', 'Palo Alto Networks', 'Fortinet', 'Juniper', 'Arista'],
  'auth-threat': ['CrowdStrike', 'SentinelOne', 'Microsoft', 'Palo Alto Networks', 'Mandiant'],
  'sec-malware': ['CrowdStrike', 'SentinelOne', 'Microsoft', 'McAfee', 'Symantec', 'Trend Micro'],
  'sec-data': ['Microsoft', 'Varonis', 'Proofpoint', 'Mimecast', 'Forcepoint'],
  'sec-auth': ['Microsoft', 'Okta', 'Duo', 'Auth0', 'Ping Identity'],
  'sec-policy': ['Microsoft', 'ServiceNow', 'Splunk', 'IBM', 'Qualys'],
  'sec-sandbox': ['CrowdStrike', 'Palo Alto Networks', 'VMware', 'FireEye', 'Cisco'],
  'cryptography': ['Microsoft', 'Apple', 'Google', 'Amazon', 'IBM'],
  'network-security': ['Cisco', 'Palo Alto Networks', 'Fortinet', 'Check Point', 'Zscaler'],

  // Virtualization & Cloud
  'cloud-fault': ['VMware', 'Microsoft', 'Amazon', 'Google', 'Red Hat'],
  'cloud-monitoring': ['Datadog', 'Splunk', 'New Relic', 'Dynatrace', 'Microsoft'],
  'cloud-topology': ['VMware', 'HashiCorp', 'Kubernetes', 'Amazon', 'Microsoft'],
  'cloud-orchestration': ['VMware', 'Red Hat', 'HashiCorp', 'Amazon', 'Microsoft'],
  'vm-resource': ['VMware', 'Microsoft', 'Citrix', 'Nutanix', 'Red Hat'],
  'virtualization': ['VMware', 'Microsoft', 'Citrix', 'Nutanix', 'Red Hat'],

  // SDN & Network
  'proto-session': ['Cisco', 'F5', 'Citrix', 'Akamai', 'Cloudflare'],
  'proto-distributed': ['Amazon', 'Google', 'Microsoft', 'Cloudflare', 'Fastly'],
  'sdn-routing': ['Cisco', 'Juniper', 'Arista', 'Nokia', 'Huawei'],
  'sdn-switching': ['Cisco', 'Arista', 'Juniper', 'Dell', 'HPE'],
  'sdn-qos': ['Cisco', 'Juniper', 'Nokia', 'Ericsson', 'Huawei'],
  'infra-addressing': ['Cisco', 'Infoblox', 'BlueCat', 'Microsoft', 'Amazon'],

  // Wireless
  'wireless': ['Qualcomm', 'Apple', 'Samsung', 'Intel', 'MediaTek'],
  'wireless-services': ['AT&T', 'Verizon', 'T-Mobile', 'Ericsson', 'Nokia'],

  // Video & Streaming
  'video-codec': ['Apple', 'Google', 'Netflix', 'Amazon', 'Microsoft', 'Qualcomm'],

  // Computing
  'computing': ['Microsoft', 'Apple', 'Google', 'Intel', 'AMD', 'NVIDIA'],

  // AI/ML
  'ai-ml': ['Google', 'Microsoft', 'Amazon', 'NVIDIA', 'OpenAI', 'Meta'],

  // Imaging
  'image-processing': ['Apple', 'Google', 'Samsung', 'Sony', 'Canon'],
};

// ============================================================================
// HELPERS
// ============================================================================

function parseArgs(): { inputPath: string } {
  const args = process.argv.slice(2);
  let inputPath = 'output/heatmap-batches-LATEST.json';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      inputPath = args[i + 1];
      i++;
    }
  }

  return { inputPath };
}

function loadBatchData(inputPath: string): BatchOutput {
  const fullPath = path.resolve(inputPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Batch file not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

function getExpectedCompetitors(patents: BatchPatent[]): string[] {
  const competitorCounts: Record<string, number> = {};

  for (const p of patents) {
    const sector = p.sector;
    const competitors = SECTOR_COMPETITORS[sector] || [];
    for (const comp of competitors) {
      competitorCounts[comp] = (competitorCounts[comp] || 0) + 1;
    }
  }

  // Sort by count and return top competitors
  return Object.entries(competitorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([comp]) => comp);
}

function getSectorBreakdown(patents: BatchPatent[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const p of patents) {
    breakdown[p.sector] = (breakdown[p.sector] || 0) + 1;
  }
  return breakdown;
}

function getSuperSectorBreakdown(patents: BatchPatent[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const p of patents) {
    breakdown[p.super_sector] = (breakdown[p.super_sector] || 0) + 1;
  }
  return breakdown;
}

function getClaimBreadthStats(patents: BatchPatent[]): { broad: number; moderate: number; narrow: number; unknown: number } {
  let broad = 0, moderate = 0, narrow = 0, unknown = 0;
  for (const p of patents) {
    const cb = parseInt(p.claim_breadth);
    if (cb === 4) broad++;
    else if (cb === 3) moderate++;
    else if (cb === 2) narrow++;
    else unknown++;
  }
  return { broad, moderate, narrow, unknown };
}

// ============================================================================
// BATCH ANALYSIS
// ============================================================================

interface BatchAnalysis {
  batch: Batch;
  scoreStats: { min: number; max: number; avg: number };
  citationStats: { min: number; max: number; avg: number; total: number };
  yearsStats: { min: number; max: number; avg: number };
  sectorBreakdown: Record<string, number>;
  superSectorBreakdown: Record<string, number>;
  claimBreadthStats: { broad: number; moderate: number; narrow: number; unknown: number };
  expectedCompetitors: string[];
  strengths: string[];
  critiques: string[];
  followUpRecommendations: string[];
}

function analyzeBatch(batch: Batch): BatchAnalysis {
  const patents = batch.patents;
  const scores = patents.map(p => p.overall_score);
  const citations = patents.map(p => p.competitor_citations);
  const years = patents.map(p => p.years_remaining);

  const scoreStats = {
    min: Math.min(...scores),
    max: Math.max(...scores),
    avg: scores.reduce((a, b) => a + b, 0) / scores.length,
  };

  const citationStats = {
    min: Math.min(...citations),
    max: Math.max(...citations),
    avg: citations.reduce((a, b) => a + b, 0) / citations.length,
    total: citations.reduce((a, b) => a + b, 0),
  };

  const yearsStats = {
    min: Math.min(...years),
    max: Math.max(...years),
    avg: years.reduce((a, b) => a + b, 0) / years.length,
  };

  const sectorBreakdown = getSectorBreakdown(patents);
  const superSectorBreakdown = getSuperSectorBreakdown(patents);
  const claimBreadthStats = getClaimBreadthStats(patents);
  const expectedCompetitors = getExpectedCompetitors(patents);

  // Generate strengths based on batch characteristics
  const strengths = generateStrengths(batch, scoreStats, citationStats, superSectorBreakdown, claimBreadthStats);

  // Generate critiques
  const critiques = generateCritiques(batch, scoreStats, citationStats, superSectorBreakdown, claimBreadthStats);

  // Generate follow-up recommendations
  const followUpRecommendations = generateFollowUp(batch, superSectorBreakdown, sectorBreakdown);

  return {
    batch,
    scoreStats,
    citationStats,
    yearsStats,
    sectorBreakdown,
    superSectorBreakdown,
    claimBreadthStats,
    expectedCompetitors,
    strengths,
    critiques,
    followUpRecommendations,
  };
}

function generateStrengths(
  batch: Batch,
  scoreStats: { min: number; max: number; avg: number },
  citationStats: { min: number; max: number; avg: number; total: number },
  superSectorBreakdown: Record<string, number>,
  claimBreadthStats: { broad: number; moderate: number; narrow: number; unknown: number }
): string[] {
  const strengths: string[] = [];

  // Score-based strengths
  if (scoreStats.avg >= 85) {
    strengths.push('Elite patent quality - top tier of entire portfolio with exceptional overall scores');
  } else if (scoreStats.avg >= 75) {
    strengths.push('Strong patent quality - well above average portfolio scores');
  } else if (scoreStats.avg >= 65) {
    strengths.push('Solid patent quality - competitive scores within the broader portfolio');
  }

  // Citation-based strengths
  if (citationStats.avg >= 60) {
    strengths.push('High competitor citation density - strong evidence of market relevance and potential infringement');
  } else if (citationStats.avg >= 30) {
    strengths.push('Good competitor citation coverage - established relevance to competitor products');
  }

  // Sector concentration
  const topSector = Object.entries(superSectorBreakdown).sort((a, b) => b[1] - a[1])[0];
  if (topSector && topSector[1] >= 15) {
    const sectorName = topSector[0];
    if (sectorName === 'SECURITY') {
      strengths.push('Deep SECURITY concentration - targets high-value enterprise security market with clear product targets');
    } else if (sectorName === 'WIRELESS') {
      strengths.push('Strong WIRELESS presence - mobile/IoT market with high-volume device targets');
    } else if (sectorName === 'SDN_NETWORK') {
      strengths.push('SDN_NETWORK focus - targets cloud infrastructure and networking equipment vendors');
    }
  }

  // Claim breadth
  if (claimBreadthStats.broad >= 5) {
    strengths.push(`${claimBreadthStats.broad} patents with broad claims (score 4) - higher likelihood of finding infringing products`);
  }

  // Diversity (for diversity batches)
  const sectorCount = Object.keys(superSectorBreakdown).length;
  if (sectorCount >= 5) {
    strengths.push(`Good sector diversity (${sectorCount} super-sectors) - enables discovery of products across different markets`);
  }

  return strengths;
}

function generateCritiques(
  batch: Batch,
  scoreStats: { min: number; max: number; avg: number },
  citationStats: { min: number; max: number; avg: number; total: number },
  superSectorBreakdown: Record<string, number>,
  claimBreadthStats: { broad: number; moderate: number; narrow: number; unknown: number }
): string[] {
  const critiques: string[] = [];

  // Score-based critiques
  if (scoreStats.avg < 60) {
    critiques.push('Lower overall scores - may yield fewer actionable results from heat map vendor');
  }

  // Sector concentration critique
  const securityCount = superSectorBreakdown['SECURITY'] || 0;
  if (securityCount >= 20) {
    critiques.push('Heavy SECURITY concentration may limit product diversity - consider if results skew toward similar security products');
  }

  // Low diversity
  const sectorCount = Object.keys(superSectorBreakdown).length;
  if (sectorCount <= 2) {
    critiques.push('Limited sector diversity - heat map results may cluster around similar product categories');
  }

  // Citation concerns
  if (citationStats.avg < 20) {
    critiques.push('Lower competitor citation density - less pre-validated relevance to known infringers');
  }

  // Claim breadth concerns
  if (claimBreadthStats.narrow >= 5) {
    critiques.push(`${claimBreadthStats.narrow} patents with narrow claims - may yield fewer product matches`);
  }
  if (claimBreadthStats.unknown >= 15) {
    critiques.push('Limited claim breadth data - harder to predict heat map ROI for some patents');
  }

  return critiques;
}

function generateFollowUp(
  batch: Batch,
  superSectorBreakdown: Record<string, number>,
  sectorBreakdown: Record<string, number>
): string[] {
  const recommendations: string[] = [];

  // Based on batch type
  if (batch.batch_name.includes('High-Value')) {
    recommendations.push('If results show strong product matches: Immediately queue related patents from same sectors for next batch');
    recommendations.push('If specific competitors dominate matches: Consider targeted claim chart analysis for top 3-5 defendants');
    recommendations.push('Track which sub-sectors (e.g., auth-ids vs sec-malware) yield best product coverage');
  } else if (batch.batch_name.includes('Sector Diversity')) {
    recommendations.push('Compare product match rates across sectors to identify highest-ROI areas for future batches');
    recommendations.push('If a non-SECURITY sector shows strong results: Increase allocation in subsequent batches');
    recommendations.push('Document any new companies identified that should be added to competitor watchlist');
  } else if (batch.batch_name.includes('Strategic Fill')) {
    recommendations.push('Use results to validate whether lower-scored patents still yield valuable product matches');
    recommendations.push('If results are weak: May indicate diminishing returns - consider reducing total batch count');
    recommendations.push('Look for unexpected product categories that might indicate new market opportunities');
  }

  // Sector-specific recommendations
  const topSectors = Object.entries(sectorBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [sector, count] of topSectors) {
    if (count >= 5) {
      if (sector === 'auth-ids') {
        recommendations.push('auth-ids patents: Watch for IAM, SSO, and identity governance product matches');
      } else if (sector === 'sec-malware') {
        recommendations.push('sec-malware patents: Expected EDR/XDR product matches - note detection methodology overlap');
      } else if (sector === 'wireless' || sector === 'wireless-services') {
        recommendations.push('wireless patents: Track which device types (phones, IoT, infrastructure) appear most');
      }
    }
  }

  return recommendations;
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateReport(data: BatchOutput, analyses: BatchAnalysis[]): string {
  const lines: string[] = [];

  // Header
  lines.push('# Heat Map Vendor Batch Strategy Summary');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Source Data:** ${data.config_file}`);
  lines.push(`**Total Investment:** $${data.total_cost.toLocaleString()} (${data.total_patents} patents × $${data.cost_per_patent})`);
  lines.push('');

  // Executive Summary
  lines.push('---');
  lines.push('');
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('This document outlines the strategic approach for submitting 250 patents across 10 batches to the heat map vendor for product/infringer discovery analysis.');
  lines.push('');
  lines.push('### Investment Overview');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Batches | ${data.total_batches} |`);
  lines.push(`| Patents per Batch | ${data.batch_size} |`);
  lines.push(`| Total Patents | ${data.total_patents} |`);
  lines.push(`| Cost per Patent | $${data.cost_per_patent} |`);
  lines.push(`| Total Cost | $${data.total_cost.toLocaleString()} |`);
  lines.push(`| Expected Products | ~${data.total_patents * 15} (assuming 15 avg matches/patent) |`);
  lines.push('');

  // Overall Strategy
  lines.push('---');
  lines.push('');
  lines.push('## Overall Strategy');
  lines.push('');
  lines.push('### Interleaved Batch Approach');
  lines.push('');
  lines.push('Batches are ordered to alternate between High-Value and Sector Diversity strategies,');
  lines.push('enabling parallel comparison of both approaches as results return from the vendor.');
  lines.push('');
  lines.push('| Day | Batch | Type | Purpose |');
  lines.push('|-----|-------|------|---------|');
  lines.push('| 1 | 1 | High-Value Discovery | Top patents by score |');
  lines.push('| 1 | 2 | Sector Diversity | Multi-sector rotation |');
  lines.push('| 2 | 3 | High-Value Discovery | Top patents by score |');
  lines.push('| 2 | 4 | Sector Diversity | Multi-sector rotation |');
  lines.push('| 3 | 5 | High-Value Discovery | Top patents by score |');
  lines.push('| 3 | 6 | Sector Diversity | Multi-sector rotation |');
  lines.push('| 4 | 7 | Sector Diversity | Multi-sector rotation |');
  lines.push('| 4 | 8 | Strategic Fill | Lower-tier validation |');
  lines.push('| 5 | 9 | Strategic Fill | Lower-tier validation |');
  lines.push('| 5 | 10 | Strategic Fill | Lower-tier validation |');
  lines.push('');
  lines.push('### Strategy Types');
  lines.push('');
  lines.push('**High-Value Discovery (Batches 1, 3, 5)**');
  lines.push('- Top patents by overall score regardless of sector');
  lines.push('- Highest competitor citations and strongest validity/eligibility scores');
  lines.push('- Expect highest product match rates and clearest infringement signals');
  lines.push('');
  lines.push('**Sector Diversity (Batches 2, 4, 6, 7)**');
  lines.push('- Rotate through non-SECURITY sectors to ensure market coverage');
  lines.push('- Take top 3 patents per sector, fill remaining with SECURITY');
  lines.push('- Goal: Discover products in WIRELESS, SDN, VIDEO, COMPUTING, VIRTUALIZATION');
  lines.push('');
  lines.push('**Strategic Fill (Batches 8, 9, 10)**');
  lines.push('- Fill remaining allocation from score-sorted pool');
  lines.push('- Lower scores but still above minimum threshold');
  lines.push('- Goal: Test whether mid-tier patents yield actionable heat map data');
  lines.push('');

  // Selection Criteria
  lines.push('### Selection Criteria');
  lines.push('');
  lines.push('| Criterion | Value | Rationale |');
  lines.push('|-----------|-------|-----------|');
  lines.push(`| Minimum Overall Score | ${data.selection_criteria.min_overall_score} | Ensures baseline quality |`);
  lines.push(`| Minimum Years Remaining | ${data.selection_criteria.min_years_remaining}+ | Sufficient runway for licensing/litigation |`);
  lines.push('| Competitor Citations | Weighted in score | Pre-validated market relevance |');
  lines.push('| Claim Breadth | Preferred 3-4 | Broader claims yield more matches |');
  lines.push('');

  // Sector Distribution
  lines.push('### Sector Distribution');
  lines.push('');
  lines.push('| Super-Sector | Count | % of Total | Rationale |');
  lines.push('|--------------|-------|------------|-----------|');
  const sortedSectors = Object.entries(data.sector_distribution).sort((a, b) => b[1] - a[1]);
  for (const [sector, count] of sortedSectors) {
    const pct = ((count / data.total_patents) * 100).toFixed(1);
    let rationale = '';
    if (sector === 'SECURITY') rationale = 'Portfolio strength, clear enterprise targets';
    else if (sector === 'WIRELESS') rationale = 'Mobile/IoT device volume';
    else if (sector === 'SDN_NETWORK') rationale = 'Cloud infrastructure growth';
    else if (sector === 'COMPUTING') rationale = 'Broad applicability';
    else if (sector === 'VIRTUALIZATION') rationale = 'Enterprise cloud infrastructure';
    else if (sector === 'VIDEO_STREAMING') rationale = 'Consumer electronics targets';
    else rationale = 'Exploratory coverage';
    lines.push(`| ${sector} | ${count} | ${pct}% | ${rationale} |`);
  }
  lines.push('');

  // Expected Top Competitors
  lines.push('### Expected Top Competitors Across All Batches');
  lines.push('');
  const allCompetitors: Record<string, number> = {};
  for (const analysis of analyses) {
    for (const comp of analysis.expectedCompetitors) {
      allCompetitors[comp] = (allCompetitors[comp] || 0) + 1;
    }
  }
  const topCompetitors = Object.entries(allCompetitors).sort((a, b) => b[1] - a[1]).slice(0, 12);
  lines.push('Based on sector composition and historical citation patterns:');
  lines.push('');
  lines.push(topCompetitors.map(([c]) => `- ${c}`).join('\n'));
  lines.push('');

  // Per-Batch Analysis
  lines.push('---');
  lines.push('');
  lines.push('## Per-Batch Analysis');
  lines.push('');

  for (const analysis of analyses) {
    const { batch, scoreStats, citationStats, yearsStats, superSectorBreakdown, claimBreadthStats, expectedCompetitors, strengths, critiques, followUpRecommendations } = analysis;

    lines.push(`### Batch ${batch.batch_number}: ${batch.batch_name}`);
    lines.push('');

    // Stats table
    lines.push('#### Key Metrics');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Patents | ${batch.patents.length} |`);
    lines.push(`| Score Range | ${scoreStats.min.toFixed(1)} - ${scoreStats.max.toFixed(1)} (avg: ${scoreStats.avg.toFixed(1)}) |`);
    lines.push(`| Competitor Citations | ${citationStats.min} - ${citationStats.max} (avg: ${citationStats.avg.toFixed(0)}, total: ${citationStats.total}) |`);
    lines.push(`| Years Remaining | ${yearsStats.min.toFixed(1)} - ${yearsStats.max.toFixed(1)} (avg: ${yearsStats.avg.toFixed(1)}) |`);
    lines.push(`| Claim Breadth | Broad: ${claimBreadthStats.broad}, Moderate: ${claimBreadthStats.moderate}, Narrow: ${claimBreadthStats.narrow}, Unknown: ${claimBreadthStats.unknown} |`);
    lines.push('');

    // Sector breakdown
    lines.push('#### Sector Composition');
    lines.push('');
    const sectorList = Object.entries(superSectorBreakdown).sort((a, b) => b[1] - a[1]);
    lines.push(sectorList.map(([s, c]) => `- ${s}: ${c}`).join('\n'));
    lines.push('');

    // Expected competitors
    lines.push('#### Expected Competitors');
    lines.push('');
    lines.push(expectedCompetitors.slice(0, 6).join(', '));
    lines.push('');

    // Strengths
    lines.push('#### Strengths');
    lines.push('');
    if (strengths.length > 0) {
      lines.push(strengths.map(s => `- ${s}`).join('\n'));
    } else {
      lines.push('- Standard batch with typical characteristics');
    }
    lines.push('');

    // Critiques
    lines.push('#### Critiques & Risk Factors');
    lines.push('');
    if (critiques.length > 0) {
      lines.push(critiques.map(c => `- ${c}`).join('\n'));
    } else {
      lines.push('- No significant concerns identified');
    }
    lines.push('');

    // Follow-up recommendations
    lines.push('#### Follow-Up Recommendations (Post Heat Map)');
    lines.push('');
    lines.push(followUpRecommendations.map(r => `- ${r}`).join('\n'));
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Feedback Loop
  lines.push('## Feedback Loop: Using Results to Refine Future Batches');
  lines.push('');
  lines.push('### After Each Batch');
  lines.push('');
  lines.push('1. **Track Products Matched per Patent** - Calculate avg products found per patent');
  lines.push('2. **Sector Performance** - Which sectors yield highest product match rates?');
  lines.push('3. **Competitor Discovery** - Note any new companies not in our watchlist');
  lines.push('4. **Claim Breadth Validation** - Does claim breadth correlate with products matched?');
  lines.push('');
  lines.push('### Decision Points');
  lines.push('');
  lines.push('| After Batch | Decision |');
  lines.push('|-------------|----------|');
  lines.push('| 1-3 | If <10 products/patent avg: Review vendor quality. If >20: Expand budget. |');
  lines.push('| 4-7 | Reallocate sector quotas based on batch 1-3 sector performance |');
  lines.push('| 8-10 | Decide whether to continue with additional batches or move to claim charts |');
  lines.push('');
  lines.push('### Success Metrics');
  lines.push('');
  lines.push('| Metric | Target | Action if Below |');
  lines.push('|--------|--------|-----------------|');
  lines.push('| Avg products/patent | 15+ | Review patent selection criteria |');
  lines.push('| Known competitors found | 80%+ | Validate vendor methodology |');
  lines.push('| Actionable matches | 50%+ | Refine to higher-scored patents |');
  lines.push('');

  // Appendix - Full patent list for Batch 1
  lines.push('---');
  lines.push('');
  lines.push('## Appendix: Batch 1 Patent List');
  lines.push('');
  lines.push('| # | Patent ID | Title | Score | Cites | Years | Sector |');
  lines.push('|---|-----------|-------|-------|-------|-------|--------|');
  const batch1 = analyses[0].batch;
  for (let i = 0; i < batch1.patents.length; i++) {
    const p = batch1.patents[i];
    const shortTitle = p.title.length > 40 ? p.title.substring(0, 40) + '...' : p.title;
    lines.push(`| ${i + 1} | ${p.patent_id} | ${shortTitle} | ${p.overall_score.toFixed(1)} | ${p.competitor_citations} | ${p.years_remaining.toFixed(1)} | ${p.sector} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(`*Generated: ${new Date().toISOString()}*`);

  return lines.join('\n');
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('Loading batch data...');
  const data = loadBatchData(args.inputPath);
  console.log(`  Loaded ${data.total_batches} batches with ${data.total_patents} patents`);

  console.log('Analyzing batches...');
  const analyses: BatchAnalysis[] = [];
  for (const batch of data.batches) {
    const analysis = analyzeBatch(batch);
    analyses.push(analysis);
  }

  console.log('Generating report...');
  const report = generateReport(data, analyses);

  // Save report
  const dateStr = new Date().toISOString().split('T')[0];
  const reportPath = `output/HEATMAP-BATCH-STRATEGY-${dateStr}.md`;
  const latestPath = 'output/HEATMAP-BATCH-STRATEGY-LATEST.md';

  fs.writeFileSync(reportPath, report);
  fs.writeFileSync(latestPath, report);

  console.log(`\nSaved report to: ${reportPath}`);
  console.log(`Saved latest to: ${latestPath}`);

  // Print preview
  console.log('\n' + '='.repeat(80));
  console.log('REPORT PREVIEW (first 60 lines)');
  console.log('='.repeat(80));
  console.log(report.split('\n').slice(0, 60).join('\n'));
  console.log('\n...[truncated]...');
  console.log(`\nFull report: ${reportPath}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
