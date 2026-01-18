/**
 * Scoring Test Harness V2 - Attorney-Friendly Configurations
 *
 * Design Principles:
 * 1. Factor groupings should be intuitive business concepts attorneys understand
 * 2. Within-factor: additive (attorneys adjust relative weights within a concept)
 * 3. Between-factor: multiplicative (enforces "must have" criteria)
 * 4. Multiple profiles for consensus/voting among attorneys
 * 5. Stepped year treatment reflecting litigation timeline realities
 * 6. Hybrid tier+continuous for citations
 *
 * Usage: npx tsx scripts/scoring-test-harness-v2.ts [--top N] [--track-patents]
 */

import * as fs from 'fs';

const TOP_N = parseInt(process.argv.find(a => a.startsWith('--top='))?.split('=')[1] || '250');
const TRACK_PATENTS = process.argv.includes('--track-patents');

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

  // LLM scores (1-5)
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  market_relevance_score?: number;

  // IPR & Prosecution (1-5, 5=best)
  ipr_risk_score?: number;
  prosecution_quality_score?: number;

  sector?: string;
}

interface ScoringConfig {
  name: string;
  description: string;
  attorney_explanation: string;  // Plain English for attorneys
  factors: FactorConfig[];
  target_citation_coverage: number;  // Expected % with citations in top N
}

interface FactorConfig {
  name: string;
  description: string;  // What this factor represents
  weight?: number;  // For additive combination between factors (optional)
  floor: number;  // Minimum value (prevents complete zero-out)
  ceiling?: number;  // Maximum value (caps extreme values)
  metrics: MetricConfig[];
}

interface MetricConfig {
  field: keyof PatentData | 'computed';
  name: string;  // Human-readable name
  weight: number;
  normalize: NormalizeConfig;
  defaultValue?: number;
}

interface NormalizeConfig {
  type: 'linear' | 'sqrt' | 'log' | 'stepped' | 'tiered_continuous' | 'score5';
  max?: number;
  steps?: { threshold: number; value: number }[];  // For stepped
  tiers?: { min: number; max: number; baseValue: number; slope: number }[];  // For tiered_continuous
}

// =============================================================================
// NORMALIZATION FUNCTIONS
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
      // Step function: find highest threshold value exceeds
      if (!config.steps) return value;
      const sortedSteps = [...config.steps].sort((a, b) => b.threshold - a.threshold);
      for (const step of sortedSteps) {
        if (value >= step.threshold) return step.value;
      }
      return 0;

    case 'tiered_continuous':
      // Tiers with continuous interpolation within each tier
      if (!config.tiers) return value;
      for (const tier of config.tiers) {
        if (value >= tier.min && value < tier.max) {
          // Linear interpolation within tier
          const progress = (value - tier.min) / (tier.max - tier.min);
          return tier.baseValue + (progress * tier.slope);
        }
      }
      // Above all tiers
      const lastTier = config.tiers[config.tiers.length - 1];
      if (value >= lastTier.max) return lastTier.baseValue + lastTier.slope;
      return 0;

    case 'score5':
      // 1-5 LLM score to 0-1 (treating 3 as neutral)
      return Math.max(0, Math.min(1, (value - 1) / 4));

    default:
      return value;
  }
}

// =============================================================================
// SCORING CONFIGURATIONS - ATTORNEY FRIENDLY
// =============================================================================

