#!/usr/bin/env npx tsx
/**
 * Analyze Sector Sizes and Distribution
 *
 * Identifies:
 * - Large sectors (>500) that need breakout
 * - Small sectors that might need aggregation
 * - "General" patents that could be classified via CPC
 *
 * Usage: npx tsx scripts/analyze-sector-sizes.ts
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
  console.log('            SECTOR SIZE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load sector assignments
  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;
  console.log(`Total patents: ${totalPatents.toLocaleString()}\n`);

  // Count by sector
  const sectorCounts = new Map<string, number>();
  const sectorPatents = new Map<string, string[]>();

  for (const [patentId, data] of Object.entries(assignments)) {
    const sector = data.sector || 'general';
    sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
    if (!sectorPatents.has(sector)) {
      sectorPatents.set(sector, []);
    }
    sectorPatents.get(sector)!.push(patentId);
  }

  // Sort by count descending
  const sortedSectors = Array.from(sectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  // Categorize
  const largeSectors: Array<[string, number]> = [];
  const goodSizeSectors: Array<[string, number]> = [];
  const smallSectors: Array<[string, number]> = [];

  for (const [sector, count] of sortedSectors) {
    if (count > 500) {
      largeSectors.push([sector, count]);
    } else if (count >= 50) {
      goodSizeSectors.push([sector, count]);
    } else {
      smallSectors.push([sector, count]);
    }
  }

  // Report large sectors
  console.log('🔴 LARGE SECTORS (>500) - Consider breakout into sub-sectors:');
  console.log('─'.repeat(60));
  for (const [sector, count] of largeSectors) {
    const pct = ((count / totalPatents) * 100).toFixed(1);
    console.log(`  ${sector.padEnd(25)} ${count.toLocaleString().padStart(7)}  (${pct}%)`);
  }

  // Report good size sectors
  console.log('\n✅ GOOD SIZE SECTORS (50-500):');
  console.log('─'.repeat(60));
  for (const [sector, count] of goodSizeSectors) {
    const pct = ((count / totalPatents) * 100).toFixed(1);
    console.log(`  ${sector.padEnd(25)} ${count.toLocaleString().padStart(7)}  (${pct}%)`);
  }

  // Report small sectors
  console.log('\n🟡 SMALL SECTORS (<50) - May be OK if meaningful:');
  console.log('─'.repeat(60));
  for (const [sector, count] of smallSectors) {
    console.log(`  ${sector.padEnd(25)} ${count.toLocaleString().padStart(7)}`);
  }

  // Analyze "general" patents
  console.log('\n' + '═'.repeat(60));
  console.log('ANALYSIS OF "GENERAL" PATENTS');
  console.log('═'.repeat(60));

  const generalPatentIds = sectorPatents.get('general') || [];
  console.log(`\nTotal in "general": ${generalPatentIds.length.toLocaleString()}`);

  // Check how many have CPC codes
  let withCpc = 0;
  let withoutCpc = 0;
  const cpcDistribution = new Map<string, number>();

  for (const patentId of generalPatentIds) {
    const data = assignments[patentId];
    if (data.cpc_codes && data.cpc_codes.length > 0) {
      withCpc++;
      // Get the CPC prefix (first 4-5 chars)
      const cpc = data.cpc_codes[0];
      const prefix = cpc.substring(0, 4);
      cpcDistribution.set(prefix, (cpcDistribution.get(prefix) || 0) + 1);
    } else {
      withoutCpc++;
    }
  }

  console.log(`  With CPC codes: ${withCpc.toLocaleString()}`);
  console.log(`  Without CPC codes: ${withoutCpc.toLocaleString()}`);

  if (cpcDistribution.size > 0) {
    console.log('\n  Top CPC prefixes in "general" (potential new sectors):');
    const sortedCpc = Array.from(cpcDistribution.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    for (const [prefix, count] of sortedCpc) {
      console.log(`    ${prefix}: ${count}`);
    }
  }

  // Analyze by patent age
  console.log('\n  Patent age distribution in "general":');
  const patentIdNums = generalPatentIds.map(id => parseInt(id)).filter(n => !isNaN(n));
  const old = patentIdNums.filter(n => n < 8000000).length;
  const mid = patentIdNums.filter(n => n >= 8000000 && n < 10000000).length;
  const recent = patentIdNums.filter(n => n >= 10000000).length;

  console.log(`    Old (pre-8M, ~2010): ${old.toLocaleString()}`);
  console.log(`    Mid (8M-10M, 2010-2018): ${mid.toLocaleString()}`);
  console.log(`    Recent (10M+, 2018+): ${recent.toLocaleString()}`);

  // Recommendations
  console.log('\n' + '═'.repeat(60));
  console.log('RECOMMENDATIONS');
  console.log('═'.repeat(60));

  console.log('\n📋 Large sectors needing breakout:');
  for (const [sector, count] of largeSectors) {
    if (sector === 'general') {
      console.log(`  • general (${count}): Apply CPC mapping + term-based matching`);
    } else if (sector === 'computing') {
      console.log(`  • computing (${count}): Break into sub-sectors (database, OS, middleware, etc.)`);
    } else if (sector === 'virtualization') {
      console.log(`  • virtualization (${count}): Consider VM vs container vs hypervisor splits`);
    } else if (sector === 'network-security') {
      console.log(`  • network-security (${count}): Consider firewall vs auth vs threat-detection splits`);
    } else if (sector === 'cloud-orchestration') {
      console.log(`  • cloud-orchestration (${count}): Consider k8s vs config-mgmt vs monitoring splits`);
    } else if (sector === 'sdn-networking') {
      console.log(`  • sdn-networking (${count}): May be OK - coherent technology area`);
    } else {
      console.log(`  • ${sector} (${count}): Analyze for sub-sector opportunities`);
    }
  }

  console.log('\n📋 Small sectors to review:');
  for (const [sector, count] of smallSectors) {
    console.log(`  • ${sector} (${count}): ${count < 10 ? 'Very small - may aggregate or expand' : 'OK if meaningful group'}`);
  }

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(console.error);
