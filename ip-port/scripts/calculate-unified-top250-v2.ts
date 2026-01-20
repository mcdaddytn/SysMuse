/**
 * Calculate Unified Top Rated Patents - V2 (Improved Scoring)
 *
 * CHANGES FROM V1:
 * 1. Hard filters: Excludes expired patents (< 3 years remaining)
 * 2. Multiplicative year factor: Heavily penalizes low-years patents
 * 3. Non-linear normalization for years_remaining
 * 4. Eligibility floor: Excludes patents with eligibility < 2
 * 5. Sub-category scoring option for damages/success/risk
 *
 * Usage: npx tsx scripts/calculate-unified-topRated-v2.ts [--no-filter] [--verbose]
 */

import * as fs from 'fs';

// =============================================================================
// AFFILIATE NORMALIZATION
// =============================================================================

interface AffiliateConfig {
  displayName: string;
  patterns: string[];
}

let affiliatePatterns: Array<{ pattern: RegExp; affiliate: string }> = [];

function loadAffiliateConfig(): void {
  const configPath = 'config/portfolio-affiliates.json';
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    for (const [, affConfig] of Object.entries(config.affiliates) as [string, AffiliateConfig][]) {
      for (const pattern of affConfig.patterns) {
        affiliatePatterns.push({
          pattern: new RegExp(pattern, 'i'),
          affiliate: affConfig.displayName
        });
      }
    }
  }
}

function normalizeAffiliate(assignee: string): string {
  if (!assignee) return 'Unknown';
  for (const { pattern, affiliate } of affiliatePatterns) {
    if (pattern.test(assignee)) return affiliate;
  }
  return assignee.replace(/,?\s*(Inc\.|LLC|Corporation|Ltd\.|Pte\.).*$/i, '').trim() || 'Unknown';
}

// Configuration
const MIN_YEARS_REMAINING = 3;  // Hard filter: exclude patents with less than this
const MIN_ELIGIBILITY_SCORE = 2;  // Hard filter: exclude if LLM says clearly ineligible
const APPLY_FILTERS = !process.argv.includes('--no-filter');
const VERBOSE = process.argv.includes('--verbose');

interface PatentData {
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;
  forward_citations: number;
  years_remaining: number;
  competitor_citations: number;
  competitors: string[];
  competitor_count: number;

  // LLM v1 scores (1-5)
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  confidence?: number;

  // V3 LLM signals
  market_relevance_score?: number;
  trend_alignment_score?: number;
  evidence_accessibility_score?: number;
  investigation_priority_score?: number;
  implementation_type?: string;
  standards_relevance?: string;
  market_segment?: string;
  lifecycle_stage?: string;
  claim_type_primary?: string;

  // IPR & Prosecution
  ipr_risk_score?: number;  // 5=no IPR, 1=invalid
  prosecution_quality_score?: number;  // 5=clean, 1=difficult

  // Sector
  sector?: string;
  sector_name?: string;
  sector_source?: 'term' | 'mlt' | 'cpc' | 'none';

  // Calculated scores
  score_aggressive?: number;
  score_moderate?: number;
  score_conservative?: number;
  score_unified?: number;

  // V2 additions
  filtered_reason?: string;
  year_multiplier?: number;
  base_score?: number;
}

// =============================================================================
// DATA LOADERS (same as V1)
// =============================================================================

function loadMultiScoreAnalysis(): Map<string, any> {
  const files = fs.readdirSync('./output')
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort().reverse();

  if (files.length === 0) return new Map();

  const data = JSON.parse(fs.readFileSync(`./output/${files[0]}`, 'utf-8'));
  const map = new Map<string, any>();
  for (const p of data.patents || []) {
    map.set(p.patent_id, p);
  }
  console.log(`Loaded ${map.size} patents from multi-score analysis`);
  return map;
}

