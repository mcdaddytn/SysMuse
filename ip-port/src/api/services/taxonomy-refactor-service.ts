/**
 * Taxonomy Refactor Service
 *
 * Orchestrates the full taxonomy transformation pipeline:
 *   Analyze → Propose → Classify → Validate → Adjust
 *
 * Replaces the manual cycle of running ad-hoc scripts for each sector.
 * Designed to run as a background job via the batch_jobs infrastructure.
 *
 * Usage:
 *   // Refactor a single sector
 *   await refactorSector(sectorNodeId, outputTaxonomyTypeId, spec);
 *
 *   // Refactor entire taxonomy (all sectors under a super-sector)
 *   await refactorSubtree(superSectorNodeId, outputTaxonomyTypeId, spec);
 */

import { PrismaClient } from '@prisma/client';
import {
  analyzeCpcDistribution,
  analyzeSubsectorDistribution,
  analyzePortfolioDistribution,
  type AnalyzerOptions,
  type CpcAnalysisResult,
} from './taxonomy-analyzer-service.js';
import {
  generateProposals,
  createFromProposal,
  type ProposerConfig,
  type ProposalResult,
  type CreateResult,
} from './taxonomy-proposer-service.js';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface RefactorSpec {
  // Source
  inputTaxonomyTypeId: string;

  // Destination
  outputTaxonomyTypeId: string;
  outputPortfolioGroupId: string;

  // Size targets
  targetSubsectorSize: { min: number; max: number };
  maxPortfolioSize: number;
  referencePortfolioIds: string[];

  // Classification
  privilegedAssociationCount: number;
  inventiveSourceWeight: number;
  additionalSourceWeight: number;

  // Rule generation
  priorities: {
    specificSubgroup: number;
    groupLevel: number;
    broadCatch: number;
    ultimateCatchAll: number;
  };
  minPatsForSubsector: number;
  handleDualNumbering: boolean;

  // Execution
  maxIterations: number;
  convergenceThreshold: number;
  dryRun: boolean;
  batchSize: number;
}

export interface RefactorProgress {
  phase: 'analyze' | 'propose' | 'classify' | 'validate' | 'adjust' | 'complete';
  sectorCode: string;
  iteration: number;
  totalSectors: number;
  currentSector: number;
  nodesCreated: number;
  rulesCreated: number;
  patentsClassified: number;
  violations: number;
  message: string;
}

export interface SectorRefactorResult {
  sectorCode: string;
  sectorNodeId: string;
  iterations: number;
  nodesCreated: number;
  rulesCreated: number;
  patentsClassified: number;
  classificationsCreated: number;
  violations: ValidationViolation[];
  converged: boolean;
}

export interface ValidationViolation {
  type: 'oversized' | 'undersized' | 'portfolio-exceeded';
  nodeCode: string;
  actual: number;
  target: number;
}

export type ProgressCallback = (progress: RefactorProgress) => void;

// =============================================================================
// Default Spec
// =============================================================================

export const DEFAULT_REFACTOR_SPEC: RefactorSpec = {
  inputTaxonomyTypeId: 'tt_patent_v1',
  outputTaxonomyTypeId: 'tt_patent_v2',
  outputPortfolioGroupId: 'pg_v2_pilot',
  targetSubsectorSize: { min: 20, max: 500 },
  maxPortfolioSize: 500,
  referencePortfolioIds: [], // populated at runtime
  privilegedAssociationCount: 3,
  inventiveSourceWeight: 1.0,
  additionalSourceWeight: 0.3,
  priorities: {
    specificSubgroup: 85,
    groupLevel: 75,
    broadCatch: 60,
    ultimateCatchAll: 40,
  },
  minPatsForSubsector: 10,
  handleDualNumbering: true,
  maxIterations: 5,
  convergenceThreshold: 0.02,
  dryRun: false,
  batchSize: 500,
};

// =============================================================================
// Core Operations
// =============================================================================

/**
 * Refactor a single sector — the full analyze→propose→classify→validate cycle.
 *
 * This is the generalized version of what we did manually for network-switching
 * and network-management sectors.
 */
