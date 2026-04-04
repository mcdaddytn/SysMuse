/**
 * USPTO Patent XML Extractor
 *
 * Extracts individual patent XML files from USPTO bulk data ZIP archives.
 * Ported from Java USPTOPatentExtractor.java — same logic, pure TypeScript.
 *
 * Data flow:
 *   Patent ID + grant date
 *     → find publication Tuesday
 *     → locate weekly ZIP (ipgYYMMDD.zip) in bulkdata/{year}/
 *     → extract large XML from ZIP (if not already extracted)
 *     → scan XML for matching patents (split on <?xml declarations)
 *     → save individual US{patentId}.xml to export directory
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { Entry, Parse as unzipParse } from 'unzipper';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration from environment
// ─────────────────────────────────────────────────────────────────────────────

function getBulkDataDir(): string {
  // Bulk ZIPs live at <root>/bulkdata/{year}/ipgYYMMDD.zip
  // The env var points to the export dir; bulk data is a sibling
  const exportDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
  if (!exportDir) throw new Error('USPTO_PATENT_GRANT_XML_DIR not set');
  // exportDir = /Volumes/GLSSD2/data/uspto/export → bulkdata = /Volumes/GLSSD2/data/uspto/bulkdata
  return path.join(path.dirname(exportDir), 'bulkdata');
}

function getExportDir(): string {
  const dir = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
  if (!dir) throw new Error('USPTO_PATENT_GRANT_XML_DIR not set');
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractionRequest {
  patentId: string;
  grantDate: string; // yyyy-MM-dd or M/d/yyyy
}

export interface ExtractionResult {
  totalRequested: number;
  extracted: number;
  alreadyExist: number;
  notFound: number;
  errors: string[];
  weeklyBreakdown: Array<{
    zipFile: string;
    patentCount: number;
    extracted: number;
    alreadyExist: number;
    notFound: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseGrantDate(dateStr: string): Date {
  // Try yyyy-MM-dd first (from PatentsView)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(dateStr + 'T00:00:00');
  }
  // Try M/d/yyyy variants
  const mdyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    return new Date(`${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}T00:00:00`);
  }
  throw new Error(`Cannot parse date: ${dateStr}`);
}

function findPublicationTuesday(grantDate: Date): Date {
  const day = grantDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (day === 2) return grantDate; // Already Tuesday

  // Go to Monday of this week, then +1 for Tuesday
  const diff = (day === 0) ? -5 : (1 - day); // Days to get to Monday
  const monday = new Date(grantDate);
  monday.setDate(monday.getDate() + diff);
  const tuesday = new Date(monday);
  tuesday.setDate(tuesday.getDate() + 1);
  return tuesday;
}

function generateWeekFilename(tuesday: Date): string {
  const year = tuesday.getFullYear();
  if (year < 2005) throw new Error(`Patents before 2005 not supported (got ${year})`);

  const yy = String(year % 100).padStart(2, '0');
  const mm = String(tuesday.getMonth() + 1).padStart(2, '0');
  const dd = String(tuesday.getDate()).padStart(2, '0');
  return `ipg${yy}${mm}${dd}.zip`;
}

function yearFromFilename(filename: string): number {
  const yy = parseInt(filename.substring(3, 5), 10);
  return yy >= 76 ? 1900 + yy : 2000 + yy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Patent number normalization
// ─────────────────────────────────────────────────────────────────────────────

function normalizeDocNumber(docNumber: string): string {
  // Remove letter prefixes and leading zeros: D0973298 → 973298, 09093979 → 9093979
  return docNumber.replace(/^[A-Z]+0*/i, '').replace(/^0+/, '');
}

/**
 * Find the XML file for a patent ID, handling the zero-padding mismatch.
 * The bulk XML uses raw doc-numbers (e.g., "09959345") while DB patent IDs
 * strip leading zeros (e.g., "9959345"). Check both variants.
 * Returns the found path or null.
 */
