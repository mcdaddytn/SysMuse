/**
 * Patent Data Service — Unified Postgres query layer
 *
 * Replaces the JSON+cache loading in patents.routes.ts with Prisma queries.
 * Returns the same Patent DTO shape the frontend expects.
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Matches the frontend Patent interface exactly */
export interface PatentDTO {
  patent_id: string;
  patent_title: string;
  abstract?: string | null;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;

  affiliate: string;
  super_sector: string;
  primary_sector: string;
  cpc_codes: string[];

  primary_sub_sector_id?: string;
  primary_sub_sector_name?: string;
  primary_cpc?: string;

  // Citation data
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
  competitor_count: number;
  competitor_names: string[];
  adjusted_forward_citations: number;
  competitor_density: number;
  has_citation_data: boolean;

  // Scores
  v2_score?: number;
  v3_score?: number;

  // LLM enrichment
  has_llm_data?: boolean;
  llm_summary?: string;
  llm_prior_art_problem?: string;
  llm_technical_solution?: string;
  llm_technology_category?: string;
  llm_implementation_type?: string;
  llm_standards_relevance?: string;
  llm_market_segment?: string;
  llm_detection_method?: string;
  llm_implementation_complexity?: string;
  llm_claim_type_primary?: string;
  llm_geographic_scope?: string;
  llm_lifecycle_stage?: string;
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  claim_clarity_score?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  evidence_accessibility_score?: number;
  market_relevance_score?: number;
  trend_alignment_score?: number;
  investigation_priority_score?: number;
  llm_confidence?: number;
  legal_viability_score?: number;
  enforcement_potential_score?: number;
  market_value_score?: number;

  // Focus area metadata (optional, merged when focusAreaId is provided)
  fa_membership_type?: string | null;
  fa_match_score?: number | null;
}

export interface PatentFilters {
  search?: string;
  affiliates?: string[];
  superSectors?: string[];
  assignees?: string[];
  primarySectors?: string[];
  subSectors?: string[];
  competitorNames?: string[];
  cpcCodes?: string[];
  dateStart?: string;
  dateEnd?: string;
  scoreMin?: number;
  scoreMax?: number;
  scoreField?: string;
  v2ScoreMin?: number;
  v2ScoreMax?: number;
  v3ScoreMin?: number;
  v3ScoreMax?: number;
  yearsMin?: number;
  yearsMax?: number;
  forwardCitesMin?: number;
  forwardCitesMax?: number;
  competitorCitesMin?: number;
  competitorCitesMax?: number;
  affiliateCitesMin?: number;
  affiliateCitesMax?: number;
  neutralCitesMin?: number;
  neutralCitesMax?: number;
  hasLlmData?: string;
  isExpired?: string;
  isQuarantined?: string;
  hasCompetitorCites?: string;
  activeOnly?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy: string;
  descending: boolean;
}

