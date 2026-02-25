/**
 * Recompute Composite Scores for a Super-Sector
 *
 * Recalculates composite_score from stored metrics using current template weights.
 * No LLM calls — pure math on existing data.
 *
 * Resolves sector/sub-sector template inheritance automatically from DB + config files.
 *
 * Usage: npx tsx scripts/recompute-super-sector-scores.ts <SUPER_SECTOR> [--dry-run]
 * Example: npx tsx scripts/recompute-super-sector-scores.ts SEMICONDUCTOR --dry-run
 */

import { PrismaClient } from '@prisma/client';
import {
  calculateCompositeScore,
  getMergedTemplateForSector,
  getMergedTemplateForSubSector,
  ScoringQuestion,
} from '../src/api/services/scoring-template-service.js';

const prisma = new PrismaClient();

async function main() {
  const superSector = process.argv[2];
  if (!superSector) {
    console.error('Usage: npx tsx scripts/recompute-super-sector-scores.ts <SUPER_SECTOR> [--dry-run]');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  console.log(`\nRecomputing ${superSector} composite scores${dryRun ? ' (DRY RUN)' : ''}...\n`);

  // Get sectors for this super-sector from DB
  const dbSectors = await prisma.sector.findMany({
    where: { superSector: { name: superSector } },
    select: { name: true },
  });
  const sectorNames = new Set(dbSectors.map(s => s.name));
  console.log(`Sectors: ${[...sectorNames].join(', ')}`);

  // Get all patents in this super-sector
  const patentIds = (await prisma.patent.findMany({
    where: { superSector: superSector, isQuarantined: false },
    select: { patentId: true },
  })).map(p => p.patentId);

  console.log(`Patents: ${patentIds.length}`);

  // Get all scores for these patents
  const scores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: patentIds } },
    select: { id: true, patentId: true, templateConfigId: true, metrics: true, compositeScore: true },
  });

  console.log(`Total scores: ${scores.length}`);

  // Build sector lookup: templateConfigId → parent sector name
  // For sector-level: templateConfigId IS the sector name
  // For sub-sector-level: need to look up via DB or config
  const configToSector = new Map<string, string>();

  // Pre-populate sector-level mappings
  for (const name of sectorNames) {
    configToSector.set(name, name);
  }

  // For sub-sector configs, query DB for sub-sector → sector mapping
  const allConfigIds = [...new Set(scores.map(s => s.templateConfigId).filter(Boolean))] as string[];
  const unknownConfigs = allConfigIds.filter(id => !configToSector.has(id));

  if (unknownConfigs.length > 0) {
    // Try to resolve via patent's primarySector
    const samplePatents = await prisma.patent.findMany({
      where: {
        patentId: { in: scores.filter(s => s.templateConfigId && unknownConfigs.includes(s.templateConfigId)).map(s => s.patentId) },
        superSector: superSector,
      },
      select: { patentId: true, primarySector: true },
    });
    const patentToSector = new Map(samplePatents.map(p => [p.patentId, p.primarySector]));

    // Map each unknown config to its most common parent sector
    for (const configId of unknownConfigs) {
      const matchingScores = scores.filter(s => s.templateConfigId === configId);
      const sectorCounts: Record<string, number> = {};
      for (const s of matchingScores) {
        const sector = patentToSector.get(s.patentId);
        if (sector) {
          sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
        }
      }
      const bestSector = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (bestSector) {
        configToSector.set(configId, bestSector);
      }
    }
  }

  // Cache merged templates
  const templateCache = new Map<string, ScoringQuestion[]>();

  function getQuestionsForConfig(templateConfigId: string): ScoringQuestion[] | null {
    if (templateCache.has(templateConfigId)) return templateCache.get(templateConfigId)!;

    const sector = configToSector.get(templateConfigId);
    if (!sector) return null;

    try {
      let merged;
      if (templateConfigId === sector) {
        merged = getMergedTemplateForSector(sector, superSector);
      } else {
        merged = getMergedTemplateForSubSector(templateConfigId, sector, superSector);
      }
      templateCache.set(templateConfigId, merged.questions);
      return merged.questions;
    } catch {
      return null;
    }
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
    if (stats.changed > 0 || stats.total > 50) {
      console.log(`  ${config}: ${stats.changed}/${stats.total} changed`);
    }
  }

  if (!dryRun && updates.length > 0) {
    console.log(`\nApplying ${updates.length} updates...`);

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
    if (updates.length > 0) {
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
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Recompute failed:', err);
  process.exit(1);
});