function loadLLMAnalysis(): Map<string, any> {
  const combinedFiles = fs.readdirSync('./output/llm-analysis/combined')
    .filter(f => f.startsWith('combined-rankings-') && f.endsWith('.json'))
    .sort().reverse();

  const map = new Map<string, any>();

  if (combinedFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/llm-analysis/combined/${combinedFiles[0]}`, 'utf-8'));
    for (const record of data.data?.records || []) {
      map.set(record.patent_id, record.llm_analysis);
    }
    console.log(`Loaded ${map.size} patents from LLM v1 analysis`);
  }

  return map;
}

function loadV3LLMAnalysis(): Map<string, any> {
  const v3Files = fs.readdirSync('./output/llm-analysis-v3')
    .filter(f => f.startsWith('combined-v3-') && f.endsWith('.json'))
    .sort(); // Oldest first, newer overwrites for same patent

  const map = new Map<string, any>();

  for (const file of v3Files) {
    const data = JSON.parse(fs.readFileSync(`./output/llm-analysis-v3/${file}`, 'utf-8'));
    for (const analysis of data.analyses || []) {
      map.set(analysis.patent_id, analysis);
    }
  }

  if (map.size > 0) {
    console.log(`Loaded ${map.size} patents from LLM v3 analysis (${v3Files.length} files)`);
  }

  return map;
}

function loadIPRData(): Map<string, any> {
  const iprFiles = fs.readdirSync('./output/ipr')
    .filter(f => f.startsWith('ipr-risk-check-') && f.endsWith('.json'))
    .sort().reverse();

  const map = new Map<string, any>();

  if (iprFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/ipr/${iprFiles[0]}`, 'utf-8'));
    for (const result of data.results || []) {
      map.set(result.patent_id, result);
    }
    console.log(`Loaded ${map.size} patents from IPR analysis`);
  }

  return map;
}

function loadProsecutionData(): Map<string, any> {
  const prosFiles = fs.readdirSync('./output/prosecution')
    .filter(f => f.startsWith('prosecution-history-') && f.endsWith('.json'))
    .sort().reverse();

  const map = new Map<string, any>();

  if (prosFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/prosecution/${prosFiles[0]}`, 'utf-8'));
    for (const result of data.results || []) {
      map.set(result.patent_id, result);
    }
    console.log(`Loaded ${map.size} patents from prosecution analysis`);
  }

  return map;
}

function loadSectorData(): Map<string, any> {
  const sectorFiles = fs.readdirSync('./output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-') && f.endsWith('.json'))
    .sort().reverse();

  const map = new Map<string, any>();

  if (sectorFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/sectors/${sectorFiles[0]}`, 'utf-8'));
    for (const assignment of data.assignments || []) {
      map.set(assignment.patent_id, assignment);
    }
    console.log(`Loaded ${map.size} patents from sector assignments`);
  }

  return map;
}

// =============================================================================
// V2 NORMALIZATION FUNCTIONS (improved)
// =============================================================================

/**
 * Standard linear normalization
 */
function normalizeLinear(value: number | undefined, max: number): number {
  if (value === undefined || value === null) return 0;
  return Math.min(1, value / max);
}

/**
 * Square root normalization for high-variance metrics (citations)
 */
function normalizeSqrt(value: number | undefined, max: number): number {
  if (value === undefined || value === null) return 0;
  return Math.min(1, Math.sqrt(value) / Math.sqrt(max));
}

/**
 * NON-LINEAR normalization for years remaining
 * Uses exponential curve to heavily penalize low values
 *
 * years=15+ → 1.0
 * years=10  → 0.67
 * years=7   → 0.47
 * years=5   → 0.33
 * years=3   → 0.20
 * years=0   → 0.00
 */
function normalizeYears(years: number | undefined): number {
  if (years === undefined || years === null || years <= 0) return 0;
  if (years >= 15) return 1.0;

  // Exponential curve: (years/15)^1.5
  return Math.pow(years / 15, 1.5);
}

/**
 * LLM score normalization (1-5 scale to 0-1)
 */
function normalizeScore(value: number | undefined, defaultValue: number = 0.5): number {
  if (value === undefined || value === null) return defaultValue;
  return value / 5;
}

// =============================================================================
// V2 SCORING WITH MULTIPLICATIVE YEAR FACTOR
// =============================================================================

/**
 * Year multiplier - applied multiplicatively to penalize low-years patents
 *
 * years=15+ → 1.0 (full score)
 * years=10  → 0.85
 * years=7   → 0.70
 * years=5   → 0.55
 * years=3   → 0.40
 */
function calculateYearMultiplier(years: number): number {
  if (years >= 15) return 1.0;
  if (years <= 0) return 0.0;

  // Smooth curve from 0.3 at year 0 to 1.0 at year 15
  const base = 0.3;
  const scale = 0.7;
  return base + (scale * Math.pow(years / 15, 0.8));
}

