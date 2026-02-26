/**
 * Batch XML Extraction Script
 *
 * Reads patent IDs from a JSON batch file, queries Postgres for grant dates,
 * calls extractPatentXmls() to extract individual XMLs from USPTO bulk ZIPs,
 * and updates hasXmlData=true for successfully extracted patents.
 *
 * Usage:
 *   npx tsx scripts/extract-patent-xmls-batch.ts /tmp/batch-xml-123.json
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

import { PrismaClient } from '@prisma/client';
import { extractPatentXmls, findPatentXmlPath, type ExtractionRequest } from '../src/api/services/patent-xml-extractor-service.js';
import { enrichPatentCpcBatch } from '../src/api/services/patent-xml-parser-service.js';

const prisma = new PrismaClient();

async function main() {
  const batchFile = process.argv[2];
  if (!batchFile || !fs.existsSync(batchFile)) {
    console.error('Usage: npx tsx scripts/extract-patent-xmls-batch.ts <batch-file.json>');
    console.error('  batch file should contain a JSON array of patent ID strings');
    process.exit(1);
  }

  const patentIds: string[] = JSON.parse(fs.readFileSync(batchFile, 'utf-8'));
  console.log(`Loaded ${patentIds.length} patent IDs from ${batchFile}`);

  if (patentIds.length === 0) {
    console.log('No patents to process.');
    process.exit(0);
  }

  // Query Postgres for grant dates
  console.log('Querying grant dates from Postgres...');
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, grantDate: true },
  });

  console.log(`Found ${patents.length} patents in DB (${patentIds.length - patents.length} not found)`);

  // Build extraction requests (only patents with grant dates)
  const requests: ExtractionRequest[] = [];
  let noGrantDate = 0;
  for (const p of patents) {
    if (p.grantDate) {
      requests.push({ patentId: p.patentId, grantDate: p.grantDate });
    } else {
      noGrantDate++;
    }
  }

  if (noGrantDate > 0) {
    console.log(`Skipping ${noGrantDate} patents without grant dates`);
  }

  if (requests.length === 0) {
    console.log('No patents with grant dates to extract.');
    process.exit(0);
  }

  // Run extraction
  console.log(`\nExtracting XMLs for ${requests.length} patents...`);
  const result = await extractPatentXmls(requests, console.log);

  // Update hasXmlData for all patents that now have XML files
  // (includes both newly extracted and already-existing)
  // Check both padded (US09959345.xml) and unpadded (US9959345.xml) filenames
  const successIds = new Set<string>();
  const exportDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
  if (exportDir) {
    for (const p of patents) {
      if (findPatentXmlPath(exportDir, p.patentId)) {
        successIds.add(p.patentId);
      }
    }
  }

  if (successIds.size > 0) {
    console.log(`\nUpdating hasXmlData for ${successIds.size} patents...`);
    const updateResult = await prisma.patent.updateMany({
      where: { patentId: { in: Array.from(successIds) }, hasXmlData: false },
      data: { hasXmlData: true },
    });
    console.log(`Updated ${updateResult.count} patent records`);

    // Enrich CPC designations (inventive vs additional) from XML
    console.log(`\nEnriching CPC designations for ${successIds.size} patents...`);
    const cpcResult = await enrichPatentCpcBatch(
      Array.from(successIds),
      exportDir,
      (current, total) => console.log(`  CPC enrichment: ${current}/${total}`)
    );
    console.log(`CPC enrichment: ${cpcResult.enriched} enriched, ${cpcResult.totalCpcsWritten} CPCs written, ${cpcResult.totalInventive} inventive`);
    if (cpcResult.errors > 0) {
      console.log(`  CPC errors: ${cpcResult.errors}`);
    }
  }

  // Quarantine patents where extraction failed (not found in bulk ZIPs)
  // Note: successIds uses findPatentXmlPath() which handles zero-padded filenames
  const failedIds = patents
    .filter(p => p.grantDate && !successIds.has(p.patentId))
    .map(p => p.patentId);

  let quarantined = 0;
  if (failedIds.length > 0) {
    console.log(`\nQuarantining ${failedIds.length} patents where extraction failed...`);
    for (const pid of failedIds) {
      // Read existing quarantine data, merge in xml reason
      const existing = await prisma.patent.findUnique({
        where: { patentId: pid },
        select: { quarantine: true },
      });
      const q = (existing?.quarantine as Record<string, string>) || {};
      if (!q.xml) {
        q.xml = 'extraction-failed';
        await prisma.patent.update({
          where: { patentId: pid },
          data: { quarantine: q, isQuarantined: true },
        });
        quarantined++;
      }
    }
    console.log(`Quarantined ${quarantined} patents with reason 'extraction-failed'`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('EXTRACTION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total requested: ${result.totalRequested}`);
  console.log(`Extracted: ${result.extracted}`);
  console.log(`Already existed: ${result.alreadyExist}`);
  console.log(`Not found: ${result.notFound}`);
  if (quarantined > 0) {
    console.log(`Quarantined: ${quarantined} (extraction-failed)`);
  }
  if (result.errors.length > 0) {
    console.log(`Errors: ${result.errors.length}`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  - ${err}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }
  console.log(`DB records updated: ${successIds.size}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
