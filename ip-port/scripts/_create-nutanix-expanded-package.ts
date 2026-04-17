/**
 * Create Nutanix Expanded V3 Discovery Package
 *
 * Expands the original 87-patent package with 102 new Nutanix-relevant patents
 * discovered in recent sector packages. Creates focus area, runs infringement
 * scoring, LLM assessments, and exports full comparative package.
 *
 * Usage:
 *   npx tsx scripts/_create-nutanix-expanded-package.ts                  # Full run
 *   npx tsx scripts/_create-nutanix-expanded-package.ts --skip-scoring   # Skip infringement, just LLM + export
 *   npx tsx scripts/_create-nutanix-expanded-package.ts --export-only    # Export from existing results
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const FOCUS_AREA_NAME = 'Nutanix V3 Expanded Discovery';
const V3_SNAPSHOT_ID = 'cmo0og0u400018ct6s6322wuc'; // Active Broadcom V3 Litigation Discovery

const NUTANIX_PRODUCTS = [
  { company: 'nutanix', product: 'nutanix-ahv', label: 'Nutanix AHV' },
  { company: 'nutanix', product: 'nutanix-cloud-infrastructure-nci', label: 'NCI' },
  { company: 'nutanix', product: 'flow-network-security', label: 'Flow Network Security' },
  { company: 'nutanix', product: 'flow-virtual-networking', label: 'Flow Virtual Networking' },
  { company: 'nutanix', product: 'nutanix-prism-central', label: 'Prism Central' },
];

// Broadcom affiliates to exclude from targets
const BROADCOM_AFFILIATES = [
  'Broadcom', 'VMware', 'CA Technologies', 'Symantec', 'Brocade',
  'LSI', 'Emulex', 'Avamar', 'Carbon Black', 'VeloCloud',
  'Nicira', 'Pivotal', 'Heptio', 'Bitnami', 'SaltStack',
  'Nyansa', 'Lastline', 'Mesh7', 'Uhana', 'Datrium',
];

async function main() {
  const args = process.argv.slice(2);
  const skipScoring = args.includes('--skip-scoring');
  const exportOnly = args.includes('--export-only');

  // Load the pool
  const pool = JSON.parse(fs.readFileSync('output/nutanix-expanded-pool.json', 'utf-8'));
  const existingIds: string[] = pool.existing_ids;
  const newIds: string[] = pool.new_ids;
  const allIds: string[] = [...existingIds, ...newIds];

  console.log(`\n=== Nutanix Expanded V3 Discovery Package ===`);
  console.log(`Existing: ${existingIds.length}, New: ${newIds.length}, Total: ${allIds.length}\n`);

  // --- Step 1: Get V3 scores for all patents ---
  console.log('--- Step 1: Loading V3 Litigation Discovery Scores ---');
  const v3Entries = await prisma.patentScoreEntry.findMany({
    where: { snapshotId: V3_SNAPSHOT_ID, patentId: { in: allIds } },
    orderBy: { score: 'desc' },
  });
  const v3Map = new Map(v3Entries.map(e => [e.patentId, e.score]));
  console.log(`  Loaded ${v3Map.size} V3 scores`);

  // Get patent metadata
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: allIds } },
    select: {
      patentId: true, title: true, assignee: true,
      primarySector: true, primarySubSectorName: true,
    },
  });
  const patentMap = new Map(patents.map(p => [p.patentId, p]));

  // Print comparative ranking
  console.log('\n--- V3 Score Rankings (Top 40) ---');
  const ranked = allIds
    .map(id => ({
      id,
      v3: v3Map.get(id) || 0,
      isNew: newIds.includes(id),
      title: (patentMap.get(id)?.title || '').substring(0, 50),
      sector: patentMap.get(id)?.primarySector || '',
    }))
    .sort((a, b) => b.v3 - a.v3);

  console.log(`${'Rank'.padStart(4)} ${'Patent'.padEnd(12)} ${'V3'.padStart(7)} ${'Status'.padEnd(10)} ${'Sector'.padEnd(25)} Title`);
  for (let i = 0; i < Math.min(40, ranked.length); i++) {
    const r = ranked[i];
    const status = r.isNew ? '*** NEW' : 'existing';
    console.log(`${(i+1).toString().padStart(4)} US${r.id.padEnd(10)} ${r.v3.toFixed(2).padStart(7)} ${status.padEnd(10)} ${r.sector.padEnd(25)} ${r.title}`);
  }

  // Summary stats
  const newInTop50 = ranked.slice(0, 50).filter(r => r.isNew).length;
  const newInTop100 = ranked.slice(0, 100).filter(r => r.isNew).length;
  const newV3Scores = ranked.filter(r => r.isNew).map(r => r.v3);
  const existingV3Scores = ranked.filter(r => !r.isNew).map(r => r.v3);

  console.log(`\n--- Summary ---`);
  console.log(`New patents in top 50: ${newInTop50}`);
  console.log(`New patents in top 100: ${newInTop100}`);
  console.log(`New V3 range: ${Math.min(...newV3Scores).toFixed(1)} - ${Math.max(...newV3Scores).toFixed(1)} (median: ${newV3Scores.sort((a,b) => a-b)[Math.floor(newV3Scores.length/2)].toFixed(1)})`);
  console.log(`Existing V3 range: ${Math.min(...existingV3Scores).toFixed(1)} - ${Math.max(...existingV3Scores).toFixed(1)} (median: ${existingV3Scores.sort((a,b) => a-b)[Math.floor(existingV3Scores.length/2)].toFixed(1)})`);

  // --- Step 2: Create or find focus area ---
  console.log('\n--- Step 2: Focus Area ---');
  let focusArea = await prisma.focusArea.findFirst({
    where: { name: FOCUS_AREA_NAME },
  });
  if (!focusArea) {
    focusArea = await prisma.focusArea.create({
      data: {
        name: FOCUS_AREA_NAME,
        description: `Expanded Nutanix assertion package: ${existingIds.length} existing + ${newIds.length} new patents from sector discovery. V3 Litigation Discovery scoring (low citation weight).`,
        owner: { connect: { id: 'demo-user-1' } },
      },
    });
    console.log(`  Created: ${focusArea.name} (${focusArea.id})`);

    // Add patents
    for (const pid of allIds) {
      await prisma.focusAreaPatent.create({
        data: { focusAreaId: focusArea.id, patentId: pid },
      }).catch(() => {}); // skip dupes
    }
    console.log(`  Added ${allIds.length} patents`);
  } else {
    console.log(`  Found existing: ${focusArea.name} (${focusArea.id})`);
    const existing = await prisma.focusAreaPatent.count({ where: { focusAreaId: focusArea.id } });
    console.log(`  Has ${existing} patents`);
  }

  if (exportOnly) {
    console.log('\n--export-only: Skipping scoring and LLM. Run export separately.');
    await prisma.$disconnect();
    return;
  }

  // --- Step 3: Build infringement target CSV ---
  if (!skipScoring) {
    console.log('\n--- Step 3: Building Infringement Targets ---');
    const targetFile = 'output/nutanix-expanded-infringement-targets.csv';
    const lines = ['patent_id,company_slug,product_slug'];
    // Only score NEW patents (existing already have scores)
    for (const pid of newIds) {
      for (const prod of NUTANIX_PRODUCTS) {
        lines.push(`${pid},${prod.company},${prod.product}`);
      }
    }
    fs.writeFileSync(targetFile, lines.join('\n'));
    console.log(`  Wrote ${newIds.length * NUTANIX_PRODUCTS.length} pairs to ${targetFile}`);
    console.log(`  Run: npx tsx scripts/run-infringement-scoring.ts --targets=${targetFile}`);
  }

  // Print full ranking to file
  const rankingFile = 'output/nutanix-expanded-v3-ranking.csv';
  const csvLines = ['rank,patent_id,v3_score,status,sector,title'];
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const title = (patentMap.get(r.id)?.title || '').replace(/,/g, ';');
    csvLines.push(`${i+1},${r.id},${r.v3.toFixed(2)},${r.isNew ? 'NEW' : 'EXISTING'},${r.sector},${title}`);
  }
  fs.writeFileSync(rankingFile, csvLines.join('\n'));
  console.log(`\nFull ranking written to ${rankingFile}`);

  await prisma.$disconnect();
}

main().catch(console.error);
