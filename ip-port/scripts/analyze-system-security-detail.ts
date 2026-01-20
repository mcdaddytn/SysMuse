#!/usr/bin/env npx tsx
/**
 * Analyze System-Security Sector CPC Code Distribution
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
  console.log('        SYSTEM-SECURITY CPC DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find system-security patents
  const secPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'system-security') {
      secPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`System-security patents: ${secPatents.length.toLocaleString()}\n`);

  // Count all CPC codes at different prefix levels
  const cpcCounts = new Map<string, number>();
  const g06fCounts = new Map<string, number>();

  for (const { cpcCodes } of secPatents) {
    const seen = new Set<string>();
    const seenG06f = new Set<string>();

    for (const cpc of cpcCodes) {
      // Count top-level prefixes (first 4-7 chars)
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
    const pct = ((count / secPatents.length) * 100).toFixed(1);
    console.log(`  ${code.padEnd(8)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)`);
  }

  // Display G06F sub-code distribution
  console.log('\n' + '═'.repeat(60));
  console.log('G06F SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(60));

  const descriptions: Record<string, string> = {
    'G06F21': 'Security arrangements (general)',
    'G06F21/10': 'Protecting distributed programs/content',
    'G06F21/12': 'Copy protection, DRM',
    'G06F21/14': 'Software obfuscation',
    'G06F21/16': 'Program execution protection',
    'G06F21/30': 'User authentication',
    'G06F21/31': 'User authentication - identity',
    'G06F21/32': 'User authentication - biometric',
    'G06F21/33': 'User authentication - tickets',
    'G06F21/34': 'User authentication - external device',
    'G06F21/35': 'User authentication - challenge-response',
    'G06F21/36': 'User authentication - graphical',
    'G06F21/40': 'User authentication - remote',
    'G06F21/41': 'User authentication - SSO',
    'G06F21/42': 'User authentication - alternative channels',
    'G06F21/43': 'User authentication - mutual',
    'G06F21/44': 'Program/device authentication',
    'G06F21/45': 'Hardware authentication',
    'G06F21/50': 'Monitoring users/programs',
    'G06F21/51': 'Integrity verification',
    'G06F21/52': 'Resource monitoring',
    'G06F21/53': 'Sandboxing',
    'G06F21/54': 'Controlled environment',
    'G06F21/55': 'Malware detection',
    'G06F21/56': 'Virus scanning',
    'G06F21/57': 'Security policies',
    'G06F21/60': 'Protecting data',
    'G06F21/62': 'Access control',
    'G06F21/64': 'Data integrity',
    'G06F21/70': 'Protecting specific components',
    'G06F21/71': 'Protecting specific components - CPU',
    'G06F21/72': 'Protecting specific components - memory',
    'G06F21/73': 'Protecting specific components - bus',
    'G06F21/74': 'Protecting specific components - OS',
    'G06F21/75': 'Protecting specific components - filesystem',
    'G06F21/76': 'Protecting specific components - IO',
    'G06F21/77': 'Protecting specific components - card',
    'G06F21/78': 'Protecting specific components - portable storage',
    'G06F21/79': 'Protecting specific components - removable media',
    'G06F21/80': 'Protecting specific components - chips',
    'G06F21/81': 'Protecting specific components - TPM',
    'G06F21/82': 'Protecting specific components - peripherals',
    'G06F21/83': 'Protecting specific components - keyboard',
    'G06F21/84': 'Protecting specific components - input devices',
    'G06F21/85': 'Protecting specific components - display',
    'G06F21/86': 'Secure booting',
  };

  const sortedG06f = Array.from(g06fCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedG06f.slice(0, 25)) {
    const pct = ((count / secPatents.length) * 100).toFixed(1);
    const desc = descriptions[code] || '';
    console.log(`  ${code.padEnd(12)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Groupings analysis
  console.log('\n' + '═'.repeat(60));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(60));

  // Authentication (G06F21/30-44)
  let authTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F21\/3\d/) || code.match(/G06F21\/4[0-4]/)) {
      authTotal += count;
    }
  }
  console.log(`\n• Authentication (G06F21/30-44): ${authTotal} patents`);

  // Malware/Monitoring (G06F21/50-57)
  let malwareTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F21\/5\d/)) {
      malwareTotal += count;
    }
  }
  console.log(`• Malware/Monitoring (G06F21/50-57): ${malwareTotal} patents`);

  // Data Protection (G06F21/60-64)
  let dataProtTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F21\/6[0-4]/)) {
      dataProtTotal += count;
    }
  }
  console.log(`• Data Protection (G06F21/60-64): ${dataProtTotal} patents`);

  // Hardware Security (G06F21/70-86)
  let hwSecTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F21\/[78]\d/)) {
      hwSecTotal += count;
    }
  }
  console.log(`• Hardware Security (G06F21/70-86): ${hwSecTotal} patents`);

  // Software Protection (G06F21/10-16)
  let swProtTotal = 0;
  for (const [code, count] of sortedG06f) {
    if (code.match(/G06F21\/1[0-6]/)) {
      swProtTotal += count;
    }
  }
  console.log(`• Software Protection (G06F21/10-16): ${swProtTotal} patents`);

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(console.error);
