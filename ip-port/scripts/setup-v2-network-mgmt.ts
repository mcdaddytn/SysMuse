/**
 * Setup v2 Sub-sectors for Network-Management
 *
 * Creates 18 sub-sectors for network-management based on CPC analysis.
 * Adds to existing v2 taxonomy alongside network-switching sub-sectors.
 *
 * Usage:
 *   npx ts-node scripts/setup-v2-network-mgmt.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const V2_TAXONOMY_TYPE_ID = 'tt_patent_v2';
const SDN_PARENT_CODE = 'sdn-network'; // existing L1

// New L2 sector + L3 sub-sector definitions
const NODES = [
  // L2: Management sector (new, under existing sdn-network L1)
  { code: 'SDN/management', name: 'Network Management & Monitoring', abbrev: 'MGMT', level: 2, parentCode: 'sdn-network' },

  // L3: CONFIGURATION MANAGEMENT (H04L41/08 split into 4)
  { code: 'SDN/MGMT/config-provision', name: 'Config & Provisioning', abbrev: 'CFGP', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/config-sdn-nfv', name: 'SDN/NFV Configuration', abbrev: 'CFGS', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/config-automation', name: 'Config Automation & Ops', abbrev: 'CFGA', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/config-policy', name: 'Policy & Access Control', abbrev: 'CFGX', level: 3, parentCode: 'SDN/management' },

  // L3: FAULT & ALARM
  { code: 'SDN/MGMT/fault-alarm', name: 'Fault & Alarm Management', abbrev: 'FLTA', level: 3, parentCode: 'SDN/management' },

  // L3: NFV & VIRTUALIZATION
  { code: 'SDN/MGMT/nfv-orchestration', name: 'NFV & Orchestration', abbrev: 'NFVO', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/nfv-vnf-sfc', name: 'VNF & Service Function Chaining', abbrev: 'VNFS', level: 3, parentCode: 'SDN/management' },

  // L3: TOPOLOGY & ANALYSIS
  { code: 'SDN/MGMT/topology-discovery', name: 'Topology & Discovery', abbrev: 'TOPD', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/network-analysis', name: 'Network Analysis & Prediction', abbrev: 'NETA', level: 3, parentCode: 'SDN/management' },

  // L3: SERVICE & SLA
  { code: 'SDN/MGMT/service-sla', name: 'Service Level & SLA Mgmt', abbrev: 'SSLA', level: 3, parentCode: 'SDN/management' },

  // L3: ML/AI
  { code: 'SDN/MGMT/ml-ai-mgmt', name: 'ML/AI for Management', abbrev: 'MLAI', level: 3, parentCode: 'SDN/management' },

  // L3: MANAGEMENT GENERAL (catch-all for remaining H04L41)
  { code: 'SDN/MGMT/mgmt-general', name: 'General Management', abbrev: 'MGEN', level: 3, parentCode: 'SDN/management' },

  // L3: MONITORING (H04L43/)
  { code: 'SDN/MGMT/mon-metrics-qos', name: 'Metrics & QoS Monitoring', abbrev: 'MMQO', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/mon-active-probe', name: 'Active Monitoring & Probes', abbrev: 'MACT', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/mon-capture-flow', name: 'Traffic Capture & Flow', abbrev: 'MCAP', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/mon-reporting', name: 'Monitoring Reports & Analysis', abbrev: 'MRPT', level: 3, parentCode: 'SDN/management' },

  // L3: ADDRESSING (H04L61/)
  { code: 'SDN/MGMT/addr-allocation', name: 'Address Allocation & DHCP', abbrev: 'AALL', level: 3, parentCode: 'SDN/management' },
  { code: 'SDN/MGMT/addr-mapping-dns', name: 'Address Mapping & DNS', abbrev: 'AMAP', level: 3, parentCode: 'SDN/management' },
];

// Rules with priorities (higher = more specific, first match wins)
const RULES = [
  // CONFIG MANAGEMENT - H04L41/08xx 4-digit specific subgroups (priority 85)
  { targetCode: 'SDN/MGMT/config-provision', patterns: ['H04L41/0806', 'H04L41/082', 'H04L41/083', 'H04L41/084', 'H04L41/085'], priority: 85 },
  { targetCode: 'SDN/MGMT/config-sdn-nfv', patterns: ['H04L41/0803', 'H04L41/0813', 'H04L41/0816', 'H04L41/0823'], priority: 85 },
  { targetCode: 'SDN/MGMT/config-automation', patterns: ['H04L41/0893', 'H04L41/0894', 'H04L41/0895', 'H04L41/0896', 'H04L41/0897'], priority: 85 },
  { targetCode: 'SDN/MGMT/config-policy', patterns: ['H04L41/0853', 'H04L41/0866', 'H04L41/0873', 'H04L41/0886'], priority: 85 },

  // H04L41/8xx 3-digit series (SDN/VM/ML management) - DIFFERENT from 08xx above
  // SDN management (H04L41/80x, 81x) → config-sdn-nfv
  { targetCode: 'SDN/MGMT/config-sdn-nfv', patterns: ['H04L41/803', 'H04L41/806', 'H04L41/809', 'H04L41/813', 'H04L41/816'], priority: 85 },
  // VM/VNF management (H04L41/82x, 83x, 85x) → nfv-vnf-sfc
  { targetCode: 'SDN/MGMT/nfv-vnf-sfc', patterns: ['H04L41/82', 'H04L41/823', 'H04L41/826', 'H04L41/83', 'H04L41/833', 'H04L41/836', 'H04L41/85', 'H04L41/853', 'H04L41/856', 'H04L41/859'], priority: 85 },
  // Predictive management (H04L41/84x) → network-analysis
  { targetCode: 'SDN/MGMT/network-analysis', patterns: ['H04L41/84', 'H04L41/843', 'H04L41/846'], priority: 85 },
  // Policy/access/security (H04L41/86x, 87x, 88x) → config-policy
  { targetCode: 'SDN/MGMT/config-policy', patterns: ['H04L41/863', 'H04L41/866', 'H04L41/869', 'H04L41/873', 'H04L41/876', 'H04L41/879', 'H04L41/883', 'H04L41/886', 'H04L41/889'], priority: 85 },
  // ML/AI management (H04L41/89x) → ml-ai-mgmt
  { targetCode: 'SDN/MGMT/ml-ai-mgmt', patterns: ['H04L41/893', 'H04L41/894', 'H04L41/895', 'H04L41/896', 'H04L41/897'], priority: 85 },
  // H04L41/8x broad catch-all (SDN management)
  { targetCode: 'SDN/MGMT/config-sdn-nfv', patterns: ['H04L41/80', 'H04L41/81'], priority: 75 },

  // FAULT & ALARM (H04L41/06xx + H04L41/6xx event/notification series)
  { targetCode: 'SDN/MGMT/fault-alarm', patterns: ['H04L41/06', 'H04L41/064', 'H04L41/065', 'H04L41/069', 'H04L41/0631', 'H04L41/0654'], priority: 75 },
  // H04L41/6xx (3-digit) = event processing, notifications, interworking
  { targetCode: 'SDN/MGMT/fault-alarm', patterns: ['H04L41/604', 'H04L41/609', 'H04L41/613', 'H04L41/618', 'H04L41/622', 'H04L41/627', 'H04L41/631', 'H04L41/636', 'H04L41/654', 'H04L41/659', 'H04L41/661', 'H04L41/663', 'H04L41/668', 'H04L41/672', 'H04L41/677', 'H04L41/681', 'H04L41/686', 'H04L41/69', 'H04L41/695'], priority: 75 },
  // H04L41/6x broad catch
  { targetCode: 'SDN/MGMT/fault-alarm', patterns: ['H04L41/64', 'H04L41/65'], priority: 70 },

  // NFV & VIRTUALIZATION - specific subgroups (priority 85)
  { targetCode: 'SDN/MGMT/nfv-orchestration', patterns: ['H04L41/5009', 'H04L41/5019', 'H04L41/5025'], priority: 85 },
  { targetCode: 'SDN/MGMT/nfv-vnf-sfc', patterns: ['H04L41/5051', 'H04L41/5054', 'H04L41/5067', 'H04L41/5096'], priority: 85 },

  // TOPOLOGY & ANALYSIS
  { targetCode: 'SDN/MGMT/topology-discovery', patterns: ['H04L41/12', 'H04L41/122', 'H04L41/22'], priority: 75 },
  { targetCode: 'SDN/MGMT/network-analysis', patterns: ['H04L41/14', 'H04L41/142', 'H04L41/145', 'H04L41/147', 'H04L41/149'], priority: 75 },

  // SERVICE & SLA (includes H04L41/42, 44, 48)
  { targetCode: 'SDN/MGMT/service-sla', patterns: ['H04L41/40', 'H04L41/42', 'H04L41/44', 'H04L41/46', 'H04L41/48'], priority: 75 },

  // ML/AI (H04L41/16 - 4-digit series)
  { targetCode: 'SDN/MGMT/ml-ai-mgmt', patterns: ['H04L41/16'], priority: 75 },

  // NFV broad catch (priority 70) - catches remaining H04L41/50* not caught above
  { targetCode: 'SDN/MGMT/nfv-orchestration', patterns: ['H04L41/50'], priority: 70 },

  // MANAGEMENT GENERAL - broader patterns (catch-all for H04L41)
  { targetCode: 'SDN/MGMT/mgmt-general', patterns: ['H04L41/02', 'H04L41/04', 'H04L41/046', 'H04L41/34', 'H04L41/20', 'H04L41/21', 'H04L41/24', 'H04L41/26', 'H04L41/28', 'H04L41/30', 'H04L41/32'], priority: 60 },
  // H04L41/08 broad catch-all for remaining config patents (4-digit series)
  { targetCode: 'SDN/MGMT/config-provision', patterns: ['H04L41/08'], priority: 50 },
  // H04L41/8 broad catch-all for remaining SDN mgmt (3-digit series)
  { targetCode: 'SDN/MGMT/config-sdn-nfv', patterns: ['H04L41/8'], priority: 45 },
  // H04L41/6 broad catch-all for remaining event/notification
  { targetCode: 'SDN/MGMT/fault-alarm', patterns: ['H04L41/6'], priority: 45 },
  // H04L41/ ultimate catch-all
  { targetCode: 'SDN/MGMT/mgmt-general', patterns: ['H04L41/'], priority: 40 },

  // MONITORING (H04L43/) - 4-digit series (H04L43/08xx)
  { targetCode: 'SDN/MGMT/mon-metrics-qos', patterns: ['H04L43/08', 'H04L43/0811', 'H04L43/0817', 'H04L43/0823', 'H04L43/0829', 'H04L43/087', 'H04L43/091'], priority: 80 },
  // H04L43/8xx 3-digit series (monitoring metrics, parallel to 08xx)
  { targetCode: 'SDN/MGMT/mon-metrics-qos', patterns: ['H04L43/811', 'H04L43/817', 'H04L43/823', 'H04L43/829', 'H04L43/835', 'H04L43/841', 'H04L43/847', 'H04L43/852', 'H04L43/858', 'H04L43/864', 'H04L43/87', 'H04L43/876', 'H04L43/882', 'H04L43/888', 'H04L43/894', 'H04L43/805'], priority: 80 },
  // H04L43/8 broad catch for remaining 3-digit monitoring metrics
  { targetCode: 'SDN/MGMT/mon-metrics-qos', patterns: ['H04L43/8'], priority: 70 },

  { targetCode: 'SDN/MGMT/mon-active-probe', patterns: ['H04L43/10', 'H04L43/103', 'H04L43/106', 'H04L43/12', 'H04L43/14'], priority: 80 },
  { targetCode: 'SDN/MGMT/mon-capture-flow', patterns: ['H04L43/02', 'H04L43/022', 'H04L43/024', 'H04L43/026', 'H04L43/028', 'H04L43/04', 'H04L43/045'], priority: 80 },
  { targetCode: 'SDN/MGMT/mon-reporting', patterns: ['H04L43/06', 'H04L43/062', 'H04L43/065', 'H04L43/067', 'H04L43/16', 'H04L43/20', 'H04L43/50', 'H04L43/55'], priority: 75 },
  // H04L43/ catch-all
  { targetCode: 'SDN/MGMT/mon-reporting', patterns: ['H04L43/00', 'H04L43/'], priority: 40 },

  // ADDRESSING (H04L61/)
  { targetCode: 'SDN/MGMT/addr-allocation', patterns: ['H04L61/50', 'H04L61/5007', 'H04L61/5014', 'H04L61/5038', 'H04L61/5046', 'H04L61/5053', 'H04L61/5061', 'H04L61/5069', 'H04L61/5076', 'H04L61/5084', 'H04L61/5092', 'H04L61/503', 'H04L61/58', 'H04L61/59'], priority: 80 },
  { targetCode: 'SDN/MGMT/addr-mapping-dns', patterns: ['H04L61/09', 'H04L61/10', 'H04L61/103', 'H04L61/106', 'H04L61/25', 'H04L61/2514', 'H04L61/45', 'H04L61/4511', 'H04L61/30', 'H04L61/35', 'H04L61/6022', 'H04L61/6068'], priority: 80 },
  // H04L61/ catch-all
  { targetCode: 'SDN/MGMT/addr-mapping-dns', patterns: ['H04L61/00', 'H04L61/'], priority: 40 },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Setup v2 Network-Management Sub-sectors');
  console.log('========================================\n');

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // 1. Clear existing network-management v2 nodes/rules (but NOT switching nodes)
  console.log('Clearing existing network-management v2 data...');
  if (!dryRun) {
    // Find management-related nodes
    const mgmtNodes = await prisma.taxonomyNode.findMany({
      where: {
        taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
        OR: [
          { code: 'SDN/management' },
          { code: { startsWith: 'SDN/MGMT/' } },
        ],
      },
      select: { id: true },
    });
    const mgmtNodeIds = mgmtNodes.map((n) => n.id);

    if (mgmtNodeIds.length > 0) {
      const deletedClassifications = await prisma.objectClassification.deleteMany({
        where: { taxonomyNodeId: { in: mgmtNodeIds } },
      });
      console.log(`  Deleted ${deletedClassifications.count} classifications`);

      await prisma.taxonomyRule.deleteMany({
        where: { targetNodeId: { in: mgmtNodeIds } },
      });

      await prisma.taxonomyNode.deleteMany({
        where: { id: { in: mgmtNodeIds } },
      });
      console.log(`  Cleared ${mgmtNodeIds.length} existing management nodes\n`);
    } else {
      console.log('  No existing management nodes to clear\n');
    }
  }

  // 2. Create nodes
  console.log('Creating taxonomy nodes...');
  const nodeIdMap = new Map<string, string>();

  // Load existing nodes so we can find sdn-network parent
  const existingNodes = await prisma.taxonomyNode.findMany({
    where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID },
    select: { id: true, code: true, path: true },
  });
  for (const n of existingNodes) {
    nodeIdMap.set(n.code, n.id);
  }

  for (const node of NODES) {
    const parentId = node.parentCode ? nodeIdMap.get(node.parentCode) : null;

    if (node.parentCode && !parentId && !dryRun) {
      console.log(`  ERROR: Parent not found for ${node.code} (parent=${node.parentCode})`);
      continue;
    }

    // Build path
    let path = node.code;
    if (parentId && !dryRun) {
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
      console.log(`  Created: ${node.code} (L${node.level}) - ${node.name}`);
    } else {
      nodeIdMap.set(node.code, 'dry-run-' + node.code);
      console.log(`  Would create: ${node.code} (L${node.level}) - ${node.name}`);
    }
  }

  // 3. Create rules
  console.log('\nCreating taxonomy rules...');
  let ruleCount = 0;

  for (const rule of RULES) {
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
  console.log(`Nodes: ${NODES.length} (1 L2 + ${NODES.length - 1} L3)`);
  console.log(`Rules: ${ruleCount}`);

  if (dryRun) {
    console.log('\nRun without --dry-run to apply changes.');
  } else {
    console.log('\nNetwork-management sub-sectors created successfully!');
    console.log('Next: Run classification with run-v2-mgmt-classification.ts');
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
