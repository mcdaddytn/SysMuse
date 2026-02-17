/**
 * Family Expansion Scorer
 *
 * Computes relevance scores for candidate patents against a seed set
 * across multiple dimensions. Used by the v2 iterative family expansion.
 */

import {
  loadPortfolioMap,
  loadCachedForwardCitations,
  loadCachedBackwardCitations,
  loadPatentDetail,
  type PortfolioPatent,
  type PatentDetail,
} from './patent-family-service.js';
import { normalizeAffiliate, getAffiliateKey } from '../utils/affiliate-normalizer.js';
import { getCompetitorMatcher, type CompetitorMatch } from '../../../services/competitor-config.js';
import { getPrimarySector, getSuperSector } from '../utils/sector-mapper.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  taxonomicOverlap: number;
  commonPriorArt: number;
  commonForwardCites: number;
  competitorOverlap: number;
  portfolioAffiliate: number;
  citationSectorAlignment: number;
  multiPathConnectivity: number;
  assigneeRelationship: number;
  temporalProximity: number;
  depthDecayRate: number;           // Multiplier decay rate (not a weighted dimension)
}

export interface DimensionScores {
  taxonomicOverlap: number;         // 0-1: sub-sector=1.0, sector=0.5, super-sector=0.2
  commonPriorArt: number;           // 0-1: Jaccard of backward citations
  commonForwardCites: number;       // 0-1: Jaccard of forward citations
  competitorOverlap: number;        // 0-1: shared competitor entities
  portfolioAffiliate: number;       // 0-1: in portfolio=1.0, affiliate=0.7
  citationSectorAlignment: number;  // 0-1: fraction of connecting citations in-sector
  multiPathConnectivity: number;    // 0-1: capped at 3+ paths
  assigneeRelationship: number;     // 0-1: same assignee=1.0, same parent company=0.5
  temporalProximity: number;        // 0-1: linear decay over 15 years
}

export interface CandidateScore {
  patentId: string;
  dimensions: DimensionScores;
  compositeScore: number;           // 0-100 weighted + depth multiplier
  rawWeightedScore: number;         // 0-100 before depth multiplier
  generationDistance: number;
  depthMultiplier: number;
  dataCompleteness: number;         // 0-1: fraction of dimensions with data
}

export interface SeedAggregate {
  patentIds: Set<string>;
  backwardCitations: Set<string>;
  forwardCitations: Set<string>;
  subSectors: Set<string>;
  sectors: Set<string>;
  superSectors: Set<string>;
  competitors: Set<string>;         // Competitor company names in seeds' citation networks
  assignees: Set<string>;           // Normalized assignee names of seed patents
  affiliateKeys: Set<string>;       // Affiliate keys of seed patents
  filingDates: Date[];
  portfolioPatentIds: Set<string>;
  // Per-citation sector lookup (for citation sector alignment)
  citationSectors: Map<string, string>;   // patentId -> sector (for backward+forward citations)
}

