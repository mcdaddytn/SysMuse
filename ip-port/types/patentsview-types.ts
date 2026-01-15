/**
 * PatentsView API Type Definitions
 * 
 * Complete TypeScript types for PatentsView API responses
 * API Documentation: https://search.patentsview.org/docs/
 */

/**
 * Query construction types
 */
export type PatentQuery = 
  | { [field: string]: any }
  | { _and: PatentQuery[] }
  | { _or: PatentQuery[] }
  | { _not: PatentQuery }
  | { _gte: { [field: string]: string | number } }
  | { _lte: { [field: string]: string | number } }
  | { _gt: { [field: string]: string | number } }
  | { _lt: { [field: string]: string | number } }
  | { _begins: { [field: string]: string } }
  | { _contains: { [field: string]: string } }
  | { _text_any: { [field: string]: string } }
  | { _text_all: { [field: string]: string } }
  | { _text_phrase: { [field: string]: string } };

export interface PatentQueryOptions {
  query: PatentQuery;
  fields?: string[];
  sort?: Array<{ [field: string]: 'asc' | 'desc' }>;
  options?: {
    size?: number;
    after?: string | string[];
    exclude_withdrawn?: boolean;
    pad_patent_id?: boolean;
  };
}

/**
 * Main response types
 */
export interface PatentResponse {
  error: boolean;
  count: number;
  total_hits: number;
  patents: Patent[];
}

export interface Patent {
  patent_id: string;
  patent_number?: string;
  patent_title?: string;
  patent_abstract?: string;
  patent_date?: string;
  patent_type?: string;
  patent_kind?: string;
  wipo_kind?: string;
  withdrawn?: boolean;
  
  // Assignees
  assignees?: Assignee[];
  
  // Inventors
  inventors?: Inventor[];
  
  // Citations
  us_patent_citations?: Citation[];
  us_application_citations?: Citation[];
  foreign_citations?: ForeignCitation[];
  other_references?: OtherReference[];
  
  // Classifications
  cpc?: CPCClassification[];
  ipc?: IPCClassification[];
  uspc?: USPCClassification[];
  
  // Claims
  claims?: Claim[];
  
  // Application data
  application_number?: string;
  filing_date?: string;
  
  // Processing data
  patent_processing_time?: number;
  
  // Legal data
  terms_of_grant?: string;
  
  // Additional fields - API allows any field
  [key: string]: any;
}

/**
 * Assignee types
 */
export interface Assignee {
  assignee_id: string;
  assignee_sequence?: number;
  assignee_organization?: string;
  assignee_individual_name_first?: string;
  assignee_individual_name_last?: string;
  assignee_individual_name_full?: string;
  assignee_type?: string; // '2' = US Company, '3' = Foreign Company, '4' = US Individual, '5' = Foreign Individual, '6' = Government
  assignee_country?: string;
  assignee_state?: string;
  assignee_city?: string;
  assignee_location_id?: string;
  assignee_lastknown_latitude?: number;
  assignee_lastknown_longitude?: number;
  assignee_lastknown_country?: string;
  assignee_lastknown_state?: string;
  assignee_lastknown_city?: string;
}

/**
 * Inventor types
 */
export interface Inventor {
  inventor_id: string;
  inventor_sequence?: number;
  inventor_name_first?: string;
  inventor_name_last?: string;
  inventor_name_full?: string;
  inventor_city?: string;
  inventor_state?: string;
  inventor_country?: string;
  inventor_location_id?: string;
  inventor_latitude?: number;
  inventor_longitude?: number;
}

/**
 * Citation types
 */
export interface Citation {
  cited_patent_number?: string;
  cited_patent_id?: string;
  cited_patent_title?: string;
  cited_patent_date?: string;
  cited_patent_kind?: string;
  cited_patent_sequence?: number;
  citation_category?: string;
  citation_sequence?: number;
}

export interface ForeignCitation {
  foreign_citation_sequence?: number;
  foreign_citation_document_number?: string;
  foreign_citation_country?: string;
  foreign_citation_date?: string;
  foreign_citation_category?: string;
}

export interface OtherReference {
  other_reference_id: string;
  other_reference_sequence?: number;
  other_reference_text?: string;
}

/**
 * Classification types
 */
export interface CPCClassification {
  cpc_sequence?: number;
  cpc_section_id?: string;
  cpc_subsection_id?: string;
  cpc_group_id?: string;
  cpc_subgroup_id?: string;
  cpc_category?: string; // 'primary' or 'additional'
  cpc_subgroup_title?: string;
}

export interface IPCClassification {
  ipc_sequence?: number;
  ipc_class?: string;
  ipc_subclass?: string;
  ipc_main_group?: string;
  ipc_subgroup?: string;
  ipc_symbol_position?: string;
  ipc_classification_value?: string;
  ipc_classification_status?: string;
  ipc_classification_data_source?: string;
  ipc_action_date?: string;
  ipc_version_indicator?: string;
}

export interface USPCClassification {
  uspc_sequence?: number;
  uspc_mainclass_id?: string;
  uspc_mainclass_title?: string;
  uspc_subclass_id?: string;
  uspc_subclass_title?: string;
}

/**
 * Claim types
 */
export interface Claim {
  claim_sequence?: number;
  claim_number?: string;
  claim_text?: string;
  claim_dependent?: boolean;
  claim_dependent_on?: string;
  claim_exemplary?: boolean;
}

/**
 * Location types
 */