export async function refactorSector(
  sectorNodeId: string,
  spec: RefactorSpec,
  onProgress?: ProgressCallback
): Promise<SectorRefactorResult> {
  const sectorNode = await prisma.taxonomyNode.findUnique({
    where: { id: sectorNodeId },
    select: { id: true, code: true, name: true, level: true, parentId: true },
  });
  if (!sectorNode) throw new Error(`Sector node ${sectorNodeId} not found`);

  const report = (phase: RefactorProgress['phase'], message: string, extra: Partial<RefactorProgress> = {}) => {
    onProgress?.({
      phase,
      sectorCode: sectorNode.code,
      iteration: 0,
      totalSectors: 1,
      currentSector: 1,
      nodesCreated: 0,
      rulesCreated: 0,
      patentsClassified: 0,
      violations: 0,
      message,
      ...extra,
    });
  };

  let totalNodesCreated = 0;
  let totalRulesCreated = 0;
  let totalPatentsClassified = 0;
  let totalClassifications = 0;
  let currentViolations: ValidationViolation[] = [];

  for (let iteration = 1; iteration <= spec.maxIterations; iteration++) {
    // Phase 1: Analyze
    report('analyze', `Iteration ${iteration}: Analyzing CPC distribution...`, { iteration });

    const analysis = await analyzeCpcDistribution(sectorNodeId, {
      referencePortfolioIds: spec.referencePortfolioIds,
      minPatentsThreshold: Math.max(5, spec.minPatsForSubsector / 2),
      maxGroups: 60,
    });

    if (analysis.totalPatents === 0) {
      report('complete', 'No patents found in sector', { iteration });
      return {
        sectorCode: sectorNode.code,
        sectorNodeId,
        iterations: iteration,
        nodesCreated: 0,
        rulesCreated: 0,
        patentsClassified: 0,
        classificationsCreated: 0,
        violations: [],
        converged: true,
      };
    }

    // Phase 2: Propose
    report('propose', `Generating sub-sector proposals from ${analysis.groupDistributions.length} CPC groups...`, { iteration });

    // Build naming from sector code
    const codeparts = sectorNode.code.split('/');
    const parentPrefix = sectorNode.code; // e.g., SDN/management
    const parentAbbrev = codeparts[codeparts.length - 1].substring(0, 4).toUpperCase();

    const proposerConfig: ProposerConfig = {
      targetSize: spec.targetSubsectorSize,
      maxPortfolioSize: spec.maxPortfolioSize,
      referencePortfolioIds: spec.referencePortfolioIds,
      priorities: spec.priorities,
      minPatsForSubsector: spec.minPatsForSubsector,
      handleDualNumbering: spec.handleDualNumbering,
      naming: {
        parentAbbreviation: parentAbbrev,
        parentPrefix,
        slugStyle: 'kebab-case',
        abbrevLength: 4,
      },
    };

    const proposal = generateProposals(analysis, proposerConfig);

    report('propose', `Proposed ${proposal.subsectors.length} sub-sectors with ${proposal.totalRules} rules`, { iteration });

    // Phase 3: Create nodes and rules
    // Find or create the output L2 node for this sector
    let outputParentId = await findOrCreateOutputSector(
      sectorNode,
      spec.outputTaxonomyTypeId,
      spec.dryRun
    );

    const createResult = await createFromProposal(
      proposal,
      spec.outputTaxonomyTypeId,
      outputParentId,
      { dryRun: spec.dryRun, clearExisting: iteration > 1 }
    );

    totalNodesCreated = createResult.nodesCreated;
    totalRulesCreated = createResult.rulesCreated;

    report('classify', `Classifying ${analysis.totalPatents} patents...`, {
      iteration,
      nodesCreated: totalNodesCreated,
      rulesCreated: totalRulesCreated,
    });

    // Phase 4: Classify using existing multi-classification service
    if (!spec.dryRun) {
      const classResult = await classifyPatents(
        analysis,
        spec,
        createResult.nodeIds
      );
      totalPatentsClassified = classResult.patentsClassified;
      totalClassifications = classResult.classificationsCreated;
    }

    // Phase 5: Validate
    report('validate', 'Validating size targets...', {
      iteration,
      patentsClassified: totalPatentsClassified,
    });

    currentViolations = await validateResults(
      spec,
      createResult.nodeIds
    );

    report('validate', `Found ${currentViolations.length} violations`, {
      iteration,
      violations: currentViolations.length,
    });

    // Check convergence
    if (currentViolations.length === 0) {
      report('complete', `Converged after ${iteration} iteration(s)`, {
        iteration,
        nodesCreated: totalNodesCreated,
        rulesCreated: totalRulesCreated,
        patentsClassified: totalPatentsClassified,
        violations: 0,
      });
      return {
        sectorCode: sectorNode.code,
        sectorNodeId,
        iterations: iteration,
        nodesCreated: totalNodesCreated,
        rulesCreated: totalRulesCreated,
        patentsClassified: totalPatentsClassified,
        classificationsCreated: totalClassifications,
        violations: [],
        converged: true,
      };
    }

    // Phase 6: Adjust (for next iteration)
    // Currently: log violations and let next iteration's analysis
    // incorporate the feedback. Future: automated rule adjustment.
    report('adjust', `Iteration ${iteration} complete with ${currentViolations.length} violations, refining...`, { iteration });
  }

  report('complete', `Reached max iterations (${spec.maxIterations}) with ${currentViolations.length} remaining violations`);

  return {
    sectorCode: sectorNode.code,
    sectorNodeId,
    iterations: spec.maxIterations,
    nodesCreated: totalNodesCreated,
    rulesCreated: totalRulesCreated,
    patentsClassified: totalPatentsClassified,
    classificationsCreated: totalClassifications,
    violations: currentViolations,
    converged: false,
  };
}