export function findPatentXmlPath(exportDir: string, patentId: string): string | null {
  const basePath = path.join(exportDir, `US${patentId}.xml`);
  if (fs.existsSync(basePath)) return basePath;
  // Try zero-padded to 8 digits (common USPTO format for patents < 10M)
  if (patentId.length < 8) {
    const padded = patentId.padStart(8, '0');
    const paddedPath = path.join(exportDir, `US${padded}.xml`);
    if (fs.existsSync(paddedPath)) return paddedPath;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP / XML extraction
// ─────────────────────────────────────────────────────────────────────────────

function findZipFile(bulkDataDir: string, filename: string): string | null {
  const year = yearFromFilename(filename);

  // Check year subdirectory first
  const yearPath = path.join(bulkDataDir, String(year), filename);
  if (fs.existsSync(yearPath)) return yearPath;

  // Check base directory
  const basePath = path.join(bulkDataDir, filename);
  if (fs.existsSync(basePath)) return basePath;

  return null;
}

/**
 * Extract the large XML from a weekly ZIP.
 * Creates a directory next to the ZIP (e.g., ipg250902/) containing ipg250902.xml.
 * Returns path to the extracted XML. Reuses existing extraction if present.
 */
async function extractXmlFromZip(zipPath: string): Promise<string> {
  const zipDir = path.dirname(zipPath);
  const baseName = path.basename(zipPath, '.zip');
  const extractDir = path.join(zipDir, baseName);
  const xmlPath = path.join(extractDir, baseName + '.xml');

  // Reuse existing extraction
  if (fs.existsSync(xmlPath) && fs.statSync(xmlPath).size > 0) {
    return xmlPath;
  }

  fs.mkdirSync(extractDir, { recursive: true });

  // Stream-extract: find the .xml entry in the ZIP
  return new Promise<string>((resolve, reject) => {
    const zipStream = createReadStream(zipPath).pipe(unzipParse());

    zipStream.on('entry', async (entry: Entry) => {
      if (entry.path.endsWith('.xml')) {
        await pipeline(entry, createWriteStream(xmlPath));
        // We found the XML — close the zip stream
        zipStream.destroy();
        resolve(xmlPath);
      } else {
        entry.autodrain();
      }
    });

    zipStream.on('error', reject);
    zipStream.on('close', () => {
      if (!fs.existsSync(xmlPath)) {
        reject(new Error(`No XML found in ZIP: ${zipPath}`));
      }
    });
  });
}

/**
 * Extract doc-number from a patent XML chunk.
 * Looks for <doc-number> within <publication-reference>.
 */
function extractDocNumber(patentXml: string): string | null {
  const pubRefIdx = patentXml.indexOf('<publication-reference');
  if (pubRefIdx === -1) return null;

  const section = patentXml.substring(pubRefIdx, Math.min(pubRefIdx + 1000, patentXml.length));
  const startTag = '<doc-number>';
  const endTag = '</doc-number>';
  const startIdx = section.indexOf(startTag);
  if (startIdx === -1) return null;
  const endIdx = section.indexOf(endTag, startIdx);
  if (endIdx === -1) return null;

  return section.substring(startIdx + startTag.length, endIdx).trim();
}

/**
 * Scan a large weekly XML file and extract individual patent XMLs for target patents.
 * Uses readline for line-by-line processing — never holds more than one patent in memory.
 * Handles files of any size (tested with 1GB+ USPTO weekly XMLs).
 * The bulk XML is multiple XML documents concatenated — split on <?xml declarations.
 */
async function extractIndividualPatents(
  xmlPath: string,
  targetPatentIds: Set<string>,
  exportDir: string,
): Promise<{ extracted: string[]; alreadyExist: string[] }> {
  const extracted: string[] = [];
  const alreadyExist: string[] = [];

  return new Promise((resolve, reject) => {
    const stream = createReadStream(xmlPath);
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    // For target patents: accumulate full content for writing to disk.
    // For non-targets: stop accumulating after header check to save memory.
    let patentLines: string[] | null = null;
    let header = '';
    let headerChecked = false;
    let isTarget = false;
    let targetDocNumber = '';

    function flushPatent() {
      if (isTarget && patentLines && patentLines.length > 0) {
        const docNumber = targetDocNumber;
        const normalized = normalizeDocNumber(docNumber);
        // Write using raw doc-number (preserves original), but also check normalized path
        const outputPath = path.join(exportDir, `US${docNumber}.xml`);
        const normalizedPath = path.join(exportDir, `US${normalized}.xml`);
        if (fs.existsSync(outputPath) || fs.existsSync(normalizedPath)) {
          alreadyExist.push(normalized);
        } else {
          fs.writeFileSync(outputPath, patentLines.join('\n'), 'utf-8');
          extracted.push(normalized);
        }
        targetPatentIds.delete(normalized);
        targetPatentIds.delete(docNumber);
      }
      patentLines = null;
      header = '';
      headerChecked = false;
      isTarget = false;
      targetDocNumber = '';
    }

    rl.on('line', (line: string) => {
      // Detect patent boundary: new <?xml declaration
      if (line.startsWith('<?xml')) {
        flushPatent();

        if (targetPatentIds.size === 0) {
          rl.close();
          stream.destroy();
          return;
        }

        // Start new patent
        patentLines = [line];
        header = line + '\n';
        return;
      }

      // Skip lines if we determined this patent is not a target
      if (patentLines === null) return;

      // If already confirmed target, just accumulate lines
      if (isTarget) {
        patentLines.push(line);
        return;
      }

      // Still checking header — accumulate until we can determine target status
      if (!headerChecked) {
        patentLines.push(line);
        header += line + '\n';

        if (header.length >= 1500 || header.includes('</publication-reference>')) {
          headerChecked = true;
          const docNumber = extractDocNumber(header);
          if (docNumber) {
            const normalized = normalizeDocNumber(docNumber);
            if (targetPatentIds.has(normalized) || targetPatentIds.has(docNumber)) {
              isTarget = true;
              targetDocNumber = docNumber;
              return;
            }
          }
          // Not a target — stop accumulating
          patentLines = null;
        }
      }
    });

    rl.on('close', () => {
      flushPatent();
      resolve({ extracted, alreadyExist });
    });

    rl.on('error', reject);
    stream.on('error', (err) => {
      rl.close();
      reject(err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main extraction function
// ─────────────────────────────────────────────────────────────────────────────

export async function extractPatentXmls(
  requests: ExtractionRequest[],
  progressCallback?: (message: string) => void,
): Promise<ExtractionResult> {
  const bulkDataDir = getBulkDataDir();
  const exportDir = getExportDir();
  const log = progressCallback || (() => {});

  // Skip patents whose XML already exists (check both padded and unpadded filenames)
  const needsExtraction: ExtractionRequest[] = [];
  let preExisting = 0;
  for (const req of requests) {
    if (findPatentXmlPath(exportDir, req.patentId)) {
      preExisting++;
    } else {
      needsExtraction.push(req);
    }
  }

  log(`${requests.length} patents total, ${preExisting} already have XML, ${needsExtraction.length} need extraction`);

  // Group by publication week
  const weekToPatents = new Map<string, string[]>();
  const skipped: string[] = [];

  for (const req of needsExtraction) {
    try {
      const grantDate = parseGrantDate(req.grantDate);
      const tuesday = findPublicationTuesday(grantDate);
      const weekFilename = generateWeekFilename(tuesday);

      const list = weekToPatents.get(weekFilename) || [];
      list.push(req.patentId);
      weekToPatents.set(weekFilename, list);
    } catch (err) {
      skipped.push(`${req.patentId}: ${(err as Error).message}`);
    }
  }

  log(`Organized into ${weekToPatents.size} weekly ZIP files`);

  // Process each week
  const result: ExtractionResult = {
    totalRequested: requests.length,
    extracted: 0,
    alreadyExist: preExisting,
    notFound: 0,
    errors: [...skipped],
    weeklyBreakdown: [],
  };

  const sortedWeeks = [...weekToPatents.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let weekNum = 0;

  for (const [weekFilename, patentIds] of sortedWeeks) {
    weekNum++;
    log(`[${weekNum}/${sortedWeeks.length}] ${weekFilename} (${patentIds.length} patents)`);

    const weekResult = {
      zipFile: weekFilename,
      patentCount: patentIds.length,
      extracted: 0,
      alreadyExist: 0,
      notFound: 0,
    };

    try {
      // Find the ZIP
      const zipPath = findZipFile(bulkDataDir, weekFilename);
      if (!zipPath) {
        log(`  ZIP not found: ${weekFilename}`);
        weekResult.notFound = patentIds.length;
        result.notFound += patentIds.length;
        result.errors.push(`ZIP not found: ${weekFilename} (${patentIds.length} patents)`);
        result.weeklyBreakdown.push(weekResult);
        continue;
      }

      // Extract the large XML from ZIP (or reuse existing)
      log(`  Extracting XML from ZIP...`);
      const xmlPath = await extractXmlFromZip(zipPath);
      const xmlSize = (fs.statSync(xmlPath).size / (1024 * 1024)).toFixed(1);
      log(`  XML ready: ${xmlSize} MB`);

      // Scan and extract individual patents
      const targetSet = new Set(patentIds.map(normalizeDocNumber));
      // Also add raw IDs for matching
      for (const id of patentIds) targetSet.add(id);

      const { extracted, alreadyExist } = await extractIndividualPatents(xmlPath, targetSet, exportDir);

      weekResult.extracted = extracted.length;
      weekResult.alreadyExist = alreadyExist.length;
      weekResult.notFound = patentIds.length - extracted.length - alreadyExist.length;

      result.extracted += extracted.length;
      result.alreadyExist += alreadyExist.length;
      result.notFound += weekResult.notFound;

      log(`  Extracted: ${extracted.length}, already exist: ${alreadyExist.length}, not found: ${weekResult.notFound}`);
    } catch (err) {
      const msg = `Error processing ${weekFilename}: ${(err as Error).message}`;
      log(`  ${msg}`);
      result.errors.push(msg);
      weekResult.notFound = patentIds.length;
      result.notFound += patentIds.length;
    }

    result.weeklyBreakdown.push(weekResult);
  }

  log(`Done: ${result.extracted} extracted, ${result.alreadyExist} already existed, ${result.notFound} not found`);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-based extraction (used by import pipeline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract patent XMLs using xml_source keys from the index database.
 * Bypasses the grant date → publication Tuesday computation entirely.
 *
 * @param sourceToPatentIds Map of xmlSource (e.g. "ipg240102") → patent IDs
 */
export async function extractPatentXmlsBySource(
  sourceToPatentIds: Map<string, string[]>,
  progressCallback?: (message: string) => void,
): Promise<ExtractionResult> {
  const bulkDataDir = getBulkDataDir();
  const exportDir = getExportDir();
  const log = progressCallback || (() => {});

  // Count totals and filter out patents whose XML already exists
  let totalRequested = 0;
  let preExisting = 0;
  const filteredMap = new Map<string, string[]>();

  for (const [source, patentIds] of sourceToPatentIds) {
    totalRequested += patentIds.length;
    const needsExtraction: string[] = [];
    for (const id of patentIds) {
      if (findPatentXmlPath(exportDir, id)) {
        preExisting++;
      } else {
        needsExtraction.push(id);
      }
    }
    if (needsExtraction.length > 0) {
      filteredMap.set(source, needsExtraction);
    }
  }

  log(`${totalRequested} patents total, ${preExisting} already have XML, ${totalRequested - preExisting} need extraction`);
  log(`Organized into ${filteredMap.size} weekly ZIP files`);

  const result: ExtractionResult = {
    totalRequested,
    extracted: 0,
    alreadyExist: preExisting,
    notFound: 0,
    errors: [],
    weeklyBreakdown: [],
  };

  const sortedSources = [...filteredMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let weekNum = 0;

  for (const [xmlSource, patentIds] of sortedSources) {
    weekNum++;
    const zipFilename = `${xmlSource}.zip`;
    log(`[${weekNum}/${sortedSources.length}] ${zipFilename} (${patentIds.length} patents)`);

    const weekResult = {
      zipFile: zipFilename,
      patentCount: patentIds.length,
      extracted: 0,
      alreadyExist: 0,
      notFound: 0,
    };

    try {
      const zipPath = findZipFile(bulkDataDir, zipFilename);
      if (!zipPath) {
        log(`  ZIP not found: ${zipFilename}`);
        weekResult.notFound = patentIds.length;
        result.notFound += patentIds.length;
        result.errors.push(`ZIP not found: ${zipFilename} (${patentIds.length} patents)`);
        result.weeklyBreakdown.push(weekResult);
        continue;
      }

      log(`  Extracting XML from ZIP...`);
      const xmlPath = await extractXmlFromZip(zipPath);
      const xmlSize = (fs.statSync(xmlPath).size / (1024 * 1024)).toFixed(1);
      log(`  XML ready: ${xmlSize} MB`);

      // Build target set with both raw and normalized IDs
      const targetSet = new Set(patentIds.map(normalizeDocNumber));
      for (const id of patentIds) targetSet.add(id);

      const { extracted, alreadyExist } = await extractIndividualPatents(xmlPath, targetSet, exportDir);

      weekResult.extracted = extracted.length;
      weekResult.alreadyExist = alreadyExist.length;
      weekResult.notFound = patentIds.length - extracted.length - alreadyExist.length;

      result.extracted += extracted.length;
      result.alreadyExist += alreadyExist.length;
      result.notFound += weekResult.notFound;

      log(`  Extracted: ${extracted.length}, already exist: ${alreadyExist.length}, not found: ${weekResult.notFound}`);
    } catch (err) {
      const msg = `Error processing ${zipFilename}: ${(err as Error).message}`;
      log(`  ${msg}`);
      result.errors.push(msg);
      weekResult.notFound = patentIds.length;
      result.notFound += patentIds.length;
    }

    result.weeklyBreakdown.push(weekResult);
  }

  log(`Done: ${result.extracted} extracted, ${result.alreadyExist} already existed, ${result.notFound} not found`);
  return result;
}
