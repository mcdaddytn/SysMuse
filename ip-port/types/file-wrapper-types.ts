/**
 * USPTO Open Data Portal - File Wrapper API Type Definitions
 * 
 * Complete TypeScript types for File Wrapper (Patent Prosecution) API responses
 * API Documentation: https://data.uspto.gov/apis/patent-file-wrapper
 */

/**
 * Configuration types
 */
export interface FileWrapperConfig {
  apiKey: string;
}

/**
 * Search query types
 */
export interface ApplicationSearchQuery {
  applicationNumber?: string;
  patentNumber?: string;
  filingDateFrom?: string;
  filingDateTo?: string;
  inventionTitle?: string;
  assignee?: string;
  inventor?: string;
  page?: number;
  size?: number;
}

/**
 * Search response types
 */
export interface ApplicationBiblioResponse {
  recordTotalQuantity: number;
  pageNumber: number;
  pageSize: number;
  applications: ApplicationBiblio[];
}

/**
 * Application bibliographic data
 */
export interface ApplicationBiblio {
  applicationNumber: string;
  applicationNumberFormatted?: string;
  patentNumber?: string;
  patentNumberFormatted?: string;
  filingDate?: string;
  inventionTitle?: string;
  applicationStatusDescriptionText?: string;
  applicationStatusCode?: string;
  applicationStatusDate?: string;
  
  // Applicants/Assignees
  applicants?: Applicant[];
  
  // Inventors
  inventors?: InventorInfo[];
  
  // Attorneys
  attorneys?: Attorney[];
  
  // Classifications
  cpcClassifications?: CPCClass[];
  ipcClassifications?: IPCClass[];
  uspcClassifications?: USPCClass[];
  
  // Filing details
  applicationTypeCode?: string;
  applicationTypeDescription?: string;
  patentIssueDate?: string;
  publicationNumber?: string;
  publicationDate?: string;
  
  // Related applications
  parentApplications?: RelatedApplication[];
  childApplications?: RelatedApplication[];
  continuityApplications?: ContinuityApplication[];
  
  // Foreign priority
  foreignPriority?: ForeignPriority[];
  
  // Examiner data
  primaryExaminer?: Examiner;
  assistantExaminer?: Examiner;
  
  // Claims
  claimsTotalQuantity?: number;
  claimsIndependentQuantity?: number;
  
  // Additional metadata
  [key: string]: any;
}

/**
 * Applicant types
 */
export interface Applicant {
  applicantName?: string;
  applicantNameFirst?: string;
  applicantNameLast?: string;
  applicantType?: string;
  applicantTypeDescription?: string;
  applicantSequenceNumber?: number;
  applicantAuthority?: string;
  applicantAuthorityDescription?: string;
  
  // Address information
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
  addressCountryCode?: string;
}

/**
 * Inventor types
 */
export interface InventorInfo {
  inventorNameFirst?: string;
  inventorNameLast?: string;
  inventorNameFull?: string;
  inventorSequenceNumber?: number;
  
  // Residence information
  inventorResidenceCity?: string;
  inventorResidenceState?: string;
  inventorResidenceCountry?: string;
  inventorResidenceCountryCode?: string;
}

/**
 * Attorney types
 */
export interface Attorney {
  attorneyName?: string;
  attorneyNameFirst?: string;
  attorneyNameLast?: string;
  registrationNumber?: string;
  attorneyDocketNumber?: string;
  attorneySequenceNumber?: number;
  attorneyType?: string;
  
  // Firm information
  firmName?: string;
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
}

/**
 * Classification types
 */
export interface CPCClass {
  cpcVersionDate?: string;
  cpcSectionCode?: string;
  cpcClassCode?: string;
  cpcSubclassCode?: string;
  cpcGroupCode?: string;
  cpcSubgroupCode?: string;
  cpcFullCode?: string;
  cpcSequenceNumber?: number;
  cpcClassificationValue?: string; // 'I' = inventive, 'N' = non-inventive
}

export interface IPCClass {
  ipcVersionDate?: string;
  ipcSectionCode?: string;
  ipcClassCode?: string;
  ipcSubclassCode?: string;
  ipcGroupCode?: string;
  ipcSubgroupCode?: string;
  ipcSequenceNumber?: number;
}

