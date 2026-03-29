/**
 * Taxonomy Refactor Service
 *
 * Orchestrates the full taxonomy transformation pipeline:
 *   1. Analyze — CPC distribution, portfolio sizing
 *   2. Propose — Fine-grained sub-sectors from CPC groups
 *   3. Classify — Priority-based patent-to-subsector assignment
 *   4. Validate — Check size/count targets
 *   5. Consolidate — Merge undersized, split oversized, review general bucket
 *   6. Repeat 3-5 until converged or max iterations
 *
 * The consolidation phase is the key iterative step. The initial proposal
 * creates fine-grained sub-sectors (one per CPC group), then consolidation
 * merges them via agglomerative clustering until count/size targets are met.
 *
 * Design note: The pipeline supports future "intervention points" where
 * a user can approve/edit proposed categories before proceeding. Currently
 * runs uninterrupted (mode: 'automatic'). When mode: 'interactive', each
 * iteration would pause after consolidation for review.
 */

import { PrismaClient } from '@prisma/client';
import {
  analyzeCpcDistribution,
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

  // Size targets per sub-sector
  targetSubsectorSize: { min: number; max: number };
  // Target number of sub-sectors per sector
  targetSubsectorCount: { min: number; max: number };
  // Max patents from any single portfolio in one sub-sector
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
  convergenceThreshold: number;  // Stop if violation count drops by less than this fraction
  dryRun: boolean;
  batchSize: number;
  mode: 'automatic' | 'interactive';  // interactive pauses after consolidation
}

export interface RefactorProgress {
  phase: 'analyze' | 'propose' | 'classify' | 'validate' | 'consolidate' | 'complete';
  sectorCode: string;
  iteration: number;
  totalSectors: number;
  currentSector: number;
  nodesCreated: number;
  rulesCreated: number;
  patentsClassified: number;
  violations: number;
  subsectorCount: number;
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
  subsectorCount: number;
}

export interface ValidationViolation {
  type: 'oversized' | 'undersized' | 'portfolio-exceeded' | 'too-many-subsectors' | 'too-few-subsectors';
  nodeCode: string;
  actual: number;
  target: number;
}

export type ProgressCallback = (progress: RefactorProgress) => void;

// Internal type for sub-sector state during consolidation
interface SubsectorState {
  id: string;
  code: string;
  name: string;
  cpcPatterns: string[];  // CPC patterns from rules
  primaryCount: number;   // patents with rank=1 in this sub-sector
  isGeneral: boolean;     // is this the catch-all sub-sector
}

// =============================================================================
// Default Spec
// =============================================================================

export const DEFAULT_REFACTOR_SPEC: RefactorSpec = {
  inputTaxonomyTypeId: 'tax_cpc_tech_1774722938212',
  outputTaxonomyTypeId: 'tt_patent_v2',
  outputPortfolioGroupId: 'pg_v2_pilot',
  targetSubsectorSize: { min: 30, max: 500 },
  targetSubsectorCount: { min: 3, max: 25 },
  maxPortfolioSize: 500,
  referencePortfolioIds: [],
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
  maxIterations: 10,
  convergenceThreshold: 0.05,
  dryRun: false,
  batchSize: 500,
  mode: 'automatic',
};

// =============================================================================
// Core Operations
// =============================================================================

