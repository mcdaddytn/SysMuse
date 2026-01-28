/**
 * Sector Seed Service
 *
 * Seeds the database with sector definitions from config files.
 * Reads super-sectors, sectors, CPC rules, keyword rules, damages, and facets.
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SectorMapping {
  name: string;
  description: string;
  damages_tier: string;
  cpc_patterns: string[];
}

interface TermBasedSector {
  name: string;
  description: string;
  damages_tier: string;
  terms: string[];
}

interface SectorBreakoutConfig {
  sectorMappings: Record<string, SectorMapping>;
  termBasedSectors: Record<string, TermBasedSector>;
}

interface SuperSectorEntry {
  displayName: string;
  description: string;
  sectors: string[];
  damagesTier: string;
}

interface SuperSectorsConfig {
  superSectors: Record<string, SuperSectorEntry>;
  unmappedSectorDefault: string;
}

interface DamagesSectorEntry {
  damages_rating: number;
  label: string;
  description: string;
  rationale: string;
  [key: string]: unknown;
}

interface DamagesConfig {
  sectors: Record<string, DamagesSectorEntry>;
}

interface FacetsSectorEntry {
  display_name: string;
  damages_tier: string;
  facets: Record<string, number>;
  [key: string]: unknown;
}

interface FacetsConfig {
  sectors: Record<string, FacetsSectorEntry>;
}

interface SeedSummary {
  superSectors: number;
  sectors: number;
  cpcRules: number;
  keywordRules: number;
  damagesUpdated: number;
  facetsUpdated: number;
}

function readJsonConfig<T>(filename: string): T {
  const configPath = path.join(process.cwd(), 'config', filename);
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Seed sectors from config files into the database.
 * Uses upserts so it's safe to run multiple times.
 */