export interface USPCClass {
  uspcMainClassNumber?: string;
  uspcSubclassNumber?: string;
  uspcSequenceNumber?: number;
}

/**
 * Related application types
 */
export interface RelatedApplication {
  applicationNumber?: string;
  applicationNumberFormatted?: string;
  patentNumber?: string;
  patentNumberFormatted?: string;
  filingDate?: string;
  relationshipCode?: string;
  relationshipDescription?: string;
}

export interface ContinuityApplication {
  parentApplicationNumber?: string;
  parentFilingDate?: string;
  parentPatentNumber?: string;
  continuityType?: string;
  continuityTypeDescription?: string;
}

/**
 * Foreign priority types
 */
export interface ForeignPriority {
  priorityApplicationNumber?: string;
  priorityFilingDate?: string;
  priorityCountryCode?: string;
  priorityCountryName?: string;
}

/**
 * Examiner types
 */
export interface Examiner {
  examinerName?: string;
  examinerNameFirst?: string;
  examinerNameLast?: string;
  examinerDepartment?: string;
}

/**
 * Document types
 */
export interface DocumentsResponse {
  recordTotalQuantity: number;
  documents: FileHistoryDocument[];
}

export interface FileHistoryDocument {
  documentIdentifier?: string;
  documentCode?: string;
  documentCodeDescription?: string;
  mailDate?: string;
  mailRoomDate?: string;
  documentUrl?: string;
  documentSize?: number;
  documentSizeUnit?: string;
  documentType?: string;
  documentPages?: number;
  pageCount?: number;
  
  // Office Action specific
  isOfficeAction?: boolean;
  actionDate?: string;
  actionType?: string;
  actionCategory?: string;
  
  // Metadata
  filedByApplicant?: boolean;
  filedByExaminer?: boolean;
  scanDate?: string;
  
  [key: string]: any;
}

/**
 * Common document codes
 */
export enum DocumentCode {
  // Office Actions
  CTNF = 'CTNF',  // Non-Final Rejection
  CTFR = 'CTFR',  // Final Rejection
  N417 = 'N417',  // Notice of Allowance
  ABEX = 'ABEX',  // Examiner's Amendment
  SRFW = 'SRFW',  // Examiner Search Report
  
  // Applicant Responses
  RCEX = 'RCEX',  // Request for Continued Examination
  IDS = 'IDS',    // Information Disclosure Statement
  IDR = 'IDR',    // Information Disclosure Statement
  PRELIMINARY_AMENDMENT = 'A.P',
  
  // Other
  ISSUE_NOTIFICATION = 'ISS.NTF',
  ABANDONMENT = 'ABND',
}

/**
 * Office action types
 */
export interface OfficeAction extends FileHistoryDocument {
  documentCode: 'CTNF' | 'CTFR' | 'N417' | 'ABEX';
  rejections?: OfficeActionRejection[];
  allowedClaims?: number[];
  rejectedClaims?: number[];
}

export interface OfficeActionRejection {
  claimNumber?: string;
  rejectionType?: string;
  rejectionStatute?: string;  // '102', '103', '112', etc.
  rejectionBasis?: string;
  citedPriorArt?: CitedReference[];
}

export interface CitedReference {
  documentNumber?: string;
  documentKind?: string;
  documentDate?: string;
  documentCountry?: string;
  relevantClaims?: string[];
  citationType?: string;
}

/**
 * Transaction history types
 */
export interface TransactionHistory {
  recordTotalQuantity: number;
  transactions: Transaction[];
}

export interface Transaction {
  transactionDate?: string;
  transactionCode?: string;
  transactionDescription?: string;
  recordedDate?: string;
  transactionCategory?: string;
}

/**
 * Prosecution timeline types
 */
export interface ProsecutionTimeline {
  application: ApplicationBiblio;
  transactions: Transaction[];
  keyDocuments: FileHistoryDocument[];
}

/**
 * Application status types
 */
export interface ApplicationStatus {
  status: string;
  statusCode?: string;
  statusDate: string;
  isPending: boolean;
  isAbandoned: boolean;
  isPatented: boolean;
  isPublished: boolean;
}

/**
 * Statistics types
 */