const SCORING_CONFIGS: ScoringConfig[] = [

  // =====================================================
  // CONFIG 1: V2-Baseline (for comparison)
  // =====================================================
  {
    name: 'V2-Baseline',
    description: 'Current V2 scoring (additive base × year multiplier)',
    attorney_explanation: 'The existing formula. Single weighted average of all metrics, then multiplied by a year factor.',
    target_citation_coverage: 25,
    factors: [
      {
        name: 'CombinedScore',
        description: 'Weighted average of all metrics',
        floor: 0.1,
        metrics: [
          { field: 'competitor_citations', name: 'Competitor Citations', weight: 0.20, normalize: { type: 'sqrt', max: 50 } },
          { field: 'competitor_count', name: 'Competitor Count', weight: 0.10, normalize: { type: 'linear', max: 10 } },
          { field: 'forward_citations', name: 'Forward Citations', weight: 0.10, normalize: { type: 'sqrt', max: 500 } },
          { field: 'years_remaining', name: 'Years Remaining', weight: 0.10, normalize: { type: 'linear', max: 15 } },
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'validity_score', name: 'Prior Art Validity', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'claim_breadth', name: 'Claim Breadth', weight: 0.10, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'enforcement_clarity', name: 'Enforcement Clarity', weight: 0.10, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      }
    ]
  },

  // =====================================================
  // CONFIG 2: Four-Factor Attorney Model
  // =====================================================
  {
    name: 'V4-Attorney',
    description: 'Four intuitive factors: Market × Legal × Enforcement × Timeline',
    attorney_explanation: `
      MARKET EVIDENCE: Do competitors actually use this technology? (citations = evidence)
      LEGAL STRENGTH: Will the patent survive challenges? (eligibility, validity, prosecution)
      ENFORCEMENT: Can we prove infringement and collect? (clarity, design-around, IPR risk)
      TIMELINE: Is there enough runway? (years remaining with litigation timeline steps)

      All four must be reasonably strong - weak in any area significantly reduces value.
    `,
    target_citation_coverage: 95,
    factors: [
      {
        name: 'MarketEvidence',
        description: 'Evidence that competitors are using this technology',
        floor: 0.05,
        metrics: [
          {
            field: 'competitor_citations', name: 'Competitor Citations', weight: 0.65,
            normalize: {
              type: 'tiered_continuous',
              tiers: [
                { min: 0, max: 1, baseValue: 0.05, slope: 0.15 },   // 0 cites = 0.05, approaches 0.20 at 1
                { min: 1, max: 3, baseValue: 0.20, slope: 0.20 },   // 1-3 cites = 0.20-0.40
                { min: 3, max: 6, baseValue: 0.40, slope: 0.20 },   // 3-6 cites = 0.40-0.60
                { min: 6, max: 10, baseValue: 0.60, slope: 0.20 },  // 6-10 cites = 0.60-0.80
                { min: 10, max: 50, baseValue: 0.80, slope: 0.20 }, // 10+ cites = 0.80-1.0
              ]
            }
          },
          { field: 'competitor_count', name: 'Distinct Competitors', weight: 0.20, normalize: { type: 'linear', max: 8 } },
          { field: 'market_relevance_score', name: 'Market Relevance (LLM)', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'LegalStrength',
        description: 'Likelihood of surviving legal challenges',
        floor: 0.20,
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'validity_score', name: 'Prior Art Validity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'prosecution_quality_score', name: 'Prosecution Quality', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'EnforcementYield',
        description: 'Ability to prove infringement and collect damages',
        floor: 0.25,
        metrics: [
          { field: 'enforcement_clarity', name: 'Enforcement Clarity', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'design_around_difficulty', name: 'Design-Around Difficulty', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'ipr_risk_score', name: 'IPR Risk (inverse)', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 4 },
        ]
      },
      {
        name: 'Timeline',
        description: 'Sufficient runway considering litigation timelines',
        floor: 0.15,
        metrics: [
          {
            field: 'years_remaining', name: 'Years Remaining', weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 12, value: 1.0 },   // 12+ years: full value
                { threshold: 8, value: 0.85 },   // 8-12 years: slight penalty
                { threshold: 5, value: 0.60 },   // 5-8 years: moderate penalty (litigation timeline)
                { threshold: 3, value: 0.35 },   // 3-5 years: heavy penalty (may not complete litigation)
                { threshold: 0, value: 0.15 },   // <3 years: severe penalty
              ]
            }
          }
        ]
      }
    ]
  },

  // =====================================================
  // CONFIG 3: Three-Factor with Dual Year Impact
  // =====================================================
  {
    name: 'V4-DualYear',
    description: 'Years impacts both Damages (revenue window) and Litigability (timeline feasibility)',
    attorney_explanation: `
      DAMAGES POTENTIAL: How much could we recover? (citations, years for royalty window)
      LEGAL VIABILITY: Will we win the case? (eligibility, validity, prosecution, claim scope)
      LITIGATION FEASIBILITY: Can we execute? (enforcement, IPR risk, years for timeline)

      Years appear in two factors because:
      - Short years means less royalty revenue potential (Damages)
      - Short years means litigation may not complete (Litigability)
    `,
    target_citation_coverage: 95,
    factors: [
      {
        name: 'DamagesPotential',
        description: 'Potential recovery amount if successful',
        floor: 0.08,
        metrics: [
          {
            field: 'competitor_citations', name: 'Competitor Citations', weight: 0.50,
            normalize: {
              type: 'tiered_continuous',
              tiers: [
                { min: 0, max: 1, baseValue: 0.03, slope: 0.12 },
                { min: 1, max: 3, baseValue: 0.15, slope: 0.20 },
                { min: 3, max: 8, baseValue: 0.35, slope: 0.25 },
                { min: 8, max: 20, baseValue: 0.60, slope: 0.25 },
                { min: 20, max: 100, baseValue: 0.85, slope: 0.15 },
              ]
            }
          },
          { field: 'competitor_count', name: 'Competitor Breadth', weight: 0.15, normalize: { type: 'sqrt', max: 10 } },
          { field: 'forward_citations', name: 'Technology Importance', weight: 0.15, normalize: { type: 'sqrt', max: 300 } },
          {
            field: 'years_remaining', name: 'Royalty Window', weight: 0.20,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 10, value: 1.0 },
                { threshold: 7, value: 0.75 },
                { threshold: 5, value: 0.50 },
                { threshold: 3, value: 0.25 },
                { threshold: 0, value: 0.10 },
              ]
            }
          }
        ]
      },
      {
        name: 'LegalViability',
        description: 'Likelihood of prevailing on the merits',
        floor: 0.20,
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'validity_score', name: 'Prior Art Defense', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'claim_breadth', name: 'Claim Scope', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'prosecution_quality_score', name: 'File History', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'LitigationFeasibility',
        description: 'Can we execute and collect?',
        floor: 0.20,
        metrics: [
          { field: 'enforcement_clarity', name: 'Proof of Infringement', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'design_around_difficulty', name: 'No Easy Escape', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'ipr_risk_score', name: 'IPR Survivability', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 4 },
          {
            field: 'years_remaining', name: 'Litigation Timeline', weight: 0.20,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 8, value: 1.0 },   // 8+ years: plenty of time
                { threshold: 5, value: 0.70 },  // 5-8: workable but tight
                { threshold: 3, value: 0.35 },  // 3-5: very tight, appeals may expire
                { threshold: 0, value: 0.10 },  // <3: likely can't complete
              ]
            }
          }
        ]
      }
    ]
  },

  // =====================================================
  // CONFIG 4: Conservative Attorney (Risk Averse)
  // =====================================================
  {
    name: 'V4-Conservative',
    description: 'Conservative weighting - higher floors, emphasis on legal strength',
    attorney_explanation: `
      For risk-averse evaluation. Requires stronger evidence across all factors.
      Higher floors mean patents need to be solid everywhere.
      Legal strength weighted more heavily.
    `,
    target_citation_coverage: 92,
    factors: [
      {
        name: 'MarketEvidence',
        description: 'Competitor usage evidence',
        floor: 0.10,  // Higher floor
        metrics: [
          {
            field: 'competitor_citations', name: 'Competitor Citations', weight: 0.70,
            normalize: {
              type: 'tiered_continuous',
              tiers: [
                { min: 0, max: 1, baseValue: 0.08, slope: 0.12 },
                { min: 1, max: 3, baseValue: 0.20, slope: 0.15 },
                { min: 3, max: 8, baseValue: 0.35, slope: 0.25 },
                { min: 8, max: 20, baseValue: 0.60, slope: 0.30 },
                { min: 20, max: 100, baseValue: 0.90, slope: 0.10 },
              ]
            }
          },
          { field: 'competitor_count', name: 'Competitor Breadth', weight: 0.30, normalize: { type: 'linear', max: 8 } },
        ]
      },
      {
        name: 'LegalStrength',
        description: 'Legal defensibility',
        floor: 0.30,  // High floor - must be legally strong
        ceiling: 1.0,
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 2.5 },
          { field: 'validity_score', name: 'Prior Art', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 2.5 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 2.5 },
          { field: 'claim_breadth', name: 'Claim Scope', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'ExecutionRisk',
        description: 'Execution and collection risk',
        floor: 0.30,  // High floor
        metrics: [
          { field: 'enforcement_clarity', name: 'Proof Difficulty', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 2.5 },
          { field: 'ipr_risk_score', name: 'IPR Risk', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.5 },
          { field: 'design_around_difficulty', name: 'Design Around', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'Timeline',
        description: 'Time runway',
        floor: 0.20,
        metrics: [
          {
            field: 'years_remaining', name: 'Years', weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 10, value: 1.0 },
                { threshold: 7, value: 0.80 },
                { threshold: 5, value: 0.50 },
                { threshold: 3, value: 0.25 },
                { threshold: 0, value: 0.15 },
              ]
            }
          }
        ]
      }
    ]
  },

  // =====================================================
  // CONFIG 5: Aggressive Attorney (Opportunity Focused)
  // =====================================================
  {
    name: 'V4-Aggressive',
    description: 'Aggressive weighting - lower floors, emphasis on market opportunity',
    attorney_explanation: `
      For opportunity-focused evaluation. Willing to take cases with some risk
      if market opportunity is strong. Lower floors allow more patents through.
      Market evidence weighted more heavily.
    `,
    target_citation_coverage: 97,
    factors: [
      {
        name: 'MarketOpportunity',
        description: 'Market and revenue opportunity',
        floor: 0.03,  // Low floor - allow opportunity
        metrics: [
          {
            field: 'competitor_citations', name: 'Competitor Evidence', weight: 0.55,
            normalize: {
              type: 'tiered_continuous',
              tiers: [
                { min: 0, max: 1, baseValue: 0.02, slope: 0.13 },
                { min: 1, max: 3, baseValue: 0.15, slope: 0.25 },
                { min: 3, max: 6, baseValue: 0.40, slope: 0.20 },
                { min: 6, max: 15, baseValue: 0.60, slope: 0.25 },
                { min: 15, max: 100, baseValue: 0.85, slope: 0.15 },
              ]
            }
          },
          { field: 'competitor_count', name: 'Target Breadth', weight: 0.20, normalize: { type: 'sqrt', max: 10 } },
          { field: 'forward_citations', name: 'Tech Importance', weight: 0.15, normalize: { type: 'sqrt', max: 400 } },
          { field: 'market_relevance_score', name: 'Market Relevance', weight: 0.10, normalize: { type: 'score5' }, defaultValue: 3.5 },
        ]
      },
      {
        name: 'LegalViability',
        description: 'Can we make the case?',
        floor: 0.15,  // Lower floor
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.2 },
          { field: 'validity_score', name: 'Prior Art', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.2 },
          { field: 'prosecution_quality_score', name: 'Prosecution', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'claim_breadth', name: 'Claim Scope', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'CollectionPotential',
        description: 'Can we collect?',
        floor: 0.20,
        metrics: [
          { field: 'enforcement_clarity', name: 'Proof', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'design_around_difficulty', name: 'Sticky Tech', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'ipr_risk_score', name: 'IPR Defense', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 4 },
        ]
      },
      {
        name: 'TimeValue',
        description: 'Time runway',
        floor: 0.10,  // Lower floor - accept shorter runway
        metrics: [
          {
            field: 'years_remaining', name: 'Years', weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 10, value: 1.0 },
                { threshold: 6, value: 0.80 },
                { threshold: 4, value: 0.55 },
                { threshold: 3, value: 0.35 },
                { threshold: 0, value: 0.15 },
              ]
            }
          }
        ]
      }
    ]
  },

  // =====================================================
  // CONFIG 6: Licensing Focus (vs Litigation)
  // =====================================================
  {
    name: 'V4-Licensing',
    description: 'Optimized for licensing negotiations, not litigation',
    attorney_explanation: `
      For licensing-focused evaluation. Broader claims and more targets matter more.
      Less emphasis on litigation timeline since licensing can happen faster.
      Market presence and claim breadth weighted heavily.
    `,
    target_citation_coverage: 90,
    factors: [
      {
        name: 'TargetRichness',
        description: 'How many potential licensees?',
        floor: 0.05,
        metrics: [
          {
            field: 'competitor_citations', name: 'Known Users', weight: 0.45,
            normalize: {
              type: 'tiered_continuous',
              tiers: [
                { min: 0, max: 1, baseValue: 0.05, slope: 0.15 },
                { min: 1, max: 5, baseValue: 0.20, slope: 0.25 },
                { min: 5, max: 15, baseValue: 0.45, slope: 0.25 },
                { min: 15, max: 50, baseValue: 0.70, slope: 0.30 },
              ]
            }
          },
          { field: 'competitor_count', name: 'Target Diversity', weight: 0.30, normalize: { type: 'sqrt', max: 10 } },
          { field: 'forward_citations', name: 'Industry Adoption', weight: 0.25, normalize: { type: 'sqrt', max: 400 } },
        ]
      },
      {
        name: 'PatentStrength',
        description: 'Credible threat for negotiation',
        floor: 0.20,
        metrics: [
          { field: 'claim_breadth', name: 'Claim Coverage', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'validity_score', name: 'Validity', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'design_around_difficulty', name: 'Lock-in', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'NegotiationLeverage',
        description: 'Strength at the table',
        floor: 0.25,
        metrics: [
          { field: 'enforcement_clarity', name: 'Clear Infringement', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3 },
          { field: 'ipr_risk_score', name: 'Challenge Resistant', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 4 },
          { field: 'prosecution_quality_score', name: 'Clean History', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3 },
        ]
      },
      {
        name: 'TermValue',
        description: 'Remaining monetization window',
        floor: 0.20,
        metrics: [
          {
            field: 'years_remaining', name: 'Years', weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 8, value: 1.0 },   // 8+ years: long licensing runway
                { threshold: 5, value: 0.75 },  // 5-8: good
                { threshold: 3, value: 0.50 },  // 3-5: still licensable
                { threshold: 0, value: 0.25 },  // <3: limited but possible
              ]
            }
          }
        ]
      }
    ]
  },
];

