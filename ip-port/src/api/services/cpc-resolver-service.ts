/**
 * CPC Resolver Service
 *
 * Provides CPC code lookups with multi-level fallback:
 * 1. Database exact match
 * 2. Database prefix match (parent hierarchy)
 * 3. Legacy config file (cpc-descriptions.json)
 *
 * Also handles sector mapping from CPC codes.
 */

import { PrismaClient, CpcCode, CpcLevel } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ============================================================================
// Types
// ============================================================================

export interface CpcDescription {
  code: string;
  title: string;
  titleLong?: string;
  level: CpcLevel;
  parentCode?: string;
  hierarchy?: CpcDescription[];
  sector?: string;
  superSector?: string;
}

export interface CpcHierarchy {
  section?: CpcDescription;
  class?: CpcDescription;
  subclass?: CpcDescription;
  group?: CpcDescription;
  subgroup?: CpcDescription;
}

interface LegacyCpcConfig {
  codes: Record<string, string>;
  superSectorCpcMapping?: Record<string, string[]>;
}

// ============================================================================
// In-memory Cache
// ============================================================================

let legacyDescriptions: Map<string, string> | null = null;
const codeCache = new Map<string, CpcDescription | null>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cacheClearTime = Date.now();

function clearCacheIfStale(): void {
  if (Date.now() - cacheClearTime > CACHE_TTL_MS) {
    codeCache.clear();
    cacheClearTime = Date.now();
  }
}

/**
 * Load legacy CPC descriptions from config file
 */
function loadLegacyDescriptions(): Map<string, string> {
  if (legacyDescriptions) {
    return legacyDescriptions;
  }

  try {
    const configPath = path.join(process.cwd(), 'config', 'cpc-descriptions.json');
    const config: LegacyCpcConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    legacyDescriptions = new Map(Object.entries(config.codes || {}));
  } catch {
    legacyDescriptions = new Map();
  }

  return legacyDescriptions;
}

// ============================================================================
// Core Resolution Functions
// ============================================================================

/**
 * Resolve a single CPC code to its description.
 * Uses DB first, then prefix matching, then legacy config.
 */
export async function resolveCpcDescription(code: string): Promise<CpcDescription | null> {
  clearCacheIfStale();

  // Check cache
  if (codeCache.has(code)) {
    return codeCache.get(code) || null;
  }

  // Try exact match in DB
  let dbCode = await prisma.cpcCode.findUnique({
    where: { code },
  });

  if (dbCode) {
    const result = mapDbCodeToDescription(dbCode);
    codeCache.set(code, result);
    return result;
  }

  // Try prefix matching (progressively shorter)
  const prefixes = generatePrefixes(code);
  for (const prefix of prefixes) {
    dbCode = await prisma.cpcCode.findUnique({
      where: { code: prefix },
    });
    if (dbCode) {
      const result = mapDbCodeToDescription(dbCode);
      // Cache with original code pointing to parent match
      codeCache.set(code, result);
      return result;
    }
  }

  // Fallback to legacy config
  const legacy = loadLegacyDescriptions();
  for (const prefix of [code, ...prefixes]) {
    if (legacy.has(prefix)) {
      const result: CpcDescription = {
        code: prefix,
        title: legacy.get(prefix)!,
        level: determineLevelFromCode(prefix),
      };
      codeCache.set(code, result);
      return result;
    }
  }

  // No match found
  codeCache.set(code, null);
  return null;
}

/**
 * Resolve multiple CPC codes efficiently (batch lookup)
 */
export async function resolveCpcDescriptions(
  codes: string[]
): Promise<Map<string, CpcDescription | null>> {
  clearCacheIfStale();

  const results = new Map<string, CpcDescription | null>();
  const uncachedCodes: string[] = [];

  // Check cache first
  for (const code of codes) {
    if (codeCache.has(code)) {
      results.set(code, codeCache.get(code) || null);
    } else {
      uncachedCodes.push(code);
    }
  }

  if (uncachedCodes.length === 0) {
    return results;
  }

  // Batch fetch from DB
  const dbCodes = await prisma.cpcCode.findMany({
    where: { code: { in: uncachedCodes } },
  });

  const dbCodeMap = new Map(dbCodes.map(c => [c.code, c]));

  // Process each uncached code
  for (const code of uncachedCodes) {
    if (dbCodeMap.has(code)) {
      const result = mapDbCodeToDescription(dbCodeMap.get(code)!);
      results.set(code, result);
      codeCache.set(code, result);
    } else {
      // Try prefix matching
      const resolved = await resolveCpcDescription(code);
      results.set(code, resolved);
    }
  }

  return results;
}

