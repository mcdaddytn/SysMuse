/**
 * Manifest Search Service
 *
 * Fast patent search using pre-built manifest files instead of scanning raw
 * ~1GB weekly XML files. Falls back to raw XML for weeks without manifests.
 *
 * Two-phase search:
 *   1. searchManifests() — scan lightweight manifests for assignee/CPC matches (~5s total)
 *   2. hydrateFromXml()  — selectively read raw XML only for matched patents (title/abstract/inventors)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  getBulkDataDir,
  getWeeklyXmlFiles,
  ensureExtracted,
  formatXmlDate,
  matchesAssigneePattern,
  type BulkPatentResult,
} from './bulk-patent-search-service.js';
import {
  loadForwardCounts,
  releaseForwardCounts,
  type ManifestFile,
} from './manifest-builder-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestMatch {
  patent_id: string;
  assignee: string;
  grant_date: string;
  filing_date: string | null;
  primary_cpc: string | null;
  patent_type: string;
  forward_citations: number;
  xml_source: string;  // e.g., "ipg240102" — for selective hydration
}

export interface ManifestSearchOptions {
  patterns: string[];
  cpcPrefixes?: string[];
  maxPatents: number;
  startYear?: number;
  endYear?: number;
  onProgress?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Search manifests
// ---------------------------------------------------------------------------

/**
 * Search manifests for patents matching assignee patterns.
 * Yields batches of ManifestMatch (one batch per weekly file) most-recent-first.
 * Falls back to raw XML scan for weeks without manifests.
 */
export async function* searchManifests(
  options: ManifestSearchOptions
): AsyncGenerator<ManifestMatch[], void, unknown> {
  const {
    patterns,
    cpcPrefixes,
    maxPatents,
    startYear = new Date().getFullYear(),
    endYear = 2005,
    onProgress,
  } = options;

  const bulkDir = getBulkDataDir();
  if (!bulkDir || !fs.existsSync(bulkDir)) {
    throw new Error(`Bulk data directory not found: ${bulkDir}. Set USPTO_PATENT_GRANT_XML_DIR.`);
  }

  // Load forward counts
  const forwardCounts = await loadForwardCounts();
  onProgress?.(`Loaded ${forwardCounts.size} forward citation counts`);

  const weeklyFiles = getWeeklyXmlFiles(startYear, endYear);
  let totalFound = 0;

  onProgress?.(`Searching ${weeklyFiles.length} weekly files for ${patterns.length} patterns...`);

  for (const file of weeklyFiles) {
    if (totalFound >= maxPatents) break;

    const manifestPath = path.join(file.dirPath, `${file.xmlName}.manifest.json`);

    if (fs.existsSync(manifestPath)) {
      // Fast path: search manifest
      const batch = searchOneManifest(manifestPath, file.xmlName, patterns, cpcPrefixes, forwardCounts);
      if (batch.length > 0) {
        // Respect maxPatents
        const remaining = maxPatents - totalFound;
        const trimmed = batch.slice(0, remaining);
        totalFound += trimmed.length;
        onProgress?.(`  ${file.xmlName}: ${trimmed.length} matches (manifest, total: ${totalFound})`);
        yield trimmed;
      }
    } else {
      // Fallback: raw XML scan (same as bulk-patent-search-service)
      const xmlPath = ensureExtracted(file);
      if (!xmlPath) {
        onProgress?.(`  Skipping ${file.xmlName} (no manifest, could not extract XML)`);
        continue;
      }

      onProgress?.(`  Scanning ${file.xmlName} (no manifest, raw XML fallback)...`);
      const batch = await searchOneXmlFallback(xmlPath, file.xmlName, patterns, cpcPrefixes, forwardCounts, maxPatents - totalFound);
      if (batch.length > 0) {
        totalFound += batch.length;
        onProgress?.(`  ${file.xmlName}: ${batch.length} matches (XML fallback, total: ${totalFound})`);
        yield batch;
      }
    }
  }

  onProgress?.(`Search complete. Found ${totalFound} patents across bulk data.`);
}