/**
 * Refactor all sectors under a super-sector (or all sectors in taxonomy).
 */
export async function refactorSubtree(
  rootNodeId: string | null, // null = entire taxonomy
  spec: RefactorSpec,
  onProgress?: ProgressCallback
): Promise<SectorRefactorResult[]> {
  // Find all L2 sectors to refactor
  const where = rootNodeId
    ? { taxonomyTypeId: spec.inputTaxonomyTypeId, parentId: rootNodeId, level: 2 }
    : { taxonomyTypeId: spec.inputTaxonomyTypeId, level: 2 };

  const sectors = await prisma.taxonomyNode.findMany({
    where,
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  const results: SectorRefactorResult[] = [];

  for (let i = 0; i < sectors.length; i++) {
    const sector = sectors[i];

    onProgress?.({
      phase: 'analyze',
      sectorCode: sector.code,
      iteration: 0,
      totalSectors: sectors.length,
      currentSector: i + 1,
      nodesCreated: 0,
      rulesCreated: 0,
      patentsClassified: 0,
      violations: 0,
      message: `Starting sector ${i + 1}/${sectors.length}: ${sector.code}`,
    });

    const result = await refactorSector(sector.id, spec, onProgress);
    results.push(result);
  }

  return results;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Find or create the output taxonomy L2 sector node.
 */
async function findOrCreateOutputSector(
  inputSector: { id: string; code: string; name: string; parentId: string | null },
  outputTaxonomyTypeId: string,
  dryRun: boolean
): Promise<string> {
  // Check if output sector already exists
  const existing = await prisma.taxonomyNode.findFirst({
    where: {
      taxonomyTypeId: outputTaxonomyTypeId,
      code: inputSector.code,
      level: 2,
    },
  });
  if (existing) return existing.id;

  // Find the parent L1 in the output taxonomy
  let outputParentId: string | null = null;
  if (inputSector.parentId) {
    const inputParent = await prisma.taxonomyNode.findUnique({
      where: { id: inputSector.parentId },
      select: { code: true },
    });
    if (inputParent) {
      const outputParent = await prisma.taxonomyNode.findFirst({
        where: {
          taxonomyTypeId: outputTaxonomyTypeId,
          code: inputParent.code,
          level: 1,
        },
      });
      outputParentId = outputParent?.id || null;
    }
  }

  if (dryRun) return 'dry-run-sector';

  // Create the L2 sector in output taxonomy
  const created = await prisma.taxonomyNode.create({
    data: {
      taxonomyTypeId: outputTaxonomyTypeId,
      code: inputSector.code,
      name: inputSector.name,
      level: 2,
      path: inputSector.code,
      parentId: outputParentId,
      metadata: {},
    },
  });

  return created.id;
}

/**
 * Classify patents using the output taxonomy rules.
 *
 * Uses the same algorithm as the existing multi-classification-service
 * but scoped to the specific sector's patents and rules.
 */
async function classifyPatents(
  analysis: CpcAnalysisResult,
  spec: RefactorSpec,
  nodeIds: Map<string, string>
): Promise<{ patentsClassified: number; classificationsCreated: number }> {
  // Get patent numbers from the sector
  const sectorNode = await prisma.taxonomyNode.findFirst({
    where: { code: analysis.sectorCode },
  });
  if (!sectorNode) return { patentsClassified: 0, classificationsCreated: 0 };

  // Get patents via objectClassification or primarySector
  const ocs = await prisma.objectClassification.findMany({
    where: { taxonomyNodeId: sectorNode.id, objectType: 'patent' },
    select: { objectId: true },
  });
  let patentNums = [...new Set(ocs.map((c) => c.objectId))];

  if (patentNums.length === 0) {
    const patents = await prisma.patent.findMany({
      where: { primarySector: analysis.sectorCode },
      select: { patentId: true },
    });
    patentNums = patents.map((p) => p.patentId);
  }

  if (patentNums.length === 0) return { patentsClassified: 0, classificationsCreated: 0 };

  // Load output rules for the nodes we created
  const outputNodeIds = [...nodeIds.values()].filter((id) => !id.startsWith('dry-run'));
  const rules = await prisma.taxonomyRule.findMany({
    where: {
      taxonomyTypeId: spec.outputTaxonomyTypeId,
      targetNodeId: { in: outputNodeIds },
    },
    include: { targetNode: true },
    orderBy: { priority: 'desc' },
  });

  if (rules.length === 0) return { patentsClassified: 0, classificationsCreated: 0 };

  // Get CPC codes
  const patentCpcs = await prisma.patentCpc.findMany({
    where: { patentId: { in: patentNums } },
    select: { patentId: true, cpcCode: true, isInventive: true },
  });

  const cpcsByPatent = new Map<string, { cpcCode: string; isInventive: boolean }[]>();
  for (const pc of patentCpcs) {
    if (!cpcsByPatent.has(pc.patentId)) cpcsByPatent.set(pc.patentId, []);
    cpcsByPatent.get(pc.patentId)!.push({ cpcCode: pc.cpcCode, isInventive: pc.isInventive });
  }

  // Classify each patent (same algorithm as multi-classification-service)
  interface ClassResult {
    patentId: string;
    nodeId: string;
    rank: number;
    weight: number;
    sourceCodes: string[];
  }

  const results: ClassResult[] = [];

  for (const patentId of patentNums) {
    const cpcs = cpcsByPatent.get(patentId) || [];
    const scores = new Map<string, { nodeId: string; weight: number; sources: string[] }>();

    for (const cpc of cpcs) {
      // Skip indexing codes
      if (cpc.cpcCode.startsWith('Y')) continue;

      for (const rule of rules) {
        if (rule.isExclusion) continue;

        const normCpc = cpc.cpcCode.replace(/\//g, '');
        const normExpr = rule.expression.replace(/\//g, '');

        const matches = rule.ruleType === 'CPC_PREFIX'
          ? normCpc.startsWith(normExpr)
          : normCpc === normExpr;

        if (matches) {
          const cpcWeight = cpc.isInventive ? spec.inventiveSourceWeight : spec.additionalSourceWeight;
          const priorityMultiplier = 1.0 + rule.priority * 0.1; // Match service formula
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
          break; // First match wins (rules sorted by priority desc)
        }
      }
    }

    const sorted = [...scores.values()].sort((a, b) => b.weight - a.weight);
    const topN = sorted.slice(0, spec.privilegedAssociationCount);

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

  // Clear existing classifications for these patents in the output group
  await prisma.objectClassification.deleteMany({
    where: {
      portfolioGroupId: spec.outputPortfolioGroupId,
      objectId: { in: patentNums },
      taxonomyNodeId: { in: outputNodeIds },
    },
  });

  // Insert in batches
  const BATCH_SIZE = spec.batchSize;
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
        assignedBy: 'taxonomy-refactor-service',
        configVersion: 1,
        portfolioGroupId: spec.outputPortfolioGroupId,
      })),
    });
  }

  return {
    patentsClassified: patentNums.length,
    classificationsCreated: results.length,
  };
}

