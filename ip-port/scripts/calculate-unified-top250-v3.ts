/**
 * Calculate Unified Top 250 Patents - V3 (Three-Factor Model)
 *
 * V3 SCORING MODEL:
 *   PatentValue = DamagesScore × SuccessScore × RiskFactor × YearMultiplier
 *
 * Where:
 *   - DamagesScore: Potential monetary value if successful (sector + citations + market)
 *   - SuccessScore: Probability of winning/surviving challenges (eligibility + validity + claims)
 *   - RiskFactor: What could reduce recovery (IPR risk + design-around + enforcement)
 *   - YearMultiplier: Time value adjustment for remaining patent term
 *
 * Usage: npx tsx scripts/calculate-unified-top250-v3.ts [--no-filter] [--verbose]
 */

import * as fs from 'fs';

// Configuration
const MIN_YEARS_REMAINING = 3;
const MIN_ELIGIBILITY_SCORE = 2;
const APPLY_FILTERS = !process.argv.includes('--no-filter');
const VERBOSE = process.argv.includes('--verbose');

// =============================================================================
// TYPES
// =============================================================================

interface SectorDamages {
  damages_rating: number;
  label: string;
  description: string;
  rationale: string;
  annual_market_size: string;
  typical_damages_range: string;
}

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

  // IPR & Prosecution
  ipr_risk_score?: number;
  prosecution_quality_score?: number;

  // Sector
  sector?: string;
  sector_name?: string;
  sector_source?: 'term' | 'mlt' | 'cpc' | 'none';

  // V3 Three-Factor Scores
  damages_score?: number;
  success_score?: number;
  risk_factor?: number;
  year_multiplier?: number;
  v3_score?: number;

  // Legacy scores for comparison
  score_unified_v2?: number;

  filtered_reason?: string;
}

// =============================================================================
// DATA LOADERS
// =============================================================================

function loadSectorDamages(): Map<string, SectorDamages> {
  const configPath = './config/sector-damages.json';
  if (!fs.existsSync(configPath)) {
    console.warn('Warning: sector-damages.json not found, using defaults');
    return new Map();
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const map = new Map<string, SectorDamages>();
  for (const [sectorId, sectorData] of Object.entries(config.sectors || {})) {
    map.set(sectorId, sectorData as SectorDamages);
  }
  console.log(`Loaded ${map.size} sector damages configurations`);
  return map;
}

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
    // Handle both formats: data.records (new) and data.data.records (legacy)
    const records = data.records || data.data?.records || [];
    for (const record of records) {
      // Extract LLM scores from record - they may be at top level with llm_ prefix
      const llmData = {
        eligibility_score: record.llm_eligibility_score,
        validity_score: record.llm_validity_score,
        claim_breadth: record.llm_claim_breadth,
        enforcement_clarity: record.llm_enforcement_clarity,
        design_around_difficulty: record.llm_design_around_difficulty,
        confidence: record.llm_confidence,
      };
      map.set(record.patent_id, llmData);
    }
    console.log(`Loaded ${map.size} patents from LLM v1 analysis`);
  }

  return map;
}

