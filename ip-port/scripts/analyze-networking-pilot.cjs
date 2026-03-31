const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('NETWORKING Super-Sector Analysis for v2 Pilot\n');
  console.log('='.repeat(60) + '\n');

  // Find NETWORKING super-sector (it might be called SDN_NETWORK or similar)
  const networkingNodes = await prisma.taxonomyNode.findMany({
    where: {
      level: 1,
      OR: [
        { code: { contains: 'NETWORK' } },
        { code: { contains: 'SDN' } },
        { name: { contains: 'Network' } },
      ]
    },
    select: { id: true, code: true, name: true }
  });

  console.log('Level 1 (Super-sector) candidates:');
  for (const n of networkingNodes) {
    console.log('  ' + n.code + ' - "' + n.name + '"');
  }

  // Get all L1 nodes to understand the full taxonomy
  const allL1 = await prisma.taxonomyNode.findMany({
    where: { level: 1 },
    select: { id: true, code: true, name: true }
  });
  console.log('\nAll L1 Super-sectors:');
  for (const n of allL1) {
    console.log('  ' + n.code);
  }

  // Pick SDN_NETWORK if it exists, or first networking-related
  const networkSuper = networkingNodes.find(n => n.code.includes('SDN')) || networkingNodes[0];
  if (!networkSuper) {
    console.log('\nNo NETWORKING super-sector found!');
    await prisma.$disconnect();
    return;
  }

  console.log('\nAnalyzing: ' + networkSuper.code + '\n');

  // Get L2 sectors under this super-sector
  const sectors = await prisma.taxonomyNode.findMany({
    where: { parentId: networkSuper.id, level: 2 },
    select: { id: true, code: true, name: true }
  });

  console.log('Level 2 Sectors (' + sectors.length + ' total):');
  console.log('-'.repeat(60));

  for (const sector of sectors) {
    // Count patents in this sector
    const patentCount = await prisma.objectClassification.count({
      where: {
        taxonomyNodeId: sector.id,
        objectType: 'patent'
      }
    });

    // Get rules targeting this sector
    const rules = await prisma.taxonomyRule.findMany({
      where: { targetNodeId: sector.id },
      select: { expression: true, ruleType: true, priority: true }
    });

    console.log('\n' + sector.code + ' (' + patentCount + ' patents)');
    console.log('  Name: ' + sector.name);
    console.log('  Rules (' + rules.length + '):');
    for (const r of rules.slice(0, 5)) {
      console.log('    ' + r.ruleType + ': ' + r.expression + ' (priority ' + r.priority + ')');
    }
    if (rules.length > 5) {
      console.log('    ... and ' + (rules.length - 5) + ' more');
    }

    // Get CPC code distribution within this sector
    const cpcDist = await prisma.$queryRaw`
      SELECT
        LEFT(pc.cpc_code, 4) as cpc_prefix,
        COUNT(DISTINCT pc.patent_id) as patent_count
      FROM patent_cpc_codes pc
      JOIN object_classifications oc ON oc.object_id = pc.patent_id
      WHERE oc.taxonomy_node_id = ${sector.id}
        AND oc.object_type = 'patent'
        AND oc.association_rank = 1
      GROUP BY LEFT(pc.cpc_code, 4)
      ORDER BY patent_count DESC
      LIMIT 10
    `;

    if (cpcDist.length > 0) {
      console.log('  Top CPC prefixes:');
      for (const c of cpcDist) {
        console.log('    ' + c.cpc_prefix + ': ' + c.patent_count + ' patents');
      }
    }
  }

  // Suggest sub-sector groupings
  console.log('\n' + '='.repeat(60));
  console.log('SUB-SECTOR SUGGESTIONS\n');

  for (const sector of sectors.slice(0, 3)) {
    const cpcDist = await prisma.$queryRaw`
      SELECT
        LEFT(pc.cpc_code, 7) as cpc_prefix,
        COUNT(DISTINCT pc.patent_id) as patent_count
      FROM patent_cpc_codes pc
      JOIN object_classifications oc ON oc.object_id = pc.patent_id
      WHERE oc.taxonomy_node_id = ${sector.id}
        AND oc.object_type = 'patent'
      GROUP BY LEFT(pc.cpc_code, 7)
      HAVING COUNT(DISTINCT pc.patent_id) >= 50
      ORDER BY patent_count DESC
      LIMIT 15
    `;

    if (cpcDist.length > 0) {
      console.log('\n' + sector.code + ' - potential sub-sectors:');
      for (const c of cpcDist) {
        console.log('  ' + c.cpc_prefix + ': ' + c.patent_count + ' patents');
      }
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
