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

  // Sub-sector assignment (from CPC inventive designation)
  primary_sub_sector_id?: string;
  primary_sub_sector_name?: string;
  sub_sector_match_type?: 'inventive' | 'primary' | 'fallback' | 'none';
  sub_sector_confidence?: 'high' | 'medium' | 'low';

  // CPC designation data
  primary_cpc?: string;
  primary_cpc_designation?: 'I' | 'A';
  inventive_cpc_codes?: string[];
  additional_cpc_codes?: string[];

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
  // Score filtering
  scoreMin?: number;
  scoreMax?: number;
  v2ScoreMin?: number;
  v2ScoreMax?: number;
  v3ScoreMin?: number;
  v3ScoreMax?: number;
  // Time ranges
  yearsMin?: number;
  yearsMax?: number;
  // Citation ranges
  forwardCitesMin?: number;
  forwardCitesMax?: number;
  competitorCitesMin?: number;
  competitorCitesMax?: number;
  affiliateCitesMin?: number;
  affiliateCitesMax?: number;
  neutralCitesMin?: number;
  neutralCitesMax?: number;
  // Phase 2: One-to-many filters
  competitorNames?: string[];
  cpcCodes?: string[];
  subSectors?: string[];
  // Phase 2: Boolean filters
  hasLlmData?: string;      // 'true' | 'false' | undefined
  isExpired?: string;       // 'true' | 'false' | undefined
}

// Column group for organized column selector
export type ColumnGroup =
  | 'core'
  | 'entity'
  | 'citations'
  | 'scores'
  | 'llmText'
  | 'family'
  | 'scoring'
  | 'dimensions'
  | 'litigation';

export interface ColumnGroupInfo {
  id: ColumnGroup;
  label: string;
  description?: string;
  icon: string;
  defaultExpanded: boolean;
}

// Generic grid column metadata (not tied to any specific data type)
export interface GridColumnMeta {
  name: string;
  label: string;
  group: string;
  defaultVisible: boolean;
  description?: string;
}

// Generic column group definition
export interface GridColumnGroup {
  id: string;
  label: string;
  icon: string;
  description?: string;
  defaultExpanded?: boolean;
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

// =============================================================================
// Sector Management Types
// =============================================================================

export type SectorRuleType =
  | 'CPC_PREFIX'
  | 'CPC_SUBGROUP'
  | 'KEYWORD'
  | 'PHRASE'
  | 'KEYWORD_AND'
  | 'BOOLEAN';

export type SectorRuleScope = 'LIBRARY' | 'PORTFOLIO';

export interface SectorRule {
  id: string;
  sectorId: string;
  ruleType: SectorRuleType;
  expression: string;
  priority: number;
  isExclusion: boolean;
  scope: SectorRuleScope;
  portfolioId?: string | null;
  description?: string | null;
  isActive: boolean;
  matchCount: number;
  promotedFrom?: string | null;
  promotedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SectorDetail {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  superSectorId?: string | null;
  superSector?: { id: string; name: string; displayName: string } | null;
  cpcPrefixes: string[];
  damagesTier?: string | null;
  damagesRating?: number | null;
  facets?: Record<string, number> | null;
  patentCount: number;
  targetMinSize?: number | null;
  targetMaxSize?: number | null;
  rules: SectorRule[];
  _count?: { rules: number };
  createdAt: string;
  updatedAt: string;
}

export interface SectorSummary {
  id: string;
  name: string;
  displayName: string;
  patentCount: number;
  damagesTier?: string | null;
  damagesRating?: number | null;
  _count?: { rules: number };
}

export interface SuperSectorDetail {
  id: string;
  name: string;
  displayName: string;
  description?: string | null;
  sectors: SectorSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface RulePreviewResult {
  matchCount: number;
  samplePatentIds: string[];
  overlapWithCurrentSector: number;
  newToSector: number;
}

export interface SeedSummary {
  message: string;
  superSectors: number;
  sectors: number;
  cpcRules: number;
  keywordRules: number;
  damagesUpdated: number;
  facetsUpdated: number;
}

// =============================================================================
// V3 Consensus Scoring Types
// =============================================================================

export interface V3ConsensusRole {
  roleId: string;           // e.g., 'executive', 'litigation', 'licensing'
  roleName: string;         // Display name
  v2PresetId: string;       // Which V2 preset they're using
  consensusWeight: number;  // 0-100, their weight in consensus
}

export interface V3ConsensusPreset {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  roles: V3ConsensusRole[];
}

export interface V3ConsensusConfig {
  roles: V3ConsensusRole[];
  topN: number;
  llmEnhancedOnly: boolean;
}

export interface V3ConsensusScoredPatent {
  patent_id: string;
  rank: number;
  rank_change?: number;
  consensus_score: number;
  role_scores: Record<string, number>;  // roleId -> score
  // Patent details
  patent_title: string;
  patent_abstract: string;
  patent_date: string;
  assignee: string;
  primary_sector: string;
  super_sector: string;
  years_remaining: number;
  has_llm_data: boolean;
  // Raw metrics for tooltip
  raw_metrics: Record<string, number>;
  normalized_metrics: Record<string, number>;
  year_multiplier: number;
}

export interface V3ConsensusSnapshot {
  id: string;
  name: string;
  timestamp: string;
  topN: number;
  config: V3ConsensusConfig;
  rankings: Array<{
    patent_id: string;
    rank: number;
    consensus_score: number;
    rank_change?: number;
  }>;
}
