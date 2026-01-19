/**
 * Attorney Patent Portfolio Export
 *
 * Creates a comprehensive spreadsheet of all portfolio patents optimized
 * for attorney review. Includes:
 * - USPTO basic data (patent_id, title, date, assignee, affiliate)
 * - The 5 attorney questions (2 numeric, 3 textual)
 * - Enhanced data for patents with LLM analysis
 * - Affiliate normalization for portfolio breakdown
 *
 * Output: output/ATTORNEY-PORTFOLIO-{date}.csv (NOT excel/ - that's for macros only)
 *
 * Usage: npx tsx scripts/export-attorney-portfolio.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// INTERFACES
// ============================================================================

interface AffiliateConfig {
  displayName: string;
  acquiredYear: number | null;
  parent?: string;
  patterns: string[];
}

interface PortfolioAffiliatesConfig {
  affiliates: Record<string, AffiliateConfig>;
}

interface PatentRecord {
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;
  affiliate: string;  // Normalized portfolio entity name
  years_remaining: number;
  is_expired: boolean;
  forward_citations: number;
  competitor_citations: number;
  competitors_citing: string;

  // Attorney Questions (5)
  eligibility_score: number | null;
  validity_score: number | null;
  summary: string;
  prior_art_problem: string;
  technical_solution: string;

  // Additional LLM metrics
  claim_breadth: number | null;
  enforcement_clarity: number | null;
  design_around_difficulty: number | null;
  llm_confidence: number | null;

  // Classification
  sector: string;
  technology_category: string;
  cpc_primary: string;
  cpc_codes: string;

  // Risk/Quality indicators
  ipr_risk_score: number | null;
  ipr_risk_category: string;
  prosecution_quality_score: number | null;
  prosecution_quality_category: string;

  // Product/Market
  product_types: string;
  likely_implementers: string;
  detection_method: string;

  // Data availability flags
  has_llm_analysis: boolean;
  has_ipr_data: boolean;
  has_prosecution_data: boolean;
}

// ============================================================================
// AFFILIATE NORMALIZATION
// ============================================================================

let affiliateConfig: PortfolioAffiliatesConfig | null = null;
let affiliatePatterns: Array<{ pattern: RegExp; affiliate: string }> = [];

function loadAffiliateConfig(): void {
  const configPath = 'config/portfolio-affiliates.json';
  if (fs.existsSync(configPath)) {
    affiliateConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // Build pattern index
    for (const [affiliateKey, config] of Object.entries(affiliateConfig!.affiliates)) {
      for (const pattern of config.patterns) {
        affiliatePatterns.push({
          pattern: new RegExp(pattern, 'i'),
          affiliate: config.displayName
        });
      }
    }
    console.log(`Loaded ${affiliatePatterns.length} affiliate patterns`);
  } else {
    console.warn('Warning: portfolio-affiliates.json not found, using raw assignee names');
  }
}

function normalizeAffiliate(assignee: string): string {
  if (!assignee) return 'Unknown';

  for (const { pattern, affiliate } of affiliatePatterns) {
    if (pattern.test(assignee)) {
      return affiliate;
    }
  }

  // If no match, return a cleaned version of assignee
  return assignee.replace(/,?\s*(Inc\.|LLC|Corporation|Ltd\.|Pte\.).*$/i, '').trim() || 'Unknown';
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const dateStamp = new Date().toISOString().split('T')[0];

  console.log('============================================================');
  console.log('Attorney Patent Portfolio Export');
  console.log('============================================================');
  console.log('NOTE: Output goes to output/ directory (not excel/)');
  console.log('      excel/ is reserved for VBA macro files only\n');

  // Load affiliate config
  loadAffiliateConfig();

  // Load base patent data
  const msaPath = findLatestFile('output', 'multi-score-analysis-');
  const msaData = JSON.parse(fs.readFileSync(msaPath!, 'utf-8'));
  console.log(`Loaded ${msaData.patents.length} patents from ${path.basename(msaPath!)}`);

  // Load LLM analysis (v1 + v3)
  const llmMap = new Map<string, any>();

  // Load combined-rankings (v1 LLM)
  const v1Files = findFiles('output/llm-analysis', 'combined-rankings-');
  for (const file of v1Files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const records = data.records || data.analyses || [];
    for (const r of records) {
      if (r.patent_id && !llmMap.has(r.patent_id)) {
        llmMap.set(r.patent_id, r);
      }
    }
  }

  // Load LLM v3 (overrides v1)
  const v3Files = findFiles('output/llm-analysis-v3', 'combined-v3-');
  for (const file of v3Files) {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const records = data.analyses || data.records || [];
    for (const r of records) {
      if (r.patent_id) {
        llmMap.set(r.patent_id, { ...llmMap.get(r.patent_id), ...r });
      }
    }
  }
  console.log(`Loaded LLM analysis for ${llmMap.size} patents`);

  // Load sector analysis
  const sectorMap = new Map<string, any>();
  const sectorFiles = findFiles('output/sectors', '-analysis-');
  for (const file of sectorFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const a of data.analyses || []) {
        if (a.patent_id) {
          sectorMap.set(a.patent_id, a);
        }
      }
    } catch (e) { /* skip invalid files */ }
  }

  // Load sector assignments (V2)
  const sectorAssignFile = findLatestFile('output/sectors', 'all-patents-sectors-v2-');
  let sectorAssignments = new Map<string, string>();
  if (sectorAssignFile) {
    const data = JSON.parse(fs.readFileSync(sectorAssignFile, 'utf-8'));
    for (const [patentId, info] of Object.entries(data.assignments || {})) {
      sectorAssignments.set(patentId, (info as any).sector || '');
    }
    console.log(`Loaded sector assignments for ${sectorAssignments.size} patents`);
  }

  // Load IPR risk data
  const iprMap = new Map<string, any>();
  const iprFile = findLatestFile('output/ipr', 'ipr-risk-check-');
  if (iprFile) {
    const data = JSON.parse(fs.readFileSync(iprFile, 'utf-8'));
    for (const r of data.results || []) {
      if (r.patent_id) iprMap.set(r.patent_id, r);
    }
    console.log(`Loaded IPR data for ${iprMap.size} patents`);
  }

  // Load prosecution history
  const prosMap = new Map<string, any>();
  const prosFile = findLatestFile('output/prosecution', 'prosecution-history-');
  if (prosFile) {
    const data = JSON.parse(fs.readFileSync(prosFile, 'utf-8'));
    for (const r of data.results || []) {
      if (r.patent_id) prosMap.set(r.patent_id, r);
    }
    console.log(`Loaded prosecution data for ${prosMap.size} patents`);
  }

  // Build combined records
  const records: PatentRecord[] = [];

  for (const p of msaData.patents) {
    const llm = llmMap.get(p.patent_id) || {};
    const sector = sectorMap.get(p.patent_id) || {};
    const ipr = iprMap.get(p.patent_id) || {};
    const pros = prosMap.get(p.patent_id) || {};
    const sectorName = sectorAssignments.get(p.patent_id) || p.sector || '';
    const cpcCodes = p.cpc_codes || [];

    const yearsRemaining = round(p.remaining_years, 1);
    const isExpired = yearsRemaining <= 0;

    records.push({
      patent_id: p.patent_id,
      title: clean(p.title),
      grant_date: p.date || '',
      assignee: clean(p.assignee),
      affiliate: normalizeAffiliate(p.assignee),
      years_remaining: yearsRemaining,
      is_expired: isExpired,
      forward_citations: p.forward_citations || 0,
      competitor_citations: p.competitor_citations || 0,
      competitors_citing: (p.competitors || []).join('; '),

      // Attorney Questions
      eligibility_score: llm.eligibility_score || null,
      validity_score: llm.validity_score || null,
      summary: clean(llm.summary || sector.summary || ''),
      prior_art_problem: clean(llm.prior_art_problem || sector.prior_art_problem || ''),
      technical_solution: clean(llm.technical_solution || sector.technical_solution || ''),

      // Additional LLM
      claim_breadth: llm.claim_breadth || null,
      enforcement_clarity: llm.enforcement_clarity || null,
      design_around_difficulty: llm.design_around_difficulty || null,
      llm_confidence: llm.confidence || null,

      // Classification
      sector: sectorName,
      technology_category: llm.technology_category || sector.technology_category || '',
      cpc_primary: cpcCodes.length > 0 ? cpcCodes[0] : '',
      cpc_codes: cpcCodes.slice(0, 5).join('; '),

      // Risk/Quality
      ipr_risk_score: ipr.ipr_risk_score || null,
      ipr_risk_category: ipr.ipr_risk_category || '',
      prosecution_quality_score: pros.prosecution_quality_score || null,
      prosecution_quality_category: pros.prosecution_quality_category || '',

      // Product/Market
      product_types: (llm.product_types || sector.product_types || []).slice(0, 5).join('; '),
      likely_implementers: (llm.likely_implementers || sector.likely_implementers || []).slice(0, 5).join('; '),
      detection_method: clean(llm.detection_method || ''),

      // Flags
      has_llm_analysis: !!llm.eligibility_score,
      has_ipr_data: !!ipr.ipr_risk_score,
      has_prosecution_data: !!pros.prosecution_quality_score,
    });
  }

  // Sort by competitor citations (descending) for attorney convenience
  records.sort((a, b) => b.competitor_citations - a.competitor_citations);

  // Write main CSV
  const headers = [
    'patent_id', 'title', 'grant_date', 'assignee', 'affiliate', 'years_remaining', 'is_expired',
    'forward_citations', 'competitor_citations', 'competitors_citing',
    'eligibility_score', 'validity_score', 'summary', 'prior_art_problem', 'technical_solution',
    'claim_breadth', 'enforcement_clarity', 'design_around_difficulty', 'llm_confidence',
    'sector', 'technology_category', 'cpc_primary', 'cpc_codes',
    'ipr_risk_score', 'ipr_risk_category', 'prosecution_quality_score', 'prosecution_quality_category',
    'product_types', 'likely_implementers', 'detection_method',
    'has_llm_analysis', 'has_ipr_data', 'has_prosecution_data'
  ];

  const rows = [headers.join(',')];
  for (const r of records) {
    const row = headers.map(h => {
      const val = (r as any)[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'boolean') return val ? 'Y' : 'N';
      if (typeof val === 'string') return csvEscape(val);
      return String(val);
    });
    rows.push(row.join(','));
  }

  // Output to output/ directory (NOT excel/)
  const outputPath = `output/ATTORNEY-PORTFOLIO-${dateStamp}.csv`;
  const latestPath = 'output/ATTORNEY-PORTFOLIO-LATEST.csv';
  fs.writeFileSync(outputPath, rows.join('\n'));
  fs.writeFileSync(latestPath, rows.join('\n'));

  console.log(`\nExported ${records.length} patents`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Latest: ${latestPath}`);

  // Generate aggregation summary JSON for macro use
  const aggregations = generateAggregations(records);
  const aggPath = `output/ATTORNEY-PORTFOLIO-AGGREGATIONS-${dateStamp}.json`;
  fs.writeFileSync(aggPath, JSON.stringify(aggregations, null, 2));
  console.log(`  Aggregations: ${aggPath}`);

  // Summary stats
  const withLLM = records.filter(r => r.has_llm_analysis).length;
  const withIPR = records.filter(r => r.has_ipr_data).length;
  const withPros = records.filter(r => r.has_prosecution_data).length;
  const withCites = records.filter(r => r.competitor_citations > 0).length;
  const expired = records.filter(r => r.is_expired).length;
  const active = records.length - expired;

  console.log(`\nPortfolio Status:`);
  console.log(`  Active patents: ${active}`);
  console.log(`  Expired patents: ${expired}`);

  console.log(`\nData Coverage:`);
  console.log(`  Patents with competitor citations: ${withCites}`);
  console.log(`  Patents with LLM analysis: ${withLLM}`);
  console.log(`  Patents with IPR data: ${withIPR}`);
  console.log(`  Patents with prosecution data: ${withPros}`);

  // Print affiliate breakdown
  console.log(`\nAffiliate Breakdown:`);
  for (const [affiliate, data] of Object.entries(aggregations.byAffiliate)) {
    const d = data as any;
    console.log(`  ${affiliate}: ${d.total} (${d.active} active, ${d.expired} expired)`);
  }

  console.log('\n============================================================');
  console.log('Attorney Portfolio Export Complete');
  console.log('============================================================');
}

// ============================================================================
// AGGREGATION FUNCTIONS
// ============================================================================

interface AggregationData {
  generatedAt: string;
  totals: {
    total: number;
    active: number;
    expired: number;
    withCompetitorCitations: number;
    withLLMAnalysis: number;
  };
  byAffiliate: Record<string, { total: number; active: number; expired: number; withCitations: number }>;
  bySector: Record<string, { total: number; active: number; expired: number; withCitations: number }>;
  byCpcClass: Record<string, { total: number; active: number; expired: number }>;
  expirationTimeline: Record<string, number>;  // year -> count expiring
}

function generateAggregations(records: PatentRecord[]): AggregationData {
  const byAffiliate: Record<string, { total: number; active: number; expired: number; withCitations: number }> = {};
  const bySector: Record<string, { total: number; active: number; expired: number; withCitations: number }> = {};
  const byCpcClass: Record<string, { total: number; active: number; expired: number }> = {};
  const expirationTimeline: Record<string, number> = {};

  for (const r of records) {
    // By Affiliate
    const aff = r.affiliate || 'Unknown';
    if (!byAffiliate[aff]) byAffiliate[aff] = { total: 0, active: 0, expired: 0, withCitations: 0 };
    byAffiliate[aff].total++;
    if (r.is_expired) byAffiliate[aff].expired++;
    else byAffiliate[aff].active++;
    if (r.competitor_citations > 0) byAffiliate[aff].withCitations++;

    // By Sector
    const sec = r.sector || 'unassigned';
    if (!bySector[sec]) bySector[sec] = { total: 0, active: 0, expired: 0, withCitations: 0 };
    bySector[sec].total++;
    if (r.is_expired) bySector[sec].expired++;
    else bySector[sec].active++;
    if (r.competitor_citations > 0) bySector[sec].withCitations++;

    // By CPC Class (first 4 chars, e.g., H04L, G06F)
    const cpcClass = r.cpc_primary ? r.cpc_primary.substring(0, 4) : 'Unknown';
    if (!byCpcClass[cpcClass]) byCpcClass[cpcClass] = { total: 0, active: 0, expired: 0 };
    byCpcClass[cpcClass].total++;
    if (r.is_expired) byCpcClass[cpcClass].expired++;
    else byCpcClass[cpcClass].active++;

    // Expiration timeline
    if (!r.is_expired && r.years_remaining > 0) {
      const expirationYear = new Date().getFullYear() + Math.ceil(r.years_remaining);
      const yearStr = String(expirationYear);
      expirationTimeline[yearStr] = (expirationTimeline[yearStr] || 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      total: records.length,
      active: records.filter(r => !r.is_expired).length,
      expired: records.filter(r => r.is_expired).length,
      withCompetitorCitations: records.filter(r => r.competitor_citations > 0).length,
      withLLMAnalysis: records.filter(r => r.has_llm_analysis).length,
    },
    byAffiliate,
    bySector,
    byCpcClass,
    expirationTimeline,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function findLatestFile(dir: string, prefix: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

function findFiles(dir: string, pattern: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.includes(pattern) && f.endsWith('.json'))
    .map(f => path.join(dir, f));
}

function clean(s: string | undefined | null): string {
  if (!s) return '';
  return s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function round(n: number | undefined, decimals: number): number {
  if (n === undefined || n === null) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

main().catch(console.error);
