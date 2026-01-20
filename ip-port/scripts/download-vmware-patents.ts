/**
 * Download VMware Patents - Incremental Addition
 *
 * Downloads patents for VMware-related entities that were missing from
 * the original portfolio download due to incorrect assignee name variants.
 *
 * Entities to download:
 * - VMware LLC (5,449 patents)
 * - Nicira, Inc. (1,029 patents)
 * - Avi Networks (17 patents) - already configured but verify
 * - Lastline, Inc. (3 patents) - already configured but verify
 *
 * Usage: npx tsx scripts/download-vmware-patents.ts
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
import { createPatentsViewClient, Patent } from '../clients/patentsview-client.js';

dotenv.config();

// VMware-related entities to download
const VMWARE_ENTITIES = [
  { name: 'VMware LLC', expectedCount: 5449 },
  { name: 'Nicira, Inc.', expectedCount: 1029 },
  { name: 'Avi Networks', expectedCount: 17 },
  { name: 'Lastline, Inc.', expectedCount: 3 },
];

async function downloadPatentsForEntity(client: ReturnType<typeof createPatentsViewClient>, entityName: string): Promise<Patent[]> {
  console.log(`\nDownloading patents for: ${entityName}`);

  const allPatents: Patent[] = [];
  let pageCount = 0;

  const fields = [
    'patent_id',
    'patent_title',
    'patent_date',
    'patent_abstract',
    'patent_type',
    'patent_num_times_cited_by_us_patents',
    'patent_num_us_patents_cited',
    'assignees',
    'cpc_current',
    'inventors',
  ];

  for await (const page of client.searchPaginated(
    {
      query: { 'assignees.assignee_organization': entityName },
      fields,
      sort: [{ patent_date: 'desc' }],
    },
    1000
  )) {
    pageCount++;
    allPatents.push(...page);

    if (pageCount % 2 === 0 || page.length < 1000) {
      console.log(`  Page ${pageCount}: ${allPatents.length} patents total`);
    }
  }

  console.log(`  ✓ Downloaded ${allPatents.length} patents for ${entityName}`);
  return allPatents;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VMWARE PATENT INCREMENTAL DOWNLOAD');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const client = createPatentsViewClient();
  const timestamp = new Date().toISOString().split('T')[0];
  const allVmwarePatents: Patent[] = [];
  const entityBreakdown: Record<string, number> = {};

  // Download patents for each entity
  for (const entity of VMWARE_ENTITIES) {
    const patents = await downloadPatentsForEntity(client, entity.name);
    allVmwarePatents.push(...patents);
    entityBreakdown[entity.name] = patents.length;

    if (Math.abs(patents.length - entity.expectedCount) > 50) {
      console.log(`  ⚠ Note: Expected ~${entity.expectedCount}, got ${patents.length}`);
    }
  }

  // Remove any duplicates (unlikely but possible)
  const uniquePatents = new Map<string, Patent>();
  for (const patent of allVmwarePatents) {
    uniquePatents.set(patent.patent_id, patent);
  }

  const deduped = Array.from(uniquePatents.values());

  console.log('\n' + '═'.repeat(60));
  console.log('DOWNLOAD SUMMARY');
  console.log('═'.repeat(60));

  for (const [entity, count] of Object.entries(entityBreakdown)) {
    console.log(`  ${entity}: ${count.toLocaleString()} patents`);
  }
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Total (before dedup): ${allVmwarePatents.length.toLocaleString()}`);
  console.log(`  Total (after dedup): ${deduped.length.toLocaleString()}`);

  // Save results
  const output = {
    metadata: {
      generatedDate: new Date().toISOString(),
      purpose: 'VMware incremental patent download',
      entities: VMWARE_ENTITIES.map(e => e.name),
      totalPatents: deduped.length,
      breakdown: entityBreakdown,
    },
    patents: deduped,
  };

  const outputPath = `./output/vmware-patents-${timestamp}.json`;
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved to: ${outputPath}`);

  // Also save a simple list for citation analysis
  const patentIds = deduped.map(p => p.patent_id);
  await fs.writeFile(
    `./output/vmware-patent-ids-${timestamp}.json`,
    JSON.stringify(patentIds, null, 2)
  );
  console.log(`✓ Patent ID list: ./output/vmware-patent-ids-${timestamp}.json`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('NEXT STEP: Run citation overlap analysis');
  console.log('  npm run analyze:vmware:citations');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