export interface GetPatentsResult {
  data: PatentDTO[];
  total: number;
  page: number;
  rowsPerPage: number;
  totalPages: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Score field mapping — EAV fieldName → PatentDTO property
// ─────────────────────────────────────────────────────────────────────────────

// Maps from PatentScore.fieldName to the DTO key and how to read the value
const SCORE_FIELD_MAP: Record<string, { dtoKey: string; valueType: 'rating' | 'text' | 'reasoning' | 'float' }> = {
  eligibility_score: { dtoKey: 'eligibility_score', valueType: 'rating' },
  validity_score: { dtoKey: 'validity_score', valueType: 'rating' },
  claim_breadth: { dtoKey: 'claim_breadth', valueType: 'rating' },
  claim_clarity_score: { dtoKey: 'claim_clarity_score', valueType: 'rating' },
  enforcement_clarity: { dtoKey: 'enforcement_clarity', valueType: 'rating' },
  design_around_difficulty: { dtoKey: 'design_around_difficulty', valueType: 'rating' },
  evidence_accessibility_score: { dtoKey: 'evidence_accessibility_score', valueType: 'rating' },
  market_relevance_score: { dtoKey: 'market_relevance_score', valueType: 'rating' },
  trend_alignment_score: { dtoKey: 'trend_alignment_score', valueType: 'rating' },
  investigation_priority_score: { dtoKey: 'investigation_priority_score', valueType: 'rating' },
  confidence: { dtoKey: 'llm_confidence', valueType: 'rating' },
  technology_category: { dtoKey: 'llm_technology_category', valueType: 'text' },
  implementation_type: { dtoKey: 'llm_implementation_type', valueType: 'text' },
  standards_relevance: { dtoKey: 'llm_standards_relevance', valueType: 'text' },
  market_segment: { dtoKey: 'llm_market_segment', valueType: 'text' },
  detection_method: { dtoKey: 'llm_detection_method', valueType: 'text' },
  implementation_complexity: { dtoKey: 'llm_implementation_complexity', valueType: 'text' },
  claim_type_primary: { dtoKey: 'llm_claim_type_primary', valueType: 'text' },
  geographic_scope: { dtoKey: 'llm_geographic_scope', valueType: 'text' },
  lifecycle_stage: { dtoKey: 'llm_lifecycle_stage', valueType: 'text' },
  summary: { dtoKey: 'llm_summary', valueType: 'reasoning' },
  prior_art_problem: { dtoKey: 'llm_prior_art_problem', valueType: 'reasoning' },
  technical_solution: { dtoKey: 'llm_technical_solution', valueType: 'reasoning' },
  legal_viability_score: { dtoKey: 'legal_viability_score', valueType: 'float' },
  enforcement_potential_score: { dtoKey: 'enforcement_potential_score', valueType: 'float' },
  market_value_score: { dtoKey: 'market_value_score', valueType: 'float' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Core query methods
// ─────────────────────────────────────────────────────────────────────────────

/** Snapshot score maps for overlaying V2/V3 scores from active snapshots */
export interface SnapshotScoreMaps {
  v2: Map<string, number>;
  v3: Map<string, number>;
}

/** Overlay snapshot scores onto DTOs (replaces compositeScore-based v2/v3) */
function applySnapshotScores(data: PatentDTO[], scores: SnapshotScoreMaps): PatentDTO[] {
  const hasV2 = scores.v2.size > 0;
  const hasV3 = scores.v3.size > 0;
  if (!hasV2 && !hasV3) return data;
  return data.map(d => ({
    ...d,
    v2_score: hasV2 ? (scores.v2.get(d.patent_id) ?? 0) : (d.v2_score ?? 0),
    v3_score: hasV3 ? (scores.v3.get(d.patent_id) ?? 0) : (d.v3_score ?? 0),
  }));
}

/**
 * Get patents with pagination, filtering, and sorting.
 * Optionally scoped to a portfolio.
 */
export async function getPatents(options: {
  portfolioId?: string;
  focusAreaId?: string;
  pagination: PaginationOptions;
  filters?: PatentFilters;
  snapshotScores?: SnapshotScoreMaps;
}): Promise<GetPatentsResult> {
  const { portfolioId, focusAreaId, pagination, filters, snapshotScores } = options;
  const { page, limit, sortBy, descending } = pagination;

  // Build WHERE clause
  const where = buildWhereClause(portfolioId, focusAreaId, filters);

  // Determine if we need to sort by a score/composite field
  const scoreSortField = getScoreSortField(sortBy);

  // Count total (for pagination)
  const total = await prisma.patent.count({ where });

  // Fetch patents with includes
  const orderBy = buildOrderBy(sortBy, descending, scoreSortField);

  const patents = await prisma.patent.findMany({
    where,
    include: {
      cpcCodes: { select: { cpcCode: true, isInventive: true } },
      citations: true,
      scores: true,
      compositeScores: true,
    },
    orderBy,
    skip: (page - 1) * limit,
    take: limit,
  });

  // Map to DTOs
  let data = patents.map(mapPatentToDTO);

  // Overlay active snapshot scores (portfolio-scoped)
  if (snapshotScores) {
    data = applySnapshotScores(data, snapshotScores);
  }

  // If sorted by a score field, we need to do post-sort since the EAV JOIN
  // doesn't map cleanly to Prisma orderBy
  if (scoreSortField) {
    data = sortByScoreField(data, sortBy, descending);
  }

  // If focusAreaId, merge membership metadata
  if (focusAreaId) {
    const patentIds = data.map(d => d.patent_id);
    const faPatents = await prisma.focusAreaPatent.findMany({
      where: { focusAreaId, patentId: { in: patentIds } },
      select: { patentId: true, membershipType: true, matchScore: true },
    });
    const faMap = new Map(faPatents.map(fp => [fp.patentId, fp]));
    data = data.map(d => ({
      ...d,
      fa_membership_type: faMap.get(d.patent_id)?.membershipType ?? null,
      fa_match_score: faMap.get(d.patent_id)?.matchScore ?? null,
    }));
  }

  return {
    data,
    total,
    page,
    rowsPerPage: limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get a single patent with all scores and details
 */
export async function getPatent(patentId: string): Promise<PatentDTO | null> {
  const patent = await prisma.patent.findUnique({
    where: { patentId },
    include: {
      cpcCodes: { select: { cpcCode: true, isInventive: true } },
      citations: true,
      prosecution: true,
      scores: true,
      compositeScores: true,
    },
  });

  if (!patent) return null;
  return mapPatentToDTO(patent);
}

/**
 * Get patent stats (for /api/patents/stats)
 */
export async function getPatentStats(portfolioId?: string) {
  const where = portfolioId
    ? { portfolios: { some: { portfolioId } } }
    : {};

  const patents = await prisma.patent.findMany({
    where,
    select: {
      patentId: true,
      assignee: true,
      affiliate: true,
      superSector: true,
      remainingYears: true,
      grantDate: true,
    },
  });

  const active = patents.filter(p => (p.remainingYears ?? 0) > 0);
  const expired = patents.filter(p => (p.remainingYears ?? 0) <= 0);

  // Group by affiliate
  const affiliateCounts: Record<string, number> = {};
  for (const p of patents) {
    const aff = p.affiliate || p.assignee || 'Unknown';
    affiliateCounts[aff] = (affiliateCounts[aff] || 0) + 1;
  }
  const topAffiliates = Object.entries(affiliateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Group by super-sector
  const superSectorCounts: Record<string, number> = {};
  for (const p of patents) {
    const ss = p.superSector || 'Unknown';
    superSectorCounts[ss] = (superSectorCounts[ss] || 0) + 1;
  }
  const bySuperSector = Object.entries(superSectorCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Group by assignee (legacy compat)
  const assigneeCounts: Record<string, number> = {};
  for (const p of patents) {
    const a = (p.assignee || '').split(',')[0].trim() || 'Unknown';
    assigneeCounts[a] = (assigneeCounts[a] || 0) + 1;
  }
  const topAssignees = Object.entries(assigneeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const dates = patents.map(p => p.grantDate).filter(Boolean).sort();

  return {
    total: patents.length,
    active: active.length,
    expired: expired.length,
    topAffiliates,
    topAssignees,
    bySuperSector,
    dateRange: {
      oldest: dates[0] || null,
      newest: dates[dates.length - 1] || null,
    },
  };
}

/**
 * Get distinct values for filter dropdowns
 */
export async function getFilterOptions(
  field: 'affiliate' | 'superSector' | 'primarySector' | 'assignee',
  portfolioId?: string,
) {
  const where: any = portfolioId
    ? { portfolios: { some: { portfolioId } } }
    : {};

  // Map field names
  const dbField = {
    affiliate: 'affiliate',
    superSector: 'superSector',
    primarySector: 'primarySector',
    assignee: 'assignee',
  }[field];

  const patents = await prisma.patent.findMany({
    where,
    select: { [dbField]: true } as any,
  });

  const counts: Record<string, number> = {};
  for (const p of patents) {
    const val = (p as any)[dbField] || 'Unknown';
    counts[val] = (counts[val] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

/**
 * Get competitor names with counts
 */
export async function getCompetitorNames(portfolioId?: string) {
  const where: Prisma.PatentCitationAnalysisWhereInput = portfolioId
    ? { patent: { portfolios: { some: { portfolioId } } } }
    : {};

  const citations = await prisma.patentCitationAnalysis.findMany({
    where,
    select: { competitorNames: true },
  });

  const counts: Record<string, number> = {};
  for (const c of citations) {
    for (const name of c.competitorNames) {
      counts[name] = (counts[name] || 0) + 1;
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildWhereClause(
  portfolioId?: string,
  focusAreaId?: string,
  filters?: PatentFilters,
): Prisma.PatentWhereInput {
  const conditions: Prisma.PatentWhereInput[] = [];

  // Portfolio scope
  if (portfolioId) {
    conditions.push({ portfolios: { some: { portfolioId } } });
  }

  // Focus area scope
  if (focusAreaId) {
    // Get patent IDs from focus area — handled via subquery
    conditions.push({
      patentId: {
        in: prisma.focusAreaPatent
          .findMany({ where: { focusAreaId }, select: { patentId: true } })
          .then(r => r.map(x => x.patentId)) as any, // Prisma handles this
      },
    });
  }

  if (!filters) {
    return conditions.length === 1 ? conditions[0] : conditions.length > 0 ? { AND: conditions } : {};
  }

  // Text search
  if (filters.search) {
    const s = filters.search;
    conditions.push({
      OR: [
        { patentId: { contains: s, mode: 'insensitive' } },
        { title: { contains: s, mode: 'insensitive' } },
        { assignee: { contains: s, mode: 'insensitive' } },
        { affiliate: { contains: s, mode: 'insensitive' } },
      ],
    });
  }

  // Affiliate filter
  if (filters.affiliates?.length) {
    conditions.push({ affiliate: { in: filters.affiliates, mode: 'insensitive' } });
  }

  // Assignee filter
  if (filters.assignees?.length) {
    conditions.push({
      OR: filters.assignees.map(a => ({
        assignee: { contains: a, mode: 'insensitive' as const },
      })),
    });
  }

  // Super-sector filter
  if (filters.superSectors?.length) {
    conditions.push({ superSector: { in: filters.superSectors, mode: 'insensitive' } });
  }

  // Primary sector filter
  if (filters.primarySectors?.length) {
    conditions.push({ primarySector: { in: filters.primarySectors } });
  }

  // Sub-sector filter
  if (filters.subSectors?.length) {
    conditions.push({ primarySubSectorName: { in: filters.subSectors } });
  }

  // Date range
  if (filters.dateStart) {
    conditions.push({ grantDate: { gte: filters.dateStart } });
  }
  if (filters.dateEnd) {
    conditions.push({ grantDate: { lte: filters.dateEnd } });
  }

  // Base score range
  if (filters.scoreMin != null) {
    conditions.push({ baseScore: { gte: filters.scoreMin } });
  }
  if (filters.scoreMax != null) {
    conditions.push({ baseScore: { lte: filters.scoreMax } });
  }

  // Remaining years
  if (filters.yearsMin != null) {
    conditions.push({ remainingYears: { gte: filters.yearsMin } });
  }
  if (filters.yearsMax != null) {
    conditions.push({ remainingYears: { lte: filters.yearsMax } });
  }

  // Forward citations
  if (filters.forwardCitesMin != null) {
    conditions.push({ forwardCitations: { gte: filters.forwardCitesMin } });
  }
  if (filters.forwardCitesMax != null) {
    conditions.push({ forwardCitations: { lte: filters.forwardCitesMax } });
  }

  // Citation range filters (on related table)
  if (filters.competitorCitesMin != null) {
    conditions.push({ citations: { competitorCitations: { gte: filters.competitorCitesMin } } });
  }
  if (filters.competitorCitesMax != null) {
    conditions.push({ citations: { competitorCitations: { lte: filters.competitorCitesMax } } });
  }
  if (filters.affiliateCitesMin != null) {
    conditions.push({ citations: { affiliateCitations: { gte: filters.affiliateCitesMin } } });
  }
  if (filters.affiliateCitesMax != null) {
    conditions.push({ citations: { affiliateCitations: { lte: filters.affiliateCitesMax } } });
  }
  if (filters.neutralCitesMin != null) {
    conditions.push({ citations: { neutralCitations: { gte: filters.neutralCitesMin } } });
  }
  if (filters.neutralCitesMax != null) {
    conditions.push({ citations: { neutralCitations: { lte: filters.neutralCitesMax } } });
  }

  // V2/V3 score filters (via composite scores)
  if (filters.v2ScoreMin != null) {
    conditions.push({ compositeScores: { some: { scoreName: 'v2_score', value: { gte: filters.v2ScoreMin } } } });
  }
  if (filters.v2ScoreMax != null) {
    conditions.push({ compositeScores: { some: { scoreName: 'v2_score', value: { lte: filters.v2ScoreMax } } } });
  }
  if (filters.v3ScoreMin != null) {
    conditions.push({ compositeScores: { some: { scoreName: 'v3_score', value: { gte: filters.v3ScoreMin } } } });
  }
  if (filters.v3ScoreMax != null) {
    conditions.push({ compositeScores: { some: { scoreName: 'v3_score', value: { lte: filters.v3ScoreMax } } } });
  }

  // Competitor names (has-any match)
  if (filters.competitorNames?.length) {
    conditions.push({
      citations: {
        competitorNames: { hasSome: filters.competitorNames },
      },
    });
  }

  // CPC codes (prefix match)
  if (filters.cpcCodes?.length) {
    conditions.push({
      cpcCodes: {
        some: {
          OR: filters.cpcCodes.map(prefix => ({
            cpcCode: { startsWith: prefix.toUpperCase() },
          })),
        },
      },
    });
  }

  // Has LLM data
  if (filters.hasLlmData === 'true') {
    conditions.push({ hasLlmData: true });
  } else if (filters.hasLlmData === 'false') {
    conditions.push({ hasLlmData: false });
  }

  // Is Expired
  if (filters.isExpired === 'true') {
    conditions.push({ isExpired: true });
  } else if (filters.isExpired === 'false') {
    conditions.push({ isExpired: false });
  }

  // Is Quarantined
  if (filters.isQuarantined === 'true') {
    conditions.push({ isQuarantined: true });
  } else if (filters.isQuarantined === 'false') {
    conditions.push({ isQuarantined: false });
  }

  // Has competitor cites
  if (filters.hasCompetitorCites === 'true') {
    conditions.push({ citations: { competitorCitations: { gt: 0 } } });
  }

  // Active only
  if (filters.activeOnly === 'true') {
    conditions.push({ remainingYears: { gt: 0 } });
  }

  return conditions.length === 1 ? conditions[0] : conditions.length > 0 ? { AND: conditions } : {};
}

/** Check if sortBy refers to a score field that needs post-sort */
function getScoreSortField(sortBy: string): string | null {
  // Direct Patent table fields can be sorted by Prisma
  const directFields = [
    'patent_id', 'patent_title', 'patent_date', 'assignee', 'forward_citations',
    'remaining_years', 'score', 'affiliate', 'super_sector', 'primary_sector',
  ];

  // Map frontend sort keys to Prisma field names
  const fieldMap: Record<string, string> = {
    patent_id: 'patentId',
    patent_title: 'title',
    patent_date: 'grantDate',
    assignee: 'assignee',
    forward_citations: 'forwardCitations',
    remaining_years: 'remainingYears',
    score: 'baseScore',
    affiliate: 'affiliate',
    super_sector: 'superSector',
    primary_sector: 'primarySector',
  };

  if (fieldMap[sortBy]) return null; // Can be handled by Prisma directly
  return sortBy; // Needs post-sort
}

function buildOrderBy(
  sortBy: string,
  descending: boolean,
  scoreSortField: string | null,
): Prisma.PatentOrderByWithRelationInput {
  // If sorting by a score field, use default ordering (by base_score) and post-sort
  if (scoreSortField) {
    return { baseScore: descending ? 'desc' : 'asc' };
  }

  const fieldMap: Record<string, string> = {
    patent_id: 'patentId',
    patent_title: 'title',
    patent_date: 'grantDate',
    assignee: 'assignee',
    forward_citations: 'forwardCitations',
    remaining_years: 'remainingYears',
    score: 'baseScore',
    affiliate: 'affiliate',
    super_sector: 'superSector',
    primary_sector: 'primarySector',
  };

  const field = fieldMap[sortBy] || 'baseScore';
  return { [field]: descending ? 'desc' : 'asc' } as any;
}

/** Post-sort DTOs by a score/composite field */
function sortByScoreField(data: PatentDTO[], sortBy: string, descending: boolean): PatentDTO[] {
  return [...data].sort((a, b) => {
    const aVal = (a as any)[sortBy] ?? 0;
    const bVal = (b as any)[sortBy] ?? 0;
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return descending ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
    }
    return descending ? bVal - aVal : aVal - bVal;
  });
}

/** Map a Prisma Patent (with includes) to the flat PatentDTO */
function mapPatentToDTO(patent: any): PatentDTO {
  const citations = patent.citations;
  const scores: any[] = patent.scores || [];
  const compositeScores: any[] = patent.compositeScores || [];
  const cpcCodes: any[] = patent.cpcCodes || [];

  // Build score map
  const scoreMap: Record<string, any> = {};
  for (const s of scores) {
    scoreMap[s.fieldName] = s;
  }

  // Build composite score map
  const compositeMap: Record<string, number> = {};
  for (const cs of compositeScores) {
    compositeMap[cs.scoreName] = cs.value;
  }

  // Build the DTO
  const dto: PatentDTO = {
    patent_id: patent.patentId,
    patent_title: patent.title || '',
    abstract: patent.abstract || null,
    patent_date: patent.grantDate || '',
    assignee: patent.assignee || '',
    forward_citations: patent.forwardCitations || 0,
    remaining_years: patent.remainingYears ?? 0,
    score: patent.baseScore ?? 0,

    affiliate: patent.affiliate || patent.assignee || 'Unknown',
    super_sector: patent.superSector || 'Unknown',
    primary_sector: patent.primarySector || 'unknown',
    cpc_codes: cpcCodes.map((c: any) => c.cpcCode),

    primary_sub_sector_id: patent.primarySubSectorId || undefined,
    primary_sub_sector_name: patent.primarySubSectorName || undefined,
    primary_cpc: patent.primaryCpc || undefined,

    // Citation data
    competitor_citations: citations?.competitorCitations ?? 0,
    affiliate_citations: citations?.affiliateCitations ?? 0,
    neutral_citations: citations?.neutralCitations ?? 0,
    competitor_count: citations?.competitorNames?.length ?? 0,
    competitor_names: citations?.competitorNames ?? [],
    adjusted_forward_citations: citations?.adjustedForwardCitations ?? 0,
    competitor_density: citations?.competitorDensity ?? 0,
    has_citation_data: patent.hasCitationData || false,

    // Composite scores
    v2_score: compositeMap['v2_score'] ?? 0,
    v3_score: compositeMap['v3_score'] ?? 0,

    // LLM data flag
    has_llm_data: patent.hasLlmData || false,

    // Quarantine
    is_quarantined: patent.isQuarantined || false,
    quarantine: patent.quarantine || null,

    // Numeric patent ID
    patent_id_numeric: patent.patentIdNumeric ?? null,
  };

  // Map EAV scores to flat DTO fields
  for (const [fieldName, mapping] of Object.entries(SCORE_FIELD_MAP)) {
    const scoreRow = scoreMap[fieldName];
    if (!scoreRow) continue;

    let value: any;
    switch (mapping.valueType) {
      case 'rating':
        value = scoreRow.rating;
        break;
      case 'text':
        value = scoreRow.textValue;
        break;
      case 'reasoning':
        value = scoreRow.reasoning;
        break;
      case 'float':
        value = scoreRow.floatValue;
        break;
    }

    if (value != null) {
      (dto as any)[mapping.dtoKey] = value;
    }
  }

  return dto;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk query methods — for export, aggregate, enrichment endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get ALL patents matching filters (no pagination).
 * Used by export, aggregate, enrichment-summary endpoints.
 */
export async function getAllPatents(options: {
  portfolioId?: string;
  filters?: PatentFilters;
  sortBy?: string;
  descending?: boolean;
  snapshotScores?: SnapshotScoreMaps;
}): Promise<PatentDTO[]> {
  const { portfolioId, filters, sortBy = 'score', descending = true, snapshotScores } = options;
  const where = buildWhereClause(portfolioId, undefined, filters);

  const scoreSortField = getScoreSortField(sortBy);
  const orderBy = buildOrderBy(sortBy, descending, scoreSortField);

  const patents = await prisma.patent.findMany({
    where,
    include: {
      cpcCodes: { select: { cpcCode: true, isInventive: true } },
      citations: true,
      scores: true,
      compositeScores: true,
    },
    orderBy,
  });

  let data = patents.map(mapPatentToDTO);

  // Overlay active snapshot scores (portfolio-scoped)
  if (snapshotScores) {
    data = applySnapshotScores(data, snapshotScores);
  }

  if (scoreSortField) {
    data = sortByScoreField(data, sortBy, descending);
  }

  return data;
}

/**
 * Batch lookup patents by IDs. Returns a map of patentId → PatentDTO.
 */
export async function getPatentsByIds(patentIds: string[]): Promise<Map<string, PatentDTO>> {
  if (patentIds.length === 0) return new Map();

  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    include: {
      cpcCodes: { select: { cpcCode: true, isInventive: true } },
      citations: true,
      scores: true,
      compositeScores: true,
    },
  });

  const map = new Map<string, PatentDTO>();
  for (const p of patents) {
    map.set(p.patentId, mapPatentToDTO(p));
  }
  return map;
}

/**
 * Lightweight batch lookup — returns minimal fields for citations/preview.
 */
export async function getPatentsMini(patentIds: string[]): Promise<Map<string, {
  patent_id: string;
  patent_title: string;
  assignee: string;
  patent_date: string;
  affiliate: string;
  in_portfolio: boolean;
}>> {
  if (patentIds.length === 0) return new Map();

  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, title: true, assignee: true, grantDate: true, affiliate: true },
  });

  const map = new Map();
  for (const p of patents) {
    map.set(p.patentId, {
      patent_id: p.patentId,
      patent_title: p.title || '',
      assignee: p.assignee || '',
      patent_date: p.grantDate || '',
      affiliate: p.affiliate || p.assignee || '',
      in_portfolio: true,
    });
  }
  return map;
}

/**
 * Get CPC code counts aggregated at a given level.
 */
export async function getCpcCodeCounts(
  level: 'section' | 'class' | 'subclass' | 'group',
  portfolioId?: string,
): Promise<Array<{ code: string; count: number }>> {
  const where: Prisma.PatentCpcWhereInput = portfolioId
    ? { patent: { portfolios: { some: { portfolioId } } } }
    : {};

  const allCpcs = await prisma.patentCpc.findMany({
    where,
    select: { cpcCode: true, patentId: true },
  });

  function extractLevel(cpc: string): string {
    switch (level) {
      case 'section': return cpc.slice(0, 1);
      case 'class': return cpc.slice(0, 3);
      case 'subclass': return cpc.slice(0, 4);
      case 'group': return cpc.split('/')[0];
      default: return cpc.slice(0, 4);
    }
  }

  // Count unique CPC-at-level per patent (don't double-count within a patent)
  const patentCpcSets = new Map<string, Set<string>>();
  for (const row of allCpcs) {
    const key = extractLevel(row.cpcCode);
    if (!patentCpcSets.has(row.patentId)) {
      patentCpcSets.set(row.patentId, new Set());
    }
    patentCpcSets.get(row.patentId)!.add(key);
  }

  const counts: Record<string, number> = {};
  for (const cpcSet of patentCpcSets.values()) {
    for (const key of cpcSet) {
      counts[key] = (counts[key] || 0) + 1;
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }));
}

/**
 * Get sub-sector counts.
 */
export async function getSubSectorCounts(portfolioId?: string): Promise<Array<{
  name: string;
  count: number;
  sector?: string;
}>> {
  const where: Prisma.PatentWhereInput = portfolioId
    ? { portfolios: { some: { portfolioId } }, primarySubSectorName: { not: null } }
    : { primarySubSectorName: { not: null } };

  const patents = await prisma.patent.findMany({
    where,
    select: { primarySubSectorName: true, primarySector: true },
  });

  const counts: Record<string, { count: number; sector?: string }> = {};
  for (const p of patents) {
    const name = p.primarySubSectorName!;
    if (!counts[name]) {
      counts[name] = { count: 0, sector: p.primarySector || undefined };
    }
    counts[name].count++;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, data]) => ({ name, count: data.count, sector: data.sector }));
}

/**
 * Get all filter options in a single call (for FlexFilterBuilder).
 */
export async function getAllFilterOptions(portfolioId?: string) {
  const where: Prisma.PatentWhereInput = portfolioId
    ? { portfolios: { some: { portfolioId } } }
    : {};

  const patents = await prisma.patent.findMany({
    where,
    select: {
      affiliate: true,
      superSector: true,
      primarySector: true,
      assignee: true,
      baseScore: true,
      remainingYears: true,
      hasLlmData: true,
      isExpired: true,
      isQuarantined: true,
      primarySubSectorName: true,
    },
  });

  // Also get competitor names and CPC codes
  const citationWhere: Prisma.PatentCitationAnalysisWhereInput = portfolioId
    ? { patent: { portfolios: { some: { portfolioId } } } }
    : {};

  const [citations, cpcRows] = await Promise.all([
    prisma.patentCitationAnalysis.findMany({
      where: citationWhere,
      select: { competitorNames: true, competitorCitations: true },
    }),
    prisma.patentCpc.findMany({
      where: portfolioId ? { patent: { portfolios: { some: { portfolioId } } } } : {},
      select: { cpcCode: true, patentId: true },
    }),
  ]);

  // Aggregate counts
  const affiliateCounts: Record<string, number> = {};
  const superSectorCounts: Record<string, number> = {};
  const primarySectorCounts: Record<string, number> = {};
  const subSectorCounts: Record<string, { count: number; sector?: string }> = {};
  let scoreMin = Infinity, scoreMax = -Infinity;
  let yearsMin = Infinity, yearsMax = -Infinity;
  let withLlmData = 0, withCompetitors = 0, expired = 0, quarantined = 0;

  for (const p of patents) {
    const aff = p.affiliate || 'Unknown';
    affiliateCounts[aff] = (affiliateCounts[aff] || 0) + 1;

    const ss = p.superSector || 'Unknown';
    superSectorCounts[ss] = (superSectorCounts[ss] || 0) + 1;

    const sector = p.primarySector || 'unknown';
    primarySectorCounts[sector] = (primarySectorCounts[sector] || 0) + 1;

    if (p.primarySubSectorName) {
      if (!subSectorCounts[p.primarySubSectorName]) {
        subSectorCounts[p.primarySubSectorName] = { count: 0, sector: p.primarySector || undefined };
      }
      subSectorCounts[p.primarySubSectorName].count++;
    }

    const score = p.baseScore ?? 0;
    if (score < scoreMin) scoreMin = score;
    if (score > scoreMax) scoreMax = score;

    const years = p.remainingYears ?? 0;
    if (years < yearsMin) yearsMin = years;
    if (years > yearsMax) yearsMax = years;

    if (p.hasLlmData) withLlmData++;
    if (p.isExpired) expired++;
    if (p.isQuarantined) quarantined++;
  }

  // Competitor counts
  const competitorCounts: Record<string, number> = {};
  for (const c of citations) {
    if ((c.competitorCitations ?? 0) > 0) withCompetitors++;
    for (const name of c.competitorNames) {
      competitorCounts[name] = (competitorCounts[name] || 0) + 1;
    }
  }

  // CPC counts (subclass level, unique per patent)
  const patentCpcSets = new Map<string, Set<string>>();
  for (const row of cpcRows) {
    const key = row.cpcCode.slice(0, 4);
    if (!patentCpcSets.has(row.patentId)) {
      patentCpcSets.set(row.patentId, new Set());
    }
    patentCpcSets.get(row.patentId)!.add(key);
  }
  const cpcCounts: Record<string, number> = {};
  for (const cpcSet of patentCpcSets.values()) {
    for (const key of cpcSet) {
      cpcCounts[key] = (cpcCounts[key] || 0) + 1;
    }
  }

  return {
    affiliates: Object.entries(affiliateCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    superSectors: Object.entries(superSectorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    primarySectors: Object.entries(primarySectorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    competitorNames: Object.entries(competitorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([name, count]) => ({ name, count })),
    cpcCodes: Object.entries(cpcCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 100)
      .map(([code, count]) => ({ code, count })),
    subSectors: Object.entries(subSectorCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, data]) => ({ name, count: data.count, sector: data.sector })),
    ranges: {
      score: { min: scoreMin === Infinity ? 0 : scoreMin, max: scoreMax === -Infinity ? 100 : scoreMax },
      years: { min: yearsMin === Infinity ? 0 : yearsMin, max: yearsMax === -Infinity ? 20 : yearsMax },
    },
    counts: {
      total: patents.length,
      withLlmData,
      withCompetitors,
      expired,
      quarantined,
    },
  };
}

/**
 * Get minimal patent data for enrichment coverage analysis.
 * Returns all patents with score, sector, affiliate + enrichment flags.
 */
export async function getPatentsForEnrichment(portfolioId?: string): Promise<Array<{
  patent_id: string;
  score: number;
  grant_date: string | null;
  affiliate: string;
  super_sector: string;
  remaining_years: number;
  forward_citations: number;
  competitor_citations: number;
  has_llm_data: boolean;
  has_citation_data: boolean;
  has_prosecution_data: boolean;
  has_xml_data: boolean;
  is_quarantined: boolean;
  quarantine: any;
}>> {
  const where: Prisma.PatentWhereInput = portfolioId
    ? { portfolios: { some: { portfolioId } } }
    : {};

  const patents = await prisma.patent.findMany({
    where,
    select: {
      patentId: true,
      baseScore: true,
      grantDate: true,
      affiliate: true,
      assignee: true,
      superSector: true,
      remainingYears: true,
      forwardCitations: true,
      hasLlmData: true,
      hasCitationData: true,
      hasProsecutionData: true,
      hasXmlData: true,
      isQuarantined: true,
      quarantine: true,
      citations: { select: { competitorCitations: true } },
    },
  });

  return patents.map(p => ({
    patent_id: p.patentId,
    score: p.baseScore ?? 0,
    grant_date: p.grantDate || null,
    affiliate: p.affiliate || p.assignee || 'Unknown',
    super_sector: p.superSector || 'Unknown',
    remaining_years: p.remainingYears ?? 0,
    forward_citations: p.forwardCitations ?? 0,
    competitor_citations: (p as any).citations?.competitorCitations ?? 0,
    has_llm_data: p.hasLlmData,
    has_citation_data: p.hasCitationData,
    has_prosecution_data: p.hasProsecutionData,
    has_xml_data: p.hasXmlData,
    is_quarantined: p.isQuarantined,
    quarantine: p.quarantine,
  }));
}
