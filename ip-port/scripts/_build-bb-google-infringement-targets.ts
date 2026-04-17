/**
 * Build infringement scoring targets: Blackberry 44 patents × Google products
 *
 * Uses GLSSD2 product docs discovery + hardcoded target products.
 * Output: output/bb-google-infringement-targets.csv
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const GLSSD2_BASE = '/Volumes/GLSSD2/data/products/docs';
const OUTPUT = 'output/bb-google-infringement-targets.csv';

// Google company slugs that might have product docs
const GOOGLE_SLUGS = ['google', 'google-cloud', 'google-llc', 'google-cloud-platform-gcp'];

// Products we specifically want to target (from user request)
// We'll discover these from GLSSD2 + add any that exist
const TARGET_PRODUCTS: Array<{ companySlug: string; productSlug: string; label: string }> = [];

async function main() {
  const prisma = new PrismaClient();

  // Get Blackberry 44 patent IDs
  const fa = await prisma.focusArea.findFirst({ where: { name: 'Blackberry 44' } });
  if (!fa) { console.error('Focus area "Blackberry 44" not found'); process.exit(1); }

  const faPatents = await prisma.focusAreaPatent.findMany({
    where: { focusAreaId: fa.id },
    select: { patentId: true }
  });
  const patentIds = faPatents.map(f => f.patentId);
  console.log(`Patents: ${patentIds.length}`);

  // Discover all Google products on GLSSD2
  const discovered = new Map<string, { companySlug: string; productSlug: string; docCount: number }>();
  for (const slug of GOOGLE_SLUGS) {
    const companyDir = path.join(GLSSD2_BASE, slug);
    if (!fs.existsSync(companyDir)) continue;

    const products = fs.readdirSync(companyDir).filter(f =>
      !f.startsWith('.') && fs.statSync(path.join(companyDir, f)).isDirectory()
    );

    for (const prod of products) {
      const key = `${slug}/${prod}`;
      if (discovered.has(key)) continue;

      const docCount = fs.readdirSync(path.join(companyDir, prod))
        .filter(f => !f.startsWith('._')).length;

      if (docCount > 0) {
        discovered.set(key, { companySlug: slug, productSlug: prod, docCount });
      }
    }
  }

  console.log(`\nDiscovered ${discovered.size} Google products with docs:`);
  for (const [key, info] of [...discovered.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${key}: ${info.docCount} docs`);
  }

  // Build target list: prioritize the 4 requested products, then add discovered ones
  // For google-cloud products, use "google" as the canonical company slug
  // (the slug aliases will handle lookup)
  const targets: Array<{ companySlug: string; productSlug: string }> = [];
  const seen = new Set<string>();

  // Add all discovered products, using canonical slug
  for (const [, info] of discovered) {
    const canonical = 'google';  // Normalize to single company slug
    const key = `${canonical}/${info.productSlug}`;
    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ companySlug: canonical, productSlug: info.productSlug });
    }
  }

  console.log(`\nTarget products: ${targets.length}`);
  targets.forEach(t => console.log(`  ${t.companySlug}/${t.productSlug}`));

  // Build CSV: patent_id × company_slug × product_slug
  const lines = ['patent_id,company_slug,product_slug'];
  for (const patentId of patentIds) {
    for (const target of targets) {
      lines.push(`${patentId},${target.companySlug},${target.productSlug}`);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, lines.join('\n') + '\n');
  console.log(`\nWrote ${lines.length - 1} pairs to ${OUTPUT}`);
  console.log(`(${patentIds.length} patents × ${targets.length} products)`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
