/**
 * Taxonomy Proposer Service
 *
 * Generates sub-sector proposals from CPC analysis results, creates
 * TaxonomyNode and TaxonomyRule entries in the database.
 *
 * Replaces ad-hoc scripts: setup-v2-refined.ts, setup-v2-network-mgmt.ts
 *
 * Core workflow:
 *   1. Receive CPC analysis results (from TaxonomyAnalyzerService)
 *   2. Cluster CPC groups into candidate sub-sectors
 *   3. Generate rules with priority-based matching
 *   4. Create nodes and rules in DB
 *   5. Return proposal for validation
 */

import { PrismaClient } from '@prisma/client';
import type { CpcGroupDistribution, CpcAnalysisResult } from './taxonomy-analyzer-service.js';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface SubsectorProposal {
  code: string;
  name: string;
  abbreviation: string;
  cpcPatterns: string[];
  priority: number;
  estimatedTotal: number;
  estimatedPortfolioCounts: Record<string, number>;
}

export interface ProposalResult {
  parentNodeCode: string;
  subsectors: SubsectorProposal[];
  rules: RuleProposal[];
  catchAllNodeCode: string;
  totalRules: number;
}

export interface RuleProposal {
  targetCode: string;
  expression: string;
  priority: number;
  ruleType: 'CPC_PREFIX';
}

export interface ProposerConfig {
  /** Target size range for sub-sectors */
  targetSize: { min: number; max: number };
  /** Maximum per-portfolio count */
  maxPortfolioSize: number;
  /** Portfolio IDs to check against maxPortfolioSize */
  referencePortfolioIds: string[];
  /** Priority tiers for rule generation */
  priorities: {
    specificSubgroup: number;    // e.g., 85
    groupLevel: number;          // e.g., 75
    broadCatch: number;          // e.g., 60
    ultimateCatchAll: number;    // e.g., 40
  };
  /** Minimum patents for a CPC group to become its own sub-sector */
  minPatsForSubsector: number;
  /** Handle dual CPC numbering (3-digit vs 4-digit) */
  handleDualNumbering: boolean;
  /** Naming convention */
  naming: {
    parentAbbreviation: string;  // e.g., 'MGMT'
    parentPrefix: string;        // e.g., 'SDN/MGMT'
    slugStyle: 'kebab-case';
    abbrevLength: number;        // e.g., 4
  };
}

export interface CreateResult {
  nodesCreated: number;
  rulesCreated: number;
  nodeIds: Map<string, string>; // code → id
}

// =============================================================================
// Proposal Generation
// =============================================================================

/**
 * Generate sub-sector proposals from CPC analysis results.
 *
 * This is the "brain" that turns raw CPC distribution data into
 * proposed sub-sector definitions with rules and priorities.
 */
