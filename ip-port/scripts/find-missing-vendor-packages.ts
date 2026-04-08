/**
 * Find sectors with scored Broadcom patents but no vendor package.
 *
 * Scans PatentSubSectorScore + portfolio_patents for sectors with >= 20 scored patents,
 * then checks output/vendor-exports/ for existing packages.
 *
 * Usage: npx tsx scripts/find-missing-vendor-packages.ts [--min-patents=20]
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';
const VENDOR_EXPORTS_DIR = path.resolve('./output/vendor-exports');

const args = process.argv.slice(2);
const minPatents = parseInt(args.find(a => a.startsWith('--min-patents='))?.split('=')[1] || '20');

async function main() {
  console.log('=== Find Sectors Missing Vendor Packages ===\n');

  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) { console.error('broadcom-core portfolio not found'); process.exit(1); }

  // Get all sectors with scored broadcom patents
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

  console.log(`Sectors with >= ${minPatents} scored Broadcom patents: ${sectorCounts.length}\n`);

  // Scan existing vendor packages
  const existingPackages = new Set<string>();
  if (fs.existsSync(VENDOR_EXPORTS_DIR)) {
    for (const dir of fs.readdirSync(VENDOR_EXPORTS_DIR)) {
      // Strip date suffix: "network-switching-2026-03-10" -> "network-switching"
      const sectorSlug = dir.replace(/-\d{4}-\d{2}-\d{2}$/, '');
      existingPackages.add(sectorSlug);
    }
  }

  // Report
  const missing: { sector: string; count: number }[] = [];
  const covered: { sector: string; count: number }[] = [];

  for (const row of sectorCounts) {
    const sector = row.primary_sector;
    const count = Number(row.scored_count);
    if (existingPackages.has(sector) || existingPackages.has(sector.toUpperCase())) {
      covered.push({ sector, count });
    } else {
      missing.push({ sector, count });
    }
  }

  console.log('--- MISSING VENDOR PACKAGES ---');
  if (missing.length === 0) {
    console.log('  (none — all sectors have packages)');
  } else {
    for (const { sector, count } of missing) {
      console.log(`  ${sector.padEnd(35)} ${count} scored patents`);
    }
  }

  console.log(`\n--- EXISTING PACKAGES (${covered.length}) ---`);
  for (const { sector, count } of covered) {
    console.log(`  ${sector.padEnd(35)} ${count} scored patents`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total sectors with scored patents: ${sectorCounts.length}`);
  console.log(`With vendor packages:              ${covered.length}`);
  console.log(`Missing vendor packages:           ${missing.length}`);

  if (missing.length > 0) {
    console.log(`\nSectors ready for packaging:`);
    console.log(missing.map(m => m.sector).join('\n'));
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
