/**
 * Scoring Test Harness V3 - Stakeholder Voting Profiles
 *
 * Profile Design Principles:
 * 1. Each profile represents a stakeholder who would vote on portfolio value
 * 2. All profiles target 95%+ citation coverage (actionable patents)
 * 3. Profiles differ in how they weight factors WITHIN that constraint
 * 4. Framework ready for sector-specific signals (additive within factors)
 *
 * Stakeholder Categories:
 * - IP Litigators (aggressive, balanced, conservative)
 * - Licensing Specialists
 * - Corporate/M&A Attorneys
 * - Executive/Portfolio Management
 *
 * Usage: npx tsx scripts/scoring-test-harness-v3.ts [--validate] [--top N]
 */

import * as fs from 'fs';

const TOP_N = parseInt(process.argv.find(a => a.startsWith('--top='))?.split('=')[1] || '250');
const VALIDATE = process.argv.includes('--validate');

// =============================================================================
// GOALPOSTS - All profiles must meet these criteria
// =============================================================================

const GOALPOSTS = {
  min_citation_coverage: 0.93,  // At least 93% of top N should have citations
  max_citation_coverage: 0.99,  // But not 100% - allow some exceptional non-cited
  min_avg_years: 6.0,           // Average years remaining should be reasonable
  max_avg_years: 14.0,          // But not dominated by long-term only
};

// =============================================================================
// DATA STRUCTURES
// =============================================================================

interface PatentData {
  patent_id: string;
  title: string;
  forward_citations: number;
  years_remaining: number;
  competitor_citations: number;
  competitor_count: number;
  competitors: string[];
  sector?: string;

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
  implementation_type?: string;  // software, hardware, firmware, hybrid
  standards_relevance?: string;  // none, related, likely_essential
}

interface FactorConfig {
  name: string;
  description: string;
  floor: number;
  ceiling?: number;
  metrics: MetricConfig[];
}

interface MetricConfig {
  field: keyof PatentData | 'computed';
  name: string;
  weight: number;
  normalize: NormalizeConfig;
  defaultValue?: number;
  // Future: sector-specific overrides
  sectorOverrides?: Record<string, { weight?: number; defaultValue?: number }>;
}

interface NormalizeConfig {
  type: 'linear' | 'sqrt' | 'log' | 'stepped' | 'tiered_continuous' | 'score5';
  max?: number;
  steps?: { threshold: number; value: number }[];
  tiers?: { min: number; max: number; baseValue: number; slope: number }[];
}

interface ScoringProfile {
  id: string;
  name: string;
  stakeholder: string;
  description: string;
  rationale: string;
  factors: FactorConfig[];
}

// =============================================================================
// NORMALIZATION (same as V2)
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
// COMMON METRIC DEFINITIONS (reusable across profiles)
// =============================================================================

// Citation metric tuned for 95%+ coverage
// Key: 0 citations must result in very low score to hit goalposts
const CITATIONS_METRIC_STANDARD: MetricConfig = {
  field: 'competitor_citations',
  name: 'Competitor Citations',
  weight: 0.65,  // Increased weight
  normalize: {
    type: 'tiered_continuous',
    tiers: [
      { min: 0, max: 1, baseValue: 0.01, slope: 0.14 },   // 0 → 0.01, approaches 0.15 at 1 (more punitive)
      { min: 1, max: 3, baseValue: 0.15, slope: 0.30 },   // 1-3 → 0.15-0.45
      { min: 3, max: 8, baseValue: 0.45, slope: 0.25 },   // 3-8 → 0.45-0.70
      { min: 8, max: 20, baseValue: 0.70, slope: 0.20 },  // 8-20 → 0.70-0.90
      { min: 20, max: 100, baseValue: 0.90, slope: 0.10 }, // 20+ → 0.90-1.0
    ]
  }
};

