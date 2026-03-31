/**
 * Full v2 Taxonomy Refactor Runner
 *
 * Runs the generalized taxonomy refactor pipeline across all v1 sectors
 * to produce a complete v2 taxonomy with sub-sectors.
 *
 * Usage:
 *   npx tsx scripts/run-v2-full-refactor.ts [--dry-run] [--sector <code>] [--skip-existing]
 *
 * Options:
 *   --dry-run       Analyze and propose without writing to DB
 *   --sector <code> Process only a specific sector (e.g., --sector video-codec)
 *   --skip-existing Skip sectors that already have v2 L3 sub-sectors (default: true)
 *   --force         Re-process sectors even if they have existing v2 sub-sectors
 *   --min-patents N Skip sectors with fewer than N patents (default: 20)
 */

import { PrismaClient } from '@prisma/client';
import {
  refactorSector,
  DEFAULT_REFACTOR_SPEC,
  type RefactorSpec,
  type RefactorProgress,
  type SectorRefactorResult,
} from '../src/api/services/taxonomy-refactor-service.js';

const prisma = new PrismaClient();

const V1_TAXONOMY_TYPE_ID = 'tax_cpc_tech_1774722938212';
const V2_TAXONOMY_TYPE_ID = 'tt_patent_v2';
const V2_PORTFOLIO_GROUP_ID = 'pg_v2_pilot';
const BROADCOM_PORTFOLIO_ID = 'cmlsddwn2000013ehgqyko2f7';

interface RunOptions {
  dryRun: boolean;
  singleSector: string | null;
  skipExisting: boolean;
  minPatents: number;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const opts: RunOptions = {
    dryRun: args.includes('--dry-run'),
    singleSector: null,
    skipExisting: !args.includes('--force'),
    minPatents: 20,
  };

  const sectorIdx = args.indexOf('--sector');
  if (sectorIdx !== -1 && args[sectorIdx + 1]) {
    opts.singleSector = args[sectorIdx + 1];
  }

  const minIdx = args.indexOf('--min-patents');
  if (minIdx !== -1 && args[minIdx + 1]) {
    opts.minPatents = parseInt(args[minIdx + 1], 10);
  }

  return opts;
}

/**
 * Ensure v2 L1 nodes exist for all v1 super-sectors.
 * Returns map of v1 L1 code → v2 L1 node ID.
 */
