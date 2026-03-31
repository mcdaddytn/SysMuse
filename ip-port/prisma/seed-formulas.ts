#!/usr/bin/env npx tsx
/**
 * Seed Formula Definitions + Weight Profiles
 *
 * Creates the initial FormulaDefinition rows and corresponding WeightProfile rows
 * that reproduce the current V2 Enhanced and LLM Composite scoring exactly.
 *
 * Run: npx tsx prisma/seed-formulas.ts
 *
 * Safe to re-run — uses upsert on unique keys.
 */

import { PrismaClient } from '@prisma/client';
import type { FormulaStructure } from '../src/api/services/formula-types.js';
import {
  metricTerm,
  linearScaling,
  sqrtScaling,
  rangeScaling,
} from '../src/api/services/formula-engine.js';

const prisma = new PrismaClient();

// =============================================================================
// Formula Structures
// =============================================================================

const V2_ENHANCED_FORMULA: FormulaStructure = {
  version: 1,
  outputScale: 100,
  terms: [
    // Quantitative metrics
    metricTerm('competitor_citations', linearScaling(20)),
    metricTerm('adjusted_forward_citations', sqrtScaling(900)),
    metricTerm('years_remaining', linearScaling(15)),
    metricTerm('competitor_count', linearScaling(5)),
    metricTerm('competitor_density', linearScaling(1)),
    // LLM-derived metrics (1-5 scale)
    metricTerm('eligibility_score', rangeScaling(1, 5), { sparseGroup: 'llm' }),
    metricTerm('validity_score', rangeScaling(1, 5), { sparseGroup: 'llm' }),
    metricTerm('claim_breadth', rangeScaling(1, 5), { sparseGroup: 'llm' }),
    metricTerm('enforcement_clarity', rangeScaling(1, 5), { sparseGroup: 'llm' }),
    metricTerm('design_around_difficulty', rangeScaling(1, 5), { sparseGroup: 'llm' }),
    metricTerm('market_relevance_score', rangeScaling(1, 5), { sparseGroup: 'llm' }),
    // API-derived metrics (1-5 scale)
    metricTerm('ipr_risk_score', rangeScaling(1, 5), { sparseGroup: 'api' }),
    metricTerm('prosecution_quality_score', rangeScaling(1, 5), { sparseGroup: 'api' }),
  ],
  multipliers: [
    {
      attribute: 'years_remaining',
      fn: 'linear_floor',
      params: { floor: 0.3, ceiling: 1.0, scale: 15, exponent: 0.8 },
    },
  ],
  sparseHandling: 'renormalize',
};

const LLM_COMPOSITE_FORMULA: FormulaStructure = {
  version: 1,
  outputScale: 100,
  terms: [
    metricTerm('technical_novelty', rangeScaling(1, 10)),
    metricTerm('claim_breadth', rangeScaling(1, 10)),
    metricTerm('design_around_difficulty', rangeScaling(1, 10)),
    metricTerm('market_relevance', rangeScaling(1, 10)),
    metricTerm('implementation_clarity', rangeScaling(1, 10)),
    metricTerm('standards_relevance', rangeScaling(1, 10)),
    metricTerm('unique_value', rangeScaling(1, 10)),
  ],
  multipliers: [],
  sparseHandling: 'zero',
};

// =============================================================================
// Weight Profile Definitions
// =============================================================================

