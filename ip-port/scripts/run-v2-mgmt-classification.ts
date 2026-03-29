/**
 * Run v2 Classification for Network-Management
 *
 * Classifies patents in the network-management sector using v2 sub-sector rules.
 * Only processes rules targeting SDN/MGMT/* nodes.
 *
 * Usage:
 *   npx ts-node scripts/run-v2-mgmt-classification.ts [--dry-run] [--limit N]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const V2_TAXONOMY_TYPE_ID = 'tt_patent_v2';
const V1_SECTOR_CODE = 'network-management';
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

  console.log('v2 Network-Management Classification');
  console.log('====================================\n');

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

  // 1. Get v2 taxonomy rules for MGMT nodes only
  const mgmtNodes = await prisma.taxonomyNode.findMany({
    where: {
      taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
      code: { startsWith: 'SDN/MGMT/' },
    },
    select: { id: true },
  });
  const mgmtNodeIds = mgmtNodes.map((n) => n.id);

  const v2Rules = await prisma.taxonomyRule.findMany({
    where: {
      taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
      targetNodeId: { in: mgmtNodeIds },
    },
    include: { targetNode: true },
    orderBy: { priority: 'desc' },
  });

  console.log(`Loaded ${v2Rules.length} management rules:\n`);
  for (const rule of v2Rules) {
    console.log(`  ${rule.expression.padEnd(18)} -> ${rule.targetNode.code.padEnd(30)} (priority ${rule.priority})`);
  }
  console.log();

  // 2. Get patents classified to network-management in v1 (using patent number)
  const v1Sector = await prisma.taxonomyNode.findFirst({
    where: { code: V1_SECTOR_CODE, level: 2 },
  });

  let patentNums: string[];

  if (v1Sector) {
    // Try via objectClassification first
    const v1Classifications = await prisma.objectClassification.findMany({
      where: {
        taxonomyNodeId: v1Sector.id,
        objectType: 'patent',
      },
      select: { objectId: true },
      take: limit,
    });

    if (v1Classifications.length > 0) {
      patentNums = v1Classifications.map((c) => c.objectId);
    } else {
      // Fallback: use primarySector field
      const patents = await prisma.patent.findMany({
        where: { primarySector: V1_SECTOR_CODE },
        select: { patentId: true },
        take: limit,
      });
      patentNums = patents.map((p) => p.patentId);
    }
  } else {
    // Fallback: use primarySector field
    const patents = await prisma.patent.findMany({
      where: { primarySector: V1_SECTOR_CODE },
      select: { patentId: true },
      take: limit,
    });
    patentNums = patents.map((p) => p.patentId);
  }

  console.log(`Found ${patentNums.length} patents in network-management sector\n`);

  // 3. Get CPC codes for these patents
  const patentCpcs = await prisma.patentCpc.findMany({
    where: { patentId: { in: patentNums } },
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

  console.log(`Loaded CPC codes for ${cpcsByPatent.size} patents\n`);

  // 4. Classify each patent using v2 management rules
  const results: ClassificationResult[] = [];
  const nodeStats = new Map<string, number>();
  let noMatchCount = 0;

  for (const patentId of patentNums) {
    const cpcs = cpcsByPatent.get(patentId) || [];
    const scores = new Map<string, { nodeId: string; nodeCode: string; weight: number; sources: string[] }>();

    for (const cpc of cpcs) {
      // Find the HIGHEST PRIORITY matching rule for this CPC
      let bestMatch: (typeof v2Rules)[0] | null = null;

      for (const rule of v2Rules) {
        if (rule.isExclusion) continue;

        const normalizedCpc = cpc.cpcCode.replace(/\//g, '');
        const normalizedExpr = rule.expression.replace(/\//g, '');

        const matches =
          rule.ruleType === 'CPC_PREFIX'
            ? normalizedCpc.startsWith(normalizedExpr)
            : normalizedCpc === normalizedExpr;

        if (matches) {
          bestMatch = rule;
          break;
        }
      }

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
      // Assign to mgmt-general catch-all
      const generalNode = v2Rules.find((r) => r.targetNode.code === 'SDN/MGMT/mgmt-general');
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

  // 5. Print statistics
  console.log('Classification Results (Primary):\n');
  console.log('-'.repeat(60));

  const sortedStats = Array.from(nodeStats.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedStats) {
    const pct = ((count / patentNums.length) * 100).toFixed(1);
    console.log(`${code.padEnd(35)}: ${String(count).padStart(5)} patents (${pct}%)`);
  }
  console.log('-'.repeat(60));
  console.log(`Total patents classified: ${patentNums.length}`);
  console.log(`No rule match (catch-all): ${noMatchCount}`);
  console.log(`Total classifications: ${results.length}`);
  console.log(`Multi-classification rate: ${((results.filter((r) => r.rank === 2).length / patentNums.length) * 100).toFixed(1)}%`);
  console.log(`Avg classifications/patent: ${(results.length / patentNums.length).toFixed(2)}`);

  // 6. Save classifications
  if (!dryRun) {
    console.log('\nSaving classifications...');

    // Clear ALL existing v2 pilot classifications for these patents
    // (some may have switching classifications from overlap)
    const deleted = await prisma.objectClassification.deleteMany({
      where: {
        portfolioGroupId: V2_PILOT_GROUP_ID,
        objectId: { in: patentNums },
      },
    });
    if (deleted.count > 0) {
      console.log(`  Cleared ${deleted.count} existing classifications for these patents`);
    }

    // Insert new classifications in batches
    let created = 0;
    const BATCH_SIZE = 100;
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);
      await prisma.objectClassification.createMany({
        data: batch.map((r) => ({
          objectType: 'patent' as const,
          objectId: r.patentId,
          taxonomyNodeId: r.nodeId,
          associationRank: r.rank,
          weight: r.weight,
          sourceCodes: r.sourceCodes,
          assignedBy: 'v2-mgmt-script',
          configVersion: CONFIG_VERSION,
          portfolioGroupId: V2_PILOT_GROUP_ID,
        })),
      });
      created += batch.length;
      if (created % 1000 === 0) {
        console.log(`  Created ${created} classifications...`);
      }
    }

    console.log(`\nCreated ${created} total classifications`);
  } else {
    console.log('\nDRY RUN - no changes saved');
  }

  // 7. Portfolio breakdown
  console.log('\n\nPortfolio Breakdown (Primary Classifications):\n');

  // Get portfolio membership for classified patents
  const portfolioPatents = await prisma.$queryRawUnsafe(`
    SELECT po.name as portfolio_name, pp.patent_id
    FROM portfolio_patents pp
    JOIN portfolios po ON po.id = pp.portfolio_id
    WHERE pp.patent_id IN (SELECT patent_id FROM patents WHERE primary_sector = $1)
    ORDER BY po.name
  `, V1_SECTOR_CODE) as { portfolio_name: string; patent_id: string }[];

  const patentPortfolio = new Map<string, string>();
  for (const pp of portfolioPatents) {
    patentPortfolio.set(pp.patent_id, pp.portfolio_name);
  }

  // Count by portfolio and sub-sector
  const portfolioStats = new Map<string, Map<string, number>>();
  for (const r of results) {
    if (r.rank !== 1) continue;
    const portfolio = patentPortfolio.get(r.patentId) || 'unassigned';
    if (!portfolioStats.has(portfolio)) {
      portfolioStats.set(portfolio, new Map());
    }
    const subMap = portfolioStats.get(portfolio)!;
    subMap.set(r.nodeCode, (subMap.get(r.nodeCode) || 0) + 1);
  }

  // Print top portfolios
  const topPortfolios = Array.from(portfolioStats.entries())
    .map(([name, subs]) => ({ name, total: Array.from(subs.values()).reduce((a, b) => a + b, 0), subs }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  for (const portfolio of topPortfolios) {
    console.log(`${portfolio.name} (${portfolio.total} patents):`);
    const sorted = Array.from(portfolio.subs.entries()).sort((a, b) => b[1] - a[1]);
    for (const [code, count] of sorted) {
      console.log(`  ${code.padEnd(35)}: ${count}`);
    }
    console.log();
  }

  // 8. Sample multi-classified patents
  console.log('\nSample Multi-Classification Patents:\n');
  const multiClassPatents = new Set<string>();
  for (const r of results) {
    if (r.rank === 2) multiClassPatents.add(r.patentId);
  }

  const samplePatents = Array.from(multiClassPatents).slice(0, 5);
  for (const pnum of samplePatents) {
    const patentResults = results.filter((r) => r.patentId === pnum);
    const patent = await prisma.patent.findFirst({
      where: { patentId: pnum },
      select: { patentId: true, title: true },
    });
    if (patent) {
      console.log(`${patent.patentId}: ${(patent.title || '').substring(0, 55)}...`);
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