export interface ProsecutionStatistics {
  totalOfficeActions: number;
  nonFinalRejections: number;
  finalRejections: number;
  allowances: number;
  applicantResponses: number;
  prosecutionDuration: number; // in days
  averageResponseTime: number; // in days
}

/**
 * Assignment types
 */
export interface AssignmentData {
  assignmentId?: string;
  assignorName?: string;
  assigneeName?: string;
  assignmentDate?: string;
  recordedDate?: string;
  assignmentType?: string;
  pageCount?: number;
  reel?: string;
  frame?: string;
}

/**
 * Term adjustment types
 */
export interface TermAdjustment {
  patentTermAdjustment?: number;
  aDelayDays?: number;
  bDelayDays?: number;
  cDelayDays?: number;
  overlapDays?: number;
  ptoDelayDays?: number;
  applicantDelayDays?: number;
}

/**
 * Customer number types
 */
export interface CustomerNumber {
  customerNumber?: string;
  customerName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
}

/**
 * Continuity data types
 */
export interface ContinuityData {
  parentApplications: RelatedApplication[];
  childApplications: RelatedApplication[];
  continuingApplications: RelatedApplication[];
  divisionalApplications: RelatedApplication[];
  continuationInPartApplications: RelatedApplication[];
}

/**
 * Search filter types
 */
export interface ApplicationFilter {
  dateRange?: {
    filingDateFrom?: string;
    filingDateTo?: string;
    issueDateFrom?: string;
    issueDateTo?: string;
  };
  assignee?: string;
  inventor?: string;
  status?: string[];
  technology?: {
    cpc?: string[];
    ipc?: string[];
  };
}

/**
 * Pagination types
 */
export interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalRecords: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Error types
 */
export interface FileWrapperError extends Error {
  statusCode?: number;
  response?: any;
  endpoint?: string;
}

/**
 * Bulk document download types
 */
export interface BulkDownloadRequest {
  applicationNumbers: string[];
  documentCodes?: string[];
  dateRange?: {
    from: string;
    to: string;
  };
}

export interface BulkDownloadResult {
  applicationNumber: string;
  documentsDownloaded: number;
  totalDocuments: number;
  errors: Array<{ documentId: string; error: string }>;
}

/**
 * Analysis types
 */
export interface ProsecutionAnalysis {
  application: ApplicationBiblio;
  timeline: ProsecutionTimeline;
  statistics: ProsecutionStatistics;
  officeActions: OfficeAction[];
  allowanceRate: number;
  rejectionPatterns: RejectionPattern[];
}

export interface RejectionPattern {
  statute: string;
  count: number;
  averageOvercomeTime: number; // in days
  successRate: number; // percentage
}

/**
 * Export types
 */
export interface DocumentExportOptions {
  format: 'pdf' | 'tiff' | 'json';
  includeMetadata?: boolean;
  compressionLevel?: number;
}

/**
 * Type guards
 */
export function isApplicationBiblio(obj: any): obj is ApplicationBiblio {
  return obj && typeof obj.applicationNumber === 'string';
}

export function isFileHistoryDocument(obj: any): obj is FileHistoryDocument {
  return obj && typeof obj.documentIdentifier === 'string';
}

export function isOfficeAction(doc: FileHistoryDocument): doc is OfficeAction {
  return ['CTNF', 'CTFR', 'N417', 'ABEX'].includes(doc.documentCode || '');
}

export function isTransaction(obj: any): obj is Transaction {
  return obj && typeof obj.transactionCode === 'string';
}

/**
 * Helper types
 */
export type DocumentCategory = 'office_action' | 'applicant_response' | 'other';

export interface DocumentCategorization {
  officeActions: FileHistoryDocument[];
  applicantResponses: FileHistoryDocument[];
  other: FileHistoryDocument[];
}

/**
 * Commonly used document code groups
 */
export const OFFICE_ACTION_CODES = ['CTNF', 'CTFR', 'N417', 'ABEX', 'SRFW'] as const;
export const APPLICANT_RESPONSE_CODES = ['A.P', 'RCEX', 'IDS', 'IDR', 'AREF'] as const;
export const ALLOWANCE_CODES = ['N417', 'ISS.NTF'] as const;
export const REJECTION_CODES = ['CTNF', 'CTFR'] as const;
