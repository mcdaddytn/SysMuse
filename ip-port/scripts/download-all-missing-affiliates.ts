/**
 * Download ALL missing Broadcom/VMware affiliate patents
 *
 * This script handles case-sensitivity issues with PatentsView API
 * and downloads patents from all identified missing subsidiaries.
 *
 * Confirmed missing:
 * - PIVOTAL SOFTWARE, INC. (343 patents) - VMware subsidiary
 * - Carbon Black, Inc. (21 patents) - VMware subsidiary
 * - NYANSA (7 patents) - VMware subsidiary
 * - Blue Coat Systems, Inc. (87 patents - downloaded, not merged)
 *
 * NOT in Broadcom portfolio (confirmed):
 * - LifeLock - stayed with consumer division (NortonLifeLock/Gen Digital)
 *
 * Usage: npx tsx scripts/download-all-missing-affiliates.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs/promises';

const API_KEY = process.env.PATENTSVIEW_API_KEY;
const API_URL = 'https://search.patentsview.org/api/v1/patent/';

interface AffiliateConfig {
  name: string;
  searchTerms: string[];  // Different case variations to search
  parent: string;
  expectedCount: string;
  technology: string;
}

const MISSING_AFFILIATES: AffiliateConfig[] = [
  {
    name: 'Pivotal Software',
    searchTerms: ['PIVOTAL SOFTWARE', 'Pivotal Software'],
    parent: 'VMware',
    expectedCount: '~343',
    technology: 'Cloud platform, Kubernetes, Spring Framework'
  },
  {
    name: 'Carbon Black',
    searchTerms: ['Carbon Black'],
    parent: 'VMware',
    expectedCount: '~21',
    technology: 'Endpoint security, EDR, threat detection'
  },
  {
    name: 'Nyansa',
    searchTerms: ['NYANSA', 'Nyansa'],
    parent: 'VMware',
    expectedCount: '~7',
    technology: 'Network analytics, AI-driven insights'
  }
];

async function searchPatents(searchTerm: string): Promise<any[]> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY || ''
    },
    body: JSON.stringify({
      q: { _contains: { 'assignees.assignee_organization': searchTerm } },
      o: { size: 1000 },
      f: [
        'patent_id',
        'patent_title',
        'patent_date',
        'patent_abstract',
        'patent_num_times_cited_by_us_patents',
        'patent_num_us_patents_cited',
        'assignees',
        'inventors',
        'cpc_current'
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.patents || [];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     DOWNLOAD ALL MISSING BROADCOM/VMWARE AFFILIATES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (!API_KEY) {
    console.error('Error: PATENTSVIEW_API_KEY not set');
    process.exit(1);
  }

  const timestamp = new Date().toISOString().split('T')[0];
  const allPatents = new Map<string, any>();
  const breakdown: Record<string, number> = {};

  for (const affiliate of MISSING_AFFILIATES) {
    console.log(`\n📦 ${affiliate.name}`);
    console.log(`   Parent: ${affiliate.parent}`);
    console.log(`   Expected: ${affiliate.expectedCount}`);
    console.log(`   Technology: ${affiliate.technology}`);

    const affiliatePatents = new Map<string, any>();

    for (const term of affiliate.searchTerms) {
      console.log(`   Searching: "${term}"...`);
      try {
        const patents = await searchPatents(term);
        console.log(`   → Found: ${patents.length}`);

        for (const p of patents) {
          if (!affiliatePatents.has(p.patent_id)) {
            affiliatePatents.set(p.patent_id, p);
          }
        }
      } catch (error: any) {
        console.log(`   → Error: ${error.message}`);
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    const count = affiliatePatents.size;
    breakdown[affiliate.name] = count;
    console.log(`   ✓ Total unique: ${count}`);

    // Add to master list
    for (const [id, patent] of affiliatePatents) {
      if (!allPatents.has(id)) {
        allPatents.set(id, patent);
      }
    }
  }

  const finalPatents = Array.from(allPatents.values());

  console.log('\n' + '═'.repeat(60));
  console.log('DOWNLOAD SUMMARY');
  console.log('═'.repeat(60));

  for (const [name, count] of Object.entries(breakdown)) {
    console.log(`  ${name}: ${count}`);
  }
  console.log(`  ────────────────────────────────────`);
  console.log(`  TOTAL UNIQUE PATENTS: ${finalPatents.length}`);

  // Also check Blue Coat status
  console.log('\n📌 Blue Coat Status:');
  try {
    const bluecoatFile = await fs.readFile('./output/bluecoat-patents-2026-01-20.json', 'utf-8');
    const bluecoatData = JSON.parse(bluecoatFile);
    console.log(`   Already downloaded: ${bluecoatData.patents?.length || 0} patents`);
    console.log(`   Status: Needs to be merged into multi-score`);
  } catch {
    console.log('   Not yet downloaded');
  }

  // Save results
  const output = {
    metadata: {
      generatedDate: new Date().toISOString(),
      purpose: 'Missing Broadcom/VMware affiliates download',
      affiliates: MISSING_AFFILIATES.map(a => a.name),
      totalPatents: finalPatents.length,
      breakdown,
      notes: {
        lifelock: 'LifeLock NOT included - stayed with consumer division (NortonLifeLock/Gen Digital)',
        bluecoat: 'Blue Coat downloaded separately - needs merge'
      }
    },
    patents: finalPatents
  };

  const outputFile = `./output/missing-affiliates-patents-${timestamp}.json`;
  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved: ${outputFile}`);

  // Save patent IDs
  const idsFile = `./output/missing-affiliates-patent-ids-${timestamp}.json`;
  await fs.writeFile(idsFile, JSON.stringify(finalPatents.map(p => p.patent_id), null, 2));
  console.log(`✓ Saved: ${idsFile}`);

  console.log('\n' + '═'.repeat(60));
  console.log('NEXT STEPS:');
  console.log('═'.repeat(60));
  console.log('  1. Run citation analysis on new patents');
  console.log('  2. Merge into multi-score-analysis');
  console.log('  3. Update portfolio-affiliates.json config');
  console.log('  4. Regenerate exports');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
