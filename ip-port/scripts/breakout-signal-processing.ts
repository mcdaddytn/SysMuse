#!/usr/bin/env npx tsx
/**
 * Break Out Signal-Processing Sector into Sub-Sectors
 *
 * Splits the signal-processing sector (1,467 patents) into more specific
 * sub-sectors based on CPC code analysis:
 *
 * - baseband: Baseband signal processing (H04L25)
 * - error-correction: FEC, coding, error detection (H04L1, H03M13)
 * - modulation: Modulation/demodulation systems (H04L27)
 * - multiplexing: OFDM, TDM, FDM, carrier systems (H04L5)
 * - synchronization: Clock recovery, timing (H04L7)
 * - rf-transmission: RF systems, antennas, transmission (H04B)
 * - signal-conversion: A/D, D/A converters (H03M1)
 *
 * Usage: npx tsx scripts/breakout-signal-processing.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for signal-processing
const SIGNAL_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Baseband signal processing
    prefixes: ['H04L25'],
    sector: 'baseband',
    sectorName: 'Baseband Processing',
    description: 'Baseband systems, equalization, filtering',
  },
  {
    // Error correction and coding
    prefixes: ['H04L1', 'H03M13'],
    sector: 'error-correction',
    sectorName: 'Error Correction/FEC',
    description: 'FEC, turbo codes, LDPC, convolutional codes',
  },
  {
    // Modulation systems
    prefixes: ['H04L27'],
    sector: 'modulation',
    sectorName: 'Modulation Systems',
    description: 'QAM, PSK, FSK, modulation/demodulation',
  },
  {
    // Multiplexing - OFDM, TDM
    prefixes: ['H04L5'],
    sector: 'multiplexing',
    sectorName: 'Multiplexing/OFDM',
    description: 'OFDM, TDM, FDM, carrier systems',
  },
  {
    // Synchronization
    prefixes: ['H04L7', 'H03L7'],
    sector: 'synchronization',
    sectorName: 'Synchronization/Timing',
    description: 'Clock recovery, timing sync, PLL',
  },
  {
    // RF and transmission
    prefixes: ['H04B1', 'H04B3', 'H04B7', 'H04B10', 'H04B17'],
    sector: 'rf-transmission',
    sectorName: 'RF/Transmission',
    description: 'RF systems, antennas, transmitters, receivers',
  },
  {
    // Signal conversion - ADC/DAC
    prefixes: ['H03M1'],
    sector: 'signal-conversion',
    sectorName: 'Signal Conversion',
    description: 'A/D converters, D/A converters, quantization',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of SIGNAL_SUBSECTORS) {
      for (const prefix of subsector.prefixes) {
        // Special handling for H04L1 - don't match H04L12, H04L13, etc.
        if (prefix === 'H04L1') {
          if (cpc.startsWith('H04L1') && !cpc.startsWith('H04L12') && !cpc.startsWith('H04L13')) {
            matchCounts.set(subsector.sector, (matchCounts.get(subsector.sector) || 0) + 1);
            break;
          }
        } else if (cpc.startsWith(prefix)) {
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
    const subsector = SIGNAL_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        SIGNAL-PROCESSING SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find signal-processing patents
  const signalPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'signal-processing') {
      signalPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Signal-processing patents: ${signalPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(75));
  for (const subsector of SIGNAL_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(18)} ${subsector.prefixes.join(', ').padEnd(25)} ${subsector.description}`);
  }
  console.log('─'.repeat(75) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of signalPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as signal-processing (general)
      keptGeneral++;
      subSectorCounts.set('signal-processing', (subSectorCounts.get('signal-processing') || 0) + 1);
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
  console.log(`Kept in signal-processing: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(75));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / signalPatents.length) * 100).toFixed(1);
    const subsectorDef = SIGNAL_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Signal Processing (General)';
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
