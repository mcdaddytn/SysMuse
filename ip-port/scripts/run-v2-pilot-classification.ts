/**
 * Run v2 Pilot Classification
 *
 * Classifies patents in the network-switching sector using v2 sub-sector rules.
 *
 * Usage:
 *   npx ts-node scripts/run-v2-pilot-classification.ts [--dry-run] [--limit N]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const V2_TAXONOMY_TYPE_ID = 'tt_patent_v2';
const V1_SWITCHING_SECTOR_CODE = 'network-switching';
const V2_PILOT_GROUP_ID = 'pg_v2_pilot';
const CONFIG_VERSION = 1;

interface ClassificationResult {
  patentId: string;
  nodeId: string;
  nodeCode: string;
  rank: number;
  weight: number;
  sourceCodes: string[];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : undefined;

  console.log('v2 Pilot Classification');
  console.log('=======================\n');

  if (dryRun) {
    console.log('DRY RUN MODE - No changes will be made\n');
  }

  // 0. Ensure v2 pilot portfolio group exists
  const existingGroup = await prisma.portfolioGroup.findUnique({
    where: { id: V2_PILOT_GROUP_ID },
  });

  if (!existingGroup && !dryRun) {
    await prisma.portfolioGroup.create({
      data: {
        id: V2_PILOT_GROUP_ID,
        name: 'v2-pilot',
        displayName: 'v2 Taxonomy Pilot',
        description: 'Pilot portfolio group for testing v2 taxonomy classifications',
        taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
        config: {
          privilegedAssociationCount: 3,
        },
      },
    });
    console.log('Created v2 pilot portfolio group\n');
  }

  // 1. Get v2 taxonomy rules
  const v2Rules = await prisma.taxonomyRule.findMany({
    where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID },
    include: { targetNode: true },
    orderBy: { priority: 'desc' },
  });

  console.log(`Loaded ${v2Rules.length} v2 rules:\n`);
  for (const rule of v2Rules) {
    console.log(`  ${rule.expression} -> ${rule.targetNode.code} (priority ${rule.priority})`);
  }
  console.log();

  // 2. Get network-switching sector from v1
  const switchingSector = await prisma.taxonomyNode.findFirst({
    where: { code: V1_SWITCHING_SECTOR_CODE, level: 2 },
  });

  if (!switchingSector) {
    console.log('ERROR: network-switching sector not found in v1');
    await prisma.$disconnect();
    return;
  }

  // 3. Get patents classified to network-switching in v1
  const classifications = await prisma.objectClassification.findMany({
    where: {
      taxonomyNodeId: switchingSector.id,
      objectType: 'patent',
    },
    select: { objectId: true },
    take: limit,
  });

  const patentIds = classifications.map((c) => c.objectId);
  console.log(`Found ${patentIds.length} patents in network-switching sector\n`);

  // 4. Get CPC codes for these patents
  const patentCpcs = await prisma.patentCpc.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, cpcCode: true, isInventive: true },
  });

  // Group CPCs by patent
  const cpcsByPatent = new Map<string, { cpcCode: string; isInventive: boolean }[]>();
  for (const pc of patentCpcs) {
    if (!cpcsByPatent.has(pc.patentId)) {
      cpcsByPatent.set(pc.patentId, []);
    }
    cpcsByPatent.get(pc.patentId)!.push({ cpcCode: pc.cpcCode, isInventive: pc.isInventive });
  }

  // 5. Classify each patent using v2 rules
  const results: ClassificationResult[] = [];
  const nodeStats = new Map<string, number>();
  let noMatchCount = 0;

  for (const patentId of patentIds) {
    const cpcs = cpcsByPatent.get(patentId) || [];
    const scores = new Map<string, { nodeId: string; nodeCode: string; weight: number; sources: string[] }>();

    for (const cpc of cpcs) {
      // Find the HIGHEST PRIORITY matching rule for this CPC
      // Rules are already sorted by priority desc, so first match wins
      let bestMatch: typeof v2Rules[0] | null = null;

      for (const rule of v2Rules) {
        if (rule.isExclusion) continue;

        // CPC matching: expression like "H04L12/28" or "H04L45/"
        const normalizedCpc = cpc.cpcCode.replace(/\//g, '');
        const normalizedExpr = rule.expression.replace(/\//g, '');

        const matches =
          rule.ruleType === 'CPC_PREFIX'
            ? normalizedCpc.startsWith(normalizedExpr)
            : normalizedCpc === normalizedExpr;

        if (matches) {
          // First match is highest priority (rules sorted by priority desc)
          bestMatch = rule;
          break;
        }
      }

      // Only add weight to the best matching rule's target
      if (bestMatch) {
        const cpcWeight = cpc.isInventive ? 1.0 : 0.3;
        const priorityMultiplier = 1.0 + bestMatch.priority * 0.01;
        const weight = cpcWeight * priorityMultiplier;

        const existing = scores.get(bestMatch.targetNodeId);
        if (existing) {
          existing.weight += weight;
          if (!existing.sources.includes(cpc.cpcCode)) {
            existing.sources.push(cpc.cpcCode);
          }
        } else {
          scores.set(bestMatch.targetNodeId, {
            nodeId: bestMatch.targetNodeId,
            nodeCode: bestMatch.targetNode.code,
            weight,
            sources: [cpc.cpcCode],
          });
        }
      }
    }

    // Sort by weight and take top 3
    const sorted = Array.from(scores.values()).sort((a, b) => b.weight - a.weight);

    if (sorted.length === 0) {
      noMatchCount++;
      // Assign to general catch-all
      const generalNode = v2Rules.find((r) => r.targetNode.code.endsWith('/general'));
      if (generalNode) {
        results.push({
          patentId,
          nodeId: generalNode.targetNodeId,
          nodeCode: generalNode.targetNode.code,
          rank: 1,
          weight: 0,
          sourceCodes: [],
        });
        nodeStats.set(generalNode.targetNode.code, (nodeStats.get(generalNode.targetNode.code) || 0) + 1);
      }
    } else {
      for (let i = 0; i < Math.min(3, sorted.length); i++) {
        const s = sorted[i];
        results.push({
          patentId,
          nodeId: s.nodeId,
          nodeCode: s.nodeCode,
          rank: i + 1,
          weight: s.weight,
          sourceCodes: s.sources,
        });

        if (i === 0) {
          nodeStats.set(s.nodeCode, (nodeStats.get(s.nodeCode) || 0) + 1);
        }
      }
    }
  }

  // 6. Print statistics
  console.log('Classification Results:\n');
  console.log('-'.repeat(60));

  const sortedStats = Array.from(nodeStats.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedStats) {
    const pct = ((count / patentIds.length) * 100).toFixed(1);
    console.log(`${code.padEnd(30)}: ${String(count).padStart(5)} patents (${pct}%)`);
  }
  console.log('-'.repeat(60));
  console.log(`Total patents classified: ${patentIds.length}`);
  console.log(`No rule match (catch-all): ${noMatchCount}`);

  // 7. Save classifications
  if (!dryRun) {
    console.log('\nSaving classifications...');

    // Clear existing v2 classifications for these patents in the pilot group
    await prisma.objectClassification.deleteMany({
      where: {
        portfolioGroupId: V2_PILOT_GROUP_ID,
        objectId: { in: patentIds },
      },
    });

    // Insert new classifications
    let created = 0;
    for (const r of results) {
      await prisma.objectClassification.create({
        data: {
          objectType: 'patent',
          objectId: r.patentId,
          taxonomyNodeId: r.nodeId,
          associationRank: r.rank,
          weight: r.weight,
          sourceCodes: r.sourceCodes,
          assignedBy: 'v2-pilot-script',
          configVersion: CONFIG_VERSION,
          portfolioGroupId: V2_PILOT_GROUP_ID,
        },
      });
      created++;
      if (created % 1000 === 0) {
        console.log(`  Created ${created} classifications...`);
      }
    }

    console.log(`\nCreated ${created} total classifications`);
  } else {
    console.log('\nDRY RUN - no changes saved');
  }

  // 8. Sample output (patents with multiple sub-sector classifications)
  console.log('\n\nSample Multi-Classification Patents:\n');
  const multiClassPatents = new Set<string>();
  for (const r of results) {
    if (r.rank === 2) multiClassPatents.add(r.patentId);
  }

  const samplePatents = Array.from(multiClassPatents).slice(0, 10);
  for (const pid of samplePatents) {
    const patentResults = results.filter((r) => r.patentId === pid);
    const patent = await prisma.patent.findUnique({
      where: { id: pid },
      select: { patentId: true, title: true },
    });
    if (patent) {
      console.log(`${patent.patentId}: ${(patent.title || '').substring(0, 50)}...`);
      for (const r of patentResults) {
        console.log(`  Rank ${r.rank}: ${r.nodeCode} (weight ${r.weight.toFixed(2)}) [${r.sourceCodes.slice(0, 3).join(', ')}]`);
      }
      console.log();
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('Classification failed:', error);
  process.exit(1);
});