/**
 * Refactor a single sector — the full pipeline with consolidation.
 *
 * Phase 1 (once): Analyze → Propose → Create → Classify → Validate
 * Phase 2 (iterate): Consolidate → Re-classify → Validate → repeat
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
      subsectorCount: 0,
      message,
      ...extra,
    });
  };

  // ── Phase 1: Initial proposal ──────────────────────────────────────────

  report('analyze', 'Analyzing CPC distribution...');

  const analysis = await analyzeCpcDistribution(sectorNodeId, {
    referencePortfolioIds: spec.referencePortfolioIds,
    minPatentsThreshold: Math.max(5, spec.minPatsForSubsector / 2),
    maxGroups: 80,  // Get more groups for finer initial granularity
  });

  if (analysis.totalPatents === 0) {
    report('complete', 'No patents found in sector');
    return emptyResult(sectorNode.code, sectorNodeId);
  }

  // Determine appropriate sub-sector count target for this sector's size
  const adjustedSpec = adjustTargetsForSectorSize(spec, analysis.totalPatents);

  report('propose', `Generating proposals from ${analysis.groupDistributions.length} CPC groups...`);

  const codeparts = sectorNode.code.split('/');
  const parentPrefix = sectorNode.code;
  const parentAbbrev = codeparts[codeparts.length - 1].substring(0, 4).toUpperCase();

  const proposerConfig: ProposerConfig = {
    targetSize: adjustedSpec.targetSubsectorSize,
    maxPortfolioSize: adjustedSpec.maxPortfolioSize,
    referencePortfolioIds: adjustedSpec.referencePortfolioIds,
    priorities: adjustedSpec.priorities,
    minPatsForSubsector: adjustedSpec.minPatsForSubsector,
    handleDualNumbering: adjustedSpec.handleDualNumbering,
    naming: {
      parentAbbreviation: parentAbbrev,
      parentPrefix,
      slugStyle: 'kebab-case',
      abbrevLength: 4,
    },
  };

  const proposal = generateProposals(analysis, proposerConfig);
  report('propose', `Initial: ${proposal.subsectors.length} sub-sectors, ${proposal.totalRules} rules`);

  // Create output sector node
  const outputParentId = await findOrCreateOutputSector(
    sectorNode, adjustedSpec.outputTaxonomyTypeId, adjustedSpec.dryRun
  );

  // Create nodes and rules
  const createResult = await createFromProposal(
    proposal, adjustedSpec.outputTaxonomyTypeId, outputParentId,
    { dryRun: adjustedSpec.dryRun, clearExisting: true }
  );

  // Initial classification
  let classResult = { patentsClassified: 0, classificationsCreated: 0 };
  if (!adjustedSpec.dryRun) {
    report('classify', `Classifying ${analysis.totalPatents} patents...`);
    classResult = await classifyPatents(analysis, adjustedSpec, createResult.nodeIds);
  }

  // Initial validation
  let currentViolations = await validateResults(adjustedSpec, createResult.nodeIds);
  let currentSubsectorCount = createResult.nodesCreated;

  report('validate', `${currentSubsectorCount} sub-sectors, ${currentViolations.length} violations`, {
    violations: currentViolations.length,
    subsectorCount: currentSubsectorCount,
    nodesCreated: createResult.nodesCreated,
    rulesCreated: createResult.rulesCreated,
    patentsClassified: classResult.patentsClassified,
  });

  // ── Phase 2: Consolidation loop ────────────────────────────────────────

  let prevViolationCount = currentViolations.length;
  let staleCount = 0;

  for (let iteration = 1; iteration <= adjustedSpec.maxIterations; iteration++) {
    if (currentViolations.length === 0) break;

    report('consolidate', `Iteration ${iteration}: Consolidating...`, {
      iteration, subsectorCount: currentSubsectorCount,
    });

    // Run consolidation
    const consolResult = await consolidateSubsectors(
      outputParentId,
      adjustedSpec,
      analysis.sectorCode
    );

    if (!consolResult.changed) {
      report('consolidate', `No further consolidation possible`, { iteration });
      break;
    }

    report('consolidate',
      `Merged ${consolResult.mergeCount}, split ${consolResult.splitCount} → ${consolResult.subsectorCount} sub-sectors`,
      { iteration, subsectorCount: consolResult.subsectorCount }
    );

    // Re-classify with new node/rule state
    if (!adjustedSpec.dryRun) {
      report('classify', `Re-classifying ${analysis.totalPatents} patents...`, { iteration });
      // Reload node IDs after consolidation
      const updatedNodeIds = await getSubsectorNodeIds(outputParentId, adjustedSpec.outputTaxonomyTypeId);
      classResult = await classifyPatents(analysis, adjustedSpec, updatedNodeIds);
    }

    // Re-validate
    const updatedNodeIds = await getSubsectorNodeIds(outputParentId, adjustedSpec.outputTaxonomyTypeId);
    currentViolations = await validateResults(adjustedSpec, updatedNodeIds);
    currentSubsectorCount = consolResult.subsectorCount;

    report('validate',
      `${currentSubsectorCount} sub-sectors, ${currentViolations.length} violations`,
      { iteration, violations: currentViolations.length, subsectorCount: currentSubsectorCount }
    );

    // Convergence check: stop if violations aren't improving
    const improvement = (prevViolationCount - currentViolations.length) / Math.max(1, prevViolationCount);
    if (improvement < adjustedSpec.convergenceThreshold && currentViolations.length > 0) {
      staleCount++;
      if (staleCount >= 2) {
        report('complete', `Converged (stale) after ${iteration} iterations with ${currentViolations.length} remaining violations`);
        break;
      }
    } else {
      staleCount = 0;
    }
    prevViolationCount = currentViolations.length;
  }

  // ── Final state ────────────────────────────────────────────────────────

  const finalNodeIds = await getSubsectorNodeIds(outputParentId, adjustedSpec.outputTaxonomyTypeId);
  const finalRuleCount = await prisma.taxonomyRule.count({
    where: {
      taxonomyTypeId: adjustedSpec.outputTaxonomyTypeId,
      targetNodeId: { in: [...finalNodeIds.values()] },
    },
  });

  const converged = currentViolations.length === 0;
  report('complete',
    converged
      ? `Converged: ${finalNodeIds.size} sub-sectors, ${finalRuleCount} rules`
      : `Completed with ${currentViolations.length} remaining violations`,
    {
      nodesCreated: finalNodeIds.size,
      rulesCreated: finalRuleCount,
      patentsClassified: classResult.patentsClassified,
      violations: currentViolations.length,
      subsectorCount: finalNodeIds.size,
    }
  );

  return {
    sectorCode: sectorNode.code,
    sectorNodeId,
    iterations: Math.min(adjustedSpec.maxIterations, prevViolationCount === 0 ? 1 : adjustedSpec.maxIterations),
    nodesCreated: finalNodeIds.size,
    rulesCreated: finalRuleCount,
    patentsClassified: classResult.patentsClassified,
    classificationsCreated: classResult.classificationsCreated,
    violations: currentViolations,
    converged,
    subsectorCount: finalNodeIds.size,
  };
}

/**
 * Refactor all sectors under a super-sector (or all sectors in taxonomy).
 */
