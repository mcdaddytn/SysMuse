/**
 * Office Action Analysis Types
 *
 * Claim-level prosecution analysis types for the prosecution enrichment pipeline.
 * These extend the existing file-wrapper-types.ts with richer claim-level detail
 * produced by LLM analysis of office action documents.
 */

// ============================================================================
// API Response Types (from USPTO ODP Office Action APIs)
// ============================================================================

/**
 * Response from the USPTO Office Action Rejection API.
 * Structured JSON, no LLM needed — highest priority data source.
 */
export interface OARejectionApiResponse {
  totalRecords: number;
  rejections: OARejectionRecord[];
}

export interface OARejectionRecord {
  applicationNumber: string;
  mailDate: string;
  documentCode: string;          // CTNF, CTFR
  rejectionIdentifier: string;
  statutoryBasis: string;        // '101', '102', '103', '112'
  rejectionType: string;         // 'Anticipation', 'Obviousness', etc.
  claimNumbers: number[];
  citedReferences: OACitedRef[];
}

export interface OACitedRef {
  referenceNumber?: string;
  referenceType?: string;        // 'US Patent', 'Foreign Patent', 'NPL'
  referenceDesignation?: string; // Patent number or NPL citation
  referenceDate?: string;
  relevantClaims?: number[];
}

/**
 * Response from the USPTO Office Action Text API.
 * Extracted text from office actions for LLM analysis.
 */
export interface OATextApiResponse {
  totalRecords: number;
  officeActions: OATextRecord[];
}

export interface OATextRecord {
  applicationNumber: string;
  mailDate: string;
  documentCode: string;
  text: string;                  // Full extracted text
  pageCount?: number;
}

/**
 * Response from the USPTO Enriched Citation API.
 * AI-extracted claim-to-prior-art mapping.
 */
export interface EnrichedCitationApiResponse {
  totalRecords: number;
  citations: EnrichedCitationRecord[];
}

export interface EnrichedCitationRecord {
  applicationNumber: string;
  patentNumber?: string;
  citedReference: string;
  citedReferenceType: string;
  claimMapping: ClaimCitationMapping[];
}

export interface ClaimCitationMapping {
  claimNumber: number;
  citationRelevance: string;     // 'primary', 'secondary'
  citedElements?: string[];      // Specific elements from prior art
}

// ============================================================================
// LLM Analysis Output Types
// ============================================================================

/**
 * Analysis of a single office action (rejection) by LLM.
 */
export interface OfficeActionAnalysis {
  mailDate: string;
  documentCode: string;          // CTNF, CTFR
  actionType: 'non-final' | 'final' | 'advisory' | 'other';

  // Claim-level rejections
  claimRejections: ClaimRejection[];

  // Prior art cited in this action
  citedPriorArt: PriorArtReference[];

  // Examiner reasoning summary
  examinerReasoning: string;

  // Key arguments made by examiner
  keyArguments: string[];

  // Source of analysis
  analysisSource: 'api_structured' | 'api_text_llm' | 'pdf_llm';
}

/**
 * Per-claim rejection detail.
 */
export interface ClaimRejection {
  claimNumber: number;
  isIndependent: boolean;
  statutoryBasis: '101' | '102' | '103' | '112' | 'double-patenting' | 'other';
  rejectionType: string;         // 'anticipation', 'obviousness', 'indefiniteness', etc.

  // Prior art used against this claim
  citedReferences: string[];     // Reference designations

  // Specific claim limitations addressed
  limitationsAddressed?: string[];

  // Whether this rejection was ultimately overcome
  wasOvercome?: boolean;
}

/**
 * Enhanced prior art reference with relevance context.
 */
export interface PriorArtReference {
  designation: string;           // Patent number or NPL citation
  referenceType: 'us-patent' | 'us-publication' | 'foreign-patent' | 'npl';
  title?: string;
  date?: string;

  // Claims this reference was cited against
  relevantClaims: number[];

  // How this reference was used
  citationPurpose: 'primary' | 'secondary' | 'teaching';

  // Brief description of what this reference teaches
  relevanceDescription?: string;
}

/**
 * Analysis of an applicant response (amendment + arguments) by LLM.
 */
export interface ApplicantResponseAnalysis {
  filingDate: string;
  responseType: 'amendment' | 'rce' | 'after-final' | 'appeal-brief' | 'other';

  // Claim amendments made
  claimAmendments: ClaimAmendment[];

  // Arguments presented
  arguments: string[];

  // Estoppel risk from this response
  estoppelRisk: EstoppelAssessment;
}

/**
 * Detail about a claim amendment.
 */
export interface ClaimAmendment {
  claimNumber: number;
  amendmentType: 'narrowed' | 'broadened' | 'cancelled' | 'new' | 'rewritten';

  // What changed
  beforeLanguage?: string;       // Key limitation text before
  afterLanguage?: string;        // Key limitation text after

  // What narrowing was done
  narrowingDescription?: string;

  // Which rejection this amendment addressed
  addressedRejection?: string;   // statutory basis
}

/**
 * Prosecution estoppel assessment for a response.
 */
export interface EstoppelAssessment {
  level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

  // Arguments that could create estoppel
  estoppelArguments: EstoppelArgument[];

  // Summary of estoppel risk
  summary: string;
}

/**
 * A specific argument that creates prosecution estoppel risk.
 */
export interface EstoppelArgument {
  claimNumber: number;
  argumentType: 'narrowing-amendment' | 'distinguishing-argument' | 'disclaimer' | 'admission';

  // What was said or done
  description: string;

  // Impact on claim scope
  scopeImpact: string;

  // Severity
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ============================================================================
// Aggregated Prosecution Timeline Data
// ============================================================================

/**
 * Complete prosecution timeline data for a patent.
 * This is the top-level structure stored in cache/prosecution-analysis/{patentId}.json
 * and in the ProsecutionTimeline DB table (as JSON fields).
 */
export interface ProsecutionTimelineData {
  patentId: string;
  applicationNumber: string;

  // Aggregate metrics
  totalActions: number;
  totalRejections: number;
  totalRCEs: number;
  timeToGrantMonths: number | null;
  prosecutionScore: number;      // 1-5 (5 = clean, 1 = difficult)

  // Detailed analysis
  officeActions: OfficeActionAnalysis[];
  responses: ApplicantResponseAnalysis[];

  // Derived/merged fields
  citedPriorArt: PriorArtReference[];
  narrowedClaims: ClaimAmendment[];
  estoppelArguments: EstoppelArgument[];
  survivedBases: SurvivedBasis[];

  // Metadata
  analyzedAt: string;            // ISO date
  llmModel: string;
  documentCount: number;
  dataSources: Array<'api_structured' | 'api_text_llm' | 'pdf_llm'>;
}

/**
 * A rejection basis that was overcome during prosecution.
 */
export interface SurvivedBasis {
  statutoryBasis: string;
  claimNumbers: number[];
  howOvercome: 'amendment' | 'argument' | 'new-prior-art-distinguished' | 'examiner-withdrawn';
  description: string;
}
