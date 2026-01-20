#!/usr/bin/env npx tsx
/**
 * Break Out Wireless Sector into Sub-Sectors
 *
 * Splits the wireless sector (2,024 patents) into more specific
 * sub-sectors based on CPC code analysis:
 *
 * - wireless-devices: Base stations, terminals, UE (H04W88)
 * - wireless-topology: Network topologies, mesh, ad-hoc (H04W84)
 * - wireless-power: Power management, battery (H04W52)
 * - wireless-resource: Resource management, spectrum (H04W72)
 * - wireless-services: Location, messaging, apps (H04W4)
 * - wireless-mobility: Handoff, roaming, mobility mgmt (H04W8, H04W36)
 * - wireless-access: Channel access, MAC (H04W74, H04W48)
 * - wireless-connection: Connection setup, RRC (H04W76)
 *
 * Usage: npx tsx scripts/breakout-wireless.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for wireless
const WIRELESS_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Wireless devices - base stations, terminals
    prefixes: ['H04W88'],
    sector: 'wireless-devices',
    sectorName: 'Wireless Devices/Infrastructure',
    description: 'Base stations, terminals, UE, network elements',
  },
  {
    // Network topologies - mesh, ad-hoc, relay
    prefixes: ['H04W84'],
    sector: 'wireless-topology',
    sectorName: 'Wireless Network Topology',
    description: 'Mesh networks, ad-hoc, relay, network architecture',
  },
  {
    // Power management
    prefixes: ['H04W52'],
    sector: 'wireless-power',
    sectorName: 'Wireless Power Management',
    description: 'Power control, battery optimization, DRX',
  },
  {
    // Resource management - spectrum, scheduling
    prefixes: ['H04W72'],
    sector: 'wireless-resource',
    sectorName: 'Wireless Resource Management',
    description: 'Spectrum allocation, scheduling, resource blocks',
  },
  {
    // Wireless services - location, messaging
    prefixes: ['H04W4'],
    sector: 'wireless-services',
    sectorName: 'Wireless Services/Applications',
    description: 'Location services, messaging, IoT, M2M',
  },
  {
    // Mobility - handoff, roaming
    prefixes: ['H04W8', 'H04W36'],
    sector: 'wireless-mobility',
    sectorName: 'Wireless Mobility/Handoff',
    description: 'Handoff, roaming, mobility management, HLR/VLR',
  },
  {
    // Channel access - MAC layer
    prefixes: ['H04W74', 'H04W48'],
    sector: 'wireless-access',
    sectorName: 'Wireless Channel Access',
    description: 'MAC protocols, ALOHA, contention, access control',
  },
  {
    // Connection management - RRC
    prefixes: ['H04W76'],
    sector: 'wireless-connection',
    sectorName: 'Wireless Connection Management',
    description: 'Connection setup, RRC, session management',
  },
  {
    // Traffic management - QoS
    prefixes: ['H04W28'],
    sector: 'wireless-traffic',
    sectorName: 'Wireless Traffic/QoS',
    description: 'Traffic management, QoS, congestion control',
  },
  {
    // Network monitoring/management
    prefixes: ['H04W24'],
    sector: 'wireless-monitoring',
    sectorName: 'Wireless Network Monitoring',
    description: 'Network monitoring, measurements, SON',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of WIRELESS_SUBSECTORS) {
      for (const prefix of subsector.prefixes) {
        if (cpc.startsWith(prefix)) {
          const key = subsector.sector;
          matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
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
    const subsector = WIRELESS_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        WIRELESS SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find wireless patents
  const wirelessPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'wireless') {
      wirelessPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Wireless patents: ${wirelessPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(75));
  for (const subsector of WIRELESS_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(20)} ${subsector.prefixes.join(', ').padEnd(15)} ${subsector.description}`);
  }
  console.log('─'.repeat(75) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of wirelessPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as wireless (general)
      keptGeneral++;
      subSectorCounts.set('wireless', (subSectorCounts.get('wireless') || 0) + 1);
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
  console.log(`Kept in wireless: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(75));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / wirelessPatents.length) * 100).toFixed(1);
    const subsectorDef = WIRELESS_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Wireless (General)';
    console.log(`  ${sector.padEnd(20)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
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
  for (const [sector, count] of sortedOverall.slice(0, 25)) {
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
