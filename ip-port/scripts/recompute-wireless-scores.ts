/**
 * Recompute WIRELESS Composite Scores
 *
 * Recalculates composite_score from stored metrics using current template weights.
 * No LLM calls — pure math on existing data.
 *
 * Handles both sector-level and sub-sector-level templateConfigIds by resolving
 * the correct merged template for each.
 *
 * Usage: npx tsx scripts/recompute-wireless-scores.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';
import {
  calculateCompositeScore,
  getMergedTemplateForSector,
  getMergedTemplateForSubSector,
  ScoringQuestion,
} from '../src/api/services/scoring-template-service.js';

const prisma = new PrismaClient();

const WIRELESS_SECTORS = [
  'wireless-transmission',
  'wireless-scheduling',
  'wireless-infrastructure',
  'wireless-power-mgmt',
  'wireless-mobility',
  'wireless-mimo-antenna',
  'rf-acoustic',
  'antennas',
  'radar-sensing',
  'wireless-services',
];

// Map sub-sector prefixes to their parent sector
const SUB_SECTOR_TO_SECTOR: Record<string, string> = {
  'wt-': 'wireless-transmission',
  'ws-': 'wireless-scheduling',
  'wi-': 'wireless-infrastructure',
  'wpm-': 'wireless-power-mgmt',
  'wm-': 'wireless-mobility',
  'rfa-': 'rf-acoustic',
};

function getSectorForTemplateConfigId(templateConfigId: string): string | null {
  // Direct sector match
  if (WIRELESS_SECTORS.includes(templateConfigId)) return templateConfigId;

  // Sub-sector prefix match
  for (const [prefix, sector] of Object.entries(SUB_SECTOR_TO_SECTOR)) {
    if (templateConfigId.startsWith(prefix)) return sector;
  }

  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\nRecomputing WIRELESS composite scores${dryRun ? ' (DRY RUN)' : ''}...\n`);

  // Get all WIRELESS patent IDs
  const wirelessPatentIds = (await prisma.patent.findMany({
    where: { superSector: 'WIRELESS', isQuarantined: false },
    select: { patentId: true },
  })).map(p => p.patentId);

  console.log(`WIRELESS patents: ${wirelessPatentIds.length}`);

  // Get all scores for these patents
  const scores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: wirelessPatentIds } },
    select: { id: true, patentId: true, templateConfigId: true, metrics: true, compositeScore: true },
  });

  console.log(`Total scores: ${scores.length}`);

  // Cache merged templates to avoid recomputing for every score
  const templateCache = new Map<string, ScoringQuestion[]>();

  function getQuestionsForConfig(templateConfigId: string): ScoringQuestion[] | null {
    if (templateCache.has(templateConfigId)) return templateCache.get(templateConfigId)!;

    const sector = getSectorForTemplateConfigId(templateConfigId);
    if (!sector) return null;

    let merged;
    if (templateConfigId === sector) {
      // Sector-level
      merged = getMergedTemplateForSector(sector, 'WIRELESS');
    } else {
      // Sub-sector level
      merged = getMergedTemplateForSubSector(templateConfigId, sector, 'WIRELESS');
    }

    const questions = merged.questions;
    templateCache.set(templateConfigId, questions);
    return questions;
  }

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const updates: Array<{ id: string; newScore: number }> = [];
  const byConfig: Record<string, { total: number; changed: number }> = {};

  for (const score of scores) {
    const configId = score.templateConfigId || 'unknown';

    if (!byConfig[configId]) byConfig[configId] = { total: 0, changed: 0 };
    byConfig[configId].total++;

    const questions = getQuestionsForConfig(configId);
    if (!questions) {
      skipped++;
      continue;
    }

    const metrics = score.metrics as Record<string, { score: number; reasoning?: string; confidence?: number }> | null;
    if (!metrics) {
      skipped++;
      continue;
    }

    const newScore = calculateCompositeScore(metrics, questions);

    if (Math.abs(newScore - score.compositeScore) > 0.001) {
      updates.push({ id: score.id, newScore });
      byConfig[configId].changed++;
      updated++;
    } else {
      unchanged++;
    }
  }

  console.log(`\nResults: ${updated} changed, ${unchanged} unchanged, ${skipped} skipped`);

  // Show per-config breakdown
  console.log('\nPer templateConfigId:');
  for (const [config, stats] of Object.entries(byConfig).sort((a, b) => b[1].total - a[1].total)) {
    if (stats.changed > 0) {
      console.log(`  ${config}: ${stats.changed}/${stats.total} changed`);
    }
  }

  if (!dryRun && updates.length > 0) {
    console.log(`\nApplying ${updates.length} updates...`);

    // Batch in chunks of 500 to avoid SQL size limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE);
      const cases = chunk.map(u => `WHEN '${u.id}' THEN ${u.newScore}`).join(' ');
      const ids = chunk.map(u => `'${u.id}'`).join(',');

      await prisma.$executeRawUnsafe(`
        UPDATE patent_sub_sector_scores
        SET composite_score = CASE id ${cases} END,
            updated_at = NOW()
        WHERE id IN (${ids})
      `);

      console.log(`  Chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunk.length} updated`);
    }

    console.log('Done.');
  } else if (dryRun) {
    console.log('\nDry run — no changes applied.');
    // Show sample of biggest score changes
    const sorted = updates.sort((a, b) => {
      const oldA = scores.find(s => s.id === a.id)!.compositeScore;
      const oldB = scores.find(s => s.id === b.id)!.compositeScore;
      return Math.abs(b.newScore - oldB) - Math.abs(a.newScore - oldA);
    });
    console.log('\nTop 10 biggest score changes:');
    for (const u of sorted.slice(0, 10)) {
      const old = scores.find(s => s.id === u.id)!;
      const delta = u.newScore - old.compositeScore;
      console.log(`  ${old.patentId} (${old.templateConfigId}): ${old.compositeScore.toFixed(2)} → ${u.newScore.toFixed(2)} (${delta > 0 ? '+' : ''}${delta.toFixed(2)})`);
    }
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Recompute failed:', err);
  process.exit(1);
});
