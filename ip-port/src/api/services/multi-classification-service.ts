/**
 * Multi-Classification Service
 *
 * Assigns multiple taxonomy classifications to patents based on CPC codes.
 * Uses TaxonomyRules to map CPCs to TaxonomyNodes with configurable weighting.
 *
 * Key features:
 * - Supports N privileged associations (default 3: primary, secondary, tertiary)
 * - Weights inventive CPCs higher than additional CPCs
 * - Applies reinforcement bonus when multiple CPCs map to same node
 * - Calculates confidence based on dominance and inventive coverage
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface PortfolioGroupConfig {
  privilegedAssociationCount: number;
  inventiveSourceWeight: number;
  additionalSourceWeight: number;
  associationWeights: Record<number, number>;
  reinforcementBonus: number;
  clusteringEnabled: boolean;
  clusterThreshold: number;
  llmModelTier: string;
  llmQuestionsPerAssociation: number;
  sourceCodeFilterPatterns: string[];
  configVersion: number;
  configUpdatedAt: string;
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
  scope: string;
  portfolioGroupId: string | null;
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

export interface ClassificationResult {
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

export interface AssignmentResult {
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
  clusteringEnabled: false,
  clusterThreshold: 0.30,
  llmModelTier: 'standard',
  llmQuestionsPerAssociation: 3,
  sourceCodeFilterPatterns: ['^Y', '^[A-H]\\d{2}[A-Z]2\\d{3}'],
  configVersion: 1,
  configUpdatedAt: new Date().toISOString(),
};

// =============================================================================
// Rule Cache
// =============================================================================

let ruleCache: Map<string, TaxonomyRuleRow[]> = new Map();
let ruleCacheTime = 0;
const RULE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load all active taxonomy rules for a given taxonomy type.
 */
export async function loadTaxonomyRules(
  taxonomyTypeId: string,
  portfolioGroupId?: string
): Promise<TaxonomyRuleRow[]> {
  const cacheKey = `${taxonomyTypeId}:${portfolioGroupId || 'global'}`;
  const now = Date.now();

  if (ruleCache.has(cacheKey) && (now - ruleCacheTime) < RULE_CACHE_TTL) {
    return ruleCache.get(cacheKey)!;
  }

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
      { expression: 'desc' }, // Longer expressions (more specific) first
    ],
  });

  const mapped: TaxonomyRuleRow[] = rules.map(r => ({
    id: r.id,
    taxonomyTypeId: r.taxonomyTypeId,
    targetNodeId: r.targetNodeId,
    targetNodeCode: r.targetNode.code,
    targetNodeLevel: r.targetNode.level,
    ruleType: r.ruleType,
    expression: r.expression,
    priority: r.priority,
    isExclusion: r.isExclusion,
    scope: r.scope,
    portfolioGroupId: r.portfolioGroupId,
  }));

  ruleCache.set(cacheKey, mapped);
  ruleCacheTime = now;

  return mapped;
}

/**
 * Clear the rule cache.
 */
export function clearRuleCache(): void {
  ruleCache.clear();
  ruleCacheTime = 0;
}

// =============================================================================
// CPC Filtering
// =============================================================================

/**
 * Filter out indexing codes (Y-section and 2000-series scheme codes).
 */
export function filterIndexingCodes(
  cpcs: PatentCpcRow[],
  patterns: string[] = DEFAULT_CONFIG.sourceCodeFilterPatterns
): PatentCpcRow[] {
  const regexes = patterns.map(p => new RegExp(p));

  return cpcs.filter(cpc => {
    const code = cpc.cpcCode;
    return !regexes.some(regex => regex.test(code));
  });
}

// =============================================================================
// Rule Matching
// =============================================================================

/**
 * Check if a CPC code matches a rule expression.
 */
