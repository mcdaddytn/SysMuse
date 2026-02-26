/**
 * Data migration: Company-centric refactor.
 *
 * 1. Creates Company records from existing Portfolios (Broadcom, Chelsio)
 * 2. Moves Affiliates from Portfolio → Company
 * 3. Updates Portfolios with companyId and dataSourceType
 * 4. Seeds competitor Companies from config/competitors.json (128 companies)
 * 5. Creates CompetitorRelationship records linking competitors to Broadcom
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx prisma/migrate-to-companies.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Map competitors.json strategy types to our enum
function mapDiscoverySource(strategyKeys: string[], strategies: Record<string, { type: string }>): string {
  // Use the first strategy's type to determine the source
  for (const key of strategyKeys) {
    const strategy = strategies[key];
    if (!strategy) continue;
    const type = strategy.type;
    if (type === 'manual') return 'MANUAL';
    if (type === 'citation-overlap') return 'CITATION_OVERLAP';
    if (type === 'citation-mining') return 'CITATION_OVERLAP';
    if (type === 'term-extraction') {
      // Check if it's a hybrid cluster
      if (key.startsWith('hybrid-cluster')) return 'HYBRID_CLUSTER';
      return 'TERM_EXTRACTION';
    }
    if (type === 'llm-product-analysis') return 'LLM_SUGGESTED';
  }
  return 'MANUAL';
}

async function main() {
  console.log('\n=== Company-Centric Migration ===\n');

  // ─────────────────────────────────────────────────────────────
  // Step 1: Create Company records from existing Portfolios
  // ─────────────────────────────────────────────────────────────

  console.log('Step 1: Creating Company records...');

  const broadcomCompany = await prisma.company.upsert({
    where: { name: 'broadcom' },
    update: { displayName: 'Broadcom Inc.' },
    create: {
      name: 'broadcom',
      displayName: 'Broadcom Inc.',
      description: 'Broadcom Inc. — semiconductor and infrastructure software',
      website: 'https://www.broadcom.com',
    },
  });
  console.log(`  Company: ${broadcomCompany.displayName} (${broadcomCompany.id})`);

  const chelsioCompany = await prisma.company.upsert({
    where: { name: 'chelsio' },
    update: { displayName: 'Chelsio Communications' },
    create: {
      name: 'chelsio',
      displayName: 'Chelsio Communications',
      description: 'Chelsio Communications — high-performance network adapters',
      website: 'https://www.chelsio.com',
    },
  });
  console.log(`  Company: ${chelsioCompany.displayName} (${chelsioCompany.id})`);

  // ─────────────────────────────────────────────────────────────
  // Step 2: Move Affiliates from Portfolio → Company
  // ─────────────────────────────────────────────────────────────

  console.log('\nStep 2: Migrating Affiliates to Companies...');

  // Find broadcom-core portfolio
  const broadcomPortfolio = await prisma.portfolio.findUnique({ where: { name: 'broadcom-core' } });
  if (broadcomPortfolio) {
    // Update all affiliates that had this portfolio to point to broadcom company
    const updatedBroadcom = await prisma.affiliate.updateMany({
      where: { companyId: null },
      data: { companyId: broadcomCompany.id },
    });
    console.log(`  Migrated ${updatedBroadcom.count} affiliates to Broadcom company`);
  }

  // Find chelsio portfolio and update its affiliates
  const chelsioPortfolio = await prisma.portfolio.findUnique({ where: { name: 'chelsio' } });
  if (chelsioPortfolio) {
    // Any remaining affiliates without company (from chelsio) — but since updateMany above
    // caught all null companyIds, we need to be more specific. Actually, since all had null,
    // they all went to broadcom. Let's check if chelsio had any affiliates.
    // We can identify them by checking PortfolioPatent affiliateNames.
    const chelsioPatents = await prisma.portfolioPatent.findMany({
      where: { portfolioId: chelsioPortfolio.id },
      select: { affiliateName: true },
      distinct: ['affiliateName'],
    });
    const chelsioAffNames = chelsioPatents.map(p => p.affiliateName).filter(Boolean);
    if (chelsioAffNames.length > 0) {
      // Move these affiliates to chelsio company
      const moved = await prisma.affiliate.updateMany({
        where: { name: { in: chelsioAffNames as string[] }, companyId: broadcomCompany.id },
        data: { companyId: chelsioCompany.id },
      });
      console.log(`  Re-assigned ${moved.count} Chelsio affiliates`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Step 3: Update Portfolios with companyId and dataSourceType
  // ─────────────────────────────────────────────────────────────

  console.log('\nStep 3: Updating Portfolios with company references...');

  if (broadcomPortfolio) {
    await prisma.portfolio.update({
      where: { id: broadcomPortfolio.id },
      data: {
        companyId: broadcomCompany.id,
        dataSourceType: 'JSON_PIPELINE',
      },
    });
    console.log(`  Portfolio "broadcom-core" → Broadcom, JSON_PIPELINE`);
  }

  if (chelsioPortfolio) {
    await prisma.portfolio.update({
      where: { id: chelsioPortfolio.id },
      data: {
        companyId: chelsioCompany.id,
        dataSourceType: 'DB_RECORDS',
      },
    });
    console.log(`  Portfolio "chelsio" → Chelsio, DB_RECORDS`);
  }

  // ─────────────────────────────────────────────────────────────
  // Step 4: Seed competitor Companies from competitors.json
  // ─────────────────────────────────────────────────────────────

  console.log('\nStep 4: Seeding competitor companies...');

  const competitorsPath = path.resolve(import.meta.dirname, '..', 'config', 'competitors.json');
  const competitorsConfig = JSON.parse(fs.readFileSync(competitorsPath, 'utf-8'));
  const strategies = competitorsConfig.discoveryStrategies;

  let companyCount = 0;
  let relationshipCount = 0;
  const seenNames = new Set<string>();

  for (const [categoryKey, category] of Object.entries(competitorsConfig.categories) as [string, any][]) {
    for (const comp of category.companies) {
      // Deduplicate (e.g., Palantir appears in multiple categories)
      const slug = comp.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');

      if (seenNames.has(slug)) {
        // Still create the relationship for this category
        const existingCompany = await prisma.company.findUnique({ where: { name: slug } });
        if (existingCompany) {
          const discoverySource = mapDiscoverySource(comp.discoveredBy || [], strategies);
          await prisma.competitorRelationship.upsert({
            where: {
              companyId_competitorId: {
                companyId: broadcomCompany.id,
                competitorId: existingCompany.id,
              },
            },
            update: {
              // Add the category to sectors if not already there
              sectors: {
                push: categoryKey,
              },
            },
            create: {
              companyId: broadcomCompany.id,
              competitorId: existingCompany.id,
              sectors: [categoryKey],
              discoverySource: discoverySource as any,
              notes: `From competitors.json category: ${categoryKey}`,
            },
          });
        }
        continue;
      }
      seenNames.add(slug);

      // Create company
      const company = await prisma.company.upsert({
        where: { name: slug },
        update: { displayName: comp.name },
        create: {
          name: slug,
          displayName: comp.name,
        },
      });
      companyCount++;

      // Create competitor relationship (Broadcom → this competitor)
      const discoverySource = mapDiscoverySource(comp.discoveredBy || [], strategies);
      await prisma.competitorRelationship.upsert({
        where: {
          companyId_competitorId: {
            companyId: broadcomCompany.id,
            competitorId: company.id,
          },
        },
        update: {
          sectors: [categoryKey],
          discoverySource: discoverySource as any,
        },
        create: {
          companyId: broadcomCompany.id,
          competitorId: company.id,
          sectors: [categoryKey],
          discoverySource: discoverySource as any,
          notes: `From competitors.json category: ${categoryKey}`,
        },
      });
      relationshipCount++;
    }
  }

  console.log(`  Created ${companyCount} competitor companies`);
  console.log(`  Created ${relationshipCount} competitor relationships`);

  // ─────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────

  const totalCompanies = await prisma.company.count();
  const totalRelationships = await prisma.competitorRelationship.count();
  const totalAffiliates = await prisma.affiliate.count();
  const totalPortfolios = await prisma.portfolio.count();

  console.log(`\n=== Migration Complete ===`);
  console.log(`  Companies: ${totalCompanies}`);
  console.log(`  Competitor relationships: ${totalRelationships}`);
  console.log(`  Affiliates: ${totalAffiliates}`);
  console.log(`  Portfolios: ${totalPortfolios}`);
  console.log('');
}

main()
  .catch((e) => {
    console.error('Migration error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
