#!/usr/bin/env npx tsx
/**
 * Break Out Virtualization Sector into Sub-Sectors
 *
 * Splits the virtualization sector (1,402 patents) into more specific
 * sub-sectors based on G06F9 sub-code analysis:
 *
 * - vm-resource: VM resource allocation, memory management (G06F9/50)
 * - vm-hypervisor: VMMs, hypervisors, VM lifecycle (G06F9/455)
 * - vm-scheduling: VM scheduling, load balancing (G06F9/48)
 * - vm-ipc: Inter-VM communication, message passing (G06F9/52, G06F9/54)
 * - vm-migration: VM migration, live migration (G06F9/455 with migration terms)
 *
 * Usage: npx tsx scripts/breakout-virtualization.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for virtualization based on G06F9 sub-codes
const VIRT_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // VM resource management - allocation, memory
    prefixes: ['G06F9/50'],
    sector: 'vm-resource',
    sectorName: 'VM Resource Management',
    description: 'Resource allocation, memory management, VM provisioning',
  },
  {
    // VMMs, hypervisors
    prefixes: ['G06F9/455'],
    sector: 'vm-hypervisor',
    sectorName: 'Hypervisor/VMM',
    description: 'Virtual machine monitors, hypervisors, VM lifecycle',
  },
  {
    // VM scheduling
    prefixes: ['G06F9/48'],
    sector: 'vm-scheduling',
    sectorName: 'VM Scheduling',
    description: 'VM scheduling, load balancing, workload placement',
  },
  {
    // IPC and communication
    prefixes: ['G06F9/54', 'G06F9/52'],
    sector: 'vm-ipc',
    sectorName: 'VM IPC/Communication',
    description: 'Inter-VM communication, message passing, shared memory',
  },
  {
    // VM emulation/translation
    prefixes: ['G06F9/451', 'G06F9/452', 'G06F9/453'],
    sector: 'vm-emulation',
    sectorName: 'VM Emulation/Translation',
    description: 'Binary translation, emulation, compatibility',
  },
  {
    // Software loading/deployment
    prefixes: ['G06F9/44', 'G06F9/445'],
    sector: 'vm-deployment',
    sectorName: 'VM Deployment/Loading',
    description: 'Software deployment, image loading, provisioning',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of VIRT_SUBSECTORS) {
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
    const subsector = VIRT_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VIRTUALIZATION SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find virtualization patents
  const virtPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'virtualization') {
      virtPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Virtualization patents: ${virtPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(75));
  for (const subsector of VIRT_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(16)} ${subsector.prefixes.join(', ').padEnd(25)} ${subsector.description}`);
  }
  console.log('─'.repeat(75) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of virtPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as virtualization (general)
      keptGeneral++;
      subSectorCounts.set('virtualization', (subSectorCounts.get('virtualization') || 0) + 1);
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
  console.log(`Kept in virtualization: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(75));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / virtPatents.length) * 100).toFixed(1);
    const subsectorDef = VIRT_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Virtualization (General)';
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