export function generateProposals(
  analysis: CpcAnalysisResult,
  config: ProposerConfig
): ProposalResult {
  const { targetSize, maxPortfolioSize, priorities, minPatsForSubsector, naming } = config;

  // Group CPC distributions by their top-level class (e.g., H04L41, H04L43)
  const byClass = groupByClass(analysis.groupDistributions);
  const proposals: SubsectorProposal[] = [];
  const rules: RuleProposal[] = [];

  for (const [cpcClass, groups] of byClass) {
    // Sort by patent count descending
    const sorted = [...groups].sort((a, b) => b.totalPatents - a.totalPatents);

    // Cluster groups into sub-sectors
    const clusters = clusterGroups(sorted, targetSize, maxPortfolioSize, minPatsForSubsector, config.referencePortfolioIds);

    for (const cluster of clusters) {
      const slug = generateSlug(cluster.label);
      const code = `${naming.parentPrefix}/${slug}`;
      const abbrev = generateAbbreviation(slug, naming.abbrevLength);

      const proposal: SubsectorProposal = {
        code,
        name: cluster.label,
        abbreviation: abbrev,
        cpcPatterns: cluster.patterns,
        priority: cluster.isSpecific ? priorities.specificSubgroup : priorities.groupLevel,
        estimatedTotal: cluster.estimatedTotal,
        estimatedPortfolioCounts: cluster.estimatedPortfolioCounts,
      };
      proposals.push(proposal);

      // Generate rules for this sub-sector
      for (const pattern of cluster.patterns) {
        const rulePriority = getPatternPriority(pattern, cluster.isSpecific, priorities);
        rules.push({
          targetCode: code,
          expression: pattern,
          priority: rulePriority,
          ruleType: 'CPC_PREFIX',
        });
      }
    }

    // Add catch-all rule for this CPC class
    const catchAllCode = `${naming.parentPrefix}/${generateSlug(cpcClass + '-other')}`;
    rules.push({
      targetCode: catchAllCode,
      expression: cpcClass.replace(/(\d)$/, '$1/'),  // H04L41 → H04L41/
      priority: priorities.ultimateCatchAll,
      ruleType: 'CPC_PREFIX',
    });
  }

  // Add a general catch-all sub-sector
  const generalCode = `${naming.parentPrefix}/general`;
  if (!proposals.some((p) => p.code === generalCode)) {
    proposals.push({
      code: generalCode,
      name: 'General',
      abbreviation: 'GNRL',
      cpcPatterns: [],
      priority: priorities.ultimateCatchAll,
      estimatedTotal: 0,
      estimatedPortfolioCounts: {},
    });
  }

  return {
    parentNodeCode: naming.parentPrefix,
    subsectors: proposals,
    rules,
    catchAllNodeCode: generalCode,
    totalRules: rules.length,
  };
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * Create taxonomy nodes and rules in the database from a proposal.
 *
 * This is the equivalent of the "setup" scripts but driven by proposals
 * rather than hardcoded arrays.
 */
export async function createFromProposal(
  proposal: ProposalResult,
  taxonomyTypeId: string,
  parentNodeId: string,
  options: { dryRun?: boolean; clearExisting?: boolean } = {}
): Promise<CreateResult> {
  const { dryRun = false, clearExisting = true } = options;

  // 1. Optionally clear existing sub-nodes
  if (clearExisting && !dryRun) {
    await clearSubtree(parentNodeId, taxonomyTypeId);
  }

  // 2. Create nodes
  const nodeIdMap = new Map<string, string>();       // codes from THIS proposal
  const allNodeIdMap = new Map<string, string>();    // all existing + new (for rule target lookup)

  // Load existing nodes (for parent references and rule target lookup)
  const existingNodes = await prisma.taxonomyNode.findMany({
    where: { taxonomyTypeId },
    select: { id: true, code: true, path: true },
  });
  for (const n of existingNodes) {
    allNodeIdMap.set(n.code, n.id);
  }

  let nodesCreated = 0;
  for (const sub of proposal.subsectors) {
    const parentId = allNodeIdMap.get(proposal.parentNodeCode) || parentNodeId;

    if (dryRun) {
      const dryId = `dry-run-${sub.code}`;
      nodeIdMap.set(sub.code, dryId);
      allNodeIdMap.set(sub.code, dryId);
      nodesCreated++;
      continue;
    }

    // Check if node already exists (e.g., from a previous partial run)
    const existingNode = await prisma.taxonomyNode.findFirst({
      where: { taxonomyTypeId, code: sub.code },
    });
    if (existingNode) {
      nodeIdMap.set(sub.code, existingNode.id);
      allNodeIdMap.set(sub.code, existingNode.id);
      continue; // Already exists, skip creation
    }

    // Build path from parent
    const parentNode = await prisma.taxonomyNode.findUnique({
      where: { id: parentId },
      select: { path: true },
    });
    const slug = sub.code.split('/').pop()!;
    const path = parentNode ? `${parentNode.path}/${slug}` : sub.code;

    const created = await prisma.taxonomyNode.create({
      data: {
        taxonomyTypeId,
        code: sub.code,
        name: sub.name,
        level: 3, // sub-sectors are level 3
        path,
        parentId,
        metadata: { abbreviation: sub.abbreviation },
      },
    });
    nodeIdMap.set(sub.code, created.id);
    allNodeIdMap.set(sub.code, created.id);
    nodesCreated++;
  }

  // 3. Create rules
  let rulesCreated = 0;
  for (const rule of proposal.rules) {
    const targetNodeId = allNodeIdMap.get(rule.targetCode);
    if (!targetNodeId) {
      // If target doesn't exist, map to general catch-all
      const generalId = allNodeIdMap.get(proposal.catchAllNodeCode);
      if (!generalId) continue;
    }

    if (dryRun) {
      rulesCreated++;
      continue;
    }

    const finalTargetId = allNodeIdMap.get(rule.targetCode)
      || allNodeIdMap.get(proposal.catchAllNodeCode);
    if (!finalTargetId) continue;

    await prisma.taxonomyRule.create({
      data: {
        taxonomyTypeId,
        targetNodeId: finalTargetId,
        ruleType: rule.ruleType,
        expression: rule.expression,
        priority: rule.priority,
        isExclusion: false,
        scope: 'GLOBAL',
      },
    });
    rulesCreated++;
  }

  return { nodesCreated, rulesCreated, nodeIds: nodeIdMap };
}

/**
 * Clear all sub-nodes (and their rules/classifications) under a parent.
 */
async function clearSubtree(parentNodeId: string, taxonomyTypeId: string): Promise<void> {
  const childNodes = await prisma.taxonomyNode.findMany({
    where: { taxonomyTypeId, parentId: parentNodeId },
    select: { id: true },
  });
  const childIds = childNodes.map((n) => n.id);

  if (childIds.length === 0) return;

  // Clear classifications referencing these nodes
  await prisma.objectClassification.deleteMany({
    where: { taxonomyNodeId: { in: childIds } },
  });

  // Clear rules targeting these nodes
  await prisma.taxonomyRule.deleteMany({
    where: { targetNodeId: { in: childIds } },
  });

  // Delete child nodes
  await prisma.taxonomyNode.deleteMany({
    where: { id: { in: childIds } },
  });
}

// =============================================================================
// Clustering Algorithm
// =============================================================================

interface CpcCluster {
  label: string;
  patterns: string[];
  isSpecific: boolean;
  estimatedTotal: number;
  estimatedPortfolioCounts: Record<string, number>;
}

/**
 * Cluster CPC groups into sub-sectors that meet size targets.
 *
 * Strategy:
 *   - Large groups (> targetSize.max): split by finer CPC granularity
 *   - Medium groups (in range): each becomes its own sub-sector
 *   - Small groups (< minPatsForSubsector): merge with related groups
 */
function clusterGroups(
  groups: CpcGroupDistribution[],
  targetSize: { min: number; max: number },
  maxPortfolioSize: number,
  minPats: number,
  referencePortfolioIds: string[]
): CpcCluster[] {
  const clusters: CpcCluster[] = [];
  const used = new Set<string>();

  // Pass 1: Groups that are good candidates on their own
  for (const g of groups) {
    if (used.has(g.cpcGroup)) continue;

    const exceedsPortfolio = Object.values(g.portfolioCounts).some((c) => c > maxPortfolioSize);

    if (g.totalPatents >= minPats && g.totalPatents <= targetSize.max && !exceedsPortfolio) {
      clusters.push({
        label: g.cpcGroup.replace('/', '-'),
        patterns: [g.cpcGroup],
        isSpecific: g.cpcGroup.length > 7, // longer patterns are more specific
        estimatedTotal: g.totalPatents,
        estimatedPortfolioCounts: g.portfolioCounts,
      });
      used.add(g.cpcGroup);
    }
  }

  // Pass 2: Groups that need splitting (too large or portfolio exceeded)
  for (const g of groups) {
    if (used.has(g.cpcGroup)) continue;

    if (g.totalPatents > targetSize.max ||
        Object.values(g.portfolioCounts).some((c) => c > maxPortfolioSize)) {
      // This group needs to be split — mark as needing finer granularity analysis
      // For now, include it with a flag; the refactor loop will drill deeper
      clusters.push({
        label: `${g.cpcGroup.replace('/', '-')}-broad`,
        patterns: [g.cpcGroup],
        isSpecific: false,
        estimatedTotal: g.totalPatents,
        estimatedPortfolioCounts: g.portfolioCounts,
      });
      used.add(g.cpcGroup);
    }
  }

  // Pass 3: Merge small groups with similar CPC prefixes
  const remaining = groups.filter((g) => !used.has(g.cpcGroup) && g.totalPatents >= 5);
  const byPrefix = new Map<string, CpcGroupDistribution[]>();
  for (const g of remaining) {
    const prefix = g.cpcGroup.substring(0, Math.min(7, g.cpcGroup.length));
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix)!.push(g);
  }

  for (const [prefix, relatedGroups] of byPrefix) {
    const totalPats = relatedGroups.reduce((s, g) => s + g.totalPatents, 0);
    if (totalPats >= minPats) {
      const mergedPortfolio: Record<string, number> = {};
      for (const g of relatedGroups) {
        for (const [name, cnt] of Object.entries(g.portfolioCounts)) {
          mergedPortfolio[name] = (mergedPortfolio[name] || 0) + cnt;
        }
      }

      clusters.push({
        label: `${prefix.replace('/', '-')}-group`,
        patterns: relatedGroups.map((g) => g.cpcGroup),
        isSpecific: false,
        estimatedTotal: totalPats,
        estimatedPortfolioCounts: mergedPortfolio,
      });
    }
  }

  return clusters;
}

