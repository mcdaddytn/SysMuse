#!/usr/bin/env npx tsx
/**
 * Break Out VM-Hypervisor Sector into Sub-Sectors
 *
 * Splits the vm-hypervisor sector (871 patents) into more specific
 * sub-sectors based on G06F9/455 sub-code analysis:
 *
 * - vmh-migration: VM migration, live migration (G06F9/45533, G06F9/45537, G06F9/45541)
 * - vmh-placement: VM placement, consolidation, optimization (G06F9/45545, G06F9/4555)
 * - vmh-snapshot: VM snapshots, cloning, templates (G06F9/45504-16)
 * - vmh-lifecycle: VM lifecycle, provisioning (G06F9/45558 without above)
 *
 * Usage: npx tsx scripts/breakout-vm-hypervisor.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for vm-hypervisor - order matters (more specific first)
const VMH_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // VM Migration - live migration, vMotion
    prefixes: ['G06F9/45533', 'G06F9/45537', 'G06F9/45541'],
    sector: 'vmh-migration',
    sectorName: 'VMH Migration',
    description: 'VM migration, live migration, vMotion',
  },
  {
    // VM Placement and optimization
    prefixes: ['G06F9/45545', 'G06F9/4555', 'G06F9/45554'],
    sector: 'vmh-placement',
    sectorName: 'VMH Placement/DRS',
    description: 'VM placement, consolidation, DRS, optimization',
  },
  {
    // VM Snapshots, cloning, templates
    prefixes: ['G06F9/45504', 'G06F9/45508', 'G06F9/45512', 'G06F9/45516', 'G06F9/4552'],
    sector: 'vmh-snapshot',
    sectorName: 'VMH Snapshot/Clone',
    description: 'Snapshots, cloning, templates, checkpointing',
  },
  {
    // General hypervisor/VMM
    prefixes: ['G06F9/455'],
    sector: 'vmh-core',
    sectorName: 'VMH Core/Hypervisor',
    description: 'Core hypervisor, VMM, VM lifecycle',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector, prioritizing more specific codes
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    // Check more specific subsectors first
    for (const subsector of VMH_SUBSECTORS) {
      for (const prefix of subsector.prefixes) {
        if (cpc.startsWith(prefix)) {
          // For vmh-core (G06F9/455), only match if it's the general code, not a specific sub-code
          if (subsector.sector === 'vmh-core') {
            // Check if this is NOT already matched by a more specific subsector
            const isMoreSpecific = VMH_SUBSECTORS.slice(0, -1).some(s =>
              s.prefixes.some(p => cpc.startsWith(p))
            );
            if (!isMoreSpecific) {
              matchCounts.set(subsector.sector, (matchCounts.get(subsector.sector) || 0) + 1);
            }
          } else {
            matchCounts.set(subsector.sector, (matchCounts.get(subsector.sector) || 0) + 1);
          }
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
    const subsector = VMH_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VM-HYPERVISOR SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find vm-hypervisor patents
  const vmhPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'vm-hypervisor') {
      vmhPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`VM-hypervisor patents: ${vmhPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(80));
  for (const subsector of VMH_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(16)} ${subsector.prefixes.slice(0, 3).join(', ').padEnd(35)} ${subsector.description}`);
  }
  console.log('─'.repeat(80) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of vmhPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as vm-hypervisor (general)
      keptGeneral++;
      subSectorCounts.set('vm-hypervisor', (subSectorCounts.get('vm-hypervisor') || 0) + 1);
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
  console.log(`Kept in vm-hypervisor: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(80));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / vmhPatents.length) * 100).toFixed(1);
    const subsectorDef = VMH_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'VM Hypervisor (General)';
    console.log(`  ${sector.padEnd(18)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
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
