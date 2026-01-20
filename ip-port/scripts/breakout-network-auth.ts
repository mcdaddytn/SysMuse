#!/usr/bin/env npx tsx
/**
 * Break Out Network-Auth Sector into Sub-Sectors
 *
 * Splits the network-auth sector (1,373 patents) into more specific
 * sub-sectors based on H04L63 sub-code analysis:
 *
 * - auth-identity: Authentication, SSO, tokens, MFA (H04L63/08)
 * - auth-firewall: Firewalls, filtering, packet inspection (H04L63/10, H04L63/02)
 * - auth-ids: Intrusion detection/prevention, threat detection (H04L63/14)
 * - auth-access: Access control, policy management, RBAC (H04L63/16, H04L63/20)
 * - auth-vpn: VPN, tunneling, secure channels (H04L63/145)
 * - auth-network: Network segmentation, DMZ (H04L63/04, H04L63/06)
 *
 * Usage: npx tsx scripts/breakout-network-auth.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for network-auth based on H04L63 sub-codes
const AUTH_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Identity and authentication
    prefixes: ['H04L63/08'],
    sector: 'auth-identity',
    sectorName: 'Identity/Authentication',
    description: 'SSO, tokens, MFA, biometrics, credentials',
  },
  {
    // Intrusion detection/prevention (priority over firewall for H04L63/14)
    prefixes: ['H04L63/14'],
    sector: 'auth-ids',
    sectorName: 'Intrusion Detection/Prevention',
    description: 'IDS, IPS, threat detection, signature/behavior analysis',
  },
  {
    // Firewalls and filtering
    prefixes: ['H04L63/10', 'H04L63/02'],
    sector: 'auth-firewall',
    sectorName: 'Firewall/Filtering',
    description: 'Firewalls, packet filtering, DPI, traffic analysis',
  },
  {
    // Access control and policy
    prefixes: ['H04L63/20', 'H04L63/16'],
    sector: 'auth-access',
    sectorName: 'Access Control/Policy',
    description: 'RBAC, policy management, access enforcement',
  },
  {
    // Network segmentation
    prefixes: ['H04L63/06', 'H04L63/04'],
    sector: 'auth-network',
    sectorName: 'Network Segmentation',
    description: 'DMZ, network partitioning, secure zones',
  },
  {
    // Attack protection
    prefixes: ['H04L63/12', 'H04L63/18'],
    sector: 'auth-threat',
    sectorName: 'Threat Protection',
    description: 'DDoS protection, attack mitigation, malware defense',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of AUTH_SUBSECTORS) {
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
    const subsector = AUTH_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        NETWORK-AUTH SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find network-auth patents
  const authPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'network-auth') {
      authPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Network-auth patents: ${authPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(75));
  for (const subsector of AUTH_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(16)} ${subsector.prefixes.join(', ').padEnd(22)} ${subsector.description}`);
  }
  console.log('─'.repeat(75) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of authPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as network-auth (general)
      keptGeneral++;
      subSectorCounts.set('network-auth', (subSectorCounts.get('network-auth') || 0) + 1);
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
  console.log(`Kept in network-auth: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(75));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / authPatents.length) * 100).toFixed(1);
    const subsectorDef = AUTH_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Network Auth (General)';
    console.log(`  ${sector.padEnd(18)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
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
