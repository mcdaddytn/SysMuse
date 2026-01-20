#!/usr/bin/env npx tsx
/**
 * Break Out Network-Protocols Sector into Sub-Sectors
 *
 * Splits the network-protocols sector (1,010 patents) into more specific
 * sub-sectors based on CPC code analysis:
 *
 * - proto-client-server: Client-server, distributed apps (H04L67/10, H04L67/1001)
 * - proto-content: Content distribution, caching, CDN (H04L67/1002, H04L67/06)
 * - proto-session: Session management, state (H04L67/14, H04L67/02)
 * - proto-services: Streaming, conferencing, real-time (H04L65)
 * - proto-layers: Protocol stacks, transport/network layers (H04L69)
 * - proto-proxy: Proxies, load balancing, routing (H04L67/28, H04L67/32)
 *
 * Usage: npx tsx scripts/breakout-network-protocols.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for network-protocols
const PROTO_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Network services - streaming, conferencing
    prefixes: ['H04L65'],
    sector: 'proto-services',
    sectorName: 'Protocol Services',
    description: 'Streaming, conferencing, real-time services',
  },
  {
    // Protocol layers
    prefixes: ['H04L69'],
    sector: 'proto-layers',
    sectorName: 'Protocol Layers',
    description: 'Protocol stacks, transport/network layers',
  },
  {
    // Content distribution
    prefixes: ['H04L67/1002', 'H04L67/06', 'H04L67/568', 'H04L67/56'],
    sector: 'proto-content',
    sectorName: 'Protocol Content/CDN',
    description: 'Content distribution, caching, CDN',
  },
  {
    // Proxy, load balancing
    prefixes: ['H04L67/28', 'H04L67/32', 'H04L67/30'],
    sector: 'proto-proxy',
    sectorName: 'Protocol Proxy/LB',
    description: 'Proxies, load balancing, message routing',
  },
  {
    // Session management
    prefixes: ['H04L67/14', 'H04L67/02', 'H04L67/141', 'H04L67/142'],
    sector: 'proto-session',
    sectorName: 'Protocol Session',
    description: 'Session management, state handling',
  },
  {
    // Client-server, distributed
    prefixes: ['H04L67/10', 'H04L67/1001', 'H04L67/01', 'H04L67/00'],
    sector: 'proto-distributed',
    sectorName: 'Protocol Distributed',
    description: 'Client-server, distributed applications',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of PROTO_SUBSECTORS) {
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
    const subsector = PROTO_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        NETWORK-PROTOCOLS SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find network-protocols patents
  const protoPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'network-protocols') {
      protoPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Network-protocols patents: ${protoPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(80));
  for (const subsector of PROTO_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(18)} ${subsector.prefixes.slice(0, 3).join(', ').padEnd(30)} ${subsector.description}`);
  }
  console.log('─'.repeat(80) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of protoPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as network-protocols (general)
      keptGeneral++;
      subSectorCounts.set('network-protocols', (subSectorCounts.get('network-protocols') || 0) + 1);
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
  console.log(`Kept in network-protocols: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(80));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / protoPatents.length) * 100).toFixed(1);
    const subsectorDef = PROTO_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Network Protocols (General)';
    console.log(`  ${sector.padEnd(20)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
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
