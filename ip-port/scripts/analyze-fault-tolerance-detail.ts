#!/usr/bin/env npx tsx
/**
 * Analyze Fault-Tolerance Sector CPC Code Distribution
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
  console.log('        FAULT-TOLERANCE CPC DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find fault-tolerance patents
  const ftPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'fault-tolerance') {
      ftPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`Fault-tolerance patents: ${ftPatents.length.toLocaleString()}\n`);

  // Count all CPC codes at different prefix levels
  const cpcCounts = new Map<string, number>();
  const g06fCounts = new Map<string, number>();

  for (const { cpcCodes } of ftPatents) {
    const seen = new Set<string>();
    const seenG06f = new Set<string>();

    for (const cpc of cpcCodes) {
      // Count top-level prefixes
      const prefix4 = cpc.substring(0, 4);
      if (!seen.has(prefix4)) {
        cpcCounts.set(prefix4, (cpcCounts.get(prefix4) || 0) + 1);
        seen.add(prefix4);
      }

      // Detailed G06F analysis
      if (cpc.startsWith('G06F')) {
        const match = cpc.match(/G06F(\d+)(\/\d+)?/);
        if (match) {
          const subCode = `G06F${match[1]}${match[2] || ''}`;
          if (!seenG06f.has(subCode)) {
            g06fCounts.set(subCode, (g06fCounts.get(subCode) || 0) + 1);
            seenG06f.add(subCode);
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
    const pct = ((count / ftPatents.length) * 100).toFixed(1);
    console.log(`  ${code.padEnd(8)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)`);
  }

  // Display G06F sub-code distribution
  console.log('\n' + '═'.repeat(70));
  console.log('G06F SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));

  const descriptions: Record<string, string> = {
    'G06F11': 'Error detection/correction (general)',
    'G06F11/07': 'Error detection',
    'G06F11/08': 'Error correction by retry',
    'G06F11/10': 'Error correction by adding special bits',
    'G06F11/14': 'Recovery/restart after failure',
    'G06F11/16': 'Error detection or correction of the data by redundancy',
    'G06F11/18': 'Redundancy by duplication',
    'G06F11/182': 'Data comparison',
    'G06F11/1835': 'Processor duplication',
    'G06F11/185': 'Memory duplication',
    'G06F11/187': 'I/O duplication',
    'G06F11/20': 'Redundancy by using standby equipment',
    'G06F11/202': 'Switchover/failover',
    'G06F11/2023': 'Hot standby',
    'G06F11/2025': 'Cold standby',
    'G06F11/2028': 'Failover protocols',
    'G06F11/2035': 'Cluster recovery',
    'G06F11/2038': 'Replication',
    'G06F11/2041': 'Primary-backup',
    'G06F11/2046': 'State synchronization',
    'G06F11/2048': 'Recovery point',
    'G06F11/205': 'Disaster recovery',
    'G06F11/2053': 'Geographic distribution',
    'G06F11/2056': 'Recovery time/RPO',
    'G06F11/2058': 'Failback',
    'G06F11/22': 'Diagnosis/test during operation',
    'G06F11/26': 'Functional testing',
    'G06F11/263': 'Self-test',
    'G06F11/267': 'BIST',
    'G06F11/30': 'Monitoring',
    'G06F11/32': 'Performance monitoring',
    'G06F11/34': 'Recording/statistical evaluation',
    'G06F11/36': 'Prevention of errors',
  };

  const sortedG06f = Array.from(g06fCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedG06f.slice(0, 30)) {
    const pct = ((count / ftPatents.length) * 100).toFixed(1);
    const desc = descriptions[code] || '';
    console.log(`  ${code.padEnd(14)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Groupings analysis
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(70));

  // Redundancy/duplication (G06F11/16-18)
  let redundancyTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F11\/1[68]/)) {
      redundancyTotal += count;
    }
  }
  console.log(`\n• Redundancy/Duplication (G06F11/16-18): ${redundancyTotal} patents`);

  // Failover/standby (G06F11/20)
  let failoverTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F11\/20/)) {
      failoverTotal += count;
    }
  }
  console.log(`• Failover/Standby (G06F11/20): ${failoverTotal} patents`);

  // Recovery/restart (G06F11/14)
  let recoveryTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F11\/14/)) {
      recoveryTotal += count;
    }
  }
  console.log(`• Recovery/Restart (G06F11/14): ${recoveryTotal} patents`);

  // Error detection (G06F11/07-10)
  let errorDetectTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F11\/0[78]/) || code.match(/G06F11\/10/)) {
      errorDetectTotal += count;
    }
  }
  console.log(`• Error Detection/Correction (G06F11/07-10): ${errorDetectTotal} patents`);

  // Diagnosis/test (G06F11/22-26)
  let diagnosisTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F11\/2[2-6]/)) {
      diagnosisTotal += count;
    }
  }
  console.log(`• Diagnosis/Testing (G06F11/22-26): ${diagnosisTotal} patents`);

  // Monitoring (G06F11/30-34)
  let monitoringTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F11\/3[0-4]/)) {
      monitoringTotal += count;
    }
  }
  console.log(`• Monitoring/Performance (G06F11/30-34): ${monitoringTotal} patents`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