// =============================================================================
// DATA LOADERS (same as v1)
// =============================================================================

function loadMultiScoreAnalysis(): Map<string, any> {
  const files = fs.readdirSync('./output')
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort().reverse();
  if (files.length === 0) return new Map();
  const data = JSON.parse(fs.readFileSync(`./output/${files[0]}`, 'utf-8'));
  const map = new Map<string, any>();
  for (const p of data.patents || []) map.set(p.patent_id, p);
  console.log(`Loaded ${map.size} patents from multi-score analysis`);
  return map;
}

function loadLLMAnalysis(): Map<string, any> {
  const map = new Map<string, any>();

  const v1Dir = './output/llm-analysis/combined';
  if (fs.existsSync(v1Dir)) {
    const v1Files = fs.readdirSync(v1Dir).filter(f => f.startsWith('combined-rankings-') && f.endsWith('.json')).sort().reverse();
    if (v1Files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${v1Dir}/${v1Files[0]}`, 'utf-8'));
      for (const record of data.data?.records || []) {
        map.set(record.patent_id, { ...map.get(record.patent_id), ...record.llm_analysis });
      }
    }
  }

  const v3Dir = './output/llm-analysis-v3';
  if (fs.existsSync(v3Dir)) {
    const v3Files = fs.readdirSync(v3Dir).filter(f => f.startsWith('combined-v3-') && f.endsWith('.json')).sort();
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
  const dir = './output/ipr';
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.startsWith('ipr-risk-check-') && f.endsWith('.json')).sort().reverse();
    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'));
      for (const r of data.results || []) map.set(r.patent_id, r);
    }
  }
  console.log(`Loaded ${map.size} patents with IPR data`);
  return map;
}

function loadProsecutionData(): Map<string, any> {
  const map = new Map<string, any>();
  const dir = './output/prosecution';
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter(f => f.startsWith('prosecution-history-') && f.endsWith('.json')).sort().reverse();
    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(`${dir}/${files[0]}`, 'utf-8'));
      for (const r of data.results || []) map.set(r.patent_id, r);
    }
  }
  console.log(`Loaded ${map.size} patents with prosecution data`);
  return map;
}

// =============================================================================
// SCORING ENGINE
// =============================================================================

interface ScoreResult {
  finalScore: number;
  factorScores: Record<string, number>;
  normalizedMetrics: Record<string, number>;
}

function calculateFactorScore(patent: PatentData, factor: FactorConfig): { score: number; metrics: Record<string, number> } {
  let weightedSum = 0;
  let totalWeight = 0;
  const metrics: Record<string, number> = {};

  for (const metric of factor.metrics) {
    const rawValue = patent[metric.field as keyof PatentData] as number | undefined;
    const normalized = normalize(rawValue, metric.normalize, metric.defaultValue);
    metrics[metric.name] = normalized;
    weightedSum += metric.weight * normalized;
    totalWeight += metric.weight;
  }

  let score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Apply floor and ceiling
  if (factor.floor !== undefined) score = Math.max(factor.floor, score);
  if (factor.ceiling !== undefined) score = Math.min(factor.ceiling, score);

  return { score, metrics };
}

function calculateScore(patent: PatentData, config: ScoringConfig): ScoreResult {
  const factorScores: Record<string, number> = {};
  const normalizedMetrics: Record<string, number> = {};

  // Calculate each factor
  for (const factor of config.factors) {
    const { score, metrics } = calculateFactorScore(patent, factor);
    factorScores[factor.name] = score;
    Object.assign(normalizedMetrics, metrics);
  }

  // Multiplicative combination of factors
  let finalScore = 1;
  for (const score of Object.values(factorScores)) {
    finalScore *= score;
  }

  // Scale to 0-100
  finalScore *= 100;

  return { finalScore, factorScores, normalizedMetrics };
}

// =============================================================================
// PATENT TRACKING
// =============================================================================

interface PatentMovement {
  patent_id: string;
  title: string;
  competitor_citations: number;
  years_remaining: number;
  competitors: string[];
  baselineRank: number;
  newRank: number;
  rankChange: number;
  baselineScore: number;
  newScore: number;
  factorBreakdown: Record<string, number>;
  reason: string;
}

function analyzePatentMovement(
  patent: PatentData,
  baselineRank: number,
  newRank: number,
  baselineScore: number,
  newScoreResult: ScoreResult
): PatentMovement {
  const reasons: string[] = [];

  // Analyze why this patent moved
  if (patent.competitor_citations === 0) {
    reasons.push('No competitor citations');
  } else if (patent.competitor_citations >= 10) {
    reasons.push(`Strong citations (${patent.competitor_citations})`);
  }

  if (patent.years_remaining < 5) {
    reasons.push(`Short runway (${patent.years_remaining.toFixed(1)} yrs)`);
  } else if (patent.years_remaining >= 12) {
    reasons.push(`Long runway (${patent.years_remaining.toFixed(1)} yrs)`);
  }

  // Check which factors are weak/strong
  for (const [factor, score] of Object.entries(newScoreResult.factorScores)) {
    if (score < 0.3) reasons.push(`Weak ${factor} (${score.toFixed(2)})`);
    if (score > 0.7) reasons.push(`Strong ${factor} (${score.toFixed(2)})`);
  }

  return {
    patent_id: patent.patent_id,
    title: patent.title?.substring(0, 60) || '',
    competitor_citations: patent.competitor_citations,
    years_remaining: patent.years_remaining,
    competitors: patent.competitors?.slice(0, 3) || [],
    baselineRank,
    newRank,
    rankChange: baselineRank - newRank,
    baselineScore,
    newScore: newScoreResult.finalScore,
    factorBreakdown: newScoreResult.factorScores,
    reason: reasons.slice(0, 3).join('; ')
  };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('SCORING TEST HARNESS V2 - Attorney-Friendly Configurations');
  console.log('='.repeat(80));
  console.log(`\nComparing ${SCORING_CONFIGS.length} configurations on top ${TOP_N} patents\n`);

  // Load data
  const multiScore = loadMultiScoreAnalysis();
  const llmData = loadLLMAnalysis();
  const iprData = loadIPRData();
  const prosData = loadProsecutionData();

  if (multiScore.size === 0) {
    console.error('No patent data found!');
    process.exit(1);
  }

  // Build patent records
  const patents: PatentData[] = [];
  for (const [patentId, baseData] of multiScore) {
    const llm = llmData.get(patentId) || {};
    const ipr = iprData.get(patentId) || {};
    const pros = prosData.get(patentId) || {};

    const yearsRemaining = baseData.years_remaining || baseData.remaining_years || 0;
    if (yearsRemaining < 3) continue;  // Hard filter

    patents.push({
      patent_id: patentId,
      title: baseData.title || '',
      grant_date: baseData.date || baseData.grant_date || '',
      assignee: baseData.assignee || '',
      forward_citations: baseData.forward_citations || 0,
      years_remaining: yearsRemaining,
      competitor_citations: baseData.competitor_citations || 0,
      competitor_count: (baseData.competitors || baseData.topCompetitors || []).length,
      competitors: baseData.competitors || baseData.topCompetitors || [],
      eligibility_score: llm.eligibility_score,
      validity_score: llm.validity_score,
      claim_breadth: llm.claim_breadth,
      enforcement_clarity: llm.enforcement_clarity,
      design_around_difficulty: llm.design_around_difficulty,
      market_relevance_score: llm.market_relevance_score,
      ipr_risk_score: ipr.ipr_risk_score,
      prosecution_quality_score: pros.prosecution_quality_score,
    });
  }

  console.log(`\nAnalyzing ${patents.length} patents (after <3 year filter)\n`);

  // Calculate scores for each config
  const results: Map<string, { patent: PatentData; score: ScoreResult }[]> = new Map();

  for (const config of SCORING_CONFIGS) {
    const scored = patents.map(p => ({
      patent: p,
      score: calculateScore(p, config)
    }));
    scored.sort((a, b) => b.score.finalScore - a.score.finalScore);
    results.set(config.name, scored);
  }

  // Display results
  console.log('='.repeat(80));
  console.log('TOP 15 PATENTS BY CONFIGURATION');
  console.log('='.repeat(80));

  for (const config of SCORING_CONFIGS) {
    const scored = results.get(config.name)!;
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`${config.name}: ${config.description}`);
    console.log(`${'─'.repeat(80)}`);

    for (let i = 0; i < Math.min(15, scored.length); i++) {
      const { patent, score } = scored[i];
      const factors = Object.entries(score.factorScores)
        .map(([k, v]) => `${k.substring(0, 6)}:${v.toFixed(2)}`)
        .join(' ');
      const competitorStr = patent.competitors?.slice(0, 2).join(',') || '-';

      console.log(
        `${String(i + 1).padStart(2)}. ${patent.patent_id} ` +
        `Score:${score.finalScore.toFixed(1).padStart(5)} ` +
        `[${factors}] ` +
        `CC:${String(patent.competitor_citations).padStart(2)} ` +
        `Yrs:${patent.years_remaining.toFixed(1)} ` +
        `(${competitorStr})`
      );
    }
  }

  // Summary statistics
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY STATISTICS');
  console.log('='.repeat(80));

  const summaryTable: any[] = [];
  const baselineConfig = SCORING_CONFIGS[0];
  const baselineScored = results.get(baselineConfig.name)!;
  const baselineRanks = new Map<string, number>();
  baselineScored.forEach((item, idx) => baselineRanks.set(item.patent.patent_id, idx + 1));

  for (const config of SCORING_CONFIGS) {
    const scored = results.get(config.name)!;
    const top = scored.slice(0, TOP_N);

    const withCC = top.filter(t => t.patent.competitor_citations > 0).length;
    const avgCC = top.reduce((s, t) => s + t.patent.competitor_citations, 0) / TOP_N;
    const avgYears = top.reduce((s, t) => s + t.patent.years_remaining, 0) / TOP_N;
    const avgScore = top.reduce((s, t) => s + t.score.finalScore, 0) / TOP_N;
    const withLLM = top.filter(t => t.patent.eligibility_score !== undefined).length;

    // Count changed from baseline
    const baselineTop = new Set(baselineScored.slice(0, TOP_N).map(s => s.patent.patent_id));
    const configTop = new Set(top.map(s => s.patent.patent_id));
    let changed = 0;
    for (const id of configTop) if (!baselineTop.has(id)) changed++;

    summaryTable.push({
      config: config.name,
      withCC,
      pctCC: (withCC / TOP_N * 100).toFixed(0) + '%',
      avgCC: avgCC.toFixed(1),
      avgYears: avgYears.toFixed(1),
      avgScore: avgScore.toFixed(1),
      withLLM: withLLM,
      changed,
      target: config.target_citation_coverage + '%'
    });

    console.log(`\n${config.name}:`);
    console.log(`  With Citations: ${withCC}/${TOP_N} (${(withCC / TOP_N * 100).toFixed(0)}%) [target: ${config.target_citation_coverage}%]`);
    console.log(`  Avg CC: ${avgCC.toFixed(1)} | Avg Years: ${avgYears.toFixed(1)} | Avg Score: ${avgScore.toFixed(1)}`);
    console.log(`  With LLM: ${withLLM}/${TOP_N} | Changed from baseline: ${changed}`);
  }

  // Patent movement tracking
  if (TRACK_PATENTS || true) {  // Always do basic tracking
    console.log('\n' + '='.repeat(80));
    console.log('PATENT MOVEMENT TRACKING');
    console.log('='.repeat(80));

    for (const config of SCORING_CONFIGS.slice(1)) {  // Skip baseline
      const scored = results.get(config.name)!;
      const movements: PatentMovement[] = [];

      scored.slice(0, TOP_N).forEach((item, idx) => {
        const baseRank = baselineRanks.get(item.patent.patent_id) || patents.length;
        const newRank = idx + 1;
        const baseItem = baselineScored.find(b => b.patent.patent_id === item.patent.patent_id);
        const baseScore = baseItem?.score.finalScore || 0;

        if (Math.abs(baseRank - newRank) > 50) {
          movements.push(analyzePatentMovement(
            item.patent, baseRank, newRank, baseScore, item.score
          ));
        }
      });

      // Top risers and fallers
      const risers = movements.filter(m => m.rankChange > 0).sort((a, b) => b.rankChange - a.rankChange).slice(0, 5);
      const fallers = movements.filter(m => m.rankChange < 0).sort((a, b) => a.rankChange - b.rankChange).slice(0, 5);

      console.log(`\n--- ${config.name} vs Baseline ---`);

      if (risers.length > 0) {
        console.log(`  TOP RISERS (moved up 50+ ranks):`);
        for (const m of risers) {
          console.log(`    ${m.patent_id}: #${m.baselineRank} → #${m.newRank} (+${m.rankChange})`);
          console.log(`      CC:${m.competitor_citations} Yrs:${m.years_remaining.toFixed(1)} | ${m.reason}`);
        }
      }

      if (fallers.length > 0) {
        console.log(`  TOP FALLERS (dropped 50+ ranks):`);
        for (const m of fallers) {
          console.log(`    ${m.patent_id}: #${m.baselineRank} → #${m.newRank} (${m.rankChange})`);
          console.log(`      CC:${m.competitor_citations} Yrs:${m.years_remaining.toFixed(1)} | ${m.reason}`);
        }
      }
    }
  }

  // Export comparison CSV
  const timestamp = new Date().toISOString().split('T')[0];
  const csvPath = `./output/scoring-comparison-v2-${timestamp}.csv`;

  const headers = [
    'patent_id', 'title', 'competitor_citations', 'competitor_count', 'competitors',
    'forward_citations', 'years_remaining',
    'eligibility', 'validity', 'claim_breadth', 'enforcement', 'design_around',
    'ipr_risk', 'prosecution',
    ...SCORING_CONFIGS.flatMap(c => [`score_${c.name}`, `rank_${c.name}`])
  ];

  const rankMaps = new Map<string, Map<string, number>>();
  for (const config of SCORING_CONFIGS) {
    const ranks = new Map<string, number>();
    results.get(config.name)!.forEach((item, idx) => ranks.set(item.patent.patent_id, idx + 1));
    rankMaps.set(config.name, ranks);
  }

  const csvRows = [headers.join(',')];
  const maxExport = Math.min(TOP_N * 2, baselineScored.length);

  for (let i = 0; i < maxExport; i++) {
    const { patent } = baselineScored[i];
    const row = [
      patent.patent_id,
      `"${(patent.title || '').replace(/"/g, '""').substring(0, 80)}"`,
      patent.competitor_citations,
      patent.competitor_count,
      `"${(patent.competitors || []).slice(0, 3).join('; ')}"`,
      patent.forward_citations,
      patent.years_remaining.toFixed(1),
      patent.eligibility_score ?? '',
      patent.validity_score ?? '',
      patent.claim_breadth ?? '',
      patent.enforcement_clarity ?? '',
      patent.design_around_difficulty ?? '',
      patent.ipr_risk_score ?? '',
      patent.prosecution_quality_score ?? '',
      ...SCORING_CONFIGS.flatMap(c => {
        const scored = results.get(c.name)!;
        const item = scored.find(s => s.patent.patent_id === patent.patent_id);
        return [
          item?.score.finalScore.toFixed(2) || '',
          rankMaps.get(c.name)!.get(patent.patent_id) || ''
        ];
      })
    ];
    csvRows.push(row.join(','));
  }

  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\n\nExported: ${csvPath}`);

  // Export detailed JSON for further analysis
  const jsonPath = `./output/scoring-comparison-v2-${timestamp}.json`;
  const exportData = {
    generated: new Date().toISOString(),
    configurations: SCORING_CONFIGS.map(c => ({
      name: c.name,
      description: c.description,
      attorney_explanation: c.attorney_explanation,
      target_citation_coverage: c.target_citation_coverage,
      factors: c.factors.map(f => ({ name: f.name, description: f.description, floor: f.floor }))
    })),
    summary: summaryTable,
    top_patents_by_config: Object.fromEntries(
      SCORING_CONFIGS.map(c => [
        c.name,
        results.get(c.name)!.slice(0, 50).map((item, idx) => ({
          rank: idx + 1,
          patent_id: item.patent.patent_id,
          score: item.score.finalScore,
          factors: item.score.factorScores,
          competitor_citations: item.patent.competitor_citations,
          years_remaining: item.patent.years_remaining,
          competitors: item.patent.competitors?.slice(0, 3)
        }))
      ])
    )
  };

  fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));
  console.log(`Exported: ${jsonPath}`);

  console.log('\n' + '='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
}

main().catch(console.error);
