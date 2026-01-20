#!/usr/bin/env npx tsx
/**
 * Break Out Cloud-Config Sector into Sub-Sectors
 *
 * Splits the cloud-config sector (562 patents) into more specific
 * sub-sectors based on H04L41/08 sub-code analysis:
 *
 * - cfg-automation: Configuration automation, orchestration (H04L41/0895, H04L41/0894)
 * - cfg-lifecycle: Rollback, backup/restore, versioning (H04L41/0816, H04L41/0803, H04L41/0896)
 * - cfg-templates: Templates, models, languages (H04L41/0806, H04L41/0866, H04L41/0873)
 * - cfg-deploy: Deployment, distribution (H04L41/0813, H04L41/0826)
 * - cfg-scripting: Scripting, workflows, APIs (H04L41/0853, H04L41/0856, H04L41/0863)
 * - cfg-validation: Validation, consistency, visualization (H04L41/0893, H04L41/0843, H04L41/0886)
 *
 * Usage: npx tsx scripts/breakout-cloud-config.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for cloud-config - order matters (more specific first)
const CFG_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Configuration automation, orchestration
    prefixes: ['H04L41/0895', 'H04L41/0894', 'H04L41/0897'],
    sector: 'cfg-automation',
    sectorName: 'Config Automation',
    description: 'Configuration automation, orchestration, intent-based',
  },
  {
    // Lifecycle - rollback, backup, versioning
    prefixes: ['H04L41/0816', 'H04L41/0803', 'H04L41/0896'],
    sector: 'cfg-lifecycle',
    sectorName: 'Config Lifecycle',
    description: 'Rollback, backup/restore, versioning',
  },
  {
    // Templates, models, languages
    prefixes: ['H04L41/0806', 'H04L41/0866', 'H04L41/0873', 'H04L41/0823'],
    sector: 'cfg-templates',
    sectorName: 'Config Templates/Models',
    description: 'Configuration templates, models, languages',
  },
  {
    // Scripting, workflows, APIs
    prefixes: ['H04L41/0853', 'H04L41/0856', 'H04L41/0863'],
    sector: 'cfg-scripting',
    sectorName: 'Config Scripting/APIs',
    description: 'Configuration scripting, workflows, APIs',
  },
  {
    // Deployment, distribution
    prefixes: ['H04L41/0813', 'H04L41/0826', 'H04L41/082'],
    sector: 'cfg-deploy',
    sectorName: 'Config Deployment',
    description: 'Configuration deployment, distribution, retrieval',
  },
  {
    // Validation, consistency, visualization
    prefixes: ['H04L41/0893', 'H04L41/0843', 'H04L41/0886'],
    sector: 'cfg-validation',
    sectorName: 'Config Validation',
    description: 'Configuration validation, consistency, visualization',
  },
  {
    // Topology and discovery (H04L41/04, H04L41/12)
    prefixes: ['H04L41/04', 'H04L41/12'],
    sector: 'cfg-topology',
    sectorName: 'Config Topology',
    description: 'Topology discovery, network mapping',
  },
  {
    // Service provisioning (H04L41/22)
    prefixes: ['H04L41/22'],
    sector: 'cfg-provision',
    sectorName: 'Config Provisioning',
    description: 'Service provisioning, resource allocation',
  },
  {
    // General configuration (H04L41/06)
    prefixes: ['H04L41/06'],
    sector: 'cfg-general',
    sectorName: 'Config General',
    description: 'General network configuration management',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of CFG_SUBSECTORS) {
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
    const subsector = CFG_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        CLOUD-CONFIG SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find cloud-config patents
  const configPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'cloud-config') {
      configPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Cloud-config patents: ${configPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(90));
  for (const subsector of CFG_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(16)} ${subsector.prefixes.slice(0, 3).join(', ').padEnd(35)} ${subsector.description}`);
  }
  console.log('─'.repeat(90) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of configPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as cloud-config (general)
      keptGeneral++;
      subSectorCounts.set('cloud-config', (subSectorCounts.get('cloud-config') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(90));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(90));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in cloud-config: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(90));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / configPatents.length) * 100).toFixed(1);
    const subsectorDef = CFG_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Cloud Config (General)';
    console.log(`  ${sector.padEnd(18)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(90));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(90));

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
    console.log(`  ${marker} ${sector.padEnd(28)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Summary
  const largeSectors = sortedOverall.filter(([_, c]) => c > 500).length;
  const goodSectors = sortedOverall.filter(([_, c]) => c >= 50 && c <= 500).length;
  const smallSectors = sortedOverall.filter(([_, c]) => c < 50).length;

  console.log(`\nSector size summary:`);
  console.log(`  🔴 Large (>500):  ${largeSectors}`);
  console.log(`  ✅ Good (50-500): ${goodSectors}`);
  console.log(`  🟡 Small (<50):   ${smallSectors}`);

  console.log('\n' + '═'.repeat(90) + '\n');
}

main().catch(console.error);
