/**
 * Bulk Patent Search Service
 *
 * Searches USPTO bulk grant XML files by assignee pattern, yielding results
 * compatible with the PatentsView import format. Replaces PatentsView API
 * (shut down March 2026) with local bulk data search.
 *
 * Scans weekly XML files from most recent backwards, streaming each file
 * line-by-line for memory efficiency (~1GB per file).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types (PatentsView-compatible output)
// ---------------------------------------------------------------------------

export interface BulkPatentResult {
  patent_id: string;
  patent_title: string;
  patent_abstract: string | null;
  patent_date: string | null;        // YYYY-MM-DD
  patent_type: string | null;
  patent_num_times_cited_by_us_patents: number;
  assignees: Array<{ assignee_organization: string }>;
  inventors: Array<{ inventor_name_first: string; inventor_name_last: string }>;
  cpc_current: Array<{ cpc_group_id: string; cpc_subgroup_id: string }>;
  application: Array<{ filing_date: string }>;
}

export interface BulkSearchOptions {
  /** Assignee patterns to match (case-insensitive contains) */
  patterns: string[];
  /** Optional CPC prefix filters */
  cpcPrefixes?: string[];
  /** Maximum patents to return */
  maxPatents: number;
  /** Start year (search backwards from here). Default: current year */
  startYear?: number;
  /** End year (stop searching at this year). Default: 2005 */
  endYear?: number;
  /** Progress callback */
  onProgress?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BULKDATA_DIR = process.env.USPTO_PATENT_GRANT_XML_DIR
  ? path.resolve(process.env.USPTO_PATENT_GRANT_XML_DIR, '..', 'bulkdata')
  : '';

/** Return the resolved BULKDATA_DIR path (may be empty if env var is unset). */
export function getBulkDataDir(): string {
  return BULKDATA_DIR;
}

