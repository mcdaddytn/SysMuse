const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Sub-sector Size Estimates\n');
  console.log('='.repeat(60) + '\n');

  // Get network-switching sector (v1)
  const switchingSector = await prisma.taxonomyNode.findFirst({
    where: { code: 'network-switching', level: 2 }
  });

  if (!switchingSector) {
    console.log('network-switching sector not found');
    await prisma.$disconnect();
    return;
  }

  // 1. ALL PORTFOLIOS - network-switching total
  const allSwitching = await prisma.objectClassification.count({
    where: {
      taxonomyNodeId: switchingSector.id,
      objectType: 'patent'
    }
  });
  console.log('ALL PORTFOLIOS - network-switching: ' + allSwitching + ' patents\n');

  // 2. BROADCOM - find portfolios
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

  let broadcomPatentIds = [];
  if (broadcomPortfolios.length > 0) {
    const bcPatents = await prisma.portfolioPatent.findMany({
      where: { portfolioId: { in: broadcomPortfolios.map(p => p.id) } },
      select: { patentId: true },
      distinct: ['patentId']
    });
    broadcomPatentIds = bcPatents.map(p => p.patentId);

    const broadcomSwitching = await prisma.objectClassification.count({
      where: {
        taxonomyNodeId: switchingSector.id,
        objectType: 'patent',
        objectId: { in: broadcomPatentIds }
      }
    });
    console.log('\nBROADCOM total patents: ' + broadcomPatentIds.length);
    console.log('BROADCOM - network-switching: ' + broadcomSwitching + ' patents\n');
  }

  // 3. Estimate sub-sector sizes using CPC patterns
  console.log('Estimated SUB-SECTOR sizes (ALL portfolios):\n');
  console.log('-'.repeat(60));

  const subSectorPatterns = [
    { name: 'ethernet-lan', patterns: ['H04L12/28', 'H04L12/40'] },
    { name: 'routing', patterns: ['H04L45/'] },
    { name: 'traffic-qos', patterns: ['H04L47/'] },
    { name: 'packet-switching', patterns: ['H04L49/'] },
    { name: 'network-interconnect', patterns: ['H04L12/46'] },
  ];

  let accounted = 0;
  for (const sub of subSectorPatterns) {
    const patternConditions = sub.patterns.map(p => "pc.cpc_code LIKE '" + p + "%'").join(' OR ');

    const result = await prisma.$queryRawUnsafe(
      "SELECT COUNT(DISTINCT oc.object_id) as count " +
      "FROM object_classifications oc " +
      "JOIN patent_cpc_codes pc ON pc.patent_id = oc.object_id " +
      "WHERE oc.taxonomy_node_id = '" + switchingSector.id + "' " +
      "AND oc.object_type = 'patent' " +
      "AND (" + patternConditions + ")"
    );

    const count = Number(result[0].count);
    accounted += count;
    console.log(sub.name.padEnd(25) + ': ' + String(count).padStart(5) + ' patents');
  }

  const generalEstimate = allSwitching - accounted;
  console.log('general (catch-all)'.padEnd(25) + ': ~' + String(Math.max(0, generalEstimate)).padStart(4) + ' patents');
  console.log('-'.repeat(60));
  console.log('Total'.padEnd(25) + ': ' + String(allSwitching).padStart(5) + ' patents');

  // 4. For Broadcom specifically
  if (broadcomPatentIds.length > 0) {
    console.log('\n\nEstimated SUB-SECTOR sizes (BROADCOM only):\n');
    console.log('-'.repeat(60));

    let bcAccounted = 0;
    for (const sub of subSectorPatterns) {
      const patternConditions = sub.patterns.map(p => "pc.cpc_code LIKE '" + p + "%'").join(' OR ');

      // Use parameterized query for safety
      const result = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT oc.object_id) as count
        FROM object_classifications oc
        JOIN patent_cpc_codes pc ON pc.patent_id = oc.object_id
        WHERE oc.taxonomy_node_id = ${switchingSector.id}
          AND oc.object_type = 'patent'
          AND oc.object_id = ANY(${broadcomPatentIds})
          AND (${prisma.$queryRawUnsafe(patternConditions)})
      `.catch(async () => {
        // Fallback to simpler query
        const ids = broadcomPatentIds.slice(0, 1000); // Sample
        const idList = ids.map(id => "'" + id + "'").join(',');
        return prisma.$queryRawUnsafe(
          "SELECT COUNT(DISTINCT oc.object_id) as count " +
          "FROM object_classifications oc " +
          "JOIN patent_cpc_codes pc ON pc.patent_id = oc.object_id " +
          "WHERE oc.taxonomy_node_id = '" + switchingSector.id + "' " +
          "AND oc.object_type = 'patent' " +
          "AND oc.object_id IN (" + idList + ") " +
          "AND (" + patternConditions + ")"
        );
      });

      const count = Number(result[0]?.count || 0);
      bcAccounted += count;
      console.log(sub.name.padEnd(25) + ': ' + String(count).padStart(5) + ' patents');
    }

    const broadcomSwitchingCount = await prisma.objectClassification.count({
      where: {
        taxonomyNodeId: switchingSector.id,
        objectType: 'patent',
        objectId: { in: broadcomPatentIds }
      }
    });

    const bcGeneral = broadcomSwitchingCount - bcAccounted;
    console.log('general (catch-all)'.padEnd(25) + ': ~' + String(Math.max(0, bcGeneral)).padStart(4) + ' patents');
    console.log('-'.repeat(60));
    console.log('Total'.padEnd(25) + ': ' + String(broadcomSwitchingCount).padStart(5) + ' patents');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