export async function seedSectorsFromConfig(): Promise<SeedSummary> {
  const superSectorsConfig = readJsonConfig<SuperSectorsConfig>('super-sectors.json');
  const breakoutConfig = readJsonConfig<SectorBreakoutConfig>('sector-breakout-v2.json');
  const damagesConfig = readJsonConfig<DamagesConfig>('sector-damages.json');
  const facetsConfig = readJsonConfig<FacetsConfig>('sector-facets.json');

  const summary: SeedSummary = {
    superSectors: 0,
    sectors: 0,
    cpcRules: 0,
    keywordRules: 0,
    damagesUpdated: 0,
    facetsUpdated: 0,
  };

  // Step 1: Upsert SuperSector rows
  const superSectorIdMap = new Map<string, string>();

  for (const [key, entry] of Object.entries(superSectorsConfig.superSectors)) {
    const superSector = await prisma.superSector.upsert({
      where: { name: key },
      create: {
        name: key,
        displayName: entry.displayName,
        description: entry.description,
      },
      update: {
        displayName: entry.displayName,
        description: entry.description,
      },
    });
    superSectorIdMap.set(key, superSector.id);
    summary.superSectors++;
  }

  // Step 2: Build sector-to-superSector mapping from config
  const sectorToSuperSectorKey = new Map<string, string>();
  for (const [ssKey, ssEntry] of Object.entries(superSectorsConfig.superSectors)) {
    for (const sectorName of ssEntry.sectors) {
      sectorToSuperSectorKey.set(sectorName, ssKey);
    }
  }

  // Step 3: Upsert Sector rows from sectorMappings (CPC-based)
  const sectorIdMap = new Map<string, string>();

  for (const [sectorKey, sectorData] of Object.entries(breakoutConfig.sectorMappings)) {
    const ssKey = sectorToSuperSectorKey.get(sectorKey);
    const superSectorId = ssKey ? superSectorIdMap.get(ssKey) : undefined;

    const sector = await prisma.sector.upsert({
      where: { name: sectorKey },
      create: {
        name: sectorKey,
        displayName: sectorData.name,
        description: sectorData.description,
        cpcPrefixes: sectorData.cpc_patterns,
        damagesTier: sectorData.damages_tier,
        superSectorId: superSectorId || null,
      },
      update: {
        displayName: sectorData.name,
        description: sectorData.description,
        cpcPrefixes: sectorData.cpc_patterns,
        damagesTier: sectorData.damages_tier,
        superSectorId: superSectorId || null,
      },
    });
    sectorIdMap.set(sectorKey, sector.id);
    summary.sectors++;
  }

  // Step 4: Upsert Sector rows from termBasedSectors (keyword-based)
  for (const [sectorKey, sectorData] of Object.entries(breakoutConfig.termBasedSectors)) {
    const ssKey = sectorToSuperSectorKey.get(sectorKey);
    const superSectorId = ssKey ? superSectorIdMap.get(ssKey) : undefined;

    const sector = await prisma.sector.upsert({
      where: { name: sectorKey },
      create: {
        name: sectorKey,
        displayName: sectorData.name,
        description: sectorData.description,
        cpcPrefixes: [],
        damagesTier: sectorData.damages_tier,
        superSectorId: superSectorId || null,
      },
      update: {
        displayName: sectorData.name,
        description: sectorData.description,
        damagesTier: sectorData.damages_tier,
        superSectorId: superSectorId || null,
      },
    });
    sectorIdMap.set(sectorKey, sector.id);
    summary.sectors++;
  }

  // Step 5: Create SectorRules — first delete all existing LIBRARY-scoped rules, then recreate
  await prisma.sectorRule.deleteMany({
    where: { scope: 'LIBRARY', portfolioId: null },
  });

  // CPC rules from sectorMappings
  for (const [sectorKey, sectorData] of Object.entries(breakoutConfig.sectorMappings)) {
    const sectorId = sectorIdMap.get(sectorKey);
    if (!sectorId) continue;

    for (const pattern of sectorData.cpc_patterns) {
      await prisma.sectorRule.create({
        data: {
          sectorId,
          ruleType: 'CPC_PREFIX',
          expression: pattern,
          priority: pattern.length * 10, // Longer = more specific = higher priority
          scope: 'LIBRARY',
          description: `CPC prefix ${pattern} → ${sectorData.name}`,
        },
      });
      summary.cpcRules++;
    }
  }

  // Keyword rules from termBasedSectors
  for (const [sectorKey, sectorData] of Object.entries(breakoutConfig.termBasedSectors)) {
    const sectorId = sectorIdMap.get(sectorKey);
    if (!sectorId) continue;

    for (const term of sectorData.terms) {
      await prisma.sectorRule.create({
        data: {
          sectorId,
          ruleType: 'KEYWORD',
          expression: term,
          priority: 50, // Keyword rules at moderate priority
          scope: 'LIBRARY',
          description: `Keyword "${term}" → ${sectorData.name}`,
        },
      });
      summary.keywordRules++;
    }
  }

  // Step 6: Update damagesRating from sector-damages.json
  const damagesTierToRating: Record<string, number> = {
    'Low': 1, 'Medium': 2, 'High': 3, 'Very High': 4,
  };

  for (const [sectorKey, damagesEntry] of Object.entries(damagesConfig.sectors)) {
    const sectorId = sectorIdMap.get(sectorKey);
    if (!sectorId) continue;

    await prisma.sector.update({
      where: { id: sectorId },
      data: {
        damagesRating: damagesEntry.damages_rating,
      },
    });
    summary.damagesUpdated++;
  }

  // Also set damagesRating from damagesTier for sectors not in damages config
  const allSectors = await prisma.sector.findMany({
    where: { damagesRating: null, damagesTier: { not: null } },
  });
  for (const sector of allSectors) {
    if (sector.damagesTier && damagesTierToRating[sector.damagesTier]) {
      await prisma.sector.update({
        where: { id: sector.id },
        data: { damagesRating: damagesTierToRating[sector.damagesTier] },
      });
      summary.damagesUpdated++;
    }
  }

  // Step 7: Update facets from sector-facets.json
  for (const [sectorKey, facetsEntry] of Object.entries(facetsConfig.sectors)) {
    const sectorId = sectorIdMap.get(sectorKey);
    if (!sectorId) continue;

    await prisma.sector.update({
      where: { id: sectorId },
      data: {
        facets: facetsEntry.facets as Record<string, number>,
      },
    });
    summary.facetsUpdated++;
  }

  return summary;
}
