/**
 * Setup v2 Refined Sub-sectors
 *
 * Creates 30 refined sub-sectors for network-switching based on CPC analysis.
 *
 * Usage:
 *   npx ts-node scripts/setup-v2-refined.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const V2_TAXONOMY_TYPE_ID = 'tt_patent_v2';

// Refined sub-sector definitions
const REFINED_NODES = [
  // L1: Super-sector (keep existing)
  { code: 'sdn-network', name: 'SDN & Network Infrastructure', abbrev: 'SDN', level: 1, parentCode: null },

  // L2: Sector (keep existing)
  { code: 'SDN/switching', name: 'Network Switching & Routing', abbrev: 'SWIT', level: 2, parentCode: 'sdn-network' },

  // L3: ROUTING sub-sectors (11)
  { code: 'SDN/SWIT/routing-table-lookup', name: 'Table Lookup & Filtering', abbrev: 'RTBL', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-topology', name: 'Topology Discovery', abbrev: 'RTOP', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-multipath', name: 'Multipath & Alternate Routing', abbrev: 'RMLT', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-shortest-path', name: 'Shortest Path Routing', abbrev: 'RSPT', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-addr-proc', name: 'Address Processing', abbrev: 'RADR', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-general', name: 'General Routing', abbrev: 'RGEN', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-fragmentation', name: 'Fragmentation & Dup Detection', abbrev: 'RFRG', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-prefix-match', name: 'Prefix Matching', abbrev: 'RPFX', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-qos', name: 'QoS-based Routing', abbrev: 'RQOS', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-label-ops', name: 'Label Operations', abbrev: 'RLBL', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/routing-advanced', name: 'SDN/MPLS/Interdomain', abbrev: 'RADV', level: 3, parentCode: 'SDN/switching' },

  // L3: TRAFFIC-QOS sub-sectors (8)
  { code: 'SDN/SWIT/qos-scheduling-priority', name: 'Priority Scheduling', abbrev: 'QSPR', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/qos-scheduling-core', name: 'Core Scheduling', abbrev: 'QSCO', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/qos-bw-reservation', name: 'Bandwidth Reservation', abbrev: 'QBWR', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/qos-admission', name: 'Admission Control', abbrev: 'QADM', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/qos-bw-allocation', name: 'Bandwidth Allocation', abbrev: 'QBWA', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/qos-priority', name: 'Priority Handling', abbrev: 'QPRI', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/qos-congestion', name: 'Congestion Control', abbrev: 'QCON', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/qos-other', name: 'QoS Shaping/Marking/Other', abbrev: 'QOTH', level: 3, parentCode: 'SDN/switching' },

  // L3: PACKET-SWITCHING sub-sectors (8)
  { code: 'SDN/SWIT/pkt-ports', name: 'Port Handling', abbrev: 'PPRT', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/pkt-buffer-addr', name: 'Buffer Addressing', abbrev: 'PBFA', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/pkt-input', name: 'Input Processing', abbrev: 'PINP', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/pkt-crossbar', name: 'Crossbar Switches', abbrev: 'PXBR', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/pkt-fabric', name: 'Switch Fabric', abbrev: 'PFAB', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/pkt-multicast', name: 'Multicast Switching', abbrev: 'PMCS', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/pkt-buffer-mgmt', name: 'Buffer Management', abbrev: 'PBFM', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/pkt-other', name: 'Packet Switch Other', abbrev: 'POTH', level: 3, parentCode: 'SDN/switching' },

  // L3: EXISTING sub-sectors (3)
  { code: 'SDN/SWIT/ethernet-lan', name: 'Ethernet/LAN Switching', abbrev: 'ETHL', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/network-interconnect', name: 'Network Interconnection', abbrev: 'INTC', level: 3, parentCode: 'SDN/switching' },
  { code: 'SDN/SWIT/general', name: 'General Switching', abbrev: 'GNRL', level: 3, parentCode: 'SDN/switching' },
];

// Rules with priorities (higher = more specific, assigned first)
const REFINED_RULES = [
  // ROUTING rules
  { targetCode: 'SDN/SWIT/routing-table-lookup', patterns: ['H04L45/745', 'H04L45/7453'], priority: 85 },
  { targetCode: 'SDN/SWIT/routing-topology', patterns: ['H04L45/02', 'H04L45/03'], priority: 80 },
  { targetCode: 'SDN/SWIT/routing-multipath', patterns: ['H04L45/22', 'H04L45/24'], priority: 80 },
  { targetCode: 'SDN/SWIT/routing-shortest-path', patterns: ['H04L45/12'], priority: 80 },
  { targetCode: 'SDN/SWIT/routing-addr-proc', patterns: ['H04L45/74', 'H04L45/70'], priority: 75 },
  { targetCode: 'SDN/SWIT/routing-fragmentation', patterns: ['H04L45/64', 'H04L45/66'], priority: 80 },
  { targetCode: 'SDN/SWIT/routing-prefix-match', patterns: ['H04L45/38'], priority: 80 },
  { targetCode: 'SDN/SWIT/routing-qos', patterns: ['H04L45/30'], priority: 80 },
  { targetCode: 'SDN/SWIT/routing-label-ops', patterns: ['H04L45/54', 'H04L45/58'], priority: 75 },
  { targetCode: 'SDN/SWIT/routing-advanced', patterns: ['H04L45/76', 'H04L45/50', 'H04L45/04', 'H04L45/42', 'H04L45/44'], priority: 70 },
  { targetCode: 'SDN/SWIT/routing-general', patterns: ['H04L45/00', 'H04L45/06', 'H04L45/16', 'H04L45/28'], priority: 50 },

  // TRAFFIC-QOS rules
  { targetCode: 'SDN/SWIT/qos-scheduling-priority', patterns: ['H04L47/12', 'H04L47/125'], priority: 80 },
  { targetCode: 'SDN/SWIT/qos-scheduling-core', patterns: ['H04L47/10', 'H04L47/11'], priority: 80 },
  { targetCode: 'SDN/SWIT/qos-bw-reservation', patterns: ['H04L47/24', 'H04L47/2433', 'H04L47/2441'], priority: 80 },
  { targetCode: 'SDN/SWIT/qos-admission', patterns: ['H04L47/70', 'H04L47/72', 'H04L47/74', 'H04L47/76', 'H04L47/78'], priority: 80 },
  { targetCode: 'SDN/SWIT/qos-bw-allocation', patterns: ['H04L47/20', 'H04L47/2408'], priority: 80 },
  { targetCode: 'SDN/SWIT/qos-priority', patterns: ['H04L47/80', 'H04L47/805', 'H04L47/82', 'H04L47/822'], priority: 80 },
  { targetCode: 'SDN/SWIT/qos-congestion', patterns: ['H04L47/28', 'H04L47/283', 'H04L47/30', 'H04L47/32', 'H04L47/38'], priority: 75 },
  { targetCode: 'SDN/SWIT/qos-other', patterns: ['H04L47/22', 'H04L47/215', 'H04L47/50', 'H04L47/52', 'H04L47/00', 'H04L47/193', 'H04L47/263', 'H04L47/2475', 'H04L47/2483'], priority: 50 },

  // PACKET-SWITCHING rules
  { targetCode: 'SDN/SWIT/pkt-ports', patterns: ['H04L49/90', 'H04L49/901'], priority: 80 },
  { targetCode: 'SDN/SWIT/pkt-buffer-addr', patterns: ['H04L49/25', 'H04L49/254'], priority: 80 },
  { targetCode: 'SDN/SWIT/pkt-input', patterns: ['H04L49/10', 'H04L49/101', 'H04L49/103', 'H04L49/109'], priority: 80 },
  { targetCode: 'SDN/SWIT/pkt-crossbar', patterns: ['H04L49/351', 'H04L49/352', 'H04L49/354', 'H04L49/357'], priority: 80 },
  { targetCode: 'SDN/SWIT/pkt-fabric', patterns: ['H04L49/30', 'H04L49/3009', 'H04L49/3063'], priority: 80 },
  { targetCode: 'SDN/SWIT/pkt-multicast', patterns: ['H04L49/70'], priority: 80 },
  { targetCode: 'SDN/SWIT/pkt-buffer-mgmt', patterns: ['H04L49/20', 'H04L49/201'], priority: 80 },
  { targetCode: 'SDN/SWIT/pkt-other', patterns: ['H04L49/15', 'H04L49/60', 'H04L49/602', 'H04L49/9047', 'H04L49/00'], priority: 50 },

  // EXISTING rules - lower priority than H04L45/47/49 rules
  { targetCode: 'SDN/SWIT/ethernet-lan', patterns: ['H04L12/28', 'H04L12/40'], priority: 60 },
  { targetCode: 'SDN/SWIT/network-interconnect', patterns: ['H04L12/46'], priority: 60 },
  { targetCode: 'SDN/SWIT/general', patterns: ['H04L12/'], priority: 40 },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Setup v2 Refined Sub-sectors');
  console.log('============================\n');

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // 1. Clear existing v2 classifications, nodes and rules
  console.log('Clearing existing v2 data...');
  if (!dryRun) {
    // First clear classifications that reference v2 nodes
    const v2Nodes = await prisma.taxonomyNode.findMany({
      where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID },
      select: { id: true },
    });
    const v2NodeIds = v2Nodes.map((n) => n.id);

    if (v2NodeIds.length > 0) {
      const deletedClassifications = await prisma.objectClassification.deleteMany({
        where: { taxonomyNodeId: { in: v2NodeIds } },
      });
      console.log(`  Deleted ${deletedClassifications.count} classifications`);
    }

    await prisma.taxonomyRule.deleteMany({
      where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID },
    });
    await prisma.taxonomyNode.deleteMany({
      where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID },
    });
    console.log('  Cleared existing nodes and rules\n');
  }

  // 2. Create nodes
  console.log('Creating taxonomy nodes...');
  const nodeIdMap = new Map<string, string>();

  for (const node of REFINED_NODES) {
    const parentId = node.parentCode ? nodeIdMap.get(node.parentCode) : null;

    if (node.parentCode && !parentId && !dryRun) {
      console.log(`  ERROR: Parent not found for ${node.code}`);
      continue;
    }

    // Build path
    let path = node.code;
    if (node.parentCode && parentId && !dryRun) {
      const parentNode = await prisma.taxonomyNode.findUnique({
        where: { id: parentId },
        select: { path: true },
      });
      if (parentNode) {
        const slug = node.code.split('/').pop();
        path = parentNode.path + '/' + slug;
      }
    }

    if (!dryRun) {
      const created = await prisma.taxonomyNode.create({
        data: {
          taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
          code: node.code,
          name: node.name,
          level: node.level,
          path: path,
          parentId: parentId,
          metadata: { abbreviation: node.abbrev },
        },
      });
      nodeIdMap.set(node.code, created.id);
      console.log(`  Created: ${node.code} (L${node.level})`);
    } else {
      nodeIdMap.set(node.code, 'dry-run-' + node.code);
      console.log(`  Would create: ${node.code} (L${node.level})`);
    }
  }

  // 3. Create rules
  console.log('\nCreating taxonomy rules...');
  let ruleCount = 0;

  for (const rule of REFINED_RULES) {
    const targetNodeId = nodeIdMap.get(rule.targetCode);
    if (!targetNodeId) {
      console.log(`  ERROR: Target node not found for ${rule.targetCode}`);
      continue;
    }

    for (const pattern of rule.patterns) {
      if (!dryRun) {
        await prisma.taxonomyRule.create({
          data: {
            taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
            targetNodeId: targetNodeId,
            ruleType: 'CPC_PREFIX',
            expression: pattern,
            priority: rule.priority,
            isExclusion: false,
            scope: 'GLOBAL',
          },
        });
        ruleCount++;
      } else {
        ruleCount++;
      }
    }
    console.log(`  ${dryRun ? 'Would create' : 'Created'}: ${rule.patterns.length} rules -> ${rule.targetCode} (priority ${rule.priority})`);
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log(`Nodes: ${REFINED_NODES.length}`);
  console.log(`Rules: ${ruleCount}`);

  if (dryRun) {
    console.log('\nRun without --dry-run to apply changes.');
  } else {
    console.log('\nRefined sub-sectors created successfully!');
    console.log('Next: Run classification with run-v2-pilot-classification.ts');
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
