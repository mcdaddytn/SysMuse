// Patent types
export interface Patent {
  patent_id: string;
  patent_title: string;
  abstract?: string | null;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;

  // Normalized entity and sector fields
  affiliate: string;
  super_sector: string;
  primary_sector: string;
  cpc_codes: string[];

  // Citation classification (from P-0a pipeline)
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
  competitor_count: number;
  competitor_names: string[];
  has_citation_data: boolean;

  // Optional scoring fields
  v2_score?: number;
  v3_score?: number;
  consensus_score?: number;
  inventors?: string[];

  // LLM data (from enrichment pipeline)
  has_llm_data?: boolean;
  llm_summary?: string;
  llm_technology_category?: string;
  llm_implementation_type?: string;
  llm_standards_relevance?: string;
  llm_market_segment?: string;
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  llm_confidence?: number;
  market_relevance_score?: number;
}

// User and auth types
export type AccessLevel = 'VIEWER' | 'ANALYST' | 'MANAGER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  name: string;
  accessLevel: AccessLevel;
  isActive: boolean;
}

// Scoring types
export interface UserWeights {
  citationWeight: number;
  yearsWeight: number;
  competitorWeight: number;
  sectorWeights?: Record<string, number>;
}

export interface ScoreResult {
  patent_id: string;
  v2_score: number;
  v3_score: number;
  consensus_score: number;
  rank: number;
  rank_change?: number; // Delta from previous
}

// V3 Scoring Profile
export interface ScoringProfile {
  id: string;
  displayName: string;
  description: string;
  category: string;
  weights: Record<string, number>;
  isDefault?: boolean;
}

// V3 Scored Patent (from /api/scores/v3)
export interface V3ScoredPatent {
  patent_id: string;
  score: number;
  rank: number;
  normalized_metrics: Record<string, number>;
  year_multiplier: number;
  base_score: number;
  metrics_used: string[];
  profile_id: string;
  // Enriched fields
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  primary_sector: string;
  super_sector: string;
  cpc_codes: string[];
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
  competitor_count: number;
  competitor_names: string[];
  // LLM data
  has_llm_scores: boolean;
  llm_scores: {
    eligibility_score: number;
    validity_score: number;
    claim_breadth: number;
    enforcement_clarity: number;
    design_around_difficulty: number;
  } | null;
}

// LLM coverage stats
export interface LlmCoverage {
  total_patents: number;
  patents_with_llm: number;
  coverage_pct: number;
}

// Sector ranking (from /api/scores/sectors)
export interface SectorRanking {
  sector: string;
  sector_name: string;
  super_sector: string;
  patent_count: number;
  avg_score: number;
  max_score: number;
  damages_rating: number;
  damages_label: string;
  top_patents: Array<{
    patent_id: string;
    score: number;
    rank: number;
    title: string;
    assignee: string;
    remaining_years: number;
  }>;
}

// Job types
export type JobType =
  | 'CITATION_ANALYSIS'
  | 'PROSECUTION_HISTORY'
  | 'PTAB_CHECK'
  | 'LLM_ANALYSIS'
  | 'PATLYTICS_FETCH'
  | 'SEARCH_TERM_EXTRACT';

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  patentId?: string;
  patentIds?: string[];
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// Filter types
export interface PortfolioFilters {
  search?: string;
  affiliates?: string[];
  superSectors?: string[];
  assignees?: string[];
  primarySectors?: string[];
  dateRange?: { start: string; end: string };
  scoreRange?: { min: number; max: number };
  remainingYearsRange?: { min: number; max: number };
  hasCompetitorCites?: boolean;
  activeOnly?: boolean;
}

// Column group for organized column selector
export type ColumnGroup =
  | 'core'
  | 'entity'
  | 'citations'
  | 'scores'
  | 'llmText'
  | 'focusArea';

export interface ColumnGroupInfo {
  id: ColumnGroup;
  label: string;
  description?: string;
  icon: string;
  defaultExpanded: boolean;
}

// Grid column definition
export interface GridColumn {
  name: string;
  label: string;
  field: string | ((row: Patent) => unknown);
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  format?: (val: unknown) => string;
  visible?: boolean;
  group: ColumnGroup;
  description?: string;
}

// Pagination
export interface PaginationParams {
  page: number;
  rowsPerPage: number;
  sortBy?: string;
  descending?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  rowsPerPage: number;
}
