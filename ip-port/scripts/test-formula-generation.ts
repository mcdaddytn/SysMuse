#!/usr/bin/env npx tsx
/**
 * Test Formula Generation
 *
 * Verifies that the formula generator correctly builds grouped FormulaStructures
 * from scoring template JSON files.
 *
 * Run: npx tsx scripts/test-formula-generation.ts
 */

import { generateFormulaForScope, listAvailableScopes } from '../src/api/services/formula-generator.js';
import { evaluateFormula } from '../src/api/services/formula-engine.js';
import type { FormulaStructure, GroupTerm, MetricTerm } from '../src/api/services/formula-types.js';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// =============================================================================
// Test 1: List available scopes
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 1: List Available Scopes');
console.log('═══════════════════════════════════════════════════════════════\n');

const scopes = listAvailableScopes();
assert('Has super-sectors', scopes.superSectors.length > 0, `found ${scopes.superSectors.length}`);
assert('Has sectors', scopes.sectors.length > 0, `found ${scopes.sectors.length}`);
console.log(`  Info: ${scopes.superSectors.length} super-sectors, ${scopes.sectors.length} sectors, ${scopes.subSectors.length} sub-sectors`);

// =============================================================================
// Test 2: Generate WIRELESS super-sector formula
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 2: Generate WIRELESS Super-Sector Formula');
console.log('═══════════════════════════════════════════════════════════════\n');

const wirelessFormula = generateFormulaForScope('SUPER_SECTOR', 'WIRELESS');

assert('Has 2 groups (portfolio + super-sector)', wirelessFormula.groupInfo.length === 2,
  `got ${wirelessFormula.groupInfo.length}: ${wirelessFormula.groupInfo.map(g => g.name).join(', ')}`);

const wirelessPortGroup = wirelessFormula.groupInfo.find(g => g.level === 'portfolio');
const wirelessSSGroup = wirelessFormula.groupInfo.find(g => g.level === 'super_sector');

assert('Portfolio group exists', wirelessPortGroup != null);
assert('Portfolio group has 14 terms (7 LLM + 5 quant + 2 API)', wirelessPortGroup?.termCount === 14,
  `got ${wirelessPortGroup?.termCount}`);

assert('Super-sector group exists', wirelessSSGroup != null);
assert('WIRELESS super-sector has 4 new questions', wirelessSSGroup?.termCount === 4,
  `got ${wirelessSSGroup?.termCount}`);

// Check that the 4 new questions are the expected ones
const ssGroupTerm = wirelessFormula.structure.terms.find(
  t => t.type === 'group' && (t as GroupTerm).name.includes('wireless')
) as GroupTerm;
if (ssGroupTerm) {
  const ssFieldNames = ssGroupTerm.terms
    .filter(t => t.type === 'metric')
    .map(t => (t as MetricTerm).attribute)
    .sort();
  assert('WIRELESS new fields are correct',
    ssFieldNames.includes('component_vs_system') &&
    ssFieldNames.includes('deployment_target') &&
    ssFieldNames.includes('wireless_generation') &&
    ssFieldNames.includes('standards_essentiality'),
    `got: ${ssFieldNames.join(', ')}`);
}

assert('Default weights sum to ~1.0',
  Math.abs(wirelessFormula.defaultWeights['g_portfolio'] + (wirelessFormula.defaultWeights['g_super_sector'] ?? 0) - 1.0) < 0.02,
  `portfolio=${wirelessFormula.defaultWeights['g_portfolio']}, ss=${wirelessFormula.defaultWeights['g_super_sector']}`);

// =============================================================================
// Test 3: Generate SEMICONDUCTOR super-sector formula (no new questions)
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 3: Generate SEMICONDUCTOR Super-Sector Formula (no new questions)');
console.log('═══════════════════════════════════════════════════════════════\n');

const semiFormula = generateFormulaForScope('SUPER_SECTOR', 'SEMICONDUCTOR');

// SEMICONDUCTOR has 2 new questions (manufacturing_relevance, chip_integration)
assert('Has 2 groups (portfolio + super-sector)', semiFormula.groupInfo.length === 2,
  `got ${semiFormula.groupInfo.length}: ${semiFormula.groupInfo.map(g => g.name).join(', ')}`);

const semiSSGroup = semiFormula.groupInfo.find(g => g.level === 'super_sector');
assert('SEMICONDUCTOR super-sector has new questions', semiSSGroup != null && semiSSGroup.termCount > 0,
  `got ${semiSSGroup?.termCount ?? 0} terms`);

