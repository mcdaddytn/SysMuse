/**
 * Create V3 Litigation Discovery Snapshot
 *
 * Scores the entire broadcom-core portfolio using the Litigation Discovery
 * V2 Enhanced preset (near-zero citation weight, maximizes LLM quality signals),
 * then saves it as an active V3 snapshot so that v3_score is overlaid across
 * the portfolio.
 *
 * Since this is a single-role V3 consensus at 100% weight, the V2 Enhanced
 * scores ARE the V3 scores directly — no multi-role averaging needed.
 *
 * Usage:
 *   npx tsx scripts/create-litigation-discovery-snapshot.ts
 *   npx tsx scripts/create-litigation-discovery-snapshot.ts --portfolio broadcom-core
 */

import { PrismaClient } from '@prisma/client';
import { scoreWithCustomConfig, DEFAULT_V2_ENHANCED_CONFIG } from '../src/api/services/scoring-service.js';
import type { V2EnhancedConfig } from '../src/api/services/scoring-service.js';

const prisma = new PrismaClient();

// Litigation Discovery weights (matches the preset in scoring-service.ts)
const LITIGATION_DISCOVERY_CONFIG: V2EnhancedConfig = {
  weights: {
    competitor_citations: 1,
    adjusted_forward_citations: 2,
    years_remaining: 12,
    competitor_count: 0,
    competitor_density: 0,
    eligibility_score: 18,
    validity_score: 15,
    claim_breadth: 12,
    enforcement_clarity: 15,
    design_around_difficulty: 13,
    market_relevance_score: 5,
    ipr_risk_score: 4,
    prosecution_quality_score: 3,
  },
  scaling: { ...DEFAULT_V2_ENHANCED_CONFIG.scaling },
  invert: {},
  topN: 0,              // Score ALL patents (no limit)
  llmEnhancedOnly: true, // Only patents with LLM scores
};

