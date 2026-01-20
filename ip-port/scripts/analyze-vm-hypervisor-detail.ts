#!/usr/bin/env npx tsx
/**
 * Analyze VM-Hypervisor Sector G06F9/455 Sub-codes
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VM-HYPERVISOR G06F9/455 DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find vm-hypervisor patents
  const vmPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'vm-hypervisor') {
      vmPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`VM-hypervisor patents: ${vmPatents.length.toLocaleString()}\n`);

  // Count G06F9/455 sub-codes
  const g06f9455Counts = new Map<string, number>();

  for (const { cpcCodes } of vmPatents) {
    const seen = new Set<string>();
    for (const cpc of cpcCodes) {
      if (cpc.startsWith('G06F9/455')) {
        // Extract specific sub-code
        const match = cpc.match(/G06F9\/455(\d*)/);
        if (match) {
          const subCode = `G06F9/455${match[1] || ''}`;
          if (!seen.has(subCode)) {
            g06f9455Counts.set(subCode, (g06f9455Counts.get(subCode) || 0) + 1);
            seen.add(subCode);
          }
        }
      }
    }
  }

  // G06F9/455 sub-code descriptions
  const descriptions: Record<string, string> = {
    'G06F9/455': 'VMMs/Hypervisors (general)',
    'G06F9/45504': 'VM cloning',
    'G06F9/45508': 'VM templates',
    'G06F9/45512': 'VM snapshots',
    'G06F9/45516': 'VM checkpointing',
    'G06F9/4552': 'VM suspend/resume',
    'G06F9/45525': 'VM hibernation',
    'G06F9/45529': 'VM power management',
    'G06F9/45533': 'VM migration',
    'G06F9/45537': 'Live migration',
    'G06F9/45541': 'Migration optimization',
    'G06F9/45545': 'VM placement',
    'G06F9/4555': 'VM consolidation',
    'G06F9/45554': 'Resource optimization',
    'G06F9/45558': 'VM lifecycle management',
    'G06F9/4556': 'VM provisioning',
    'G06F9/45562': 'VM instantiation',
    'G06F9/4557': 'Memory virtualization',
    'G06F9/45575': 'Page sharing',
    'G06F9/4558': 'I/O virtualization',
    'G06F9/45585': 'Device passthrough',
    'G06F9/4559': 'CPU virtualization',
    'G06F9/45595': 'Hardware-assisted virtualization',
  };

  // Sort and display
  const sorted = Array.from(g06f9455Counts.entries()).sort((a, b) => b[1] - a[1]);

  console.log('G06F9/455 SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));
  for (const [code, count] of sorted) {
    const pct = ((count / vmPatents.length) * 100).toFixed(1);
    const desc = descriptions[code] || '';
    console.log(`  ${code.padEnd(16)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Groupings
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(70));

  // VM Migration (G06F9/45533, G06F9/45537, G06F9/45541)
  let migrationTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/45533') || code.startsWith('G06F9/45537') || code.startsWith('G06F9/45541')) {
      migrationTotal += count;
    }
  }
  console.log(`\n• VM Migration (G06F9/45533-41): ${migrationTotal} patents`);

  // VM Lifecycle (G06F9/45558, G06F9/4556, G06F9/45562)
  let lifecycleTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/45558') || code.startsWith('G06F9/4556')) {
      lifecycleTotal += count;
    }
  }
  console.log(`• VM Lifecycle/Provisioning (G06F9/45558-62): ${lifecycleTotal} patents`);

  // VM Snapshots/Cloning (G06F9/45504-16)
  let snapshotTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/45504') || code.startsWith('G06F9/45508') ||
        code.startsWith('G06F9/45512') || code.startsWith('G06F9/45516')) {
      snapshotTotal += count;
    }
  }
  console.log(`• VM Snapshots/Cloning (G06F9/45504-16): ${snapshotTotal} patents`);

  // VM Placement/Optimization (G06F9/45545, G06F9/4555, G06F9/45554)
  let placementTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/45545') || code.startsWith('G06F9/4555')) {
      placementTotal += count;
    }
  }
  console.log(`• VM Placement/Optimization (G06F9/45545-54): ${placementTotal} patents`);

  // Hardware Virtualization (G06F9/4557-95)
  let hwVirtTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/4557') || code.startsWith('G06F9/4558') || code.startsWith('G06F9/4559')) {
      hwVirtTotal += count;
    }
  }
  console.log(`• Hardware Virtualization (G06F9/4557-95): ${hwVirtTotal} patents`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
