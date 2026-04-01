#!/usr/bin/env npx tsx
/**
 * Backfill PatentQuestionCurrency from Existing PatentSubSectorScore Records
 *
 * All existing scores were created before revAIQ, so they all get v1 at each
 * applicable level. The taxonomy path is derived from patent.superSector +
 * score.templateConfigId.
 *
 * Run: npx tsx scripts/backfill-patent-currency.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Backfilling PatentQuestionCurrency from existing scores...\n');

  // Check current state
  const existingCurrency = await prisma.patentQuestionCurrency.count();
  console.log(`  Existing currency records: ${existingCurrency}`);

  // Load all scores with patent superSector, grouped by patent+template
  const scores = await prisma.patentSubSectorScore.findMany({
    select: {
      patentId: true,
      templateConfigId: true,
      llmModel: true,
      executedAt: true,
    },
    where: {
      templateConfigId: { not: null },
    },
    orderBy: { executedAt: 'desc' },
  });

  console.log(`  PatentSubSectorScore records: ${scores.length}`);

  // Load patent superSector mapping
  const patents = await prisma.patent.findMany({
    select: { patentId: true, superSector: true },
    where: { patentId: { in: [...new Set(scores.map(s => s.patentId))] } },
  });
  const superSectorMap = new Map(patents.map(p => [p.patentId, p.superSector || '']));

  console.log(`  Patents with superSector: ${patents.length}`);

  // Build currency records — one per unique (patentId, taxonomyPath)
  // Use the most recent score per patent+path combination
  const currencyMap = new Map<string, {
    patentId: string;
    taxonomyPath: string;
    llmModel: string | null;
    scoredAt: Date;
  }>();

  for (const score of scores) {
    const superSector = superSectorMap.get(score.patentId);
    if (!superSector) continue;

    const taxonomyPath = `${superSector}/${score.templateConfigId}`;
    const key = `${score.patentId}:${taxonomyPath}`;

    // Keep most recent (scores are ordered by executedAt desc)
    if (!currencyMap.has(key)) {
      currencyMap.set(key, {
        patentId: score.patentId,
        taxonomyPath,
        llmModel: score.llmModel,
        scoredAt: score.executedAt,
      });
    }
  }

  console.log(`  Unique (patent, path) combinations: ${currencyMap.size}`);

  // Batch insert
  const BATCH_SIZE = 1000;
  const records = Array.from(currencyMap.values());
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const createData = batch.map(r => ({
      patentId: r.patentId,
      taxonomyPath: r.taxonomyPath,
      revAIQ: '1.1.1.0',  // All pre-revAIQ scores are v1 at all levels, 0 for sub-sector (scored at sector level)
      portfolioVersion: 1,
      superSectorVersion: 1,
      sectorVersion: 1,
      subSectorVersion: 0,  // Existing scores are at sector level, not sub-sector
      llmModel: r.llmModel,
      scoredAt: r.scoredAt,
    }));

    try {
      const result = await prisma.patentQuestionCurrency.createMany({
        data: createData,
        skipDuplicates: true,
      });
      inserted += result.count;
      skipped += batch.length - result.count;
    } catch (err: any) {
      console.warn(`  Batch ${i / BATCH_SIZE + 1} error: ${err.message}`);
      skipped += batch.length;
    }

    if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= records.length) {
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length} (inserted=${inserted}, skipped=${skipped})`);
    }
  }

  // Final count
  const finalCount = await prisma.patentQuestionCurrency.count();
  console.log(`\n✓ Backfill complete.`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (duplicates): ${skipped}`);
  console.log(`  Total currency records: ${finalCount}`);
}

main()
  .catch(e => { console.error('Backfill failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
