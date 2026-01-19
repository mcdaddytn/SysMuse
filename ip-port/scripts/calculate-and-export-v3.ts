/**
 * Calculate and Export V3 - Stakeholder Voting Profiles
 *
 * This is the main export script for patent scoring using the V3 stakeholder profiles.
 *
 * Outputs:
 *   1. excel/TOP250-YYYY-MM-DD.csv - Top 250 with all profile scores (for Excel analysis)
 *   2. output/all-patents-scored-v3-YYYY-MM-DD.csv - All patents with scores (raw data)
 *   3. output/unified-top250-v3-YYYY-MM-DD.json - Top 250 JSON with full details
 *
 * Usage:
 *   npx tsx scripts/calculate-and-export-v3.ts
 */

import * as fs from 'fs';

const TOP_N = 250;
const MIN_YEARS = 3;

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

// =============================================================================
// DATA STRUCTURES
// =============================================================================

interface PatentData {
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;
  forward_citations: number;
  years_remaining: number;
  competitor_citations: number;
  competitor_count: number;
  competitors: string[];
  sector?: string;
  sector_name?: string;

  // LLM scores (1-5)
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  market_relevance_score?: number;

  // IPR & Prosecution (1-5)
  ipr_risk_score?: number;
  prosecution_quality_score?: number;

  // V3 signals
  implementation_type?: string;
  standards_relevance?: string;
}

interface NormalizeConfig {
  type: 'linear' | 'sqrt' | 'log' | 'stepped' | 'tiered_continuous' | 'score5';
  max?: number;
  steps?: { threshold: number; value: number }[];
  tiers?: { min: number; max: number; baseValue: number; slope: number }[];
}

interface MetricConfig {
  field: keyof PatentData;
  name: string;
  weight: number;
  normalize: NormalizeConfig;
  defaultValue?: number;
}

interface FactorConfig {
  name: string;
  floor: number;
  metrics: MetricConfig[];
}

interface ProfileConfig {
  id: string;
  name: string;
  stakeholder: string;
  factors: FactorConfig[];
}

// =============================================================================
// NORMALIZATION
// =============================================================================

function normalize(rawValue: number | undefined, config: NormalizeConfig, defaultValue: number = 0): number {
  const value = rawValue ?? defaultValue;

  switch (config.type) {
    case 'linear':
      return Math.min(1, Math.max(0, value / (config.max || 1)));
    case 'sqrt':
      return Math.min(1, Math.sqrt(Math.max(0, value)) / Math.sqrt(config.max || 1));
    case 'log':
      if (value <= 0) return 0;
      return Math.min(1, Math.log(value + 1) / Math.log((config.max || 100) + 1));
    case 'stepped':
      if (!config.steps) return value;
      const sortedSteps = [...config.steps].sort((a, b) => b.threshold - a.threshold);
      for (const step of sortedSteps) {
        if (value >= step.threshold) return step.value;
      }
      return 0;
    case 'tiered_continuous':
      if (!config.tiers) return value;
      for (const tier of config.tiers) {
        if (value >= tier.min && value < tier.max) {
          const progress = (value - tier.min) / (tier.max - tier.min);
          return tier.baseValue + (progress * tier.slope);
        }
      }
      const lastTier = config.tiers[config.tiers.length - 1];
      if (value >= lastTier.max) return lastTier.baseValue + lastTier.slope;
      return 0;
    case 'score5':
      return Math.max(0, Math.min(1, (value - 1) / 4));
    default:
      return value;
  }
}

// =============================================================================
// V3 STAKEHOLDER PROFILES (from scoring-test-harness-v3.ts)
// =============================================================================

const CITATIONS_AGGRESSIVE: NormalizeConfig = {
  type: 'tiered_continuous',
  tiers: [
    { min: 0, max: 1, baseValue: 0.005, slope: 0.145 },
    { min: 1, max: 3, baseValue: 0.15, slope: 0.35 },
    { min: 3, max: 8, baseValue: 0.50, slope: 0.25 },
    { min: 8, max: 20, baseValue: 0.75, slope: 0.18 },
    { min: 20, max: 100, baseValue: 0.93, slope: 0.07 },
  ]
};

