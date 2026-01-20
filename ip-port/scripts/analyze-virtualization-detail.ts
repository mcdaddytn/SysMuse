#!/usr/bin/env npx tsx
/**
 * Analyze Virtualization Sector G06F9 Sub-codes
 *
 * G06F9 has many sub-categories that may allow breakout:
 * - G06F9/44: Software development (arranging, loading)
 * - G06F9/45: Virtual machines, emulation, translation
 * - G06F9/455: VMMs, hypervisors
 * - G06F9/46: Multiprogramming (threads, processes)
 * - G06F9/48: Program scheduling
 * - G06F9/50: Resource allocation
 * - G06F9/52: Inter-program communication
 * - G06F9/54: IPC mechanisms
 *
 * Usage: npx tsx scripts/analyze-virtualization-detail.ts
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
  console.log('        VIRTUALIZATION G06F9 DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find virtualization patents
  const virtPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'virtualization') {
      virtPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`Virtualization patents: ${virtPatents.length.toLocaleString()}\n`);

  // Count G06F9 sub-codes specifically
  const g06f9Counts = new Map<string, number>();

  for (const { cpcCodes } of virtPatents) {
    const seen = new Set<string>();
    for (const cpc of cpcCodes) {
      if (cpc.startsWith('G06F9/')) {
        // Extract the sub-code (e.g., G06F9/455, G06F9/46)
        const match = cpc.match(/G06F9\/(\d+)/);
        if (match) {
          const subCode = `G06F9/${match[1]}`;
          if (!seen.has(subCode)) {
            g06f9Counts.set(subCode, (g06f9Counts.get(subCode) || 0) + 1);
            seen.add(subCode);
          }
        }
      }
    }
  }

  // Sort by count
  const sorted = Array.from(g06f9Counts.entries())
    .sort((a, b) => b[1] - a[1]);

  // G06F9 sub-code descriptions
  const descriptions: Record<string, string> = {
    'G06F9/44': 'Software arrangement/loading',
    'G06F9/445': 'Program loading/linking',
    'G06F9/448': 'Execution control',
    'G06F9/45': 'Virtual machines/emulation',
    'G06F9/451': 'Emulation/translation',
    'G06F9/455': 'VMMs/Hypervisors',
    'G06F9/46': 'Multiprogramming (threads)',
    'G06F9/461': 'Task management',
    'G06F9/465': 'Context switching',
    'G06F9/48': 'Program scheduling',
    'G06F9/485': 'Scheduling policies',
    'G06F9/50': 'Resource allocation',
    'G06F9/505': 'Memory allocation',
    'G06F9/52': 'Inter-program communication',
    'G06F9/54': 'IPC mechanisms',
    'G06F9/545': 'Message passing',
  };

  console.log('G06F9 SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));

  for (const [code, count] of sorted) {
    const pct = ((count / virtPatents.length) * 100).toFixed(1);
    const desc = descriptions[code] || '';
    console.log(`  ${code.padEnd(12)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Group into potential sub-sectors
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(70));

  // Hypervisor/VMM (G06F9/455)
  const hypervisor = g06f9Counts.get('G06F9/455') || 0;
  console.log(`\n• Hypervisor/VMM (G06F9/455): ${hypervisor} patents`);

  // VM/Emulation (G06F9/45, G06F9/451, G06F9/453)
  const vmCodes = ['G06F9/45', 'G06F9/451', 'G06F9/453'];
  let vmTotal = 0;
  for (const code of vmCodes) {
    vmTotal += g06f9Counts.get(code) || 0;
  }
  console.log(`• VM/Emulation (G06F9/45x excl 455): ${vmTotal} patents`);

  // Resource management (G06F9/50, G06F9/505)
  const resourceCodes = ['G06F9/50', 'G06F9/505', 'G06F9/5055', 'G06F9/5061'];
  let resourceTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/50')) {
      resourceTotal += count;
    }
  }
  console.log(`• Resource Management (G06F9/50x): ${resourceTotal} patents`);

  // Scheduling (G06F9/48, G06F9/485)
  let schedTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/48')) {
      schedTotal += count;
    }
  }
  console.log(`• Scheduling (G06F9/48x): ${schedTotal} patents`);

  // Multiprogramming/threads (G06F9/46)
  let threadTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/46')) {
      threadTotal += count;
    }
  }
  console.log(`• Threading/Multiprogramming (G06F9/46x): ${threadTotal} patents`);

  // IPC (G06F9/52, G06F9/54)
  let ipcTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/52') || code.startsWith('G06F9/54')) {
      ipcTotal += count;
    }
  }
  console.log(`• IPC/Communication (G06F9/52x, G06F9/54x): ${ipcTotal} patents`);

  // Software loading (G06F9/44, G06F9/445)
  let loadTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('G06F9/44')) {
      loadTotal += count;
    }
  }
  console.log(`• Software Loading (G06F9/44x): ${loadTotal} patents`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
