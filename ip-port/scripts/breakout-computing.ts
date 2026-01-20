#!/usr/bin/env npx tsx
/**
 * Break Out Computing Sector into Sub-Sectors
 *
 * Splits the computing sector (3,179 patents) into more specific
 * sub-sectors based on CPC code analysis:
 *
 * - database: Information retrieval, databases, search (G06F16)
 * - fault-tolerance: Error detection, recovery, redundancy (G06F11)
 * - systems-software: OS, scheduling, resource management (G06F9 non-VM)
 * - software-engineering: Compilers, development tools (G06F8)
 * - memory-management: Caching, memory systems (G06F12)
 * - io-interfaces: Input/output, display, peripherals (G06F3)
 * - system-security: Access control, authentication (G06F21) -> merge with existing
 *
 * Usage: npx tsx scripts/breakout-computing.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for computing
const COMPUTING_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Database and information retrieval
    prefixes: ['G06F16'],
    sector: 'database',
    sectorName: 'Database/Information Retrieval',
    description: 'Databases, search engines, data mining, indexing',
  },
  {
    // Fault tolerance and error handling
    prefixes: ['G06F11'],
    sector: 'fault-tolerance',
    sectorName: 'Fault Tolerance/Reliability',
    description: 'Error detection, recovery, redundancy, checkpointing',
  },
  {
    // Security - merge with existing system-security
    prefixes: ['G06F21'],
    sector: 'system-security',
    sectorName: 'System/Host Security',
    description: 'Access control, authentication, secure boot, DRM',
  },
  {
    // Software engineering
    prefixes: ['G06F8'],
    sector: 'software-engineering',
    sectorName: 'Software Engineering',
    description: 'Compilers, interpreters, development tools, testing',
  },
  {
    // Memory management
    prefixes: ['G06F12'],
    sector: 'memory-management',
    sectorName: 'Memory Management',
    description: 'Caching, virtual memory, memory allocation',
  },
  {
    // I/O and interfaces
    prefixes: ['G06F3'],
    sector: 'io-interfaces',
    sectorName: 'I/O Interfaces',
    description: 'Input/output, display systems, peripherals',
  },
  {
    // Systems software (G06F9 but not virtualization-specific)
    // Note: G06F9/45x and G06F9/5x are already in virtualization
    prefixes: ['G06F9/44', 'G06F9/46', 'G06F9/48', 'G06F9/54'],
    sector: 'systems-software',
    sectorName: 'Systems Software',
    description: 'OS kernels, scheduling, IPC, multiprogramming',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of COMPUTING_SUBSECTORS) {
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
    const subsector = COMPUTING_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        COMPUTING SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find computing patents
  const computingPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'computing') {
      computingPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Computing patents: ${computingPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(70));
  for (const subsector of COMPUTING_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(20)} ${subsector.prefixes.join(', ').padEnd(25)} ${subsector.description}`);
  }
  console.log('─'.repeat(70) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of computingPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as computing (general)
      keptGeneral++;
      subSectorCounts.set('computing', (subSectorCounts.get('computing') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(70));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(70));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in computing: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(70));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / computingPatents.length) * 100).toFixed(1);
    const subsectorDef = COMPUTING_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Computing (General)';
    console.log(`  ${sector.padEnd(20)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(70));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(70));

  const overallCounts = new Map<string, number>();
  for (const data of Object.values(assignments)) {
    const sector = data.sector || 'general';
    overallCounts.set(sector, (overallCounts.get(sector) || 0) + 1);
  }

  const sortedOverall = Array.from(overallCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  console.log('\nTop sectors after breakout:');
  for (const [sector, count] of sortedOverall.slice(0, 20)) {
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

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
