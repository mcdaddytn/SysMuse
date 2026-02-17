/**
 * Family Expansion V2 Service
 *
 * Iterative, one-generation-at-a-time expansion with multi-factor scoring.
 * Uses the scoring engine from family-expansion-scorer.ts and the citation
 * infrastructure from patent-family-service.ts.
 */

import { PrismaClient } from '@prisma/client';
import {
  loadPortfolioMap,
  loadPatentDetail,
  getForwardCitations,
  getBackwardCitations,
  createFocusAreaFromExploration,
  type PortfolioPatent,
} from './patent-family-service.js';
import {
  computeSeedAggregate,
  scoreCandidateBatch,
  loadCandidateData,
  rescoreCandidates as rescoreFromCache,
  computeScoreHistogram,
  applyThresholds,
  applyPortfolioBoost,
  DEFAULT_WEIGHTS,
  SCORING_PRESETS,
  type ScoringWeights,
  type CandidateScore,
  type SeedAggregate,
  type CandidateData,
  type DimensionScores,
} from './family-expansion-scorer.js';
import { getCompetitorMatcher } from '../../../services/competitor-config.js';
import { getPrimarySector, getSuperSector } from '../utils/sector-mapper.js';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  patentId: string;
  title?: string;
  assignee?: string;
  score: CandidateScore;
  generation: number;
  relation: string;
  inPortfolio: boolean;
  isCompetitor: boolean;
  competitorName?: string;
  isAffiliate: boolean;
  sector?: string;
  superSector?: string;
  filingDate?: string;
  remainingYears?: number;
  forwardCitationCount?: number;
  discoveredVia: string[];
  dataStatus: string;
  zone: 'member' | 'expansion' | 'rejected';
}

export interface ExpansionResult {
  candidates: ScoredCandidate[];
  stats: {
    totalDiscovered: number;
    aboveMembership: number;
    inExpansionZone: number;
    belowExpansion: number;
    pruned: number;
    direction: string;
    generationDepth: number;
  };
  scoreDistribution: number[];
  warnings: string[];
}

export interface ExplorationStateV2 {
  id: string;
  name?: string;
  seedPatentIds: string[];
  weights: ScoringWeights;
  membershipThreshold: number;
  expansionThreshold: number;
  currentGeneration: number;
  members: ScoredCandidate[];
  candidates: ScoredCandidate[];
  excluded: ScoredCandidate[];
  expansionHistory: Array<{
    stepNumber: number;
    direction: string;
    generationDepth: number;
    candidatesEvaluated: number;
    autoIncluded: number;
    expansionZone: number;
    autoRejected: number;
    createdAt: string;
  }>;
  status: string;
  memberCount: number;
  candidateCount: number;
}

const MAX_CANDIDATES_PER_EXPANSION = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Create Exploration
// ─────────────────────────────────────────────────────────────────────────────