export async function refactorSubtree(
  rootNodeId: string | null,
  spec: RefactorSpec,
  onProgress?: ProgressCallback
): Promise<SectorRefactorResult[]> {
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
      subsectorCount: 0,
      message: `Starting sector ${i + 1}/${sectors.length}: ${sector.code}`,
    });

    const result = await refactorSector(sector.id, spec, onProgress);
    results.push(result);
  }

  return results;
}

// =============================================================================
// Consolidation
// =============================================================================

interface ConsolidationResult {
  changed: boolean;
  mergeCount: number;
  splitCount: number;
  subsectorCount: number;
}

/**
 * Consolidate sub-sectors to meet count and size targets.
 *
 * Strategy:
 * 1. If too many sub-sectors → merge smallest/most-similar pairs (agglomerative)
 * 2. If any sub-sector oversized → split by finer CPC granularity
 * 3. Review general bucket — can any patents be placed in real sub-sectors?
 *
 * Merge similarity is based on CPC prefix: sub-sectors sharing a CPC class
 * prefix (e.g., both under H04L41) are merged first. Among same-prefix
 * candidates, the smallest pair is merged first.
 */
async function consolidateSubsectors(
  sectorParentId: string,
  spec: RefactorSpec,
  sectorCode: string
): Promise<ConsolidationResult> {
  let mergeCount = 0;
  let splitCount = 0;
  let changed = false;

  // Load current sub-sector state
  let subsectors = await loadSubsectorState(sectorParentId, spec);

  // ── Merge phase: reduce count to targetSubsectorCount.max ──────────
  // Also merge any undersized sub-sectors while we're at it

  const shouldMerge = () => {
    const nonGeneral = subsectors.filter(s => !s.isGeneral);
    const undersized = nonGeneral.filter(s => s.primaryCount > 0 && s.primaryCount < spec.targetSubsectorSize.min);
    return nonGeneral.length > spec.targetSubsectorCount.max || undersized.length > 0;
  };

  while (shouldMerge()) {
    const merge = findBestMerge(subsectors, spec);
    if (!merge) break;

    await executeMerge(merge.a, merge.b, spec);
    mergeCount++;
    changed = true;

    // Reload state after merge
    subsectors = await loadSubsectorState(sectorParentId, spec);
  }

  // ── Split phase: break up oversized sub-sectors ────────────────────

  const oversized = subsectors.filter(s =>
    !s.isGeneral && s.primaryCount > spec.targetSubsectorSize.max
  );

  for (const sub of oversized) {
    const didSplit = await splitSubsector(sub, spec, sectorCode);
    if (didSplit) {
      splitCount++;
      changed = true;
    }
  }

  // Reload final state
  subsectors = await loadSubsectorState(sectorParentId, spec);

  // ── Cleanup: remove empty non-general nodes ─────────────────────
  // After merging, some nodes have 0 patents and 0 rules (all moved to survivor).
  // Delete them to keep the taxonomy clean.

  subsectors = await loadSubsectorState(sectorParentId, spec);
  for (const sub of subsectors) {
    if (sub.isGeneral) continue;
    if (sub.primaryCount === 0) {
      // No patents assigned — remove this empty node and its rules
      await prisma.objectClassification.deleteMany({
        where: { taxonomyNodeId: sub.id },
      });
      await prisma.taxonomyRule.deleteMany({
        where: { targetNodeId: sub.id },
      });
      await prisma.taxonomyNode.delete({ where: { id: sub.id } });
      changed = true;
    }
  }

  // ── General bucket review ──────────────────────────────────────────
  subsectors = await loadSubsectorState(sectorParentId, spec);

  const generalNode = subsectors.find(s => s.isGeneral);
  if (generalNode && generalNode.primaryCount > 0) {
    const relocated = await reviewGeneralBucket(generalNode, subsectors, spec);
    if (relocated > 0) {
      changed = true;
      subsectors = await loadSubsectorState(sectorParentId, spec);
    }
  }

  return {
    changed,
    mergeCount,
    splitCount,
    subsectorCount: subsectors.filter(s => s.primaryCount > 0 || s.isGeneral).length,
  };
}

