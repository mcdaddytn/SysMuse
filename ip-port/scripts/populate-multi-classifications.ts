/**
 * Populate Multi-Classifications Script
 *
 * Backfills ObjectClassification records for all patents in a portfolio group
 * using the multi-classification algorithm.
 *
 * Usage:
 *   npx ts-node scripts/populate-multi-classifications.ts [options]
 *
 * Options:
 *   --portfolio-group=ID  Portfolio group ID (default: finds 'default' group)
 *   --limit=N             Process only N patents (for testing)
 *   --batch-size=N        Batch size for processing (default: 500)
 *   --dry-run             Preview without saving to database
 *   --verbose             Show detailed progress
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

interface PortfolioGroupConfig {
  privilegedAssociationCount: number;
  inventiveSourceWeight: number;
  additionalSourceWeight: number;
  associationWeights: Record<number, number>;
  reinforcementBonus: number;
  sourceCodeFilterPatterns: string[];
  configVersion: number;
}

interface TaxonomyRuleRow {
  id: string;
  taxonomyTypeId: string;
  targetNodeId: string;
  targetNodeCode: string;
  targetNodeLevel: number;
  ruleType: string;
  expression: string;
  priority: number;
  isExclusion: boolean;
}

interface PatentCpcRow {
  patentId: string;
  cpcCode: string;
  isInventive: boolean;
}

interface NodeScore {
  nodeId: string;
  nodeCode: string;
  nodeLevel: number;
  totalWeight: number;
  sourceCodes: string[];
  inventiveCount: number;
  additionalCount: number;
}

interface ClassificationResult {
  patentId: string;
  classifications: Array<{
    taxonomyNodeId: string;
    taxonomyNodeCode: string;
    associationRank: number;
    weight: number;
    confidence: number;
    sourceCodes: string[];
    inventiveSourceCount: number;
  }>;
}

interface AssignmentResult {
  patentsProcessed: number;
  classificationsCreated: number;
  classificationsUpdated: number;
  errors: Array<{ patentId: string; error: string }>;
  duration: number;
}

// =============================================================================
// Default Config
// =============================================================================

const DEFAULT_CONFIG: PortfolioGroupConfig = {
  privilegedAssociationCount: 3,
  inventiveSourceWeight: 1.0,
  additionalSourceWeight: 0.3,
  associationWeights: { 1: 1.0, 2: 0.7, 3: 0.4 },
  reinforcementBonus: 0.2,
  sourceCodeFilterPatterns: ['^Y', '^[A-H]\\d{2}[A-Z]2\\d{3}'],
  configVersion: 1,
};

// =============================================================================
// Rule Loading
// =============================================================================

async function loadTaxonomyRules(
  taxonomyTypeId: string,
  portfolioGroupId?: string
): Promise<TaxonomyRuleRow[]> {
  const rules = await prisma.taxonomyRule.findMany({
    where: {
      taxonomyTypeId,
      isActive: true,
      OR: [
        { scope: 'GLOBAL' },
        { scope: 'PORTFOLIO_GROUP', portfolioGroupId },
      ],
    },
    include: {
      targetNode: {
        select: {
          code: true,
          level: true,
        },
      },
    },
    orderBy: [
      { priority: 'desc' },
      { expression: 'desc' },
    ],
  });

  return rules.map(r => ({
    id: r.id,
    taxonomyTypeId: r.taxonomyTypeId,
    targetNodeId: r.targetNodeId,
    targetNodeCode: r.targetNode.code,
    targetNodeLevel: r.targetNode.level,
    ruleType: r.ruleType,
    expression: r.expression,
    priority: r.priority,
    isExclusion: r.isExclusion,
  }));
}

// =============================================================================
// CPC Filtering
// =============================================================================

function filterIndexingCodes(
  cpcs: PatentCpcRow[],
  patterns: string[]
): PatentCpcRow[] {
  const regexes = patterns.map(p => new RegExp(p));
  return cpcs.filter(cpc => !regexes.some(regex => regex.test(cpc.cpcCode)));
}

// =============================================================================
// Rule Matching
// =============================================================================

function matchCpcRule(ruleType: string, expression: string, cpcCode: string): boolean {
  const normalizedExpr = expression.replace(/\//g, '');
  const normalizedCpc = cpcCode.replace(/\//g, '');

  if (ruleType === 'CPC_SUBGROUP') {
    return normalizedCpc === normalizedExpr;
  }
  return normalizedCpc.startsWith(normalizedExpr);
}

function findMatchingRules(
  cpcCode: string,
  rules: TaxonomyRuleRow[],
  exclusionsOnly: boolean
): TaxonomyRuleRow[] {
  return rules.filter(rule => {
    if (rule.isExclusion !== exclusionsOnly) return false;
    if (rule.ruleType !== 'CPC_PREFIX' && rule.ruleType !== 'CPC_SUBGROUP') return false;
    return matchCpcRule(rule.ruleType, rule.expression, cpcCode);
  });
}

// =============================================================================
// Scoring
// =============================================================================

function computeClassifications(
  cpcs: PatentCpcRow[],
  rules: TaxonomyRuleRow[],
  config: PortfolioGroupConfig
): NodeScore[] {
  // Collect exclusions
  const excludedNodeIds = new Set<string>();
  for (const cpc of cpcs) {
    const exclusionRules = findMatchingRules(cpc.cpcCode, rules, true);
    for (const rule of exclusionRules) {
      excludedNodeIds.add(rule.targetNodeId);
    }
  }

  // Score nodes
  const nodeScores = new Map<string, NodeScore>();

  for (const cpc of cpcs) {
    const inclusionRules = findMatchingRules(cpc.cpcCode, rules, false);

    for (const rule of inclusionRules) {
      if (excludedNodeIds.has(rule.targetNodeId)) continue;

      const cpcWeight = cpc.isInventive
        ? config.inventiveSourceWeight
        : config.additionalSourceWeight;
      const priorityMultiplier = 1.0 + (rule.priority * 0.1);
      const weightContribution = cpcWeight * priorityMultiplier;

      let nodeScore = nodeScores.get(rule.targetNodeId);
      if (!nodeScore) {
        nodeScore = {
          nodeId: rule.targetNodeId,
          nodeCode: rule.targetNodeCode,
          nodeLevel: rule.targetNodeLevel,
          totalWeight: 0,
          sourceCodes: [],
          inventiveCount: 0,
          additionalCount: 0,
        };
        nodeScores.set(rule.targetNodeId, nodeScore);
      }

      nodeScore.totalWeight += weightContribution;
      if (!nodeScore.sourceCodes.includes(cpc.cpcCode)) {
        nodeScore.sourceCodes.push(cpc.cpcCode);
      }
      if (cpc.isInventive) {
        nodeScore.inventiveCount++;
      } else {
        nodeScore.additionalCount++;
      }
    }
  }

  // Apply reinforcement bonus
  for (const [, nodeScore] of nodeScores) {
    if (nodeScore.sourceCodes.length > 1) {
      nodeScore.totalWeight += config.reinforcementBonus * (nodeScore.sourceCodes.length - 1);
    }
  }

  // Sort by score, then code
  return Array.from(nodeScores.values()).sort((a, b) => {
    if (b.totalWeight !== a.totalWeight) return b.totalWeight - a.totalWeight;
    return a.nodeCode.localeCompare(b.nodeCode);
  });
}

function calculateConfidence(
  node: NodeScore,
  allNodes: NodeScore[],
  totalInventiveCpcs: number,
  config: PortfolioGroupConfig
): number {
  const totalWeight = allNodes.reduce((sum, n) => sum + n.totalWeight, 0);
  const dominance = totalWeight > 0 ? node.totalWeight / totalWeight : 0;
  const inventiveCoverage = totalInventiveCpcs > 0 ? node.inventiveCount / totalInventiveCpcs : 0;
  const sourceCountBonus = Math.min(0.2, node.sourceCodes.length * 0.05);
  const reinforcementBonus = node.sourceCodes.length > 1 ? config.reinforcementBonus : 0;

  const confidence = dominance * 0.4 + inventiveCoverage * 0.4 + sourceCountBonus + reinforcementBonus;
  return Math.min(1.0, Math.max(0.0, confidence));
}

// =============================================================================
// Patent Processing
// =============================================================================

async function classifyPatent(
  patentId: string,
  rules: TaxonomyRuleRow[],
  config: PortfolioGroupConfig,
  generalNodeId?: string
): Promise<ClassificationResult> {
  const cpcRows = await prisma.patentCpc.findMany({
    where: { patentId },
  });

  const cpcs: PatentCpcRow[] = cpcRows.map(c => ({
    patentId: c.patentId,
    cpcCode: c.cpcCode,
    isInventive: c.isInventive,
  }));

  const filteredCpcs = filterIndexingCodes(cpcs, config.sourceCodeFilterPatterns);

  if (filteredCpcs.length === 0) {
    if (generalNodeId) {
      return {
        patentId,
        classifications: [{
          taxonomyNodeId: generalNodeId,
          taxonomyNodeCode: 'general',
          associationRank: 1,
          weight: 0,
          confidence: 0,
          sourceCodes: [],
          inventiveSourceCount: 0,
        }],
      };
    }
    return { patentId, classifications: [] };
  }

  const nodeScores = computeClassifications(filteredCpcs, rules, config);

  if (nodeScores.length === 0) {
    if (generalNodeId) {
      return {
        patentId,
        classifications: [{
          taxonomyNodeId: generalNodeId,
          taxonomyNodeCode: 'general',
          associationRank: 1,
          weight: 0,
          confidence: 0,
          sourceCodes: [],
          inventiveSourceCount: 0,
        }],
      };
    }
    return { patentId, classifications: [] };
  }

  const topN = nodeScores.slice(0, config.privilegedAssociationCount);
  const totalInventive = filteredCpcs.filter(c => c.isInventive).length;

  const classifications = topN.map((node, index) => ({
    taxonomyNodeId: node.nodeId,
    taxonomyNodeCode: node.nodeCode,
    associationRank: index + 1,
    weight: node.totalWeight,
    confidence: calculateConfidence(node, nodeScores, totalInventive, config),
    sourceCodes: node.sourceCodes,
    inventiveSourceCount: node.inventiveCount,
  }));

  return { patentId, classifications };
}

// =============================================================================
// Batch Processing
// =============================================================================

async function assignMultiClassifications(
  portfolioGroupId: string,
  options: {
    patentIds?: string[];
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (processed: number, total: number) => void;
  } = {}
): Promise<AssignmentResult> {
  const startTime = Date.now();
  const batchSize = options.batchSize || 500;
  const dryRun = options.dryRun || false;

  const portfolioGroup = await prisma.portfolioGroup.findUnique({
    where: { id: portfolioGroupId },
    include: { taxonomyType: true },
  });

  if (!portfolioGroup) {
    throw new Error(`Portfolio group not found: ${portfolioGroupId}`);
  }

  const config: PortfolioGroupConfig = {
    ...DEFAULT_CONFIG,
    ...(portfolioGroup.config as Record<string, unknown>),
  };

  const rules = await loadTaxonomyRules(portfolioGroup.taxonomyTypeId, portfolioGroupId);

  // Find general catch-all node
  const generalNode = await prisma.taxonomyNode.findFirst({
    where: {
      taxonomyTypeId: portfolioGroup.taxonomyTypeId,
      code: 'general',
      level: 2,
    },
  });
  const generalNodeId = generalNode?.id;

  // Get patents to process
  let patentIds: string[];
  if (options.patentIds) {
    patentIds = options.patentIds;
  } else {
    const members = await prisma.portfolioGroupMember.findMany({
      where: { portfolioGroupId },
      select: { portfolioId: true },
    });
    const portfolioIds = members.map(m => m.portfolioId);

    const patents = await prisma.portfolioPatent.findMany({
      where: { portfolioId: { in: portfolioIds } },
      select: { patentId: true },
      distinct: ['patentId'],
    });
    patentIds = patents.map(p => p.patentId);
  }

  const result: AssignmentResult = {
    patentsProcessed: 0,
    classificationsCreated: 0,
    classificationsUpdated: 0,
    errors: [],
    duration: 0,
  };

  // Process in batches
  for (let i = 0; i < patentIds.length; i += batchSize) {
    const batch = patentIds.slice(i, i + batchSize);

    const classificationResults: ClassificationResult[] = [];
    for (const patentId of batch) {
      try {
        const classResult = await classifyPatent(patentId, rules, config, generalNodeId);
        classificationResults.push(classResult);
      } catch (error) {
        result.errors.push({
          patentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (!dryRun) {
      await saveClassificationBatch(portfolioGroupId, classificationResults, config.configVersion, result);
    } else {
      for (const cr of classificationResults) {
        result.classificationsCreated += cr.classifications.length;
      }
    }

    result.patentsProcessed += batch.length;

    if (options.onProgress) {
      options.onProgress(result.patentsProcessed, patentIds.length);
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

async function saveClassificationBatch(
  portfolioGroupId: string,
  classificationResults: ClassificationResult[],
  configVersion: number,
  result: AssignmentResult
): Promise<void> {
  // Process each patent in its own transaction to avoid timeouts
  for (const cr of classificationResults) {
    await prisma.$transaction(async (tx) => {
      for (const classification of cr.classifications) {
        const existing = await tx.objectClassification.findUnique({
          where: {
            portfolioGroupId_objectId_associationRank: {
              portfolioGroupId,
              objectId: cr.patentId,
              associationRank: classification.associationRank,
            },
          },
        });

        if (existing) {
          await tx.objectClassification.update({
            where: { id: existing.id },
            data: {
              taxonomyNodeId: classification.taxonomyNodeId,
              weight: classification.weight,
              confidence: classification.confidence,
              sourceCodes: classification.sourceCodes,
              inventiveSourceCount: classification.inventiveSourceCount,
              configVersion,
              assignedAt: new Date(),
              assignedBy: 'algorithm',
            },
          });
          result.classificationsUpdated++;
        } else {
          await tx.objectClassification.create({
            data: {
              portfolioGroupId,
              objectType: 'patent',
              objectId: cr.patentId,
              taxonomyNodeId: classification.taxonomyNodeId,
              associationRank: classification.associationRank,
              weight: classification.weight,
              confidence: classification.confidence,
              sourceCodes: classification.sourceCodes,
              inventiveSourceCount: classification.inventiveSourceCount,
              configVersion,
              assignedAt: new Date(),
              assignedBy: 'algorithm',
            },
          });
          result.classificationsCreated++;
        }
      }

      // Sync pragmatic fields
      if (cr.classifications.length > 0) {
        await syncPatentPragmaticFields(tx, cr.patentId, cr.classifications);
      }
    });
  }
}

async function syncPatentPragmaticFields(
  tx: Prisma.TransactionClient,
  patentId: string,
  classifications: ClassificationResult['classifications']
): Promise<void> {
  const primary = classifications[0];

  const primaryNode = await tx.taxonomyNode.findUnique({
    where: { id: primary.taxonomyNodeId },
    include: {
      parent: {
        include: {
          parent: true,
        },
      },
    },
  });

  if (!primaryNode) return;

  let level1Code: string | null = null;
  let level1NodeId: string | null = null;
  let level2Code: string | null = null;
  let level2NodeId: string | null = null;
  let level3Code: string | null = null;
  let level3NodeId: string | null = null;

  if (primaryNode.level === 3) {
    level3Code = primaryNode.code;
    level3NodeId = primaryNode.id;
    if (primaryNode.parent) {
      level2Code = primaryNode.parent.code;
      level2NodeId = primaryNode.parent.id;
      if (primaryNode.parent.parent) {
        level1Code = primaryNode.parent.parent.code;
        level1NodeId = primaryNode.parent.parent.id;
      }
    }
  } else if (primaryNode.level === 2) {
    level2Code = primaryNode.code;
    level2NodeId = primaryNode.id;
    if (primaryNode.parent) {
      level1Code = primaryNode.parent.code;
      level1NodeId = primaryNode.parent.id;
    }
  } else if (primaryNode.level === 1) {
    level1Code = primaryNode.code;
    level1NodeId = primaryNode.id;
  }

  // Check for cross-level1
  const level1NodeIds = new Set<string>();
  for (const c of classifications) {
    const node = await tx.taxonomyNode.findUnique({
      where: { id: c.taxonomyNodeId },
      include: { parent: { include: { parent: true } } },
    });
    if (node) {
      if (node.level === 1) {
        level1NodeIds.add(node.id);
      } else if (node.level === 2 && node.parent) {
        level1NodeIds.add(node.parent.id);
      } else if (node.level === 3 && node.parent?.parent) {
        level1NodeIds.add(node.parent.parent.id);
      }
    }
  }
  const crossLevel1 = level1NodeIds.size > 1;

  await tx.patent.update({
    where: { patentId },
    data: {
      primaryLevel1: level1Code,
      primaryLevel1NodeId: level1NodeId,
      primaryLevel2: level2Code,
      primaryLevel2NodeId: level2NodeId,
      primaryLevel3: level3Code,
      primaryLevel3NodeId: level3NodeId,
      crossLevel1,
    },
  });
}

// =============================================================================
// CLI
// =============================================================================

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const portfolioGroupArg = getArg('portfolio-group');
const limitArg = getArg('limit');
const batchSizeArg = getArg('batch-size');
const dryRun = hasFlag('dry-run');
const verbose = hasFlag('verbose');

function log(message: string, indent = 0): void {
  const prefix = '  '.repeat(indent);
  console.log(`${prefix}${message}`);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

async function main(): Promise<void> {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║       Multi-Classification Population Script                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  let portfolioGroupId: string;
  if (portfolioGroupArg) {
    const group = await prisma.portfolioGroup.findUnique({
      where: { id: portfolioGroupArg },
    });
    if (!group) {
      console.error(`❌ Portfolio group not found: ${portfolioGroupArg}`);
      process.exit(1);
    }
    portfolioGroupId = group.id;
    log(`Using portfolio group: ${group.name} (${group.id})`);
  } else {
    const defaultGroup = await prisma.portfolioGroup.findFirst({
      where: { name: 'default' },
    });
    if (!defaultGroup) {
      console.error('❌ No default portfolio group found. Use --portfolio-group=ID');
      process.exit(1);
    }
    portfolioGroupId = defaultGroup.id;
    log(`Using default portfolio group: ${defaultGroup.id}`);
  }

  let patentIds: string[] | undefined;
  if (limitArg) {
    const limit = parseInt(limitArg, 10);
    log(`Limiting to ${limit} patents`);

    const members = await prisma.portfolioGroupMember.findMany({
      where: { portfolioGroupId },
      select: { portfolioId: true },
    });
    const portfolioIds = members.map(m => m.portfolioId);

    const patents = await prisma.portfolioPatent.findMany({
      where: { portfolioId: { in: portfolioIds } },
      select: { patentId: true },
      distinct: ['patentId'],
      take: limit,
    });
    patentIds = patents.map(p => p.patentId);
    log(`Found ${patentIds.length} patents to process`);
  }

  let totalPatents: number;
  if (patentIds) {
    totalPatents = patentIds.length;
  } else {
    const members = await prisma.portfolioGroupMember.findMany({
      where: { portfolioGroupId },
      select: { portfolioId: true },
    });
    const portfolioIds = members.map(m => m.portfolioId);
    totalPatents = await prisma.portfolioPatent.count({
      where: { portfolioId: { in: portfolioIds } },
    });
    log(`Total patents to process: ${totalPatents}`);
  }

  console.log('');
  log('Starting classification...');
  console.log('');

  let lastProgressLog = 0;
  const progressInterval = verbose ? 100 : 1000;

  const result: AssignmentResult = await assignMultiClassifications(
    portfolioGroupId,
    {
      patentIds,
      batchSize: batchSizeArg ? parseInt(batchSizeArg, 10) : 500,
      dryRun,
      onProgress: (processed, total) => {
        if (processed - lastProgressLog >= progressInterval || processed === total) {
          const pct = ((processed / total) * 100).toFixed(1);
          process.stdout.write(`\r  Progress: ${processed}/${total} (${pct}%)`);
          lastProgressLog = processed;
        }
      },
    }
  );

  console.log('\n');

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                    Results                                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  log(`Patents processed:       ${result.patentsProcessed.toLocaleString()}`);
  log(`Classifications created: ${result.classificationsCreated.toLocaleString()}`);
  log(`Classifications updated: ${result.classificationsUpdated.toLocaleString()}`);
  log(`Errors:                  ${result.errors.length}`);
  log(`Duration:                ${formatDuration(result.duration)}`);

  if (result.errors.length > 0) {
    console.log('');
    log('Errors:');
    for (const error of result.errors.slice(0, 10)) {
      log(`  - ${error.patentId}: ${error.error}`, 1);
    }
    if (result.errors.length > 10) {
      log(`  ... and ${result.errors.length - 10} more errors`, 1);
    }
  }

  if (!dryRun && result.classificationsCreated > 0) {
    console.log('');
    log('Classification distribution:');

    const distribution = await prisma.objectClassification.groupBy({
      by: ['associationRank'],
      where: { portfolioGroupId },
      _count: true,
      orderBy: { associationRank: 'asc' },
    });

    for (const d of distribution) {
      const label = d.associationRank === 1 ? 'Primary' :
                    d.associationRank === 2 ? 'Secondary' :
                    d.associationRank === 3 ? 'Tertiary' :
                    `Rank ${d.associationRank}`;
      log(`  ${label}: ${d._count.toLocaleString()}`, 1);
    }
  }

  console.log('');
  if (dryRun) {
    log('This was a dry run. Run without --dry-run to apply changes.');
  } else {
    log('✅ Multi-classification population complete!');
  }
  console.log('');
}

main()
  .catch(error => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
