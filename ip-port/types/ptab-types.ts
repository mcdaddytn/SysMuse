/**
 * USPTO Open Data Portal - PTAB API Type Definitions
 * 
 * Complete TypeScript types for Patent Trial and Appeal Board (PTAB) API responses
 * API Documentation: https://data.uspto.gov/apis/ptab-trials
 */

/**
 * Configuration types
 */
export interface PTABConfig {
  apiKey: string;
}

/**
 * Search query types
 */
export interface PTABSearchQuery {
  filters?: PTABFilter[];
  rangeFilters?: PTABRangeFilter[];
  sort?: PTABSort[];
  page?: number;
  size?: number;
  searchText?: string;
}

export interface PTABFilter {
  name: string;
  value: string | string[];
}

export interface PTABRangeFilter {
  field: string;
  valueFrom?: string;
  valueTo?: string;
}

export interface PTABSort {
  field: string;
  order: 'asc' | 'desc';
}

/**
 * Response types
 */
export interface PTABTrialSearchResponse {
  totalHits: number;
  page: number;
  size: number;
  trials: PTABTrial[];
}

export interface PTABDocumentsResponse {
  totalHits: number;
  documents: PTABDocument[];
}

export interface PTABDecisionSearchResponse {
  totalHits: number;
  page: number;
  size: number;
  decisions: PTABDecision[];
}

/**
 * Trial types
 */
export interface PTABTrial {
  trialNumber: string;
  trialType: TrialType;
  trialStatusCategory?: string;
  trialStatusText?: string;
  trialStatusDate?: string;
  
  // Petitioner information
  petitionerPartyName?: string;
  petitionerCounselName?: string;
  petitionerCounselEmail?: string;
  petitionerCounselPhone?: string;
  
  // Patent owner information
  patentOwnerName?: string;
  patentOwnerCounselName?: string;
  patentOwnerCounselEmail?: string;
  patentOwnerCounselPhone?: string;
  
  // Respondent patent information
  respondentPatentNumber?: string;
  respondentPatentTitle?: string;
  respondentPatentIssueDate?: string;
  respondentPatentOwner?: string;
  
  // Trial dates
  filingDate?: string;
  accordedFilingDate?: string;
  institutionDecisionDate?: string;
  institutionDecision?: InstitutionDecision;
  finalWrittenDecisionDate?: string;
  finalWrittenDecisionType?: string;
  
  // Claims
  claimsChallenged?: string;
  claimsInstituted?: string;
  claimsInvalidated?: string;
  claimsPatentable?: string;
  
  // Outcome
  patentability?: Patentability;
  settlement?: boolean;
  settlementDate?: string;
  
  // Panel information
  judgePanelNames?: string[];
  
  // Metadata
  [key: string]: any;
}

/**
 * Trial type enum
 */
export enum TrialType {
  IPR = 'IPR',              // Inter Partes Review
  PGR = 'PGR',              // Post-Grant Review
  CBM = 'CBM',              // Covered Business Method
  DER = 'DER',              // Derivation
  APPEAL = 'APPEAL',        // Ex Parte Appeal
  REEXAM = 'REEXAM',        // Ex Parte Reexamination
  INTERFERENCE = 'INTERFERENCE'
}

/**
 * Institution decision enum
 */
export enum InstitutionDecision {
  INSTITUTED = 'Instituted',
  DENIED = 'Denied',
  DISMISSED = 'Dismissed',
  PENDING = 'Pending'
}

/**
 * Patentability enum
 */
export enum Patentability {
  UNPATENTABLE = 'Unpatentable',
  PATENTABLE = 'Patentable',
  MIXED = 'Mixed',
  NOT_REACHED = 'Not Reached'
}

/**
 * Document types
 */
export interface PTABDocument {
  documentIdentifier: string;
  documentNumber?: string;
  trialNumber?: string;
  documentType?: string;
  documentTypeDescription?: string;
  documentTitle?: string;
  documentCategory?: DocumentCategory;
  filingDate?: string;
  filingParty?: FilingParty;
  documentUrl?: string;
  documentSize?: number;
  pageCount?: number;
  
  // Decision specific fields
  isDecision?: boolean;
  decisionType?: DecisionType;
  decisionDate?: string;
  
  // Metadata
  [key: string]: any;
}

/**
 * Document category enum
 */
