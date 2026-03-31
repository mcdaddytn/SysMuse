/**
 * Analyze CPC distribution within large sub-sectors to find refinement opportunities
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const V2_PILOT_GROUP_ID = 'pg_v2_pilot';

// The 3 sub-sectors that need refinement
const LARGE_SUBSECTORS = [
  { code: 'SDN/SWIT/routing', cpcPrefix: 'H04L45' },
  { code: 'SDN/SWIT/traffic-qos', cpcPrefix: 'H04L47' },
  { code: 'SDN/SWIT/packet-switching', cpcPrefix: 'H04L49' },
];

async function main() {
  console.log('CPC Distribution Analysis for Large Sub-sectors\n');
  console.log('='.repeat(70) + '\n');
  console.log('Target: 100-1000 overall, <500 per portfolio\n');

  // Get Broadcom patent IDs for comparison
  const broadcomPortfolios = await prisma.portfolio.findMany({
    where: {
      OR: [
        { name: { contains: 'Broadcom', mode: 'insensitive' } },
        { name: { contains: 'Avago', mode: 'insensitive' } },
      ]
    },
    select: { id: true }
  });

  const bcPatents = await prisma.portfolioPatent.findMany({
    where: { portfolioId: { in: broadcomPortfolios.map(p => p.id) } },
    select: { patentId: true },
    distinct: ['patentId']
  });
  const broadcomPatentIds = new Set(bcPatents.map(p => p.patentId));

  for (const subsector of LARGE_SUBSECTORS) {
    console.log('\n' + '='.repeat(70));
    console.log(`${subsector.code} (${subsector.cpcPrefix})`);
    console.log('='.repeat(70) + '\n');

    // Get patents in this sub-sector
    const node = await prisma.taxonomyNode.findFirst({
      where: { code: subsector.code }
    });

    if (!node) {
      console.log('  Node not found');
      continue;
    }

    const classifications = await prisma.objectClassification.findMany({
      where: {
        portfolioGroupId: V2_PILOT_GROUP_ID,
        taxonomyNodeId: node.id,
        associationRank: 1,
      },
      select: { objectId: true }
    });

    const patentIds = classifications.map(c => c.objectId);
    const bcCount = patentIds.filter(id => broadcomPatentIds.has(id)).length;

    console.log(`Total patents: ${patentIds.length} (Broadcom: ${bcCount})\n`);

    // Analyze CPC distribution at different granularities

    // Level 1: 7 chars (e.g., H04L45/)
    const dist7 = await prisma.$queryRaw`
      SELECT
        LEFT(pc.cpc_code, 7) as cpc,
        COUNT(DISTINCT pc.patent_id) as total,
        COUNT(DISTINCT CASE WHEN pp.portfolio_id IN (${broadcomPortfolios.map(p => p.id).join(',')}) THEN pc.patent_id END) as broadcom
      FROM patent_cpc_codes pc
      LEFT JOIN portfolio_patents pp ON pp.patent_id = pc.patent_id
      WHERE pc.patent_id = ANY(${patentIds})
        AND pc.cpc_code LIKE ${subsector.cpcPrefix + '%'}
      GROUP BY LEFT(pc.cpc_code, 7)
      HAVING COUNT(DISTINCT pc.patent_id) >= 20
      ORDER BY total DESC
      LIMIT 20
    `;

    console.log('CPC Distribution (7-char prefix, >=20 patents):');
    console.log('-'.repeat(50));
    console.log('CPC'.padEnd(12) + 'Total'.padStart(8) + 'Broadcom'.padStart(10));
    console.log('-'.repeat(50));

    for (const row of dist7) {
      const cpc = row.cpc || 'null';
      const total = Number(row.total);
      const bc = Number(row.broadcom);
      console.log(`${cpc.padEnd(12)}${String(total).padStart(8)}${String(bc).padStart(10)}`);
    }

    // Level 2: 8 chars (e.g., H04L45/0)
    console.log('\nCPC Distribution (8-char prefix, >=20 patents):');
    console.log('-'.repeat(50));

    const dist8 = await prisma.$queryRaw`
      SELECT
        LEFT(pc.cpc_code, 8) as cpc,
        COUNT(DISTINCT pc.patent_id) as total,
        COUNT(DISTINCT CASE WHEN pp.portfolio_id IN (${broadcomPortfolios.map(p => p.id).join(',')}) THEN pc.patent_id END) as broadcom
      FROM patent_cpc_codes pc
      LEFT JOIN portfolio_patents pp ON pp.patent_id = pc.patent_id
      WHERE pc.patent_id = ANY(${patentIds})
        AND pc.cpc_code LIKE ${subsector.cpcPrefix + '%'}
      GROUP BY LEFT(pc.cpc_code, 8)
      HAVING COUNT(DISTINCT pc.patent_id) >= 20
      ORDER BY total DESC
      LIMIT 25
    `;

    console.log('CPC'.padEnd(12) + 'Total'.padStart(8) + 'Broadcom'.padStart(10));
    console.log('-'.repeat(50));

    for (const row of dist8) {
      const cpc = row.cpc || 'null';
      const total = Number(row.total);
      const bc = Number(row.broadcom);
      console.log(`${cpc.padEnd(12)}${String(total).padStart(8)}${String(bc).padStart(10)}`);
    }

    // Level 3: Full group (e.g., H04L45/74)
    console.log('\nTop CPC Groups (full code, >=50 patents):');
    console.log('-'.repeat(50));

    const distFull = await prisma.$queryRaw`
      SELECT
        SPLIT_PART(pc.cpc_code, '/', 1) || '/' || SPLIT_PART(SPLIT_PART(pc.cpc_code, '/', 2), ' ', 1) as cpc,
        COUNT(DISTINCT pc.patent_id) as total,
        COUNT(DISTINCT CASE WHEN pp.portfolio_id IN (${broadcomPortfolios.map(p => p.id).join(',')}) THEN pc.patent_id END) as broadcom
      FROM patent_cpc_codes pc
      LEFT JOIN portfolio_patents pp ON pp.patent_id = pc.patent_id
      WHERE pc.patent_id = ANY(${patentIds})
        AND pc.cpc_code LIKE ${subsector.cpcPrefix + '%'}
      GROUP BY SPLIT_PART(pc.cpc_code, '/', 1) || '/' || SPLIT_PART(SPLIT_PART(pc.cpc_code, '/', 2), ' ', 1)
      HAVING COUNT(DISTINCT pc.patent_id) >= 50
      ORDER BY total DESC
      LIMIT 20
    `;

    console.log('CPC'.padEnd(12) + 'Total'.padStart(8) + 'Broadcom'.padStart(10));
    console.log('-'.repeat(50));

    for (const row of distFull) {
      const cpc = row.cpc || 'null';
      const total = Number(row.total);
      const bc = Number(row.broadcom);
      console.log(`${cpc.padEnd(12)}${String(total).padStart(8)}${String(bc).padStart(10)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
