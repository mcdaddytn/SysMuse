#!/usr/bin/env npx tsx
/**
 * Re-assign sectors based on fetched CPC codes
 *
 * Updates patent-sector-assignments.json using the CPC codes we fetched
 * and the CPC-to-sector mapping.
 *
 * Usage: npx tsx scripts/reassign-sectors-from-cpc.ts
 */

import * as fs from 'fs';

// CPC code prefix to sector mapping (same as other scripts)
const CPC_SECTOR_MAP: Record<string, { sector: string; sectorName: string }> = {
  // VMware-specific sectors (more specific prefixes matched first)
  'G06F9/455': { sector: 'virtualization', sectorName: 'Virtualization/Containers' },
  'G06F9/45': { sector: 'virtualization', sectorName: 'Virtualization/Containers' },
  'G06F9/5': { sector: 'virtualization', sectorName: 'Virtualization/Containers' },
  'H04L45': { sector: 'sdn-networking', sectorName: 'SDN/Network Switching' },
  'H04L47': { sector: 'sdn-networking', sectorName: 'SDN/Network Switching' },
  'H04L49': { sector: 'sdn-networking', sectorName: 'SDN/Network Switching' },
  'H04L41': { sector: 'cloud-orchestration', sectorName: 'Cloud Orchestration/Management' },
  'H04L43': { sector: 'cloud-orchestration', sectorName: 'Cloud Orchestration/Management' },
  'G06F3/06': { sector: 'storage-virtualization', sectorName: 'Storage Virtualization' },
  'H04L63': { sector: 'network-security', sectorName: 'Network Security' },
  'H04L9': { sector: 'network-security', sectorName: 'Network Security' },

  // Broader fallbacks
  'H04N': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'G06T': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'G11B': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'H04L': { sector: 'network-security', sectorName: 'Network/Security' },
  'H04W': { sector: 'wireless', sectorName: 'Wireless Communications' },
  'H04B': { sector: 'wireless', sectorName: 'Wireless Communications' },
  'G06F': { sector: 'computing', sectorName: 'Computing/Data Processing' },
  'G06N': { sector: 'ai-ml', sectorName: 'AI/Machine Learning' },
  'G06Q': { sector: 'computing', sectorName: 'Computing/Data Processing' },
  'H01L': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },
  'H10': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },
  'H03': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },
  'G10L': { sector: 'audio', sectorName: 'Audio Processing' },
  'H04R': { sector: 'audio', sectorName: 'Audio Processing' },
  'H04S': { sector: 'audio', sectorName: 'Audio Processing' },
  'H03H': { sector: 'rf-acoustic', sectorName: 'RF/Acoustic Resonators' },
  'H04K': { sector: 'security-crypto', sectorName: 'Security/Cryptography' },
  'G02': { sector: 'optics', sectorName: 'Optics/Photonics' },
  'H04J': { sector: 'optics', sectorName: 'Optics/Photonics' },
};

// Sort prefixes by length (longest first) for matching
const CPC_PREFIXES = Object.keys(CPC_SECTOR_MAP).sort((a, b) => b.length - a.length);

function getSectorFromCPC(cpcCodes: string[]): { sector: string; sectorName: string } {
  if (!cpcCodes || cpcCodes.length === 0) {
    return { sector: 'general', sectorName: 'General' };
  }

  for (const cpc of cpcCodes) {
    for (const prefix of CPC_PREFIXES) {
      if (cpc.startsWith(prefix)) {
        return CPC_SECTOR_MAP[prefix];
      }
    }
  }

  return { sector: 'general', sectorName: 'General' };
}

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        RE-ASSIGN SECTORS FROM CPC CODES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load current assignments
  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;
  console.log(`Total patents: ${totalPatents.toLocaleString()}`);

  // Count current sectors
  const beforeCounts = new Map<string, number>();
  for (const data of Object.values(assignments)) {
    const sector = data.sector || 'general';
    beforeCounts.set(sector, (beforeCounts.get(sector) || 0) + 1);
  }

  console.log(`\nBefore re-assignment:`);
  console.log(`  General: ${beforeCounts.get('general')?.toLocaleString() || 0}`);

  // Re-assign sectors based on CPC codes
  let reassigned = 0;
  let stillGeneral = 0;

  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.cpc_codes && data.cpc_codes.length > 0) {
      const { sector, sectorName } = getSectorFromCPC(data.cpc_codes);

      if (data.sector !== sector) {
        data.sector = sector;
        data.sectorName = sectorName;
        data.source = 'cpc-reassigned';
        reassigned++;
      }

      if (sector === 'general') {
        stillGeneral++;
      }
    } else {
      if (!data.sector || data.sector === 'general') {
        stillGeneral++;
      }
    }
  }

  console.log(`\nReassigned: ${reassigned.toLocaleString()}`);
  console.log(`Still in general: ${stillGeneral.toLocaleString()}`);

  // Count after
  const afterCounts = new Map<string, number>();
  for (const data of Object.values(assignments)) {
    const sector = data.sector || 'general';
    afterCounts.set(sector, (afterCounts.get(sector) || 0) + 1);
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log(`\n✓ Saved updated assignments`);

  // Print new distribution
  console.log('\n' + '═'.repeat(60));
  console.log('NEW SECTOR DISTRIBUTION');
  console.log('═'.repeat(60));

  const sortedSectors = Array.from(afterCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSectors) {
    const pct = ((count / totalPatents) * 100).toFixed(1);
    const before = beforeCounts.get(sector) || 0;
    const diff = count - before;
    const diffStr = diff > 0 ? `+${diff.toLocaleString()}` : diff < 0 ? diff.toLocaleString() : '0';
    console.log(`  ${sector.padEnd(25)} ${count.toLocaleString().padStart(7)}  (${pct}%)  [${diffStr}]`);
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(console.error);
