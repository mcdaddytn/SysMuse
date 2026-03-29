/**
 * Propose refined sub-sector definitions based on CPC analysis
 * Target: 100-1000 overall, <500 per portfolio
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const V2_PILOT_GROUP_ID = 'pg_v2_pilot';

// Proposed refined sub-sectors based on CPC scheme analysis
const REFINED_ROUTING = [
  { name: 'routing-topology', patterns: ['H04L45/02', 'H04L45/03'], desc: 'Topology update, link state, distance vector' },
  { name: 'routing-path-select', patterns: ['H04L45/12', 'H04L45/22', 'H04L45/24', 'H04L45/28'], desc: 'Shortest path, multipath, alternate' },
  { name: 'routing-qos', patterns: ['H04L45/30', 'H04L45/38'], desc: 'QoS-based routing, multiclass traffic' },
  { name: 'routing-control', patterns: ['H04L45/42', 'H04L45/44', 'H04L45/76'], desc: 'Centralized, distributed, SDN' },
  { name: 'routing-mpls', patterns: ['H04L45/50', 'H04L45/54', 'H04L45/58'], desc: 'Label switching, MPLS' },
  { name: 'routing-lookup', patterns: ['H04L45/74'], desc: 'Address processing, lookup, filtering' },
  { name: 'routing-other', patterns: ['H04L45/00', 'H04L45/04', 'H04L45/06', 'H04L45/64', 'H04L45/66', 'H04L45/70'], desc: 'Interdomain, fragmentation, other' },
];

const REFINED_TRAFFIC_QOS = [
  { name: 'qos-scheduling', patterns: ['H04L47/10', 'H04L47/11', 'H04L47/12', 'H04L47/125'], desc: 'Packet scheduling' },
  { name: 'qos-bandwidth', patterns: ['H04L47/20', 'H04L47/24', 'H04L47/2408', 'H04L47/2433', 'H04L47/2441', 'H04L47/2475', 'H04L47/2483'], desc: 'Bandwidth management' },
  { name: 'qos-congestion', patterns: ['H04L47/28', 'H04L47/283', 'H04L47/30', 'H04L47/32', 'H04L47/38'], desc: 'Congestion control' },
  { name: 'qos-shaping', patterns: ['H04L47/22', 'H04L47/215'], desc: 'Traffic shaping' },
  { name: 'qos-marking', patterns: ['H04L47/50', 'H04L47/52'], desc: 'Marking, tagging' },
  { name: 'qos-admission', patterns: ['H04L47/70', 'H04L47/72', 'H04L47/74', 'H04L47/76', 'H04L47/78'], desc: 'Admission control' },
  { name: 'qos-priority', patterns: ['H04L47/80', 'H04L47/805', 'H04L47/82', 'H04L47/822'], desc: 'Priority handling' },
];

const REFINED_PACKET_SW = [
  { name: 'pkt-switching', patterns: ['H04L49/00', 'H04L49/10', 'H04L49/101', 'H04L49/103', 'H04L49/109', 'H04L49/15'], desc: 'Core switching elements' },
  { name: 'pkt-buffering', patterns: ['H04L49/20', 'H04L49/201', 'H04L49/25', 'H04L49/254'], desc: 'Buffer management' },
  { name: 'pkt-fabric', patterns: ['H04L49/30', 'H04L49/3009', 'H04L49/3063'], desc: 'Switch fabric' },
  { name: 'pkt-crossbar', patterns: ['H04L49/351', 'H04L49/352', 'H04L49/354', 'H04L49/357'], desc: 'Crossbar switches' },
  { name: 'pkt-virtual', patterns: ['H04L49/60', 'H04L49/602'], desc: 'Virtual switching, virtualization' },
  { name: 'pkt-ports', patterns: ['H04L49/70', 'H04L49/90', 'H04L49/901', 'H04L49/9047'], desc: 'Port handling, interconnects' },
];

async function estimatePatternSizes(patterns, patentIds, broadcomIds) {
  // Build query to count patents matching any of these patterns
  const patternConditions = patterns.map(p => {
    const normalized = p.replace('/', '');
    return `pc.cpc_code LIKE '${p}%' OR REPLACE(pc.cpc_code, '/', '') LIKE '${normalized}%'`;
  }).join(' OR ');

  const result = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(DISTINCT pc.patent_id) as total,
      COUNT(DISTINCT CASE WHEN pc.patent_id = ANY($1) THEN pc.patent_id END) as broadcom
    FROM patent_cpc_codes pc
    WHERE pc.patent_id = ANY($2)
      AND (${patternConditions})
  `, broadcomIds, patentIds);

  return {
    total: Number(result[0]?.total || 0),
    broadcom: Number(result[0]?.broadcom || 0),
  };
}

async function main() {
  console.log('Proposed Refined Sub-sector Sizes\n');
  console.log('='.repeat(70));
  console.log('Target: 100-1000 overall, <500 per portfolio\n');

  // Get Broadcom patent IDs
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

  // Get all patents in network-switching
  const switchingSector = await prisma.taxonomyNode.findFirst({
    where: { code: 'network-switching', level: 2 }
  });

  const switchingPatents = await prisma.objectClassification.findMany({
    where: { taxonomyNodeId: switchingSector.id, objectType: 'patent' },
    select: { objectId: true }
  });
  const allPatentIds = switchingPatents.map(c => c.objectId);
  const bcInSwitching = allPatentIds.filter(id => broadcomIds.includes(id));

  // Analyze each proposed refinement
  const refinements = [
    { sector: 'ROUTING', proposals: REFINED_ROUTING },
    { sector: 'TRAFFIC-QOS', proposals: REFINED_TRAFFIC_QOS },
    { sector: 'PACKET-SWITCHING', proposals: REFINED_PACKET_SW },
  ];

  for (const { sector, proposals } of refinements) {
    console.log('\n' + '='.repeat(70));
    console.log(`${sector} - Proposed Sub-sectors`);
    console.log('='.repeat(70) + '\n');

    console.log('Sub-sector'.padEnd(25) + 'Patterns'.padEnd(45) + 'Total'.padStart(8) + 'Broadcom'.padStart(10));
    console.log('-'.repeat(88));

    let sectorTotal = 0;
    let sectorBc = 0;

    for (const proposal of proposals) {
      const sizes = await estimatePatternSizes(proposal.patterns, allPatentIds, bcInSwitching);
      sectorTotal += sizes.total;
      sectorBc += sizes.broadcom;

      const inRange = sizes.total >= 100 && sizes.total <= 1000 && sizes.broadcom < 500;
      const flag = inRange ? '' : ' *';

      console.log(
        `${proposal.name.padEnd(24)} ` +
        `${proposal.patterns.slice(0, 3).join(', ').padEnd(44)} ` +
        `${String(sizes.total).padStart(7)} ` +
        `${String(sizes.broadcom).padStart(9)}${flag}`
      );
    }

    console.log('-'.repeat(88));
    console.log('Subtotal'.padEnd(70) + String(sectorTotal).padStart(7) + String(sectorBc).padStart(10));
    console.log('\n* = outside target range (100-1000 overall, <500 Broadcom)');
  }

  // Summary recommendations
  console.log('\n\n' + '='.repeat(70));
  console.log('SUMMARY & RECOMMENDATIONS');
  console.log('='.repeat(70));
  console.log(`
The refined sub-sectors split the 3 large categories into smaller groups
based on CPC hierarchy. Most fall within target range.

NOTE: Some patents may match multiple sub-sectors (overlapping CPCs).
The actual classification will use priority to resolve conflicts.

For groups still exceeding targets, options:
1. Further split using more specific CPC codes
2. Use AND logic (require multiple CPCs)
3. Accept larger groups for highly-related technologies
`);

  await prisma.$disconnect();
}

main().catch(console.error);