const CITATIONS_STANDARD: NormalizeConfig = {
  type: 'tiered_continuous',
  tiers: [
    { min: 0, max: 1, baseValue: 0.01, slope: 0.14 },
    { min: 1, max: 3, baseValue: 0.15, slope: 0.30 },
    { min: 3, max: 8, baseValue: 0.45, slope: 0.25 },
    { min: 8, max: 20, baseValue: 0.70, slope: 0.20 },
    { min: 20, max: 100, baseValue: 0.90, slope: 0.10 },
  ]
};

const YEARS_LITIGATION: NormalizeConfig = {
  type: 'stepped',
  steps: [
    { threshold: 10, value: 1.00 },
    { threshold: 7, value: 0.85 },
    { threshold: 5, value: 0.60 },
    { threshold: 4, value: 0.40 },
    { threshold: 3, value: 0.25 },
    { threshold: 0, value: 0.10 },
  ]
};

const PROFILES: ProfileConfig[] = [
  {
    id: 'ip-lit-aggressive',
    name: 'IP Litigator (Aggressive)',
    stakeholder: 'Plaintiff-side, contingency',
    factors: [
      {
        name: 'MarketOpportunity',
        floor: 0.02,
        metrics: [
          { field: 'competitor_citations', name: 'Citations', weight: 0.60, normalize: CITATIONS_AGGRESSIVE },
          { field: 'competitor_count', name: 'Targets', weight: 0.20, normalize: { type: 'sqrt', max: 10 } },
          { field: 'forward_citations', name: 'Tech', weight: 0.08, normalize: { type: 'sqrt', max: 400 } },
          { field: 'market_relevance_score', name: 'Market', weight: 0.12, normalize: { type: 'score5' }, defaultValue: 3.2 },
        ]
      },
      {
        name: 'LegalMerit',
        floor: 0.15,
        metrics: [
          { field: 'eligibility_score', name: '101', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Validity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'claim_breadth', name: 'Breadth', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'CollectionYield',
        floor: 0.20,
        metrics: [
          { field: 'enforcement_clarity', name: 'Enforcement', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Lock-in', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'IPR', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'Timeline',
        floor: 0.12,
        metrics: [
          { field: 'years_remaining', name: 'Years', weight: 1.0, normalize: YEARS_LITIGATION },
        ]
      }
    ]
  },
  {
    id: 'ip-lit-balanced',
    name: 'IP Litigator (Balanced)',
    stakeholder: 'Mixed portfolio, hourly + success',
    factors: [
      {
        name: 'MarketEvidence',
        floor: 0.012,
        metrics: [
          { field: 'competitor_citations', name: 'Citations', weight: 0.75, normalize: CITATIONS_AGGRESSIVE },
          { field: 'competitor_count', name: 'Targets', weight: 0.15, normalize: { type: 'linear', max: 8 } },
          { field: 'market_relevance_score', name: 'Market', weight: 0.10, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'LegalStrength',
        floor: 0.17,
        metrics: [
          { field: 'eligibility_score', name: '101', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Validity', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'claim_breadth', name: 'Breadth', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'EnforcementViability',
        floor: 0.25,
        metrics: [
          { field: 'enforcement_clarity', name: 'Enforcement', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Lock-in', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'IPR', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'TimelineValue',
        floor: 0.15,
        metrics: [
          { field: 'years_remaining', name: 'Years', weight: 1.0, normalize: YEARS_LITIGATION },
        ]
      }
    ]
  },
  {
    id: 'ip-lit-conservative',
    name: 'IP Litigator (Conservative)',
    stakeholder: 'Defense-side, risk-averse',
    factors: [
      {
        name: 'LegalFoundation',
        floor: 0.30,
        metrics: [
          { field: 'eligibility_score', name: '101', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 2.8 },
          { field: 'validity_score', name: 'Validity', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 2.8 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 2.8 },
          { field: 'claim_breadth', name: 'Breadth', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'MarketValidation',
        floor: 0.05,
        metrics: [
          { field: 'competitor_citations', name: 'Citations', weight: 0.65, normalize: CITATIONS_STANDARD },
          { field: 'competitor_count', name: 'Targets', weight: 0.20, normalize: { type: 'linear', max: 8 } },
          { field: 'forward_citations', name: 'Tech', weight: 0.15, normalize: { type: 'sqrt', max: 300 } },
        ]
      },
      {
        name: 'RiskMitigation',
        floor: 0.35,
        metrics: [
          { field: 'ipr_risk_score', name: 'IPR', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.5 },
          { field: 'enforcement_clarity', name: 'Enforcement', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Lock-in', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'TimelineMargin',
        floor: 0.20,
        metrics: [
          { field: 'years_remaining', name: 'Years', weight: 1.0, normalize: {
            type: 'stepped',
            steps: [
              { threshold: 12, value: 1.00 },
              { threshold: 9, value: 0.85 },
              { threshold: 7, value: 0.65 },
              { threshold: 5, value: 0.40 },
              { threshold: 3, value: 0.20 },
              { threshold: 0, value: 0.10 },
            ]
          }},
        ]
      }
    ]
  },
  {
    id: 'licensing',
    name: 'Licensing Specialist',
    stakeholder: 'Licensing attorney/executive',
    factors: [
      {
        name: 'LicenseePool',
        floor: 0.05,
        metrics: [
          { field: 'competitor_citations', name: 'Citations', weight: 0.45, normalize: CITATIONS_STANDARD },
          { field: 'competitor_count', name: 'Targets', weight: 0.30, normalize: { type: 'sqrt', max: 10 } },
          { field: 'forward_citations', name: 'Adoption', weight: 0.25, normalize: { type: 'sqrt', max: 400 } },
        ]
      },
      {
        name: 'NegotiationLeverage',
        floor: 0.20,
        metrics: [
          { field: 'claim_breadth', name: 'Breadth', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Lock-in', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'enforcement_clarity', name: 'Enforcement', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'IPR', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'Credibility',
        floor: 0.20,
        metrics: [
          { field: 'eligibility_score', name: '101', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Validity', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'TermValue',
        floor: 0.20,
        metrics: [
          { field: 'years_remaining', name: 'Years', weight: 1.0, normalize: {
            type: 'stepped',
            steps: [
              { threshold: 8, value: 1.00 },
              { threshold: 5, value: 0.80 },
              { threshold: 3, value: 0.55 },
              { threshold: 0, value: 0.25 },
            ]
          }},
        ]
      }
    ]
  },
  {
    id: 'corporate-ma',
    name: 'Corporate/M&A',
    stakeholder: 'Corporate attorney, M&A',
    factors: [
      {
        name: 'StrategicValue',
        floor: 0.03,
        metrics: [
          { field: 'competitor_citations', name: 'Citations', weight: 0.55, normalize: CITATIONS_AGGRESSIVE },
          { field: 'forward_citations', name: 'Tech', weight: 0.25, normalize: { type: 'sqrt', max: 500 } },
          { field: 'competitor_count', name: 'Coverage', weight: 0.20, normalize: { type: 'linear', max: 10 } },
        ]
      },
      {
        name: 'DefensiveStrength',
        floor: 0.20,
        metrics: [
          { field: 'claim_breadth', name: 'Breadth', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Blocking', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'market_relevance_score', name: 'Market', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'AssetQuality',
        floor: 0.25,
        metrics: [
          { field: 'eligibility_score', name: '101', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Validity', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'IPR', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'LifecycleValue',
        floor: 0.15,
        metrics: [
          { field: 'years_remaining', name: 'Years', weight: 1.0, normalize: {
            type: 'stepped',
            steps: [
              { threshold: 10, value: 1.00 },
              { threshold: 7, value: 0.80 },
              { threshold: 5, value: 0.60 },
              { threshold: 3, value: 0.35 },
              { threshold: 0, value: 0.15 },
            ]
          }},
        ]
      }
    ]
  },
  {
    id: 'executive',
    name: 'Executive/Portfolio',
    stakeholder: 'C-Suite, Portfolio Mgmt',
    factors: [
      {
        name: 'MarketPosition',
        floor: 0.02,
        metrics: [
          { field: 'competitor_citations', name: 'Citations', weight: 0.65, normalize: CITATIONS_AGGRESSIVE },
          { field: 'forward_citations', name: 'Leadership', weight: 0.20, normalize: { type: 'sqrt', max: 500 } },
          { field: 'market_relevance_score', name: 'Market', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'PortfolioQuality',
        floor: 0.22,
        metrics: [
          { field: 'eligibility_score', name: '101', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Validity', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'claim_breadth', name: 'Breadth', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'MonetizationPotential',
        floor: 0.20,
        metrics: [
          { field: 'competitor_count', name: 'Licensees', weight: 0.35, normalize: { type: 'sqrt', max: 10 } },
          { field: 'enforcement_clarity', name: 'Actionability', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Stickiness', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'AssetLongevity',
        floor: 0.18,
        metrics: [
          { field: 'years_remaining', name: 'Years', weight: 1.0, normalize: {
            type: 'stepped',
            steps: [
              { threshold: 10, value: 1.00 },
              { threshold: 7, value: 0.80 },
              { threshold: 5, value: 0.55 },
              { threshold: 3, value: 0.30 },
              { threshold: 0, value: 0.12 },
            ]
          }},
        ]
      }
    ]
  },
];

// =============================================================================
// SCORING ENGINE
// =============================================================================

function calculateScore(patent: PatentData, profile: ProfileConfig): { finalScore: number; factorScores: Record<string, number> } {
  const factorScores: Record<string, number> = {};

  for (const factor of profile.factors) {
    let weightedSum = 0;
    let totalWeight = 0;

    for (const metric of factor.metrics) {
      const rawValue = patent[metric.field as keyof PatentData] as number | undefined;
      const normalized = normalize(rawValue, metric.normalize, metric.defaultValue);
      weightedSum += metric.weight * normalized;
      totalWeight += metric.weight;
    }

    let score = totalWeight > 0 ? weightedSum / totalWeight : 0;
    score = Math.max(factor.floor, score);
    factorScores[factor.name] = score;
  }

  // Multiplicative combination
  let finalScore = 1;
  for (const score of Object.values(factorScores)) {
    finalScore *= score;
  }
  finalScore *= 100;

  return { finalScore, factorScores };
}

// =============================================================================
// DATA LOADERS
// =============================================================================

function loadAllData(): PatentData[] {
  // Load multi-score
  const msFiles = fs.readdirSync('./output').filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json')).sort().reverse();
  if (msFiles.length === 0) return [];
  const msData = JSON.parse(fs.readFileSync(`./output/${msFiles[0]}`, 'utf-8'));
  const multiScore = new Map<string, any>();
  for (const p of msData.patents || []) multiScore.set(p.patent_id, p);

  // Load LLM
  const llmMap = new Map<string, any>();
  const v1Dir = './output/llm-analysis/combined';
  if (fs.existsSync(v1Dir)) {
    const v1Files = fs.readdirSync(v1Dir).filter(f => f.startsWith('combined-rankings-')).sort().reverse();
    if (v1Files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${v1Dir}/${v1Files[0]}`, 'utf-8'));
      for (const r of data.data?.records || []) llmMap.set(r.patent_id, r.llm_analysis);
    }
  }
  const v3Dir = './output/llm-analysis-v3';
  if (fs.existsSync(v3Dir)) {
    for (const f of fs.readdirSync(v3Dir).filter(f => f.startsWith('combined-v3-')).sort()) {
      const data = JSON.parse(fs.readFileSync(`${v3Dir}/${f}`, 'utf-8'));
      for (const a of data.analyses || []) llmMap.set(a.patent_id, { ...llmMap.get(a.patent_id), ...a });
    }
  }

  // Load IPR/Prosecution
  const iprMap = new Map<string, any>();
  const prosMap = new Map<string, any>();
  if (fs.existsSync('./output/ipr')) {
    const f = fs.readdirSync('./output/ipr').filter(f => f.startsWith('ipr-risk-check-')).sort().reverse()[0];
    if (f) for (const r of JSON.parse(fs.readFileSync(`./output/ipr/${f}`, 'utf-8')).results || []) iprMap.set(r.patent_id, r);
  }
  if (fs.existsSync('./output/prosecution')) {
    const f = fs.readdirSync('./output/prosecution').filter(f => f.startsWith('prosecution-history-')).sort().reverse()[0];
    if (f) for (const r of JSON.parse(fs.readFileSync(`./output/prosecution/${f}`, 'utf-8')).results || []) prosMap.set(r.patent_id, r);
  }

  // Load sectors
  const sectorMap = new Map<string, any>();
  if (fs.existsSync('./output/sectors')) {
    const sectorFiles = fs.readdirSync('./output/sectors').filter(f => f.startsWith('all-patents-sectors-') && f.endsWith('.json')).sort().reverse();
    if (sectorFiles.length > 0) {
      const data = JSON.parse(fs.readFileSync(`./output/sectors/${sectorFiles[0]}`, 'utf-8'));
      for (const a of data.assignments || []) sectorMap.set(a.patent_id, a);
    }
  }

  // Merge
  const patents: PatentData[] = [];
  for (const [id, base] of multiScore) {
    const years = base.years_remaining || base.remaining_years || 0;

    const llm = llmMap.get(id) || {};
    const ipr = iprMap.get(id) || {};
    const pros = prosMap.get(id) || {};
    const sector = sectorMap.get(id) || {};

    patents.push({
      patent_id: id,
      title: base.title || '',
      grant_date: base.date || base.grant_date || '',
      assignee: base.assignee || '',
      forward_citations: base.forward_citations || 0,
      years_remaining: years,
      competitor_citations: base.competitor_citations || 0,
      competitor_count: (base.competitors || base.topCompetitors || []).length,
      competitors: base.competitors || base.topCompetitors || [],
      sector: sector.final_sector || sector.sector,
      sector_name: sector.final_sector_name || sector.sector_name,
      eligibility_score: llm.eligibility_score,
      validity_score: llm.validity_score,
      claim_breadth: llm.claim_breadth,
      enforcement_clarity: llm.enforcement_clarity,
      design_around_difficulty: llm.design_around_difficulty,
      market_relevance_score: llm.market_relevance_score,
      ipr_risk_score: ipr.ipr_risk_score,
      prosecution_quality_score: pros.prosecution_quality_score,
      implementation_type: llm.implementation_type,
      standards_relevance: llm.standards_relevance,
    });
  }

  return patents;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const dateStr = new Date().toISOString().split('T')[0];

  console.log('='.repeat(70));
  console.log('Calculate and Export V3 - Stakeholder Voting Profiles');
  console.log('='.repeat(70));

  // Load affiliate config for normalization
  loadAffiliateConfig();

  // Load data
  const allPatents = loadAllData();
  console.log(`\nLoaded ${allPatents.length} total patents`);

  // Filter to minimum years
  const patents = allPatents.filter(p => p.years_remaining >= MIN_YEARS);
  console.log(`After ${MIN_YEARS}+ year filter: ${patents.length} patents`);

  // Calculate scores for all profiles
  const results: Map<string, { patent: PatentData; finalScore: number; factorScores: Record<string, number> }[]> = new Map();

  for (const profile of PROFILES) {
    const scored = patents.map(p => {
      const { finalScore, factorScores } = calculateScore(p, profile);
      return { patent: p, finalScore, factorScores };
    });
    scored.sort((a, b) => b.finalScore - a.finalScore);
    results.set(profile.id, scored);
  }

  // Calculate consensus score (average of all profiles)
  const consensusScores = new Map<string, number>();
  for (const p of patents) {
    let sum = 0;
    for (const profile of PROFILES) {
      const scored = results.get(profile.id)!.find(s => s.patent.patent_id === p.patent_id);
      sum += scored?.finalScore || 0;
    }
    consensusScores.set(p.patent_id, sum / PROFILES.length);
  }

  // Sort by consensus for ranking
  const consensusRanked = [...patents].sort((a, b) =>
    (consensusScores.get(b.patent_id) || 0) - (consensusScores.get(a.patent_id) || 0)
  );

  const top250 = consensusRanked.slice(0, TOP_N);

  console.log(`\nTop ${TOP_N} patents selected by consensus score`);

  // Statistics
  const withCC = top250.filter(p => p.competitor_citations > 0).length;
  const avgYears = top250.reduce((s, p) => s + p.years_remaining, 0) / TOP_N;
  const avgCC = top250.reduce((s, p) => s + p.competitor_citations, 0) / TOP_N;

  console.log(`\nTop 250 Statistics:`);
  console.log(`  Citation coverage: ${(withCC / TOP_N * 100).toFixed(0)}%`);
  console.log(`  Avg years remaining: ${avgYears.toFixed(1)}`);
  console.log(`  Avg competitor citations: ${avgCC.toFixed(1)}`);

  // ==========================================================================
  // Export 1: Top 250 for Excel (output/TOP250-YYYY-MM-DD.csv)
  // ==========================================================================
  const top250Headers = [
    'rank', 'patent_id', 'affiliate', 'title', 'grant_date', 'assignee',
    'years_remaining', 'forward_citations', 'competitor_citations', 'competitor_count', 'competitors',
    'sector', 'sector_name',
    'eligibility_score', 'validity_score', 'claim_breadth', 'enforcement_clarity', 'design_around_difficulty',
    'market_relevance_score', 'ipr_risk_score', 'prosecution_quality_score',
    'implementation_type', 'standards_relevance',
    'score_consensus',
    ...PROFILES.map(p => `score_${p.id}`),
    ...PROFILES.map(p => `rank_${p.id}`),
  ];

  // Build rank maps
  const rankMaps = new Map<string, Map<string, number>>();
  for (const profile of PROFILES) {
    const rm = new Map<string, number>();
    results.get(profile.id)!.forEach((item, idx) => rm.set(item.patent.patent_id, idx + 1));
    rankMaps.set(profile.id, rm);
  }

  const top250Rows = [top250Headers.join(',')];
  for (let i = 0; i < top250.length; i++) {
    const p = top250[i];
    const row = [
      i + 1,
      p.patent_id,
      normalizeAffiliate(p.assignee),
      `"${(p.title || '').replace(/"/g, '""').substring(0, 100)}"`,
      p.grant_date,
      `"${(p.assignee || '').replace(/"/g, '""')}"`,
      p.years_remaining.toFixed(1),
      p.forward_citations,
      p.competitor_citations,
      p.competitor_count,
      `"${(p.competitors || []).slice(0, 5).join('; ')}"`,
      p.sector || '',
      `"${p.sector_name || ''}"`,
      p.eligibility_score ?? '',
      p.validity_score ?? '',
      p.claim_breadth ?? '',
      p.enforcement_clarity ?? '',
      p.design_around_difficulty ?? '',
      p.market_relevance_score ?? '',
      p.ipr_risk_score ?? '',
      p.prosecution_quality_score ?? '',
      p.implementation_type || '',
      p.standards_relevance || '',
      (consensusScores.get(p.patent_id) || 0).toFixed(2),
      ...PROFILES.map(profile => {
        const scored = results.get(profile.id)!.find(s => s.patent.patent_id === p.patent_id);
        return scored?.finalScore.toFixed(2) || '';
      }),
      ...PROFILES.map(profile => rankMaps.get(profile.id)!.get(p.patent_id) || ''),
    ];
    top250Rows.push(row.join(','));
  }

  const top250Path = `./output/TOP250-${dateStr}.csv`;
  fs.writeFileSync(top250Path, top250Rows.join('\n'));
  fs.writeFileSync('./output/TOP250-LATEST.csv', top250Rows.join('\n'));
  console.log(`\nExported: ${top250Path}`);
  console.log(`Exported: ./output/TOP250-LATEST.csv`);

  // ==========================================================================
  // Export 2: All Patents Raw Data (output/all-patents-scored-v3-YYYY-MM-DD.csv)
  // ==========================================================================
  const rawHeaders = [
    'patent_id', 'affiliate', 'title', 'grant_date', 'assignee',
    'years_remaining', 'forward_citations', 'competitor_citations', 'competitor_count', 'competitors',
    'sector', 'sector_name',
    'eligibility_score', 'validity_score', 'claim_breadth', 'enforcement_clarity', 'design_around_difficulty',
    'market_relevance_score', 'ipr_risk_score', 'prosecution_quality_score',
    'implementation_type', 'standards_relevance',
    'score_consensus',
    ...PROFILES.map(p => `score_${p.id}`),
  ];

  const rawRows = [rawHeaders.join(',')];
  for (const p of allPatents) {  // ALL patents, not just filtered
    let consensusSum = 0;
    const profileScores: number[] = [];

    for (const profile of PROFILES) {
      if (p.years_remaining >= MIN_YEARS) {
        const scored = results.get(profile.id)!.find(s => s.patent.patent_id === p.patent_id);
        profileScores.push(scored?.finalScore || 0);
        consensusSum += scored?.finalScore || 0;
      } else {
        profileScores.push(0);
      }
    }

    const row = [
      p.patent_id,
      normalizeAffiliate(p.assignee),
      `"${(p.title || '').replace(/"/g, '""').substring(0, 100)}"`,
      p.grant_date,
      `"${(p.assignee || '').replace(/"/g, '""')}"`,
      p.years_remaining.toFixed(1),
      p.forward_citations,
      p.competitor_citations,
      p.competitor_count,
      `"${(p.competitors || []).slice(0, 5).join('; ')}"`,
      p.sector || '',
      `"${p.sector_name || ''}"`,
      p.eligibility_score ?? '',
      p.validity_score ?? '',
      p.claim_breadth ?? '',
      p.enforcement_clarity ?? '',
      p.design_around_difficulty ?? '',
      p.market_relevance_score ?? '',
      p.ipr_risk_score ?? '',
      p.prosecution_quality_score ?? '',
      p.implementation_type || '',
      p.standards_relevance || '',
      (consensusSum / PROFILES.length).toFixed(2),
      ...profileScores.map(s => s.toFixed(2)),
    ];
    rawRows.push(row.join(','));
  }

  const rawPath = `./output/all-patents-scored-v3-${dateStr}.csv`;
  fs.writeFileSync(rawPath, rawRows.join('\n'));
  console.log(`Exported: ${rawPath}`);

  // ==========================================================================
  // Export 3: Top 250 JSON (output/unified-top250-v3-YYYY-MM-DD.json)
  // ==========================================================================
  const jsonExport = {
    generated: new Date().toISOString(),
    version: 'v3',
    profiles: PROFILES.map(p => ({ id: p.id, name: p.name, stakeholder: p.stakeholder })),
    statistics: {
      total_patents: allPatents.length,
      filtered_patents: patents.length,
      top_n: TOP_N,
      min_years: MIN_YEARS,
      citation_coverage: (withCC / TOP_N * 100).toFixed(1) + '%',
      avg_years: avgYears.toFixed(1),
      avg_competitor_citations: avgCC.toFixed(1),
    },
    patents: top250.map((p, idx) => ({
      rank: idx + 1,
      patent_id: p.patent_id,
      title: p.title,
      assignee: p.assignee,
      years_remaining: p.years_remaining,
      competitor_citations: p.competitor_citations,
      competitors: p.competitors?.slice(0, 5),
      sector: p.sector,
      scores: {
        consensus: consensusScores.get(p.patent_id),
        ...Object.fromEntries(PROFILES.map(profile => {
          const scored = results.get(profile.id)!.find(s => s.patent.patent_id === p.patent_id);
          return [profile.id, {
            score: scored?.finalScore,
            rank: rankMaps.get(profile.id)!.get(p.patent_id),
            factors: scored?.factorScores,
          }];
        }))
      },
      metrics: {
        eligibility_score: p.eligibility_score,
        validity_score: p.validity_score,
        claim_breadth: p.claim_breadth,
        enforcement_clarity: p.enforcement_clarity,
        design_around_difficulty: p.design_around_difficulty,
        market_relevance_score: p.market_relevance_score,
        ipr_risk_score: p.ipr_risk_score,
        prosecution_quality_score: p.prosecution_quality_score,
      }
    }))
  };

  const jsonPath = `./output/unified-top250-v3-${dateStr}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(jsonExport, null, 2));
  console.log(`Exported: ${jsonPath}`);

  // Top 10 summary
  console.log('\n' + '='.repeat(70));
  console.log('TOP 10 PATENTS (by Consensus Score)');
  console.log('='.repeat(70));

  for (let i = 0; i < 10; i++) {
    const p = top250[i];
    const consensus = consensusScores.get(p.patent_id) || 0;
    const comp = p.competitors?.slice(0, 2).join(', ') || '-';
    console.log(
      `${String(i + 1).padStart(2)}. ${p.patent_id} ` +
      `Consensus: ${consensus.toFixed(1)} ` +
      `CC:${p.competitor_citations} Yrs:${p.years_remaining.toFixed(1)} ` +
      `(${comp})`
    );
  }

  console.log('\n' + '='.repeat(70));
  console.log('DONE');
  console.log('='.repeat(70));
}

main().catch(console.error);