export function formatXmlDate(yyyymmdd: string): string | null {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/**
 * Get all weekly XML files sorted most-recent-first for the given year range.
 */
export function getWeeklyXmlFiles(startYear: number, endYear: number): Array<{ year: number; zipPath: string; dirPath: string; xmlName: string }> {
  const files: Array<{ year: number; zipPath: string; dirPath: string; xmlName: string }> = [];

  for (let year = startYear; year >= endYear; year--) {
    const yearDir = path.join(BULKDATA_DIR, String(year));
    if (!fs.existsSync(yearDir)) continue;

    const entries = fs.readdirSync(yearDir)
      .filter(f => f.match(/^ipg\d{6}\.zip$/))
      .sort()
      .reverse(); // most recent first within each year

    for (const zipFile of entries) {
      const baseName = zipFile.replace('.zip', '');
      files.push({
        year,
        zipPath: path.join(yearDir, zipFile),
        dirPath: path.join(yearDir, baseName),
        xmlName: baseName,
      });
    }
  }

  return files;
}

/**
 * Ensure a weekly XML is extracted from its ZIP. Returns path to the large XML.
 */
export function ensureExtracted(file: { zipPath: string; dirPath: string; xmlName: string }): string | null {
  const xmlPath = path.join(file.dirPath, `${file.xmlName}.xml`);

  // Already extracted
  if (fs.existsSync(xmlPath)) return xmlPath;

  // Need to extract
  if (!fs.existsSync(file.zipPath)) return null;

  if (!fs.existsSync(file.dirPath)) {
    fs.mkdirSync(file.dirPath, { recursive: true });
  }

  try {
    // Extract the single large XML from the ZIP
    execSync(`unzip -o "${file.zipPath}" -d "${file.dirPath}"`, {
      timeout: 120000,
      stdio: 'pipe',
    });
  } catch {
    return null;
  }

  // The extracted file may have a slightly different name
  if (fs.existsSync(xmlPath)) return xmlPath;

  // Look for any .xml file in the directory
  const xmlFiles = fs.readdirSync(file.dirPath).filter(f => f.endsWith('.xml'));
  return xmlFiles.length > 0 ? path.join(file.dirPath, xmlFiles[0]) : null;
}

/**
 * Check if an organization name matches any assignee pattern.
 * Short patterns (<=8 chars) require exact match; longer patterns use contains.
 */
export function matchesAssigneePattern(org: string, patterns: string[]): boolean {
  const orgLower = org.toLowerCase();
  return patterns.some(p => {
    const patLower = p.toLowerCase();
    if (p.length <= 8) return orgLower === patLower;
    return orgLower.includes(patLower);
  });
}

/**
 * Parse a single patent XML block (the text between <?xml ...> markers)
 * and return a BulkPatentResult if it matches an assignee pattern.
 */
function parsePatentBlock(xmlText: string, patterns: string[], cpcPrefixes?: string[]): BulkPatentResult | null {
  // Quick pre-check: does ANY assignee pattern appear in this block?
  const xmlLower = xmlText.toLowerCase();
  const matchedPattern = patterns.find(p => xmlLower.includes(p.toLowerCase()));
  if (!matchedPattern) return null;

  // Extract key fields with simple regex (faster than full XML parsing for streaming)
  const docNumber = xmlText.match(/<publication-reference>\s*<document-id>\s*<country>[^<]*<\/country>\s*<doc-number>([^<]+)<\/doc-number>/s)?.[1];
  if (!docNumber) return null;

  // Normalize patent ID (strip leading zeros)
  const patentId = docNumber.replace(/^0+/, '');

  const grantDate = xmlText.match(/<publication-reference>\s*<document-id>[^]*?<date>(\d{8})<\/date>\s*<\/document-id>/s)?.[1];
  const filingDate = xmlText.match(/<application-reference[^>]*>\s*<document-id>[^]*?<date>(\d{8})<\/date>\s*<\/document-id>/s)?.[1];
  const title = xmlText.match(/<invention-title[^>]*>([^<]+)<\/invention-title>/)?.[1]?.trim();

  // Extract abstract text (may have multiple <p> tags)
  const abstractMatch = xmlText.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/);
  let abstractText: string | null = null;
  if (abstractMatch) {
    abstractText = abstractMatch[1]
      .replace(/<[^>]+>/g, ' ')  // strip tags
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Extract assignee organizations
  const assignees: Array<{ assignee_organization: string }> = [];
  const assigneeRegex = /<assignee>\s*<addressbook>\s*<orgname>([^<]+)<\/orgname>/gs;
  let m;
  while ((m = assigneeRegex.exec(xmlText)) !== null) {
    assignees.push({ assignee_organization: m[1].trim() });
  }

  // Verify actual assignee match against ALL patterns (not just the pre-check one).
  if (!assignees.some(a => matchesAssigneePattern(a.assignee_organization, patterns))) return null;

  // Extract CPC codes
  const cpcCodes: Array<{ cpc_group_id: string; cpc_subgroup_id: string }> = [];
  const cpcRegex = /<classification-cpc>[\s\S]*?<section>([^<]+)<\/section>\s*<class>([^<]+)<\/class>\s*<subclass>([^<]+)<\/subclass>\s*<main-group>([^<]+)<\/main-group>\s*<subgroup>([^<]+)<\/subgroup>/gs;
  while ((m = cpcRegex.exec(xmlText)) !== null) {
    const groupId = `${m[1]}${m[2]}${m[3]}${m[4]}`;     // e.g., "H05K7"
    const subgroupId = `${groupId}/${m[5]}`;               // e.g., "H05K7/2089"
    cpcCodes.push({ cpc_group_id: groupId, cpc_subgroup_id: subgroupId });
  }

  // CPC prefix filter
  if (cpcPrefixes?.length) {
    const hasCpcMatch = cpcCodes.some(c =>
      cpcPrefixes.some(prefix => c.cpc_group_id.startsWith(prefix) || c.cpc_subgroup_id.startsWith(prefix))
    );
    if (!hasCpcMatch) return null;
  }

  // Extract inventors
  const inventors: Array<{ inventor_name_first: string; inventor_name_last: string }> = [];
  const inventorRegex = /<applicant[^>]*app-type="applicant-inventor"[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
  while ((m = inventorRegex.exec(xmlText)) !== null) {
    inventors.push({ inventor_name_last: m[1].trim(), inventor_name_first: m[2].trim() });
  }
  // Fallback: some newer XMLs use <inventor> tags
  if (inventors.length === 0) {
    const invRegex2 = /<inventor[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
    while ((m = invRegex2.exec(xmlText)) !== null) {
      inventors.push({ inventor_name_last: m[1].trim(), inventor_name_first: m[2].trim() });
    }
  }

  // Count cited references as rough proxy for forward citations
  const citationCount = (xmlText.match(/<us-citation>/g) || []).length;

  // Determine patent type from kind code
  const kindCode = xmlText.match(/<publication-reference>\s*<document-id>[^]*?<kind>([^<]+)<\/kind>/s)?.[1];
  let patentType = 'utility';
  if (kindCode?.startsWith('S')) patentType = 'design';
  else if (kindCode?.startsWith('PP')) patentType = 'plant';
  else if (kindCode?.startsWith('RE')) patentType = 'reissue';

  return {
    patent_id: patentId,
    patent_title: title || '',
    patent_abstract: abstractText,
    patent_date: formatXmlDate(grantDate || ''),
    patent_type: patentType,
    patent_num_times_cited_by_us_patents: citationCount,
    assignees,
    inventors,
    cpc_current: cpcCodes,
    application: filingDate ? [{ filing_date: formatXmlDate(filingDate)! }] : [],
  };
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search USPTO bulk XML files for patents matching assignee patterns.
 * Yields batches of results (one batch per weekly file) for streaming consumption.
 */
export async function* searchBulkPatents(
  options: BulkSearchOptions
): AsyncGenerator<BulkPatentResult[], void, unknown> {
  const {
    patterns,
    cpcPrefixes,
    maxPatents,
    startYear = new Date().getFullYear(),
    endYear = 2005,
    onProgress,
  } = options;

  if (!BULKDATA_DIR || !fs.existsSync(BULKDATA_DIR)) {
    throw new Error(`Bulk data directory not found: ${BULKDATA_DIR}. Set USPTO_PATENT_GRANT_XML_DIR.`);
  }

  const weeklyFiles = getWeeklyXmlFiles(startYear, endYear);
  let totalFound = 0;

  onProgress?.(`Searching ${weeklyFiles.length} weekly files for ${patterns.length} patterns...`);

  for (const file of weeklyFiles) {
    if (totalFound >= maxPatents) break;

    // Ensure the XML is extracted
    const xmlPath = ensureExtracted(file);
    if (!xmlPath) {
      onProgress?.(`  Skipping ${file.xmlName} (could not extract)`);
      continue;
    }

    onProgress?.(`  Scanning ${file.xmlName}...`);

    // Stream-parse the large XML file
    const batch: BulkPatentResult[] = [];
    let currentBlock = '';
    let inPatent = false;

    const fileStream = fs.createReadStream(xmlPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        // Each patent starts with <?xml
        if (line.startsWith('<?xml')) {
          // Process the previous block
          if (inPatent && currentBlock.length > 0) {
            const result = parsePatentBlock(currentBlock, patterns, cpcPrefixes);
            if (result) {
              batch.push(result);
              totalFound++;
              if (totalFound >= maxPatents) break;
            }
          }
          currentBlock = line;
          inPatent = true;
        } else if (inPatent) {
          currentBlock += '\n' + line;
        }
      }

      // Process last block in file
      if (inPatent && currentBlock.length > 0 && totalFound < maxPatents) {
        const result = parsePatentBlock(currentBlock, patterns, cpcPrefixes);
        if (result) {
          batch.push(result);
          totalFound++;
        }
      }
    } finally {
      rl.close();
      fileStream.destroy();
    }

    if (batch.length > 0) {
      onProgress?.(`  Found ${batch.length} matching patents in ${file.xmlName} (total: ${totalFound})`);
      yield batch;
    }
  }

  onProgress?.(`Search complete. Found ${totalFound} patents across bulk data.`);
}

/**
 * Estimate disk space needed to extract bulk data for a year range.
 */
export function estimateExtractionSpace(startYear: number, endYear: number): {
  totalZips: number;
  alreadyExtracted: number;
  needsExtraction: number;
  estimatedSpaceGB: number;
} {
  const files = getWeeklyXmlFiles(startYear, endYear);
  let alreadyExtracted = 0;
  let needsExtraction = 0;

  for (const file of files) {
    const xmlPath = path.join(file.dirPath, `${file.xmlName}.xml`);
    if (fs.existsSync(xmlPath)) {
      alreadyExtracted++;
    } else if (fs.existsSync(file.zipPath)) {
      needsExtraction++;
    }
  }

  return {
    totalZips: files.length,
    alreadyExtracted,
    needsExtraction,
    // Average: ~150MB zip → ~900MB extracted XML
    estimatedSpaceGB: Math.round(needsExtraction * 0.9 * 10) / 10,
  };
}
