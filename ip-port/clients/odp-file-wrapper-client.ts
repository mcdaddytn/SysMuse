/**
 * USPTO Open Data Portal - File Wrapper API Client
 * 
 * Access patent prosecution history including:
 * - Office actions
 * - Examiner rejections
 * - Applicant responses and amendments
 * - File history documents
 * - Application bibliographic data
 * 
 * API Documentation: https://data.uspto.gov/apis/patent-file-wrapper
 * Requires: USPTO ODP API Key (with ID.me verification)
 */

import { BaseAPIClient, APIConfig, buildQueryString } from './base-client.js';

const ODP_BASE_URL = 'https://api.data.uspto.gov/patent-file-wrapper/v1';

export interface FileWrapperConfig {
  apiKey: string;
}

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

export interface ApplicationBiblioResponse {
  recordTotalQuantity: number;
  pageNumber: number;
  pageSize: number;
  applications: ApplicationBiblio[];
}

export interface ApplicationBiblio {
  applicationNumber: string;
  applicationNumberFormatted?: string;
  patentNumber?: string;
  patentNumberFormatted?: string;
  filingDate?: string;
  inventionTitle?: string;
  applicationStatusDescriptionText?: string;
  
  // Applicants/Assignees
  applicants?: Applicant[];
  
  // Inventors
  inventors?: InventorInfo[];
  
  // Attorneys
  attorneys?: Attorney[];
  
  // Classifications
  cpcClassifications?: CPCClass[];
  ipcClassifications?: IPCClass[];
  
  // Filing details
  applicationTypeCode?: string;
  applicationStatusCode?: string;
  applicationStatusDate?: string;
  
  // Related applications
  parentApplications?: RelatedApplication[];
  childApplications?: RelatedApplication[];
  
  [key: string]: any;
}

export interface Applicant {
  applicantName?: string;
  applicantType?: string;
  applicantSequenceNumber?: number;
}

export interface InventorInfo {
  inventorNameFirst?: string;
  inventorNameLast?: string;
  inventorNameFull?: string;
  inventorSequenceNumber?: number;
  inventorResidenceCity?: string;
  inventorResidenceState?: string;
  inventorResidenceCountry?: string;
}

export interface Attorney {
  attorneyName?: string;
  registrationNumber?: string;
  attorneyDocketNumber?: string;
}

export interface CPCClass {
  cpcSectionCode?: string;
  cpcClassCode?: string;
  cpcSubclassCode?: string;
  cpcGroupCode?: string;
  cpcSubgroupCode?: string;
  cpcFullCode?: string;
}

export interface IPCClass {
  ipcSectionCode?: string;
  ipcClassCode?: string;
  ipcSubclassCode?: string;
  ipcGroupCode?: string;
  ipcSubgroupCode?: string;
}

export interface RelatedApplication {
  applicationNumber?: string;
  patentNumber?: string;
  filingDate?: string;
  relationshipCode?: string;
  relationshipDescription?: string;
}

export interface DocumentsResponse {
  recordTotalQuantity: number;
  documents: FileHistoryDocument[];
}

export interface FileHistoryDocument {
  documentIdentifier?: string;
  documentCode?: string;
  documentCodeDescription?: string;
  mailDate?: string;
  documentUrl?: string;
  documentSize?: number;
  documentType?: string;
  documentPages?: number;
  
  // Office Action specific fields
  isOfficeAction?: boolean;
  actionDate?: string;
  actionType?: string;
  
  [key: string]: any;
}

export interface OfficeActionRejection {
  claimNumber?: string;
  rejectionType?: string;
  rejectionStatute?: string;
  rejectionBasis?: string;
  citedPriorArt?: CitedReference[];
}

export interface CitedReference {
  documentNumber?: string;
  documentKind?: string;
  documentDate?: string;
  documentCountry?: string;
  relevantClaims?: string[];
}

export interface TransactionHistory {
  recordTotalQuantity: number;
  transactions: Transaction[];
}

export interface Transaction {
  transactionDate?: string;
  transactionCode?: string;
  transactionDescription?: string;
  recordedDate?: string;
}

export class FileWrapperClient extends BaseAPIClient {
  constructor(config: FileWrapperConfig) {
    super({
      baseUrl: ODP_BASE_URL,
      apiKey: config.apiKey,
      rateLimit: {
        requestsPerMinute: 60, // Conservative estimate - adjust based on actual limits
      },
      retryAttempts: 3,
      retryDelay: 1000,
    });
  }

  /**
   * Get authentication headers for USPTO ODP API
   */
  private getHeaders(): Record<string, string> {
    return {
      'X-API-Key': this.config.apiKey,
    };
  }

  /**
   * Search for applications by various criteria
   */
  async searchApplications(query: ApplicationSearchQuery): Promise<ApplicationBiblioResponse> {
    const queryString = buildQueryString({
      applicationNumber: query.applicationNumber,
      patentNumber: query.patentNumber,
      filingDateFrom: query.filingDateFrom,
      filingDateTo: query.filingDateTo,
      inventionTitle: query.inventionTitle,
      assignee: query.assignee,
      inventor: query.inventor,
      page: query.page || 0,
      size: query.size || 100,
    });

    const endpoint = `/applications/search?${queryString}`;

    return this.retryRequest(() =>
      this.get<ApplicationBiblioResponse>(endpoint, this.getHeaders())
    );
  }

  /**
   * Get application bibliographic data by application number
   */
  async getApplication(applicationNumber: string): Promise<ApplicationBiblio> {
    // Remove any non-numeric characters from application number
    const cleanAppNumber = applicationNumber.replace(/[^0-9]/g, '');
    
    const endpoint = `/applications/${cleanAppNumber}`;

    return this.retryRequest(() =>
      this.get<ApplicationBiblio>(endpoint, this.getHeaders())
    );
  }

