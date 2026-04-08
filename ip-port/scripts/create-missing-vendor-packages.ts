/**
 * Batch-create vendor packages for sectors that are missing them.
 *
 * Reads the output of find-missing-vendor-packages.ts (or queries directly)
 * and sequentially runs create-sector-vendor-package.ts for each missing sector.
 *
 * Requires: app server running on localhost:3001
 *
 * Usage: npx tsx scripts/create-missing-vendor-packages.ts [--min-patents=20] [--top=35] [--dry-run]
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const prisma = new PrismaClient();
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';
const VENDOR_EXPORTS_DIR = path.resolve('./output/vendor-exports');

const args = process.argv.slice(2);
const minPatents = parseInt(args.find(a => a.startsWith('--min-patents='))?.split('=')[1] || '20');
const topN = args.find(a => a.startsWith('--top='))?.split('=')[1] || '35';
const dryRun = args.includes('--dry-run');

async function main() {
  console.log('=== Batch Create Missing Vendor Packages ===\n');
  if (dryRun) console.log('MODE: DRY RUN\n');

  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) { console.error('broadcom-core portfolio not found'); process.exit(1); }

  const sectorCounts = await prisma.$queryRaw<{ primary_sector: string; scored_count: bigint }[]>`
    SELECT p.primary_sector, COUNT(DISTINCT pss.patent_id) as scored_count
    FROM patent_sub_sector_scores pss
    JOIN patents p ON p.patent_id = pss.patent_id
    JOIN portfolio_patents pp ON pp.patent_id = p.patent_id
    WHERE pp.portfolio_id = ${portfolio.id}
      AND p.is_quarantined = false
      AND p.primary_sector IS NOT NULL
    GROUP BY p.primary_sector
    HAVING COUNT(DISTINCT pss.patent_id) >= ${minPatents}
    ORDER BY COUNT(DISTINCT pss.patent_id) DESC
  `;

  // Find existing packages
  const existingPackages = new Set<string>();
  if (fs.existsSync(VENDOR_EXPORTS_DIR)) {
    for (const dir of fs.readdirSync(VENDOR_EXPORTS_DIR)) {
      const sectorSlug = dir.replace(/-\d{4}-\d{2}-\d{2}$/, '');
      existingPackages.add(sectorSlug);
    }
  }

  const missing = sectorCounts
    .filter(row => !existingPackages.has(row.primary_sector) && !existingPackages.has(row.primary_sector.toUpperCase()))
    .map(row => ({ sector: row.primary_sector, count: Number(row.scored_count) }));

  if (missing.length === 0) {
    console.log('All sectors with sufficient scored patents already have vendor packages.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${missing.length} sectors missing vendor packages:\n`);
  for (const { sector, count } of missing) {
    console.log(`  ${sector.padEnd(35)} ${count} scored patents`);
  }

  await prisma.$disconnect();

  if (dryRun) {
    console.log('\n(Dry run — no packages will be created)');
    return;
  }

  // Sequentially create packages
  console.log('\n--- Creating packages ---\n');
  let created = 0;
  let failed = 0;

  for (const { sector } of missing) {
    console.log(`\n========== ${sector} ==========`);
    try {
      execSync(
        `npx tsx scripts/create-sector-vendor-package.ts ${sector} --top=${topN}`,
        { stdio: 'inherit', cwd: process.cwd(), timeout: 30 * 60 * 1000 }
      );
      created++;
    } catch (err) {
      console.error(`Failed to create package for ${sector}:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  console.log(`\n=== Batch Summary ===`);
  console.log(`Created: ${created}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Total:   ${missing.length}`);
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
