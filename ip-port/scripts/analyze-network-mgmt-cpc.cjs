/**
 * Analyze CPC distribution for network-management sector
 * to design v2 sub-sectors.
 *
 * network-management maps to: H04L41/, H04L43/, H04L61/
 * NOTE: patent_cpc_codes.patent_id = patents.patent_id (patent number string)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Network-Management CPC Distribution Analysis\n');
  console.log('='.repeat(70) + '\n');

  // Get Broadcom patent numbers
  const broadcomPortfolios = await prisma.portfolio.findMany({
    where: {
      OR: [
        { name: { contains: 'Broadcom', mode: 'insensitive' } },
        { name: { contains: 'Avago', mode: 'insensitive' } },
      ]
    },
    select: { id: true, name: true }
  });
  const bcPortIds = broadcomPortfolios.map(p => p.id);

  const bcPatents = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT p.patent_id
    FROM portfolio_patents pp
    JOIN patents p ON p.id = pp.patent_id
    WHERE pp.portfolio_id = ANY($1::text[])
  `, bcPortIds);
  const broadcomPatentNums = new Set(bcPatents.map(p => p.patent_id));

  console.log(`Broadcom portfolios: ${broadcomPortfolios.map(p => p.name).join(', ')}`);
  console.log(`Broadcom patents: ${broadcomPatentNums.size}\n`);

  // Get all patent numbers classified to network-management in v1
  const nmPatents = await prisma.patent.findMany({
    where: { primarySector: 'network-management' },
    select: { patentId: true }
  });
  const nmPatentNums = nmPatents.map(p => p.patentId);
  const bcInNm = nmPatentNums.filter(pn => broadcomPatentNums.has(pn)).length;

  console.log(`Network-management sector: ${nmPatentNums.length} total, ${bcInNm} Broadcom\n`);

  // CPC prefixes for network-management
  const CPC_PREFIXES = ['H04L41', 'H04L43', 'H04L61'];

  for (const prefix of CPC_PREFIXES) {
    console.log('\n' + '='.repeat(70));
    console.log(`CPC Prefix: ${prefix}`);
    console.log('='.repeat(70) + '\n');

    // Distribution at group level (e.g., H04L41/06)
    console.log('CPC Group Distribution (>=5 patents):');
    console.log('-'.repeat(65));
    console.log('CPC'.padEnd(20) + 'Total'.padStart(8) + 'Broadcom'.padStart(10) + 'Inventive'.padStart(10) + 'InvOnly'.padStart(10));
    console.log('-'.repeat(65));

    const groupDist = await prisma.$queryRawUnsafe(`
      SELECT
        CASE
          WHEN POSITION('/' IN pc.cpc_code) > 0
          THEN SPLIT_PART(pc.cpc_code, '/', 1) || '/' || REGEXP_REPLACE(SPLIT_PART(pc.cpc_code, '/', 2), '[^0-9].*$', '')
          ELSE pc.cpc_code
        END as cpc_group,
        COUNT(DISTINCT pc.patent_id) as total,
        COUNT(DISTINCT CASE WHEN pc.is_inventive THEN pc.patent_id END) as inventive
      FROM patent_cpc_codes pc
      WHERE pc.patent_id = ANY($1::text[])
        AND pc.cpc_code LIKE $2
      GROUP BY cpc_group
      HAVING COUNT(DISTINCT pc.patent_id) >= 5
      ORDER BY total DESC
      LIMIT 40
    `, nmPatentNums, prefix + '%');

    for (const row of groupDist) {
      const cpc = row.cpc_group || 'null';
      const total = Number(row.total);
      const inv = Number(row.inventive);

      // Count Broadcom
      const bcNums = nmPatentNums.filter(pn => broadcomPatentNums.has(pn));
      const bcForGroup = await prisma.$queryRawUnsafe(`
        SELECT COUNT(DISTINCT pc.patent_id) as cnt
        FROM patent_cpc_codes pc
        WHERE pc.patent_id = ANY($1::text[])
          AND pc.cpc_code LIKE $2
      `, bcNums, cpc + '%');
      const bc = Number(bcForGroup[0].cnt);

      // Count inventive-only
      const invOnly = await prisma.$queryRawUnsafe(`
        SELECT COUNT(DISTINCT pc.patent_id) as cnt
        FROM patent_cpc_codes pc
        WHERE pc.patent_id = ANY($1::text[])
          AND pc.cpc_code LIKE $2
          AND pc.is_inventive = true
          AND NOT EXISTS (
            SELECT 1 FROM patent_cpc_codes pc2
            WHERE pc2.patent_id = pc.patent_id
              AND pc2.cpc_code LIKE $2
              AND pc2.is_inventive = false
          )
      `, nmPatentNums, cpc + '%');

      console.log(`${cpc.padEnd(20)}${String(total).padStart(8)}${String(bc).padStart(10)}${String(inv).padStart(10)}${String(Number(invOnly[0].cnt)).padStart(10)}`);
    }
  }

  // Cross-cutting analysis: what other CPC codes appear
  console.log('\n\n' + '='.repeat(70));
  console.log('Other CPC Prefixes in network-management patents (non-H04L41/43/61)');
  console.log('='.repeat(70) + '\n');

  const otherCpcs = await prisma.$queryRawUnsafe(`
    SELECT
      SPLIT_PART(pc.cpc_code, '/', 1) as cpc_class,
      COUNT(DISTINCT pc.patent_id) as total
    FROM patent_cpc_codes pc
    WHERE pc.patent_id = ANY($1::text[])
      AND pc.cpc_code NOT LIKE 'H04L41%'
      AND pc.cpc_code NOT LIKE 'H04L43%'
      AND pc.cpc_code NOT LIKE 'H04L61%'
      AND pc.cpc_code NOT LIKE 'Y%'
    GROUP BY SPLIT_PART(pc.cpc_code, '/', 1)
    HAVING COUNT(DISTINCT pc.patent_id) >= 20
    ORDER BY total DESC
    LIMIT 20
  `, nmPatentNums);

  console.log('CPC Class'.padEnd(15) + 'Patents'.padStart(8));
  console.log('-'.repeat(30));
  for (const row of otherCpcs) {
    console.log(`${row.cpc_class.padEnd(15)}${String(Number(row.total)).padStart(8)}`);
  }

  // Summary by major H04L41 subgroups for sub-sector design
  console.log('\n\n' + '='.repeat(70));
  console.log('H04L41 Detailed Subgroup Breakdown');
  console.log('='.repeat(70) + '\n');

  const h41detail = await prisma.$queryRawUnsafe(`
    SELECT
      LEFT(pc.cpc_code, LEAST(LENGTH(pc.cpc_code), 9)) as cpc_sub,
      COUNT(DISTINCT pc.patent_id) as total,
      COUNT(DISTINCT CASE WHEN pc.is_inventive THEN pc.patent_id END) as inventive
    FROM patent_cpc_codes pc
    WHERE pc.patent_id = ANY($1::text[])
      AND pc.cpc_code LIKE 'H04L41%'
    GROUP BY cpc_sub
    HAVING COUNT(DISTINCT pc.patent_id) >= 5
    ORDER BY total DESC
    LIMIT 40
  `, nmPatentNums);

  console.log('CPC'.padEnd(15) + 'Total'.padStart(8) + 'Inventive'.padStart(10));
  console.log('-'.repeat(40));
  for (const row of h41detail) {
    console.log(`${(row.cpc_sub || '').padEnd(15)}${String(Number(row.total)).padStart(8)}${String(Number(row.inventive)).padStart(10)}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
