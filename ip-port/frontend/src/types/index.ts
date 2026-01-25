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

  // Optional extended fields
  competitor_citations?: number;
  v2_score?: number;
  v3_score?: number;
  consensus_score?: number;
  inventors?: string[];
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
  | 'attorney'
  | 'llm'
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
