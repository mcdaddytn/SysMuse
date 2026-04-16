/**
 * Export Litigation Package CSV
 *
 * Generates a comprehensive CSV export for a focus area including all patent
 * metadata, EAV scores, and sub-sector scoring metrics with reasoning.
 *
 * Usage:
 *   npx tsx scripts/export-litigation-package.ts "Nutanix Litigation Targets"
 *   npx tsx scripts/export-litigation-package.ts --id <focus-area-id>
 */

import { PrismaClient } from '@prisma/client';
import { generateLitigationPackageCsv } from '../src/api/services/litigation-export-service.js';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  npx tsx scripts/export-litigation-package.ts "Focus Area Name"');
    console.error('  npx tsx scripts/export-litigation-package.ts --id <focus-area-id>');
    process.exit(1);
  }

  let focusAreaId: string;

  if (args[0] === '--id' && args[1]) {
    focusAreaId = args[1];
  } else {
    // Look up by name
    const name = args.join(' ');
    const focusArea = await prisma.focusArea.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!focusArea) {
      console.error(`Focus area not found: "${name}"`);
      const all = await prisma.focusArea.findMany({
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      console.error('\nAvailable focus areas:');
      for (const fa of all) {
        console.error(`  - ${fa.name} (${fa.id})`);
      }
      process.exit(1);
    }
    focusAreaId = focusArea.id;
    console.log(`Found focus area: ${focusArea.name} (${focusArea.id})`);
  }

  console.log('Generating litigation package CSV...');
  const result = await generateLitigationPackageCsv(focusAreaId);

  // Ensure output directory exists
  const outputDir = path.join(process.cwd(), 'output', 'litigation-packages');
  fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, result.filename);
  fs.writeFileSync(outputPath, result.csv, 'utf-8');

  console.log(`\nExport complete:`);
  console.log(`  Patents: ${result.patentCount}`);
  console.log(`  Metric keys: ${result.metricKeyCount}`);
  console.log(`  Output: ${outputPath}`);
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