/**
 * Get full hierarchy for a CPC code
 */
export async function getCpcHierarchy(code: string): Promise<CpcHierarchy> {
  const hierarchy: CpcHierarchy = {};
  const prefixes = generatePrefixes(code);
  const allCodes = [code, ...prefixes];

  // Batch fetch all levels
  const dbCodes = await prisma.cpcCode.findMany({
    where: { code: { in: allCodes } },
  });

  for (const dbCode of dbCodes) {
    const desc = mapDbCodeToDescription(dbCode);
    switch (dbCode.level) {
      case CpcLevel.SECTION:
        hierarchy.section = desc;
        break;
      case CpcLevel.CLASS:
        hierarchy.class = desc;
        break;
      case CpcLevel.SUBCLASS:
        hierarchy.subclass = desc;
        break;
      case CpcLevel.GROUP:
        hierarchy.group = desc;
        break;
      case CpcLevel.SUBGROUP:
        hierarchy.subgroup = desc;
        break;
    }
  }

  return hierarchy;
}

/**
 * Get description with full hierarchy chain
 */
export async function getCpcWithHierarchy(code: string): Promise<CpcDescription | null> {
  const description = await resolveCpcDescription(code);
  if (!description) return null;

  const hierarchy = await getCpcHierarchy(code);
  const chain: CpcDescription[] = [];

  if (hierarchy.section) chain.push(hierarchy.section);
  if (hierarchy.class) chain.push(hierarchy.class);
  if (hierarchy.subclass) chain.push(hierarchy.subclass);
  if (hierarchy.group) chain.push(hierarchy.group);
  if (hierarchy.subgroup && hierarchy.subgroup.code !== description.code) {
    chain.push(hierarchy.subgroup);
  }

  return {
    ...description,
    hierarchy: chain,
  };
}

// ============================================================================
// Sector Mapping
// ============================================================================

/**
 * Determine sector from CPC code using DB-stored mapping
 */
export async function getSectorFromCpc(code: string): Promise<{
  sector?: string;
  superSector?: string;
} | null> {
  const cpcCode = await prisma.cpcCode.findUnique({
    where: { code },
    select: { sectorId: true, superSectorId: true },
  });

  if (cpcCode?.sectorId || cpcCode?.superSectorId) {
    // Fetch actual names
    const [sector, superSector] = await Promise.all([
      cpcCode.sectorId
        ? prisma.sector.findUnique({ where: { id: cpcCode.sectorId }, select: { name: true } })
        : null,
      cpcCode.superSectorId
        ? prisma.superSector.findUnique({ where: { id: cpcCode.superSectorId }, select: { name: true } })
        : null,
    ]);

    return {
      sector: sector?.name,
      superSector: superSector?.name,
    };
  }

  // Try prefix matching for sector
  const prefixes = generatePrefixes(code);
  for (const prefix of prefixes) {
    const parentCode = await prisma.cpcCode.findUnique({
      where: { code: prefix },
      select: { sectorId: true, superSectorId: true },
    });

    if (parentCode?.sectorId || parentCode?.superSectorId) {
      const [sector, superSector] = await Promise.all([
        parentCode.sectorId
          ? prisma.sector.findUnique({ where: { id: parentCode.sectorId }, select: { name: true } })
          : null,
        parentCode.superSectorId
          ? prisma.superSector.findUnique({ where: { id: parentCode.superSectorId }, select: { name: true } })
          : null,
      ]);

      return {
        sector: sector?.name,
        superSector: superSector?.name,
      };
    }
  }

  return null;
}

/**
 * Update sector mapping for a CPC code
 */
export async function updateCpcSectorMapping(
  code: string,
  sectorId?: string,
  superSectorId?: string
): Promise<CpcCode | null> {
  try {
    return await prisma.cpcCode.update({
      where: { code },
      data: {
        sectorId: sectorId || null,
        superSectorId: superSectorId || null,
      },
    });
  } catch {
    return null;
  }
}

// ============================================================================
// Search & Query Functions
// ============================================================================

/**
 * Search CPC codes by title text
 */