/**
 * Load current sub-sector state from DB.
 */
async function loadSubsectorState(
  sectorParentId: string,
  spec: RefactorSpec
): Promise<SubsectorState[]> {
  const nodes = await prisma.taxonomyNode.findMany({
    where: {
      taxonomyTypeId: spec.outputTaxonomyTypeId,
      parentId: sectorParentId,
      level: 3,
    },
    select: { id: true, code: true, name: true },
  });

  const result: SubsectorState[] = [];

  for (const node of nodes) {
    // Get rules for this node
    const rules = await prisma.taxonomyRule.findMany({
      where: {
        taxonomyTypeId: spec.outputTaxonomyTypeId,
        targetNodeId: node.id,
      },
      select: { expression: true },
    });

    // Get primary classification count
    const primaryCount = await prisma.objectClassification.count({
      where: {
        portfolioGroupId: spec.outputPortfolioGroupId,
        taxonomyNodeId: node.id,
        associationRank: 1,
      },
    });

    result.push({
      id: node.id,
      code: node.code,
      name: node.name,
      cpcPatterns: rules.map(r => r.expression),
      primaryCount,
      isGeneral: node.code.endsWith('/general'),
    });
  }

  return result;
}

/**
 * Find the best pair of sub-sectors to merge.
 *
 * Priority:
 * 1. Merge pairs that share a CPC class prefix (most similar)
 * 2. Among same-prefix pairs, merge the smallest combined size
 * 3. Never merge if result would exceed targetSubsectorSize.max
 * 4. Prefer merging undersized sub-sectors
 * 5. Never merge the general catch-all
 */
