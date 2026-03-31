/**
 * Re-run v2 classification for sectors that have nodes/rules but missing classifications.
 *
 * This script picks up where run-v2-full-refactor.ts left off after the unique constraint
 * errors were fixed with skipDuplicates.
 *
 * Usage:
 *   npx tsx scripts/run-v2-classify-missing.ts [--sector <code>]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const V2_TAXONOMY_TYPE_ID = 'tt_patent_v2';
const V2_PORTFOLIO_GROUP_ID = 'pg_v2_pilot';
const BROADCOM_PORTFOLIO_ID = 'cmlsddwn2000013ehgqyko2f7';
const BATCH_SIZE = 500;

// Classification config (matches refactor service)
const INVENTIVE_WEIGHT = 1.0;
const ADDITIONAL_WEIGHT = 0.3;
const MAX_ASSOCIATIONS = 3;

interface ClassResult {
  patentId: string;
  nodeId: string;
  rank: number;
  weight: number;
  sourceCodes: string[];
}

async function classifySector(sectorCode: string): Promise<{ patents: number; classifications: number }> {
  // 1. Get the v2 L2 sector node
  const sectorNode = await prisma.taxonomyNode.findFirst({
    where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID, code: sectorCode, level: 2 },
    select: { id: true, code: true },
  });
  if (!sectorNode) throw new Error(`V2 sector ${sectorCode} not found`);

  // 2. Get all L3 sub-sector nodes under this sector
  const subNodes = await prisma.taxonomyNode.findMany({
    where: { taxonomyTypeId: V2_TAXONOMY_TYPE_ID, parentId: sectorNode.id, level: 3 },
    select: { id: true, code: true },
  });
  const subNodeIds = subNodes.map(n => n.id);
  if (subNodeIds.length === 0) return { patents: 0, classifications: 0 };

  // 3. Get rules targeting these sub-sectors
  const rules = await prisma.taxonomyRule.findMany({
    where: {
      taxonomyTypeId: V2_TAXONOMY_TYPE_ID,
      targetNodeId: { in: subNodeIds },
    },
    include: { targetNode: { select: { id: true, code: true } } },
    orderBy: { priority: 'desc' },
  });
  if (rules.length === 0) return { patents: 0, classifications: 0 };

  // 4. Get patent numbers for this sector (from v1 primary_sector)
  const patents = await prisma.patent.findMany({
    where: { primarySector: sectorCode },
    select: { patentId: true },
  });
  const patentNums = patents.map(p => p.patentId);
  if (patentNums.length === 0) return { patents: 0, classifications: 0 };

  // 5. Get CPC codes for all patents
  const patentCpcs = await prisma.patentCpc.findMany({
    where: { patentId: { in: patentNums } },
    select: { patentId: true, cpcCode: true, isInventive: true },
  });

  const cpcsByPatent = new Map<string, { cpcCode: string; isInventive: boolean }[]>();
  for (const pc of patentCpcs) {
    if (!cpcsByPatent.has(pc.patentId)) cpcsByPatent.set(pc.patentId, []);
    cpcsByPatent.get(pc.patentId)!.push({ cpcCode: pc.cpcCode, isInventive: pc.isInventive });
  }

  // 6. Classify each patent
  const results: ClassResult[] = [];

  for (const patentId of patentNums) {
    const cpcs = cpcsByPatent.get(patentId) || [];
    const scores = new Map<string, { nodeId: string; weight: number; sources: string[] }>();

    for (const cpc of cpcs) {
      if (cpc.cpcCode.startsWith('Y')) continue; // Skip indexing codes

      for (const rule of rules) {
        if (rule.isExclusion) continue;

        const normCpc = cpc.cpcCode.replace(/\//g, '');
        const normExpr = rule.expression.replace(/\//g, '');

        const matches = rule.ruleType === 'CPC_PREFIX'
          ? normCpc.startsWith(normExpr)
          : normCpc === normExpr;

        if (matches) {
          const cpcWeight = cpc.isInventive ? INVENTIVE_WEIGHT : ADDITIONAL_WEIGHT;
          const priorityMultiplier = 1.0 + rule.priority * 0.1;
          const weight = cpcWeight * priorityMultiplier;

          const existing = scores.get(rule.targetNodeId);
          if (existing) {
            existing.weight += weight;
            if (!existing.sources.includes(cpc.cpcCode)) existing.sources.push(cpc.cpcCode);
          } else {
            scores.set(rule.targetNodeId, {
              nodeId: rule.targetNodeId,
              weight,
              sources: [cpc.cpcCode],
            });
          }
          break; // First match wins
        }
      }
    }

    const sorted = [...scores.values()].sort((a, b) => b.weight - a.weight);
    const topN = sorted.slice(0, MAX_ASSOCIATIONS);

    for (let rank = 0; rank < topN.length; rank++) {
      results.push({
        patentId,
        nodeId: topN[rank].nodeId,
        rank: rank + 1,
        weight: topN[rank].weight,
        sourceCodes: topN[rank].sources,
      });
    }
  }

  // 7. Insert classifications (skipDuplicates for multi-sector patents)
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const batch = results.slice(i, i + BATCH_SIZE);
    await prisma.objectClassification.createMany({
      data: batch.map(r => ({
        objectType: 'patent' as const,
        objectId: r.patentId,
        taxonomyNodeId: r.nodeId,
        associationRank: r.rank,
        weight: r.weight,
        sourceCodes: r.sourceCodes,
        assignedBy: 'taxonomy-refactor-service',
        configVersion: 1,
        portfolioGroupId: V2_PORTFOLIO_GROUP_ID,
      })),
      skipDuplicates: true,
    });
  }

  return { patents: patentNums.length, classifications: results.length };
}

async function main() {
  const args = process.argv.slice(2);
  const sectorIdx = args.indexOf('--sector');
  const singleSector = sectorIdx !== -1 ? args[sectorIdx + 1] : null;

  console.log('='.repeat(70));
  console.log('  v2 Classification — Fill Missing Sectors');
  console.log('='.repeat(70));

  // Find sectors with nodes but no/few classifications
  const sectorsWithCounts = await prisma.$queryRaw<{
    code: string;
    subsector_count: bigint;
    class_count: bigint;
  }[]>`
    SELECT n2.code, COUNT(DISTINCT n3.id) as subsector_count,
           COUNT(oc.id) as class_count
    FROM taxonomy_nodes n2
    JOIN taxonomy_nodes n3 ON n3.parent_id = n2.id AND n3.level = 3
    LEFT JOIN object_classifications oc ON oc.taxonomy_node_id = n3.id
      AND oc.portfolio_group_id = ${V2_PORTFOLIO_GROUP_ID}
    WHERE n2.taxonomy_type_id = ${V2_TAXONOMY_TYPE_ID} AND n2.level = 2
    GROUP BY n2.code
    ORDER BY n2.code
  `;

  let sectorsToProcess = sectorsWithCounts
    .filter(s => Number(s.class_count) === 0 && Number(s.subsector_count) > 0);

  if (singleSector) {
    sectorsToProcess = sectorsWithCounts.filter(s => s.code === singleSector);
  }

  console.log(`  Sectors needing classification: ${sectorsToProcess.length}`);
  console.log(`  Already classified: ${sectorsWithCounts.length - sectorsToProcess.length}\n`);

  const results: { code: string; patents: number; classifications: number }[] = [];
  const errors: { code: string; error: string }[] = [];
  const startTime = Date.now();

  for (let i = 0; i < sectorsToProcess.length; i++) {
    const sector = sectorsToProcess[i];
    const code = sector.code;
    process.stdout.write(`  [${i + 1}/${sectorsToProcess.length}] ${code.padEnd(30)}`);

    try {
      const sectorStart = Date.now();
      const result = await classifySector(code);
      const elapsed = ((Date.now() - sectorStart) / 1000).toFixed(1);
      console.log(`${String(result.classifications).padStart(6)} classifications (${result.patents} patents) in ${elapsed}s`);
      results.push({ code, ...result });
    } catch (err: any) {
      console.log(`ERROR: ${err.message.split('\n')[0]}`);
      errors.push({ code, error: err.message.split('\n')[0] });
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalClassifications = results.reduce((s, r) => s + r.classifications, 0);
  const totalPatents = results.reduce((s, r) => s + r.patents, 0);

  console.log('\n' + '='.repeat(70));
  console.log(`  Done in ${totalElapsed}s`);
  console.log(`  Sectors: ${results.length}/${sectorsToProcess.length} successful`);
  console.log(`  Patents classified: ${totalPatents.toLocaleString()}`);
  console.log(`  Classifications created: ${totalClassifications.toLocaleString()}`);
  if (errors.length > 0) {
    console.log(`  Errors: ${errors.length}`);
    for (const e of errors) console.log(`    ${e.code}: ${e.error}`);
  }

  // Final state
  const finalCount = await prisma.objectClassification.count({
    where: { portfolioGroupId: V2_PORTFOLIO_GROUP_ID },
  });
  console.log(`\n  Total v2 classifications: ${finalCount.toLocaleString()}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