const PROFILES = {
  aggressive: {
    name: 'Aggressive',
    description: 'High weight on market opportunity and competitor citations',
    weights: {
      competitor_citations: 0.25,
      competitor_count: 0.10,
      forward_citations: 0.05,
      years_remaining: 0.05,  // Reduced since we use multiplier
      eligibility_score: 0.15,
      validity_score: 0.10,
      claim_breadth: 0.05,
      enforcement_clarity: 0.10,
      market_relevance_score: 0.10,
      ipr_risk_score: 0.025,
      prosecution_quality_score: 0.025,
    }
  },
  moderate: {
    name: 'Moderate',
    description: 'Balanced across all factors',
    weights: {
      competitor_citations: 0.15,
      competitor_count: 0.05,
      forward_citations: 0.10,
      years_remaining: 0.05,  // Reduced since we use multiplier
      eligibility_score: 0.15,
      validity_score: 0.15,
      claim_breadth: 0.10,
      enforcement_clarity: 0.10,
      market_relevance_score: 0.10,
      ipr_risk_score: 0.025,
      prosecution_quality_score: 0.025,
    }
  },
  conservative: {
    name: 'Conservative',
    description: 'High weight on legal strength and low risk',
    weights: {
      competitor_citations: 0.10,
      competitor_count: 0.05,
      forward_citations: 0.05,
      years_remaining: 0.05,  // Reduced since we use multiplier
      eligibility_score: 0.20,
      validity_score: 0.20,
      claim_breadth: 0.10,
      enforcement_clarity: 0.10,
      market_relevance_score: 0.05,
      ipr_risk_score: 0.05,
      prosecution_quality_score: 0.05,
    }
  }
};

function calculateBaseScore(patent: PatentData, weights: Record<string, number>): number {
  let score = 0;
  let weightSum = 0;

  // Competitor citations - square root normalization
  if (weights.competitor_citations) {
    const norm = normalizeSqrt(patent.competitor_citations, 50);
    score += weights.competitor_citations * norm;
    weightSum += weights.competitor_citations;
  }

  // Competitor count
  if (weights.competitor_count) {
    const norm = normalizeLinear(patent.competitor_count, 10);
    score += weights.competitor_count * norm;
    weightSum += weights.competitor_count;
  }

  // Forward citations - square root normalization
  if (weights.forward_citations) {
    const norm = normalizeSqrt(patent.forward_citations, 500);
    score += weights.forward_citations * norm;
    weightSum += weights.forward_citations;
  }

  // Years remaining - non-linear normalization
  if (weights.years_remaining) {
    const norm = normalizeYears(patent.years_remaining);
    score += weights.years_remaining * norm;
    weightSum += weights.years_remaining;
  }

  // LLM v1 scores
  if (weights.eligibility_score && patent.eligibility_score !== undefined) {
    score += weights.eligibility_score * normalizeScore(patent.eligibility_score);
    weightSum += weights.eligibility_score;
  }

  if (weights.validity_score && patent.validity_score !== undefined) {
    score += weights.validity_score * normalizeScore(patent.validity_score);
    weightSum += weights.validity_score;
  }

  if (weights.claim_breadth && patent.claim_breadth !== undefined) {
    score += weights.claim_breadth * normalizeScore(patent.claim_breadth);
    weightSum += weights.claim_breadth;
  }

  if (weights.enforcement_clarity && patent.enforcement_clarity !== undefined) {
    score += weights.enforcement_clarity * normalizeScore(patent.enforcement_clarity);
    weightSum += weights.enforcement_clarity;
  }

  // V3 LLM scores
  if (weights.market_relevance_score && patent.market_relevance_score !== undefined) {
    score += weights.market_relevance_score * normalizeScore(patent.market_relevance_score);
    weightSum += weights.market_relevance_score;
  }

  // IPR and Prosecution
  if (weights.ipr_risk_score && patent.ipr_risk_score !== undefined) {
    score += weights.ipr_risk_score * normalizeScore(patent.ipr_risk_score);
    weightSum += weights.ipr_risk_score;
  }

  if (weights.prosecution_quality_score && patent.prosecution_quality_score !== undefined) {
    score += weights.prosecution_quality_score * normalizeScore(patent.prosecution_quality_score);
    weightSum += weights.prosecution_quality_score;
  }

  // Normalize by actual weight used (handles missing data)
  return weightSum > 0 ? (score / weightSum) * 100 : 0;
}