export async function searchCpcCodes(
  query: string,
  options: {
    level?: CpcLevel;
    limit?: number;
  } = {}
): Promise<CpcDescription[]> {
  const { level, limit = 50 } = options;

  const where: any = {
    OR: [
      { title: { contains: query, mode: 'insensitive' } },
      { titleLong: { contains: query, mode: 'insensitive' } },
      { code: { startsWith: query.toUpperCase() } },
    ],
  };

  if (level) {
    where.level = level;
  }

  const results = await prisma.cpcCode.findMany({
    where,
    take: limit,
    orderBy: { code: 'asc' },
  });

  return results.map(mapDbCodeToDescription);
}

/**
 * Get all CPC codes under a prefix
 */
export async function getCpcCodesUnderPrefix(
  prefix: string,
  options: { includeNotAllocatable?: boolean; limit?: number } = {}
): Promise<CpcDescription[]> {
  const { includeNotAllocatable = false, limit = 1000 } = options;

  const where: any = {
    code: { startsWith: prefix.toUpperCase() },
  };

  if (!includeNotAllocatable) {
    where.notAllocatable = false;
  }

  const results = await prisma.cpcCode.findMany({
    where,
    take: limit,
    orderBy: { code: 'asc' },
  });

  return results.map(mapDbCodeToDescription);
}

/**
 * Get immediate children of a CPC code
 */
export async function getCpcChildren(parentCode: string): Promise<CpcDescription[]> {
  const results = await prisma.cpcCode.findMany({
    where: { parentCode },
    orderBy: { code: 'asc' },
  });

  return results.map(mapDbCodeToDescription);
}

// ============================================================================
// Utility Functions
// ============================================================================

function mapDbCodeToDescription(dbCode: CpcCode): CpcDescription {
  return {
    code: dbCode.code,
    title: dbCode.title,
    titleLong: dbCode.titleLong || undefined,
    level: dbCode.level,
    parentCode: dbCode.parentCode || undefined,
    sector: dbCode.sectorId || undefined,
    superSector: dbCode.superSectorId || undefined,
  };
}

/**
 * Generate progressively shorter prefixes for a CPC code
 * H04L63/1416 -> [H04L63/14, H04L63, H04L, H04, H]
 */
function generatePrefixes(code: string): string[] {
  const prefixes: string[] = [];
  code = code.trim();

  // Handle subgroups: H04L63/1416 -> H04L63/14 -> H04L63
  if (code.includes('/')) {
    const [group, subgroup] = code.split('/');

    // Add shorter subgroup prefixes
    for (let len = subgroup.length - 1; len >= 2; len--) {
      prefixes.push(`${group}/${subgroup.slice(0, len)}`);
    }

    // Add group (without slash)
    prefixes.push(group);
    code = group;
  }

  // Handle groups/subclasses: H04L63 -> H04L -> H04 -> H
  while (code.length > 1) {
    // For groups (H04L63), step back to subclass (H04L)
    if (/^[A-HY]\d{2}[A-Z]\d+$/.test(code)) {
      code = code.slice(0, 4); // H04L
    }
    // For subclass (H04L), step back to class (H04)
    else if (/^[A-HY]\d{2}[A-Z]$/.test(code)) {
      code = code.slice(0, 3); // H04
    }
    // For class (H04), step back to section (H)
    else if (/^[A-HY]\d{2}$/.test(code)) {
      code = code.slice(0, 1); // H
    }
    // Otherwise just trim one character
    else {
      code = code.slice(0, -1);
    }

    if (code.length > 0) {
      prefixes.push(code);
    }
  }

  return prefixes;
}

function determineLevelFromCode(code: string): CpcLevel {
  code = code.trim();

  if (/^[A-HY]$/.test(code)) return CpcLevel.SECTION;
  if (/^[A-HY]\d{2}$/.test(code)) return CpcLevel.CLASS;
  if (/^[A-HY]\d{2}[A-Z]$/.test(code)) return CpcLevel.SUBCLASS;
  if (code.includes('/')) return CpcLevel.SUBGROUP;
  if (/^[A-HY]\d{2}[A-Z]\d+$/.test(code)) return CpcLevel.GROUP;

  return CpcLevel.SUBGROUP;
}

/**
 * Clear the in-memory cache
 */
export function clearCpcCache(): void {
  codeCache.clear();
  legacyDescriptions = null;
  cacheClearTime = Date.now();
}

/**
 * Get cache statistics
 */
export function getCpcCacheStats(): { size: number; hitRate: string } {
  return {
    size: codeCache.size,
    hitRate: 'N/A', // Would need hit/miss tracking to calculate
  };
}
