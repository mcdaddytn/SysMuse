/**
 * Create WIRELESS Litigation Focus Areas
 *
 * Creates parent + 6 sub-FAs + Tier 1 "Crown Jewels" via Prisma.
 *
 * Usage: npx tsx scripts/create-wireless-focus-areas.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OWNER_ID = 'default-user';
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';
const PARENT_COMPOSITE_THRESHOLD = 55;
const TIER1_COMPOSITE_THRESHOLD = 65;
const TIER1_REMAINING_YEARS_MIN = 5;
const TIER1_DAD_MIN = 7; // design_around_difficulty
const TIER1_IC_MIN = 7;  // implementation_clarity

// Sub-FA definitions: name → which primarySectors to include
const SUB_FA_DEFS: Array<{
  name: string;
  description: string;
  sectors: string[];
}> = [
  {
    name: '5G/LTE Standards-Essential',
    description: 'FRAND licensing leverage via 3GPP-mapped scheduling and transmission patents with high standards_essentiality.',
    sectors: ['wireless-scheduling', 'wireless-transmission'],
  },
  {
    name: 'RF Signal Chain',
    description: 'Every smartphone has these — high-volume damages basis. Covers RF acoustic filters, amplifiers, transceivers.',
    sectors: ['rf-acoustic'],
  },
  {
    name: 'Network Infrastructure',
    description: 'Targets carriers + equipment vendors (Ericsson, Nokia). Base station architecture, network topology, traffic management.',
    sectors: ['wireless-infrastructure'],
  },
  {
    name: 'Power Management',
    description: 'Universal applicability across all mobile devices. DRX/sleep, TX power control, device energy management.',
    sectors: ['wireless-power-mgmt'],
  },
  {
    name: 'MIMO & Antenna',
    description: 'Core to 5G massive MIMO. Beamforming, antenna arrays, spatial multiplexing.',
    sectors: ['wireless-mimo-antenna', 'antennas'],
  },
  {
    name: 'Mobility & Handover',
    description: 'Mandatory cellular functionality. Handover, idle mobility, connection management.',
    sectors: ['wireless-mobility'],
  },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\nCreating WIRELESS Litigation Focus Areas${dryRun ? ' (DRY RUN)' : ''}...\n`);

  // Get broadcom-core portfolio
  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) throw new Error(`Portfolio "${BROADCOM_PORTFOLIO_NAME}" not found`);

  // Get all broadcom WIRELESS patent IDs with their best scores
  const ppRows = await prisma.portfolioPatent.findMany({
    where: {
      portfolioId: portfolio.id,
      patent: { superSector: 'WIRELESS', isQuarantined: false },
    },
    select: { patentId: true, patent: { select: { primarySector: true, remainingYears: true } } },
  });

  const patentMeta = new Map(ppRows.map(r => [r.patentId, {
    sector: r.patent.primarySector || '',
    remainingYears: r.patent.remainingYears || 0,
  }]));

  const allPatentIds = ppRows.map(r => r.patentId);

  // Get best score per patent + key metrics
  const allScores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: allPatentIds } },
    select: { patentId: true, compositeScore: true, metrics: true },
    orderBy: { compositeScore: 'desc' },
  });

  const bestByPatent = new Map<string, { compositeScore: number; metrics: any }>();
  for (const s of allScores) {
    if (!bestByPatent.has(s.patentId)) {
      bestByPatent.set(s.patentId, { compositeScore: s.compositeScore, metrics: s.metrics });
    }
  }

  // Get citation data
  const citations = await prisma.patentCitationAnalysis.findMany({
    where: { patentId: { in: allPatentIds } },
    select: { patentId: true, competitorCitations: true },
  });
  const citMap = new Map(citations.map(c => [c.patentId, c.competitorCitations]));

  // ── Parent FA: all patents >= threshold ──
  const parentPatentIds = allPatentIds.filter(pid => {
    const best = bestByPatent.get(pid);
    return best && best.compositeScore >= PARENT_COMPOSITE_THRESHOLD;
  });

  console.log(`Parent FA: ${parentPatentIds.length} patents (composite >= ${PARENT_COMPOSITE_THRESHOLD})`);

  // ── Tier 1: crown jewels ──
  const tier1PatentIds = allPatentIds.filter(pid => {
    const best = bestByPatent.get(pid);
    if (!best || best.compositeScore < TIER1_COMPOSITE_THRESHOLD) return false;

    const meta = patentMeta.get(pid);
    if (!meta || meta.remainingYears <= TIER1_REMAINING_YEARS_MIN) return false;

    const metrics = best.metrics as Record<string, any>;
    const dadScore = metrics?.design_around_difficulty?.score || 0;
    const icScore = metrics?.implementation_clarity?.score || 0;

    return dadScore >= TIER1_DAD_MIN && icScore >= TIER1_IC_MIN;
  });

  console.log(`Tier 1 Crown Jewels: ${tier1PatentIds.length} patents`);

  // ── Sub-FAs ──
  const subFAPatents: Record<string, string[]> = {};
  for (const def of SUB_FA_DEFS) {
    subFAPatents[def.name] = parentPatentIds.filter(pid => {
      const meta = patentMeta.get(pid);
      return meta && def.sectors.includes(meta.sector);
    });
    console.log(`  Sub-FA "${def.name}": ${subFAPatents[def.name].length} patents (sectors: ${def.sectors.join(', ')})`);
  }

  // Check for uncovered sectors
  const coveredSectors = new Set(SUB_FA_DEFS.flatMap(d => d.sectors));
  const uncoveredPatents = parentPatentIds.filter(pid => {
    const meta = patentMeta.get(pid);
    return meta && !coveredSectors.has(meta.sector);
  });
  if (uncoveredPatents.length > 0) {
    const uncoveredSectors = [...new Set(uncoveredPatents.map(pid => patentMeta.get(pid)?.sector))];
    console.log(`  ⚠ ${uncoveredPatents.length} patents in uncovered sectors: ${uncoveredSectors.join(', ')}`);
  }

  if (dryRun) {
    console.log('\nDry run — no focus areas created.');
    await prisma.$disconnect();
    return;
  }

  // ── Create parent FA ──
  const parentFA = await prisma.focusArea.create({
    data: {
      name: 'Broadcom WIRELESS Litigation Targets',
      description: `All broadcom-core WIRELESS patents scoring ≥${PARENT_COMPOSITE_THRESHOLD} composite (litigation-reweighted v4). ${parentPatentIds.length} patents across 10 sectors.`,
      ownerId: OWNER_ID,
      superSector: 'WIRELESS',
      status: 'ACTIVE',
      patentCount: parentPatentIds.length,
    },
  });
  console.log(`\nCreated parent FA: ${parentFA.id}`);

  // Add parent patents
  await prisma.focusAreaPatent.createMany({
    data: parentPatentIds.map(patentId => ({
      focusAreaId: parentFA.id,
      patentId,
      membershipType: 'MANUAL' as const,
    })),
  });

  // ── Create sub-FAs ──
  for (const def of SUB_FA_DEFS) {
    const patents = subFAPatents[def.name];
    const subFA = await prisma.focusArea.create({
      data: {
        name: def.name,
        description: def.description,
        ownerId: OWNER_ID,
        superSector: 'WIRELESS',
        parentId: parentFA.id,
        status: 'ACTIVE',
        patentCount: patents.length,
      },
    });

    if (patents.length > 0) {
      await prisma.focusAreaPatent.createMany({
        data: patents.map(patentId => ({
          focusAreaId: subFA.id,
          patentId,
          membershipType: 'MANUAL' as const,
        })),
      });
    }

    console.log(`  Created sub-FA "${def.name}": ${subFA.id} (${patents.length} patents)`);
  }

  // ── Create Tier 1 ──
  const tier1FA = await prisma.focusArea.create({
    data: {
      name: 'WIRELESS Crown Jewels',
      description: `Top ${tier1PatentIds.length} patents: composite ≥${TIER1_COMPOSITE_THRESHOLD}, design_around_difficulty ≥${TIER1_DAD_MIN}, implementation_clarity ≥${TIER1_IC_MIN}, remaining years >${TIER1_REMAINING_YEARS_MIN}.`,
      ownerId: OWNER_ID,
      superSector: 'WIRELESS',
      parentId: parentFA.id,
      status: 'ACTIVE',
      patentCount: tier1PatentIds.length,
    },
  });

  await prisma.focusAreaPatent.createMany({
    data: tier1PatentIds.map(patentId => ({
      focusAreaId: tier1FA.id,
      patentId,
      membershipType: 'MANUAL' as const,
    })),
  });

  console.log(`  Created Tier 1 "WIRELESS Crown Jewels": ${tier1FA.id} (${tier1PatentIds.length} patents)`);

  // ── Summary ──
  console.log('\n=== Summary ===');
  console.log(`Parent FA: ${parentFA.id} — ${parentPatentIds.length} patents`);
  console.log(`Sub-FAs: 6 created`);
  console.log(`Tier 1: ${tier1FA.id} — ${tier1PatentIds.length} patents`);
  console.log(`\nTier 1 patent IDs: ${tier1PatentIds.join(', ')}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Focus area creation failed:', err);
  process.exit(1);
});
