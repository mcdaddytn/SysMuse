/**
 * Merge Full Portfolio for Attorney Export
 *
 * This script merges ALL patents from the broadcom-portfolio into
 * the attorney export, including ~5,500 patents that were never
 * processed through the citation overlap analysis pipeline.
 *
 * These missing patents will have basic USPTO data but no:
 * - Competitor citations
 * - LLM analysis
 * - Scoring data
 *
 * Usage: npx tsx scripts/merge-portfolio-for-attorney.ts
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

interface PortfolioPatent {
  patent_id: string;
  patent_title: string;
  patent_type: string;
  patent_date: string;
  patent_abstract: string;
  patent_num_times_cited_by_us_patents: number;
  patent_num_us_patents_cited: number;
  assignees: Array<{
    assignee_organization: string;
    assignee_city?: string;
    assignee_country?: string;
  }>;
  cpc_current?: Array<{
    cpc_group_id?: string;
    cpc_subclass_id?: string;
  }>;
}

interface MSAPatent {
  patent_id: string;
  title: string;
  date: string;
  grant_date?: string;  // VMware patents use grant_date instead of date
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  competitor_citations: number;
  competitors: string[];
  sector?: string;
  sectorName?: string;
  superSector?: string;
  superSectorName?: string;
  cpc_codes?: string[];
  isExpired?: boolean;
  licensingScore?: number;
  litigationScore?: number;
  strategicScore?: number;
  acquisitionScore?: number;
  overallActionableScore?: number;
}

interface AttorneyRecord {
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;
  affiliate: string;
  years_remaining: number;
  is_expired: boolean;
  forward_citations: number;
  competitor_citations: number;
  non_competitor_citations: number;  // NEW: forward - competitor
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
  super_sector: string;
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

  // Scores
  licensing_score: number | null;
  litigation_score: number | null;
  strategic_score: number | null;
  acquisition_score: number | null;
  overall_score: number | null;

  // Data availability flags
  has_citation_analysis: boolean;  // Whether patent went through citation overlap
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
  console.log('Merge Full Portfolio for Attorney Export');
  console.log('============================================================\n');

  // Load affiliate config
  loadAffiliateConfig();

  // Load broadcom-portfolio (full 22K+ patents)
  const portfolioPath = findLatestFile('output', 'broadcom-portfolio-2026');
  if (!portfolioPath) {
    console.error('ERROR: Could not find broadcom-portfolio file');
    process.exit(1);
  }
  const portfolioData = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
  console.log(`Loaded ${portfolioData.patents.length} patents from full portfolio`);

  // Load multi-score-analysis (processed patents with citations)
  const msaPath = findLatestFile('output', 'multi-score-analysis-');
  if (!msaPath) {
    console.error('ERROR: Could not find multi-score-analysis file');
    process.exit(1);
  }
  const msaData = JSON.parse(fs.readFileSync(msaPath, 'utf-8'));
  console.log(`Loaded ${msaData.patents.length} patents from multi-score-analysis`);

  // Build MSA lookup
  const msaMap = new Map<string, MSAPatent>();
  for (const p of msaData.patents) {
    msaMap.set(p.patent_id, p);
  }

  // Load LLM analysis (v1 + v3)
  const llmMap = new Map<string, any>();
  const v1Files = findFiles('output/llm-analysis', 'combined-rankings-');
  for (const file of v1Files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const records = data.records || data.analyses || [];
      for (const r of records) {
        if (r.patent_id && !llmMap.has(r.patent_id)) {
          llmMap.set(r.patent_id, r);
        }
      }
    } catch (e) { /* skip */ }
  }

  // Load LLM v3 (overrides v1)
  const v3Files = findFiles('output/llm-analysis-v3', 'combined-v3-');
  for (const file of v3Files) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const records = data.analyses || data.records || [];
      for (const r of records) {
        if (r.patent_id) {
          llmMap.set(r.patent_id, { ...llmMap.get(r.patent_id), ...r });
        }
      }
    } catch (e) { /* skip */ }
  }

  // Load VMware LLM
  const vmwareLLMFiles = findFiles('output/vmware-llm-analysis', 'combined-vmware-llm-');
  for (const file of vmwareLLMFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const records = data.analyses || data.records || [];
      for (const r of records) {
        if (r.patent_id && !llmMap.has(r.patent_id)) {
          llmMap.set(r.patent_id, r);
        }
      }
    } catch (e) { /* skip */ }
  }
  console.log(`Loaded LLM analysis for ${llmMap.size} patents`);

  // Load sector assignments - prefer comprehensive assignments file
  const sectorAssignments = new Map<string, any>();
  const comprehensiveSectorFile = 'output/patent-sector-assignments.json';
  const legacySectorFile = findLatestFile('output/sectors', 'all-patents-sectors-v2-');

  if (fs.existsSync(comprehensiveSectorFile)) {
    const data = JSON.parse(fs.readFileSync(comprehensiveSectorFile, 'utf-8'));
    for (const [patentId, info] of Object.entries(data)) {
      sectorAssignments.set(patentId, info as any);
    }
    console.log(`Loaded sector assignments for ${sectorAssignments.size} patents`);
  } else if (legacySectorFile) {
    const data = JSON.parse(fs.readFileSync(legacySectorFile, 'utf-8'));
    for (const [patentId, info] of Object.entries(data.assignments || {})) {
      sectorAssignments.set(patentId, info as any);
    }
    console.log(`Loaded legacy sector assignments for ${sectorAssignments.size} patents`);
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

  // Build combined records - iterate over FULL portfolio
  const records: AttorneyRecord[] = [];
  let fromMSA = 0;
  let fromPortfolioOnly = 0;

  for (const p of portfolioData.patents as PortfolioPatent[]) {
    const patentId = p.patent_id;
    const msa = msaMap.get(patentId);
    const llm = llmMap.get(patentId) || {};
    const sectorInfo = sectorAssignments.get(patentId) || {};
    const ipr = iprMap.get(patentId) || {};
    const pros = prosMap.get(patentId) || {};

    // Get assignee from portfolio or MSA
    const assignee = msa?.assignee || p.assignees?.[0]?.assignee_organization || 'Unknown';

    // Calculate years remaining
    const grantDate = msa?.date || p.patent_date;
    const yearsRemaining = calculateYearsRemaining(grantDate);
    const isExpired = yearsRemaining <= 0;

    // Get CPC codes
    let cpcCodes: string[] = [];
    if (msa?.cpc_codes) {
      cpcCodes = msa.cpc_codes;
    } else if (p.cpc_current) {
      cpcCodes = p.cpc_current
        .filter(c => c.cpc_group_id || c.cpc_subclass_id)
        .map(c => c.cpc_group_id || c.cpc_subclass_id || '')
        .filter(c => c);
    }

    // Forward citations and competitor citations
    const forwardCitations = msa?.forward_citations ?? p.patent_num_times_cited_by_us_patents ?? 0;
    const competitorCitations = msa?.competitor_citations ?? 0;
    const nonCompetitorCitations = Math.max(0, forwardCitations - competitorCitations);

    // Sector info
    const sector = sectorInfo.sector || msa?.sector || '';
    const superSector = sectorInfo.superSector || msa?.superSector || '';

    const record: AttorneyRecord = {
      patent_id: patentId,
      title: clean(msa?.title || p.patent_title),
      grant_date: grantDate,
      assignee: clean(assignee),
      affiliate: normalizeAffiliate(assignee),
      years_remaining: round(yearsRemaining, 1),
      is_expired: isExpired,
      forward_citations: forwardCitations,
      competitor_citations: competitorCitations,
      non_competitor_citations: nonCompetitorCitations,
      competitors_citing: (msa?.competitors || []).join('; '),

      // Attorney Questions
      eligibility_score: llm.eligibility_score || null,
      validity_score: llm.validity_score || null,
      summary: clean(llm.summary || ''),
      prior_art_problem: clean(llm.prior_art_problem || ''),
      technical_solution: clean(llm.technical_solution || ''),

      // Additional LLM
      claim_breadth: llm.claim_breadth || null,
      enforcement_clarity: llm.enforcement_clarity || null,
      design_around_difficulty: llm.design_around_difficulty || null,
      llm_confidence: llm.confidence || null,

      // Classification
      sector: sector,
      super_sector: superSector,
      technology_category: llm.technology_category || '',
      cpc_primary: cpcCodes.length > 0 ? cpcCodes[0] : '',
      cpc_codes: cpcCodes.slice(0, 5).join('; '),

      // Risk/Quality
      ipr_risk_score: ipr.ipr_risk_score || null,
      ipr_risk_category: ipr.ipr_risk_category || '',
      prosecution_quality_score: pros.prosecution_quality_score || null,
      prosecution_quality_category: pros.prosecution_quality_category || '',

      // Product/Market
      product_types: (llm.product_types || []).slice(0, 5).join('; '),
      likely_implementers: (llm.likely_implementers || []).slice(0, 5).join('; '),
      detection_method: clean(llm.detection_method || ''),

      // Scores (from MSA)
      licensing_score: msa?.licensingScore || null,
      litigation_score: msa?.litigationScore || null,
      strategic_score: msa?.strategicScore || null,
      acquisition_score: msa?.acquisitionScore || null,
      overall_score: msa?.overallActionableScore || null,

      // Flags
      has_citation_analysis: !!msa,
      has_llm_analysis: !!llm.eligibility_score,
      has_ipr_data: !!ipr.ipr_risk_score,
      has_prosecution_data: !!pros.prosecution_quality_score,
    };

    records.push(record);

    if (msa) {
      fromMSA++;
    } else {
      fromPortfolioOnly++;
    }
  }

  // Track which patents we've already processed
  const processedPatentIds = new Set(records.map(r => r.patent_id));

  // Add patents from multi-score-analysis that aren't in broadcom-portfolio
  // (This handles VMware and other patents added after original portfolio export)
  let fromMSAOnly = 0;
  for (const msa of msaData.patents as MSAPatent[]) {
    if (processedPatentIds.has(msa.patent_id)) continue;

    const patentId = msa.patent_id;
    const llm = llmMap.get(patentId) || {};
    const sectorInfo = sectorAssignments.get(patentId) || {};
    const ipr = iprMap.get(patentId) || {};
    const pros = prosMap.get(patentId) || {};

    const assignee = msa.assignee || 'Unknown';
    const grantDate = msa.date || msa.grant_date || '';
    const yearsRemaining = msa.remaining_years ?? (grantDate ? calculateYearsRemaining(grantDate) : 0);
    const isExpired = yearsRemaining <= 0;

    const cpcCodes = msa.cpc_codes || [];

    const sector = sectorInfo.sector || msa.sector || '';
    const superSector = sectorInfo.superSector || msa.superSector || '';

    const record: AttorneyRecord = {
      patent_id: patentId,
      title: clean(msa.title || ''),
      grant_date: grantDate,
      assignee: clean(assignee),
      affiliate: normalizeAffiliate(assignee),
      years_remaining: round(yearsRemaining, 1),
      is_expired: isExpired,
      forward_citations: msa.forward_citations || 0,
      competitor_citations: msa.competitor_citations || 0,
      non_competitor_citations: Math.max(0, (msa.forward_citations || 0) - (msa.competitor_citations || 0)),
      competitors_citing: (msa.competitors || []).join('; '),

      // Attorney Questions
      eligibility_score: llm.eligibility_score || null,
      validity_score: llm.validity_score || null,
      summary: clean(llm.summary || ''),
      prior_art_problem: clean(llm.prior_art_problem || ''),
      technical_solution: clean(llm.technical_solution || ''),

      // Additional LLM
      claim_breadth: llm.claim_breadth || null,
      enforcement_clarity: llm.enforcement_clarity || null,
      design_around_difficulty: llm.design_around_difficulty || null,
      llm_confidence: llm.confidence || null,

      // Classification
      sector: sector,
      super_sector: superSector,
      technology_category: llm.technology_category || '',
      cpc_primary: cpcCodes.length > 0 ? cpcCodes[0] : '',
      cpc_codes: cpcCodes.slice(0, 5).join('; '),

      // Risk/Quality
      ipr_risk_score: ipr.ipr_risk_score || null,
      ipr_risk_category: ipr.ipr_risk_category || '',
      prosecution_quality_score: pros.prosecution_quality_score || null,
      prosecution_quality_category: pros.prosecution_quality_category || '',

      // Product/Market
      product_types: (llm.product_types || []).slice(0, 5).join('; '),
      likely_implementers: (llm.likely_implementers || []).slice(0, 5).join('; '),
      detection_method: clean(llm.detection_method || ''),

      // Scores (from MSA)
      licensing_score: msa.licensingScore || null,
      litigation_score: msa.litigationScore || null,
      strategic_score: msa.strategicScore || null,
      acquisition_score: msa.acquisitionScore || null,
      overall_score: msa.overallActionableScore || null,

      // Flags
      has_citation_analysis: true,
      has_llm_analysis: !!llm.eligibility_score,
      has_ipr_data: !!ipr.ipr_risk_score,
      has_prosecution_data: !!pros.prosecution_quality_score,
    };

    records.push(record);
    fromMSAOnly++;
  }

  console.log(`\nRecord sources:`);
  console.log(`  From multi-score-analysis: ${fromMSA}`);
  console.log(`  Portfolio-only (no citation analysis): ${fromPortfolioOnly}`);
  console.log(`  MSA-only (e.g., VMware): ${fromMSAOnly}`);

  // Sort by competitor citations (descending), then forward citations
  records.sort((a, b) => {
    if (b.competitor_citations !== a.competitor_citations) {
      return b.competitor_citations - a.competitor_citations;
    }
    return b.forward_citations - a.forward_citations;
  });

  // Write main CSV
  const headers = [
    'patent_id', 'title', 'grant_date', 'assignee', 'affiliate', 'years_remaining', 'is_expired',
    'forward_citations', 'competitor_citations', 'non_competitor_citations', 'competitors_citing',
    'eligibility_score', 'validity_score', 'summary', 'prior_art_problem', 'technical_solution',
    'claim_breadth', 'enforcement_clarity', 'design_around_difficulty', 'llm_confidence',
    'sector', 'super_sector', 'technology_category', 'cpc_primary', 'cpc_codes',
    'ipr_risk_score', 'ipr_risk_category', 'prosecution_quality_score', 'prosecution_quality_category',
    'product_types', 'likely_implementers', 'detection_method',
    'licensing_score', 'litigation_score', 'strategic_score', 'acquisition_score', 'overall_score',
    'has_citation_analysis', 'has_llm_analysis', 'has_ipr_data', 'has_prosecution_data'
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

  // Output paths
  const outputPath = `output/ATTORNEY-PORTFOLIO-${dateStamp}.csv`;
  const latestPath = 'output/ATTORNEY-PORTFOLIO-LATEST.csv';
  fs.writeFileSync(outputPath, rows.join('\n'));
  fs.writeFileSync(latestPath, rows.join('\n'));

  console.log(`\nExported ${records.length} patents (full portfolio)`);
  console.log(`  Output: ${outputPath}`);
  console.log(`  Latest: ${latestPath}`);

  // Generate aggregations JSON
  const aggregations = generateAggregations(records);
  const aggPath = `output/ATTORNEY-PORTFOLIO-AGGREGATIONS-${dateStamp}.json`;
  fs.writeFileSync(aggPath, JSON.stringify(aggregations, null, 2));
  console.log(`  Aggregations: ${aggPath}`);

  // Summary stats
  const withCitations = records.filter(r => r.has_citation_analysis).length;
  const withLLM = records.filter(r => r.has_llm_analysis).length;
  const withCompCites = records.filter(r => r.competitor_citations > 0).length;
  const expired = records.filter(r => r.is_expired).length;
  const active = records.length - expired;

  console.log(`\nPortfolio Status:`);
  console.log(`  Total patents: ${records.length}`);
  console.log(`  Active patents: ${active}`);
  console.log(`  Expired patents: ${expired}`);

  console.log(`\nData Coverage:`);
  console.log(`  With citation analysis: ${withCitations}`);
  console.log(`  With competitor citations: ${withCompCites}`);
  console.log(`  With LLM analysis: ${withLLM}`);
  console.log(`  Portfolio-only (basic data): ${fromPortfolioOnly}`);

  // Print affiliate breakdown
  console.log(`\nAffiliate Breakdown:`);
  for (const [affiliate, data] of Object.entries(aggregations.byAffiliate)) {
    const d = data as any;
    console.log(`  ${affiliate}: ${d.total} (${d.active} active, ${d.withCitations} with citations)`);
  }

  console.log('\n============================================================');
  console.log('Full Portfolio Attorney Export Complete');
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
    withCitationAnalysis: number;
    withCompetitorCitations: number;
    withLLMAnalysis: number;
  };
  byAffiliate: Record<string, { total: number; active: number; expired: number; withCitations: number }>;
  bySector: Record<string, { total: number; active: number; expired: number; withCitations: number }>;
  byCpcClass: Record<string, { total: number; active: number; expired: number }>;
  expirationTimeline: Record<string, number>;
}

function generateAggregations(records: AttorneyRecord[]): AggregationData {
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

    // By CPC Class (first 4 chars)
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
      withCitationAnalysis: records.filter(r => r.has_citation_analysis).length,
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

function calculateYearsRemaining(grantDate: string): number {
  if (!grantDate) return 0;
  const grant = new Date(grantDate);
  const expiration = new Date(grant);
  expiration.setFullYear(expiration.getFullYear() + 20);
  const now = new Date();
  const msRemaining = expiration.getTime() - now.getTime();
  return msRemaining / (365.25 * 24 * 60 * 60 * 1000);
}

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
  if (n === undefined || n === null || isNaN(n)) return 0;
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