function matchCpcRule(
  ruleType: string,
  expression: string,
  cpcCode: string
): boolean {
  // Normalize: remove slashes for comparison
  const normalizedExpr = expression.replace(/\//g, '');
  const normalizedCpc = cpcCode.replace(/\//g, '');

  if (ruleType === 'CPC_SUBGROUP') {
    return normalizedCpc === normalizedExpr;
  }

  // CPC_PREFIX: code starts with expression
  return normalizedCpc.startsWith(normalizedExpr);
}

/**
 * Find all rules that match a given CPC code.
 */
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

/**
 * Compute multi-classifications for a single patent.
 */
export function computeClassifications(
  cpcs: PatentCpcRow[],
  rules: TaxonomyRuleRow[],
  config: PortfolioGroupConfig
): NodeScore[] {
  // Step 1: Collect exclusions
  const excludedNodeIds = new Set<string>();
  for (const cpc of cpcs) {
    const exclusionRules = findMatchingRules(cpc.cpcCode, rules, true);
    for (const rule of exclusionRules) {
      excludedNodeIds.add(rule.targetNodeId);
    }
  }

  // Step 2: Score nodes
  const nodeScores = new Map<string, NodeScore>();

  for (const cpc of cpcs) {
    const inclusionRules = findMatchingRules(cpc.cpcCode, rules, false);

    for (const rule of inclusionRules) {
      // Skip excluded nodes
      if (excludedNodeIds.has(rule.targetNodeId)) continue;

      // Calculate weight contribution
      const cpcWeight = cpc.isInventive
        ? config.inventiveSourceWeight
        : config.additionalSourceWeight;
      const priorityMultiplier = 1.0 + (rule.priority * 0.1);
      const weightContribution = cpcWeight * priorityMultiplier;

      // Get or create node score
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

      // Accumulate
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

  // Step 3: Apply reinforcement bonus
  for (const [, nodeScore] of nodeScores) {
    if (nodeScore.sourceCodes.length > 1) {
      nodeScore.totalWeight += config.reinforcementBonus * (nodeScore.sourceCodes.length - 1);
    }
  }

  // Step 4: Sort by score (desc), then priority (implicit in weight), then code (alphabetical)
  const sortedNodes = Array.from(nodeScores.values()).sort((a, b) => {
    if (b.totalWeight !== a.totalWeight) return b.totalWeight - a.totalWeight;
    return a.nodeCode.localeCompare(b.nodeCode);
  });

  return sortedNodes;
}

/**
 * Calculate confidence for a classification.
 */
export function calculateConfidence(
  node: NodeScore,
  allNodes: NodeScore[],
  totalInventiveCpcs: number,
  config: PortfolioGroupConfig
): number {
  // Factor 1: Dominance (how much this node dominates the ranking)
  const totalWeight = allNodes.reduce((sum, n) => sum + n.totalWeight, 0);
  const dominance = totalWeight > 0 ? node.totalWeight / totalWeight : 0;

  // Factor 2: Inventive coverage (what % of inventive CPCs support this)
  const inventiveCoverage = totalInventiveCpcs > 0
    ? node.inventiveCount / totalInventiveCpcs
    : 0;

  // Factor 3: Source count bonus (more CPCs = more confidence)
  const sourceCountBonus = Math.min(0.2, node.sourceCodes.length * 0.05);

  // Factor 4: Reinforcement (multiple CPCs to same node)
  const reinforcementBonus = node.sourceCodes.length > 1
    ? config.reinforcementBonus
    : 0;

  // Weighted combination
  const confidence = (
    dominance * 0.4 +
    inventiveCoverage * 0.4 +
    sourceCountBonus +
    reinforcementBonus
  );

  return Math.min(1.0, Math.max(0.0, confidence));
}

// =============================================================================
// Patent Processing
// =============================================================================

/**
 * Process a single patent and compute its classifications.
 */
export async function classifyPatent(
  patentId: string,
  rules: TaxonomyRuleRow[],
  config: PortfolioGroupConfig,
  generalNodeId?: string
): Promise<ClassificationResult> {
  // Load patent CPC codes
  const cpcRows = await prisma.patentCpc.findMany({
    where: { patentId },
  });

  const cpcs: PatentCpcRow[] = cpcRows.map(c => ({
    patentId: c.patentId,
    cpcCode: c.cpcCode,
    isInventive: c.isInventive,
  }));

  // Filter indexing codes
  const filteredCpcs = filterIndexingCodes(cpcs, config.sourceCodeFilterPatterns);

  if (filteredCpcs.length === 0) {
    // No valid CPCs - assign to general catch-all if provided
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

  // Compute classifications
  const nodeScores = computeClassifications(filteredCpcs, rules, config);

  if (nodeScores.length === 0) {
    // No matching rules - assign to general catch-all if provided
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

  // Take top N
  const topN = nodeScores.slice(0, config.privilegedAssociationCount);
  const totalInventive = filteredCpcs.filter(c => c.isInventive).length;

  // Build classification results
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

/**
 * Assign multi-classifications to patents in a portfolio group.
 */
export async function assignMultiClassifications(
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

  // Load portfolio group config
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

  // Load taxonomy rules
  const rules = await loadTaxonomyRules(
    portfolioGroup.taxonomyTypeId,
    portfolioGroupId
  );

  // Find "general" catch-all node (level 2, code = "general")
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
    // Get all patents in portfolios belonging to this group
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

    // Process each patent in batch
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

    // Save classifications (if not dry run)
    if (!dryRun) {
      await saveClassificationBatch(
        portfolioGroupId,
        classificationResults,
        config.configVersion,
        result
      );
    } else {
      // Count for dry run
      for (const cr of classificationResults) {
        result.classificationsCreated += cr.classifications.length;
      }
    }

    result.patentsProcessed += batch.length;

    // Progress callback
    if (options.onProgress) {
      options.onProgress(result.patentsProcessed, patentIds.length);
    }
  }

  result.duration = Date.now() - startTime;
  return result;
}

/**
 * Save a batch of classifications to the database.
 */
async function saveClassificationBatch(
  portfolioGroupId: string,
  classificationResults: ClassificationResult[],
  configVersion: number,
  result: AssignmentResult
): Promise<void> {
  // Use a transaction for the batch
  await prisma.$transaction(async (tx) => {
    for (const cr of classificationResults) {
      for (const classification of cr.classifications) {
        // Upsert classification
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

      // Sync pragmatic fields on Patent (for primary classification)
      if (cr.classifications.length > 0) {
        const primary = cr.classifications[0];
        await syncPatentPragmaticFields(tx, cr.patentId, primary, cr.classifications);
      }
    }
  });
}

/**
 * Sync pragmatic fields on Patent model from primary classification.
 */
async function syncPatentPragmaticFields(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  patentId: string,
  primary: ClassificationResult['classifications'][0],
  allClassifications: ClassificationResult['classifications']
): Promise<void> {
  // Get the primary node and its ancestors
  const primaryNode = await tx.taxonomyNode.findUnique({
    where: { id: primary.taxonomyNodeId },
    include: {
      parent: {
        include: {
          parent: true, // Get grandparent (level 1)
        },
      },
    },
  });

  if (!primaryNode) return;

  // Determine level 1, 2, 3 values based on node hierarchy
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

  // Check if classifications span multiple level-1 nodes
  const level1NodeIds = new Set<string>();
  for (const c of allClassifications) {
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

  // Update patent
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
// Exports
// =============================================================================

export {
  DEFAULT_CONFIG,
  type PatentCpcRow,
  type TaxonomyRuleRow,
  type NodeScore,
};
