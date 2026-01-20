#!/usr/bin/env npx tsx
/**
 * Analyze Network-Auth Sector H04L63 Sub-codes
 *
 * H04L63 has many sub-categories:
 * - H04L63/02: Network architectures/policies
 * - H04L63/04: Security in specific network types
 * - H04L63/06: Network partitioning (firewalls, DMZ)
 * - H04L63/08: Network authentication
 * - H04L63/10: Network protection systems
 * - H04L63/12: Intrusion detection
 * - H04L63/14: Data protection (encryption in transit)
 * - H04L63/16: Policy implementation
 * - H04L63/18: Protection against attacks
 * - H04L63/20: Unauthorized access protection
 *
 * Usage: npx tsx scripts/analyze-network-auth-detail.ts
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
  console.log('        NETWORK-AUTH H04L63 DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find network-auth patents
  const authPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'network-auth') {
      authPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`Network-auth patents: ${authPatents.length.toLocaleString()}\n`);

  // Count H04L63 sub-codes specifically
  const h04l63Counts = new Map<string, number>();

  for (const { cpcCodes } of authPatents) {
    const seen = new Set<string>();
    for (const cpc of cpcCodes) {
      if (cpc.startsWith('H04L63/')) {
        // Extract the sub-code (e.g., H04L63/08, H04L63/12)
        const match = cpc.match(/H04L63\/(\d+)/);
        if (match) {
          const subCode = `H04L63/${match[1]}`;
          if (!seen.has(subCode)) {
            h04l63Counts.set(subCode, (h04l63Counts.get(subCode) || 0) + 1);
            seen.add(subCode);
          }
        }
      }
    }
  }

  // Sort by count
  const sorted = Array.from(h04l63Counts.entries())
    .sort((a, b) => b[1] - a[1]);

  // H04L63 sub-code descriptions
  const descriptions: Record<string, string> = {
    'H04L63/02': 'Network architectures/policies',
    'H04L63/04': 'Security in specific network types',
    'H04L63/06': 'Network partitioning (firewalls, DMZ)',
    'H04L63/08': 'Network authentication',
    'H04L63/0807': 'Challenge-response authentication',
    'H04L63/0815': 'MAC address authentication',
    'H04L63/0823': 'Single sign-on (SSO)',
    'H04L63/083': 'Entity authentication',
    'H04L63/0838': 'Access credentials',
    'H04L63/0846': 'Biometric authentication',
    'H04L63/0853': 'Token authentication',
    'H04L63/0861': 'Network admission control',
    'H04L63/0869': 'Multi-factor authentication',
    'H04L63/0876': 'Authentication protocols',
    'H04L63/0884': 'Certificate authentication',
    'H04L63/10': 'Network protection systems',
    'H04L63/101': 'Filtering',
    'H04L63/102': 'Firewall rules',
    'H04L63/104': 'Traffic filtering',
    'H04L63/105': 'Deep packet inspection',
    'H04L63/107': 'Application layer filtering',
    'H04L63/12': 'Intrusion detection',
    'H04L63/1408': 'Anomaly detection',
    'H04L63/1416': 'Signature detection',
    'H04L63/1425': 'Pattern matching',
    'H04L63/1433': 'Intrusion prevention',
    'H04L63/1441': 'Behavior analysis',
    'H04L63/14': 'Data protection (encryption in transit)',
    'H04L63/1408': 'Transport encryption',
    'H04L63/145': 'VPN tunneling',
    'H04L63/16': 'Policy implementation',
    'H04L63/162': 'Distributed policy',
    'H04L63/164': 'Policy enforcement',
    'H04L63/166': 'Policy management',
    'H04L63/168': 'RBAC/Access control',
    'H04L63/18': 'Protection against attacks',
    'H04L63/1408': 'DDoS protection',
    'H04L63/20': 'Unauthorized access protection',
  };

  console.log('H04L63 SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));

  for (const [code, count] of sorted) {
    const pct = ((count / authPatents.length) * 100).toFixed(1);
    const desc = descriptions[code] || '';
    console.log(`  ${code.padEnd(14)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Group into potential sub-sectors
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(70));

  // Authentication (H04L63/08)
  let authTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('H04L63/08')) {
      authTotal += count;
    }
  }
  console.log(`\n• Authentication (H04L63/08x): ${authTotal} patents`);

  // Firewalls/Filtering (H04L63/02, H04L63/10)
  let firewallTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('H04L63/02') || code.startsWith('H04L63/10')) {
      firewallTotal += count;
    }
  }
  console.log(`• Firewalls/Filtering (H04L63/02, H04L63/10): ${firewallTotal} patents`);

  // Intrusion Detection (H04L63/14 for IDS context)
  let idsTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('H04L63/14')) {
      idsTotal += count;
    }
  }
  console.log(`• Intrusion Detection/Prevention (H04L63/14): ${idsTotal} patents`);

  // Policy/Access Control (H04L63/20)
  let policyTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('H04L63/20') || code.startsWith('H04L63/16')) {
      policyTotal += count;
    }
  }
  console.log(`• Policy/Access Control (H04L63/16, H04L63/20): ${policyTotal} patents`);

  // Attack Protection (H04L63/12, H04L63/18)
  let attackTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('H04L63/12') || code.startsWith('H04L63/18')) {
      attackTotal += count;
    }
  }
  console.log(`• Attack Protection/Detection (H04L63/12, H04L63/18): ${attackTotal} patents`);

  // Network partitioning (H04L63/06)
  let partitionTotal = 0;
  for (const [code, count] of sorted) {
    if (code.startsWith('H04L63/06') || code.startsWith('H04L63/04')) {
      partitionTotal += count;
    }
  }
  console.log(`• Network Segmentation (H04L63/04, H04L63/06): ${partitionTotal} patents`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
