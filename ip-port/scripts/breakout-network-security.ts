#!/usr/bin/env npx tsx
/**
 * Break Out Network-Security Sector into Sub-Sectors
 *
 * Splits the large network-security sector (5,255 patents) into more
 * specific sub-sectors based on CPC code analysis:
 *
 * - network-auth: Authentication, access control, firewalls (H04L63)
 * - cryptography: Encryption, key management, signatures (H04L9)
 * - network-protocols: Client-server, middleware, services (H04L67, H04L65, H04L69)
 * - network-infrastructure: LANs, switching, addressing (H04L12, H04L61)
 * - system-security: Host security, access control (G06F21)
 * - network-security: Remaining general network security
 *
 * Usage: npx tsx scripts/breakout-network-security.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping based on CPC analysis
// Order matters - more specific prefixes should come first
const NETWORK_SECURITY_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Cryptography - encryption, key exchange, digital signatures
    prefixes: ['H04L9'],
    sector: 'cryptography',
    sectorName: 'Cryptography/Encryption',
    description: 'Encryption algorithms, key management, digital signatures, secure protocols',
  },
  {
    // Network authentication & access control - firewalls, IDS, auth
    prefixes: ['H04L63'],
    sector: 'network-auth',
    sectorName: 'Network Auth/Firewalls',
    description: 'Authentication, firewalls, intrusion detection, access control',
  },
  {
    // System/host security - OS security, secure boot, DRM
    prefixes: ['G06F21'],
    sector: 'system-security',
    sectorName: 'System/Host Security',
    description: 'Access control, secure boot, malware protection, DRM',
  },
  {
    // Network protocols - client-server, middleware, application protocols
    prefixes: ['H04L67', 'H04L65', 'H04L69'],
    sector: 'network-protocols',
    sectorName: 'Network Protocols',
    description: 'Client-server, peer-to-peer, streaming, protocol layers',
  },
  {
    // Network infrastructure - LANs, addressing, switching basics
    prefixes: ['H04L12', 'H04L61'],
    sector: 'network-infrastructure',
    sectorName: 'Network Infrastructure',
    description: 'LANs, buses, network addressing, DHCP, DNS',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of NETWORK_SECURITY_SUBSECTORS) {
      for (const prefix of subsector.prefixes) {
        if (cpc.startsWith(prefix)) {
          const key = subsector.sector;
          matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
          break; // Only count once per CPC code
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
    const subsector = NETWORK_SECURITY_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        NETWORK-SECURITY SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load sector assignments
  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find network-security patents
  const networkSecurityPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'network-security') {
      networkSecurityPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Network-security patents: ${networkSecurityPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(70));
  for (const subsector of NETWORK_SECURITY_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(22)} ${subsector.prefixes.join(', ').padEnd(20)} ${subsector.description}`);
  }
  console.log('─'.repeat(70) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of networkSecurityPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as network-security (general)
      keptGeneral++;
      subSectorCounts.set('network-security', (subSectorCounts.get('network-security') || 0) + 1);
    }
  }

  // Save updated assignments
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(70));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(70));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in network-security: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(70));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / networkSecurityPatents.length) * 100).toFixed(1);
    const subsectorDef = NETWORK_SECURITY_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Network/Security (General)';
    console.log(`  ${sector.padEnd(22)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall sector distribution now
  console.log('\n' + '═'.repeat(70));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(70));

  const overallCounts = new Map<string, number>();
  for (const data of Object.values(assignments)) {
    const sector = data.sector || 'general';
    overallCounts.set(sector, (overallCounts.get(sector) || 0) + 1);
  }

  const sortedOverall = Array.from(overallCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  // Show top sectors
  console.log('\nTop sectors after breakout:');
  for (const [sector, count] of sortedOverall.slice(0, 15)) {
    const pct = ((count / totalPatents) * 100).toFixed(1);
    const marker = count > 500 ? '🔴' : count >= 50 ? '✅' : '🟡';
    console.log(`  ${marker} ${sector.padEnd(22)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Count sectors by size
  const largeSectors = sortedOverall.filter(([_, c]) => c > 500).length;
  const goodSectors = sortedOverall.filter(([_, c]) => c >= 50 && c <= 500).length;
  const smallSectors = sortedOverall.filter(([_, c]) => c < 50).length;

  console.log(`\nSector size summary:`);
  console.log(`  🔴 Large (>500):  ${largeSectors}`);
  console.log(`  ✅ Good (50-500): ${goodSectors}`);
  console.log(`  🟡 Small (<50):   ${smallSectors}`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