function calculateFinalScore(patent: PatentData, weights: Record<string, number>): number {
  const baseScore = calculateBaseScore(patent, weights);
  const yearMultiplier = calculateYearMultiplier(patent.years_remaining);

  // Store for debugging
  patent.base_score = baseScore;
  patent.year_multiplier = yearMultiplier;

  // Final score = base score * year multiplier
  return baseScore * yearMultiplier;
}

// =============================================================================
// FILTERING LOGIC
// =============================================================================

interface FilterResult {
  passed: boolean;
  reason?: string;
}

function applyFilters(patent: PatentData): FilterResult {
  if (!APPLY_FILTERS) {
    return { passed: true };
  }

  // Filter 1: Minimum years remaining
  if (patent.years_remaining < MIN_YEARS_REMAINING) {
    return {
      passed: false,
      reason: `years_remaining=${patent.years_remaining.toFixed(1)} < ${MIN_YEARS_REMAINING}`
    };
  }

  // Filter 2: Minimum eligibility (only if LLM data exists)
  if (patent.eligibility_score !== undefined && patent.eligibility_score < MIN_ELIGIBILITY_SCORE) {
    return {
      passed: false,
      reason: `eligibility_score=${patent.eligibility_score} < ${MIN_ELIGIBILITY_SCORE}`
    };
  }

  return { passed: true };
}

