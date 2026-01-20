/**
 * Download patents from missing VMware/Broadcom subsidiaries
 *
 * Identified gaps:
 * - Carbon Black, Inc. (~10-39 patents) - VMware acquisition Oct 2019
 * - Pivotal Software, Inc. (~218 patents) - VMware acquisition Aug 2019
 * - Nyansa Inc (~11 patents) - VMware acquisition Jan 2020
 *
 * Usage: npx tsx scripts/download-missing-subsidiaries.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs/promises';
import { createPatentsViewClient } from '../clients/patentsview-client.js';

const MISSING_SUBSIDIARIES = [
  {
    entity: 'Carbon Black, Inc.',
    parent: 'VMware',
    acquiredDate: '2019-10-01',
    expectedPatents: '10-39',
    technology: 'Endpoint security, EDR, threat detection'
  },
  {
    entity: 'Pivotal Software, Inc.',
    parent: 'VMware',
    acquiredDate: '2019-08-01',
    expectedPatents: '~218',
    technology: 'Cloud platform, distributed computing'
  },
  {
    entity: 'Nyansa',
    parent: 'VMware',
    acquiredDate: '2020-01-21',
    expectedPatents: '~11',
    technology: 'Network analytics, SD-WAN'
  }
];

// Also try variations of each name
const ENTITY_VARIATIONS: Record<string, string[]> = {
  'Carbon Black, Inc.': ['Carbon Black, Inc.', 'Carbon Black Inc.', 'Carbon Black'],
  'Pivotal Software, Inc.': ['Pivotal Software, Inc.', 'Pivotal Software Inc.', 'Pivotal Software'],
  'Nyansa': ['Nyansa', 'Nyansa Inc', 'Nyansa, Inc.', 'Nyansa Inc.']
};

async function downloadSubsidiaryPatents(pvClient: any, entityName: string): Promise<any[]> {
  const variations = ENTITY_VARIATIONS[entityName] || [entityName];
  const allPatents = new Map<string, any>();

  for (const variant of variations) {
    console.log(`  Searching for: "${variant}"...`);
    try {
      const result = await pvClient.searchByAssignee(variant);
      if (result.patents && result.patents.length > 0) {
        console.log(`    Found ${result.patents.length} patents`);
        for (const p of result.patents) {
          if (!allPatents.has(p.patent_id)) {
            allPatents.set(p.patent_id, p);
          }
        }
      }
    } catch (error: any) {
      console.log(`    Error: ${error.message}`);
    }
    // Rate limit delay
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  return Array.from(allPatents.values());
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     DOWNLOAD MISSING VMWARE/BROADCOM SUBSIDIARIES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const pvClient = createPatentsViewClient();
  const timestamp = new Date().toISOString().split('T')[0];
  const allSubsidiaryPatents: any[] = [];
  const breakdown: Record<string, number> = {};

  for (const sub of MISSING_SUBSIDIARIES) {
    console.log(`\n📦 ${sub.entity}`);
    console.log(`   Parent: ${sub.parent}, Expected: ${sub.expectedPatents}`);
    console.log(`   Technology: ${sub.technology}`);

    const patents = await downloadSubsidiaryPatents(pvClient, sub.entity);
    console.log(`   ✓ Total unique patents: ${patents.length}`);

    breakdown[sub.entity] = patents.length;
    allSubsidiaryPatents.push(...patents);
  }

  // De-duplicate
  const uniquePatents = new Map<string, any>();
  for (const p of allSubsidiaryPatents) {
    if (!uniquePatents.has(p.patent_id)) {
      uniquePatents.set(p.patent_id, p);
    }
  }

  const finalPatents = Array.from(uniquePatents.values());

  console.log('\n' + '═'.repeat(60));
  console.log('DOWNLOAD SUMMARY');
  console.log('═'.repeat(60));
  for (const [entity, count] of Object.entries(breakdown)) {
    console.log(`  ${entity}: ${count}`);
  }
  console.log(`  ────────────────────────────────────`);
  console.log(`  TOTAL UNIQUE: ${finalPatents.length}`);

  // Save results
  const output = {
    metadata: {
      generatedDate: new Date().toISOString(),
      purpose: 'Missing VMware/Broadcom subsidiaries download',
      entities: MISSING_SUBSIDIARIES.map(s => s.entity),
      totalPatents: finalPatents.length,
      breakdown
    },
    patents: finalPatents
  };

  const outputFile = `./output/missing-subsidiaries-patents-${timestamp}.json`;
  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved: ${outputFile}`);

  // Also save patent IDs for quick reference
  const idsFile = `./output/missing-subsidiaries-patent-ids-${timestamp}.json`;
  await fs.writeFile(idsFile, JSON.stringify(finalPatents.map(p => p.patent_id), null, 2));
  console.log(`✓ Saved: ${idsFile}`);

  console.log('\nNEXT STEPS:');
  console.log('  1. Run citation analysis: npx tsx scripts/citation-overlap-missing-subs.ts');
  console.log('  2. Merge into multi-score: npm run merge:vmware');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