// Even more aggressive citation metric for profiles that need higher coverage
const CITATIONS_METRIC_AGGRESSIVE: MetricConfig = {
  field: 'competitor_citations',
  name: 'Competitor Citations',
  weight: 0.70,
  normalize: {
    type: 'tiered_continuous',
    tiers: [
      { min: 0, max: 1, baseValue: 0.005, slope: 0.145 },  // 0 → 0.005 (near-zero)
      { min: 1, max: 3, baseValue: 0.15, slope: 0.35 },    // 1-3 → 0.15-0.50
      { min: 3, max: 8, baseValue: 0.50, slope: 0.25 },    // 3-8 → 0.50-0.75
      { min: 8, max: 20, baseValue: 0.75, slope: 0.18 },   // 8-20 → 0.75-0.93
      { min: 20, max: 100, baseValue: 0.93, slope: 0.07 }, // 20+ → 0.93-1.0
    ]
  }
};

// Year metric with litigation timeline steps
const YEARS_METRIC_LITIGATION: MetricConfig = {
  field: 'years_remaining',
  name: 'Litigation Timeline',
  weight: 1.0,
  normalize: {
    type: 'stepped',
    steps: [
      { threshold: 10, value: 1.00 },  // 10+ years: full value
      { threshold: 7, value: 0.85 },   // 7-10: slight reduction
      { threshold: 5, value: 0.60 },   // 5-7: moderate (litigation may push limits)
      { threshold: 4, value: 0.40 },   // 4-5: significant penalty
      { threshold: 3, value: 0.25 },   // 3-4: severe (may not complete)
      { threshold: 0, value: 0.10 },   // <3: filtered but included if exceptional
    ]
  }
};

// Year metric for damages/royalty calculation
const YEARS_METRIC_DAMAGES: MetricConfig = {
  field: 'years_remaining',
  name: 'Royalty Window',
  weight: 0.20,
  normalize: {
    type: 'stepped',
    steps: [
      { threshold: 12, value: 1.00 },
      { threshold: 8, value: 0.80 },
      { threshold: 5, value: 0.55 },
      { threshold: 3, value: 0.30 },
      { threshold: 0, value: 0.10 },
    ]
  }
};

// =============================================================================
// STAKEHOLDER PROFILES
// =============================================================================