/** Enriched candidate data needed for scoring */
export interface CandidateData {
  patentId: string;
  detail: PatentDetail | null;
  backwardCitations: string[] | null;
  forwardCitations: string[] | null;
  generationDistance: number;
  relation: string;
  discoveredVia: string[];          // Which frontier patents led here
  inPortfolio: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Weights and Presets
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: ScoringWeights = {
  taxonomicOverlap: 0.20,
  commonPriorArt: 0.20,
  commonForwardCites: 0.20,
  competitorOverlap: 0.08,
  portfolioAffiliate: 0.10,
  citationSectorAlignment: 0.07,
  multiPathConnectivity: 0.05,
  assigneeRelationship: 0.05,
  temporalProximity: 0.05,
  depthDecayRate: 0.20,
};

export const SCORING_PRESETS: Record<string, { label: string; description: string; weights: ScoringWeights }> = {
  balanced: {
    label: 'Balanced',
    description: 'Default weights for general exploration',
    weights: { ...DEFAULT_WEIGHTS },
  },
  citationHeavy: {
    label: 'Citation-Heavy',
    description: 'Emphasizes shared prior art and forward citations',
    weights: {
      ...DEFAULT_WEIGHTS,
      commonPriorArt: 0.30,
      commonForwardCites: 0.30,
      taxonomicOverlap: 0.10,
      portfolioAffiliate: 0.05,
      competitorOverlap: 0.05,
    },
  },
  portfolioFocused: {
    label: 'Portfolio-Focused',
    description: 'Favors portfolio membership and taxonomic match',
    weights: {
      ...DEFAULT_WEIGHTS,
      portfolioAffiliate: 0.25,
      taxonomicOverlap: 0.25,
      commonPriorArt: 0.15,
      commonForwardCites: 0.15,
      competitorOverlap: 0.05,
      citationSectorAlignment: 0.05,
      multiPathConnectivity: 0.03,
      assigneeRelationship: 0.04,
      temporalProximity: 0.03,
    },
  },
  competitiveAnalysis: {
    label: 'Competitive Analysis',
    description: 'Emphasizes competitor overlap and sector alignment',
    weights: {
      ...DEFAULT_WEIGHTS,
      competitorOverlap: 0.20,
      citationSectorAlignment: 0.15,
      commonPriorArt: 0.15,
      commonForwardCites: 0.15,
      taxonomicOverlap: 0.15,
      portfolioAffiliate: 0.05,
      multiPathConnectivity: 0.05,
      assigneeRelationship: 0.05,
      temporalProximity: 0.05,
    },
  },
  broadDiscovery: {
    label: 'Broad Discovery',
    description: 'Wide net with low depth penalty and no temporal filtering',
    weights: {
      ...DEFAULT_WEIGHTS,
      temporalProximity: 0.0,
      depthDecayRate: 0.05,
    },
  },
  tightTechnology: {
    label: 'Tight Technology',
    description: 'Strict taxonomic and temporal focus',
    weights: {
      ...DEFAULT_WEIGHTS,
      taxonomicOverlap: 0.35,
      temporalProximity: 0.10,
      commonPriorArt: 0.15,
      commonForwardCites: 0.15,
      competitorOverlap: 0.05,
      portfolioAffiliate: 0.05,
      citationSectorAlignment: 0.05,
      multiPathConnectivity: 0.05,
      assigneeRelationship: 0.05,
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Seed Aggregate Computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build aggregate data from seed patents for efficient scoring.
 * This pre-computes union sets so scoring is O(candidates) not O(candidates × seeds).
 */
export function computeSeedAggregate(seedPatentIds: string[]): SeedAggregate {
  const portfolioMap = loadPortfolioMap();
  const competitorMatcher = getCompetitorMatcher();

  const aggregate: SeedAggregate = {
    patentIds: new Set(seedPatentIds),
    backwardCitations: new Set(),
    forwardCitations: new Set(),
    subSectors: new Set(),
    sectors: new Set(),
    superSectors: new Set(),
    competitors: new Set(),
    assignees: new Set(),
    affiliateKeys: new Set(),
    filingDates: [],
    portfolioPatentIds: new Set(),
    citationSectors: new Map(),
  };

  for (const seedId of seedPatentIds) {
    // Load patent detail
    const detail = loadPatentDetail(seedId, portfolioMap);
    const portfolioPatent = portfolioMap.get(seedId);

    // Portfolio status
    if (portfolioPatent) {
      aggregate.portfolioPatentIds.add(seedId);
    }

    // Taxonomy
    if (detail?.primary_sector) {
      aggregate.sectors.add(detail.primary_sector);
    }
    if (detail?.super_sector) {
      aggregate.superSectors.add(detail.super_sector);
    }
    // Sub-sector from portfolio data (may have primary_sub_sector_name)
    const rawPortfolio = portfolioPatent as any;
    if (rawPortfolio?.primary_sub_sector_name) {
      aggregate.subSectors.add(rawPortfolio.primary_sub_sector_name);
    }

    // Assignee
    if (detail?.assignee) {
      aggregate.assignees.add(detail.assignee.toLowerCase());
      const affiliateKey = getAffiliateKey(detail.assignee);
      if (affiliateKey) {
        aggregate.affiliateKeys.add(affiliateKey);
      }
    }

    // Filing date
    if (detail?.patent_date) {
      const d = new Date(detail.patent_date);
      if (!isNaN(d.getTime())) {
        aggregate.filingDates.push(d);
      }
    }

    // Backward citations
    const backward = loadCachedBackwardCitations(seedId);
    if (backward) {
      for (const cited of backward) {
        aggregate.backwardCitations.add(cited);
        // Track sector of cited patent for citation sector alignment
        const citedDetail = loadPatentDetail(cited, portfolioMap);
        if (citedDetail?.primary_sector) {
          aggregate.citationSectors.set(cited, citedDetail.primary_sector);
        }
      }
    }

    // Forward citations
    const forward = loadCachedForwardCitations(seedId);
    if (forward) {
      for (const citing of forward) {
        aggregate.forwardCitations.add(citing);
        const citingDetail = loadPatentDetail(citing, portfolioMap);
        if (citingDetail?.primary_sector) {
          aggregate.citationSectors.set(citing, citingDetail.primary_sector);
        }
      }
    }

    // Competitors from seed citation networks
    const allCitations = [
      ...(backward || []),
      ...(forward || []),
    ];
    for (const citId of allCitations) {
      const citDetail = loadPatentDetail(citId, portfolioMap);
      if (citDetail?.assignee) {
        const match = competitorMatcher.matchCompetitor(citDetail.assignee);
        if (match) {
          aggregate.competitors.add(match.company);
        }
      }
    }
  }

  return aggregate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual Dimension Scorers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Taxonomic Overlap: sub-sector=1.0, sector=0.5, super-sector=0.2
 * For external patents, infer sector from CPC codes.
 */
export function computeTaxonomicOverlap(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number | null {
  const portfolioMap = loadPortfolioMap();
  const detail = candidate.detail;

  // Get candidate's taxonomy
  let candidateSector = detail?.primary_sector;
  let candidateSuperSector = detail?.super_sector;
  let candidateSubSector: string | undefined;

  // Sub-sector from portfolio data
  if (candidate.inPortfolio) {
    const raw = portfolioMap.get(candidate.patentId) as any;
    candidateSubSector = raw?.primary_sub_sector_name;
  }

  // If no sector, try to infer from CPC codes
  if (!candidateSector && detail?.cpc_codes && detail.cpc_codes.length > 0) {
    candidateSector = getPrimarySector(detail.cpc_codes);
    if (candidateSector && candidateSector !== 'general') {
      candidateSuperSector = getSuperSector(candidateSector);
    } else {
      candidateSector = undefined;
    }
  }

  // No taxonomy data at all
  if (!candidateSector && !candidateSuperSector && !candidateSubSector) {
    return null; // Exclude from scoring
  }

  // Check at each level (most specific first)
  if (candidateSubSector && seedAgg.subSectors.has(candidateSubSector)) {
    return 1.0;
  }
  if (candidateSector && seedAgg.sectors.has(candidateSector)) {
    return 0.5;
  }
  if (candidateSuperSector && seedAgg.superSectors.has(candidateSuperSector)) {
    return 0.2;
  }

  return 0.0;
}

/**
 * Common Prior Art: Jaccard similarity of backward citations.
 */
export function computeCommonPriorArt(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number | null {
  const candidateBackward = candidate.backwardCitations;
  if (!candidateBackward || candidateBackward.length === 0) {
    // No backward citation data — if seed aggregate also has none, skip
    if (seedAgg.backwardCitations.size === 0) return null;
    return 0.0;
  }
  if (seedAgg.backwardCitations.size === 0) return null;

  const candidateSet = new Set(candidateBackward);
  let intersection = 0;
  for (const cited of candidateSet) {
    if (seedAgg.backwardCitations.has(cited)) {
      intersection++;
    }
  }

  // Jaccard: |A ∩ B| / |A ∪ B|
  const unionSize = candidateSet.size + seedAgg.backwardCitations.size - intersection;
  if (unionSize === 0) return null;

  return intersection / unionSize;
}

/**
 * Common Forward Citations: Jaccard similarity of forward citations.
 */
export function computeCommonForwardCites(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number | null {
  const candidateForward = candidate.forwardCitations;
  if (!candidateForward || candidateForward.length === 0) {
    if (seedAgg.forwardCitations.size === 0) return null;
    return 0.0;
  }
  if (seedAgg.forwardCitations.size === 0) return null;

  const candidateSet = new Set(candidateForward);
  let intersection = 0;
  for (const citing of candidateSet) {
    if (seedAgg.forwardCitations.has(citing)) {
      intersection++;
    }
  }

  const unionSize = candidateSet.size + seedAgg.forwardCitations.size - intersection;
  if (unionSize === 0) return null;

  return intersection / unionSize;
}

/**
 * Competitor Overlap: shared competitor entities between candidate's
 * citation network and seed's citation network.
 */
export function computeCompetitorOverlap(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number | null {
  if (seedAgg.competitors.size === 0) return null;

  const competitorMatcher = getCompetitorMatcher();
  const portfolioMap = loadPortfolioMap();
  const candidateCompetitors = new Set<string>();

  // Check candidate's citations for competitors
  const allCitations = [
    ...(candidate.backwardCitations || []),
    ...(candidate.forwardCitations || []),
  ];

  for (const citId of allCitations) {
    const citDetail = loadPatentDetail(citId, portfolioMap);
    if (citDetail?.assignee) {
      const match = competitorMatcher.matchCompetitor(citDetail.assignee);
      if (match) {
        candidateCompetitors.add(match.company);
      }
    }
  }

  if (candidateCompetitors.size === 0) return 0.0;

  let intersection = 0;
  for (const comp of candidateCompetitors) {
    if (seedAgg.competitors.has(comp)) {
      intersection++;
    }
  }

  return intersection / seedAgg.competitors.size;
}

/**
 * Portfolio/Affiliate: in portfolio=1.0, affiliate=0.7, neither=0.0
 */
export function computePortfolioAffiliate(
  candidate: CandidateData,
): number {
  if (candidate.inPortfolio) return 1.0;

  // Check if candidate's assignee is an affiliate
  if (candidate.detail?.assignee) {
    const affiliateKey = getAffiliateKey(candidate.detail.assignee);
    if (affiliateKey) return 0.7;
  }

  return 0.0;
}

/**
 * Citation Sector Alignment: what fraction of the citation connections
 * between candidate and seeds involve patents in matching sectors?
 */
export function computeCitationSectorAlignment(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number | null {
  // Find all citation links between candidate and seed aggregate
  const links: string[] = [];
  const alignedLinks: string[] = [];

  // Backward: candidate's backward citations that are in seed's forward or backward sets
  if (candidate.backwardCitations) {
    for (const cited of candidate.backwardCitations) {
      if (seedAgg.forwardCitations.has(cited) || seedAgg.backwardCitations.has(cited) || seedAgg.patentIds.has(cited)) {
        links.push(cited);
        const citedSector = seedAgg.citationSectors.get(cited);
        if (citedSector && seedAgg.sectors.has(citedSector)) {
          alignedLinks.push(cited);
        }
      }
    }
  }

  // Forward: candidate's forward citations that are in seed's citation networks
  if (candidate.forwardCitations) {
    for (const citing of candidate.forwardCitations) {
      if (seedAgg.forwardCitations.has(citing) || seedAgg.backwardCitations.has(citing) || seedAgg.patentIds.has(citing)) {
        links.push(citing);
        const citingSector = seedAgg.citationSectors.get(citing);
        if (citingSector && seedAgg.sectors.has(citingSector)) {
          alignedLinks.push(citing);
        }
      }
    }
  }

  if (links.length === 0) return null;

  return alignedLinks.length / links.length;
}

/**
 * Multi-Path Connectivity: how many independent citation paths
 * connect the candidate to the seed set. Capped at 3+ = 1.0.
 */
export function computeMultiPathConnectivity(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number {
  let pathCount = 0;

  // Direct paths: candidate directly cites or is cited by seed patents
  if (candidate.backwardCitations) {
    for (const cited of candidate.backwardCitations) {
      if (seedAgg.patentIds.has(cited)) pathCount++;
    }
  }
  if (candidate.forwardCitations) {
    for (const citing of candidate.forwardCitations) {
      if (seedAgg.patentIds.has(citing)) pathCount++;
    }
  }

  // Indirect paths: shared citations (candidate and seeds cite the same patent,
  // or both are cited by the same patent)
  if (candidate.backwardCitations) {
    for (const cited of candidate.backwardCitations) {
      if (seedAgg.backwardCitations.has(cited)) pathCount++;
    }
  }
  if (candidate.forwardCitations) {
    for (const citing of candidate.forwardCitations) {
      if (seedAgg.forwardCitations.has(citing)) pathCount++;
    }
  }

  // Also count discoveredVia paths (how many frontier patents led to this candidate)
  pathCount = Math.max(pathCount, candidate.discoveredVia.length);

  return Math.min(pathCount / 3, 1.0);
}

/**
 * Assignee Relationship: same assignee=1.0, same affiliate group=0.5, else 0.0
 */
export function computeAssigneeRelationship(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number | null {
  if (!candidate.detail?.assignee) return null;

  const candidateAssignee = candidate.detail.assignee.toLowerCase();

  // Exact assignee match
  if (seedAgg.assignees.has(candidateAssignee)) return 1.0;

  // Same affiliate group
  const candidateAffiliate = getAffiliateKey(candidate.detail.assignee);
  if (candidateAffiliate && seedAgg.affiliateKeys.has(candidateAffiliate)) return 0.5;

  return 0.0;
}

/**
 * Temporal Proximity: linear decay over 15 years.
 * Score = max(0, 1.0 - years_apart / 15)
 */
export function computeTemporalProximity(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
): number | null {
  if (seedAgg.filingDates.length === 0) return null;
  if (!candidate.detail?.patent_date) return null;

  const candidateDate = new Date(candidate.detail.patent_date);
  if (isNaN(candidateDate.getTime())) return null;

  // Find minimum distance to any seed filing date
  let minYearsApart = Infinity;
  for (const seedDate of seedAgg.filingDates) {
    const diffMs = Math.abs(candidateDate.getTime() - seedDate.getTime());
    const diffYears = diffMs / (365.25 * 24 * 60 * 60 * 1000);
    if (diffYears < minYearsApart) {
      minYearsApart = diffYears;
    }
  }

  return Math.max(0, 1.0 - minYearsApart / 15);
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite Scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a single candidate against the seed aggregate.
 */
export function scoreCandidate(
  candidate: CandidateData,
  seedAgg: SeedAggregate,
  weights: ScoringWeights,
): CandidateScore {
  // Compute each dimension
  const rawDimensions: Record<keyof DimensionScores, number | null> = {
    taxonomicOverlap: computeTaxonomicOverlap(candidate, seedAgg),
    commonPriorArt: computeCommonPriorArt(candidate, seedAgg),
    commonForwardCites: computeCommonForwardCites(candidate, seedAgg),
    competitorOverlap: computeCompetitorOverlap(candidate, seedAgg),
    portfolioAffiliate: computePortfolioAffiliate(candidate),
    citationSectorAlignment: computeCitationSectorAlignment(candidate, seedAgg),
    multiPathConnectivity: computeMultiPathConnectivity(candidate, seedAgg),
    assigneeRelationship: computeAssigneeRelationship(candidate, seedAgg),
    temporalProximity: computeTemporalProximity(candidate, seedAgg),
  };

  // Build final dimension scores (null → excluded from weighting)
  const dimensions: DimensionScores = {
    taxonomicOverlap: rawDimensions.taxonomicOverlap ?? 0,
    commonPriorArt: rawDimensions.commonPriorArt ?? 0,
    commonForwardCites: rawDimensions.commonForwardCites ?? 0,
    competitorOverlap: rawDimensions.competitorOverlap ?? 0,
    portfolioAffiliate: rawDimensions.portfolioAffiliate ?? 0,
    citationSectorAlignment: rawDimensions.citationSectorAlignment ?? 0,
    multiPathConnectivity: rawDimensions.multiPathConnectivity ?? 0,
    assigneeRelationship: rawDimensions.assigneeRelationship ?? 0,
    temporalProximity: rawDimensions.temporalProximity ?? 0,
  };

  // Compute weighted score — exclude dimensions with null data from both
  // numerator and denominator (same pattern as LLM scoring system)
  let weightedSum = 0;
  let weightTotal = 0;
  let dimensionsWithData = 0;
  const totalDimensions = 9;

  const dimensionKeys: (keyof DimensionScores)[] = [
    'taxonomicOverlap', 'commonPriorArt', 'commonForwardCites',
    'competitorOverlap', 'portfolioAffiliate', 'citationSectorAlignment',
    'multiPathConnectivity', 'assigneeRelationship', 'temporalProximity',
  ];

  for (const key of dimensionKeys) {
    const rawValue = rawDimensions[key];
    const weight = weights[key];

    if (rawValue !== null && weight > 0) {
      weightedSum += rawValue * weight;
      weightTotal += weight;
      dimensionsWithData++;
    }
  }

  const rawWeightedScore = weightTotal > 0
    ? (weightedSum / weightTotal) * 100
    : 0;

  // Depth multiplier
  const genDist = Math.abs(candidate.generationDistance);
  const depthMultiplier = weights.depthDecayRate > 0
    ? 1.0 / (1.0 + weights.depthDecayRate * genDist)
    : 1.0;

  const compositeScore = rawWeightedScore * depthMultiplier;

  return {
    patentId: candidate.patentId,
    dimensions,
    compositeScore: Math.round(compositeScore * 100) / 100,
    rawWeightedScore: Math.round(rawWeightedScore * 100) / 100,
    generationDistance: candidate.generationDistance,
    depthMultiplier: Math.round(depthMultiplier * 1000) / 1000,
    dataCompleteness: dimensionsWithData / totalDimensions,
  };
}

/**
 * Score a batch of candidates. Returns sorted by composite score descending.
 */
export function scoreCandidateBatch(
  candidates: CandidateData[],
  seedAgg: SeedAggregate,
  weights: ScoringWeights,
): CandidateScore[] {
  const scores = candidates.map(c => scoreCandidate(c, seedAgg, weights));
  scores.sort((a, b) => b.compositeScore - a.compositeScore);
  return scores;
}

/**
 * Rescore candidates using cached dimension scores and new weights.
 * Much faster than full scoring — no data fetching, pure math.
 */
export function rescoreCandidates(
  cachedScores: CandidateScore[],
  newWeights: ScoringWeights,
): CandidateScore[] {
  const rescored = cachedScores.map(score => {
    const dimensionKeys: (keyof DimensionScores)[] = [
      'taxonomicOverlap', 'commonPriorArt', 'commonForwardCites',
      'competitorOverlap', 'portfolioAffiliate', 'citationSectorAlignment',
      'multiPathConnectivity', 'assigneeRelationship', 'temporalProximity',
    ];

    let weightedSum = 0;
    let weightTotal = 0;

    for (const key of dimensionKeys) {
      const dimValue = score.dimensions[key];
      const weight = newWeights[key];
      if (weight > 0) {
        weightedSum += dimValue * weight;
        weightTotal += weight;
      }
    }

    const rawWeightedScore = weightTotal > 0
      ? (weightedSum / weightTotal) * 100
      : 0;

    const genDist = Math.abs(score.generationDistance);
    const depthMultiplier = newWeights.depthDecayRate > 0
      ? 1.0 / (1.0 + newWeights.depthDecayRate * genDist)
      : 1.0;

    const compositeScore = rawWeightedScore * depthMultiplier;

    return {
      ...score,
      compositeScore: Math.round(compositeScore * 100) / 100,
      rawWeightedScore: Math.round(rawWeightedScore * 100) / 100,
      depthMultiplier: Math.round(depthMultiplier * 1000) / 1000,
    };
  });

  rescored.sort((a, b) => b.compositeScore - a.compositeScore);
  return rescored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Score Distribution Histogram
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a 10-bucket histogram of composite scores (0-10, 10-20, ..., 90-100).
 */
export function computeScoreHistogram(scores: CandidateScore[]): number[] {
  const buckets = new Array(10).fill(0);
  for (const score of scores) {
    const bucket = Math.min(Math.floor(score.compositeScore / 10), 9);
    buckets[bucket]++;
  }
  return buckets;
}

/**
 * Apply thresholds to partition scores into zones.
 */
export function applyThresholds(
  scores: CandidateScore[],
  membershipThreshold: number,
  expansionThreshold: number,
): {
  aboveMembership: CandidateScore[];
  expansionZone: CandidateScore[];
  belowExpansion: CandidateScore[];
} {
  const aboveMembership: CandidateScore[] = [];
  const expansionZone: CandidateScore[] = [];
  const belowExpansion: CandidateScore[] = [];

  for (const score of scores) {
    if (score.compositeScore >= membershipThreshold) {
      aboveMembership.push(score);
    } else if (score.compositeScore >= expansionThreshold) {
      expansionZone.push(score);
    } else {
      belowExpansion.push(score);
    }
  }

  return { aboveMembership, expansionZone, belowExpansion };
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Sector Weighting
// ─────────────────────────────────────────────────────────────────────────────

export interface PortfolioSectorStrength {
  sector: string;
  superSector: string;
  patentCount: number;
  avgScore: number;
  strength: number;       // Normalized 0-1
}

/**
 * Compute sector strengths from the portfolio for portfolio-weighted scoring.
 */
export function computePortfolioSectorStrengths(): PortfolioSectorStrength[] {
  const portfolioMap = loadPortfolioMap();

  // Aggregate by sector
  const sectorStats: Record<string, { count: number; totalScore: number; superSector: string }> = {};

  for (const [, patent] of portfolioMap) {
    const sector = patent.primary_sector;
    if (!sector) continue;

    if (!sectorStats[sector]) {
      sectorStats[sector] = {
        count: 0,
        totalScore: 0,
        superSector: patent.super_sector || '',
      };
    }
    sectorStats[sector].count++;
    sectorStats[sector].totalScore += patent.score || 0;
  }

  // Compute raw strength and find max for normalization
  const entries: PortfolioSectorStrength[] = [];
  let maxRawStrength = 0;

  for (const [sector, stats] of Object.entries(sectorStats)) {
    const avgScore = stats.count > 0 ? stats.totalScore / stats.count : 0;
    const rawStrength = stats.count * avgScore;
    if (rawStrength > maxRawStrength) maxRawStrength = rawStrength;

    entries.push({
      sector,
      superSector: stats.superSector,
      patentCount: stats.count,
      avgScore: Math.round(avgScore * 100) / 100,
      strength: rawStrength, // Will be normalized below
    });
  }

  // Normalize to 0-1
  if (maxRawStrength > 0) {
    for (const entry of entries) {
      entry.strength = Math.round((entry.strength / maxRawStrength) * 1000) / 1000;
    }
  }

  entries.sort((a, b) => b.strength - a.strength);
  return entries;
}

/**
 * Apply portfolio sector boost to candidate scores.
 * Returns new scores (does not mutate input).
 */
export function applyPortfolioBoost(
  scores: CandidateScore[],
  sectorStrengths: Record<string, number>,  // sector -> strength (0-1)
  boostWeight: number,                       // How much to boost (e.g., 0.15 = 15% max boost)
  candidateDetails: Map<string, PatentDetail | null>,
): CandidateScore[] {
  const portfolioMap = loadPortfolioMap();

  return scores.map(score => {
    const detail = candidateDetails.get(score.patentId);
    let sector = detail?.primary_sector;

    // Infer sector from CPC for external patents
    if (!sector && detail?.cpc_codes && detail.cpc_codes.length > 0) {
      const inferred = getPrimarySector(detail.cpc_codes);
      if (inferred && inferred !== 'general') {
        sector = inferred;
      }
    }

    if (!sector || !(sector in sectorStrengths)) return score;

    const sectorStrength = sectorStrengths[sector];
    const boost = 1.0 + sectorStrength * boostWeight;
    const boostedComposite = Math.round(score.compositeScore * boost * 100) / 100;

    return {
      ...score,
      compositeScore: boostedComposite,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidate Data Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enrich a list of patent IDs into CandidateData objects with all the
 * data needed for scoring. Uses cache-first loading.
 */
export function loadCandidateData(
  patentIds: string[],
  generationDistance: number,
  relation: string,
  discoveredViaMap: Map<string, string[]>,
): CandidateData[] {
  const portfolioMap = loadPortfolioMap();

  return patentIds.map(patentId => ({
    patentId,
    detail: loadPatentDetail(patentId, portfolioMap),
    backwardCitations: loadCachedBackwardCitations(patentId),
    forwardCitations: loadCachedForwardCitations(patentId),
    generationDistance,
    relation,
    discoveredVia: discoveredViaMap.get(patentId) || [],
    inPortfolio: portfolioMap.has(patentId),
  }));
}
