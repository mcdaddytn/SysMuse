#!/usr/bin/env npx tsx
/**
 * Break Out Fault-Tolerance Sector into Sub-Sectors
 *
 * Splits the fault-tolerance sector (586 patents) into more specific
 * sub-sectors based on G06F11 sub-code analysis:
 *
 * - ft-errordetect: Error detection, retry, correction (G06F11/07-10)
 * - ft-monitoring: Monitoring, performance, logging (G06F11/30-34)
 * - ft-recovery: Recovery, restart, checkpointing (G06F11/14)
 * - ft-failover: Failover, standby, replication (G06F11/20)
 * - ft-redundancy: Redundancy, duplication (G06F11/16-18)
 * - ft-diagnosis: Diagnosis, testing, BIST (G06F11/22-26)
 *
 * Usage: npx tsx scripts/breakout-fault-tolerance.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for fault-tolerance - order matters (more specific first)
const FT_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Failover/standby/replication - check first (more specific)
    prefixes: ['G06F11/20', 'G06F11/202', 'G06F11/203', 'G06F11/205'],
    sector: 'ft-failover',
    sectorName: 'FT Failover/HA',
    description: 'Failover, standby, replication, disaster recovery',
  },
  {
    // Recovery, restart, checkpointing
    prefixes: ['G06F11/14'],
    sector: 'ft-recovery',
    sectorName: 'FT Recovery/Checkpoint',
    description: 'Recovery, restart, checkpointing, rollback',
  },
  {
    // Redundancy, duplication
    prefixes: ['G06F11/16', 'G06F11/18'],
    sector: 'ft-redundancy',
    sectorName: 'FT Redundancy',
    description: 'Redundancy, duplication, RAID-like',
  },
  {
    // Monitoring, performance, logging
    prefixes: ['G06F11/30', 'G06F11/32', 'G06F11/34'],
    sector: 'ft-monitoring',
    sectorName: 'FT Monitoring/Logging',
    description: 'Monitoring, performance tracking, logging',
  },
  {
    // Diagnosis, testing
    prefixes: ['G06F11/22', 'G06F11/26', 'G06F11/263', 'G06F11/267'],
    sector: 'ft-diagnosis',
    sectorName: 'FT Diagnosis/Test',
    description: 'Diagnosis, self-test, BIST',
  },
  {
    // Error detection, retry, correction
    prefixes: ['G06F11/07', 'G06F11/08', 'G06F11/10'],
    sector: 'ft-errordetect',
    sectorName: 'FT Error Detection',
    description: 'Error detection, retry, correction',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of FT_SUBSECTORS) {
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
    const subsector = FT_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        FAULT-TOLERANCE SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find fault-tolerance patents
  const ftPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'fault-tolerance') {
      ftPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Fault-tolerance patents: ${ftPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(85));
  for (const subsector of FT_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(16)} ${subsector.prefixes.slice(0, 3).join(', ').padEnd(30)} ${subsector.description}`);
  }
  console.log('─'.repeat(85) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of ftPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as fault-tolerance (general)
      keptGeneral++;
      subSectorCounts.set('fault-tolerance', (subSectorCounts.get('fault-tolerance') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(85));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(85));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in fault-tolerance: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(85));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / ftPatents.length) * 100).toFixed(1);
    const subsectorDef = FT_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Fault Tolerance (General)';
    console.log(`  ${sector.padEnd(18)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(85));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(85));

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
    console.log(`  ${marker} ${sector.padEnd(26)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Summary
  const largeSectors = sortedOverall.filter(([_, c]) => c > 500).length;
  const goodSectors = sortedOverall.filter(([_, c]) => c >= 50 && c <= 500).length;
  const smallSectors = sortedOverall.filter(([_, c]) => c < 50).length;

  console.log(`\nSector size summary:`);
  console.log(`  🔴 Large (>500):  ${largeSectors}`);
  console.log(`  ✅ Good (50-500): ${goodSectors}`);
  console.log(`  🟡 Small (<50):   ${smallSectors}`);

  console.log('\n' + '═'.repeat(85) + '\n');
}

main().catch(console.error);