export enum DocumentCategory {
  PETITION = 'Petition',
  PRELIMINARY_RESPONSE = 'Preliminary Response',
  INSTITUTION_DECISION = 'Institution Decision',
  PATENT_OWNER_RESPONSE = 'Patent Owner Response',
  PETITIONER_REPLY = 'Petitioner Reply',
  ORAL_HEARING = 'Oral Hearing',
  FINAL_WRITTEN_DECISION = 'Final Written Decision',
  MOTION = 'Motion',
  OTHER = 'Other'
}

/**
 * Filing party enum
 */
export enum FilingParty {
  PETITIONER = 'Petitioner',
  PATENT_OWNER = 'Patent Owner',
  BOARD = 'Board',
  OTHER = 'Other'
}

/**
 * Decision type enum
 */
export enum DecisionType {
  INSTITUTION_DECISION = 'Institution Decision',
  FINAL_WRITTEN_DECISION = 'Final Written Decision',
  TERMINATION_DECISION = 'Termination Decision',
  REHEARING_DECISION = 'Rehearing Decision',
  PRECEDENTIAL = 'Precedential',
  INFORMATIVE = 'Informative'
}

/**
 * Decision types
 */
export interface PTABDecision {
  trialNumber: string;
  decisionType: DecisionType;
  decisionDate?: string;
  decisionText?: string;
  decisionSummary?: string;
  documentIdentifier?: string;
  documentUrl?: string;
  
  // Patent information
  patentNumber?: string;
  patentTitle?: string;
  
  // Parties
  petitionerName?: string;
  patentOwnerName?: string;
  
  // Claims analysis
  claimsAnalyzed?: ClaimAnalysis[];
  claimsInvalidated?: string[];
  claimsPatentable?: string[];
  
  // Panel
  panelJudges?: Judge[];
  
  // Precedential status
  isPrecedential?: boolean;
  isInformative?: boolean;
  
  [key: string]: any;
}

/**
 * Claim analysis types
 */
export interface ClaimAnalysis {
  claimNumber: string;
  patentability: Patentability;
  basis?: string;
  priorArt?: PriorArtReference[];
  reasoning?: string;
}

export interface PriorArtReference {
  documentNumber?: string;
  documentType?: 'Patent' | 'Publication' | 'Other';
  documentDate?: string;
  relevantClaims?: string[];
  applicableGrounds?: string[];
}

/**
 * Judge types
 */
export interface Judge {
  judgeName?: string;
  judgeTitle?: string;
  isChiefJudge?: boolean;
  isPresiding?: boolean;
}

/**
 * Party types
 */
export interface Party {
  partyName: string;
  partyType: 'Petitioner' | 'Patent Owner' | 'Respondent';
  counsel?: Counsel[];
}

export interface Counsel {
  counselName?: string;
  counselFirm?: string;
  leadCounsel?: boolean;
  backupCounsel?: boolean;
  registrationNumber?: string;
  email?: string;
  phone?: string;
}

/**
 * Statistics types
 */
export interface PTABStatistics {
  totalTrials: number;
  totalIPR: number;
  totalPGR: number;
  totalCBM: number;
  institutionRate: number;
  settlementRate: number;
  averageDuration: number; // in days
  invalidationRate?: number;
  mostCommonGrounds?: Ground[];
}

export interface Ground {
  statute: string; // '102', '103', etc.
  count: number;
  successRate: number;
}

/**
 * Timeline types
 */
export interface PTABTimeline {
  trial: PTABTrial;
  events: TimelineEvent[];
}

export interface TimelineEvent {
  date: string;
  eventType: EventType;
  description: string;
  document?: PTABDocument;
}

export enum EventType {
  PETITION_FILED = 'Petition Filed',
  PRELIMINARY_RESPONSE = 'Preliminary Response',
  INSTITUTION_DECISION = 'Institution Decision',
  PATENT_OWNER_RESPONSE = 'Patent Owner Response',
  PETITIONER_REPLY = 'Petitioner Reply',
  ORAL_HEARING = 'Oral Hearing',
  FINAL_DECISION = 'Final Decision',
  SETTLEMENT = 'Settlement',
  TERMINATION = 'Termination'
}

/**
 * Search filter helpers
 */
export interface TrialFilter {
  trialType?: TrialType[];
  institutionDecision?: InstitutionDecision[];
  patentNumber?: string;
  petitionerName?: string;
  patentOwnerName?: string;
  filingDateRange?: DateRange;
  institutionDateRange?: DateRange;
  decisionDateRange?: DateRange;
}

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Analysis types
 */
export interface CompetitorIPRAnalysis {
  company: string;
  asPatentOwner: {
    totalChallenges: number;
    institutionRate: number;
    invalidationRate: number;
    topChallenges: PTABTrial[];
  };
  asPetitioner: {
    totalChallenges: number;
    filedCount: number;
    successRate: number;
    topTargets: string[];
  };
}

