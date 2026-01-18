/**
 * Scoring Test Harness
 *
 * Experiments with different scoring formulas without requiring new data runs.
 * Loads existing data and applies multiple scoring configurations for comparison.
 *
 * Usage: npx tsx scripts/scoring-test-harness.ts [--verbose] [--top N]
 */

import * as fs from 'fs';

const VERBOSE = process.argv.includes('--verbose');
const TOP_N = parseInt(process.argv.find(a => a.startsWith('--top='))?.split('=')[1] || '250');

// =============================================================================
// DATA STRUCTURES
// =============================================================================

interface PatentData {
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;

  // Quantitative metrics
  forward_citations: number;
  years_remaining: number;
  competitor_citations: number;
  competitor_count: number;

  // LLM v1 scores (1-5 scale)
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;

  // LLM v3 scores (1-5 scale)
  market_relevance_score?: number;
  trend_alignment_score?: number;
  evidence_accessibility_score?: number;

  // IPR & Prosecution (1-5 scale, 5=best)
  ipr_risk_score?: number;
  prosecution_quality_score?: number;

  // Sector
  sector?: string;
  sector_damages_tier?: number; // 1-4 scale
}

interface ScoringConfig {
  name: string;
  description: string;
  subscores: SubscoreConfig[];
  combination: 'multiplicative' | 'additive';
  globalTransforms?: {
    yearMultiplier?: boolean;  // Apply year multiplier at the end
  };
}

interface SubscoreConfig {
  name: string;
  metrics: MetricConfig[];
  transform?: 'linear' | 'sqrt' | 'log';  // How to combine into subscore
  floor?: number;  // Minimum subscore value (prevents zero-out)
}

interface MetricConfig {
  field: keyof PatentData;
  weight: number;
  normalize: NormalizeConfig;
  defaultValue?: number;  // Value when data missing
}

interface NormalizeConfig {
  type: 'linear' | 'sqrt' | 'log' | 'exponential' | 'threshold' | 'score5';
  max?: number;
  exponent?: number;  // For exponential: value^exponent
  thresholds?: { value: number; output: number }[];  // For threshold-based
}

// =============================================================================
// NORMALIZATION FUNCTIONS
// =============================================================================

function normalize(value: number | undefined, config: NormalizeConfig, defaultValue: number = 0): number {
  if (value === undefined || value === null) return defaultValue;

  switch (config.type) {
    case 'linear':
      return Math.min(1, Math.max(0, value / (config.max || 1)));

    case 'sqrt':
      return Math.min(1, Math.sqrt(value) / Math.sqrt(config.max || 1));

    case 'log':
      if (value <= 0) return 0;
      return Math.min(1, Math.log(value + 1) / Math.log((config.max || 100) + 1));

    case 'exponential':
      const exp = config.exponent || 1.5;
      return Math.min(1, Math.pow(value / (config.max || 1), exp));

    case 'threshold':
      if (!config.thresholds) return value;
      // Find highest threshold that value exceeds
      const sorted = [...config.thresholds].sort((a, b) => b.value - a.value);
      for (const t of sorted) {
        if (value >= t.value) return t.output;
      }
      return 0;

    case 'score5':
      // 1-5 LLM score to 0-1
      return Math.max(0, Math.min(1, (value - 1) / 4));

    default:
      return value;
  }
}

// =============================================================================
// SCORING CONFIGURATIONS TO TEST
// =============================================================================

