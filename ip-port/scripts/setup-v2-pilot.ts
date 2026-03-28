/**
 * Setup v2 Taxonomy Pilot
 *
 * Creates the v2 TaxonomyType and pilot nodes for network-switching sub-sectors.
 *
 * Usage:
 *   npx ts-node scripts/setup-v2-pilot.ts [--dry-run]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// =============================================================================
// Configuration
// =============================================================================

const V2_TAXONOMY_TYPE = {
  id: 'tt_patent_v2',
  name: 'patent-classification-v2',
  displayName: 'Patent Classification v2',
  description: 'Logical sub-sectors with multiple CPC patterns per node',
  objectType: 'patent',
  maxDepth: 3,
  levelLabels: ['Super-sector', 'Sector', 'Sub-sector'],
  ruleType: 'cpc-based',
  isActive: true,
  isDefault: false,
  version: 1,
  config: {
    targetClusterSizes: {
      level1: { min: 5000, max: 15000 },
      level2: { min: 500, max: 5000 },
      level3: { min: 50, max: 500 },
    },
    prefixLengths: { level1: 3, level2: 4, level3: 4 },
  },
};

// Pilot nodes for SDN_NETWORK > network-switching
const PILOT_NODES = [
  // L1: Super-sector
  {
    code: 'sdn-network',
    name: 'SDN & Network Infrastructure',
    abbreviation: 'SDN',
    level: 1,
    parentCode: null,
  },
  // L2: Sector
  {
    code: 'SDN/switching',
    name: 'Network Switching & Routing',
    abbreviation: 'SWIT',
    level: 2,
    parentCode: 'sdn-network',
  },
  // L3: Sub-sectors
  {
    code: 'SDN/SWIT/ethernet-lan',
    name: 'Ethernet/LAN Switching',
    abbreviation: 'ETHL',
    level: 3,
    parentCode: 'SDN/switching',
  },
  {
    code: 'SDN/SWIT/routing',
    name: 'IP Routing & Forwarding',
    abbreviation: 'ROUT',
    level: 3,
    parentCode: 'SDN/switching',
  },
  {
    code: 'SDN/SWIT/traffic-qos',
    name: 'Traffic Management & QoS',
    abbreviation: 'TQOS',
    level: 3,
    parentCode: 'SDN/switching',
  },
  {
    code: 'SDN/SWIT/packet-switching',
    name: 'Packet Switching Elements',
    abbreviation: 'PKSW',
    level: 3,
    parentCode: 'SDN/switching',
  },
  {
    code: 'SDN/SWIT/network-interconnect',
    name: 'Network Interconnection',
    abbreviation: 'INTC',
    level: 3,
    parentCode: 'SDN/switching',
  },
  {
    code: 'SDN/SWIT/general',
    name: 'General Switching',
    abbreviation: 'GNRL',
    level: 3,
    parentCode: 'SDN/switching',
  },
];

// Rules for L3 sub-sectors
const PILOT_RULES = [
  // ethernet-lan
  { targetCode: 'SDN/SWIT/ethernet-lan', expression: 'H04L12/28', priority: 90 },
  { targetCode: 'SDN/SWIT/ethernet-lan', expression: 'H04L12/40', priority: 90 },
  // routing
  { targetCode: 'SDN/SWIT/routing', expression: 'H04L45/', priority: 80 },
  // traffic-qos
  { targetCode: 'SDN/SWIT/traffic-qos', expression: 'H04L47/', priority: 80 },
  // packet-switching
  { targetCode: 'SDN/SWIT/packet-switching', expression: 'H04L49/', priority: 80 },
  // network-interconnect
  { targetCode: 'SDN/SWIT/network-interconnect', expression: 'H04L12/46', priority: 90 },
  // general (catch-all for sector)
  { targetCode: 'SDN/SWIT/general', expression: 'H04L12/', priority: 50 },
];

// =============================================================================
// Main
// =============================================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('Setup v2 Taxonomy Pilot');
  console.log('=======================\n');

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // Check if v2 taxonomy type already exists
  const existing = await prisma.taxonomyType.findUnique({
    where: { id: V2_TAXONOMY_TYPE.id },
  });

  if (existing) {
    console.log('v2 TaxonomyType already exists. Skipping creation.\n');
  } else {
    console.log('Creating v2 TaxonomyType...');
    if (!dryRun) {
      await prisma.taxonomyType.create({
        data: {
          id: V2_TAXONOMY_TYPE.id,
          name: V2_TAXONOMY_TYPE.name,
          displayName: V2_TAXONOMY_TYPE.displayName,
          description: V2_TAXONOMY_TYPE.description,
          objectType: V2_TAXONOMY_TYPE.objectType,
          maxDepth: V2_TAXONOMY_TYPE.maxDepth,
          levelLabels: V2_TAXONOMY_TYPE.levelLabels,
          ruleType: V2_TAXONOMY_TYPE.ruleType,
          isActive: V2_TAXONOMY_TYPE.isActive,
          isDefault: V2_TAXONOMY_TYPE.isDefault,
          version: V2_TAXONOMY_TYPE.version,
        },
      });
      console.log('  Created: ' + V2_TAXONOMY_TYPE.name + '\n');
    } else {
      console.log('  Would create: ' + V2_TAXONOMY_TYPE.name + '\n');
    }
  }

  // Create nodes
  console.log('Creating pilot nodes...');
  const nodeIdMap = new Map<string, string>();

  for (const node of PILOT_NODES) {
    const existingNode = await prisma.taxonomyNode.findFirst({
      where: {
        taxonomyTypeId: V2_TAXONOMY_TYPE.id,
        code: node.code,
      },
    });

    if (existingNode) {
      console.log('  Exists: ' + node.code);
      nodeIdMap.set(node.code, existingNode.id);
      continue;
    }

    const parentId = node.parentCode ? nodeIdMap.get(node.parentCode) : null;

    if (node.parentCode && !parentId) {
      console.log('  ERROR: Parent not found for ' + node.code);
      continue;
    }

    if (!dryRun) {
      // Build materialized path
      let path = node.code;
      if (node.parentCode) {
        // Parent path is stored - we need to look it up
        const parentNode = await prisma.taxonomyNode.findUnique({
          where: { id: parentId! },
          select: { path: true }
        });
        if (parentNode) {
          path = parentNode.path + '/' + node.code.split('/').pop();
        }
      }

      const created = await prisma.taxonomyNode.create({
        data: {
          taxonomyTypeId: V2_TAXONOMY_TYPE.id,
          code: node.code,
          name: node.name,
          level: node.level,
          path: path,
          parentId: parentId,
          metadata: { abbreviation: node.abbreviation },
        },
      });
      nodeIdMap.set(node.code, created.id);
      console.log('  Created: ' + node.code + ' (L' + node.level + ')');
    } else {
      nodeIdMap.set(node.code, 'dry-run-id-' + node.code);
      console.log('  Would create: ' + node.code + ' (L' + node.level + ')');
    }
  }

  // Create rules
  console.log('\nCreating pilot rules...');

  for (const rule of PILOT_RULES) {
    const targetNodeId = nodeIdMap.get(rule.targetCode);
    if (!targetNodeId) {
      console.log('  ERROR: Target node not found for ' + rule.targetCode);
      continue;
    }

    const existingRule = await prisma.taxonomyRule.findFirst({
      where: {
        taxonomyTypeId: V2_TAXONOMY_TYPE.id,
        targetNodeId: targetNodeId.startsWith('dry-run') ? undefined : targetNodeId,
        expression: rule.expression,
      },
    });

    if (existingRule) {
      console.log('  Exists: ' + rule.expression + ' -> ' + rule.targetCode);
      continue;
    }

    if (!dryRun) {
      await prisma.taxonomyRule.create({
        data: {
          taxonomyTypeId: V2_TAXONOMY_TYPE.id,
          targetNodeId: targetNodeId,
          ruleType: 'CPC_PREFIX',
          expression: rule.expression,
          priority: rule.priority,
          isExclusion: false,
          scope: 'GLOBAL',
        },
      });
      console.log('  Created: ' + rule.expression + ' -> ' + rule.targetCode);
    } else {
      console.log('  Would create: ' + rule.expression + ' -> ' + rule.targetCode);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));
  console.log('TaxonomyType: ' + V2_TAXONOMY_TYPE.name);
  console.log('Nodes: ' + PILOT_NODES.length);
  console.log('Rules: ' + PILOT_RULES.length);

  if (dryRun) {
    console.log('\nRun without --dry-run to apply changes.');
  } else {
    console.log('\nPilot taxonomy created successfully!');
    console.log('Next: Run classification against v2 taxonomy.');
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
