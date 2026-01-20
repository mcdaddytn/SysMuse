#!/usr/bin/env npx tsx
/**
 * Break Out System-Security Sector into Sub-Sectors
 *
 * Splits the system-security sector (788 patents) into more specific
 * sub-sectors based on G06F21 sub-code analysis:
 *
 * - sec-malware: Malware detection, virus scanning (G06F21/55, G06F21/56)
 * - sec-sandbox: Sandboxing, isolation, controlled execution (G06F21/53, G06F21/54)
 * - sec-policy: Security policies, integrity verification (G06F21/51, G06F21/57)
 * - sec-data: Data protection, access control (G06F21/60, G06F21/62, G06F21/64)
 * - sec-auth: User/program authentication (G06F21/30-44)
 * - sec-drm: Software protection, DRM, obfuscation (G06F21/10-16)
 * - sec-hardware: Hardware security, TPM, secure boot (G06F21/70-86)
 *
 * Usage: npx tsx scripts/breakout-system-security.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for system-security - order matters (more specific first)
const SEC_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Malware detection, virus scanning
    prefixes: ['G06F21/55', 'G06F21/56'],
    sector: 'sec-malware',
    sectorName: 'Security Malware/AV',
    description: 'Malware detection, virus scanning, threat analysis',
  },
  {
    // Sandboxing, isolation
    prefixes: ['G06F21/53', 'G06F21/54'],
    sector: 'sec-sandbox',
    sectorName: 'Security Sandbox/Isolation',
    description: 'Sandboxing, controlled execution, isolation',
  },
  {
    // Security policies, integrity
    prefixes: ['G06F21/51', 'G06F21/57'],
    sector: 'sec-policy',
    sectorName: 'Security Policy/Integrity',
    description: 'Security policies, integrity verification',
  },
  {
    // Data protection, access control
    prefixes: ['G06F21/60', 'G06F21/62', 'G06F21/64'],
    sector: 'sec-data',
    sectorName: 'Security Data Protection',
    description: 'Data protection, access control, encryption',
  },
  {
    // User/program authentication
    prefixes: ['G06F21/3', 'G06F21/4'],
    sector: 'sec-auth',
    sectorName: 'Security Authentication',
    description: 'User/program authentication, identity',
  },
  {
    // Software protection, DRM
    prefixes: ['G06F21/10', 'G06F21/12', 'G06F21/14', 'G06F21/16'],
    sector: 'sec-drm',
    sectorName: 'Security DRM/SW Protection',
    description: 'DRM, software protection, obfuscation',
  },
  {
    // Hardware security
    prefixes: ['G06F21/7', 'G06F21/8'],
    sector: 'sec-hardware',
    sectorName: 'Security Hardware/TPM',
    description: 'Hardware security, TPM, secure boot',
  },
  {
    // Monitoring (fallback for G06F21/50)
    prefixes: ['G06F21/50', 'G06F21/52'],
    sector: 'sec-monitoring',
    sectorName: 'Security Monitoring',
    description: 'User/program monitoring, resource tracking',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of SEC_SUBSECTORS) {
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
    const subsector = SEC_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        SYSTEM-SECURITY SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find system-security patents
  const secPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'system-security') {
      secPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`System-security patents: ${secPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(85));
  for (const subsector of SEC_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(16)} ${subsector.prefixes.slice(0, 3).join(', ').padEnd(28)} ${subsector.description}`);
  }
  console.log('─'.repeat(85) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of secPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as system-security (general)
      keptGeneral++;
      subSectorCounts.set('system-security', (subSectorCounts.get('system-security') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(85));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(85));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in system-security: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(85));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / secPatents.length) * 100).toFixed(1);
    const subsectorDef = SEC_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'System Security (General)';
    console.log(`  ${sector.padEnd(18)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(85));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(85));

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
    console.log(`  ${marker} ${sector.padEnd(26)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Summary
  const largeSectors = sortedOverall.filter(([_, c]) => c > 500).length;
  const goodSectors = sortedOverall.filter(([_, c]) => c >= 50 && c <= 500).length;
  const smallSectors = sortedOverall.filter(([_, c]) => c < 50).length;

  console.log(`\nSector size summary:`);
  console.log(`  🔴 Large (>500):  ${largeSectors}`);
  console.log(`  ✅ Good (50-500): ${goodSectors}`);
  console.log(`  🟡 Small (<50):   ${smallSectors}`);

  console.log('\n' + '═'.repeat(85) + '\n');
}

main().catch(console.error);
