/**
 * Seed the Broadcom portfolio from config/portfolio-affiliates.json.
 * Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx prisma/seed-portfolios.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface AffiliateConfig {
  displayName: string;
  acquiredYear: number | null;
  parent?: string | null;
  subsidiaries?: string[];
  patterns: string[];
  notes?: string;
}

interface PortfolioConfig {
  affiliates: Record<string, AffiliateConfig>;
}

async function main() {
  const configPath = path.resolve(import.meta.dirname, '..', 'config', 'portfolio-affiliates.json');
  const config: PortfolioConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  console.log('\n=== Seeding Broadcom Portfolio ===\n');

  // 1. Upsert Company
  const company = await prisma.company.upsert({
    where: { name: 'broadcom' },
    update: { displayName: 'Broadcom' },
    create: {
      name: 'broadcom',
      displayName: 'Broadcom',
      description: 'Broadcom Inc. — semiconductor and infrastructure software',
    },
  });
  console.log(`  Company: ${company.name} (${company.id})`);

  // 2. Upsert Portfolio
  const portfolio = await prisma.portfolio.upsert({
    where: { name: 'broadcom-core' },
    update: { displayName: 'Broadcom Core', companyId: company.id, dataSourceType: 'JSON_PIPELINE' },
    create: {
      name: 'broadcom-core',
      displayName: 'Broadcom Core',
      description: 'Broadcom Inc. consolidated patent portfolio including all acquired entities',
      companyId: company.id,
      dataSourceType: 'JSON_PIPELINE',
    },
  });
  console.log(`  Portfolio: ${portfolio.name} (${portfolio.id})`);

  // 3. Create affiliates (two passes: first without parents, then set parents)
  const affiliateMap = new Map<string, string>(); // name -> id

  // Pass 1: Upsert all affiliates without parent references
  for (const [name, cfg] of Object.entries(config.affiliates)) {
    const affiliate = await prisma.affiliate.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: {
        displayName: cfg.displayName,
        acquiredYear: cfg.acquiredYear,
        notes: cfg.notes || null,
      },
      create: {
        companyId: company.id,
        name,
        displayName: cfg.displayName,
        acquiredYear: cfg.acquiredYear,
        notes: cfg.notes || null,
      },
    });
    affiliateMap.set(name, affiliate.id);
    console.log(`  Affiliate: ${name} (${cfg.patterns.length} patterns)`);
  }

  // Pass 2: Set parent references
  for (const [name, cfg] of Object.entries(config.affiliates)) {
    if (cfg.parent && affiliateMap.has(cfg.parent)) {
      await prisma.affiliate.update({
        where: { id: affiliateMap.get(name)! },
        data: { parentId: affiliateMap.get(cfg.parent)! },
      });
    }
  }

  // 4. Upsert AffiliatePatterns
  let patternCount = 0;
  for (const [name, cfg] of Object.entries(config.affiliates)) {
    const affiliateId = affiliateMap.get(name)!;
    for (const pattern of cfg.patterns) {
      await prisma.affiliatePattern.upsert({
        where: { affiliateId_pattern: { affiliateId, pattern } },
        update: {},
        create: {
          affiliateId,
          pattern,
          isExact: false,
        },
      });
      patternCount++;
    }
  }

  // 5. Update affiliate count
  const affiliateCount = affiliateMap.size;
  await prisma.portfolio.update({
    where: { id: portfolio.id },
    data: { affiliateCount },
  });

  console.log(`\n  Summary: ${affiliateCount} affiliates, ${patternCount} patterns`);
  console.log('  Done.\n');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
