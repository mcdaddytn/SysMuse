/**
 * Assign CPC-based sectors to ALL patents in the portfolio
 *
 * This script assigns sectors to patents that don't have them yet,
 * using CPC code pattern matching from sector-breakout-v2.json.
 * No LLM required - purely CPC-based.
 *
 * Usage:
 *   npx tsx scripts/assign-all-cpc-sectors.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface SectorConfig {
  name: string;
  description: string;
  damages_tier: string;
  cpc_patterns: string[];
}

interface SectorBreakout {
  version: string;
  sectorMappings: Record<string, SectorConfig>;
}

interface SuperSectorConfig {
  version: string;
  superSectors: Record<string, {
    name: string;
    sectors: string[];
  }>;
}

interface CPCEntry {
  cpc_group_id: string;
  cpc_class_id?: string;
  cpc_subclass_id?: string;
}

interface Patent {
  patent_id: string;
  cpc_current?: CPCEntry[];
}

interface BroadcomPortfolio {
  patents: Patent[];
}

interface ExistingAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

interface SectorAssignment {
  sector: string;
  sectorName: string;
  superSector: string;
  cpc_codes: string[];
  source: string;
}

// Load configurations
function loadSectorBreakout(): SectorBreakout {
  const content = fs.readFileSync('config/sector-breakout-v2.json', 'utf-8');
  return JSON.parse(content);
}

function loadSuperSectors(): SuperSectorConfig {
  const content = fs.readFileSync('config/super-sectors.json', 'utf-8');
  return JSON.parse(content);
}

// Build sector to super-sector mapping
function buildSectorToSuperSector(superSectors: SuperSectorConfig): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const [superSector, config] of Object.entries(superSectors.superSectors)) {
    for (const sector of config.sectors) {
      mapping[sector] = superSector;
    }
  }
  return mapping;
}

// Match CPC codes to sector using patterns
function matchCpcToSector(
  cpcCodes: string[],
  sectorBreakout: SectorBreakout
): { sector: string; sectorName: string } | null {
  // Sort patterns by length (longest first) for most specific match
  const allPatterns: { pattern: string; sector: string; sectorName: string }[] = [];

  for (const [sectorId, config] of Object.entries(sectorBreakout.sectorMappings)) {
    for (const pattern of config.cpc_patterns) {
      allPatterns.push({
        pattern: pattern.replace(/\/$/, ''), // Remove trailing slash
        sector: sectorId,
        sectorName: config.name,
      });
    }
  }

  // Sort by pattern length descending (more specific first)
  allPatterns.sort((a, b) => b.pattern.length - a.pattern.length);

  // Try to match each CPC code
  for (const cpc of cpcCodes) {
    const normalizedCpc = cpc.replace(/\/$/, '');
    for (const { pattern, sector, sectorName } of allPatterns) {
      if (normalizedCpc.startsWith(pattern) || normalizedCpc === pattern) {
        return { sector, sectorName };
      }
    }
  }

  return null;
}

// Fallback CPC mapping for codes not in sector-breakout-v2
const FALLBACK_CPC_MAP: Record<string, { sector: string; sectorName: string }> = {
  // Video/Image processing
  'H04N': { sector: 'video-display', sectorName: 'Video Display/TV Systems' },
  'G06T': { sector: 'image-processing', sectorName: 'Image Processing/Vision' },
  'G11B': { sector: 'video-display', sectorName: 'Video Display/TV Systems' },

  // Wireless communications
  'H04W': { sector: 'wireless-comm', sectorName: 'Wireless Communications' },
  'H04B': { sector: 'wireless-comm', sectorName: 'Wireless Communications' },

  // Computing & Data processing
  'G06F': { sector: 'software-engineering', sectorName: 'Software Engineering' },
  'G06N': { sector: 'ai-ml', sectorName: 'AI/Machine Learning' },
  'G06Q': { sector: 'software-engineering', sectorName: 'Software Engineering' },

  // Semiconductors & Hardware
  'H01L': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },
  'H03': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },

  // Audio
  'G10L': { sector: 'audio-processing', sectorName: 'Audio Processing' },
  'H04R': { sector: 'audio-processing', sectorName: 'Audio Processing' },
  'H04S': { sector: 'audio-processing', sectorName: 'Audio Processing' },

  // Networking (general fallback)
  'H04L': { sector: 'network-switching', sectorName: 'Network Switching & Routing' },

  // Optics
  'G02': { sector: 'optics', sectorName: 'Optics/Photonics' },
  'H04J': { sector: 'optics', sectorName: 'Optics/Photonics' },
};

function matchFallbackCpc(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  // Sort fallback patterns by length (longest first)
  const sortedPatterns = Object.entries(FALLBACK_CPC_MAP)
    .sort((a, b) => b[0].length - a[0].length);

  for (const cpc of cpcCodes) {
    for (const [pattern, result] of sortedPatterns) {
      if (cpc.startsWith(pattern)) {
        return result;
      }
    }
  }

  return null;
}

async function main(): Promise<void> {
  console.log('=== ASSIGN CPC SECTORS TO ALL PATENTS ===\n');

  // Load configurations
  console.log('Loading configurations...');
  const sectorBreakout = loadSectorBreakout();
  const superSectors = loadSuperSectors();
  const sectorToSuperSector = buildSectorToSuperSector(superSectors);

  console.log(`  Loaded ${Object.keys(sectorBreakout.sectorMappings).length} sector definitions`);
  console.log(`  Loaded ${Object.keys(superSectors.superSectors).length} super-sector mappings`);

  // Load existing sector assignments
  console.log('\nLoading existing sector assignments...');
  const existingPath = 'output/patent-sector-assignments.json';
  let existingAssignments: Record<string, ExistingAssignment> = {};
  if (fs.existsSync(existingPath)) {
    existingAssignments = JSON.parse(fs.readFileSync(existingPath, 'utf-8'));
    console.log(`  Existing assignments: ${Object.keys(existingAssignments).length}`);
  }

  // Load broadcom portfolio
  console.log('\nLoading broadcom portfolio...');
  const portfolioPath = 'output/broadcom-portfolio-2026-01-15.json';
  const portfolio: BroadcomPortfolio = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
  console.log(`  Patents in portfolio: ${portfolio.patents.length}`);

  // Load VMware patents if they exist
  const vmwarePath = 'output/vmware-patents-2026-01-19.json';
  let vmwarePatents: Patent[] = [];
  if (fs.existsSync(vmwarePath)) {
    const vmwareData = JSON.parse(fs.readFileSync(vmwarePath, 'utf-8'));
    vmwarePatents = vmwareData.patents || [];
    console.log(`  VMware patents loaded: ${vmwarePatents.length}`);
  }

  // Combine all patents
  const allPatents = [...portfolio.patents, ...vmwarePatents];
  console.log(`  Total patents to process: ${allPatents.length}`);

  // Process patents
  console.log('\nAssigning sectors...');
  const newAssignments: Record<string, SectorAssignment> = {};
  let existingKept = 0;
  let newFromBreakout = 0;
  let newFromFallback = 0;
  let unassigned = 0;

  for (const patent of allPatents) {
    const patentId = patent.patent_id;

    // Keep existing assignment if present
    if (existingAssignments[patentId]) {
      const existing = existingAssignments[patentId];
      newAssignments[patentId] = {
        sector: existing.sector,
        sectorName: existing.sectorName,
        superSector: sectorToSuperSector[existing.sector] || 'UNASSIGNED',
        cpc_codes: existing.cpc_codes || [],
        source: existing.source || 'existing',
      };
      existingKept++;
      continue;
    }

    // Get CPC codes from patent
    const cpcCodes = (patent.cpc_current || [])
      .map(c => c.cpc_group_id)
      .filter(Boolean);

    if (cpcCodes.length === 0) {
      unassigned++;
      continue;
    }

    // Try sector-breakout-v2 patterns first
    let match = matchCpcToSector(cpcCodes, sectorBreakout);
    let source = 'cpc-breakout-v2';

    // Fall back to broader patterns if no match
    if (!match) {
      match = matchFallbackCpc(cpcCodes);
      source = 'cpc-fallback';
    }

    if (match) {
      newAssignments[patentId] = {
        sector: match.sector,
        sectorName: match.sectorName,
        superSector: sectorToSuperSector[match.sector] || 'UNASSIGNED',
        cpc_codes: cpcCodes,
        source,
      };
      if (source === 'cpc-breakout-v2') {
        newFromBreakout++;
      } else {
        newFromFallback++;
      }
    } else {
      unassigned++;
    }
  }

  // Summary
  console.log('\n=== ASSIGNMENT SUMMARY ===');
  console.log(`  Kept existing: ${existingKept}`);
  console.log(`  New from breakout-v2: ${newFromBreakout}`);
  console.log(`  New from fallback: ${newFromFallback}`);
  console.log(`  Unassigned (no CPC): ${unassigned}`);
  console.log(`  Total assigned: ${Object.keys(newAssignments).length}`);

  // Sector distribution
  const sectorCounts: Record<string, number> = {};
  const superSectorCounts: Record<string, number> = {};
  for (const assignment of Object.values(newAssignments)) {
    sectorCounts[assignment.sector] = (sectorCounts[assignment.sector] || 0) + 1;
    superSectorCounts[assignment.superSector] = (superSectorCounts[assignment.superSector] || 0) + 1;
  }

  console.log('\n=== SUPER-SECTOR DISTRIBUTION ===');
  const sortedSuperSectors = Object.entries(superSectorCounts)
    .sort((a, b) => b[1] - a[1]);
  for (const [ss, count] of sortedSuperSectors) {
    const pct = ((count / Object.keys(newAssignments).length) * 100).toFixed(1);
    console.log(`  ${ss.padEnd(20)} ${count.toString().padStart(6)} (${pct}%)`);
  }

  // Save output
  const outputPath = 'output/patent-sector-assignments-all.json';
  fs.writeFileSync(outputPath, JSON.stringify(newAssignments, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  // Also update the standard sector assignments file
  const standardPath = 'output/patent-sector-assignments.json';
  fs.writeFileSync(standardPath, JSON.stringify(newAssignments, null, 2));
  console.log(`Updated: ${standardPath}`);
}

main().catch(console.error);
