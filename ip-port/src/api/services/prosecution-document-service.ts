/**
 * Prosecution Document Service
 *
 * Handles retrieving text from prosecution documents.
 * Hybrid strategy (in priority order):
 *   1. DS-API OA Text (pre-extracted text, no document listing needed)
 *   2. ODP File Wrapper document listing + PDF download + pdftotext (older patents)
 *
 * Application number resolution: ODP search → prosecution-scores cache fallback.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  createCachedFileWrapperClient,
  createCachedOATextClient,
} from '../../../clients/cached-clients.js';
import { FileWrapperClient, createFileWrapperClient } from '../../../clients/odp-file-wrapper-client.js';

const execAsync = promisify(exec);

const DOCUMENT_CACHE_DIR = path.join(process.cwd(), 'cache/prosecution-documents');
const PROSECUTION_SCORES_DIR = path.join(process.cwd(), 'cache/prosecution-scores');

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
 * Resolve patent number → application number.
 * Tries ODP API first, then falls back to prosecution-scores cache.
 */
async function resolveApplicationNumber(patentId: string): Promise<string | null> {
  // Strategy 1: ODP API search
  try {
    const fwClient = createCachedFileWrapperClient();
    const app = await fwClient.getApplicationByPatentNumber(patentId);
    const appNum = app?.applicationNumberText || app?.applicationNumber || '';
    if (appNum) return appNum;
  } catch {
    // ODP search failed — try cache
  }

  // Strategy 2: prosecution-scores cache (already has app numbers from prior enrichment)
  const scoreCachePath = path.join(PROSECUTION_SCORES_DIR, `${patentId}.json`);
  if (fs.existsSync(scoreCachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(scoreCachePath, 'utf-8'));
      const appNum = data.application_number || data.applicationNumber || '';
      if (appNum) return appNum;
    } catch {
      // Corrupted cache
    }
  }

  // Strategy 3: file-wrapper API cache
  const fwCachePath = path.join(process.cwd(), 'cache/api/file-wrapper', `${patentId}.json`);
  if (fs.existsSync(fwCachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(fwCachePath, 'utf-8'));
      const appNum = data.applicationNumberText || data.applicationNumber || data.application_number || '';
      if (appNum) return appNum;
    } catch {
      // Corrupted cache
    }
  }

  return null;
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

  // Resolve application number
  const appNumber = await resolveApplicationNumber(patentId);
  if (!appNumber) {
    result.errors.push(`No application number found for patent ${patentId}`);
    return result;
  }
  result.applicationNumber = appNumber;

  // ─── Primary path: DS-API OA Text (no document listing needed) ───────────
  const textClient = createCachedOATextClient();

  try {
    const textResp = await textClient.getOfficeActionText(appNumber);
    if (textResp.totalRecords > 0) {
      for (const oa of textResp.officeActions) {
        if (!oa.text || oa.text.length < 50) continue;

        const docCode = oa.documentCode || '';
        const prosDoc: ProsecutionDocument = {
          patentId,
          applicationNumber: appNumber,
          documentCode: docCode,
          documentDate: oa.mailDate || '',
          documentIdentifier: '',
          text: oa.text,
          source: 'api_text',
          pageCount: oa.pageCount,
        };

        if (isOfficeAction(docCode)) {
          result.officeActions.push(prosDoc);
        } else if (isApplicantResponse(docCode) && includeResponses) {
          result.applicantResponses.push(prosDoc);
        } else {
          // Unknown code — include as office action if it has substantial text
          result.officeActions.push(prosDoc);
        }
        result.totalDocuments++;
        result.textApiHits++;
      }

      // Cache text files for future use
      if (result.totalDocuments > 0) {
        const cacheDir = path.join(DOCUMENT_CACHE_DIR, patentId);
        fs.mkdirSync(cacheDir, { recursive: true });
        for (const doc of [...result.officeActions, ...result.applicantResponses]) {
          const textCachePath = path.join(cacheDir, `${doc.documentCode}-${doc.documentDate}.txt`);
          if (!fs.existsSync(textCachePath)) {
            fs.writeFileSync(textCachePath, doc.text);
          }
        }
      }

      // If we got text API data, return it (no need for document listing)
      if (result.officeActions.length > 0) {
        return result;
      }
    }
  } catch (err: any) {
    // DS-API text not available — fall through to document listing + PDF path
    result.errors.push(`OA Text API: ${err.message || err}`);
  }

  // ─── Fallback path: ODP document listing + PDF download ──────────────────
  try {
    const fwClient = createCachedFileWrapperClient();
    const docsResp = await fwClient.getDocuments(appNumber);
    const documents = docsResp?.documents || [];

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
          applicationNumber: appNumber,
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

      // PDF download + pdftotext
      if (!docId) {
        result.errors.push(`No document identifier for ${docCode} ${docDate}`);
        continue;
      }

      try {
        const text = await downloadAndExtractText(
          rawClient, appNumber, docId, cacheDir, docCode, docDate
        );
        if (text) {
          const prosDoc: ProsecutionDocument = {
            patentId,
            applicationNumber: appNumber,
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
  } catch (err: any) {
    // Document listing failed (403, etc.) — we already tried DS-API text above
    if (result.officeActions.length === 0) {
      result.errors.push(`Document listing unavailable: ${err.message || err}`);
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
    console.error(`[ProsDoc] pdftotext failed for ${pdfPath}: ${err.message}`);
    return null;
  }

  return null;
}

function isOfficeAction(documentCode: string): boolean {
  return (OFFICE_ACTION_CODES as readonly string[]).includes(documentCode);
}

function isApplicantResponse(documentCode: string): boolean {
  return (APPLICANT_RESPONSE_CODES as readonly string[]).includes(documentCode);
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
