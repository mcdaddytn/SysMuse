/**
 * Download Blue Coat Patents - Incremental Addition
 *
 * Downloads patents for Blue Coat Systems (Symantec subsidiary)
 * that were missing from the original portfolio download.
 *
 * Blue Coat Systems, Inc.: 87 patents
 *
 * Usage: npx tsx scripts/download-bluecoat-patents.ts
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
import { createPatentsViewClient, Patent } from '../clients/patentsview-client.js';

dotenv.config();

const BLUECOAT_ENTITIES = [
  { name: 'Blue Coat Systems, Inc.', expectedCount: 87 },
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
    console.log(`  Page ${pageCount}: ${allPatents.length} patents total`);
  }

  console.log(`  ✓ Downloaded ${allPatents.length} patents for ${entityName}`);
  return allPatents;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        BLUE COAT PATENT INCREMENTAL DOWNLOAD');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const client = createPatentsViewClient();
  const timestamp = new Date().toISOString().split('T')[0];
  const allPatents: Patent[] = [];
  const entityBreakdown: Record<string, number> = {};

  for (const entity of BLUECOAT_ENTITIES) {
    const patents = await downloadPatentsForEntity(client, entity.name);
    allPatents.push(...patents);
    entityBreakdown[entity.name] = patents.length;
  }

  // Remove duplicates
  const uniquePatents = new Map<string, Patent>();
  for (const patent of allPatents) {
    uniquePatents.set(patent.patent_id, patent);
  }
  const deduped = Array.from(uniquePatents.values());

  console.log('\n' + '═'.repeat(60));
  console.log('DOWNLOAD SUMMARY');
  console.log('═'.repeat(60));
  for (const [entity, count] of Object.entries(entityBreakdown)) {
    console.log(`  ${entity}: ${count} patents`);
  }
  console.log(`  Total: ${deduped.length}`);

  // Save results
  const output = {
    metadata: {
      generatedDate: new Date().toISOString(),
      purpose: 'Blue Coat incremental patent download',
      entities: BLUECOAT_ENTITIES.map(e => e.name),
      totalPatents: deduped.length,
      breakdown: entityBreakdown,
    },
    patents: deduped,
  };

  const outputPath = `./output/bluecoat-patents-${timestamp}.json`;
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved to: ${outputPath}`);

  const patentIds = deduped.map(p => p.patent_id);
  await fs.writeFile(
    `./output/bluecoat-patent-ids-${timestamp}.json`,
    JSON.stringify(patentIds, null, 2)
  );
  console.log(`✓ Patent ID list: ./output/bluecoat-patent-ids-${timestamp}.json`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('NEXT: Run citation analysis or merge with VMware results');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