const V2_ENHANCED_PROFILES = [
  {
    name: 'default',
    displayName: 'Default Balanced',
    description: 'Balanced weights across all metrics',
    isDefault: true,
    weights: {
      competitor_citations: 20,
      adjusted_forward_citations: 10,
      years_remaining: 15,
      competitor_count: 5,
      competitor_density: 5,
      eligibility_score: 5,
      validity_score: 5,
      claim_breadth: 4,
      enforcement_clarity: 6,
      design_around_difficulty: 5,
      market_relevance_score: 5,
      ipr_risk_score: 5,
      prosecution_quality_score: 5,
    },
  },
  {
    name: 'litigation',
    displayName: 'Litigation Focus',
    description: 'Emphasizes enforcement clarity and design-around difficulty',
    isDefault: false,
    weights: {
      competitor_citations: 15,
      adjusted_forward_citations: 5,
      years_remaining: 10,
      competitor_count: 5,
      competitor_density: 5,
      eligibility_score: 8,
      validity_score: 7,
      claim_breadth: 5,
      enforcement_clarity: 15,
      design_around_difficulty: 10,
      market_relevance_score: 3,
      ipr_risk_score: 7,
      prosecution_quality_score: 5,
    },
  },
  {
    name: 'licensing',
    displayName: 'Licensing Focus',
    description: 'Emphasizes claim breadth and market relevance',
    isDefault: false,
    weights: {
      competitor_citations: 18,
      adjusted_forward_citations: 8,
      years_remaining: 15,
      competitor_count: 5,
      competitor_density: 4,
      eligibility_score: 5,
      validity_score: 5,
      claim_breadth: 10,
      enforcement_clarity: 4,
      design_around_difficulty: 3,
      market_relevance_score: 10,
      ipr_risk_score: 5,
      prosecution_quality_score: 3,
    },
  },
  {
    name: 'defensive',
    displayName: 'Defensive',
    description: 'Emphasizes validity and IPR risk',
    isDefault: false,
    weights: {
      competitor_citations: 10,
      adjusted_forward_citations: 8,
      years_remaining: 12,
      competitor_count: 3,
      competitor_density: 4,
      eligibility_score: 6,
      validity_score: 12,
      claim_breadth: 8,
      enforcement_clarity: 4,
      design_around_difficulty: 6,
      market_relevance_score: 4,
      ipr_risk_score: 12,
      prosecution_quality_score: 6,
    },
  },
  {
    name: 'quick_wins',
    displayName: 'Quick Wins',
    description: 'High-confidence, clear enforcement opportunities',
    isDefault: false,
    weights: {
      competitor_citations: 15,
      adjusted_forward_citations: 5,
      years_remaining: 8,
      competitor_count: 5,
      competitor_density: 5,
      eligibility_score: 12,
      validity_score: 10,
      claim_breadth: 4,
      enforcement_clarity: 15,
      design_around_difficulty: 3,
      market_relevance_score: 4,
      ipr_risk_score: 8,
      prosecution_quality_score: 6,
    },
  },
  // Original hardcoded profiles (fractional weights)
  {
    name: 'executive',
    displayName: 'Executive',
    description: 'Balanced scoring for executive-level portfolio overview. Uses adjusted citations.',
    isDefault: false,
    weights: {
      competitor_citations: 0.25,
      adjusted_forward_citations: 0.11,
      years_remaining: 0.17,
      competitor_count: 0.05,
      competitor_density: 0.05,
      eligibility_score: 0.05,
      validity_score: 0.05,
      claim_breadth: 0.04,
      enforcement_clarity: 0.04,
      design_around_difficulty: 0.04,
      market_relevance_score: 0.05,
      ipr_risk_score: 0.05,
      prosecution_quality_score: 0.05,
    },
  },
  {
    name: 'aggressive_litigator',
    displayName: 'Aggressive Litigator',
    description: 'Litigation-focused, prioritizes enforcement and competitor citations.',
    isDefault: false,
    weights: {
      competitor_citations: 0.22,
      adjusted_forward_citations: 0.02,
      years_remaining: 0.08,
      competitor_count: 0.02,
      competitor_density: 0.04,
      eligibility_score: 0.10,
      validity_score: 0.07,
      claim_breadth: 0.04,
      enforcement_clarity: 0.17,
      design_around_difficulty: 0.09,
      market_relevance_score: 0.03,
      ipr_risk_score: 0.07,
      prosecution_quality_score: 0.05,
    },
  },
];

const LLM_COMPOSITE_PROFILES = [
  {
    name: 'default',
    displayName: 'Portfolio Default',
    description: 'Default portfolio-level question weights',
    isDefault: true,
    weights: {
      technical_novelty: 0.20,
      claim_breadth: 0.15,
      design_around_difficulty: 0.20,
      market_relevance: 0.15,
      implementation_clarity: 0.15,
      standards_relevance: 0.15,
      unique_value: 0.10,
    },
  },
];