function loadV3LLMAnalysis(): Map<string, any> {
  if (!fs.existsSync('./output/llm-analysis-v3')) return new Map();

  const v3Files = fs.readdirSync('./output/llm-analysis-v3')
    .filter(f => f.startsWith('combined-v3-') && f.endsWith('.json'))
    .sort().reverse();

  const map = new Map<string, any>();

  if (v3Files.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/llm-analysis-v3/${v3Files[0]}`, 'utf-8'));
    for (const analysis of data.analyses || []) {
      map.set(analysis.patent_id, analysis);
    }
    console.log(`Loaded ${map.size} patents from LLM v3 analysis`);
  }

  return map;
}

function loadIPRData(): Map<string, any> {
  if (!fs.existsSync('./output/ipr')) return new Map();

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
  if (!fs.existsSync('./output/prosecution')) return new Map();

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
  if (!fs.existsSync('./output/sectors')) return new Map();

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
// V3 THREE-FACTOR SCORING
// =============================================================================

/**
 * Calculate DAMAGES SCORE (0-100)
 * "How much could this patent be worth if we win?"
 *
 * Components:
 * - Sector damages rating (40%): Order of magnitude potential
 * - Competitor citations (25%): More citations = more infringing companies
 * - Market relevance (20%): Current market activity (LLM)
 * - Forward citations (15%): Technology importance indicator
 */
function calculateDamagesScore(
  patent: PatentData,
  sectorDamages: Map<string, SectorDamages>
): number {
  const weights = {
    sector_damages: 0.40,
    competitor_citations: 0.25,
    market_relevance: 0.20,
    forward_citations: 0.15,
  };

  let score = 0;
  let weightSum = 0;

  // Sector damages rating (1-4 scale → 0.25-1.0)
  const sector = sectorDamages.get(patent.sector || 'general');
  const damagesRating = sector?.damages_rating || 1;
  const normalizedSectorDamages = damagesRating / 4; // 1→0.25, 2→0.5, 3→0.75, 4→1.0
  score += weights.sector_damages * normalizedSectorDamages;
  weightSum += weights.sector_damages;

  // Competitor citations (sqrt normalization for diminishing returns)
  const citationsNorm = Math.min(1, Math.sqrt(patent.competitor_citations) / Math.sqrt(50));
  score += weights.competitor_citations * citationsNorm;
  weightSum += weights.competitor_citations;

  // Market relevance (LLM score if available)
  if (patent.market_relevance_score !== undefined) {
    const marketNorm = patent.market_relevance_score / 5;
    score += weights.market_relevance * marketNorm;
    weightSum += weights.market_relevance;
  }

  // Forward citations (sqrt normalization)
  const fwdCitationsNorm = Math.min(1, Math.sqrt(patent.forward_citations) / Math.sqrt(500));
  score += weights.forward_citations * fwdCitationsNorm;
  weightSum += weights.forward_citations;

  return weightSum > 0 ? (score / weightSum) * 100 : 0;
}

/**
 * Calculate SUCCESS SCORE (0-1.0)
 * "How likely are we to win/survive challenges?"
 *
 * Components:
 * - Eligibility score (30%): 101 patent eligibility
 * - Validity score (30%): Prior art strength
 * - Claim breadth (20%): Scope of claims
 * - Prosecution quality (20%): Clean prosecution history
 */
function calculateSuccessScore(patent: PatentData): number {
  const weights = {
    eligibility_score: 0.30,
    validity_score: 0.30,
    claim_breadth: 0.20,
    prosecution_quality: 0.20,
  };

  let score = 0;
  let weightSum = 0;

  // Eligibility (1-5 → 0-1)
  if (patent.eligibility_score !== undefined) {
    score += weights.eligibility_score * (patent.eligibility_score / 5);
    weightSum += weights.eligibility_score;
  }

  // Validity (1-5 → 0-1)
  if (patent.validity_score !== undefined) {
    score += weights.validity_score * (patent.validity_score / 5);
    weightSum += weights.validity_score;
  }

  // Claim breadth (1-5 → 0-1)
  if (patent.claim_breadth !== undefined) {
    score += weights.claim_breadth * (patent.claim_breadth / 5);
    weightSum += weights.claim_breadth;
  }

  // Prosecution quality (1-5 → 0-1)
  if (patent.prosecution_quality_score !== undefined) {
    score += weights.prosecution_quality * (patent.prosecution_quality_score / 5);
    weightSum += weights.prosecution_quality;
  }

  // If no LLM data, use neutral 0.5
  if (weightSum === 0) {
    return 0.5;
  }

  return score / weightSum;
}

/**
 * Calculate RISK FACTOR (0-1.0)
 * "What could reduce our recovery?"
 *
 * Higher = lower risk = better
 *
 * Components:
 * - IPR risk score (35%): PTAB challenge history/likelihood
 * - Design-around difficulty (30%): Can infringers easily avoid?
 * - Enforcement clarity (35%): Can we prove infringement?
 */
function calculateRiskFactor(patent: PatentData): number {
  const weights = {
    ipr_risk: 0.35,
    design_around_difficulty: 0.30,
    enforcement_clarity: 0.35,
  };

  let score = 0;
  let weightSum = 0;

  // IPR risk (higher = less risky = better)
  if (patent.ipr_risk_score !== undefined) {
    score += weights.ipr_risk * (patent.ipr_risk_score / 5);
    weightSum += weights.ipr_risk;
  }

  // Design-around difficulty (higher = harder to avoid = better for patent holder)
  if (patent.design_around_difficulty !== undefined) {
    score += weights.design_around_difficulty * (patent.design_around_difficulty / 5);
    weightSum += weights.design_around_difficulty;
  }

  // Enforcement clarity (higher = easier to prove = better)
  if (patent.enforcement_clarity !== undefined) {
    score += weights.enforcement_clarity * (patent.enforcement_clarity / 5);
    weightSum += weights.enforcement_clarity;
  }

  // If no data, use neutral 0.6 (slightly optimistic)
  if (weightSum === 0) {
    return 0.6;
  }

  return score / weightSum;
}

/**
 * Calculate YEAR MULTIPLIER (0-1.0)
 * Years remaining directly affect potential damages recovery period
 *
 * years=15+ → 1.0 (full potential)
 * years=10  → 0.85
 * years=7   → 0.70
 * years=5   → 0.55
 * years=3   → 0.40
 * years=0   → 0.0
 */
function calculateYearMultiplier(years: number): number {
  if (years >= 15) return 1.0;
  if (years <= 0) return 0.0;

  // Smooth curve: base 0.3, scales up to 1.0 at 15 years
  const base = 0.3;
  const scale = 0.7;
  return base + (scale * Math.pow(years / 15, 0.8));
}

/**
 * Calculate final V3 score using multiplicative model
 *
 * V3Score = DamagesScore × SuccessScore × RiskFactor × YearMultiplier
 */
function calculateV3Score(
  patent: PatentData,
  sectorDamages: Map<string, SectorDamages>
): number {
  const damagesScore = calculateDamagesScore(patent, sectorDamages);
  const successScore = calculateSuccessScore(patent);
  const riskFactor = calculateRiskFactor(patent);
  const yearMultiplier = calculateYearMultiplier(patent.years_remaining);

  // Store components for analysis
  patent.damages_score = damagesScore;
  patent.success_score = successScore;
  patent.risk_factor = riskFactor;
  patent.year_multiplier = yearMultiplier;

  // Multiplicative model: each factor can reduce the final score
  // Scale so max possible is ~100
  return damagesScore * successScore * riskFactor * yearMultiplier;
}

// =============================================================================
// FILTERING
// =============================================================================

interface FilterResult {
  passed: boolean;
  reason?: string;
}

function applyFilters(patent: PatentData): FilterResult {
  if (!APPLY_FILTERS) {
    return { passed: true };
  }

  if (patent.years_remaining < MIN_YEARS_REMAINING) {
    return {
      passed: false,
      reason: `years_remaining=${patent.years_remaining.toFixed(1)} < ${MIN_YEARS_REMAINING}`
    };
  }

  if (patent.eligibility_score !== undefined && patent.eligibility_score < MIN_ELIGIBILITY_SCORE) {
    return {
      passed: false,
      reason: `eligibility_score=${patent.eligibility_score} < ${MIN_ELIGIBILITY_SCORE}`
    };
  }

  return { passed: true };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('Calculate Unified Top 250 - V3 (Three-Factor Model)');
  console.log('Formula: PatentValue = Damages × Success × Risk × YearMultiplier');
  console.log('='.repeat(70));
  console.log(`\nConfiguration:`);
  console.log(`  Filtering: ${APPLY_FILTERS ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  Min years remaining: ${MIN_YEARS_REMAINING}`);
  console.log(`  Min eligibility score: ${MIN_ELIGIBILITY_SCORE}`);
  console.log('');

  // Load all data sources
  const sectorDamages = loadSectorDamages();
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

      // IPR & Prosecution
      ipr_risk_score: ipr.ipr_risk_score,
      prosecution_quality_score: pros.prosecution_quality_score,

      // Sector
      sector: sector.final_sector || sector.sector || sector.cpc_sector || 'general',
      sector_name: sector.final_sector_name || sector.sector_name || sector.cpc_sector_name,
      sector_source: sector.sector_source || (sector.cpc_sector ? 'cpc' : 'none'),
    };

    // Apply filters
    const filterResult = applyFilters(patent);
    if (!filterResult.passed) {
      filteredOut++;
      filterReasons[filterResult.reason!] = (filterReasons[filterResult.reason!] || 0) + 1;
      continue;
    }

    // Calculate V3 score
    patent.v3_score = calculateV3Score(patent, sectorDamages);

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

  // Sort by V3 score
  patents.sort((a, b) => (b.v3_score || 0) - (a.v3_score || 0));

  // Take top 250
  const top250 = patents.slice(0, 250);

  console.log(`\n${'='.repeat(70)}`);
  console.log('TOP 10 PATENTS (V3 Three-Factor Scoring)');
  console.log('='.repeat(70));

  for (let i = 0; i < Math.min(10, top250.length); i++) {
    const p = top250[i];
    const llmFlag = p.eligibility_score !== undefined ? '✓LLM' : '';
    const iprFlag = p.ipr_risk_score !== undefined ? '✓IPR' : '';
    const sectorInfo = sectorDamages.get(p.sector || 'general');
    const damagesLabel = sectorInfo?.label || 'N/A';

    console.log(`\n${i + 1}. ${p.patent_id} - V3 Score: ${p.v3_score?.toFixed(1)} ${llmFlag} ${iprFlag}`);
    console.log(`   ${p.title?.substring(0, 55)}...`);
    console.log(`   Sector: ${p.sector} (${damagesLabel} damages potential)`);
    console.log(`   Factors: D=${p.damages_score?.toFixed(1)} × S=${p.success_score?.toFixed(2)} × R=${p.risk_factor?.toFixed(2)} × Y=${p.year_multiplier?.toFixed(2)}`);
    console.log(`   Years: ${p.years_remaining.toFixed(1)} | Competitors: ${p.competitors?.slice(0, 3).join(', ') || 'none'} (${p.competitor_citations} cites)`);
  }

  // Statistics
  const withLLM = top250.filter(p => p.eligibility_score !== undefined).length;
  const withIPR = top250.filter(p => p.ipr_risk_score !== undefined).length;

  // Sector distribution in top 250
  const sectorDist: Record<string, number> = {};
  for (const p of top250) {
    const s = p.sector || 'general';
    sectorDist[s] = (sectorDist[s] || 0) + 1;
  }

  // Damages tier distribution
  const damagesTierDist: Record<string, number> = { Low: 0, Medium: 0, High: 0, 'Very High': 0 };
  for (const p of top250) {
    const sector = sectorDamages.get(p.sector || 'general');
    const tier = sector?.label || 'Low';
    damagesTierDist[tier]++;
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('DATA COVERAGE IN TOP 250');
  console.log('='.repeat(70));
  console.log(`LLM analysis: ${withLLM}/250 (${(withLLM / 250 * 100).toFixed(0)}%)`);
  console.log(`IPR risk data: ${withIPR}/250 (${(withIPR / 250 * 100).toFixed(0)}%)`);

  console.log(`\nDamages Tier Distribution:`);
  for (const [tier, count] of Object.entries(damagesTierDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tier}: ${count} (${(count / 250 * 100).toFixed(0)}%)`);
  }

  console.log(`\nTop Sectors in Top 250:`);
  const sortedSectors = Object.entries(sectorDist).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [sector, count] of sortedSectors) {
    const sectorInfo = sectorDamages.get(sector);
    console.log(`  ${sector}: ${count} (${sectorInfo?.label || 'N/A'} damages)`);
  }

  // Score distribution analysis
  const avgV3Score = top250.reduce((sum, p) => sum + (p.v3_score || 0), 0) / top250.length;
  const avgDamages = top250.reduce((sum, p) => sum + (p.damages_score || 0), 0) / top250.length;
  const avgSuccess = top250.reduce((sum, p) => sum + (p.success_score || 0), 0) / top250.length;
  const avgRisk = top250.reduce((sum, p) => sum + (p.risk_factor || 0), 0) / top250.length;

  console.log(`\nV3 Score Components (avg in top 250):`);
  console.log(`  Damages Score: ${avgDamages.toFixed(1)}/100`);
  console.log(`  Success Score: ${avgSuccess.toFixed(2)}/1.0`);
  console.log(`  Risk Factor: ${avgRisk.toFixed(2)}/1.0`);
  console.log(`  Final V3 Score: ${avgV3Score.toFixed(1)}`);

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputJson = {
    generated_at: new Date().toISOString(),
    version: 'v3',
    scoring_model: 'Three-Factor: Damages × Success × Risk × YearMultiplier',
    configuration: {
      filters_enabled: APPLY_FILTERS,
      min_years_remaining: MIN_YEARS_REMAINING,
      min_eligibility_score: MIN_ELIGIBILITY_SCORE,
    },
    damages_scale: {
      '1_Low': '<$10M',
      '2_Medium': '$10M - $100M',
      '3_High': '$100M - $500M',
      '4_Very_High': '>$500M',
    },
    statistics: {
      total_patents_analyzed: multiScore.size,
      filtered_out: filteredOut,
      top_250_count: top250.length,
      patents_with_llm: withLLM,
      patents_with_ipr: withIPR,
      avg_v3_score: avgV3Score,
      sector_distribution: sectorDist,
      damages_tier_distribution: damagesTierDist,
    },
    patents: top250,
  };

  fs.writeFileSync(`./output/unified-top250-v3-${timestamp}.json`, JSON.stringify(outputJson, null, 2));
  console.log(`\nSaved to: output/unified-top250-v3-${timestamp}.json`);

  // Export CSV
  const csvHeaders = [
    'rank', 'patent_id', 'title', 'grant_date', 'assignee',
    'sector', 'sector_source', 'damages_tier',
    'years_remaining', 'forward_citations', 'competitor_citations', 'competitor_count', 'competitors',
    'damages_score', 'success_score', 'risk_factor', 'year_multiplier', 'v3_score',
    'eligibility_score', 'validity_score', 'claim_breadth', 'enforcement_clarity', 'design_around_difficulty',
    'market_relevance_score', 'ipr_risk_score', 'prosecution_quality_score'
  ];

  const csvRows = [csvHeaders.join(',')];
  for (let i = 0; i < top250.length; i++) {
    const p = top250[i];
    const sectorInfo = sectorDamages.get(p.sector || 'general');
    const row = [
      i + 1,
      p.patent_id,
      `"${(p.title || '').replace(/"/g, '""')}"`,
      p.grant_date,
      `"${(p.assignee || '').replace(/"/g, '""')}"`,
      p.sector || '',
      p.sector_source || '',
      sectorInfo?.label || 'Low',
      p.years_remaining.toFixed(1),
      p.forward_citations,
      p.competitor_citations,
      p.competitor_count,
      `"${(p.competitors || []).join('; ')}"`,
      p.damages_score?.toFixed(1) || '',
      p.success_score?.toFixed(2) || '',
      p.risk_factor?.toFixed(2) || '',
      p.year_multiplier?.toFixed(2) || '',
      p.v3_score?.toFixed(1) || '',
      p.eligibility_score ?? '',
      p.validity_score ?? '',
      p.claim_breadth ?? '',
      p.enforcement_clarity ?? '',
      p.design_around_difficulty ?? '',
      p.market_relevance_score ?? '',
      p.ipr_risk_score ?? '',
      p.prosecution_quality_score ?? '',
    ];
    csvRows.push(row.join(','));
  }

  fs.writeFileSync(`./output/unified-top250-v3-${timestamp}.csv`, csvRows.join('\n'));
  console.log(`Saved to: output/unified-top250-v3-${timestamp}.csv`);
}

main().catch(console.error);