/**
 * Validate classification results against spec targets.
 */
async function validateResults(
  spec: RefactorSpec,
  nodeIds: Map<string, string>
): Promise<ValidationViolation[]> {
  const violations: ValidationViolation[] = [];
  const realNodeIds = [...nodeIds.entries()]
    .filter(([, id]) => !id.startsWith('dry-run'))
    .map(([code, id]) => ({ code, id }));

  for (const { code, id } of realNodeIds) {
    // Total size check
    const totalCount = await prisma.objectClassification.count({
      where: {
        portfolioGroupId: spec.outputPortfolioGroupId,
        taxonomyNodeId: id,
        associationRank: 1,
      },
    });

    if (totalCount > spec.targetSubsectorSize.max) {
      violations.push({
        type: 'oversized',
        nodeCode: code,
        actual: totalCount,
        target: spec.targetSubsectorSize.max,
      });
    }
    if (totalCount < spec.targetSubsectorSize.min && totalCount > 0) {
      violations.push({
        type: 'undersized',
        nodeCode: code,
        actual: totalCount,
        target: spec.targetSubsectorSize.min,
      });
    }

    // Per-portfolio check
    if (spec.referencePortfolioIds.length > 0) {
      for (const portfolioId of spec.referencePortfolioIds) {
        const portPatents = await prisma.$queryRawUnsafe(`
          SELECT COUNT(DISTINCT oc.object_id) as cnt
          FROM object_classifications oc
          JOIN portfolio_patents pp ON pp.patent_id = oc.object_id
          WHERE oc.portfolio_group_id = $1
            AND oc.taxonomy_node_id = $2
            AND oc.association_rank = 1
            AND pp.portfolio_id = $3
        `, spec.outputPortfolioGroupId, id, portfolioId) as { cnt: bigint }[];

        const portCount = Number(portPatents[0]?.cnt || 0);
        if (portCount > spec.maxPortfolioSize) {
          violations.push({
            type: 'portfolio-exceeded',
            nodeCode: code,
            actual: portCount,
            target: spec.maxPortfolioSize,
          });
        }
      }
    }
  }

  return violations;
}
