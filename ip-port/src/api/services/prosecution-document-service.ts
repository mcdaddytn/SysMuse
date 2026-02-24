/**
 * Prosecution Document Service
 *
 * Handles downloading and extracting text from prosecution documents.
 * Hybrid strategy:
 *   1. OA Text API first (pre-extracted text, 12-series filings)
 *   2. PDF download + pdftotext fallback (older patents)
 *
 * Uses existing FileWrapperClient.downloadDocument() for PDF retrieval.
 * Caches both PDFs and extracted text for litigation package export.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  CachedFileWrapperClient,
  createCachedFileWrapperClient,
  CachedOATextClient,
  createCachedOATextClient,
} from '../../../clients/cached-clients.js';
import { FileWrapperClient, createFileWrapperClient } from '../../../clients/odp-file-wrapper-client.js';

const execAsync = promisify(exec);

const DOCUMENT_CACHE_DIR = path.join(process.cwd(), 'cache/prosecution-documents');

/** Office action document codes that contain rejection/allowance information */
const OFFICE_ACTION_CODES = ['CTNF', 'CTFR', 'N417', 'ABEX', 'SRFW'] as const;
const APPLICANT_RESPONSE_CODES = ['A.P', 'RCEX'] as const;

export interface ProsecutionDocument {
  patentId: string;
  applicationNumber: string;
  documentCode: string;
  documentDate: string;
  documentIdentifier: string;
  text: string;
  source: 'api_text' | 'pdf_pdftotext' | 'cached';
  pageCount?: number;
}

export interface DocumentRetrievalResult {
  patentId: string;
  applicationNumber: string;
  officeActions: ProsecutionDocument[];
  applicantResponses: ProsecutionDocument[];
  totalDocuments: number;
  textApiHits: number;
  pdfFallbacks: number;
  errors: string[];
}

/**
 * Retrieve and extract text from all prosecution documents for a patent.
 */
export async function retrieveProsecutionDocuments(
  patentId: string,
  options: {
    includeResponses?: boolean;  // Also retrieve applicant responses (default: true)
    skipExisting?: boolean;      // Skip if text already cached (default: true)
  } = {}
): Promise<DocumentRetrievalResult> {
  const { includeResponses = true, skipExisting = true } = options;
  const result: DocumentRetrievalResult = {
    patentId,
    applicationNumber: '',
    officeActions: [],
    applicantResponses: [],
    totalDocuments: 0,
    textApiHits: 0,
    pdfFallbacks: 0,
    errors: [],
  };

  // Get application info via cached file wrapper client
  const fwClient = createCachedFileWrapperClient();
  const app = await fwClient.getApplicationByPatentNumber(patentId);
  if (!app) {
    result.errors.push(`No application found for patent ${patentId}`);
    return result;
  }
  result.applicationNumber = app.applicationNumber || '';

  // Get document list
  const docsResp = await fwClient.getDocuments(result.applicationNumber);
  const documents = docsResp?.documents || [];

  // Filter to office actions and (optionally) applicant responses
  const targetCodes = new Set<string>([
    ...OFFICE_ACTION_CODES,
    ...(includeResponses ? APPLICANT_RESPONSE_CODES : []),
  ]);
  const targetDocs = documents.filter((d: any) =>
    targetCodes.has(d.documentCode || d.documentCodeDescriptionText || '')
  );

  if (targetDocs.length === 0) {
    return result;
  }

  // Try OA Text API first (for 12-series filings)
  const textClient = createCachedOATextClient();
  let textApiData: Map<string, string> | null = null;

  try {
    const textResp = await textClient.getOfficeActionText(result.applicationNumber);
    if (textResp.totalRecords > 0) {
      textApiData = new Map();
      for (const oa of textResp.officeActions) {
        // Key by date + code to match documents
        const key = `${oa.mailDate}-${oa.documentCode}`;
        textApiData.set(key, oa.text);
      }
    }
  } catch (err) {
    // Text API not available — will fall back to PDF
  }

  // Process each document
  const rawClient = createFileWrapperClient();

  for (const doc of targetDocs) {
    const docCode = doc.documentCode || doc.documentCodeDescriptionText || '';
    const docDate = doc.mailDate || doc.mailRoomDate || '';
    const docId = doc.documentIdentifier || '';

    // Check cache first
    const cacheDir = path.join(DOCUMENT_CACHE_DIR, patentId);
    const textCachePath = path.join(cacheDir, `${docCode}-${docDate}.txt`);

    if (skipExisting && fs.existsSync(textCachePath)) {
      const cachedText = fs.readFileSync(textCachePath, 'utf-8');
      const prosDoc: ProsecutionDocument = {
        patentId,
        applicationNumber: result.applicationNumber,
        documentCode: docCode,
        documentDate: docDate,
        documentIdentifier: docId,
        text: cachedText,
        source: 'cached',
      };

      if (isOfficeAction(docCode)) {
        result.officeActions.push(prosDoc);
      } else {
        result.applicantResponses.push(prosDoc);
      }
      result.totalDocuments++;
      continue;
    }

    // Try Text API data
    const textKey = `${docDate}-${docCode}`;
    if (textApiData?.has(textKey)) {
      const text = textApiData.get(textKey)!;
      const prosDoc: ProsecutionDocument = {
        patentId,
        applicationNumber: result.applicationNumber,
        documentCode: docCode,
        documentDate: docDate,
        documentIdentifier: docId,
        text,
        source: 'api_text',
      };

      // Cache the text
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(textCachePath, text);

      if (isOfficeAction(docCode)) {
        result.officeActions.push(prosDoc);
      } else {
        result.applicantResponses.push(prosDoc);
      }
      result.totalDocuments++;
      result.textApiHits++;
      continue;
    }

    // Fall back to PDF download + pdftotext
    if (!docId) {
      result.errors.push(`No document identifier for ${docCode} ${docDate}`);
      continue;
    }

    try {
      const text = await downloadAndExtractText(
        rawClient,
        result.applicationNumber,
        docId,
        cacheDir,
        docCode,
        docDate
      );

      if (text) {
        const prosDoc: ProsecutionDocument = {
          patentId,
          applicationNumber: result.applicationNumber,
          documentCode: docCode,
          documentDate: docDate,
          documentIdentifier: docId,
          text,
          source: 'pdf_pdftotext',
        };

        if (isOfficeAction(docCode)) {
          result.officeActions.push(prosDoc);
        } else {
          result.applicantResponses.push(prosDoc);
        }
        result.totalDocuments++;
        result.pdfFallbacks++;
      }
    } catch (err: any) {
      result.errors.push(`Failed to download ${docCode} ${docDate}: ${err.message}`);
    }
  }

  return result;
}

