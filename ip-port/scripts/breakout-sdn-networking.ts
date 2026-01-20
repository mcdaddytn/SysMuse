#!/usr/bin/env npx tsx
/**
 * Break Out SDN-Networking Sector into Sub-Sectors
 *
 * Splits the sdn-networking sector (1,266 patents) into more specific
 * sub-sectors based on CPC code analysis:
 *
 * - sdn-routing: Packet routing, path selection, forwarding (H04L45)
 * - sdn-switching: Packet switching, switch elements (H04L49)
 * - sdn-qos: Traffic control, QoS, congestion management (H04L47)
 * - sdn-lan: LANs, data switching networks (H04L12)
 * - sdn-management: Network management, configuration (H04L41)
 * - sdn-monitoring: Network monitoring, traffic analysis (H04L43)
 *
 * Usage: npx tsx scripts/breakout-sdn-networking.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for sdn-networking
const SDN_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Packet routing
    prefixes: ['H04L45'],
    sector: 'sdn-routing',
    sectorName: 'SDN Routing',
    description: 'Packet routing, path selection, forwarding tables',
  },
  {
    // Packet switching
    prefixes: ['H04L49'],
    sector: 'sdn-switching',
    sectorName: 'SDN Switching',
    description: 'Packet switching, switch elements, buffers',
  },
  {
    // Traffic control / QoS
    prefixes: ['H04L47'],
    sector: 'sdn-qos',
    sectorName: 'SDN QoS/Traffic',
    description: 'Traffic control, QoS, congestion management, scheduling',
  },
  {
    // LANs, data switching
    prefixes: ['H04L12'],
    sector: 'sdn-lan',
    sectorName: 'SDN LAN/Switching',
    description: 'LANs, Ethernet, data switching networks',
  },
  {
    // Network management
    prefixes: ['H04L41'],
    sector: 'sdn-management',
    sectorName: 'SDN Management',
    description: 'Network management, configuration, provisioning',
  },
  {
    // Network monitoring
    prefixes: ['H04L43'],
    sector: 'sdn-monitoring',
    sectorName: 'SDN Monitoring',
    description: 'Network monitoring, traffic analysis, telemetry',
  },
  {
    // Protocol layers
    prefixes: ['H04L69'],
    sector: 'sdn-protocol',
    sectorName: 'SDN Protocol Layers',
    description: 'Protocol stacks, transport/network layers',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of SDN_SUBSECTORS) {
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
    const subsector = SDN_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        SDN-NETWORKING SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find sdn-networking patents
  const sdnPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'sdn-networking') {
      sdnPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`SDN-networking patents: ${sdnPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(75));
  for (const subsector of SDN_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(16)} ${subsector.prefixes.join(', ').padEnd(12)} ${subsector.description}`);
  }
  console.log('─'.repeat(75) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of sdnPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as sdn-networking (general)
      keptGeneral++;
      subSectorCounts.set('sdn-networking', (subSectorCounts.get('sdn-networking') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(75));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(75));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in sdn-networking: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(75));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / sdnPatents.length) * 100).toFixed(1);
    const subsectorDef = SDN_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'SDN Networking (General)';
    console.log(`  ${sector.padEnd(18)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(75));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(75));

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

  console.log('\n' + '═'.repeat(75) + '\n');
}

main().catch(console.error);