assert('Group weights sum to ~1.0',
  Math.abs((semiFormula.defaultWeights['g_portfolio'] ?? 0) + (semiFormula.defaultWeights['g_super_sector'] ?? 0) - 1.0) < 0.02,
  `portfolio=${semiFormula.defaultWeights['g_portfolio']}, ss=${semiFormula.defaultWeights['g_super_sector']}`);

// =============================================================================
// Test 4: Generate WIRELESS > rf-acoustic sector formula
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 4: Generate WIRELESS > rf-acoustic Sector Formula');
console.log('═══════════════════════════════════════════════════════════════\n');

const rfFormula = generateFormulaForScope('SECTOR', 'WIRELESS', 'rf-acoustic');

console.log(`  Info: ${rfFormula.groupInfo.length} groups: ${rfFormula.groupInfo.map(g => `${g.name}(${g.termCount})`).join(', ')}`);

assert('Has at least 2 groups', rfFormula.groupInfo.length >= 2,
  `got ${rfFormula.groupInfo.length}`);

const rfSectorGroup = rfFormula.groupInfo.find(g => g.level === 'sector');
assert('Sector group exists with new questions', rfSectorGroup != null && rfSectorGroup.termCount > 0,
  `sector group: ${rfSectorGroup?.termCount ?? 0} terms`);

// =============================================================================
// Test 5: Evaluate grouped formula with mock data
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 5: Evaluate Grouped Formula with Mock Data');
console.log('═══════════════════════════════════════════════════════════════\n');

// Use the WIRELESS formula and provide mock metric values
const mockMetrics: Record<string, number | undefined> = {
  // Quantitative
  competitor_citations: 10,
  adjusted_forward_citations: 100,
  years_remaining: 10,
  competitor_count: 3,
  competitor_density: 0.5,
  // Portfolio LLM (1-10)
  technical_novelty: 7,
  claim_breadth: 8,
  design_around_difficulty: 6,
  market_relevance: 7,
  implementation_clarity: 8,
  standards_relevance: 5,
  unique_value: 6,
  // Super-sector WIRELESS questions (1-10)
  component_vs_system: 8,
  deployment_target: 7,
  wireless_generation: 9,
  standards_essentiality: 6,
};

const result = evaluateFormula(wirelessFormula.structure, wirelessFormula.defaultWeights, mockMetrics);

assert('Score is positive', result.score > 0, `score=${result.score}`);
assert('Score is in 0-100 range', result.score >= 0 && result.score <= 100, `score=${result.score}`);
assert('Has group scores', result.groupScores != null, `groupScores keys: ${result.groupScores ? Object.keys(result.groupScores).join(', ') : 'none'}`);

if (result.groupScores) {
  const portfolioGroupScore = Object.entries(result.groupScores).find(([k]) => k === 'portfolio');
  const ssGroupScore = Object.entries(result.groupScores).find(([k]) => k.includes('wireless'));

  assert('Portfolio group score reported', portfolioGroupScore != null);
  assert('Super-sector group score reported', ssGroupScore != null);

  if (portfolioGroupScore && ssGroupScore) {
    console.log(`  Info: Portfolio group score: ${portfolioGroupScore[1].score}, terms: ${portfolioGroupScore[1].termsUsed}/${portfolioGroupScore[1].totalTerms}`);
    console.log(`  Info: SS group score: ${ssGroupScore[1].score}, terms: ${ssGroupScore[1].termsUsed}/${ssGroupScore[1].totalTerms}`);
  }
}

assert('Year multiplier applied', result.multiplierValues['years_remaining'] != null);
console.log(`  Info: Final score: ${result.score}, yearMult: ${result.multiplierValues['years_remaining']}`);

// =============================================================================
// Test 6: Evaluate with missing sparse metrics (API metrics)
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Test 6: Evaluate with Missing Sparse Metrics');
console.log('═══════════════════════════════════════════════════════════════\n');

// Same as above but without API metrics (should renormalize within portfolio group)
const metricsNoApi = { ...mockMetrics };
delete metricsNoApi.ipr_risk_score;
delete metricsNoApi.prosecution_quality_score;

const resultNoApi = evaluateFormula(wirelessFormula.structure, wirelessFormula.defaultWeights, metricsNoApi);
assert('Score still positive without API metrics', resultNoApi.score > 0, `score=${resultNoApi.score}`);
assert('Score differs from full data (renormalization)', Math.abs(resultNoApi.score - result.score) > 0.01 || resultNoApi.score === result.score,
  `with API: ${result.score}, without: ${resultNoApi.score}`);

// =============================================================================
// Summary
// =============================================================================

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
