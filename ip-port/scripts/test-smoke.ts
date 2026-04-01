#!/usr/bin/env npx tsx
/**
 * Smoke Test — Verify DB state, metric resolver, and formula evaluation with real data.
 * Run: npx tsx scripts/test-smoke.ts
 */

import { PrismaClient } from '@prisma/client';
import { resolveMetricsForPortfolio, extractAttributes } from '../src/api/services/metric-resolver.js';
import { generateFormulaForScope, getOrCreateFormula } from '../src/api/services/formula-generator.js';
import { evaluateFormula } from '../src/api/services/formula-engine.js';
import type { FormulaStructure } from '../src/api/services/formula-types.js';

const prisma = new PrismaClient();

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Smoke Test: DB State');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const portfolioCount = await prisma.portfolio.count();
  const patentCount = await prisma.patent.count();
  const scoreCount = await prisma.patentSubSectorScore.count();
  const formulaCount = await prisma.formulaDefinition.count();
  const profileCount = await prisma.weightProfile.count({ where: { formulaDefId: { not: null } } });

  console.log(`  Portfolios: ${portfolioCount}`);
  console.log(`  Patents: ${patentCount}`);
  console.log(`  PatentSubSectorScores: ${scoreCount}`);
  console.log(`  FormulaDefinitions: ${formulaCount}`);
  console.log(`  WeightProfiles (linked): ${profileCount}`);

  const portfolio = await prisma.portfolio.findFirst({ orderBy: { patentCount: 'desc' } });
  if (!portfolio) {
    console.error('  ✗ No portfolios found!');
    return;
  }
  console.log(`  Largest portfolio: ${portfolio.name} (${portfolio.patentCount} patents, id: ${portfolio.id})`);

  // Check formula definitions
  const formulas = await prisma.formulaDefinition.findMany({ select: { id: true, name: true, scopeType: true } });
  console.log(`\n  Formula Definitions:`);
  for (const f of formulas) {
    console.log(`    - ${f.name} (${f.scopeType}, id: ${f.id})`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Smoke Test: Metric Resolver (real data)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load the v2-enhanced formula
  const v2Formula = await prisma.formulaDefinition.findFirst({ where: { name: 'v2-enhanced' } });
  if (!v2Formula) {
    console.error('  ✗ v2-enhanced formula not found!');
    return;
  }

  const structure = v2Formula.structure as unknown as FormulaStructure;
  const attributes = extractAttributes(structure);
  console.log(`  Formula: ${v2Formula.name}`);
  console.log(`  Attributes needed: ${attributes.length} — ${attributes.join(', ')}`);

  // Resolve metrics for a small sample
  const resolved = await resolveMetricsForPortfolio(portfolio.id, attributes, { limit: 10 });
  console.log(`  Resolved metrics for ${resolved.length} patents`);

  if (resolved.length > 0) {
    const sample = resolved[0];
    const filledMetrics = Object.entries(sample.rawMetrics).filter(([, v]) => v !== undefined);
    const missingMetrics = Object.entries(sample.rawMetrics).filter(([, v]) => v === undefined);
    console.log(`\n  Sample patent: ${sample.patentId}`);
    console.log(`    Title: ${sample.metadata.title?.substring(0, 80)}`);
    console.log(`    Sector: ${sample.metadata.superSector} > ${sample.metadata.sector}`);
    console.log(`    Years remaining: ${sample.metadata.yearsRemaining}`);
    console.log(`    Has LLM data: ${sample.metadata.hasLlmData}`);
    console.log(`    Filled metrics: ${filledMetrics.length} — ${filledMetrics.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    console.log(`    Missing metrics: ${missingMetrics.length} — ${missingMetrics.map(([k]) => k).join(', ')}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Smoke Test: V2 Enhanced Evaluation (real data)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Evaluate with default profile
  const defaultProfile = await prisma.weightProfile.findFirst({
    where: { formulaDefId: v2Formula.id, isDefault: true },
  });
  if (!defaultProfile) {
    console.error('  ✗ No default profile found!');
    return;
  }

  const weights = defaultProfile.weights as Record<string, number>;
  console.log(`  Profile: ${defaultProfile.name}`);

  let scoredCount = 0;
  let totalScore = 0;
  let minScore = Infinity;
  let maxScore = -Infinity;

  for (const r of resolved) {
    const result = evaluateFormula(structure, weights, r.rawMetrics);
    if (result.score > 0) {
      scoredCount++;
      totalScore += result.score;
      minScore = Math.min(minScore, result.score);
      maxScore = Math.max(maxScore, result.score);
    }
  }

  console.log(`  Scored ${scoredCount}/${resolved.length} patents`);
  if (scoredCount > 0) {
    console.log(`  Score range: ${minScore.toFixed(2)} — ${maxScore.toFixed(2)}`);
    console.log(`  Average: ${(totalScore / scoredCount).toFixed(2)}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Smoke Test: Taxonomy Formula Generation + Evaluation');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Generate a WIRELESS sector formula
  const wirelessGenerated = generateFormulaForScope('SUPER_SECTOR', 'WIRELESS');
  console.log(`  Generated WIRELESS formula:`);
  console.log(`    Groups: ${wirelessGenerated.groupInfo.map(g => `${g.name}(${g.termCount})`).join(', ')}`);
  console.log(`    Default group weights: ${wirelessGenerated.groupInfo.map(g => `${g.weightKey}=${wirelessGenerated.defaultWeights[g.weightKey]}`).join(', ')}`);

  // Resolve with taxonomy attributes
  const taxonomyAttrs = extractAttributes(wirelessGenerated.structure);
  console.log(`    Attributes needed: ${taxonomyAttrs.length}`);

  const taxonomyResolved = await resolveMetricsForPortfolio(portfolio.id, taxonomyAttrs, { limit: 5 });
  console.log(`    Resolved ${taxonomyResolved.length} patents`);

  let taxonomyScoredCount = 0;
  for (const r of taxonomyResolved) {
    const result = evaluateFormula(wirelessGenerated.structure, wirelessGenerated.defaultWeights, r.rawMetrics);
    if (result.score > 0) {
      taxonomyScoredCount++;
      const groupDetail = result.groupScores
        ? Object.entries(result.groupScores).map(([k, v]) => `${k}=${(v.score * 100).toFixed(0)}(${v.termsUsed}/${v.totalTerms})`).join(', ')
        : 'no groups';
      console.log(`    ${r.patentId}: score=${result.score.toFixed(2)}, groups=[${groupDetail}]`);
    }
  }
  console.log(`    Scored: ${taxonomyScoredCount}/${taxonomyResolved.length}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Smoke Test: getOrCreateFormula (DB persistence)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { formulaId, isNew } = await getOrCreateFormula(
    'SUPER_SECTOR', 'WIRELESS', 'WIRELESS',
  );
  console.log(`  WIRELESS formula: ${formulaId} (${isNew ? 'NEW — created' : 'existing'})`);

  const dbFormula = await prisma.formulaDefinition.findUnique({
    where: { id: formulaId },
    include: { weightProfiles: { select: { id: true, name: true, isDefault: true } } },
  });
  console.log(`  Name: ${dbFormula?.name}`);
  console.log(`  Display: ${dbFormula?.displayName}`);
  console.log(`  Profiles: ${dbFormula?.weightProfiles.map(p => p.name).join(', ')}`);

  // Verify formula count after generation
  const finalCount = await prisma.formulaDefinition.count();
  console.log(`  Total formulas in DB: ${finalCount}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Smoke Tests Complete');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main()
  .catch(e => { console.error('Smoke test failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