// =============================================================================
// Seed execution
// =============================================================================

async function seed() {
  console.log('Seeding formula definitions and weight profiles...\n');

  // 1. Seed V2 Enhanced formula
  const v2Formula = await prisma.formulaDefinition.upsert({
    where: {
      name_portfolioGroupId: { name: 'v2-enhanced', portfolioGroupId: '' },
    },
    update: {
      displayName: 'V2 Enhanced Score',
      description: 'Portfolio-wide scoring with quantitative + LLM + API metrics, year multiplier, and weight renormalization for sparse data.',
      structure: V2_ENHANCED_FORMULA as any,
      version: 1,
    },
    create: {
      name: 'v2-enhanced',
      displayName: 'V2 Enhanced Score',
      description: 'Portfolio-wide scoring with quantitative + LLM + API metrics, year multiplier, and weight renormalization for sparse data.',
      scopeType: 'PORTFOLIO',
      structure: V2_ENHANCED_FORMULA as any,
      version: 1,
    },
  });
  console.log(`  ✓ FormulaDefinition: ${v2Formula.name} (${v2Formula.id})`);

  // 2. Seed V2 Enhanced weight profiles
  for (const profile of V2_ENHANCED_PROFILES) {
    const wp = await prisma.weightProfile.upsert({
      where: {
        name_scopeType_scopeId: {
          name: profile.name,
          scopeType: 'GLOBAL',
          scopeId: '',
        },
      },
      update: {
        weights: profile.weights,
        description: profile.description,
        isDefault: profile.isDefault,
        isBuiltIn: true,
        formulaDefId: v2Formula.id,
      },
      create: {
        name: profile.name,
        description: profile.description,
        scopeType: 'GLOBAL',
        weights: profile.weights,
        isDefault: profile.isDefault,
        isBuiltIn: true,
        isActive: true,
        formulaDefId: v2Formula.id,
      },
    });
    console.log(`    ✓ WeightProfile: ${profile.name} (${wp.id})`);
  }

  // 3. Seed LLM Composite formula
  const llmFormula = await prisma.formulaDefinition.upsert({
    where: {
      name_portfolioGroupId: { name: 'llm-composite-portfolio', portfolioGroupId: '' },
    },
    update: {
      displayName: 'LLM Composite Score',
      description: 'Portfolio-level LLM question scoring. Weighted average of normalized 1-10 LLM question ratings.',
      structure: LLM_COMPOSITE_FORMULA as any,
      version: 1,
    },
    create: {
      name: 'llm-composite-portfolio',
      displayName: 'LLM Composite Score',
      description: 'Portfolio-level LLM question scoring. Weighted average of normalized 1-10 LLM question ratings.',
      scopeType: 'PORTFOLIO',
      structure: LLM_COMPOSITE_FORMULA as any,
      version: 1,
    },
  });
  console.log(`  ✓ FormulaDefinition: ${llmFormula.name} (${llmFormula.id})`);

  // 4. Seed LLM Composite weight profiles
  for (const profile of LLM_COMPOSITE_PROFILES) {
    const wp = await prisma.weightProfile.upsert({
      where: {
        name_scopeType_scopeId: {
          name: `llm-${profile.name}`,
          scopeType: 'GLOBAL',
          scopeId: '',
        },
      },
      update: {
        weights: profile.weights,
        description: profile.description,
        isDefault: profile.isDefault,
        isBuiltIn: true,
        formulaDefId: llmFormula.id,
      },
      create: {
        name: `llm-${profile.name}`,
        description: profile.description,
        scopeType: 'GLOBAL',
        weights: profile.weights,
        isDefault: profile.isDefault,
        isBuiltIn: true,
        isActive: true,
        formulaDefId: llmFormula.id,
      },
    });
    console.log(`    ✓ WeightProfile: llm-${profile.name} (${wp.id})`);
  }

  console.log('\n✓ Seed complete.');

  // Summary
  const formulaCount = await prisma.formulaDefinition.count();
  const profileCount = await prisma.weightProfile.count({ where: { formulaDefId: { not: null } } });
  console.log(`  ${formulaCount} formula definitions, ${profileCount} linked weight profiles`);
}

seed()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