export interface TechnologyAreaAnalysis {
  cpcSection: string;
  totalIPRs: number;
  institutionRate: number;
  invalidationRate: number;
  averageDuration: number;
  topPetitioners: string[];
}

export interface JudgeAnalysis {
  judgeName: string;
  totalCases: number;
  institutionRate: number;
  invalidationRate: number;
  averageCaseDuration: number;
}

/**
 * Trend analysis types
 */
export interface IPRTrend {
  year: number;
  month?: number;
  totalFiled: number;
  totalInstituted: number;
  totalDenied: number;
  institutionRate: number;
}

export interface OutcomeTrend {
  period: string;
  totalDecisions: number;
  unpatentableRate: number;
  patentableRate: number;
  mixedRate: number;
}

/**
 * Bulk operations types
 */
export interface BulkTrialRequest {
  patentNumbers: string[];
  trialTypes?: TrialType[];
}

export interface BulkTrialResult {
  patentNumber: string;
  trials: PTABTrial[];
  totalFound: number;
}

/**
 * Export types
 */
export interface PTABExportOptions {
  format: 'json' | 'csv' | 'excel';
  includeDocuments?: boolean;
  includeTimeline?: boolean;
  fields?: string[];
}

/**
 * Error types
 */
export interface PTABError extends Error {
  statusCode?: number;
  response?: any;
  endpoint?: string;
}

/**
 * Pagination types
 */
export interface PTABPagination {
  page: number;
  size: number;
  totalPages: number;
  totalRecords: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * Type guards
 */
export function isPTABTrial(obj: any): obj is PTABTrial {
  return obj && typeof obj.trialNumber === 'string';
}

export function isPTABDocument(obj: any): obj is PTABDocument {
  return obj && typeof obj.documentIdentifier === 'string';
}

export function isPTABDecision(obj: any): obj is PTABDecision {
  return obj && typeof obj.trialNumber === 'string' && obj.decisionType;
}

export function isIPR(trial: PTABTrial): boolean {
  return trial.trialType === TrialType.IPR;
}

export function isPGR(trial: PTABTrial): boolean {
  return trial.trialType === TrialType.PGR;
}

export function isCBM(trial: PTABTrial): boolean {
  return trial.trialType === TrialType.CBM;
}

export function isInstituted(trial: PTABTrial): boolean {
  return trial.institutionDecision === InstitutionDecision.INSTITUTED;
}

export function isDenied(trial: PTABTrial): boolean {
  return trial.institutionDecision === InstitutionDecision.DENIED;
}

/**
 * Commonly used filter fields
 */
export const TRIAL_STATUS_CATEGORIES = [
  'Active',
  'Terminated',
  'FWD Entered',
  'Settled',
  'Dismissed'
] as const;

export const COMMON_GROUNDS = [
  '102',  // Novelty
  '103',  // Obviousness
  '112',  // Written description / Enablement
  '101'   // Subject matter eligibility
] as const;

/**
 * Helper constants
 */
export const IPR_INSTITUTION_THRESHOLD_MONTHS = 9; // Typical time to institution decision
export const IPR_FINAL_DECISION_MONTHS = 18; // Typical total duration
export const PGR_DEADLINE_MONTHS = 9; // Deadline to file PGR after patent grant

/**
 * Complex query builder types
 */
export interface PTABQueryBuilder {
  filters: PTABFilter[];
  rangeFilters: PTABRangeFilter[];
  sort: PTABSort[];
  
  addFilter(name: string, value: string | string[]): PTABQueryBuilder;
  addRangeFilter(field: string, from?: string, to?: string): PTABQueryBuilder;
  addSort(field: string, order: 'asc' | 'desc'): PTABQueryBuilder;
  build(): PTABSearchQuery;
}

/**
 * Comparison types
 */
export interface TrialComparison {
  trial1: PTABTrial;
  trial2: PTABTrial;
  similarities: string[];
  differences: string[];
  relatedPatents: boolean;
  commonPriorArt: PriorArtReference[];
}

/**
 * Portfolio risk assessment types
 */
export interface PortfolioRiskAssessment {
  totalPatents: number;
  patentsWithIPRs: number;
  riskScore: number; // 0-100
  highRiskPatents: Array<{
    patentNumber: string;
    iprCount: number;
    institutionRate: number;
    riskFactors: string[];
  }>;
  technologyRisk: Array<{
    cpcSection: string;
    challengeRate: number;
    avgInvalidationRate: number;
  }>;
}
