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

// ============================================================================
// CPC-Only Taxonomy Seed Function
// ============================================================================

/**
 * New taxonomy format types (sector-taxonomy-cpc-only.json)
 */
interface CpcOnlySuperSector {
  displayName: string;
  description: string;
  damagesTier: string;
  sectors: string[];
}

interface CpcOnlySector {
  displayName: string;
  description: string;
  damagesTier: string;
  cpcPrefixes: string[];
}

interface CpcOnlyTaxonomyConfig {
  version: string;
  description: string;
  superSectors: Record<string, CpcOnlySuperSector>;
  sectors: Record<string, CpcOnlySector>;
  unmappedSectorDefault: string;
}

interface CpcOnlySeedSummary {
  superSectors: number;
  sectors: number;
  cpcRules: number;
  sectorsDeleted: number;
  rulesDeleted: number;
}

/**
 * Seed sectors from the new CPC-only taxonomy format.
 * This is a cleaner, more predictable taxonomy based purely on CPC codes.
 *
 * @param configFile - Config file name (default: 'sector-taxonomy-cpc-only.json')
 * @param cleanStart - If true, deletes all existing sectors and rules first (default: false)
 */
export async function seedCpcOnlyTaxonomy(
  configFile = 'sector-taxonomy-cpc-only.json',
  cleanStart = false
): Promise<CpcOnlySeedSummary> {
  const configPath = path.join(process.cwd(), 'config', configFile);

  if (!fs.existsSync(configPath)) {
    throw new Error(`Taxonomy config not found: ${configPath}`);
  }

  const config: CpcOnlyTaxonomyConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const summary: CpcOnlySeedSummary = {
    superSectors: 0,
    sectors: 0,
    cpcRules: 0,
    sectorsDeleted: 0,
    rulesDeleted: 0,
  };

  // Damages tier to numeric rating conversion
  const damagesTierToRating: Record<string, number> = {
    'Low': 1,
    'Medium': 2,
    'High': 3,
    'Very High': 4,
  };

  // Optional: Clean start - delete all existing data
  if (cleanStart) {
    const deletedRules = await prisma.sectorRule.deleteMany({});
    summary.rulesDeleted = deletedRules.count;

    const deletedSectors = await prisma.sector.deleteMany({});
    summary.sectorsDeleted = deletedSectors.count;

    await prisma.superSector.deleteMany({});
  }

  // Step 1: Create/upsert SuperSectors
  const superSectorIdMap = new Map<string, string>();

  for (const [ssKey, ssData] of Object.entries(config.superSectors)) {
    const superSector = await prisma.superSector.upsert({
      where: { name: ssKey },
      create: {
        name: ssKey,
        displayName: ssData.displayName,
        description: ssData.description,
      },
      update: {
        displayName: ssData.displayName,
        description: ssData.description,
      },
    });
    superSectorIdMap.set(ssKey, superSector.id);
    summary.superSectors++;
  }

  // Step 2: Build sector-to-superSector mapping
  const sectorToSuperSectorKey = new Map<string, string>();
  for (const [ssKey, ssData] of Object.entries(config.superSectors)) {
    for (const sectorName of ssData.sectors) {
      sectorToSuperSectorKey.set(sectorName, ssKey);
    }
  }

  // Step 3: Create/upsert Sectors
  const sectorIdMap = new Map<string, string>();

  for (const [sectorKey, sectorData] of Object.entries(config.sectors)) {
    const ssKey = sectorToSuperSectorKey.get(sectorKey);
    const superSectorId = ssKey ? superSectorIdMap.get(ssKey) : null;
    const damagesRating = damagesTierToRating[sectorData.damagesTier] || null;

    const sector = await prisma.sector.upsert({
      where: { name: sectorKey },
      create: {
        name: sectorKey,
        displayName: sectorData.displayName,
        description: sectorData.description,
        cpcPrefixes: sectorData.cpcPrefixes,
        damagesTier: sectorData.damagesTier,
        damagesRating,
        superSectorId,
      },
      update: {
        displayName: sectorData.displayName,
        description: sectorData.description,
        cpcPrefixes: sectorData.cpcPrefixes,
        damagesTier: sectorData.damagesTier,
        damagesRating,
        superSectorId,
      },
    });
    sectorIdMap.set(sectorKey, sector.id);
    summary.sectors++;
  }

  // Step 4: Delete existing LIBRARY-scoped CPC rules and recreate
  await prisma.sectorRule.deleteMany({
    where: {
      scope: 'LIBRARY',
      portfolioId: null,
      ruleType: 'CPC_PREFIX',
    },
  });

  // Step 5: Create CPC_PREFIX rules for each sector
  for (const [sectorKey, sectorData] of Object.entries(config.sectors)) {
    const sectorId = sectorIdMap.get(sectorKey);
    if (!sectorId) continue;

    for (const cpcPrefix of sectorData.cpcPrefixes) {
      // Priority based on specificity (longer prefix = higher priority)
      // Remove slash for length calculation
      const cleanPrefix = cpcPrefix.replace('/', '');
      const priority = cleanPrefix.length * 10;

      await prisma.sectorRule.create({
        data: {
          sectorId,
          ruleType: 'CPC_PREFIX',
          expression: cpcPrefix,
          priority,
          scope: 'LIBRARY',
          isActive: true,
          description: `CPC ${cpcPrefix} → ${sectorData.displayName}`,
        },
      });
      summary.cpcRules++;
    }
  }

  // Step 6: Create a "general" sector for unmapped patents if it doesn't exist
  const defaultSector = config.unmappedSectorDefault || 'general';
  const existingGeneral = await prisma.sector.findUnique({
    where: { name: defaultSector },
  });

  if (!existingGeneral) {
    await prisma.sector.create({
      data: {
        name: defaultSector,
        displayName: 'General / Uncategorized',
        description: 'Patents not matching any specific sector CPC codes',
        cpcPrefixes: [],
        damagesTier: 'Low',
        damagesRating: 1,
      },
    });
    summary.sectors++;
  }

  console.log(`[SectorSeed] CPC-only taxonomy seeded from ${configFile}`);
  console.log(`  Super-sectors: ${summary.superSectors}`);
  console.log(`  Sectors: ${summary.sectors}`);
  console.log(`  CPC Rules: ${summary.cpcRules}`);

  return summary;
}

/**
 * Get list of available taxonomy config files
 */
export function listTaxonomyConfigs(): string[] {
  const configDir = path.join(process.cwd(), 'config');
  return fs.readdirSync(configDir)
    .filter(f => f.startsWith('sector-taxonomy') && f.endsWith('.json'));
}