function findBestMerge(
  subsectors: SubsectorState[],
  spec: RefactorSpec
): { a: SubsectorState; b: SubsectorState } | null {
  const candidates = subsectors.filter(s => !s.isGeneral && s.primaryCount > 0);
  if (candidates.length <= spec.targetSubsectorCount.min) return null;

  let bestPair: { a: SubsectorState; b: SubsectorState } | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const combinedSize = a.primaryCount + b.primaryCount;

      // Don't merge if result would be oversized
      if (combinedSize > spec.targetSubsectorSize.max) continue;

      // Scoring: higher = more attractive merge
      let score = 0;

      // CPC prefix similarity (strongest signal)
      const prefixSim = cpcPrefixSimilarity(a.cpcPatterns, b.cpcPatterns);
      score += prefixSim * 100;

      // Prefer merging undersized sub-sectors
      if (a.primaryCount < spec.targetSubsectorSize.min) score += 20;
      if (b.primaryCount < spec.targetSubsectorSize.min) score += 20;

      // Prefer merging smaller sub-sectors (less disruption)
      score -= combinedSize * 0.01;

      // Strong preference for merging empty or near-empty sub-sectors
      if (a.primaryCount === 0 || b.primaryCount === 0) score += 50;
      if (a.primaryCount < 5 || b.primaryCount < 5) score += 30;

      if (score > bestScore) {
        bestScore = score;
        bestPair = { a, b };
      }
    }
  }

  return bestPair;
}

/**
 * CPC prefix similarity between two sub-sectors.
 * Returns 0-1: 1 = same CPC class, 0 = completely different.
 */