async function main() {
  const args = process.argv.slice(2);
  const portfolioName = args.includes('--portfolio')
    ? args[args.indexOf('--portfolio') + 1]
    : 'broadcom-core';

  // 1. Resolve portfolio ID
  const portfolio = await prisma.portfolio.findUnique({
    where: { name: portfolioName },
    select: { id: true, name: true },
  });

  if (!portfolio) {
    console.error(`Portfolio not found: "${portfolioName}"`);
    process.exit(1);
  }
  console.log(`Portfolio: ${portfolio.name} (${portfolio.id})`);

  // 2. Score all patents with Litigation Discovery weights
  console.log('Scoring patents with Litigation Discovery preset...');
  console.log('  Weights: citations ~3%, LLM quality ~88%, remaining life 12%');
  const scored = await scoreWithCustomConfig(
    LITIGATION_DISCOVERY_CONFIG,
    undefined,       // no previous rankings
    portfolio.id     // scope to portfolio
  );

  console.log(`  Scored ${scored.length} patents (LLM-enhanced only)`);
  if (scored.length === 0) {
    console.error('No patents scored — check that LLM scores exist for this portfolio');
    process.exit(1);
  }

  // Show top 10
  console.log('\n  Top 10 by Litigation Discovery score:');
  for (const p of scored.slice(0, 10)) {
    console.log(`    #${p.rank} ${p.patent_id} — ${p.score.toFixed(2)} — ${p.patent_title.substring(0, 60)}`);
  }

  // 3. Deactivate any existing active V3 snapshots for this portfolio
  const deactivated = await prisma.scoreSnapshot.updateMany({
    where: {
      scoreType: 'V3',
      isActive: true,
      portfolioId: portfolio.id,
    },
    data: { isActive: false },
  });
  if (deactivated.count > 0) {
    console.log(`\nDeactivated ${deactivated.count} existing active V3 snapshot(s)`);
  }

  // Also check global (null portfolio) V3 snapshots
  const deactivatedGlobal = await prisma.scoreSnapshot.updateMany({
    where: {
      scoreType: 'V3',
      isActive: true,
      portfolioId: null,
    },
    data: { isActive: false },
  });
  if (deactivatedGlobal.count > 0) {
    console.log(`Deactivated ${deactivatedGlobal.count} existing active global V3 snapshot(s)`);
  }

  // 4. Build snapshot config (V3 consensus with single role at 100%)
  const snapshotConfig = {
    type: 'V3_CONSENSUS',
    roles: [
      {
        id: 'litigation_discovery',
        name: 'Litigation Discovery',
        weight: 1.0,
        config: LITIGATION_DISCOVERY_CONFIG,
      },
    ],
    description: 'Single-role V3 consensus: Litigation Discovery at 100% weight. Near-zero citation weight, maximizes LLM quality signals (eligibility, enforcement clarity, validity, design-around difficulty).',
  };

  // Count patents with LLM data
  const llmDataCount = scored.filter(
    (s) => s.raw_metrics?.eligibility_score !== undefined
  ).length;

  // 5. Check for existing snapshot with same name — replace it
  const snapshotName = 'V3 Litigation Discovery';
  const existing = await prisma.scoreSnapshot.findFirst({
    where: { name: snapshotName, scoreType: 'V3', portfolioId: portfolio.id },
  });
  if (existing) {
    await prisma.patentScoreEntry.deleteMany({ where: { snapshotId: existing.id } });
    await prisma.scoreSnapshot.delete({ where: { id: existing.id } });
    console.log(`\nReplaced existing snapshot "${snapshotName}" (${existing.id})`);
  }

  // 6. Create the snapshot with all scores
  console.log('\nCreating V3 snapshot...');
  const snapshot = await prisma.scoreSnapshot.create({
    data: {
      name: snapshotName,
      description: 'Litigation Discovery preset at 100% weight. Near-zero citation weight (~3%), maximizes LLM quality signals (~88%): eligibility 18%, enforcement clarity 15%, validity 15%, design-around difficulty 13%, claim breadth 12%.',
      scoreType: 'V3',
      config: snapshotConfig,
      portfolioId: portfolio.id,
      isActive: true,
      patentCount: scored.length,
      llmDataCount,
      scores: {
        create: scored.map((s) => ({
          patentId: s.patent_id,
          score: s.score,
          rank: s.rank,
          rawMetrics: s.raw_metrics || null,
          normalizedMetrics: s.normalized_metrics || null,
        })),
      },
    },
    include: {
      _count: { select: { scores: true } },
    },
  });

  console.log(`\nSnapshot created successfully:`);
  console.log(`  ID: ${snapshot.id}`);
  console.log(`  Name: ${snapshot.name}`);
  console.log(`  Type: ${snapshot.scoreType}`);
  console.log(`  Active: ${snapshot.isActive}`);
  console.log(`  Patents scored: ${snapshot._count.scores}`);
  console.log(`  LLM-enhanced: ${llmDataCount}`);

  // 7. Show score distribution
  const scores = scored.map((s) => s.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const max = Math.max(...scores);
  const min = Math.min(...scores);
  const median = scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];

  console.log(`\nScore distribution:`);
  console.log(`  Min: ${min.toFixed(2)}`);
  console.log(`  Max: ${max.toFixed(2)}`);
  console.log(`  Avg: ${avg.toFixed(2)}`);
  console.log(`  Median: ${median.toFixed(2)}`);

  // Show bottom 10 (patents that should now rank higher)
  console.log('\n  Bottom 10 (previously high-citation patents now ranked lower):');
  for (const p of scored.slice(-10).reverse()) {
    console.log(`    #${p.rank} ${p.patent_id} — ${p.score.toFixed(2)} — ${p.patent_title.substring(0, 60)}`);
  }

  console.log('\nDone. The V3 Litigation Discovery score is now active and will overlay as v3_score in the patent table.');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
