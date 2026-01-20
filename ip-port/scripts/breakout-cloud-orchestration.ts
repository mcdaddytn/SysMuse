#!/usr/bin/env npx tsx
/**
 * Break Out Cloud-Orchestration Sector into Sub-Sectors
 *
 * Splits the cloud-orchestration sector (1,220 patents) into more specific
 * sub-sectors based on H04L41/H04L43 sub-code analysis:
 *
 * - cloud-config: Configuration management, policies (H04L41/06, H04L41/08)
 * - cloud-nfv: NFV, service orchestration, MANO (H04L41/40, H04L41/50)
 * - cloud-monitoring: Network monitoring, telemetry (H04L43)
 * - cloud-topology: Topology discovery, network maps (H04L41/04, H04L41/12, H04L41/22)
 * - cloud-fault: Fault/alarm management (H04L41/14, H04L41/16)
 *
 * Usage: npx tsx scripts/breakout-cloud-orchestration.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for cloud-orchestration
const CLOUD_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // NFV/Service orchestration - check first (more specific)
    prefixes: ['H04L41/50', 'H04L41/40'],
    sector: 'cloud-nfv',
    sectorName: 'Cloud NFV/Service Orchestration',
    description: 'NFV, MANO, service chaining, VNF lifecycle',
  },
  {
    // Network monitoring
    prefixes: ['H04L43'],
    sector: 'cloud-monitoring',
    sectorName: 'Cloud Monitoring/Telemetry',
    description: 'Network monitoring, metrics, probes, telemetry',
  },
  {
    // Configuration management
    prefixes: ['H04L41/08', 'H04L41/06'],
    sector: 'cloud-config',
    sectorName: 'Cloud Configuration',
    description: 'Configuration management, policies, APIs',
  },
  {
    // Topology and discovery
    prefixes: ['H04L41/12', 'H04L41/22', 'H04L41/04'],
    sector: 'cloud-topology',
    sectorName: 'Cloud Topology/Discovery',
    description: 'Topology discovery, network maps, visualization',
  },
  {
    // Fault/alarm management
    prefixes: ['H04L41/14', 'H04L41/16'],
    sector: 'cloud-fault',
    sectorName: 'Cloud Fault Management',
    description: 'Fault detection, alarms, notifications',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of CLOUD_SUBSECTORS) {
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
    const subsector = CLOUD_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        CLOUD-ORCHESTRATION SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find cloud-orchestration patents
  const cloudPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'cloud-orchestration') {
      cloudPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Cloud-orchestration patents: ${cloudPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(75));
  for (const subsector of CLOUD_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(18)} ${subsector.prefixes.join(', ').padEnd(28)} ${subsector.description}`);
  }
  console.log('─'.repeat(75) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of cloudPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as cloud-orchestration (general)
      keptGeneral++;
      subSectorCounts.set('cloud-orchestration', (subSectorCounts.get('cloud-orchestration') || 0) + 1);
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
  console.log(`Kept in cloud-orchestration: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(75));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / cloudPatents.length) * 100).toFixed(1);
    const subsectorDef = CLOUD_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Cloud Orchestration (General)';
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
