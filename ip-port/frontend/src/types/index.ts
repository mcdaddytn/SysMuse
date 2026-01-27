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
  // Citation-aware scoring (Session 13)
  adjusted_forward_citations: number;
  competitor_density: number;
  has_citation_data: boolean;

  // Optional scoring fields
  v2_score?: number;
  v3_score?: number;
  consensus_score?: number;
  inventors?: string[];

  // LLM data (from enrichment pipeline)
  has_llm_data?: boolean;
  // Attorney text fields
  llm_summary?: string;
  llm_prior_art_problem?: string;
  llm_technical_solution?: string;
  // Classification
  llm_technology_category?: string;
  llm_implementation_type?: string;
  llm_standards_relevance?: string;
  llm_market_segment?: string;
  llm_detection_method?: string;
  llm_implementation_complexity?: string;
  llm_claim_type_primary?: string;
  llm_geographic_scope?: string;
  llm_lifecycle_stage?: string;
  // Numeric scores
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
  // Computed sub-scores
  legal_viability_score?: number;
  enforcement_potential_score?: number;
  market_value_score?: number;
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
  // Citation-aware scoring (Session 13)
  adjusted_forward_citations: number;
  competitor_density: number;
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
  focusAreaId?: string;
  // Flat numeric ranges (match backend query params)
  scoreMin?: number;
  scoreMax?: number;
  yearsMin?: number;
  yearsMax?: number;
  competitorCitesMin?: number;
  competitorCitesMax?: number;
  forwardCitesMin?: number;
  forwardCitesMax?: number;
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
