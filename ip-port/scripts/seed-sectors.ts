/**
 * Seed Sector and SuperSector tables from config files.
 *
 * Sources:
 * - config/super-sectors.json → SuperSector + sector-to-super-sector mapping
 * - config/sector-breakout-v2.json → Sector CPC prefixes and damages tiers
 * - config/sector-damages.json → Additional damages tier data
 *
 * Usage: npx tsx scripts/seed-sectors.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SuperSectorConfig {
  superSectors: Record<string, {
    displayName: string;
    description?: string;
    sectors: string[];
    damagesTier?: string;
  }>;
}

interface SectorBreakoutConfig {
  sectorMappings: Record<string, {
    name: string;
    description?: string;
    damages_tier?: string;
    cpc_patterns: string[];
  }>;
}

function toDisplayName(sectorName: string): string {
  return sectorName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function main() {
  console.log('Seeding sectors from config files...\n');

  // Load config files
  const superSectorsConfig: SuperSectorConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config/super-sectors.json'), 'utf-8')
  );
  const sectorBreakoutConfig: SectorBreakoutConfig = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config/sector-breakout-v2.json'), 'utf-8')
  );

  // Build sector → super-sector mapping
  const sectorToSuperSector: Record<string, string> = {};
  for (const [ssKey, ssData] of Object.entries(superSectorsConfig.superSectors)) {
    for (const sectorName of ssData.sectors) {
      sectorToSuperSector[sectorName] = ssKey;
    }
  }

  // Collect all unique sector names from both sources
  const allSectorNames = new Set<string>();

  // From super-sectors config (all referenced sectors)
  for (const ssData of Object.values(superSectorsConfig.superSectors)) {
    for (const sectorName of ssData.sectors) {
      allSectorNames.add(sectorName);
    }
  }

  // From sector breakout config (CPC-mapped sectors)
  for (const sectorName of Object.keys(sectorBreakoutConfig.sectorMappings)) {
    allSectorNames.add(sectorName);
  }

  console.log(`Found ${Object.keys(superSectorsConfig.superSectors).length} super-sectors`);
  console.log(`Found ${allSectorNames.size} unique sectors\n`);

  // Upsert super-sectors
  const superSectorIds: Record<string, string> = {};
  for (const [ssKey, ssData] of Object.entries(superSectorsConfig.superSectors)) {
    const ss = await prisma.superSector.upsert({
      where: { name: ssKey },
      update: {
        displayName: ssData.displayName,
        description: ssData.description || null,
      },
      create: {
        name: ssKey,
        displayName: ssData.displayName,
        description: ssData.description || null,
      },
    });
    superSectorIds[ssKey] = ss.id;
    console.log(`  SuperSector: ${ssKey} → ${ssData.displayName} (${ssData.sectors.length} sectors)`);
  }

  // Upsert sectors
  let created = 0;
  let updated = 0;
  for (const sectorName of [...allSectorNames].sort()) {
    const breakoutData = sectorBreakoutConfig.sectorMappings[sectorName];
    const superSectorKey = sectorToSuperSector[sectorName];

    const displayName = breakoutData?.name || toDisplayName(sectorName);
    const description = breakoutData?.description || null;
    const cpcPrefixes = breakoutData?.cpc_patterns || [];
    const damagesTier = breakoutData?.damages_tier || null;
    const superSectorId = superSectorKey ? superSectorIds[superSectorKey] : null;

    const existing = await prisma.sector.findUnique({ where: { name: sectorName } });

    await prisma.sector.upsert({
      where: { name: sectorName },
      update: {
        displayName,
        description,
        cpcPrefixes,
        damagesTier,
        superSectorId,
      },
      create: {
        name: sectorName,
        displayName,
        description,
        cpcPrefixes,
        damagesTier,
        superSectorId,
      },
    });

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  console.log(`\nSectors: ${created} created, ${updated} updated`);

  // Summary
  const sectorCount = await prisma.sector.count();
  const superSectorCount = await prisma.superSector.count();
  const withCpc = await prisma.sector.count({ where: { cpcPrefixes: { isEmpty: false } } });
  const withDamages = await prisma.sector.count({ where: { damagesTier: { not: null } } });

  console.log(`\n=== Summary ===`);
  console.log(`Super-sectors: ${superSectorCount}`);
  console.log(`Sectors: ${sectorCount}`);
  console.log(`  With CPC prefixes: ${withCpc}`);
  console.log(`  With damages tier: ${withDamages}`);
  console.log(`  Without super-sector: ${await prisma.sector.count({ where: { superSectorId: null } })}`);
}

main()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error seeding sectors:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