export interface Location {
  location_id: string;
  latitude?: number;
  longitude?: number;
  city?: string;
  state?: string;
  country?: string;
  county?: string;
  county_fips?: string;
}

/**
 * Government interest types
 */
export interface GovernmentInterest {
  gi_statement?: string;
  gi_fed_agency?: string[];
}

/**
 * Application types
 */
export interface Application {
  application_number?: string;
  application_date?: string;
  application_type?: string;
  application_country?: string;
  filing_date?: string;
  series_code?: string;
}

/**
 * Related application types
 */
export interface RelatedApplication {
  related_app_patent_number?: string;
  related_app_patent_id?: string;
  related_app_application_number?: string;
  related_app_filing_date?: string;
  related_app_type?: string;
}

/**
 * PCT data types
 */
export interface PCTData {
  pct_application_number?: string;
  pct_filing_date?: string;
  pct_371_date?: string;
  pct_published_number?: string;
  pct_published_date?: string;
}

/**
 * Foreign priority types
 */
export interface ForeignPriority {
  foreign_priority_sequence?: number;
  foreign_priority_country?: string;
  foreign_priority_application_number?: string;
  foreign_priority_date?: string;
}

/**
 * Attorney/Agent types
 */
export interface Attorney {
  attorney_sequence?: number;
  attorney_first_name?: string;
  attorney_last_name?: string;
  attorney_full_name?: string;
  attorney_organization?: string;
}

/**
 * Examiner types
 */
export interface Examiner {
  examiner_id?: string;
  examiner_first_name?: string;
  examiner_last_name?: string;
  examiner_full_name?: string;
  examiner_group?: string;
}

/**
 * WIPO classification types
 */
export interface WIPOClassification {
  wipo_sequence?: number;
  wipo_field_id?: string;
  wipo_field_title?: string;
}

/**
 * NBER classification types
 */
export interface NBERClassification {
  nber_category_id?: string;
  nber_category_title?: string;
  nber_subcategory_id?: string;
  nber_subcategory_title?: string;
}

/**
 * API configuration types
 */
export interface PatentsViewConfig {
  apiKey: string;
}

/**
 * Pagination types
 */
export interface PaginationOptions {
  size?: number;
  after?: string | string[];
}

/**
 * Sort options
 */
export type SortOption = { [field: string]: 'asc' | 'desc' };

/**
 * API error types
 */
export interface PatentsViewError extends Error {
  statusCode?: number;
  response?: any;
  endpoint?: string;
}

/**
 * Search context types (for complex queries)
 */
export interface SearchContext {
  query: PatentQuery;
  fields: string[];
  sort?: SortOption[];
  pagination?: PaginationOptions;
}

/**
 * Bulk data types
 */
export interface BulkDataRequest {
  queries: PatentQueryOptions[];
  batchSize?: number;
  delay?: number;
}

export interface BulkDataResponse {
  totalPatents: number;
  batches: number;
  patents: Patent[];
  errors: Array<{ query: PatentQueryOptions; error: Error }>;
}

/**
 * Analysis types
 */
export interface CitationNetwork {
  patent: Patent;
  backwardCitations: Citation[];
  forwardCitations: Patent[];
  citationDepth?: number;
}

export interface AssigneePortfolio {
  assignee: Assignee;
  patents: Patent[];
  totalCount: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
  topTechnologies: CPCClassification[];
}

export interface TechnologyTrend {
  cpcSection: string;
  patentCount: number;
  yearlyBreakdown: Array<{ year: string; count: number }>;
  growthRate: number;
}

/**
 * Filter types
 */
export interface DateRangeFilter {
  startDate: string;
  endDate: string;
  field?: 'patent_date' | 'filing_date';
}

export interface AssigneeFilter {
  organization?: string;
  country?: string;
  type?: string;
}

export interface TechnologyFilter {
  cpcSection?: string;
  cpcClass?: string;
  cpcGroup?: string;
  ipcClass?: string;
}

/**
 * Export format types
 */
export type ExportFormat = 'json' | 'csv' | 'xml';

export interface ExportOptions {
  format: ExportFormat;
  fields?: string[];
  includeHeaders?: boolean;
  delimiter?: string;
}

/**
 * Commonly used field lists
 */
export const BASIC_FIELDS = [
  'patent_id',
  'patent_number',
  'patent_title',
  'patent_date',
] as const;

export const CITATION_FIELDS = [
  ...BASIC_FIELDS,
  'us_patent_citations',
  'foreign_citations',
  'other_references',
] as const;

export const ASSIGNEE_FIELDS = [
  ...BASIC_FIELDS,
  'assignees',
] as const;

export const FULL_FIELDS = [
  ...BASIC_FIELDS,
  'patent_abstract',
  'assignees',
  'inventors',
  'cpc',
  'us_patent_citations',
  'claims',
] as const;

/**
 * Type guards
 */
export function isPatent(obj: any): obj is Patent {
  return obj && typeof obj.patent_id === 'string';
}

export function isPatentResponse(obj: any): obj is PatentResponse {
  return obj && Array.isArray(obj.patents) && typeof obj.error === 'boolean';
}

export function isCitation(obj: any): obj is Citation {
  return obj && (obj.cited_patent_number || obj.cited_patent_id);
}

export function isAssignee(obj: any): obj is Assignee {
  return obj && typeof obj.assignee_id === 'string';
}

export function isInventor(obj: any): obj is Inventor {
  return obj && typeof obj.inventor_id === 'string';
}
