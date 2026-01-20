#!/usr/bin/env npx tsx
/**
 * Analyze Cloud-Orchestration Sector H04L41/H04L43 Sub-codes
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
  console.log('        CLOUD-ORCHESTRATION H04L41/H04L43 DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find cloud-orchestration patents
  const cloudPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'cloud-orchestration') {
      cloudPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`Cloud-orchestration patents: ${cloudPatents.length.toLocaleString()}\n`);

  // Count H04L41 sub-codes
  const h04l41Counts = new Map<string, number>();
  const h04l43Counts = new Map<string, number>();

  for (const { cpcCodes } of cloudPatents) {
    const seen41 = new Set<string>();
    const seen43 = new Set<string>();
    for (const cpc of cpcCodes) {
      if (cpc.startsWith('H04L41/')) {
        const match = cpc.match(/H04L41\/(\d+)/);
        if (match) {
          const subCode = `H04L41/${match[1]}`;
          if (!seen41.has(subCode)) {
            h04l41Counts.set(subCode, (h04l41Counts.get(subCode) || 0) + 1);
            seen41.add(subCode);
          }
        }
      }
      if (cpc.startsWith('H04L43/')) {
        const match = cpc.match(/H04L43\/(\d+)/);
        if (match) {
          const subCode = `H04L43/${match[1]}`;
          if (!seen43.has(subCode)) {
            h04l43Counts.set(subCode, (h04l43Counts.get(subCode) || 0) + 1);
            seen43.add(subCode);
          }
        }
      }
    }
  }

  // H04L41 descriptions
  const h04l41Desc: Record<string, string> = {
    'H04L41/02': 'Designation of service providers',
    'H04L41/04': 'Network topology discovery',
    'H04L41/06': 'Management interfaces (CLI, GUI, API)',
    'H04L41/08': 'Configuration policies',
    'H04L41/0803': 'Policy-based configuration',
    'H04L41/0813': 'Model-driven configuration',
    'H04L41/0823': 'Intent-based networking',
    'H04L41/0893': 'Configuration validation',
    'H04L41/12': 'Discovery of network elements',
    'H04L41/14': 'Fault/alarm management',
    'H04L41/16': 'Event/notification handling',
    'H04L41/20': 'Network simulation',
    'H04L41/22': 'Network maps/visualization',
    'H04L41/28': 'Event-driven configuration',
    'H04L41/40': 'Service management',
    'H04L41/50': 'NFV management (MANO)',
    'H04L41/5003': 'VNF lifecycle management',
    'H04L41/5009': 'Service chaining',
    'H04L41/5019': 'Orchestration policies',
    'H04L41/5025': 'Resource orchestration',
    'H04L41/5029': 'Performance management',
    'H04L41/5032': 'SLA management',
    'H04L41/5038': 'Scaling/elasticity',
    'H04L41/5041': 'Traffic steering',
    'H04L41/5054': 'Multi-domain orchestration',
    'H04L41/5058': 'Service placement',
    'H04L41/5061': 'Fault recovery',
    'H04L41/5067': 'VNF instantiation',
  };

  // H04L43 descriptions
  const h04l43Desc: Record<string, string> = {
    'H04L43/02': 'Network element monitoring',
    'H04L43/04': 'Processing monitored data',
    'H04L43/06': 'Generation of reports',
    'H04L43/08': 'Monitoring based on specific metrics',
    'H04L43/0805': 'Bandwidth monitoring',
    'H04L43/0811': 'Latency monitoring',
    'H04L43/0823': 'Packet loss monitoring',
    'H04L43/0829': 'Jitter monitoring',
    'H04L43/0852': 'Flow-level monitoring',
    'H04L43/0876': 'Resource utilization',
    'H04L43/10': 'Active monitoring (probes)',
    'H04L43/106': 'Synthetic transactions',
    'H04L43/12': 'Passive monitoring (mirroring)',
    'H04L43/16': 'Sampling techniques',
  };

  // Sort and display H04L41
  const sorted41 = Array.from(h04l41Counts.entries()).sort((a, b) => b[1] - a[1]);

  console.log('H04L41 (Network Management) SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));
  for (const [code, count] of sorted41.slice(0, 25)) {
    const pct = ((count / cloudPatents.length) * 100).toFixed(1);
    const desc = h04l41Desc[code] || '';
    console.log(`  ${code.padEnd(14)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Sort and display H04L43
  const sorted43 = Array.from(h04l43Counts.entries()).sort((a, b) => b[1] - a[1]);

  console.log('\nH04L43 (Network Monitoring) SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));
  for (const [code, count] of sorted43.slice(0, 15)) {
    const pct = ((count / cloudPatents.length) * 100).toFixed(1);
    const desc = h04l43Desc[code] || '';
    console.log(`  ${code.padEnd(14)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Groupings
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(70));

  // Config management (H04L41/08)
  let configTotal = 0;
  for (const [code, count] of sorted41) {
    if (code.startsWith('H04L41/08') || code.startsWith('H04L41/06')) {
      configTotal += count;
    }
  }
  console.log(`\n• Configuration Management (H04L41/06, H04L41/08): ${configTotal} patents`);

  // NFV/Orchestration (H04L41/50)
  let nfvTotal = 0;
  for (const [code, count] of sorted41) {
    if (code.startsWith('H04L41/50') || code.startsWith('H04L41/40')) {
      nfvTotal += count;
    }
  }
  console.log(`• NFV/Service Orchestration (H04L41/40, H04L41/50): ${nfvTotal} patents`);

  // Fault management (H04L41/14, H04L41/16)
  let faultTotal = 0;
  for (const [code, count] of sorted41) {
    if (code.startsWith('H04L41/14') || code.startsWith('H04L41/16')) {
      faultTotal += count;
    }
  }
  console.log(`• Fault/Alarm Management (H04L41/14, H04L41/16): ${faultTotal} patents`);

  // Monitoring (H04L43)
  let monitorTotal = 0;
  for (const [_, count] of sorted43) {
    monitorTotal += count;
  }
  console.log(`• Network Monitoring (H04L43): ${monitorTotal} patents`);

  // Discovery/Topology (H04L41/04, H04L41/12, H04L41/22)
  let topoTotal = 0;
  for (const [code, count] of sorted41) {
    if (code.startsWith('H04L41/04') || code.startsWith('H04L41/12') || code.startsWith('H04L41/22')) {
      topoTotal += count;
    }
  }
  console.log(`• Topology/Discovery (H04L41/04, H04L41/12, H04L41/22): ${topoTotal} patents`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
