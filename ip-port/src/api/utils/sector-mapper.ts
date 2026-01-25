/**
 * Sector Mapper
 *
 * Maps CPC codes to primary sectors and super-sectors.
 * Also provides utilities for sector-based filtering.
 */

import * as fs from 'fs';
import * as path from 'path';

interface SectorMapping {
  name: string;
  description: string;
  damages_tier: string;
  cpc_patterns: string[];
}

interface SuperSector {
  displayName: string;
  description: string;
  sectors: string[];
  damagesTier: string;
}

interface SectorBreakoutConfig {
  sectorMappings: Record<string, SectorMapping>;
  termBasedSectors: Record<string, any>;
}

interface SuperSectorsConfig {
  superSectors: Record<string, SuperSector>;
  unmappedSectorDefault: string;
}

// Caches
let sectorConfig: SectorBreakoutConfig | null = null;
let superSectorConfig: SuperSectorsConfig | null = null;
let sectorToSuperSector: Map<string, string> | null = null;

/**
 * Load sector breakout configuration
 */
function loadSectorConfig(): SectorBreakoutConfig {
  if (sectorConfig) return sectorConfig;

  const configPath = path.join(process.cwd(), 'config/sector-breakout-v2.json');
  sectorConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return sectorConfig!;
}

/**
 * Load super-sector configuration
 */
function loadSuperSectorConfig(): SuperSectorsConfig {
  if (superSectorConfig) return superSectorConfig;

  const configPath = path.join(process.cwd(), 'config/super-sectors.json');
  superSectorConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return superSectorConfig!;
}

/**
 * Build sector to super-sector lookup
 */
function buildSectorToSuperSector(): Map<string, string> {
  if (sectorToSuperSector) return sectorToSuperSector;

  const config = loadSuperSectorConfig();
  sectorToSuperSector = new Map();

  for (const [superSectorKey, superSectorData] of Object.entries(config.superSectors)) {
    for (const sector of superSectorData.sectors) {
      sectorToSuperSector.set(sector, superSectorKey);
    }
  }

  return sectorToSuperSector;
}

/**
 * Get primary sector from CPC codes
 *
 * @param cpcCodes Array of CPC codes (e.g., ["H04L63/08", "G06F21/31"])
 * @returns Primary sector key, or "general" if no match
 */
export function getPrimarySector(cpcCodes: string[]): string {
  if (!cpcCodes || cpcCodes.length === 0) return 'general';

  const config = loadSectorConfig();

  // Sort by CPC pattern length (longest/most specific first)
  const sortedMappings = Object.entries(config.sectorMappings)
    .flatMap(([sectorKey, sectorData]) =>
      sectorData.cpc_patterns.map(pattern => ({
        sectorKey,
        pattern,
        length: pattern.length
      }))
    )
    .sort((a, b) => b.length - a.length);

  // Find first matching sector
  for (const cpc of cpcCodes) {
    for (const { sectorKey, pattern } of sortedMappings) {
      if (cpc.startsWith(pattern.replace('/', ''))) {
        return sectorKey;
      }
    }
  }

  return 'general';
}

/**
 * Get super-sector from primary sector
 *
 * @param primarySector Primary sector key
 * @returns Super-sector key
 */
export function getSuperSector(primarySector: string): string {
  const lookup = buildSectorToSuperSector();
  const config = loadSuperSectorConfig();

  return lookup.get(primarySector) || config.unmappedSectorDefault;
}

/**
 * Get super-sector display name
 *
 * @param superSectorKey Super-sector key (e.g., "SECURITY")
 * @returns Display name (e.g., "Security")
 */
export function getSuperSectorDisplayName(superSectorKey: string): string {
  const config = loadSuperSectorConfig();
  return config.superSectors[superSectorKey]?.displayName || superSectorKey;
}

/**
 * Get primary sector display name
 *
 * @param sectorKey Sector key (e.g., "network-threat-protection")
 * @returns Display name (e.g., "Network Threat Protection")
 */
export function getSectorDisplayName(sectorKey: string): string {
  const config = loadSectorConfig();
  return config.sectorMappings[sectorKey]?.name || sectorKey;
}

/**
 * Get all super-sectors with metadata
 */
export function getAllSuperSectors(): { key: string; displayName: string; sectorCount: number }[] {
  const config = loadSuperSectorConfig();
  return Object.entries(config.superSectors).map(([key, data]) => ({
    key,
    displayName: data.displayName,
    sectorCount: data.sectors.length
  }));
}

/**
 * Get all primary sectors within a super-sector
 */
export function getSectorsInSuperSector(superSectorKey: string): string[] {
  const config = loadSuperSectorConfig();
  return config.superSectors[superSectorKey]?.sectors || [];
}

/**
 * Clear caches (useful for testing or config reload)
 */
export function clearCache(): void {
  sectorConfig = null;
  superSectorConfig = null;
  sectorToSuperSector = null;
}
