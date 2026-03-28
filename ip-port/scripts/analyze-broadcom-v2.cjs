const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const V2_PILOT_GROUP_ID = 'pg_v2_pilot';

async function main() {
  console.log('Broadcom v2 Classification Analysis\n');
  console.log('='.repeat(60) + '\n');

  // Find Broadcom portfolios
  const broadcomPortfolios = await prisma.portfolio.findMany({
    where: {
      OR: [
        { name: { contains: 'Broadcom', mode: 'insensitive' } },
        { name: { contains: 'Avago', mode: 'insensitive' } },
      ]
    },
    select: { id: true, name: true }
  });

  console.log('Broadcom portfolios found: ' + broadcomPortfolios.length);
  for (const p of broadcomPortfolios) {
    console.log('  ' + p.name);
  }

  if (broadcomPortfolios.length === 0) {
    console.log('\nNo Broadcom portfolios found.');
    await prisma.$disconnect();
    return;
  }

  // Get Broadcom patent IDs
  const bcPatents = await prisma.portfolioPatent.findMany({
    where: { portfolioId: { in: broadcomPortfolios.map(p => p.id) } },
    select: { patentId: true },
    distinct: ['patentId']
  });
  const broadcomPatentIds = bcPatents.map(p => p.patentId);

  console.log('\nTotal Broadcom patents: ' + broadcomPatentIds.length);

  // Get v2 classifications for Broadcom patents
  const v2Classifications = await prisma.objectClassification.findMany({
    where: {
      portfolioGroupId: V2_PILOT_GROUP_ID,
      objectId: { in: broadcomPatentIds },
      associationRank: 1, // Primary only
    },
    include: {
      taxonomyNode: { select: { code: true, name: true } }
    }
  });

  console.log('Broadcom patents with v2 classification: ' + v2Classifications.length + '\n');

  // Count by sub-sector
  const countByNode = new Map();
  for (const c of v2Classifications) {
    const code = c.taxonomyNode.code;
    countByNode.set(code, (countByNode.get(code) || 0) + 1);
  }

  console.log('Broadcom v2 Sub-sector Distribution (primary):');
  console.log('-'.repeat(60));

  const sorted = Array.from(countByNode.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sorted) {
    const pct = ((count / v2Classifications.length) * 100).toFixed(1);
    console.log(`${code.padEnd(30)}: ${String(count).padStart(5)} patents (${pct}%)`);
  }
  console.log('-'.repeat(60));
  console.log(`Total: ${v2Classifications.length} patents`);

  // Multi-classification stats
  const allBcClassifications = await prisma.objectClassification.findMany({
    where: {
      portfolioGroupId: V2_PILOT_GROUP_ID,
      objectId: { in: broadcomPatentIds },
    },
    select: { objectId: true, associationRank: true }
  });

  const patentsWithMultiple = new Set();
  for (const c of allBcClassifications) {
    if (c.associationRank > 1) {
      patentsWithMultiple.add(c.objectId);
    }
  }

  console.log('\n\nMulti-classification stats:');
  console.log(`  Patents with 2+ sub-sectors: ${patentsWithMultiple.size} (${((patentsWithMultiple.size / v2Classifications.length) * 100).toFixed(1)}%)`);
  console.log(`  Total classifications: ${allBcClassifications.length}`);
  console.log(`  Avg classifications per patent: ${(allBcClassifications.length / v2Classifications.length).toFixed(2)}`);

  // Sample Broadcom patents with multiple sub-sectors
  console.log('\n\nSample Broadcom patents with multiple sub-sectors:\n');

  const samplePatents = Array.from(patentsWithMultiple).slice(0, 5);
  for (const patentId of samplePatents) {
    const patent = await prisma.patent.findUnique({
      where: { id: patentId },
      select: { patentId: true, title: true }
    });

    const classifications = await prisma.objectClassification.findMany({
      where: {
        portfolioGroupId: V2_PILOT_GROUP_ID,
        objectId: patentId,
      },
      include: {
        taxonomyNode: { select: { code: true, name: true } }
      },
      orderBy: { associationRank: 'asc' }
    });

    console.log(`${patent?.patentId}: ${(patent?.title || '').substring(0, 50)}...`);
    for (const c of classifications) {
      console.log(`  Rank ${c.associationRank}: ${c.taxonomyNode.code} (weight ${c.weight.toFixed(2)})`);
    }
    console.log();
  }

  await prisma.$disconnect();
}

main().catch(console.error);