async function ensureV2SuperSectors(dryRun: boolean): Promise<Map<string, string>> {
  const v1L1Nodes = await prisma.taxonomyNode.findMany({
    where: { taxonomyTypeId: V1_TAXONOMY_TYPE_ID, level: 1 },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  const codeToId = new Map<string, string>();

  for (const v1Node of v1L1Nodes) {
    // Check if v2 already has this L1 node
    const existing = await prisma.taxonomyNode.findFirst({
      where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID, code: v1Node.code, level: 1 },
    });

    if (existing) {
      codeToId.set(v1Node.code, existing.id);
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would create v2 L1: ${v1Node.code} (${v1Node.name})`);
      codeToId.set(v1Node.code, `dry-run-${v1Node.code}`);
      continue;
    }

    const created = await prisma.taxonomyNode.create({
      data: {
        taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
        code: v1Node.code,
        name: v1Node.name,
        level: 1,
        path: v1Node.code,
        parentId: null,
        metadata: {},
      },
    });

    console.log(`  Created v2 L1: ${v1Node.code} (${v1Node.name}) → ${created.id}`);
    codeToId.set(v1Node.code, created.id);
  }

  return codeToId;
}

/**
 * Get all v1 L2 sectors that have patents assigned via primary_sector.
 */
async function getSectorsWithPatents(minPatents: number): Promise<
  { id: string; code: string; name: string; parentCode: string; patentCount: number }[]
> {
  // Get patent counts per sector from pragmatic field
  const sectorCounts = await prisma.$queryRaw<{ primary_sector: string; cnt: bigint }[]>`
    SELECT primary_sector, COUNT(*) as cnt
    FROM patents
    WHERE primary_sector IS NOT NULL
    GROUP BY primary_sector
    HAVING COUNT(*) >= ${minPatents}
    ORDER BY COUNT(*) DESC
  `;

  const sectorCodes = sectorCounts.map(s => s.primary_sector);

  // Get the v1 L2 taxonomy nodes for these sectors
  const v1Sectors = await prisma.taxonomyNode.findMany({
    where: {
      taxonomyTypeId: V1_TAXONOMY_TYPE_ID,
      level: 2,
      code: { in: sectorCodes },
    },
    include: {
      parent: { select: { code: true } },
    },
    orderBy: { code: 'asc' },
  });

  const countMap = new Map(sectorCounts.map(s => [s.primary_sector, Number(s.cnt)]));

  return v1Sectors.map(s => ({
    id: s.id,
    code: s.code,
    name: s.name,
    parentCode: s.parent?.code || 'UNKNOWN',
    patentCount: countMap.get(s.code) || 0,
  }));
}

/**
 * Check which sectors already have v2 L3 sub-sectors.
 */
async function getExistingV2Sectors(): Promise<Set<string>> {
  // Find v2 L2 nodes that already have L3 children
  const v2L2WithChildren = await prisma.$queryRaw<{ code: string }[]>`
    SELECT DISTINCT parent.code
    FROM taxonomy_nodes child
    JOIN taxonomy_nodes parent ON child.parent_id = parent.id
    WHERE child.taxonomy_type_id = ${V2_TAXONOMY_TYPE_ID}
      AND child.level = 3
      AND parent.level = 2
  `;

  // Map v2 L2 codes back to v1 sector codes
  // V2 codes look like "SDN/switching" → v1 code is "network-switching"
  // We need to check what v1 sector each v2 L2 represents
  const v2L2Nodes = await prisma.taxonomyNode.findMany({
    where: {
      taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
      level: 2,
      code: { in: v2L2WithChildren.map(n => n.code) },
    },
    select: { code: true, name: true },
  });

  // Also check by matching the v1 code directly in case some v2 L2s use v1 codes
  const existingCodes = new Set<string>();

  // The refactor service creates v2 L2 nodes with the SAME code as the v1 sector
  // (see findOrCreateOutputSector in refactor service)
  for (const node of v2L2WithChildren) {
    existingCodes.add(node.code);
  }

  return existingCodes;
}

/**
 * Progress callback for console output.
 */
function logProgress(progress: RefactorProgress): void {
  const prefix = `  [${progress.sectorCode}][iter ${progress.iteration}]`;
  switch (progress.phase) {
    case 'analyze':
      console.log(`${prefix} ${progress.message}`);
      break;
    case 'propose':
      console.log(`${prefix} ${progress.message}`);
      break;
    case 'classify':
      console.log(`${prefix} ${progress.message}`);
      break;
    case 'validate':
      if (progress.violations > 0) {
        console.log(`${prefix} ${progress.subsectorCount} sub-sectors, ${progress.violations} violations`);
      } else {
        console.log(`${prefix} ✓ ${progress.subsectorCount} sub-sectors, all targets met`);
      }
      break;
    case 'consolidate':
      console.log(`${prefix} ${progress.message}`);
      break;
    case 'complete':
      console.log(`${prefix} ${progress.message}`);
      break;
  }
}

async function main() {
  const opts = parseArgs();

  console.log('='.repeat(70));
  console.log('  Full v2 Taxonomy Refactor');
  console.log('='.repeat(70));
  console.log(`  Mode: ${opts.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`  Skip existing: ${opts.skipExisting}`);
  console.log(`  Min patents: ${opts.minPatents}`);
  if (opts.singleSector) console.log(`  Single sector: ${opts.singleSector}`);
  console.log('');

  // Step 1: Ensure v2 L1 super-sector nodes exist
  console.log('Step 1: Ensuring v2 L1 super-sector nodes...');
  const v2L1Map = await ensureV2SuperSectors(opts.dryRun);
  console.log(`  ${v2L1Map.size} super-sectors ready\n`);

  // Step 2: Gather sectors to process
  console.log('Step 2: Gathering sectors to process...');
  let sectors = await getSectorsWithPatents(opts.minPatents);

  if (opts.singleSector) {
    sectors = sectors.filter(s => s.code === opts.singleSector);
    if (sectors.length === 0) {
      console.error(`  ERROR: Sector '${opts.singleSector}' not found or has < ${opts.minPatents} patents`);
      process.exit(1);
    }
  }

  // Step 3: Filter out already-done sectors
  let skipped: string[] = [];
  if (opts.skipExisting) {
    const existing = await getExistingV2Sectors();
    if (existing.size > 0) {
      console.log(`  Already processed: ${[...existing].join(', ')}`);
      skipped = sectors.filter(s => existing.has(s.code)).map(s => s.code);
      sectors = sectors.filter(s => !existing.has(s.code));
    }
  }

  console.log(`  Sectors to process: ${sectors.length}`);
  console.log(`  Skipped (existing): ${skipped.length}`);
  console.log(`  Total patents: ${sectors.reduce((sum, s) => sum + s.patentCount, 0).toLocaleString()}\n`);

  // Show sector list
  console.log('  Sector breakdown:');
  for (const s of sectors) {
    console.log(`    ${s.code.padEnd(30)} ${String(s.patentCount).padStart(6)} patents  [${s.parentCode}]`);
  }
  console.log('');

  // Step 4: Build the refactor spec
  const spec: RefactorSpec = {
    ...DEFAULT_REFACTOR_SPEC,
    inputTaxonomyTypeId: V1_TAXONOMY_TYPE_ID,
    outputTaxonomyTypeId: V2_TAXONOMY_TYPE_ID,
    outputPortfolioGroupId: V2_PORTFOLIO_GROUP_ID,
    referencePortfolioIds: [BROADCOM_PORTFOLIO_ID],
    dryRun: opts.dryRun,
    mode: 'automatic' as const,
  };

  // Step 5: Process each sector
  console.log('Step 3: Running refactor pipeline...');
  console.log('-'.repeat(70));

  const results: SectorRefactorResult[] = [];
  const errors: { code: string; error: string }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < sectors.length; i++) {
    const sector = sectors[i];
    const sectorStart = Date.now();

    console.log(`\n[${i + 1}/${sectors.length}] ${sector.code} (${sector.patentCount} patents, parent: ${sector.parentCode})`);

    try {
      const result = await refactorSector(sector.id, spec, logProgress);
      results.push(result);

      const elapsed = ((Date.now() - sectorStart) / 1000).toFixed(1);
      const status = result.converged ? '✓ converged' : `⚠ ${result.violations.length} violations`;
      console.log(`  Done in ${elapsed}s: ${result.subsectorCount} sub-sectors, ${result.rulesCreated} rules, ${result.classificationsCreated} classifications — ${status}`);
    } catch (err: any) {
      const elapsed = ((Date.now() - sectorStart) / 1000).toFixed(1);
      console.error(`  ERROR after ${elapsed}s: ${err.message}`);
      errors.push({ code: sector.code, error: err.message });
    }
  }

  // Step 6: Summary
  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(70));
  console.log('  REFACTOR COMPLETE');
  console.log('='.repeat(70));
  console.log(`  Duration: ${totalElapsed}s`);
  console.log(`  Sectors processed: ${results.length}/${sectors.length}`);
  console.log(`  Sectors skipped: ${skipped.length}`);
  console.log(`  Errors: ${errors.length}`);
  console.log('');

  if (results.length > 0) {
    const totalNodes = results.reduce((s, r) => s + r.nodesCreated, 0);
    const totalRules = results.reduce((s, r) => s + r.rulesCreated, 0);
    const totalPatents = results.reduce((s, r) => s + r.patentsClassified, 0);
    const totalClassifications = results.reduce((s, r) => s + r.classificationsCreated, 0);
    const converged = results.filter(r => r.converged).length;
    const withViolations = results.filter(r => !r.converged);

    console.log('  Totals:');
    console.log(`    Sub-sectors created: ${totalNodes}`);
    console.log(`    Rules created:       ${totalRules}`);
    console.log(`    Patents classified:  ${totalPatents}`);
    console.log(`    Classifications:     ${totalClassifications}`);
    console.log(`    Converged:           ${converged}/${results.length}`);
    console.log('');

    if (withViolations.length > 0) {
      console.log('  Sectors with violations:');
      for (const r of withViolations) {
        console.log(`    ${r.sectorCode}: ${r.violations.length} violations`);
        for (const v of r.violations.slice(0, 5)) {
          console.log(`      - ${v.type}: ${v.nodeCode} (${v.actual} vs target ${v.target})`);
        }
        if (r.violations.length > 5) console.log(`      ... and ${r.violations.length - 5} more`);
      }
      console.log('');
    }
  }

  if (errors.length > 0) {
    console.log('  Errors:');
    for (const e of errors) {
      console.log(`    ${e.code}: ${e.error}`);
    }
    console.log('');
  }

  // Final DB state
  const finalCounts = await prisma.taxonomyNode.groupBy({
    by: ['level'],
    where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID },
    _count: true,
    orderBy: { level: 'asc' },
  });
  const finalClassCount = await prisma.objectClassification.count({
    where: { portfolioGroupId: V2_PORTFOLIO_GROUP_ID },
  });

  console.log('  Final v2 taxonomy state:');
  for (const c of finalCounts) {
    const label = c.level === 1 ? 'Super-sectors' : c.level === 2 ? 'Sectors' : 'Sub-sectors';
    console.log(`    L${c.level} ${label}: ${c._count}`);
  }
  console.log(`    Classifications: ${finalClassCount}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