const PROFILES: ScoringProfile[] = [

  // =========================================================================
  // IP LITIGATOR - AGGRESSIVE
  // =========================================================================
  {
    id: 'ip-lit-aggressive',
    name: 'IP Litigator (Aggressive)',
    stakeholder: 'IP Litigation Attorney - Plaintiff-side, contingency or hybrid fee',
    description: 'Willing to take calculated legal risks for high-value targets',
    rationale: `
      This litigator looks for cases with strong market evidence (many citations = many infringers).
      They're willing to accept moderate 101/validity risk if the potential damages are large.
      Timeline flexibility is moderate - they'll take shorter-runway cases if evidence is strong.
      They weight market opportunity highest because that drives settlement value.
    `,
    factors: [
      {
        name: 'MarketOpportunity',
        description: 'Evidence of commercial infringement and damages potential',
        floor: 0.02,  // Very low floor - citations must drive this factor
        metrics: [
          { ...CITATIONS_METRIC_AGGRESSIVE, weight: 0.60 },  // Use aggressive citation metric
          { field: 'competitor_count', name: 'Target Breadth', weight: 0.20, normalize: { type: 'sqrt', max: 10 } },
          { field: 'forward_citations', name: 'Tech Importance', weight: 0.08, normalize: { type: 'sqrt', max: 400 } },
          { field: 'market_relevance_score', name: 'Market Relevance', weight: 0.12, normalize: { type: 'score5' }, defaultValue: 3.2 },
        ]
      },
      {
        name: 'LegalMerit',
        description: 'Likelihood of surviving challenges (accepting some risk)',
        floor: 0.15,  // Low floor - will take cases with moderate legal strength
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Prior Art Defense', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'claim_breadth', name: 'Claim Scope', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Clean History', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'CollectionYield',
        description: 'Can we prove infringement and collect?',
        floor: 0.20,
        metrics: [
          { field: 'enforcement_clarity', name: 'Proof of Use', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Lock-in', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'IPR Survival', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'Timeline',
        description: 'Sufficient runway for litigation',
        floor: 0.12,  // Lower floor - accept shorter runways
        metrics: [YEARS_METRIC_LITIGATION]
      }
    ]
  },

  // =========================================================================
  // IP LITIGATOR - BALANCED
  // =========================================================================
  {
    id: 'ip-lit-balanced',
    name: 'IP Litigator (Balanced)',
    stakeholder: 'IP Litigation Attorney - Mixed portfolio, hourly + success fee',
    description: 'Balanced view weighing both market opportunity and legal strength',
    rationale: `
      This litigator wants a balanced case - good market evidence AND reasonable legal strength.
      They won't take a case just because it has many citations if legal merit is weak.
      They won't pursue a legally perfect patent if there's no evidence of infringement.
      This is the "reasonable attorney" benchmark.
    `,
    factors: [
      {
        name: 'MarketEvidence',
        description: 'Proof of commercial relevance',
        floor: 0.012,  // Even lower floor
        metrics: [
          { ...CITATIONS_METRIC_AGGRESSIVE, weight: 0.75 },  // Even higher weight
          { field: 'competitor_count', name: 'Target Diversity', weight: 0.15, normalize: { type: 'linear', max: 8 } },
          { field: 'market_relevance_score', name: 'Market Fit', weight: 0.10, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'LegalStrength',
        description: 'Case strength on the merits',
        floor: 0.17,  // Lower floor
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Prior Art', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'claim_breadth', name: 'Claim Scope', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'File History', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'EnforcementViability',
        description: 'Practical enforcement considerations',
        floor: 0.25,
        metrics: [
          { field: 'enforcement_clarity', name: 'Detectability', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Stickiness', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'IPR Defense', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'TimelineValue',
        description: 'Remaining enforcement window',
        floor: 0.15,
        metrics: [YEARS_METRIC_LITIGATION]
      }
    ]
  },

  // =========================================================================
  // IP LITIGATOR - CONSERVATIVE
  // =========================================================================
  {
    id: 'ip-lit-conservative',
    name: 'IP Litigator (Conservative)',
    stakeholder: 'IP Litigation Attorney - Defense-side experience, risk-averse',
    description: 'Prioritizes legal strength and low risk over market opportunity',
    rationale: `
      This litigator has seen many cases fail due to legal weaknesses.
      They prioritize patents with strong 101 eligibility and validity.
      They want clean prosecution history and low IPR risk.
      Market evidence matters but won't override legal concerns.
    `,
    factors: [
      {
        name: 'LegalFoundation',
        description: 'Strong legal foundation is prerequisite',
        floor: 0.30,  // High floor - must be legally solid
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 2.8 },
          { field: 'validity_score', name: 'Prior Art', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 2.8 },
          { field: 'prosecution_quality_score', name: 'Clean History', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 2.8 },
          { field: 'claim_breadth', name: 'Claim Scope', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'MarketValidation',
        description: 'Market evidence validates pursuit',
        floor: 0.05,  // Slightly higher floor to allow exceptional non-cited patents
        metrics: [
          { ...CITATIONS_METRIC_STANDARD, weight: 0.65 },  // Use standard (less punitive) metric
          { field: 'competitor_count', name: 'Target Count', weight: 0.20, normalize: { type: 'linear', max: 8 } },
          { field: 'forward_citations', name: 'Tech Importance', weight: 0.15, normalize: { type: 'sqrt', max: 300 } },
        ]
      },
      {
        name: 'RiskMitigation',
        description: 'Low risk of failure or reversal',
        floor: 0.35,  // High floor - risk averse
        metrics: [
          { field: 'ipr_risk_score', name: 'IPR Defense', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.5 },
          { field: 'enforcement_clarity', name: 'Clear Proof', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'No Easy Exit', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'TimelineMargin',
        description: 'Comfortable timeline with buffer',
        floor: 0.20,  // Want longer runway
        metrics: [
          {
            field: 'years_remaining',
            name: 'Years with Buffer',
            weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 12, value: 1.00 },  // Want 12+ for comfort
                { threshold: 9, value: 0.85 },
                { threshold: 7, value: 0.65 },
                { threshold: 5, value: 0.40 },
                { threshold: 3, value: 0.20 },
                { threshold: 0, value: 0.10 },
              ]
            }
          }
        ]
      }
    ]
  },

  // =========================================================================
  // LICENSING SPECIALIST
  // =========================================================================
  {
    id: 'licensing',
    name: 'Licensing Specialist',
    stakeholder: 'IP Licensing Attorney/Executive',
    description: 'Focused on licensing revenue rather than litigation',
    rationale: `
      Licensing is faster than litigation - timeline less critical.
      Breadth of potential licensees matters more than individual case strength.
      Claim breadth and design-around difficulty drive negotiation leverage.
      Even patents with moderate legal strength can generate licensing revenue.
    `,
    factors: [
      {
        name: 'LicenseePool',
        description: 'How many potential licensees?',
        floor: 0.05,
        metrics: [
          { ...CITATIONS_METRIC_STANDARD, weight: 0.45 },
          { field: 'competitor_count', name: 'Target Diversity', weight: 0.30, normalize: { type: 'sqrt', max: 10 } },
          { field: 'forward_citations', name: 'Industry Adoption', weight: 0.25, normalize: { type: 'sqrt', max: 400 } },
        ]
      },
      {
        name: 'NegotiationLeverage',
        description: 'Strength at the licensing table',
        floor: 0.20,
        metrics: [
          { field: 'claim_breadth', name: 'Claim Coverage', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Lock-in', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'enforcement_clarity', name: 'Clear Infringement', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'Challenge Resistant', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'Credibility',
        description: 'Credible litigation threat backs negotiation',
        floor: 0.20,
        metrics: [
          { field: 'eligibility_score', name: '101 Eligibility', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Validity', weight: 0.40, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Clean History', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'TermValue',
        description: 'Remaining licensing window',
        floor: 0.20,  // Licensing can happen faster than litigation
        metrics: [
          {
            field: 'years_remaining',
            name: 'Licensing Window',
            weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 8, value: 1.00 },   // 8+ years: long runway
                { threshold: 5, value: 0.80 },   // 5-8: good
                { threshold: 3, value: 0.55 },   // 3-5: still licensable
                { threshold: 0, value: 0.25 },   // <3: quick deals possible
              ]
            }
          }
        ]
      }
    ]
  },

  // =========================================================================
  // CORPORATE M&A
  // =========================================================================
  {
    id: 'corporate-ma',
    name: 'Corporate/M&A',
    stakeholder: 'Corporate Attorney or M&A Executive',
    description: 'Portfolio value for transactions and strategic positioning',
    rationale: `
      In M&A contexts, patent portfolios are valued for:
      - Defensive value (cross-licensing leverage)
      - Technology coverage (freedom to operate)
      - Revenue potential (licensing programs)
      - Strategic positioning (market barriers)

      Less focused on individual case litigation merit, more on portfolio breadth.
    `,
    factors: [
      {
        name: 'StrategicValue',
        description: 'Strategic market positioning',
        floor: 0.03,  // Lower floor - citations matter even for M&A
        metrics: [
          { ...CITATIONS_METRIC_AGGRESSIVE, weight: 0.55 },  // Citations are key evidence
          { field: 'forward_citations', name: 'Tech Leadership', weight: 0.25, normalize: { type: 'sqrt', max: 500 } },
          { field: 'competitor_count', name: 'Market Coverage', weight: 0.20, normalize: { type: 'linear', max: 10 } },
        ]
      },
      {
        name: 'DefensiveStrength',
        description: 'Cross-licensing and counter-assertion value',
        floor: 0.20,
        metrics: [
          { field: 'claim_breadth', name: 'Claim Coverage', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Blocking Power', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'market_relevance_score', name: 'Market Relevance', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'AssetQuality',
        description: 'Quality indicators for due diligence',
        floor: 0.25,
        metrics: [
          { field: 'eligibility_score', name: 'Legal Soundness', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Validity', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Clean Title', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'ipr_risk_score', name: 'Durability', weight: 0.20, normalize: { type: 'score5' }, defaultValue: 4.0 },
        ]
      },
      {
        name: 'LifecycleValue',
        description: 'Remaining useful life',
        floor: 0.15,
        metrics: [
          {
            field: 'years_remaining',
            name: 'Asset Life',
            weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 10, value: 1.00 },
                { threshold: 7, value: 0.80 },
                { threshold: 5, value: 0.60 },
                { threshold: 3, value: 0.35 },
                { threshold: 0, value: 0.15 },
              ]
            }
          }
        ]
      }
    ]
  },

  // =========================================================================
  // EXECUTIVE PORTFOLIO
  // =========================================================================
  {
    id: 'executive',
    name: 'Executive/Portfolio',
    stakeholder: 'C-Suite, Board, Portfolio Management',
    description: 'High-level portfolio health and strategic value',
    rationale: `
      Executive view focuses on:
      - Overall portfolio strength vs competitors
      - Market positioning and barriers to entry
      - Revenue generation potential
      - Risk management (avoiding weak patents in portfolio)

      Less granular than litigation view, more strategic.
      Balances opportunity with reputation risk.
    `,
    factors: [
      {
        name: 'MarketPosition',
        description: 'Competitive positioning in key markets',
        floor: 0.02,  // Very low floor - market evidence must drive
        metrics: [
          { ...CITATIONS_METRIC_AGGRESSIVE, weight: 0.65 },  // Higher citation weight
          { field: 'forward_citations', name: 'Innovation Leadership', weight: 0.20, normalize: { type: 'sqrt', max: 500 } },
          { field: 'market_relevance_score', name: 'Market Alignment', weight: 0.15, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'PortfolioQuality',
        description: 'Overall asset quality',
        floor: 0.22,  // Slightly lower floor
        metrics: [
          { field: 'eligibility_score', name: 'Legal Soundness', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'validity_score', name: 'Defensibility', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'claim_breadth', name: 'Coverage', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'prosecution_quality_score', name: 'Clean History', weight: 0.25, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'MonetizationPotential',
        description: 'Revenue generation capability',
        floor: 0.20,
        metrics: [
          { field: 'competitor_count', name: 'Licensee Pool', weight: 0.35, normalize: { type: 'sqrt', max: 10 } },
          { field: 'enforcement_clarity', name: 'Actionability', weight: 0.35, normalize: { type: 'score5' }, defaultValue: 3.0 },
          { field: 'design_around_difficulty', name: 'Stickiness', weight: 0.30, normalize: { type: 'score5' }, defaultValue: 3.0 },
        ]
      },
      {
        name: 'AssetLongevity',
        description: 'Remaining strategic value window',
        floor: 0.18,
        metrics: [
          {
            field: 'years_remaining',
            name: 'Strategic Horizon',
            weight: 1.0,
            normalize: {
              type: 'stepped',
              steps: [
                { threshold: 10, value: 1.00 },
                { threshold: 7, value: 0.80 },
                { threshold: 5, value: 0.55 },
                { threshold: 3, value: 0.30 },
                { threshold: 0, value: 0.12 },
              ]
            }
          }
        ]
      }
    ]
  },
];

// =============================================================================
// SCORING ENGINE
// =============================================================================

interface ScoreResult {
  finalScore: number;
  factorScores: Record<string, number>;
}

function calculateScore(patent: PatentData, profile: ScoringProfile): ScoreResult {
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
    if (factor.ceiling) score = Math.min(factor.ceiling, score);
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
// VALIDATION
// =============================================================================

interface ValidationResult {
  profile: string;
  passed: boolean;
  citationCoverage: number;
  avgYears: number;
  violations: string[];
}

function validateProfile(
  profile: ScoringProfile,
  scored: { patent: PatentData; score: ScoreResult }[],
  topN: number
): ValidationResult {
  const top = scored.slice(0, topN);
  const withCC = top.filter(t => t.patent.competitor_citations > 0).length;
  const citationCoverage = withCC / topN;
  const avgYears = top.reduce((s, t) => s + t.patent.years_remaining, 0) / topN;

  const violations: string[] = [];

  if (citationCoverage < GOALPOSTS.min_citation_coverage) {
    violations.push(`Citation coverage ${(citationCoverage * 100).toFixed(1)}% < ${GOALPOSTS.min_citation_coverage * 100}%`);
  }
  if (citationCoverage > GOALPOSTS.max_citation_coverage) {
    violations.push(`Citation coverage ${(citationCoverage * 100).toFixed(1)}% > ${GOALPOSTS.max_citation_coverage * 100}%`);
  }
  if (avgYears < GOALPOSTS.min_avg_years) {
    violations.push(`Avg years ${avgYears.toFixed(1)} < ${GOALPOSTS.min_avg_years}`);
  }
  if (avgYears > GOALPOSTS.max_avg_years) {
    violations.push(`Avg years ${avgYears.toFixed(1)} > ${GOALPOSTS.max_avg_years}`);
  }

  return {
    profile: profile.id,
    passed: violations.length === 0,
    citationCoverage,
    avgYears,
    violations
  };
}

// =============================================================================
// DATA LOADERS (simplified)
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

  // Merge
  const patents: PatentData[] = [];
  for (const [id, base] of multiScore) {
    const years = base.years_remaining || base.remaining_years || 0;
    if (years < 3) continue;

    const llm = llmMap.get(id) || {};
    const ipr = iprMap.get(id) || {};
    const pros = prosMap.get(id) || {};

    patents.push({
      patent_id: id,
      title: base.title || '',
      forward_citations: base.forward_citations || 0,
      years_remaining: years,
      competitor_citations: base.competitor_citations || 0,
      competitor_count: (base.competitors || base.topCompetitors || []).length,
      competitors: base.competitors || base.topCompetitors || [],
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
  console.log('='.repeat(80));
  console.log('SCORING TEST HARNESS V3 - Stakeholder Voting Profiles');
  console.log('='.repeat(80));
  console.log(`\nGoalposts: Citation coverage ${GOALPOSTS.min_citation_coverage * 100}-${GOALPOSTS.max_citation_coverage * 100}%, Avg years ${GOALPOSTS.min_avg_years}-${GOALPOSTS.max_avg_years}`);
  console.log(`Profiles: ${PROFILES.length}`);
  console.log('');

  const patents = loadAllData();
  console.log(`\nLoaded ${patents.length} patents (after <3 year filter)\n`);

  // Score all patents with each profile
  const results = new Map<string, { patent: PatentData; score: ScoreResult }[]>();

  for (const profile of PROFILES) {
    const scored = patents.map(p => ({ patent: p, score: calculateScore(p, profile) }));
    scored.sort((a, b) => b.score.finalScore - a.score.finalScore);
    results.set(profile.id, scored);
  }

  // Validation
  console.log('='.repeat(80));
  console.log('PROFILE VALIDATION');
  console.log('='.repeat(80));

  const validations: ValidationResult[] = [];
  for (const profile of PROFILES) {
    const v = validateProfile(profile, results.get(profile.id)!, TOP_N);
    validations.push(v);

    const status = v.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`\n${status} ${profile.name}`);
    console.log(`   Citation Coverage: ${(v.citationCoverage * 100).toFixed(1)}% | Avg Years: ${v.avgYears.toFixed(1)}`);
    if (v.violations.length > 0) {
      for (const viol of v.violations) console.log(`   ⚠️  ${viol}`);
    }
  }

  // Top patents by profile
  console.log('\n' + '='.repeat(80));
  console.log('TOP 12 PATENTS BY PROFILE');
  console.log('='.repeat(80));

  for (const profile of PROFILES) {
    const scored = results.get(profile.id)!;
    console.log(`\n─── ${profile.name} (${profile.stakeholder}) ───`);

    for (let i = 0; i < Math.min(12, scored.length); i++) {
      const { patent, score } = scored[i];
      const factors = Object.entries(score.factorScores)
        .map(([k, v]) => `${k.substring(0, 5)}:${v.toFixed(2)}`)
        .join(' ');
      const comp = patent.competitors?.slice(0, 2).join(',') || '-';

      console.log(
        `${String(i + 1).padStart(2)}. ${patent.patent_id} ` +
        `${score.finalScore.toFixed(1).padStart(5)} ` +
        `[${factors}] ` +
        `CC:${String(patent.competitor_citations).padStart(2)} ` +
        `Yrs:${patent.years_remaining.toFixed(1)} ` +
        `(${comp})`
      );
    }
  }

  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  console.log(`\n${'Profile'.padEnd(25)} ${'Citations'.padStart(10)} ${'Avg CC'.padStart(8)} ${'Avg Yrs'.padStart(8)} ${'With LLM'.padStart(10)} ${'Status'.padStart(8)}`);
  console.log('-'.repeat(75));

  for (const profile of PROFILES) {
    const top = results.get(profile.id)!.slice(0, TOP_N);
    const withCC = top.filter(t => t.patent.competitor_citations > 0).length;
    const avgCC = top.reduce((s, t) => s + t.patent.competitor_citations, 0) / TOP_N;
    const avgYears = top.reduce((s, t) => s + t.patent.years_remaining, 0) / TOP_N;
    const withLLM = top.filter(t => t.patent.eligibility_score !== undefined).length;
    const v = validations.find(v => v.profile === profile.id)!;

    console.log(
      `${profile.name.padEnd(25)} ` +
      `${(withCC / TOP_N * 100).toFixed(0).padStart(8)}% ` +
      `${avgCC.toFixed(1).padStart(8)} ` +
      `${avgYears.toFixed(1).padStart(8)} ` +
      `${(withLLM / TOP_N * 100).toFixed(0).padStart(8)}% ` +
      `${(v.passed ? '✅' : '❌').padStart(8)}`
    );
  }

  // Patent 9569605 deep dive
  console.log('\n' + '='.repeat(80));
  console.log('PATENT DEEP DIVE: 9569605 (67 Apple citations, software method)');
  console.log('='.repeat(80));

  const patent9569605 = patents.find(p => p.patent_id === '9569605');
  if (patent9569605) {
    console.log(`\nRaw Metrics:`);
    console.log(`  Competitor Citations: ${patent9569605.competitor_citations}`);
    console.log(`  Years Remaining: ${patent9569605.years_remaining}`);
    console.log(`  101 Eligibility: ${patent9569605.eligibility_score || 'N/A'}`);
    console.log(`  Validity: ${patent9569605.validity_score || 'N/A'}`);
    console.log(`  Implementation: ${patent9569605.implementation_type || 'N/A'}`);

    console.log(`\nProfile Scores & Ranks:`);
    for (const profile of PROFILES) {
      const scored = results.get(profile.id)!;
      const idx = scored.findIndex(s => s.patent.patent_id === '9569605');
      const { score } = scored[idx];
      const factors = Object.entries(score.factorScores)
        .map(([k, v]) => `${k}:${v.toFixed(2)}`)
        .join(', ');
      console.log(`  ${profile.name.padEnd(28)} Rank: ${String(idx + 1).padStart(4)} | Score: ${score.finalScore.toFixed(1).padStart(5)} | ${factors}`);
    }
  }

  // Export
  const timestamp = new Date().toISOString().split('T')[0];
  const exportData = {
    generated: new Date().toISOString(),
    goalposts: GOALPOSTS,
    profiles: PROFILES.map(p => ({
      id: p.id,
      name: p.name,
      stakeholder: p.stakeholder,
      description: p.description,
      factors: p.factors.map(f => ({ name: f.name, description: f.description, floor: f.floor }))
    })),
    validations,
    summary: PROFILES.map(p => {
      const top = results.get(p.id)!.slice(0, TOP_N);
      return {
        profile: p.id,
        citation_coverage: top.filter(t => t.patent.competitor_citations > 0).length / TOP_N,
        avg_cc: top.reduce((s, t) => s + t.patent.competitor_citations, 0) / TOP_N,
        avg_years: top.reduce((s, t) => s + t.patent.years_remaining, 0) / TOP_N,
      };
    }),
    top_patents: Object.fromEntries(
      PROFILES.map(p => [
        p.id,
        results.get(p.id)!.slice(0, 50).map((item, idx) => ({
          rank: idx + 1,
          patent_id: item.patent.patent_id,
          score: item.score.finalScore,
          factors: item.score.factorScores,
          competitor_citations: item.patent.competitor_citations,
          years_remaining: item.patent.years_remaining,
          competitors: item.patent.competitors?.slice(0, 3),
        }))
      ])
    )
  };

  fs.writeFileSync(`./output/scoring-stakeholder-v3-${timestamp}.json`, JSON.stringify(exportData, null, 2));
  console.log(`\nExported: ./output/scoring-stakeholder-v3-${timestamp}.json`);

  // CSV export
  const headers = ['patent_id', 'title', 'competitor_citations', 'years_remaining', 'competitors',
    ...PROFILES.flatMap(p => [`score_${p.id}`, `rank_${p.id}`])];
  const rankMaps = new Map<string, Map<string, number>>();
  for (const p of PROFILES) {
    const rm = new Map<string, number>();
    results.get(p.id)!.forEach((item, idx) => rm.set(item.patent.patent_id, idx + 1));
    rankMaps.set(p.id, rm);
  }

  const baseScored = results.get(PROFILES[0].id)!;
  const csvRows = [headers.join(',')];
  for (let i = 0; i < Math.min(TOP_N * 2, baseScored.length); i++) {
    const { patent } = baseScored[i];
    const row = [
      patent.patent_id,
      `"${(patent.title || '').replace(/"/g, '""').substring(0, 60)}"`,
      patent.competitor_citations,
      patent.years_remaining.toFixed(1),
      `"${(patent.competitors || []).slice(0, 3).join('; ')}"`,
      ...PROFILES.flatMap(p => {
        const item = results.get(p.id)!.find(s => s.patent.patent_id === patent.patent_id);
        return [item?.score.finalScore.toFixed(2) || '', rankMaps.get(p.id)!.get(patent.patent_id) || ''];
      })
    ];
    csvRows.push(row.join(','));
  }
  fs.writeFileSync(`./output/scoring-stakeholder-v3-${timestamp}.csv`, csvRows.join('\n'));
  console.log(`Exported: ./output/scoring-stakeholder-v3-${timestamp}.csv`);

  console.log('\n' + '='.repeat(80));
  console.log('Framework Note: Sector-Specific Signals');
  console.log('='.repeat(80));
  console.log(`
The framework supports sector-specific signals via the 'sectorOverrides' field on metrics.
Example future enhancement:

  {
    field: 'eligibility_score',
    weight: 0.35,
    sectorOverrides: {
      'video-codec': { weight: 0.20 },      // Less 101 risk for video hardware
      'cloud-auth': { weight: 0.45 },        // Higher 101 risk for software auth
      'rf-acoustic': { weight: 0.15 }        // Hardware patents rarely have 101 issues
    }
  }

Sector-specific LLM questions could add new metrics (e.g., 'standards_essentiality_score'
for video-codec sector) that only apply when sector matches. These would be additive
within factors, contributing to the subscore when available.
`);

  console.log('='.repeat(80));
  console.log('DONE');
  console.log('='.repeat(80));
}

main().catch(console.error);
