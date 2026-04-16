import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SCORES_DIR = path.resolve('./cache/infringement-scores/nutanix');
const PRODUCTS = [
  'nutanix-ahv',
  'nutanix-cloud-infrastructure-nci',
  'nutanix-flow-network-security',
  'nutanix-flow-virtual-networking',
  'nutanix-prism-central',
];

async function main() {
  const faPatents = await prisma.focusAreaPatent.findMany({
    where: { focusArea: { name: 'Nutanix V3 Discovery — Combined' } },
    select: { patentId: true },
  });
  const allIds = faPatents.map(p => p.patentId).sort();
  console.log(`Total V3 patents: ${allIds.length}`);

  // Get patent metadata
  const patentDetails = await prisma.patent.findMany({
    where: { patentId: { in: allIds } },
    select: { patentId: true, title: true, primarySector: true, superSector: true },
  });
  const patentMap = new Map(patentDetails.map(p => [p.patentId, p]));

  // Check which patents have scores for each product
  const scored = new Map<string, Set<string>>();
  for (const product of PRODUCTS) {
    const dir = path.join(SCORES_DIR, product);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
      scored.set(product, new Set(files));
    } else {
      scored.set(product, new Set());
    }
  }

  // Find patents needing scoring per product
  const needsScoring = new Map<string, string[]>();
  for (const product of PRODUCTS) {
    const existing = scored.get(product)!;
    const missing = allIds.filter(id => !existing.has(id));
    needsScoring.set(product, missing);
    console.log(`  ${product}: ${existing.size} scored, ${missing.length} need scoring`);
  }

  // Get unique unscored patents (any product)
  const allUnscored = new Set<string>();
  for (const [, missing] of needsScoring) {
    for (const id of missing) allUnscored.add(id);
  }
  console.log(`\nUnique patents needing any scoring: ${allUnscored.size}`);

  // Build the targets CSV
  const lines = ['PatentId,Target,TargetProduct,Sector'];
  for (const product of PRODUCTS) {
    for (const patId of needsScoring.get(product)!) {
      const pat = patentMap.get(patId);
      const sector = pat?.primarySector || '';
      lines.push(`${patId},nutanix,${product},${sector}`);
    }
  }

  const csvPath = path.resolve('./output/nutanix-v3-infringement-targets.csv');
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf-8');
  console.log(`\nTargets CSV: ${csvPath}`);
  console.log(`Total pairs: ${lines.length - 1}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