function cpcPrefixSimilarity(patternsA: string[], patternsB: string[]): number {
  if (patternsA.length === 0 || patternsB.length === 0) return 0.5; // Unknown = neutral

  const prefixesA = new Set(patternsA.map(p => cpcClassPrefix(p)));
  const prefixesB = new Set(patternsB.map(p => cpcClassPrefix(p)));

  // Jaccard similarity on CPC class prefixes
  const intersection = [...prefixesA].filter(p => prefixesB.has(p)).length;
  const union = new Set([...prefixesA, ...prefixesB]).size;

  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract the CPC class prefix (e.g., "H04L41" from "H04L41/08").
 */
function cpcClassPrefix(pattern: string): string {
  // Remove trailing slash and get the class part
  const clean = pattern.replace(/\/$/, '');
  const slashIdx = clean.indexOf('/');
  return slashIdx >= 0 ? clean.substring(0, slashIdx) : clean;
}

/**
 * Execute a merge: combine two sub-sectors into one.
 *
 * - Keeps the larger sub-sector's node, deletes the smaller
 * - Moves rules from the smaller to the larger
 * - Updates classifications to point to the surviving node
 */
async function executeMerge(
  a: SubsectorState,
  b: SubsectorState,
  spec: RefactorSpec
): Promise<void> {
  // Keep the larger one (or alphabetically first if equal)
  const [survivor, absorbed] = a.primaryCount >= b.primaryCount ? [a, b] : [b, a];

  // Move rules from absorbed → survivor
  await prisma.taxonomyRule.updateMany({
    where: {
      taxonomyTypeId: spec.outputTaxonomyTypeId,
      targetNodeId: absorbed.id,
    },
    data: { targetNodeId: survivor.id },
  });

  // Move classifications from absorbed → survivor
  // First delete any that would create duplicates (same patent+rank)
  const absorbedClassifications = await prisma.objectClassification.findMany({
    where: {
      portfolioGroupId: spec.outputPortfolioGroupId,
      taxonomyNodeId: absorbed.id,
    },
    select: { id: true, objectId: true, associationRank: true },
  });

  for (const cls of absorbedClassifications) {
    // Check if survivor already has this patent at this rank
    const existing = await prisma.objectClassification.findFirst({
      where: {
        portfolioGroupId: spec.outputPortfolioGroupId,
        taxonomyNodeId: survivor.id,
        objectId: cls.objectId,
        associationRank: cls.associationRank,
      },
    });

    if (existing) {
      // Delete the absorbed one (survivor already has it)
      await prisma.objectClassification.delete({ where: { id: cls.id } });
    } else {
      // Move to survivor
      await prisma.objectClassification.update({
        where: { id: cls.id },
        data: { taxonomyNodeId: survivor.id },
      });
    }
  }

  // Delete the absorbed node
  await prisma.taxonomyNode.delete({ where: { id: absorbed.id } });

  // Update survivor's name if it was generic
  if (survivor.name.includes('-group') || survivor.name.includes('-broad')) {
    const combinedName = generateMergedName(survivor.cpcPatterns, absorbed.cpcPatterns);
    if (combinedName) {
      await prisma.taxonomyNode.update({
        where: { id: survivor.id },
        data: { name: combinedName },
      });
    }
  }
}

/**
 * Generate a reasonable name for a merged sub-sector.
 */
function generateMergedName(patternsA: string[], patternsB: string[]): string | null {
  const allPatterns = [...patternsA, ...patternsB];
  if (allPatterns.length === 0) return null;

  // Find the common CPC prefix
  const prefixes = allPatterns.map(p => cpcClassPrefix(p));
  const uniquePrefixes = [...new Set(prefixes)];

  if (uniquePrefixes.length === 1) {
    return `${uniquePrefixes[0]} group`;
  }
  if (uniquePrefixes.length <= 3) {
    return `${uniquePrefixes.join(' + ')} group`;
  }
  return null; // Too diverse to name automatically
}

/**
 * Split an oversized sub-sector into smaller ones using finer CPC granularity.
 *
 * Gets the patents in the sub-sector, analyzes their CPC distribution at
 * a finer level, and creates child sub-sectors.
 */
async function splitSubsector(
  sub: SubsectorState,
  spec: RefactorSpec,
  sectorCode: string
): Promise<boolean> {
  if (sub.cpcPatterns.length === 0) return false;

  // Get patents in this sub-sector
  const classifications = await prisma.objectClassification.findMany({
    where: {
      portfolioGroupId: spec.outputPortfolioGroupId,
      taxonomyNodeId: sub.id,
      associationRank: 1,
    },
    select: { objectId: true },
  });
  const patentIds = classifications.map(c => c.objectId);
  if (patentIds.length === 0) return false;

  // Get CPC codes at finer granularity
  const patentCpcs = await prisma.patentCpc.findMany({
    where: {
      patentId: { in: patentIds },
      isInventive: true,
    },
    select: { patentId: true, cpcCode: true },
  });

  // Group by fine-grained CPC (subgroup level)
  const cpcGroups = new Map<string, Set<string>>();
  for (const pc of patentCpcs) {
    if (pc.cpcCode.startsWith('Y')) continue;
    // Use the first 9 chars as the fine-grained key (e.g., "H04L41/08")
    const fineKey = pc.cpcCode.substring(0, Math.min(9, pc.cpcCode.length));
    if (!cpcGroups.has(fineKey)) cpcGroups.set(fineKey, new Set());
    cpcGroups.get(fineKey)!.add(pc.patentId);
  }

  // Sort by size descending
  const sorted = [...cpcGroups.entries()].sort((a, b) => b[1].size - a[1].size);

  // Need at least 2 meaningful groups to split
  const meaningful = sorted.filter(([, pats]) => pats.size >= spec.targetSubsectorSize.min);
  if (meaningful.length < 2) return false;

  // Create new sub-sector nodes for the largest groups
  // Keep the original node as a catch-all for the rest
  const parentNode = await prisma.taxonomyNode.findUnique({
    where: { id: sub.id },
    select: { parentId: true, path: true },
  });
  if (!parentNode?.parentId) return false;

  let splitsDone = 0;
  for (const [cpcKey, patents] of meaningful) {
    if (patents.size < spec.targetSubsectorSize.min) continue;
    if (splitsDone >= 4) break; // Max 4 splits per sub-sector

    const slug = cpcKey.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const newCode = `${sectorCode}/${slug}-split`;

    // Check if node already exists
    const existing = await prisma.taxonomyNode.findFirst({
      where: { taxonomyTypeId: spec.outputTaxonomyTypeId, code: newCode },
    });
    if (existing) continue;

    // Create the split node
    const newNode = await prisma.taxonomyNode.create({
      data: {
        taxonomyTypeId: spec.outputTaxonomyTypeId,
        code: newCode,
        name: `${cpcKey} (split)`,
        level: 3,
        path: `${parentNode.path}/${slug}-split`,
        parentId: parentNode.parentId,
        metadata: {},
      },
    });

    // Create rule for this split
    await prisma.taxonomyRule.create({
      data: {
        taxonomyTypeId: spec.outputTaxonomyTypeId,
        targetNodeId: newNode.id,
        ruleType: 'CPC_PREFIX',
        expression: cpcKey,
        priority: spec.priorities.specificSubgroup,
        isExclusion: false,
        scope: 'GLOBAL',
      },
    });

    splitsDone++;
  }

  return splitsDone > 0;
}

/**
 * Review the general/catch-all bucket.
 *
 * For each patent in the general sub-sector, check if it matches any
 * non-general sub-sector's rules. If so, the patent shouldn't be in general.
 * This catches patents that fell through during initial classification but
 * could match after consolidation broadened some sub-sectors.
 *
 * Returns the number of patents relocated.
 */
async function reviewGeneralBucket(
  generalNode: SubsectorState,
  allSubsectors: SubsectorState[],
  spec: RefactorSpec
): Promise<number> {
  // Get patents in the general bucket
  const generalClassifications = await prisma.objectClassification.findMany({
    where: {
      portfolioGroupId: spec.outputPortfolioGroupId,
      taxonomyNodeId: generalNode.id,
      associationRank: 1,
    },
    select: { id: true, objectId: true },
  });

  if (generalClassifications.length === 0) return 0;

  // Load all non-general rules for this sector
  const nonGeneralIds = allSubsectors.filter(s => !s.isGeneral).map(s => s.id);
  const rules = await prisma.taxonomyRule.findMany({
    where: {
      taxonomyTypeId: spec.outputTaxonomyTypeId,
      targetNodeId: { in: nonGeneralIds },
      isExclusion: false,
    },
    orderBy: { priority: 'desc' },
  });

  if (rules.length === 0) return 0;

  // Get CPCs for general-bucket patents
  const patentIds = generalClassifications.map(c => c.objectId);
  const patentCpcs = await prisma.patentCpc.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, cpcCode: true, isInventive: true },
  });

  const cpcsByPatent = new Map<string, { cpcCode: string; isInventive: boolean }[]>();
  for (const pc of patentCpcs) {
    if (!cpcsByPatent.has(pc.patentId)) cpcsByPatent.set(pc.patentId, []);
    cpcsByPatent.get(pc.patentId)!.push(pc);
  }

  // Try to reclassify each general-bucket patent
  let relocated = 0;
  for (const cls of generalClassifications) {
    const cpcs = cpcsByPatent.get(cls.objectId) || [];

    // Find best matching non-general sub-sector
    let bestNodeId: string | null = null;
    let bestWeight = 0;

    for (const cpc of cpcs) {
      if (cpc.cpcCode.startsWith('Y')) continue;

      for (const rule of rules) {
        const normCpc = cpc.cpcCode.replace(/\//g, '');
        const normExpr = rule.expression.replace(/\//g, '');
        const matches = rule.ruleType === 'CPC_PREFIX'
          ? normCpc.startsWith(normExpr)
          : normCpc === normExpr;

        if (matches) {
          const weight = (cpc.isInventive ? spec.inventiveSourceWeight : spec.additionalSourceWeight)
            * (1.0 + rule.priority * 0.1);
          if (weight > bestWeight) {
            bestWeight = weight;
            bestNodeId = rule.targetNodeId;
          }
          break;
        }
      }
    }

    if (bestNodeId) {
      // Move from general to the matching sub-sector
      await prisma.objectClassification.update({
        where: { id: cls.id },
        data: { taxonomyNodeId: bestNodeId },
      });
      relocated++;
    }
  }

  return relocated;
}

// =============================================================================
// Helpers
// =============================================================================

function emptyResult(sectorCode: string, sectorNodeId: string): SectorRefactorResult {
  return {
    sectorCode, sectorNodeId,
    iterations: 0, nodesCreated: 0, rulesCreated: 0,
    patentsClassified: 0, classificationsCreated: 0,
    violations: [], converged: true, subsectorCount: 0,
  };
}

/**
 * Adjust targets based on sector size.
 * Small sectors shouldn't be forced to have 25 sub-sectors.
 */
function adjustTargetsForSectorSize(spec: RefactorSpec, totalPatents: number): RefactorSpec {
  const adjusted = { ...spec };

  // Scale target sub-sector count based on sector size
  // Small sector (< 200 patents): 2-5 sub-sectors
  // Medium sector (200-2000): 3-15 sub-sectors
  // Large sector (2000+): 5-25 sub-sectors
  if (totalPatents < 200) {
    adjusted.targetSubsectorCount = {
      min: Math.min(2, spec.targetSubsectorCount.min),
      max: Math.min(5, spec.targetSubsectorCount.max),
    };
    adjusted.targetSubsectorSize = {
      min: Math.min(10, spec.targetSubsectorSize.min),
      max: spec.targetSubsectorSize.max,
    };
  } else if (totalPatents < 2000) {
    adjusted.targetSubsectorCount = {
      min: Math.min(3, spec.targetSubsectorCount.min),
      max: Math.min(15, spec.targetSubsectorCount.max),
    };
  }
  // Large sectors use the spec defaults

  return adjusted;
}

/**
 * Get all sub-sector node IDs under a sector parent.
 */
async function getSubsectorNodeIds(
  sectorParentId: string,
  taxonomyTypeId: string
): Promise<Map<string, string>> {
  const nodes = await prisma.taxonomyNode.findMany({
    where: {
      taxonomyTypeId,
      parentId: sectorParentId,
      level: 3,
    },
    select: { id: true, code: true },
  });

  const map = new Map<string, string>();
  for (const n of nodes) map.set(n.code, n.id);
  return map;
}

/**
 * Find or create the output taxonomy L2 sector node.
 */
async function findOrCreateOutputSector(
  inputSector: { id: string; code: string; name: string; parentId: string | null },
  outputTaxonomyTypeId: string,
  dryRun: boolean
): Promise<string> {
  const existing = await prisma.taxonomyNode.findFirst({
    where: {
      taxonomyTypeId: outputTaxonomyTypeId,
      code: inputSector.code,
      level: 2,
    },
  });
  if (existing) return existing.id;

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
 */
async function classifyPatents(
  analysis: CpcAnalysisResult,
  spec: RefactorSpec,
  nodeIds: Map<string, string>
): Promise<{ patentsClassified: number; classificationsCreated: number }> {
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

  // Load output rules
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

  // Classify each patent
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

  // Clear existing classifications for these patents
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
      skipDuplicates: true,
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

  // Count non-general sub-sectors that actually have patents
  let nonGeneralWithPatents = 0;
  const sizeResults: { code: string; id: string; count: number }[] = [];

  for (const { code, id } of realNodeIds) {
    if (code.endsWith('/general')) continue;
    const cnt = await prisma.objectClassification.count({
      where: {
        portfolioGroupId: spec.outputPortfolioGroupId,
        taxonomyNodeId: id,
        associationRank: 1,
      },
    });
    if (cnt > 0) nonGeneralWithPatents++;
    sizeResults.push({ code, id, count: cnt });
  }

  const nonGeneralCount = nonGeneralWithPatents;
  if (nonGeneralCount > spec.targetSubsectorCount.max) {
    violations.push({
      type: 'too-many-subsectors',
      nodeCode: '_sector',
      actual: nonGeneralCount,
      target: spec.targetSubsectorCount.max,
    });
  }
  if (nonGeneralCount < spec.targetSubsectorCount.min && nonGeneralCount > 0) {
    violations.push({
      type: 'too-few-subsectors',
      nodeCode: '_sector',
      actual: nonGeneralCount,
      target: spec.targetSubsectorCount.min,
    });
  }

  for (const { code, id, count: totalCount } of sizeResults) {
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