const SCORING_CONFIGS: ScoringConfig[] = [
  // ---------------------------------------------
  // CONFIG A: Current V2 (baseline for comparison)
  // ---------------------------------------------
  {
    name: 'V2-Baseline',
    description: 'Current V2: additive base × year multiplier',
    combination: 'additive',
    globalTransforms: { yearMultiplier: true },
    subscores: [
      {
        name: 'BaseScore',
        metrics: [
          { field: 'competitor_citations', weight: 0.20, normalize: { type: 'sqrt', max: 50 } },
          { field: 'competitor_count', weight: 0.10, normalize: { type: 'linear', max: 10 } },
          { field: 'forward_citations', weight: 0.10, normalize: { type: 'sqrt', max: 500 } },
          { field: 'years_remaining', weight: 0.05, normalize: { type: 'exponential', max: 15, exponent: 1.5 } },
          { field: 'eligibility_score', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'validity_score', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'claim_breadth', weight: 0.10, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'enforcement_clarity', weight: 0.10, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'ipr_risk_score', weight: 0.025, normalize: { type: 'score5' }, defaultValue: 0.8 },
          { field: 'prosecution_quality_score', weight: 0.025, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      }
    ]
  },

  // ---------------------------------------------
  // CONFIG B: Three-Factor Multiplicative (V3 Design)
  // ---------------------------------------------
  {
    name: 'V3-ThreeFactor',
    description: 'Damages × Success × Risk (multiplicative)',
    combination: 'multiplicative',
    subscores: [
      {
        name: 'Damages',
        floor: 0.1,
        metrics: [
          { field: 'competitor_citations', weight: 0.30, normalize: { type: 'sqrt', max: 50 } },
          { field: 'competitor_count', weight: 0.15, normalize: { type: 'linear', max: 10 } },
          { field: 'forward_citations', weight: 0.15, normalize: { type: 'sqrt', max: 500 } },
          { field: 'years_remaining', weight: 0.25, normalize: { type: 'exponential', max: 15, exponent: 1.2 } },
          { field: 'market_relevance_score', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'Success',
        floor: 0.2,
        metrics: [
          { field: 'eligibility_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'validity_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'claim_breadth', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'prosecution_quality_score', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'Risk',
        floor: 0.3,
        metrics: [
          { field: 'ipr_risk_score', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.8 },
          { field: 'design_around_difficulty', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'enforcement_clarity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      }
    ]
  },

  // ---------------------------------------------
  // CONFIG C: Four-Factor (Split Damages)
  // ---------------------------------------------
  {
    name: 'V3-FourFactor',
    description: 'MarketEvidence × PatentValue × Success × Risk',
    combination: 'multiplicative',
    subscores: [
      {
        name: 'MarketEvidence',
        floor: 0.1,
        metrics: [
          { field: 'competitor_citations', weight: 0.50, normalize: { type: 'sqrt', max: 50 } },
          { field: 'competitor_count', weight: 0.30, normalize: { type: 'linear', max: 10 } },
          { field: 'market_relevance_score', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 0.5 },
        ]
      },
      {
        name: 'PatentValue',
        floor: 0.2,
        metrics: [
          { field: 'forward_citations', weight: 0.35, normalize: { type: 'sqrt', max: 500 } },
          { field: 'years_remaining', weight: 0.40, normalize: { type: 'exponential', max: 15, exponent: 1.3 } },
          { field: 'claim_breadth', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'LegalStrength',
        floor: 0.25,
        metrics: [
          { field: 'eligibility_score', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'validity_score', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'prosecution_quality_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'EnforcementYield',
        floor: 0.3,
        metrics: [
          { field: 'ipr_risk_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.8 },
          { field: 'design_around_difficulty', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'enforcement_clarity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      }
    ]
  },

  // ---------------------------------------------
  // CONFIG D: Four-Factor with Non-Linear Citations
  // ---------------------------------------------
  {
    name: 'V3-FourFactor-LogCites',
    description: 'Like FourFactor but log normalization on citations (heavier low-count penalty)',
    combination: 'multiplicative',
    subscores: [
      {
        name: 'MarketEvidence',
        floor: 0.05,  // Lower floor to let citations matter more
        metrics: [
          { field: 'competitor_citations', weight: 0.55, normalize: { type: 'log', max: 50 } },
          { field: 'competitor_count', weight: 0.25, normalize: { type: 'log', max: 10 } },
          { field: 'market_relevance_score', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 0.4 },
        ]
      },
      {
        name: 'PatentValue',
        floor: 0.2,
        metrics: [
          { field: 'forward_citations', weight: 0.35, normalize: { type: 'sqrt', max: 500 } },
          { field: 'years_remaining', weight: 0.40, normalize: { type: 'exponential', max: 15, exponent: 1.3 } },
          { field: 'claim_breadth', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'LegalStrength',
        floor: 0.25,
        metrics: [
          { field: 'eligibility_score', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'validity_score', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'prosecution_quality_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'EnforcementYield',
        floor: 0.3,
        metrics: [
          { field: 'ipr_risk_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.8 },
          { field: 'design_around_difficulty', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'enforcement_clarity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      }
    ]
  },

  // ---------------------------------------------
  // CONFIG E: Threshold-Based Citations
  // ---------------------------------------------
  {
    name: 'V3-ThresholdCites',
    description: 'Threshold-based citation scoring: 0=0.1, 1-2=0.4, 3-5=0.6, 6-10=0.8, 10+=1.0',
    combination: 'multiplicative',
    subscores: [
      {
        name: 'MarketEvidence',
        floor: 0.1,
        metrics: [
          {
            field: 'competitor_citations',
            weight: 0.60,
            normalize: {
              type: 'threshold',
              thresholds: [
                { value: 10, output: 1.0 },
                { value: 6, output: 0.8 },
                { value: 3, output: 0.6 },
                { value: 1, output: 0.4 },
                { value: 0, output: 0.1 },
              ]
            }
          },
          { field: 'competitor_count', weight: 0.20, normalize: { type: 'linear', max: 8 } },
          { field: 'market_relevance_score', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 0.5 },
        ]
      },
      {
        name: 'PatentValue',
        floor: 0.2,
        metrics: [
          { field: 'forward_citations', weight: 0.35, normalize: { type: 'sqrt', max: 500 } },
          { field: 'years_remaining', weight: 0.40, normalize: { type: 'exponential', max: 15, exponent: 1.3 } },
          { field: 'claim_breadth', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'LegalStrength',
        floor: 0.25,
        metrics: [
          { field: 'eligibility_score', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'validity_score', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'prosecution_quality_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'EnforcementYield',
        floor: 0.3,
        metrics: [
          { field: 'ipr_risk_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.8 },
          { field: 'design_around_difficulty', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'enforcement_clarity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      }
    ]
  },

  // ---------------------------------------------
  // CONFIG F: Five-Factor (Separate Years)
  // ---------------------------------------------
  {
    name: 'V3-FiveFactor',
    description: 'MarketEvidence × TechValue × YearFactor × LegalStrength × EnforcementYield',
    combination: 'multiplicative',
    subscores: [
      {
        name: 'MarketEvidence',
        floor: 0.1,
        metrics: [
          { field: 'competitor_citations', weight: 0.55, normalize: { type: 'sqrt', max: 50 } },
          { field: 'competitor_count', weight: 0.25, normalize: { type: 'linear', max: 10 } },
          { field: 'market_relevance_score', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 0.5 },
        ]
      },
      {
        name: 'TechValue',
        floor: 0.2,
        metrics: [
          { field: 'forward_citations', weight: 0.50, normalize: { type: 'sqrt', max: 500 } },
          { field: 'claim_breadth', weight: 0.50, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'YearFactor',
        floor: 0.3,  // 3 years minimum gets ~0.3
        metrics: [
          { field: 'years_remaining', weight: 1.0, normalize: { type: 'exponential', max: 15, exponent: 1.0 } },
        ]
      },
      {
        name: 'LegalStrength',
        floor: 0.25,
        metrics: [
          { field: 'eligibility_score', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'validity_score', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'prosecution_quality_score', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      },
      {
        name: 'EnforcementYield',
        floor: 0.3,
        metrics: [
          { field: 'ipr_risk_score', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 0.8 },
          { field: 'design_around_difficulty', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
          { field: 'enforcement_clarity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 0.6 },
        ]
      }
    ]
  },
];

// =============================================================================
// DATA LOADERS
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
  const map = new Map<string, any>();

  // Load v1 analysis
  const v1Dir = './output/llm-analysis/combined';
  if (fs.existsSync(v1Dir)) {
    const v1Files = fs.readdirSync(v1Dir)
      .filter(f => f.startsWith('combined-rankings-') && f.endsWith('.json'))
      .sort().reverse();

    if (v1Files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${v1Dir}/${v1Files[0]}`, 'utf-8'));
      for (const record of data.data?.records || []) {
        map.set(record.patent_id, { ...map.get(record.patent_id), ...record.llm_analysis });
      }
    }
  }

  // Load v3 analysis (all files, newer overwrites)
  const v3Dir = './output/llm-analysis-v3';
  if (fs.existsSync(v3Dir)) {
    const v3Files = fs.readdirSync(v3Dir)
      .filter(f => f.startsWith('combined-v3-') && f.endsWith('.json'))
      .sort();

    for (const file of v3Files) {
      const data = JSON.parse(fs.readFileSync(`${v3Dir}/${file}`, 'utf-8'));
      for (const analysis of data.analyses || []) {
        map.set(analysis.patent_id, { ...map.get(analysis.patent_id), ...analysis });
      }
    }
  }

  console.log(`Loaded ${map.size} patents with LLM analysis`);
  return map;
}

function loadIPRData(): Map<string, any> {
  const map = new Map<string, any>();
  const iprDir = './output/ipr';

  if (fs.existsSync(iprDir)) {
    const files = fs.readdirSync(iprDir)
      .filter(f => f.startsWith('ipr-risk-check-') && f.endsWith('.json'))
      .sort().reverse();

    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${iprDir}/${files[0]}`, 'utf-8'));
      for (const result of data.results || []) {
        map.set(result.patent_id, result);
      }
    }
  }

  console.log(`Loaded ${map.size} patents with IPR data`);
  return map;
}

function loadProsecutionData(): Map<string, any> {
  const map = new Map<string, any>();
  const prosDir = './output/prosecution';

  if (fs.existsSync(prosDir)) {
    const files = fs.readdirSync(prosDir)
      .filter(f => f.startsWith('prosecution-history-') && f.endsWith('.json'))
      .sort().reverse();

    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${prosDir}/${files[0]}`, 'utf-8'));
      for (const result of data.results || []) {
        map.set(result.patent_id, result);
      }
    }
  }

  console.log(`Loaded ${map.size} patents with prosecution data`);
  return map;
}

function loadSectorData(): Map<string, any> {
  const map = new Map<string, any>();
  const sectorDir = './output/sectors';

  if (fs.existsSync(sectorDir)) {
    const files = fs.readdirSync(sectorDir)
      .filter(f => f.startsWith('all-patents-sectors-') && f.endsWith('.json'))
      .sort().reverse();

    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${sectorDir}/${files[0]}`, 'utf-8'));
      for (const assignment of data.assignments || []) {
        map.set(assignment.patent_id, assignment);
      }
    }
  }

  console.log(`Loaded ${map.size} patents with sector data`);
  return map;
}

// =============================================================================
// SCORING ENGINE
// =============================================================================

function calculateSubscore(patent: PatentData, config: SubscoreConfig): number {
  let score = 0;
  let weightSum = 0;

  for (const metric of config.metrics) {
    const rawValue = patent[metric.field] as number | undefined;
    const normalizedValue = normalize(rawValue, metric.normalize, metric.defaultValue);

    score += metric.weight * normalizedValue;
    weightSum += metric.weight;
  }

  // Normalize by weight sum (handles missing data gracefully)
  let result = weightSum > 0 ? score / weightSum : 0;

  // Apply floor if specified
  if (config.floor !== undefined) {
    result = Math.max(config.floor, result);
  }

  return result;
}

function calculateYearMultiplier(years: number): number {
  if (years >= 15) return 1.0;
  if (years <= 0) return 0.0;
  return 0.3 + (0.7 * Math.pow(years / 15, 0.8));
}

function calculateScore(patent: PatentData, config: ScoringConfig): {
  finalScore: number;
  subscores: Record<string, number>;
  yearMultiplier?: number;
} {
  const subscores: Record<string, number> = {};

  // Calculate each subscore
  for (const subscore of config.subscores) {
    subscores[subscore.name] = calculateSubscore(patent, subscore);
  }

  // Combine subscores
  let finalScore: number;
  if (config.combination === 'multiplicative') {
    finalScore = Object.values(subscores).reduce((a, b) => a * b, 1);
  } else {
    finalScore = Object.values(subscores).reduce((a, b) => a + b, 0) / config.subscores.length;
  }

  // Apply global transforms
  let yearMultiplier: number | undefined;
  if (config.globalTransforms?.yearMultiplier) {
    yearMultiplier = calculateYearMultiplier(patent.years_remaining);
    finalScore *= yearMultiplier;
  }

  // Scale to 0-100
  finalScore *= 100;

  return { finalScore, subscores, yearMultiplier };
}

// =============================================================================
// MAIN ANALYSIS
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('SCORING TEST HARNESS - Comparative Analysis');
  console.log('='.repeat(70));
  console.log(`\nComparing ${SCORING_CONFIGS.length} scoring configurations on top ${TOP_N} patents\n`);

  // Load all data
  const multiScore = loadMultiScoreAnalysis();
  const llmData = loadLLMAnalysis();
  const iprData = loadIPRData();
  const prosData = loadProsecutionData();
  const sectorData = loadSectorData();

  if (multiScore.size === 0) {
    console.error('No patent data found!');
    process.exit(1);
  }

  // Merge data into unified patent records
  const patents: PatentData[] = [];

  for (const [patentId, baseData] of multiScore) {
    const llm = llmData.get(patentId) || {};
    const ipr = iprData.get(patentId) || {};
    const pros = prosData.get(patentId) || {};
    const sector = sectorData.get(patentId) || {};

    // Skip patents with < 3 years remaining (hard filter)
    const yearsRemaining = baseData.years_remaining || baseData.remaining_years || 0;
    if (yearsRemaining < 3) continue;

    patents.push({
      patent_id: patentId,
      title: baseData.title || '',
      grant_date: baseData.date || baseData.grant_date || '',
      assignee: baseData.assignee || '',
      forward_citations: baseData.forward_citations || 0,
      years_remaining: yearsRemaining,
      competitor_citations: baseData.competitor_citations || 0,
      competitor_count: (baseData.competitors || baseData.topCompetitors || []).length,

      // LLM scores
      eligibility_score: llm.eligibility_score,
      validity_score: llm.validity_score,
      claim_breadth: llm.claim_breadth,
      enforcement_clarity: llm.enforcement_clarity,
      design_around_difficulty: llm.design_around_difficulty,
      market_relevance_score: llm.market_relevance_score,
      trend_alignment_score: llm.trend_alignment_score,
      evidence_accessibility_score: llm.evidence_accessibility_score,

      // IPR & Prosecution
      ipr_risk_score: ipr.ipr_risk_score,
      prosecution_quality_score: pros.prosecution_quality_score,

      // Sector
      sector: sector.final_sector || sector.sector,
    });
  }

  console.log(`\nLoaded ${patents.length} patents (after filtering < 3 years)\n`);

  // Calculate scores for each configuration
  const results: Map<string, { patent: PatentData; scores: Record<string, any> }[]> = new Map();

  for (const config of SCORING_CONFIGS) {
    const scored = patents.map(p => ({
      patent: p,
      scores: calculateScore(p, config)
    }));

    // Sort by final score
    scored.sort((a, b) => b.scores.finalScore - a.scores.finalScore);
    results.set(config.name, scored);
  }

  // Build comparison table
  console.log('='.repeat(70));
  console.log('TOP 20 PATENTS BY CONFIGURATION');
  console.log('='.repeat(70));

  // Show top 20 for each config
  for (const config of SCORING_CONFIGS) {
    const scored = results.get(config.name)!;
    console.log(`\n--- ${config.name}: ${config.description} ---`);

    for (let i = 0; i < Math.min(20, scored.length); i++) {
      const { patent, scores } = scored[i];
      const subscoreStr = Object.entries(scores.subscores)
        .map(([k, v]) => `${k.substring(0, 4)}:${(v as number).toFixed(2)}`)
        .join(' ');

      console.log(
        `${String(i + 1).padStart(2)}. ${patent.patent_id} ` +
        `Score:${scores.finalScore.toFixed(1).padStart(5)} ` +
        `[${subscoreStr}] ` +
        `CC:${patent.competitor_citations} Yrs:${patent.years_remaining.toFixed(1)}`
      );
    }
  }

  // Rank comparison analysis
  console.log('\n' + '='.repeat(70));
  console.log('RANK MOVEMENT ANALYSIS');
  console.log('='.repeat(70));

  const baselineConfig = SCORING_CONFIGS[0].name;
  const baselineRanks = new Map<string, number>();
  const baselineScored = results.get(baselineConfig)!;
  baselineScored.forEach((item, idx) => baselineRanks.set(item.patent.patent_id, idx + 1));

  for (const config of SCORING_CONFIGS.slice(1)) {
    const scored = results.get(config.name)!;

    let bigMoversUp: { id: string; from: number; to: number; delta: number }[] = [];
    let bigMoversDown: { id: string; from: number; to: number; delta: number }[] = [];

    scored.slice(0, TOP_N).forEach((item, idx) => {
      const baseRank = baselineRanks.get(item.patent.patent_id) || TOP_N + 1;
      const newRank = idx + 1;
      const delta = baseRank - newRank;

      if (delta > 20) bigMoversUp.push({ id: item.patent.patent_id, from: baseRank, to: newRank, delta });
      if (delta < -20) bigMoversDown.push({ id: item.patent.patent_id, from: baseRank, to: newRank, delta });
    });

    bigMoversUp.sort((a, b) => b.delta - a.delta);
    bigMoversDown.sort((a, b) => a.delta - b.delta);

    console.log(`\n--- ${config.name} vs ${baselineConfig} ---`);

    if (bigMoversUp.length > 0) {
      console.log(`  Biggest risers (moved up 20+ ranks):`);
      for (const m of bigMoversUp.slice(0, 5)) {
        const p = patents.find(p => p.patent_id === m.id)!;
        console.log(`    ${m.id}: #${m.from} → #${m.to} (+${m.delta}) CC:${p.competitor_citations} Yrs:${p.years_remaining.toFixed(1)}`);
      }
    }

    if (bigMoversDown.length > 0) {
      console.log(`  Biggest fallers (dropped 20+ ranks):`);
      for (const m of bigMoversDown.slice(0, 5)) {
        const p = patents.find(p => p.patent_id === m.id)!;
        console.log(`    ${m.id}: #${m.from} → #${m.to} (${m.delta}) CC:${p.competitor_citations} Yrs:${p.years_remaining.toFixed(1)}`);
      }
    }

    // Count patents in/out of top N
    const baselineTop = new Set(baselineScored.slice(0, TOP_N).map(s => s.patent.patent_id));
    const configTop = new Set(scored.slice(0, TOP_N).map(s => s.patent.patent_id));

    let newIn = 0, droppedOut = 0;
    for (const id of configTop) if (!baselineTop.has(id)) newIn++;
    for (const id of baselineTop) if (!configTop.has(id)) droppedOut++;

    console.log(`  New to top ${TOP_N}: ${newIn} | Dropped out: ${droppedOut}`);
  }

  // Export comparison CSV
  const timestamp = new Date().toISOString().split('T')[0];
  const csvHeaders = [
    'patent_id', 'title', 'competitor_citations', 'competitor_count',
    'forward_citations', 'years_remaining', 'sector',
    'eligibility', 'validity', 'claim_breadth', 'enforcement', 'design_around',
    'ipr_risk', 'prosecution',
    ...SCORING_CONFIGS.map(c => `score_${c.name}`),
    ...SCORING_CONFIGS.map(c => `rank_${c.name}`),
  ];

  // Build rank maps for each config
  const rankMaps: Map<string, Map<string, number>> = new Map();
  for (const config of SCORING_CONFIGS) {
    const ranks = new Map<string, number>();
    const scored = results.get(config.name)!;
    scored.forEach((item, idx) => ranks.set(item.patent.patent_id, idx + 1));
    rankMaps.set(config.name, ranks);
  }

  const csvRows = [csvHeaders.join(',')];

  // Use baseline order for CSV
  for (let i = 0; i < Math.min(TOP_N * 2, baselineScored.length); i++) {
    const { patent } = baselineScored[i];

    const row = [
      patent.patent_id,
      `"${(patent.title || '').replace(/"/g, '""').substring(0, 80)}"`,
      patent.competitor_citations,
      patent.competitor_count,
      patent.forward_citations,
      patent.years_remaining.toFixed(1),
      patent.sector || '',
      patent.eligibility_score ?? '',
      patent.validity_score ?? '',
      patent.claim_breadth ?? '',
      patent.enforcement_clarity ?? '',
      patent.design_around_difficulty ?? '',
      patent.ipr_risk_score ?? '',
      patent.prosecution_quality_score ?? '',
      ...SCORING_CONFIGS.map(c => {
        const scored = results.get(c.name)!;
        const item = scored.find(s => s.patent.patent_id === patent.patent_id);
        return item?.scores.finalScore.toFixed(2) || '';
      }),
      ...SCORING_CONFIGS.map(c => rankMaps.get(c.name)!.get(patent.patent_id) || ''),
    ];

    csvRows.push(row.join(','));
  }

  const csvPath = `./output/scoring-comparison-${timestamp}.csv`;
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\nExported comparison CSV: ${csvPath}`);

  // Summary statistics
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(70));

  for (const config of SCORING_CONFIGS) {
    const scored = results.get(config.name)!;
    const top = scored.slice(0, TOP_N);

    const avgScore = top.reduce((s, t) => s + t.scores.finalScore, 0) / TOP_N;
    const avgYears = top.reduce((s, t) => s + t.patent.years_remaining, 0) / TOP_N;
    const avgCC = top.reduce((s, t) => s + t.patent.competitor_citations, 0) / TOP_N;
    const withCC = top.filter(t => t.patent.competitor_citations > 0).length;
    const withLLM = top.filter(t => t.patent.eligibility_score !== undefined).length;

    console.log(`\n${config.name}:`);
    console.log(`  Avg Score: ${avgScore.toFixed(1)} | Avg Years: ${avgYears.toFixed(1)} | Avg CC: ${avgCC.toFixed(1)}`);
    console.log(`  With CC: ${withCC}/${TOP_N} (${(withCC/TOP_N*100).toFixed(0)}%) | With LLM: ${withLLM}/${TOP_N} (${(withLLM/TOP_N*100).toFixed(0)}%)`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Done!');
}

main().catch(console.error);