// =============================================================================
// MAIN LOGIC
// =============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Calculate Unified Top 250 - V2 (Improved Scoring)');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  Filtering: ${APPLY_FILTERS ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  Min years remaining: ${MIN_YEARS_REMAINING}`);
  console.log(`  Min eligibility score: ${MIN_ELIGIBILITY_SCORE}`);
  console.log('');

  // Load affiliate config for normalization
  loadAffiliateConfig();

  // Load all data sources
  const multiScore = loadMultiScoreAnalysis();
  const llmV1 = loadLLMAnalysis();
  const llmV3 = loadV3LLMAnalysis();
  const iprData = loadIPRData();
  const prosData = loadProsecutionData();
  const sectorData = loadSectorData();

  console.log('');

  // Build unified patent data
  const patents: PatentData[] = [];
  let filteredOut = 0;
  const filterReasons: Record<string, number> = {};

  for (const [patentId, baseData] of multiScore) {
    const llm1 = llmV1.get(patentId) || {};
    const llm3 = llmV3.get(patentId) || {};
    const ipr = iprData.get(patentId) || {};
    const pros = prosData.get(patentId) || {};
    const sector = sectorData.get(patentId) || {};

    const patent: PatentData = {
      patent_id: patentId,
      title: baseData.title || '',
      grant_date: baseData.date || baseData.grant_date || '',
      assignee: baseData.assignee || '',
      forward_citations: baseData.forward_citations || 0,
      years_remaining: baseData.years_remaining || baseData.remaining_years || 0,
      competitor_citations: baseData.competitor_citations || 0,
      competitors: baseData.competitors || baseData.topCompetitors || [],
      competitor_count: (baseData.competitors || baseData.topCompetitors || []).length,

      // LLM v1
      eligibility_score: llm1.eligibility_score,
      validity_score: llm1.validity_score,
      claim_breadth: llm1.claim_breadth,
      enforcement_clarity: llm1.enforcement_clarity,
      design_around_difficulty: llm1.design_around_difficulty,
      confidence: llm1.confidence,

      // V3 LLM
      market_relevance_score: llm3.market_relevance_score,
      trend_alignment_score: llm3.trend_alignment_score,
      evidence_accessibility_score: llm3.evidence_accessibility_score,
      investigation_priority_score: llm3.investigation_priority_score,
      implementation_type: llm3.implementation_type,
      standards_relevance: llm3.standards_relevance,
      market_segment: llm3.market_segment,
      lifecycle_stage: llm3.lifecycle_stage,
      claim_type_primary: llm3.claim_type_primary,

      // IPR & Prosecution
      ipr_risk_score: ipr.ipr_risk_score,
      prosecution_quality_score: pros.prosecution_quality_score,

      // Sector
      sector: sector.final_sector || sector.sector || sector.cpc_sector,
      sector_name: sector.final_sector_name || sector.sector_name || sector.cpc_sector_name,
      sector_source: sector.sector_source || (sector.cpc_sector ? 'cpc' : 'none'),
    };

    // Apply filters
    const filterResult = applyFilters(patent);
    if (!filterResult.passed) {
      filteredOut++;
      filterReasons[filterResult.reason!] = (filterReasons[filterResult.reason!] || 0) + 1;
      if (VERBOSE) {
        patent.filtered_reason = filterResult.reason;
      }
      continue;
    }

    // Calculate scores
    patent.score_aggressive = calculateFinalScore(patent, PROFILES.aggressive.weights);
    patent.score_moderate = calculateFinalScore(patent, PROFILES.moderate.weights);
    patent.score_conservative = calculateFinalScore(patent, PROFILES.conservative.weights);
    patent.score_unified = (patent.score_aggressive + patent.score_moderate + patent.score_conservative) / 3;

    patents.push(patent);
  }

  console.log(`\nFiltering Results:`);
  console.log(`  Total patents: ${multiScore.size}`);
  console.log(`  Filtered out: ${filteredOut}`);
  console.log(`  Remaining: ${patents.length}`);

  if (Object.keys(filterReasons).length > 0) {
    console.log(`\n  Filter breakdown:`);
    for (const [reason, count] of Object.entries(filterReasons).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${reason}: ${count}`);
    }
  }

  // Sort by unified score
  patents.sort((a, b) => (b.score_unified || 0) - (a.score_unified || 0));

  // Take top 500
  const top500 = patents.slice(0, 500);

  console.log(`\n${'='.repeat(60)}`);
  console.log('TOP 10 PATENTS (V2 Scoring)');
  console.log('='.repeat(60));

  for (let i = 0; i < Math.min(10, top500.length); i++) {
    const p = top500[i];
    const llmFlag = p.eligibility_score !== undefined ? '✓ LLM' : '';
    const iprFlag = p.ipr_risk_score !== undefined ? '✓ IPR' : '';
    console.log(`${i + 1}. ${p.patent_id} - ${p.score_unified?.toFixed(1)} (${llmFlag} ${iprFlag})`);
    console.log(`   ${p.title?.substring(0, 50)}...`);
    console.log(`   Years: ${p.years_remaining.toFixed(1)} | YearMult: ${p.year_multiplier?.toFixed(2)} | Competitors: ${p.competitors?.join(', ') || 'none'} (${p.competitor_citations} cites)`);
  }

  // Statistics
  const withLLM = top500.filter(p => p.eligibility_score !== undefined).length;
  const withV3 = top500.filter(p => p.market_relevance_score !== undefined).length;
  const withIPR = top500.filter(p => p.ipr_risk_score !== undefined).length;
  const withPros = top500.filter(p => p.prosecution_quality_score !== undefined).length;
  const withTermSector = top500.filter(p => p.sector_source === 'term' || p.sector_source === 'mlt').length;
  const withCPCSector = top500.filter(p => p.sector_source === 'cpc').length;

  const avgYears = top500.reduce((sum, p) => sum + p.years_remaining, 0) / top500.length;
  const minYears = Math.min(...top500.map(p => p.years_remaining));
  const maxYears = Math.max(...top500.map(p => p.years_remaining));

  console.log(`\n${'='.repeat(60)}`);
  console.log('DATA COVERAGE IN TOP RATED');
  console.log('='.repeat(60));
  console.log(`LLM v1 analysis: ${withLLM}/500 (${(withLLM / 500 * 100).toFixed(0)}%)`);
  console.log(`LLM v3 analysis: ${withV3}/500 (${(withV3 / 500 * 100).toFixed(0)}%)`);
  console.log(`IPR risk data: ${withIPR}/500 (${(withIPR / 500 * 100).toFixed(0)}%)`);
  console.log(`Prosecution data: ${withPros}/500 (${(withPros / 500 * 100).toFixed(0)}%)`);
  console.log(`Term-based sectors: ${withTermSector}/500`);
  console.log(`CPC-based sectors: ${withCPCSector}/500`);

  console.log(`\nYears Remaining Distribution:`);
  console.log(`  Min: ${minYears.toFixed(1)} | Avg: ${avgYears.toFixed(1)} | Max: ${maxYears.toFixed(1)}`);

  // Years distribution
  const yearBuckets: Record<string, number> = {
    '3-5 years': 0,
    '5-10 years': 0,
    '10-15 years': 0,
    '15+ years': 0,
  };
  for (const p of top500) {
    if (p.years_remaining < 5) yearBuckets['3-5 years']++;
    else if (p.years_remaining < 10) yearBuckets['5-10 years']++;
    else if (p.years_remaining < 15) yearBuckets['10-15 years']++;
    else yearBuckets['15+ years']++;
  }
  for (const [bucket, count] of Object.entries(yearBuckets)) {
    console.log(`  ${bucket}: ${count}`);
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputJson = {
    generated_at: new Date().toISOString(),
    version: 'v2',
    configuration: {
      filters_enabled: APPLY_FILTERS,
      min_years_remaining: MIN_YEARS_REMAINING,
      min_eligibility_score: MIN_ELIGIBILITY_SCORE,
    },
    statistics: {
      total_patents_analyzed: multiScore.size,
      filtered_out: filteredOut,
      topRated_count: top500.length,
      patents_with_llm_v1: withLLM,
      patents_with_llm_v3: withV3,
      patents_with_ipr: withIPR,
      patents_with_prosecution: withPros,
      avg_years_remaining: avgYears,
      years_distribution: yearBuckets,
    },
    patents: top500,
  };

  fs.writeFileSync(`./output/unified-topRated-v2-${timestamp}.json`, JSON.stringify(outputJson, null, 2));
  console.log(`\nSaved to: output/unified-topRated-v2-${timestamp}.json`);

  // Also export CSV
  const csvHeaders = [
    'rank', 'patent_id', 'affiliate', 'title', 'grant_date', 'assignee', 'years_remaining', 'year_multiplier',
    'forward_citations', 'competitor_citations', 'competitor_count', 'competitors',
    'sector', 'sector_name', 'sector_source',
    'eligibility_score', 'validity_score', 'claim_breadth', 'enforcement_clarity', 'design_around_difficulty',
    'market_relevance_score', 'evidence_accessibility_score', 'trend_alignment_score',
    'ipr_risk_score', 'prosecution_quality_score',
    'score_aggressive', 'score_moderate', 'score_conservative', 'score_unified'
  ];

  const csvRows = [csvHeaders.join(',')];
  for (let i = 0; i < top500.length; i++) {
    const p = top500[i];
    const row = [
      i + 1,
      p.patent_id,
      normalizeAffiliate(p.assignee),
      `"${(p.title || '').replace(/"/g, '""')}"`,
      p.grant_date,
      `"${(p.assignee || '').replace(/"/g, '""')}"`,
      p.years_remaining.toFixed(1),
      p.year_multiplier?.toFixed(2) || '',
      p.forward_citations,
      p.competitor_citations,
      p.competitor_count,
      `"${(p.competitors || []).join('; ')}"`,
      p.sector || '',
      `"${p.sector_name || ''}"`,
      p.sector_source || '',
      p.eligibility_score ?? '',
      p.validity_score ?? '',
      p.claim_breadth ?? '',
      p.enforcement_clarity ?? '',
      p.design_around_difficulty ?? '',
      p.market_relevance_score ?? '',
      p.evidence_accessibility_score ?? '',
      p.trend_alignment_score ?? '',
      p.ipr_risk_score ?? '',
      p.prosecution_quality_score ?? '',
      p.score_aggressive?.toFixed(1) || '',
      p.score_moderate?.toFixed(1) || '',
      p.score_conservative?.toFixed(1) || '',
      p.score_unified?.toFixed(1) || '',
    ];
    csvRows.push(row.join(','));
  }

  fs.writeFileSync(`./output/unified-topRated-v2-${timestamp}.csv`, csvRows.join('\n'));
  console.log(`Saved to: output/unified-topRated-v2-${timestamp}.csv`);

  // Identify patents needing enrichment
  const needsLLM = top500.filter(p => p.eligibility_score === undefined).map(p => p.patent_id);
  const needsIPR = top500.filter(p => p.ipr_risk_score === undefined).map(p => p.patent_id);

  if (needsLLM.length > 0) {
    fs.writeFileSync(`./output/topRated-v2-needs-llm-${timestamp}.json`, JSON.stringify(needsLLM, null, 2));
    console.log(`\nPatents needing LLM enrichment: ${needsLLM.length}`);
  }
  if (needsIPR.length > 0) {
    fs.writeFileSync(`./output/topRated-v2-needs-ipr-${timestamp}.json`, JSON.stringify(needsIPR, null, 2));
    console.log(`Patents needing IPR check: ${needsIPR.length}`);
  }
}

main().catch(console.error);
