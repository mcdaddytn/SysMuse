#!/usr/bin/env npx tsx
/**
 * Analyze Cloud-Config Sector CPC Code Distribution
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
  console.log('        CLOUD-CONFIG CPC DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find cloud-config patents
  const configPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'cloud-config') {
      configPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`Cloud-config patents: ${configPatents.length.toLocaleString()}\n`);

  // Count all CPC codes at different prefix levels
  const cpcCounts = new Map<string, number>();
  const h04lCounts = new Map<string, number>();

  for (const { cpcCodes } of configPatents) {
    const seen = new Set<string>();
    const seenH04l = new Set<string>();

    for (const cpc of cpcCodes) {
      // Count top-level prefixes
      const prefix4 = cpc.substring(0, 4);
      if (!seen.has(prefix4)) {
        cpcCounts.set(prefix4, (cpcCounts.get(prefix4) || 0) + 1);
        seen.add(prefix4);
      }

      // Detailed H04L41 analysis
      if (cpc.startsWith('H04L41')) {
        const match = cpc.match(/H04L41(\/\d+)?/);
        if (match) {
          const subCode = `H04L41${match[1] || ''}`;
          if (!seenH04l.has(subCode)) {
            h04lCounts.set(subCode, (h04lCounts.get(subCode) || 0) + 1);
            seenH04l.add(subCode);
          }
        }
      }
    }
  }

  // Display top-level distribution
  console.log('TOP-LEVEL CPC DISTRIBUTION:');
  console.log('─'.repeat(60));
  const sortedTop = Array.from(cpcCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedTop.slice(0, 15)) {
    const pct = ((count / configPatents.length) * 100).toFixed(1);
    console.log(`  ${code.padEnd(8)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)`);
  }

  // Display H04L41 sub-code distribution
  console.log('\n' + '═'.repeat(70));
  console.log('H04L41 SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));

  const descriptions: Record<string, string> = {
    'H04L41': 'Network management (general)',
    'H04L41/02': 'Network management - hierarchical',
    'H04L41/04': 'Network topology discovery',
    'H04L41/06': 'Network management - configuration',
    'H04L41/08': 'Configuration management operations',
    'H04L41/082': 'Configuration retrieval',
    'H04L41/0803': 'Configuration backup/restore',
    'H04L41/0806': 'Configuration templates',
    'H04L41/0813': 'Configuration deployment',
    'H04L41/0816': 'Configuration rollback',
    'H04L41/0823': 'Configuration profiles',
    'H04L41/0826': 'Configuration distribution',
    'H04L41/0836': 'Configuration auto-discovery',
    'H04L41/0843': 'Configuration consistency',
    'H04L41/0853': 'Configuration scripting',
    'H04L41/0856': 'Configuration workflows',
    'H04L41/0863': 'Configuration APIs',
    'H04L41/0866': 'Configuration models',
    'H04L41/0873': 'Configuration languages',
    'H04L41/0876': 'Configuration protocols',
    'H04L41/0886': 'Configuration visualization',
    'H04L41/0893': 'Configuration validation',
    'H04L41/0896': 'Configuration versioning',
    'H04L41/12': 'Network topology management',
    'H04L41/14': 'Fault management',
    'H04L41/16': 'Alarm management',
    'H04L41/22': 'Service provisioning',
    'H04L41/28': 'Network policies',
  };

  const sortedH04l = Array.from(h04lCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedH04l.slice(0, 30)) {
    const pct = ((count / configPatents.length) * 100).toFixed(1);
    const desc = descriptions[code] || '';
    console.log(`  ${code.padEnd(14)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Groupings analysis
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(70));

  // Configuration operations (H04L41/08)
  let configOpsTotal = 0;
  for (const [code, count] of sortedH04l) {
    if (code.match(/H04L41\/08/)) {
      configOpsTotal += count;
    }
  }
  console.log(`\n• Configuration Operations (H04L41/08): ${configOpsTotal} patents`);

  // Topology (H04L41/04, H04L41/12)
  let topoTotal = 0;
  for (const [code, count] of sortedH04l) {
    if (code.match(/H04L41\/04/) || code.match(/H04L41\/12/)) {
      topoTotal += count;
    }
  }
  console.log(`• Topology Management (H04L41/04, /12): ${topoTotal} patents`);

  // Policy (H04L41/28)
  let policyTotal = 0;
  for (const [code, count] of sortedH04l) {
    if (code.match(/H04L41\/28/)) {
      policyTotal += count;
    }
  }
  console.log(`• Policy Management (H04L41/28): ${policyTotal} patents`);

  // Service provisioning (H04L41/22)
  let provisionTotal = 0;
  for (const [code, count] of sortedH04l) {
    if (code.match(/H04L41\/22/)) {
      provisionTotal += count;
    }
  }
  console.log(`• Service Provisioning (H04L41/22): ${provisionTotal} patents`);

  // General configuration (H04L41/06)
  let genConfigTotal = 0;
  for (const [code, count] of sortedH04l) {
    if (code.match(/H04L41\/06/)) {
      genConfigTotal += count;
    }
  }
  console.log(`• General Configuration (H04L41/06): ${genConfigTotal} patents`);

  // Fault/alarm (H04L41/14, H04L41/16)
  let faultTotal = 0;
  for (const [code, count] of sortedH04l) {
    if (code.match(/H04L41\/14/) || code.match(/H04L41\/16/)) {
      faultTotal += count;
    }
  }
  console.log(`• Fault/Alarm Management (H04L41/14-16): ${faultTotal} patents`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