function searchOneManifest(
  manifestPath: string,
  xmlName: string,
  patterns: string[],
  cpcPrefixes: string[] | undefined,
  forwardCounts: Map<string, number>,
): ManifestMatch[] {
  let manifest: ManifestFile;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return [];
  }

  const matches: ManifestMatch[] = [];

  for (const entry of manifest.entries) {
    // Assignee match
    if (!entry.a || !matchesAssigneePattern(entry.a, patterns)) continue;

    // CPC prefix filter
    if (cpcPrefixes?.length && entry.cpc) {
      const hasCpcMatch = cpcPrefixes.some(prefix => entry.cpc!.startsWith(prefix));
      if (!hasCpcMatch) continue;
    } else if (cpcPrefixes?.length && !entry.cpc) {
      continue; // CPC filter requested but patent has no CPC
    }

    matches.push({
      patent_id: entry.id,
      assignee: entry.a,
      grant_date: entry.gd,
      filing_date: entry.fd,
      primary_cpc: entry.cpc,
      patent_type: entry.t,
      forward_citations: forwardCounts.get(entry.id) || 0,
      xml_source: xmlName,
    });
  }

  return matches;
}

/**
 * Fallback: search raw XML for a single week, returning ManifestMatch format.
 */
async function searchOneXmlFallback(
  xmlPath: string,
  xmlName: string,
  patterns: string[],
  cpcPrefixes: string[] | undefined,
  forwardCounts: Map<string, number>,
  maxResults: number,
): Promise<ManifestMatch[]> {
  const matches: ManifestMatch[] = [];
  let currentBlock = '';
  let inPatent = false;

  const fileStream = fs.createReadStream(xmlPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (line.startsWith('<?xml')) {
        if (inPatent && currentBlock.length > 0) {
          const match = parseBlockToManifestMatch(currentBlock, xmlName, patterns, cpcPrefixes, forwardCounts);
          if (match) {
            matches.push(match);
            if (matches.length >= maxResults) break;
          }
        }
        currentBlock = line;
        inPatent = true;
      } else if (inPatent) {
        currentBlock += '\n' + line;
      }
    }

    // Last block
    if (inPatent && currentBlock.length > 0 && matches.length < maxResults) {
      const match = parseBlockToManifestMatch(currentBlock, xmlName, patterns, cpcPrefixes, forwardCounts);
      if (match) matches.push(match);
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return matches;
}

function parseBlockToManifestMatch(
  xmlText: string,
  xmlName: string,
  patterns: string[],
  cpcPrefixes: string[] | undefined,
  forwardCounts: Map<string, number>,
): ManifestMatch | null {
  // Quick pre-check
  const xmlLower = xmlText.toLowerCase();
  if (!patterns.some(p => xmlLower.includes(p.toLowerCase()))) return null;

  const docNumber = xmlText.match(
    /<publication-reference>\s*<document-id>\s*<country>[^<]*<\/country>\s*<doc-number>([^<]+)<\/doc-number>/s
  )?.[1];
  if (!docNumber) return null;

  const patentId = docNumber.replace(/^0+/, '');

  const grantDateRaw = xmlText.match(
    /<publication-reference>\s*<document-id>[^]*?<date>(\d{8})<\/date>\s*<\/document-id>/s
  )?.[1];
  const grantDate = formatXmlDate(grantDateRaw || '');
  if (!grantDate) return null;

  const filingDateRaw = xmlText.match(
    /<application-reference[^>]*>\s*<document-id>[^]*?<date>(\d{8})<\/date>\s*<\/document-id>/s
  )?.[1];
  const filingDate = formatXmlDate(filingDateRaw || '');

  // Assignee
  const assignees: string[] = [];
  const assigneeRegex = /<assignee>\s*<addressbook>\s*<orgname>([^<]+)<\/orgname>/gs;
  let m;
  while ((m = assigneeRegex.exec(xmlText)) !== null) {
    assignees.push(m[1].trim());
  }
  if (!assignees.some(a => matchesAssigneePattern(a, patterns))) return null;

  // CPC
  const cpcMatch = xmlText.match(
    /<classification-cpc>[\s\S]*?<section>([^<]+)<\/section>\s*<class>([^<]+)<\/class>\s*<subclass>([^<]+)<\/subclass>\s*<main-group>([^<]+)<\/main-group>\s*<subgroup>([^<]+)<\/subgroup>/s
  );
  const primaryCpc = cpcMatch
    ? `${cpcMatch[1]}${cpcMatch[2]}${cpcMatch[3]}${cpcMatch[4]}/${cpcMatch[5]}`
    : null;

  if (cpcPrefixes?.length) {
    if (!primaryCpc || !cpcPrefixes.some(prefix => primaryCpc.startsWith(prefix))) return null;
  }

  // Kind code → type
  const kindCode = xmlText.match(
    /<publication-reference>\s*<document-id>[^]*?<kind>([^<]+)<\/kind>/s
  )?.[1];
  let patentType = 'utility';
  if (kindCode?.startsWith('S')) patentType = 'design';
  else if (kindCode?.startsWith('PP')) patentType = 'plant';
  else if (kindCode?.startsWith('RE')) patentType = 'reissue';

  return {
    patent_id: patentId,
    assignee: assignees[0] || '',
    grant_date: grantDate,
    filing_date: filingDate,
    primary_cpc: primaryCpc,
    patent_type: patentType,
    forward_citations: forwardCounts.get(patentId) || 0,
    xml_source: xmlName,
  };
}

// ---------------------------------------------------------------------------
// Selective XML hydration
// ---------------------------------------------------------------------------

/**
 * Hydrate ManifestMatch results with full data from raw XML.
 * Groups matches by xml_source, then streams each relevant XML but only extracts
 * blocks for targeted patent IDs (skips non-matching blocks immediately).
 *
 * Returns title, abstract, inventors, all CPC codes for each matched patent.
 */
export async function hydrateFromXml(
  matches: ManifestMatch[],
  onProgress?: (msg: string) => void,
): Promise<Map<string, BulkPatentResult>> {
  const results = new Map<string, BulkPatentResult>();

  // Group by xml_source
  const bySource = new Map<string, ManifestMatch[]>();
  for (const match of matches) {
    const existing = bySource.get(match.xml_source) || [];
    existing.push(match);
    bySource.set(match.xml_source, existing);
  }

  const bulkDir = getBulkDataDir();

  for (const [xmlName, sourceMatches] of bySource) {
    const targetIds = new Set(sourceMatches.map(m => m.patent_id));
    const matchLookup = new Map(sourceMatches.map(m => [m.patent_id, m]));

    // Find the XML file
    // xmlName format: ipgYYMMDD → year is 20YY
    const yearStr = '20' + xmlName.slice(3, 5);
    const xmlDir = path.join(bulkDir, yearStr, xmlName);
    const xmlPath = path.join(xmlDir, `${xmlName}.xml`);

    if (!fs.existsSync(xmlPath)) {
      onProgress?.(`  Warning: XML not found for ${xmlName}, skipping ${targetIds.size} patents`);
      continue;
    }

    onProgress?.(`  Hydrating ${targetIds.size} patents from ${xmlName}...`);

    const fileStream = fs.createReadStream(xmlPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    let currentBlock = '';
    let inPatent = false;
    let foundInFile = 0;

    try {
      for await (const line of rl) {
        if (line.startsWith('<?xml')) {
          if (inPatent && currentBlock.length > 0) {
            const result = hydrateBlock(currentBlock, targetIds, matchLookup);
            if (result) {
              results.set(result.patent_id, result);
              foundInFile++;
              if (foundInFile >= targetIds.size) break;
            }
          }
          currentBlock = line;
          inPatent = true;
        } else if (inPatent) {
          currentBlock += '\n' + line;
        }
      }

      // Last block
      if (inPatent && currentBlock.length > 0 && foundInFile < targetIds.size) {
        const result = hydrateBlock(currentBlock, targetIds, matchLookup);
        if (result) {
          results.set(result.patent_id, result);
        }
      }
    } finally {
      rl.close();
      fileStream.destroy();
    }
  }

  return results;
}

/**
 * Extract full BulkPatentResult from a single XML block, but only if
 * its patent_id is in the target set.
 */
function hydrateBlock(
  xmlText: string,
  targetIds: Set<string>,
  matchLookup: Map<string, ManifestMatch>,
): BulkPatentResult | null {
  // Quick ID check: extract doc-number first, skip if not a target
  const docNumber = xmlText.match(
    /<publication-reference>\s*<document-id>\s*<country>[^<]*<\/country>\s*<doc-number>([^<]+)<\/doc-number>/s
  )?.[1];
  if (!docNumber) return null;

  const patentId = docNumber.replace(/^0+/, '');
  if (!targetIds.has(patentId)) return null;

  const manifestMatch = matchLookup.get(patentId);

  // Title
  const title = xmlText.match(/<invention-title[^>]*>([^<]+)<\/invention-title>/)?.[1]?.trim() || '';

  // Abstract
  const abstractMatch = xmlText.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/);
  let abstractText: string | null = null;
  if (abstractMatch) {
    abstractText = abstractMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Assignee organizations
  const assignees: Array<{ assignee_organization: string }> = [];
  const assigneeRegex = /<assignee>\s*<addressbook>\s*<orgname>([^<]+)<\/orgname>/gs;
  let m;
  while ((m = assigneeRegex.exec(xmlText)) !== null) {
    assignees.push({ assignee_organization: m[1].trim() });
  }

  // CPC codes
  const cpcCodes: Array<{ cpc_group_id: string; cpc_subgroup_id: string }> = [];
  const cpcRegex = /<classification-cpc>[\s\S]*?<section>([^<]+)<\/section>\s*<class>([^<]+)<\/class>\s*<subclass>([^<]+)<\/subclass>\s*<main-group>([^<]+)<\/main-group>\s*<subgroup>([^<]+)<\/subgroup>/gs;
  while ((m = cpcRegex.exec(xmlText)) !== null) {
    const groupId = `${m[1]}${m[2]}${m[3]}${m[4]}`;
    const subgroupId = `${groupId}/${m[5]}`;
    cpcCodes.push({ cpc_group_id: groupId, cpc_subgroup_id: subgroupId });
  }

  // Inventors
  const inventors: Array<{ inventor_name_first: string; inventor_name_last: string }> = [];
  const inventorRegex = /<applicant[^>]*app-type="applicant-inventor"[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
  while ((m = inventorRegex.exec(xmlText)) !== null) {
    inventors.push({ inventor_name_last: m[1].trim(), inventor_name_first: m[2].trim() });
  }
  if (inventors.length === 0) {
    const invRegex2 = /<inventor[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
    while ((m = invRegex2.exec(xmlText)) !== null) {
      inventors.push({ inventor_name_last: m[1].trim(), inventor_name_first: m[2].trim() });
    }
  }

  return {
    patent_id: patentId,
    patent_title: title,
    patent_abstract: abstractText,
    patent_date: manifestMatch?.grant_date || null,
    patent_type: manifestMatch?.patent_type || 'utility',
    patent_num_times_cited_by_us_patents: manifestMatch?.forward_citations || 0,
    assignees,
    inventors,
    cpc_current: cpcCodes,
    application: manifestMatch?.filing_date ? [{ filing_date: manifestMatch.filing_date }] : [],
  };
}