/**
 * Download a document PDF and extract text using pdftotext.
 * Keeps original PDF for litigation package export.
 */
async function downloadAndExtractText(
  client: FileWrapperClient,
  applicationNumber: string,
  documentIdentifier: string,
  cacheDir: string,
  docCode: string,
  docDate: string,
): Promise<string | null> {
  fs.mkdirSync(cacheDir, { recursive: true });

  const pdfPath = path.join(cacheDir, `${docCode}-${docDate}.pdf`);
  const textPath = path.join(cacheDir, `${docCode}-${docDate}.txt`);

  // Check if text already extracted
  if (fs.existsSync(textPath)) {
    return fs.readFileSync(textPath, 'utf-8');
  }

  // Download PDF if not already cached
  if (!fs.existsSync(pdfPath)) {
    try {
      const pdfBuffer = await client.downloadDocument(applicationNumber, documentIdentifier);
      fs.writeFileSync(pdfPath, Buffer.from(pdfBuffer));
    } catch (err: any) {
      console.error(`[ProsDoc] Failed to download PDF for ${applicationNumber}/${documentIdentifier}: ${err.message}`);
      return null;
    }
  }

  // Extract text using pdftotext -layout (preserves table structure)
  try {
    await execAsync(`pdftotext -layout "${pdfPath}" "${textPath}"`, { timeout: 30000 });
    if (fs.existsSync(textPath)) {
      return fs.readFileSync(textPath, 'utf-8');
    }
  } catch (err: any) {
    // pdftotext not installed or failed
    console.error(`[ProsDoc] pdftotext failed for ${pdfPath}: ${err.message}`);
    console.error('[ProsDoc] Install poppler: brew install poppler (macOS) or apt-get install poppler-utils (Linux)');
    return null;
  }

  return null;
}

function isOfficeAction(documentCode: string): boolean {
  return (OFFICE_ACTION_CODES as readonly string[]).includes(documentCode);
}

/**
 * Check if pdftotext is available on the system.
 */
export async function checkPdftotextAvailable(): Promise<boolean> {
  try {
    await execAsync('which pdftotext', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