export async function createExplorationV2(params: {
  seedPatentIds: string[];
  name?: string;
  weights?: ScoringWeights;
  membershipThreshold?: number;
  expansionThreshold?: number;
}): Promise<ExplorationStateV2> {
  const weights = params.weights || { ...DEFAULT_WEIGHTS };
  const membershipThreshold = params.membershipThreshold ?? 60;
  const expansionThreshold = params.expansionThreshold ?? 30;

  // Compute seed aggregate
  const seedAgg = computeSeedAggregate(params.seedPatentIds);

  // Create exploration record
  const exploration = await prisma.patentFamilyExploration.create({
    data: {
      seedPatentId: params.seedPatentIds[0],
      seedPatentIds: params.seedPatentIds,
      name: params.name,
      version: 2,
      weights: weights as any,
      membershipThreshold,
      expansionThreshold,
      seedAggregate: serializeSeedAggregate(seedAgg),
      currentGeneration: 0,
      memberCount: params.seedPatentIds.length,
      candidateCount: 0,
      status: 'RUNNING',
    },
  });

  // Add seed patents as members
  const portfolioMap = loadPortfolioMap();
  const competitorMatcher = getCompetitorMatcher();

  for (const seedId of params.seedPatentIds) {
    const detail = loadPatentDetail(seedId, portfolioMap);
    const compMatch = detail?.assignee ? competitorMatcher.matchCompetitor(detail.assignee) : null;

    await prisma.patentFamilyMember.create({
      data: {
        explorationId: exploration.id,
        patentId: seedId,
        status: 'member',
        relationToSeed: 'seed',
        generationDepth: 0,
        discoveredVia: [],
        discoveredAtStep: 0,
        dimensionScores: {} as any,
        compositeScore: 100,
        dataCompleteness: 1,
        inPortfolio: portfolioMap.has(seedId),
        title: detail?.patent_title,
        assignee: detail?.assignee,
        sector: detail?.primary_sector,
        superSector: detail?.super_sector,
        filingDate: detail?.patent_date,
        remainingYears: computeRemainingYears(detail?.patent_date),
        isCompetitor: !!compMatch,
        competitorName: compMatch?.company,
      },
    });
  }

  await prisma.patentFamilyExploration.update({
    where: { id: exploration.id },
    data: { status: 'COMPLETE' },
  });

  return getExplorationV2(exploration.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Expand One Generation
// ─────────────────────────────────────────────────────────────────────────────

export async function expandOneGeneration(
  explorationId: string,
  params: {
    direction: 'forward' | 'backward' | 'both';
    weights?: ScoringWeights;
    membershipThreshold?: number;
    expansionThreshold?: number;
    maxCandidates?: number;
    portfolioBoost?: { enabled: boolean; boostWeight: number; sectorStrengths: Record<string, number> };
  },
): Promise<ExpansionResult> {
  const exploration = await prisma.patentFamilyExploration.findUnique({
    where: { id: explorationId },
  });
  if (!exploration) throw new Error(`Exploration ${explorationId} not found`);

  const weights = params.weights || (exploration.weights as ScoringWeights) || DEFAULT_WEIGHTS;
  const membershipThreshold = params.membershipThreshold ?? exploration.membershipThreshold ?? 60;
  const expansionThreshold = params.expansionThreshold ?? exploration.expansionThreshold ?? 30;
  const maxCandidates = params.maxCandidates ?? MAX_CANDIDATES_PER_EXPANSION;

  // Load existing members to build frontier and alreadySeen
  const existingMembers = await prisma.patentFamilyMember.findMany({
    where: { explorationId },
  });

  const alreadySeen = new Set(existingMembers.map(m => m.patentId));

  // Frontier: members + candidates in expansion zone (not excluded)
  const frontier = existingMembers
    .filter(m => m.status === 'member' || m.status === 'candidate')
    .map(m => m.patentId);

  // Restore seed aggregate
  const seedAgg = exploration.seedAggregate
    ? deserializeSeedAggregate(exploration.seedAggregate as any)
    : computeSeedAggregate(exploration.seedPatentIds);

  const allowLive = !!process.env.PATENTSVIEW_API_KEY;
  const warnings: string[] = [];

  // Determine next generation depth — track forward and backward independently
  const forwardDepths = existingMembers.filter(m => m.generationDepth > 0).map(m => m.generationDepth);
  const backwardDepths = existingMembers.filter(m => m.generationDepth < 0).map(m => Math.abs(m.generationDepth));
  const maxForwardDepth = forwardDepths.length > 0 ? Math.max(...forwardDepths) : 0;
  const maxBackwardDepth = backwardDepths.length > 0 ? Math.max(...backwardDepths) : 0;

  let nextGenDepth: number;
  if (params.direction === 'forward') {
    nextGenDepth = maxForwardDepth + 1;
  } else if (params.direction === 'backward') {
    nextGenDepth = maxBackwardDepth + 1;
  } else {
    // 'both' — use the max of either direction
    nextGenDepth = Math.max(maxForwardDepth, maxBackwardDepth) + 1;
  }

  // Collect new candidate patent IDs with discoveredVia tracking
  const discoveredViaMap = new Map<string, string[]>();

  const addCandidate = (patentId: string, viaPatentId: string) => {
    if (alreadySeen.has(patentId)) return;
    const existing = discoveredViaMap.get(patentId);
    if (existing) {
      if (!existing.includes(viaPatentId)) existing.push(viaPatentId);
    } else {
      discoveredViaMap.set(patentId, [viaPatentId]);
    }
  };

  // Expand in requested direction(s)
  if (params.direction === 'backward' || params.direction === 'both') {
    for (const pid of frontier) {
      const parents = await getBackwardCitations(pid, allowLive);
      for (const parentId of parents) {
        addCandidate(parentId, pid);
      }
    }
  }

  if (params.direction === 'forward' || params.direction === 'both') {
    for (const pid of frontier) {
      const children = await getForwardCitations(pid, allowLive);
      for (const childId of children) {
        addCandidate(childId, pid);
      }
    }
  }

  const newPatentIds = Array.from(discoveredViaMap.keys());
  const totalDiscovered = newPatentIds.length;

  if (totalDiscovered > maxCandidates * 2) {
    warnings.push(`Large expansion: ${totalDiscovered} candidates discovered. Scoring all, but only top ${maxCandidates} will be returned.`);
  }

  // Load candidate data and score
  const genDepthSigned = params.direction === 'backward' ? -nextGenDepth : nextGenDepth;
  const relation = params.direction === 'backward' ? getRelationLabel(-nextGenDepth) : getRelationLabel(nextGenDepth);

  const candidateData = loadCandidateData(newPatentIds, genDepthSigned, relation, discoveredViaMap);
  let scores = scoreCandidateBatch(candidateData, seedAgg, weights);

  // Apply portfolio boost if requested
  if (params.portfolioBoost?.enabled) {
    const detailMap = new Map(candidateData.map(c => [c.patentId, c.detail]));
    scores = applyPortfolioBoost(scores, params.portfolioBoost.sectorStrengths, params.portfolioBoost.boostWeight, detailMap);
    scores.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  // Apply hard cap
  const pruned = Math.max(0, scores.length - maxCandidates);
  if (pruned > 0) {
    scores = scores.slice(0, maxCandidates);
  }

  // Partition into zones
  const zones = applyThresholds(scores, membershipThreshold, expansionThreshold);

  // Build ScoredCandidate objects
  const portfolioMap = loadPortfolioMap();
  const competitorMatcher = getCompetitorMatcher();

  const scoredCandidates = scores.map(score => {
    const cData = candidateData.find(c => c.patentId === score.patentId);
    const detail = cData?.detail;
    const compMatch = detail?.assignee ? competitorMatcher.matchCompetitor(detail.assignee) : null;

    let sector = detail?.primary_sector;
    let superSector = detail?.super_sector;
    if (!sector && detail?.cpc_codes && detail.cpc_codes.length > 0) {
      const inferred = getPrimarySector(detail.cpc_codes);
      if (inferred && inferred !== 'general') {
        sector = inferred;
        superSector = getSuperSector(inferred);
      }
    }

    let zone: 'member' | 'expansion' | 'rejected';
    if (score.compositeScore >= membershipThreshold) zone = 'member';
    else if (score.compositeScore >= expansionThreshold) zone = 'expansion';
    else zone = 'rejected';

    return {
      patentId: score.patentId,
      title: detail?.patent_title,
      assignee: detail?.assignee,
      score,
      generation: genDepthSigned,
      relation,
      inPortfolio: portfolioMap.has(score.patentId),
      isCompetitor: !!compMatch,
      competitorName: compMatch?.company,
      isAffiliate: cData?.inPortfolio ? false : !!(detail?.assignee && isAffiliate(detail.assignee)),
      sector,
      superSector,
      filingDate: detail?.patent_date,
      remainingYears: computeRemainingYears(detail?.patent_date),
      forwardCitationCount: detail?.forward_citations,
      discoveredVia: discoveredViaMap.get(score.patentId) || [],
      dataStatus: cData?.inPortfolio ? 'portfolio' : (detail?.patent_title ? 'cached' : 'not_attempted'),
      zone,
    } as ScoredCandidate;
  });

  // Persist candidates to database
  const stepNumber = await getNextStepNumber(explorationId);

  if (scoredCandidates.length > 0) {
    await prisma.patentFamilyMember.createMany({
      data: scoredCandidates.map(c => ({
        explorationId,
        patentId: c.patentId,
        status: c.zone === 'rejected' ? 'excluded' : 'candidate',
        relationToSeed: c.relation,
        generationDepth: c.generation,
        discoveredVia: c.discoveredVia,
        discoveredAtStep: stepNumber,
        dimensionScores: c.score.dimensions as any,
        compositeScore: c.score.compositeScore,
        dataCompleteness: c.score.dataCompleteness,
        inPortfolio: c.inPortfolio,
        title: c.title,
        assignee: c.assignee,
        sector: c.sector,
        superSector: c.superSector,
        filingDate: c.filingDate,
        remainingYears: c.remainingYears,
        isCompetitor: c.isCompetitor,
        competitorName: c.competitorName,
      })),
      skipDuplicates: true,
    });
  }

  // Record expansion step
  await prisma.patentFamilyExpansionStep.create({
    data: {
      explorationId,
      stepNumber,
      direction: params.direction,
      generationDepth: nextGenDepth,
      candidatesEvaluated: totalDiscovered,
      autoIncluded: zones.aboveMembership.length,
      expansionZone: zones.expansionZone.length,
      autoRejected: zones.belowExpansion.length,
      weightsUsed: weights as any,
      thresholdsUsed: { membership: membershipThreshold, expansion: expansionThreshold },
    },
  });

  // Update exploration state
  const allMembers = await prisma.patentFamilyMember.findMany({
    where: { explorationId },
  });
  await prisma.patentFamilyExploration.update({
    where: { id: explorationId },
    data: {
      currentGeneration: nextGenDepth,
      memberCount: allMembers.filter(m => m.status === 'member').length,
      candidateCount: allMembers.filter(m => m.status === 'candidate').length,
      weights: weights as any,
      membershipThreshold,
      expansionThreshold,
    },
  });

  return {
    candidates: scoredCandidates,
    stats: {
      totalDiscovered,
      aboveMembership: zones.aboveMembership.length,
      inExpansionZone: zones.expansionZone.length,
      belowExpansion: zones.belowExpansion.length,
      pruned,
      direction: params.direction,
      generationDepth: nextGenDepth,
    },
    scoreDistribution: computeScoreHistogram(scores),
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Expand Siblings (Bidirectional)
// ─────────────────────────────────────────────────────────────────────────────

export async function expandSiblings(
  explorationId: string,
  params: {
    direction: 'backward' | 'forward' | 'both';
    weights?: ScoringWeights;
    membershipThreshold?: number;
    expansionThreshold?: number;
    maxCandidates?: number;
    portfolioBoost?: { enabled: boolean; boostWeight: number; sectorStrengths: Record<string, number> };
  },
): Promise<ExpansionResult> {
  const exploration = await prisma.patentFamilyExploration.findUnique({
    where: { id: explorationId },
  });
  if (!exploration) throw new Error(`Exploration ${explorationId} not found`);

  const weights = params.weights || (exploration.weights as ScoringWeights) || DEFAULT_WEIGHTS;
  const membershipThreshold = params.membershipThreshold ?? exploration.membershipThreshold ?? 60;
  const expansionThreshold = params.expansionThreshold ?? exploration.expansionThreshold ?? 30;
  const maxCandidates = params.maxCandidates ?? MAX_CANDIDATES_PER_EXPANSION;

  const existingMembers = await prisma.patentFamilyMember.findMany({
    where: { explorationId },
  });
  const alreadySeen = new Set(existingMembers.map(m => m.patentId));

  // Frontier for sibling discovery: seeds + accepted members
  const frontier = existingMembers
    .filter(m => m.status === 'member')
    .map(m => m.patentId);

  const seedAgg = exploration.seedAggregate
    ? deserializeSeedAggregate(exploration.seedAggregate as any)
    : computeSeedAggregate(exploration.seedPatentIds);

  const allowLive = !!process.env.PATENTSVIEW_API_KEY;
  const warnings: string[] = [];
  const discoveredViaMap = new Map<string, string[]>();

  const addCandidate = (patentId: string, viaPatentId: string) => {
    if (alreadySeen.has(patentId)) return;
    const existing = discoveredViaMap.get(patentId);
    if (existing) {
      if (!existing.includes(viaPatentId)) existing.push(viaPatentId);
    } else {
      discoveredViaMap.set(patentId, [viaPatentId]);
    }
  };

  // Backward siblings: parents' other children
  if (params.direction === 'backward' || params.direction === 'both') {
    for (const pid of frontier) {
      const parents = await getBackwardCitations(pid, allowLive);
      for (const parentId of parents) {
        const siblings = await getForwardCitations(parentId, allowLive);
        for (const siblingId of siblings) {
          addCandidate(siblingId, pid);
        }
      }
    }
  }

  // Forward siblings (co-cited peers): children's other parents
  if (params.direction === 'forward' || params.direction === 'both') {
    for (const pid of frontier) {
      const children = await getForwardCitations(pid, allowLive);
      for (const childId of children) {
        const coCited = await getBackwardCitations(childId, allowLive);
        for (const peerId of coCited) {
          addCandidate(peerId, pid);
        }
      }
    }
  }

  const newPatentIds = Array.from(discoveredViaMap.keys());
  const totalDiscovered = newPatentIds.length;

  if (totalDiscovered > maxCandidates * 2) {
    warnings.push(`Large sibling expansion: ${totalDiscovered} candidates. Returning top ${maxCandidates} by score.`);
  }

  // Score siblings at generation distance 0 (same level)
  const candidateData = loadCandidateData(newPatentIds, 0, 'sibling', discoveredViaMap);
  let scores = scoreCandidateBatch(candidateData, seedAgg, weights);

  if (params.portfolioBoost?.enabled) {
    const detailMap = new Map(candidateData.map(c => [c.patentId, c.detail]));
    scores = applyPortfolioBoost(scores, params.portfolioBoost.sectorStrengths, params.portfolioBoost.boostWeight, detailMap);
    scores.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  const pruned = Math.max(0, scores.length - maxCandidates);
  if (pruned > 0) {
    scores = scores.slice(0, maxCandidates);
  }

  const zones = applyThresholds(scores, membershipThreshold, expansionThreshold);
  const portfolioMap = loadPortfolioMap();
  const competitorMatcher = getCompetitorMatcher();

  const scoredCandidates = scores.map(score => {
    const cData = candidateData.find(c => c.patentId === score.patentId);
    const detail = cData?.detail;
    const compMatch = detail?.assignee ? competitorMatcher.matchCompetitor(detail.assignee) : null;

    let sector = detail?.primary_sector;
    let superSector = detail?.super_sector;
    if (!sector && detail?.cpc_codes && detail.cpc_codes.length > 0) {
      const inferred = getPrimarySector(detail.cpc_codes);
      if (inferred && inferred !== 'general') {
        sector = inferred;
        superSector = getSuperSector(inferred);
      }
    }

    let zone: 'member' | 'expansion' | 'rejected';
    if (score.compositeScore >= membershipThreshold) zone = 'member';
    else if (score.compositeScore >= expansionThreshold) zone = 'expansion';
    else zone = 'rejected';

    return {
      patentId: score.patentId,
      title: detail?.patent_title,
      assignee: detail?.assignee,
      score,
      generation: 0,
      relation: 'sibling',
      inPortfolio: portfolioMap.has(score.patentId),
      isCompetitor: !!compMatch,
      competitorName: compMatch?.company,
      isAffiliate: !portfolioMap.has(score.patentId) && !!(detail?.assignee && isAffiliate(detail.assignee)),
      sector,
      superSector,
      filingDate: detail?.patent_date,
      remainingYears: computeRemainingYears(detail?.patent_date),
      forwardCitationCount: detail?.forward_citations,
      discoveredVia: discoveredViaMap.get(score.patentId) || [],
      dataStatus: portfolioMap.has(score.patentId) ? 'portfolio' : (detail?.patent_title ? 'cached' : 'not_attempted'),
      zone,
    } as ScoredCandidate;
  });

  // Persist
  const stepNumber = await getNextStepNumber(explorationId);
  const siblingDirection = `siblings_${params.direction}`;

  if (scoredCandidates.length > 0) {
    await prisma.patentFamilyMember.createMany({
      data: scoredCandidates.map(c => ({
        explorationId,
        patentId: c.patentId,
        status: c.zone === 'rejected' ? 'excluded' : 'candidate',
        relationToSeed: 'sibling',
        generationDepth: 0,
        discoveredVia: c.discoveredVia,
        discoveredAtStep: stepNumber,
        dimensionScores: c.score.dimensions as any,
        compositeScore: c.score.compositeScore,
        dataCompleteness: c.score.dataCompleteness,
        inPortfolio: c.inPortfolio,
        title: c.title,
        assignee: c.assignee,
        sector: c.sector,
        superSector: c.superSector,
        filingDate: c.filingDate,
        remainingYears: c.remainingYears,
        isCompetitor: c.isCompetitor,
        competitorName: c.competitorName,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.patentFamilyExpansionStep.create({
    data: {
      explorationId,
      stepNumber,
      direction: siblingDirection,
      generationDepth: 0,
      candidatesEvaluated: totalDiscovered,
      autoIncluded: zones.aboveMembership.length,
      expansionZone: zones.expansionZone.length,
      autoRejected: zones.belowExpansion.length,
      weightsUsed: weights as any,
      thresholdsUsed: { membership: membershipThreshold, expansion: expansionThreshold },
    },
  });

  // Update exploration counts
  const allMembers = await prisma.patentFamilyMember.findMany({
    where: { explorationId },
  });
  await prisma.patentFamilyExploration.update({
    where: { id: explorationId },
    data: {
      memberCount: allMembers.filter(m => m.status === 'member').length,
      candidateCount: allMembers.filter(m => m.status === 'candidate').length,
    },
  });

  return {
    candidates: scoredCandidates,
    stats: {
      totalDiscovered,
      aboveMembership: zones.aboveMembership.length,
      inExpansionZone: zones.expansionZone.length,
      belowExpansion: zones.belowExpansion.length,
      pruned,
      direction: siblingDirection,
      generationDepth: 0,
    },
    scoreDistribution: computeScoreHistogram(scores),
    warnings,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rescore Exploration
// ─────────────────────────────────────────────────────────────────────────────

export async function rescoreExploration(
  explorationId: string,
  params: {
    weights: ScoringWeights;
    membershipThreshold: number;
    expansionThreshold: number;
    portfolioBoost?: { enabled: boolean; boostWeight: number; sectorStrengths: Record<string, number> };
  },
): Promise<ExpansionResult> {
  const members = await prisma.patentFamilyMember.findMany({
    where: {
      explorationId,
      relationToSeed: { not: 'seed' },
    },
  });

  // Reconstruct CandidateScore objects from cached dimension scores
  const cachedScores: CandidateScore[] = members
    .filter(m => m.dimensionScores)
    .map(m => ({
      patentId: m.patentId,
      dimensions: m.dimensionScores as unknown as DimensionScores,
      compositeScore: m.compositeScore ?? 0,
      rawWeightedScore: 0, // Will be recomputed
      generationDistance: m.generationDepth,
      depthMultiplier: 1,  // Will be recomputed
      dataCompleteness: m.dataCompleteness ?? 0,
    }));

  // Rescore with new weights
  let rescored = rescoreFromCache(cachedScores, params.weights);

  // Apply portfolio boost
  if (params.portfolioBoost?.enabled) {
    const portfolioMap = loadPortfolioMap();
    const detailMap = new Map<string, any>();
    for (const m of members) {
      detailMap.set(m.patentId, loadPatentDetail(m.patentId, portfolioMap));
    }
    rescored = applyPortfolioBoost(rescored, params.portfolioBoost.sectorStrengths, params.portfolioBoost.boostWeight, detailMap);
    rescored.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  const zones = applyThresholds(rescored, params.membershipThreshold, params.expansionThreshold);

  // Update scores in database
  for (const score of rescored) {
    const member = members.find(m => m.patentId === score.patentId);
    if (!member) continue;

    let newStatus = member.status;
    // Only auto-update status for candidates (not manually set members/excluded)
    if (member.status === 'candidate') {
      if (score.compositeScore < params.expansionThreshold) {
        newStatus = 'excluded';
      }
    }

    await prisma.patentFamilyMember.update({
      where: { id: member.id },
      data: {
        compositeScore: score.compositeScore,
        ...(newStatus !== member.status ? { status: newStatus } : {}),
      },
    });
  }

  // Update exploration weights
  await prisma.patentFamilyExploration.update({
    where: { id: explorationId },
    data: {
      weights: params.weights as any,
      membershipThreshold: params.membershipThreshold,
      expansionThreshold: params.expansionThreshold,
    },
  });

  // Build response candidates
  const scoredCandidates = buildScoredCandidatesFromDb(members, rescored, params.membershipThreshold, params.expansionThreshold);

  return {
    candidates: scoredCandidates,
    stats: {
      totalDiscovered: rescored.length,
      aboveMembership: zones.aboveMembership.length,
      inExpansionZone: zones.expansionZone.length,
      belowExpansion: zones.belowExpansion.length,
      pruned: 0,
      direction: 'rescore',
      generationDepth: 0,
    },
    scoreDistribution: computeScoreHistogram(rescored),
    warnings: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Candidate Statuses
// ─────────────────────────────────────────────────────────────────────────────

export async function updateCandidateStatuses(
  explorationId: string,
  updates: Array<{ patentId: string; status: 'member' | 'candidate' | 'excluded' }>,
): Promise<{ updated: number; memberCount: number; candidateCount: number }> {
  let updated = 0;

  for (const update of updates) {
    const result = await prisma.patentFamilyMember.updateMany({
      where: {
        explorationId,
        patentId: update.patentId,
      },
      data: {
        status: update.status,
      },
    });
    updated += result.count;
  }

  // Recount
  const allMembers = await prisma.patentFamilyMember.findMany({
    where: { explorationId },
    select: { status: true },
  });
  const memberCount = allMembers.filter(m => m.status === 'member').length;
  const candidateCount = allMembers.filter(m => m.status === 'candidate').length;

  await prisma.patentFamilyExploration.update({
    where: { id: explorationId },
    data: { memberCount, candidateCount },
  });

  return { updated, memberCount, candidateCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get Exploration State
// ─────────────────────────────────────────────────────────────────────────────

export async function getExplorationV2(explorationId: string): Promise<ExplorationStateV2> {
  const exploration = await prisma.patentFamilyExploration.findUnique({
    where: { id: explorationId },
    include: {
      members: { orderBy: { compositeScore: { sort: 'desc', nulls: 'last' } } },
      expansionSteps: { orderBy: { stepNumber: 'asc' } },
    },
  });

  if (!exploration) throw new Error(`Exploration ${explorationId} not found`);

  const weights = (exploration.weights as ScoringWeights) || DEFAULT_WEIGHTS;
  const membershipThreshold = exploration.membershipThreshold ?? 60;
  const expansionThreshold = exploration.expansionThreshold ?? 30;

  const toScoredCandidate = (m: typeof exploration.members[0]): ScoredCandidate => {
    const dims = (m.dimensionScores as DimensionScores) || {} as DimensionScores;
    let zone: 'member' | 'expansion' | 'rejected';
    if (m.status === 'member') zone = 'member';
    else if (m.status === 'excluded') zone = 'rejected';
    else if ((m.compositeScore ?? 0) >= membershipThreshold) zone = 'member';
    else if ((m.compositeScore ?? 0) >= expansionThreshold) zone = 'expansion';
    else zone = 'rejected';

    return {
      patentId: m.patentId,
      title: m.title ?? undefined,
      assignee: m.assignee ?? undefined,
      score: {
        patentId: m.patentId,
        dimensions: dims,
        compositeScore: m.compositeScore ?? 0,
        rawWeightedScore: 0,
        generationDistance: m.generationDepth,
        depthMultiplier: 1,
        dataCompleteness: m.dataCompleteness ?? 0,
      },
      generation: m.generationDepth,
      relation: m.relationToSeed,
      inPortfolio: m.inPortfolio,
      isCompetitor: m.isCompetitor,
      competitorName: m.competitorName ?? undefined,
      isAffiliate: false,
      sector: m.sector ?? undefined,
      superSector: m.superSector ?? undefined,
      filingDate: m.filingDate ?? undefined,
      remainingYears: m.remainingYears ?? undefined,
      forwardCitationCount: undefined,
      discoveredVia: m.discoveredVia,
      dataStatus: m.inPortfolio ? 'portfolio' : (m.title ? 'cached' : 'not_attempted'),
      zone,
    };
  };

  const allCandidates = exploration.members.map(toScoredCandidate);

  return {
    id: exploration.id,
    name: exploration.name ?? undefined,
    seedPatentIds: exploration.seedPatentIds.length > 0
      ? exploration.seedPatentIds
      : [exploration.seedPatentId],
    weights,
    membershipThreshold,
    expansionThreshold,
    currentGeneration: exploration.currentGeneration,
    members: allCandidates.filter(c => c.zone === 'member'),
    candidates: allCandidates.filter(c => c.zone === 'expansion'),
    excluded: allCandidates.filter(c => c.zone === 'rejected'),
    expansionHistory: exploration.expansionSteps.map(s => ({
      stepNumber: s.stepNumber,
      direction: s.direction,
      generationDepth: s.generationDepth,
      candidatesEvaluated: s.candidatesEvaluated,
      autoIncluded: s.autoIncluded,
      expansionZone: s.expansionZone,
      autoRejected: s.autoRejected,
      createdAt: s.createdAt.toISOString(),
    })),
    status: exploration.status,
    memberCount: exploration.memberCount,
    candidateCount: exploration.candidateCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Save / Name Exploration
// ─────────────────────────────────────────────────────────────────────────────

export async function saveExploration(
  explorationId: string,
  params: { name: string; description?: string },
): Promise<void> {
  await prisma.patentFamilyExploration.update({
    where: { id: explorationId },
    data: {
      name: params.name,
      description: params.description,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Focus Area from V2 Exploration
// ─────────────────────────────────────────────────────────────────────────────

export async function createFocusAreaFromV2(
  explorationId: string,
  params: { name: string; description?: string; includeExternalPatents?: boolean },
): Promise<{ focusArea: { id: string; name: string; patentCount: number }; added: number }> {
  // Get all members with status = 'member'
  const members = await prisma.patentFamilyMember.findMany({
    where: { explorationId, status: 'member' },
    select: { patentId: true },
  });

  const patentIds = members.map(m => m.patentId);

  return createFocusAreaFromExploration({
    explorationId,
    name: params.name,
    description: params.description,
    patentIds,
    includeExternalPatents: params.includeExternalPatents ?? true,
    ownerId: 'default-user',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Presets endpoint
// ─────────────────────────────────────────────────────────────────────────────

export function getScoringPresets() {
  return SCORING_PRESETS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function computeRemainingYears(patentDate?: string): number | undefined {
  if (!patentDate) return undefined;
  const grantDate = new Date(patentDate);
  if (isNaN(grantDate.getTime())) return undefined;
  const expiryDate = new Date(grantDate);
  expiryDate.setFullYear(expiryDate.getFullYear() + 20);
  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();
  return Math.round((diffMs / (365.25 * 24 * 60 * 60 * 1000)) * 10) / 10;
}

function getRelationLabel(depth: number): string {
  const labels: Record<number, string> = {
    0: 'seed',
    '-1': 'parent',
    '-2': 'grandparent',
    1: 'child',
    2: 'grandchild',
  };
  const key = String(depth);
  if (key in labels) return labels[key as any];
  if (depth < -2) return `ancestor-${Math.abs(depth)}`;
  if (depth > 2) return `descendant-${depth}`;
  return 'unknown';
}

function isAffiliate(assignee: string): boolean {
  try {
    const { getAffiliateKey } = require('../utils/affiliate-normalizer.js');
    return !!getAffiliateKey(assignee);
  } catch {
    return false;
  }
}

async function getNextStepNumber(explorationId: string): Promise<number> {
  const lastStep = await prisma.patentFamilyExpansionStep.findFirst({
    where: { explorationId },
    orderBy: { stepNumber: 'desc' },
    select: { stepNumber: true },
  });
  return (lastStep?.stepNumber ?? 0) + 1;
}

/** Serialize SeedAggregate for JSON storage (Sets → arrays) */
function serializeSeedAggregate(agg: SeedAggregate): any {
  return {
    patentIds: Array.from(agg.patentIds),
    backwardCitations: Array.from(agg.backwardCitations),
    forwardCitations: Array.from(agg.forwardCitations),
    subSectors: Array.from(agg.subSectors),
    sectors: Array.from(agg.sectors),
    superSectors: Array.from(agg.superSectors),
    competitors: Array.from(agg.competitors),
    assignees: Array.from(agg.assignees),
    affiliateKeys: Array.from(agg.affiliateKeys),
    filingDates: agg.filingDates.map(d => d.toISOString()),
    portfolioPatentIds: Array.from(agg.portfolioPatentIds),
    citationSectors: Object.fromEntries(agg.citationSectors),
  };
}

/** Deserialize SeedAggregate from JSON storage */
function deserializeSeedAggregate(data: any): SeedAggregate {
  return {
    patentIds: new Set(data.patentIds || []),
    backwardCitations: new Set(data.backwardCitations || []),
    forwardCitations: new Set(data.forwardCitations || []),
    subSectors: new Set(data.subSectors || []),
    sectors: new Set(data.sectors || []),
    superSectors: new Set(data.superSectors || []),
    competitors: new Set(data.competitors || []),
    assignees: new Set(data.assignees || []),
    affiliateKeys: new Set(data.affiliateKeys || []),
    filingDates: (data.filingDates || []).map((d: string) => new Date(d)),
    portfolioPatentIds: new Set(data.portfolioPatentIds || []),
    citationSectors: new Map(Object.entries(data.citationSectors || {})),
  };
}

/** Build ScoredCandidate objects from DB members and rescored data */
function buildScoredCandidatesFromDb(
  members: Array<{ patentId: string; status: string; relationToSeed: string; generationDepth: number; inPortfolio: boolean; title: string | null; assignee: string | null; sector: string | null; superSector: string | null; filingDate: string | null; remainingYears: number | null; isCompetitor: boolean; competitorName: string | null; discoveredVia: string[]; dimensionScores: any; dataCompleteness: number | null }>,
  rescored: CandidateScore[],
  membershipThreshold: number,
  expansionThreshold: number,
): ScoredCandidate[] {
  const scoreMap = new Map(rescored.map(s => [s.patentId, s]));

  return members.map(m => {
    const score = scoreMap.get(m.patentId);
    const compositeScore = score?.compositeScore ?? 0;

    let zone: 'member' | 'expansion' | 'rejected';
    if (m.status === 'member') zone = 'member';
    else if (m.status === 'excluded') zone = 'rejected';
    else if (compositeScore >= membershipThreshold) zone = 'member';
    else if (compositeScore >= expansionThreshold) zone = 'expansion';
    else zone = 'rejected';

    return {
      patentId: m.patentId,
      title: m.title ?? undefined,
      assignee: m.assignee ?? undefined,
      score: score || {
        patentId: m.patentId,
        dimensions: (m.dimensionScores || {}) as DimensionScores,
        compositeScore,
        rawWeightedScore: 0,
        generationDistance: m.generationDepth,
        depthMultiplier: 1,
        dataCompleteness: m.dataCompleteness ?? 0,
      },
      generation: m.generationDepth,
      relation: m.relationToSeed,
      inPortfolio: m.inPortfolio,
      isCompetitor: m.isCompetitor,
      competitorName: m.competitorName ?? undefined,
      isAffiliate: false,
      sector: m.sector ?? undefined,
      superSector: m.superSector ?? undefined,
      filingDate: m.filingDate ?? undefined,
      remainingYears: m.remainingYears ?? undefined,
      forwardCitationCount: undefined,
      discoveredVia: m.discoveredVia,
      dataStatus: m.inPortfolio ? 'portfolio' : (m.title ? 'cached' : 'not_attempted'),
      zone,
    } as ScoredCandidate;
  });
}
