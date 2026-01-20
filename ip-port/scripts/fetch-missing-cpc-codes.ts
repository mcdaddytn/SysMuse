#!/usr/bin/env npx tsx
/**
 * Fetch Missing CPC Codes from PatentsView
 *
 * Identifies patents without CPC codes and fetches them from PatentsView API.
 * This allows proper sector assignment for older patents.
 *
 * Usage: npx tsx scripts/fetch-missing-cpc-codes.ts
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

if (!apiKey) {
  console.error('Error: PATENTSVIEW_API_KEY not set');
  process.exit(1);
}

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;

async function rateLimitedFetch(patentIds: string[]): Promise<any> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  const response = await fetch(`${PATENTSVIEW_BASE_URL}/patent/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey!,
    },
    body: JSON.stringify({
      q: { patent_id: patentIds },
      f: ['patent_id', 'cpc_current.cpc_group_id'],
      o: { size: patentIds.length },
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      console.log('  Rate limited, waiting 60s...');
      await new Promise(r => setTimeout(r, 60000));
      return rateLimitedFetch(patentIds);
    }
    throw new Error(`API Error ${response.status}`);
  }

  return response.json();
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        FETCH MISSING CPC CODES FROM PATENTSVIEW');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load sector assignments
  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fsSync.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find patents without CPC codes
  const patentsWithoutCpc: string[] = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (!data.cpc_codes || data.cpc_codes.length === 0) {
      patentsWithoutCpc.push(patentId);
    }
  }

  console.log(`Total patents: ${Object.keys(assignments).length.toLocaleString()}`);
  console.log(`Patents without CPC codes: ${patentsWithoutCpc.length.toLocaleString()}`);

  if (patentsWithoutCpc.length === 0) {
    console.log('\nAll patents have CPC codes!');
    return;
  }

  // Process in batches
  const BATCH_SIZE = 100;
  const batches = Math.ceil(patentsWithoutCpc.length / BATCH_SIZE);
  console.log(`\nProcessing ${batches} batches of ${BATCH_SIZE}...`);
  console.log('Estimated time: ~' + Math.round(batches * 2 / 60) + ' minutes\n');

  let fetched = 0;
  let updated = 0;
  let notFound = 0;

  // Create checkpoint file path
  const checkpointFile = './output/cpc-fetch-checkpoint.json';
  let processedIds = new Set<string>();

  // Load checkpoint if exists
  if (fsSync.existsSync(checkpointFile)) {
    const checkpoint = JSON.parse(fsSync.readFileSync(checkpointFile, 'utf-8'));
    processedIds = new Set(checkpoint.processedIds);
    console.log(`Resuming from checkpoint: ${processedIds.size} already processed\n`);
  }

  // Filter out already processed
  const toProcess = patentsWithoutCpc.filter(id => !processedIds.has(id));
  console.log(`Patents to process: ${toProcess.length.toLocaleString()}`);

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    process.stdout.write(`[Batch ${batchNum}/${Math.ceil(toProcess.length / BATCH_SIZE)}] Fetching ${batch.length} patents... `);

    try {
      const result = await rateLimitedFetch(batch);

      for (const patent of result.patents || []) {
        const patentId = patent.patent_id;
        const cpcCodes = (patent.cpc_current || [])
          .map((c: any) => c.cpc_group_id)
          .filter((c: string) => c);

        if (cpcCodes.length > 0) {
          assignments[patentId].cpc_codes = cpcCodes;
          updated++;
        } else {
          notFound++;
        }
        processedIds.add(patentId);
      }

      // Mark any not returned as processed
      for (const id of batch) {
        if (!processedIds.has(id)) {
          processedIds.add(id);
          notFound++;
        }
      }

      fetched += batch.length;
      console.log(`✓ (updated: ${updated}, not found: ${notFound})`);

      // Save checkpoint every 10 batches
      if (batchNum % 10 === 0) {
        await fs.writeFile(checkpointFile, JSON.stringify({
          processedIds: Array.from(processedIds),
          lastBatch: batchNum,
        }));
        console.log(`  [Checkpoint saved]`);
      }

    } catch (error: any) {
      console.log(`✗ Error: ${error.message}`);
      // Save checkpoint on error
      await fs.writeFile(checkpointFile, JSON.stringify({
        processedIds: Array.from(processedIds),
        lastBatch: batchNum,
      }));
    }
  }

  // Save updated assignments
  await fs.writeFile('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log(`\n✓ Saved updated sector assignments`);

  // Remove checkpoint file
  if (fsSync.existsSync(checkpointFile)) {
    await fs.unlink(checkpointFile);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('FETCH COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Patents processed: ${fetched.toLocaleString()}`);
  console.log(`CPC codes found: ${updated.toLocaleString()}`);
  console.log(`No CPC codes: ${notFound.toLocaleString()}`);
  console.log('\nNEXT STEPS:');
  console.log('  1. Re-run sector assignment: npx tsx scripts/assign-cpc-sectors.ts');
  console.log('  2. Check sector distribution: npx tsx scripts/analyze-sector-sizes.ts');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
