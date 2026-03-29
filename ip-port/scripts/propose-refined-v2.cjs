/**
 * Refined sub-sector proposal v2 - splitting the large groups further
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Further refined sub-sectors
const REFINED_SUBSECTORS = {
  routing: [
    { code: 'routing-topology', patterns: ['H04L45/02', 'H04L45/03'], priority: 80 },
    { code: 'routing-shortest-path', patterns: ['H04L45/12'], priority: 80 },
    { code: 'routing-multipath', patterns: ['H04L45/22', 'H04L45/24'], priority: 80 },
    { code: 'routing-prefix-match', patterns: ['H04L45/38'], priority: 80 },
    { code: 'routing-qos', patterns: ['H04L45/30'], priority: 80 },
    { code: 'routing-control', patterns: ['H04L45/42', 'H04L45/44'], priority: 80 },
    { code: 'routing-sdn', patterns: ['H04L45/76'], priority: 80 },
    { code: 'routing-mpls', patterns: ['H04L45/50'], priority: 80 },
    { code: 'routing-label-ops', patterns: ['H04L45/54', 'H04L45/58'], priority: 75 },
    { code: 'routing-table-lookup', patterns: ['H04L45/745', 'H04L45/7453'], priority: 85 },
    { code: 'routing-addr-proc', patterns: ['H04L45/74', 'H04L45/70'], priority: 75 },
    { code: 'routing-interdomain', patterns: ['H04L45/04'], priority: 80 },
    { code: 'routing-fragmentation', patterns: ['H04L45/64', 'H04L45/66'], priority: 80 },
    { code: 'routing-general', patterns: ['H04L45/00', 'H04L45/06', 'H04L45/16', 'H04L45/28'], priority: 50 },
  ],
  'traffic-qos': [
    { code: 'qos-scheduling-core', patterns: ['H04L47/10', 'H04L47/11'], priority: 80 },
    { code: 'qos-scheduling-priority', patterns: ['H04L47/12', 'H04L47/125'], priority: 80 },
    { code: 'qos-bw-allocation', patterns: ['H04L47/20', 'H04L47/2408'], priority: 80 },
    { code: 'qos-bw-reservation', patterns: ['H04L47/24', 'H04L47/2433', 'H04L47/2441'], priority: 80 },
    { code: 'qos-bw-shaping', patterns: ['H04L47/22', 'H04L47/215', 'H04L47/2475', 'H04L47/2483'], priority: 80 },
    { code: 'qos-congestion-detect', patterns: ['H04L47/28', 'H04L47/283'], priority: 80 },
    { code: 'qos-congestion-react', patterns: ['H04L47/30', 'H04L47/32', 'H04L47/38'], priority: 80 },
    { code: 'qos-marking', patterns: ['H04L47/50', 'H04L47/52'], priority: 80 },
    { code: 'qos-admission', patterns: ['H04L47/70', 'H04L47/72', 'H04L47/74', 'H04L47/76', 'H04L47/78'], priority: 80 },
    { code: 'qos-priority', patterns: ['H04L47/80', 'H04L47/805', 'H04L47/82', 'H04L47/822'], priority: 80 },
    { code: 'qos-general', patterns: ['H04L47/00', 'H04L47/193', 'H04L47/263'], priority: 50 },
  ],
  'packet-sw': [
    { code: 'pkt-core', patterns: ['H04L49/00'], priority: 50 },
    { code: 'pkt-input', patterns: ['H04L49/10', 'H04L49/101', 'H04L49/103', 'H04L49/109'], priority: 80 },
    { code: 'pkt-output', patterns: ['H04L49/15'], priority: 80 },
    { code: 'pkt-buffer-mgmt', patterns: ['H04L49/20', 'H04L49/201'], priority: 80 },
    { code: 'pkt-buffer-addr', patterns: ['H04L49/25', 'H04L49/254'], priority: 80 },
    { code: 'pkt-fabric-core', patterns: ['H04L49/30', 'H04L49/3009'], priority: 80 },
    { code: 'pkt-fabric-arbiter', patterns: ['H04L49/3063'], priority: 85 },
    { code: 'pkt-crossbar', patterns: ['H04L49/351', 'H04L49/352', 'H04L49/354', 'H04L49/357'], priority: 80 },
    { code: 'pkt-virtual', patterns: ['H04L49/60', 'H04L49/602'], priority: 80 },
    { code: 'pkt-multicast', patterns: ['H04L49/70'], priority: 80 },
    { code: 'pkt-ports', patterns: ['H04L49/90', 'H04L49/901'], priority: 80 },
    { code: 'pkt-qos-integ', patterns: ['H04L49/9047'], priority: 85 },
  ],
};

async function countExclusive(patterns, allPatentIds, bcPatentIds, higherPriorityPatterns = []) {
  // Count patents matching these patterns but NOT matching higher priority patterns
  const matchConditions = patterns.map(p => `pc.cpc_code LIKE '${p}%'`).join(' OR ');

  let excludeCondition = '';
  if (higherPriorityPatterns.length > 0) {
    const excludePatterns = higherPriorityPatterns.map(p => `pc2.cpc_code LIKE '${p}%'`).join(' OR ');
    excludeCondition = `
      AND pc.patent_id NOT IN (
        SELECT DISTINCT pc2.patent_id FROM patent_cpc_codes pc2
        WHERE pc2.patent_id = ANY($1) AND (${excludePatterns})
      )
    `;
  }

  const result = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT pc.patent_id) as total
    FROM patent_cpc_codes pc
    WHERE pc.patent_id = ANY($1)
      AND (${matchConditions})
      ${excludeCondition}
  `, allPatentIds);

  const bcResult = await prisma.$queryRawUnsafe(`
    SELECT COUNT(DISTINCT pc.patent_id) as total
    FROM patent_cpc_codes pc
    WHERE pc.patent_id = ANY($1)
      AND (${matchConditions})
      ${excludeCondition}
  `, bcPatentIds);

  return {
    total: Number(result[0]?.total || 0),
    broadcom: Number(bcResult[0]?.total || 0),
  };
}

async function main() {
  console.log('Refined Sub-sector Proposal v2 (with priority-based exclusion)\n');
  console.log('='.repeat(75));
  console.log('Target: 100-1000 overall, <500 Broadcom\n');

  // Get patent IDs
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
  const broadcomIds = bcPatents.map(p => p.patentId);

  const switchingSector = await prisma.taxonomyNode.findFirst({
    where: { code: 'network-switching', level: 2 }
  });

  const switchingPatents = await prisma.objectClassification.findMany({
    where: { taxonomyNodeId: switchingSector.id, objectType: 'patent' },
    select: { objectId: true }
  });
  const allPatentIds = switchingPatents.map(c => c.objectId);
  const bcInSwitching = allPatentIds.filter(id => broadcomIds.includes(id));

  for (const [sector, proposals] of Object.entries(REFINED_SUBSECTORS)) {
    console.log('\n' + '='.repeat(75));
    console.log(`${sector.toUpperCase()} - Refined Sub-sectors`);
    console.log('='.repeat(75) + '\n');

    console.log('Code'.padEnd(25) + 'Patterns'.padEnd(30) + 'Total'.padStart(8) + 'Broadcom'.padStart(10) + ' Status');
    console.log('-'.repeat(80));

    // Sort by priority (higher priority = more specific = gets counted first)
    const sorted = [...proposals].sort((a, b) => b.priority - a.priority);
    const usedPatterns = [];

    let sectorTotal = 0;
    let sectorBc = 0;

    for (const proposal of sorted) {
      // For this proposal, exclude patents that match higher-priority patterns
      const sizes = await countExclusive(
        proposal.patterns,
        allPatentIds,
        bcInSwitching,
        usedPatterns
      );

      // Add this proposal's patterns to the exclusion list for lower-priority groups
      usedPatterns.push(...proposal.patterns);

      sectorTotal += sizes.total;
      sectorBc += sizes.broadcom;

      let status = 'OK';
      if (sizes.total < 100) status = 'SMALL';
      else if (sizes.total > 1000) status = 'LARGE';
      else if (sizes.broadcom >= 500) status = 'BC>500';

      const patternsStr = proposal.patterns.slice(0, 2).join(', ') + (proposal.patterns.length > 2 ? '...' : '');

      console.log(
        `${proposal.code.padEnd(24)} ` +
        `${patternsStr.padEnd(29)} ` +
        `${String(sizes.total).padStart(7)} ` +
        `${String(sizes.broadcom).padStart(9)} ` +
        `${status}`
      );
    }

    console.log('-'.repeat(80));
    console.log('Subtotal'.padEnd(55) + String(sectorTotal).padStart(7) + String(sectorBc).padStart(10));
  }

  // Count what's left in general catch-all
  console.log('\n\n' + '='.repeat(75));
  console.log('EXISTING ACCEPTABLE SUB-SECTORS (kept as-is)');
  console.log('='.repeat(75));
  console.log('\nethernet-lan: ~426 total, ~260 Broadcom - OK');
  console.log('network-interconnect: ~470 total, ~240 Broadcom - OK');
  console.log('general (switching catch-all): ~489 total, ~266 Broadcom - OK');

  await prisma.$disconnect();
}

main().catch(console.error);
