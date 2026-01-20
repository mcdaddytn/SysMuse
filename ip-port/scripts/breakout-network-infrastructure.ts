#!/usr/bin/env npx tsx
/**
 * Break Out Network-Infrastructure Sector into Sub-Sectors
 *
 * Splits the network-infrastructure sector (955 patents) into more specific
 * sub-sectors based on CPC code analysis:
 *
 * - infra-ethernet: Ethernet, LANs, bridges (H04L12/40, H04L12/46)
 * - infra-addressing: Network addressing, DHCP, DNS (H04L61)
 * - infra-bus: Bus networks, token ring (H04L12/40, H04L12/42)
 * - infra-bridge: Bridges, switches, interconnection (H04L12/46, H04L12/56)
 * - infra-maintenance: Network maintenance, testing (H04L12/24, H04L12/26)
 *
 * Usage: npx tsx scripts/breakout-network-infrastructure.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for network-infrastructure
const INFRA_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Network addressing - DHCP, DNS, NAT
    prefixes: ['H04L61'],
    sector: 'infra-addressing',
    sectorName: 'Infra Addressing',
    description: 'Network addressing, DHCP, DNS, NAT',
  },
  {
    // Bridges, switches, interconnection
    prefixes: ['H04L12/46', 'H04L12/56', 'H04L12/66'],
    sector: 'infra-bridge',
    sectorName: 'Infra Bridge/Switch',
    description: 'Bridges, switches, interconnection',
  },
  {
    // Bus networks, token ring
    prefixes: ['H04L12/40', 'H04L12/42', 'H04L12/417'],
    sector: 'infra-bus',
    sectorName: 'Infra Bus/Ring',
    description: 'Bus networks, token ring, industrial nets',
  },
  {
    // Network maintenance, testing
    prefixes: ['H04L12/24', 'H04L12/26'],
    sector: 'infra-maintenance',
    sectorName: 'Infra Maintenance',
    description: 'Network maintenance, monitoring, testing',
  },
  {
    // Packet assembly/disassembly, framing
    prefixes: ['H04L12/18', 'H04L12/22'],
    sector: 'infra-framing',
    sectorName: 'Infra Framing/PAD',
    description: 'Packet framing, assembly, protocol conversion',
  },
  {
    // Power-line networks
    prefixes: ['H04L12/10', 'H04L12/12'],
    sector: 'infra-powerline',
    sectorName: 'Infra Powerline',
    description: 'Power-line communications, BPL',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of INFRA_SUBSECTORS) {
      for (const prefix of subsector.prefixes) {
        if (cpc.startsWith(prefix)) {
          matchCounts.set(subsector.sector, (matchCounts.get(subsector.sector) || 0) + 1);
          break;
        }
      }
    }
  }

  // Find the sub-sector with most matches
  let bestSector: string | null = null;
  let bestCount = 0;

  for (const [sector, count] of matchCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestSector = sector;
    }
  }

  if (bestSector) {
    const subsector = INFRA_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        NETWORK-INFRASTRUCTURE SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find network-infrastructure patents
  const infraPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'network-infrastructure') {
      infraPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Network-infrastructure patents: ${infraPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(80));
  for (const subsector of INFRA_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(20)} ${subsector.prefixes.join(', ').padEnd(30)} ${subsector.description}`);
  }
  console.log('─'.repeat(80) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of infraPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as network-infrastructure (general)
      keptGeneral++;
      subSectorCounts.set('network-infrastructure', (subSectorCounts.get('network-infrastructure') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(80));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(80));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in network-infrastructure: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(80));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / infraPatents.length) * 100).toFixed(1);
    const subsectorDef = INFRA_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Network Infrastructure (General)';
    console.log(`  ${sector.padEnd(22)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(80));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(80));

  const overallCounts = new Map<string, number>();
  for (const data of Object.values(assignments)) {
    const sector = data.sector || 'general';
    overallCounts.set(sector, (overallCounts.get(sector) || 0) + 1);
  }

  const sortedOverall = Array.from(overallCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  console.log('\nTop sectors after breakout:');
  for (const [sector, count] of sortedOverall.slice(0, 30)) {
    const pct = ((count / totalPatents) * 100).toFixed(1);
    const marker = count > 500 ? '🔴' : count >= 50 ? '✅' : '🟡';
    console.log(`  ${marker} ${sector.padEnd(24)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Summary
  const largeSectors = sortedOverall.filter(([_, c]) => c > 500).length;
  const goodSectors = sortedOverall.filter(([_, c]) => c >= 50 && c <= 500).length;
  const smallSectors = sortedOverall.filter(([_, c]) => c < 50).length;

  console.log(`\nSector size summary:`);
  console.log(`  🔴 Large (>500):  ${largeSectors}`);
  console.log(`  ✅ Good (50-500): ${goodSectors}`);
  console.log(`  🟡 Small (<50):   ${smallSectors}`);

  console.log('\n' + '═'.repeat(80) + '\n');
}

main().catch(console.error);