  /**
   * Get all file history documents for an application
   */
  async getDocuments(applicationNumber: string): Promise<DocumentsResponse> {
    const cleanAppNumber = applicationNumber.replace(/[^0-9]/g, '');
    const endpoint = `/applications/${cleanAppNumber}/documents`;

    return this.retryRequest(() =>
      this.get<DocumentsResponse>(endpoint, this.getHeaders())
    );
  }

  /**
   * Download a specific document from file history
   */
  async downloadDocument(
    applicationNumber: string,
    documentIdentifier: string
  ): Promise<ArrayBuffer> {
    const cleanAppNumber = applicationNumber.replace(/[^0-9]/g, '');
    const endpoint = `/applications/${cleanAppNumber}/documents/${documentIdentifier}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout for downloads

    try {
      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        signal: controller.signal,
        headers: this.getHeaders(),
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Failed to download document: ${response.status} ${response.statusText}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Get only office actions from file history
   */
  async getOfficeActions(applicationNumber: string): Promise<FileHistoryDocument[]> {
    const documents = await this.getDocuments(applicationNumber);
    
    // Filter for common office action document codes
    const officeActionCodes = [
      'CTNF', // Non-Final Rejection
      'CTFR', // Final Rejection
      'N417', // Notice of Allowance
      'ABEX', // Examiner's Amendment
      'SRFW', // Examiner Search Report
      // Add more codes as needed
    ];

    return documents.documents.filter(doc =>
      officeActionCodes.includes(doc.documentCode || '')
    );
  }

  /**
   * Get applicant responses and amendments
   */
  async getApplicantResponses(applicationNumber: string): Promise<FileHistoryDocument[]> {
    const documents = await this.getDocuments(applicationNumber);
    
    // Filter for applicant response document codes
    const responseCodes = [
      'A.P', // Amendment/Preliminary Amendment
      'RCEX', // Request for Continued Examination
      'IDR', // Information Disclosure Statement
      'IDS', // Information Disclosure Statement
      'AREF', // Response to Examination Report
      // Add more codes as needed
    ];

    return documents.documents.filter(doc =>
      responseCodes.includes(doc.documentCode || '')
    );
  }

  /**
   * Get transaction history for an application
   */
  async getTransactions(applicationNumber: string): Promise<TransactionHistory> {
    const cleanAppNumber = applicationNumber.replace(/[^0-9]/g, '');
    const endpoint = `/applications/${cleanAppNumber}/transactions`;

    return this.retryRequest(() =>
      this.get<TransactionHistory>(endpoint, this.getHeaders())
    );
  }

  /**
   * Get prosecution timeline - combines transactions and key documents
   */
  async getProsecutionTimeline(applicationNumber: string): Promise<{
    application: ApplicationBiblio;
    transactions: Transaction[];
    keyDocuments: FileHistoryDocument[];
  }> {
    const [application, transactionData, documents] = await Promise.all([
      this.getApplication(applicationNumber),
      this.getTransactions(applicationNumber),
      this.getDocuments(applicationNumber),
    ]);

    // Filter for key documents (office actions, responses, allowances)
    const keyDocumentCodes = [
      'CTNF', 'CTFR', 'N417', 'A.P', 'RCEX', 'IDR', 'IDS', 'ABEX', 'SRFW'
    ];

    const keyDocuments = documents.documents.filter(doc =>
      keyDocumentCodes.includes(doc.documentCode || '')
    );

    return {
      application,
      transactions: transactionData.transactions,
      keyDocuments,
    };
  }

  /**
   * Search applications by assignee name
   */
  async searchByAssignee(
    assigneeName: string,
    filingDateFrom?: string,
    filingDateTo?: string
  ): Promise<ApplicationBiblioResponse> {
    return this.searchApplications({
      assignee: assigneeName,
      filingDateFrom,
      filingDateTo,
    });
  }

  /**
   * Get application by patent number
   */
  async getApplicationByPatentNumber(patentNumber: string): Promise<ApplicationBiblio | null> {
    const response = await this.searchApplications({
      patentNumber: patentNumber.replace(/[^0-9]/g, ''),
    });

    return response.applications.length > 0 ? response.applications[0] : null;
  }

  /**
   * Check application status
   */
  async getApplicationStatus(applicationNumber: string): Promise<{
    status: string;
    statusDate: string;
    isPending: boolean;
    isAbandoned: boolean;
    isPatented: boolean;
  }> {
    const app = await this.getApplication(applicationNumber);

    const status = app.applicationStatusDescriptionText || app.applicationStatusCode || 'Unknown';
    const statusDate = app.applicationStatusDate || '';

    return {
      status,
      statusDate,
      isPending: status.toLowerCase().includes('pending'),
      isAbandoned: status.toLowerCase().includes('abandon'),
      isPatented: !!app.patentNumber,
    };
  }

  /**
   * Paginated search through applications
   */
  async *searchPaginated(
    query: ApplicationSearchQuery,
    pageSize: number = 100
  ): AsyncGenerator<ApplicationBiblio[], void, unknown> {
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.searchApplications({
        ...query,
        page,
        size: pageSize,
      });

      if (response.applications.length === 0) {
        break;
      }

      yield response.applications;

      // Check if we've retrieved all results
      const totalRetrieved = (page + 1) * pageSize;
      hasMore = totalRetrieved < response.recordTotalQuantity;
      page++;
    }
  }
}

// Helper function to create client from environment
export function createFileWrapperClient(): FileWrapperClient {
  const apiKey = process.env.USPTO_ODP_API_KEY;
  
  if (!apiKey) {
    throw new Error('USPTO_ODP_API_KEY environment variable is required');
  }

  return new FileWrapperClient({ apiKey });
}