// =============================================================================
// Naming Utilities
// =============================================================================

function groupByClass(groups: CpcGroupDistribution[]): Map<string, CpcGroupDistribution[]> {
  const result = new Map<string, CpcGroupDistribution[]>();
  for (const g of groups) {
    const cls = g.cpcGroup.split('/')[0]; // e.g., H04L41
    if (!result.has(cls)) result.set(cls, []);
    result.get(cls)!.push(g);
  }
  return result;
}

function generateSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 25);
}

function generateAbbreviation(slug: string, length: number): string {
  const parts = slug.split('-');
  if (parts.length === 1) {
    return slug.substring(0, length).toUpperCase();
  }
  // Take first letter of each part, pad to length
  let abbrev = parts.map((p) => p[0]).join('').toUpperCase();
  if (abbrev.length < length) {
    abbrev += parts[0].substring(1, 1 + length - abbrev.length).toUpperCase();
  }
  return abbrev.substring(0, length);
}

function getPatternPriority(
  pattern: string,
  isSpecific: boolean,
  priorities: ProposerConfig['priorities']
): number {
  // Longer patterns are more specific
  const afterSlash = pattern.split('/')[1] || '';
  if (afterSlash.length >= 4) return priorities.specificSubgroup;
  if (afterSlash.length >= 2) return isSpecific ? priorities.specificSubgroup : priorities.groupLevel;
  if (afterSlash.length >= 1) return priorities.broadCatch;
  return priorities.ultimateCatchAll;
}
