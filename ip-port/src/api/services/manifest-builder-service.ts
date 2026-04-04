/**
 * Manifest Builder Service
 *
 * Pre-computes lightweight manifest files alongside each weekly USPTO bulk XML.
 * Each manifest (~3MB) contains patent_id, assignee, dates, CPC, and backward
 * citation list for every patent in that week — enabling fast search without
 * scanning ~1GB raw XML files.
 *
 * Also builds a forward-counts NDJSON index by inverting all backward citations,
 * giving true forward citation counts (how many later patents cite a given patent).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  getBulkDataDir,
  getWeeklyXmlFiles,
  ensureExtracted,
  formatXmlDate,
} from './bulk-patent-search-service.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestEntry {
  id: string;           // normalized patent_id
  a: string;            // primary assignee org
  gd: string;           // grant_date YYYY-MM-DD
  fd: string | null;    // filing_date
  cpc: string | null;   // primary CPC code (section+class+subclass+mainGroup/subgroup)
  t: string;            // patent_type (utility/design/plant/reissue)
  bc: string[];         // backward citation doc-numbers (US only, normalized)
}

export interface ManifestFile {
  version: 1;
  xml_name: string;
  xml_size: number;      // for staleness detection
  generated_at: string;
  count: number;
  entries: ManifestEntry[];
}

export interface ManifestMeta {
  last_full_build: string | null;
  last_forward_build: string | null;
  manifest_count: number;
  forward_count_patents: number;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function getManifestPath(dirPath: string, xmlName: string): string {
  return path.join(dirPath, `${xmlName}.manifest.json`);
}

function getForwardCountsPath(): string {
  return path.join(getBulkDataDir(), 'forward-counts.ndjson');
}

function getMetaPath(): string {
  return path.join(getBulkDataDir(), 'manifest-meta.json');
}

// ---------------------------------------------------------------------------
// Build manifest for a single weekly XML
// ---------------------------------------------------------------------------

/**
 * Stream one weekly XML and extract ManifestEntry for every patent in it.
 * Reuses the same regex approach as parsePatentBlock() in bulk-patent-search-service.
 */
export async function buildManifestForWeek(
  xmlPath: string,
  xmlName: string,
): Promise<ManifestFile> {
  const xmlStat = fs.statSync(xmlPath);
  const entries: ManifestEntry[] = [];

  const fileStream = fs.createReadStream(xmlPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentBlock = '';
  let inPatent = false;

  try {
    for await (const line of rl) {
      if (line.startsWith('<?xml')) {
        if (inPatent && currentBlock.length > 0) {
          const entry = extractManifestEntry(currentBlock);
          if (entry) entries.push(entry);
        }
        currentBlock = line;
        inPatent = true;
      } else if (inPatent) {
        currentBlock += '\n' + line;
      }
    }

    // Process last block
    if (inPatent && currentBlock.length > 0) {
      const entry = extractManifestEntry(currentBlock);
      if (entry) entries.push(entry);
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return {
    version: 1,
    xml_name: xmlName,
    xml_size: xmlStat.size,
    generated_at: new Date().toISOString(),
    count: entries.length,
    entries,
  };
}

/**
 * Extract a ManifestEntry from a single patent XML block.
 */
function extractManifestEntry(xmlText: string): ManifestEntry | null {
  // Extract doc-number from publication-reference
  const docNumber = xmlText.match(
    /<publication-reference>\s*<document-id>\s*<country>[^<]*<\/country>\s*<doc-number>([^<]+)<\/doc-number>/s
  )?.[1];
  if (!docNumber) return null;

  const patentId = docNumber.replace(/^0+/, '');

  // Grant date
  const grantDateRaw = xmlText.match(
    /<publication-reference>\s*<document-id>[^]*?<date>(\d{8})<\/date>\s*<\/document-id>/s
  )?.[1];
  const grantDate = formatXmlDate(grantDateRaw || '');
  if (!grantDate) return null; // skip entries without a grant date

  // Filing date
  const filingDateRaw = xmlText.match(
    /<application-reference[^>]*>\s*<document-id>[^]*?<date>(\d{8})<\/date>\s*<\/document-id>/s
  )?.[1];
  const filingDate = formatXmlDate(filingDateRaw || '');

  // Primary assignee org
  const assigneeMatch = xmlText.match(
    /<assignee>\s*<addressbook>\s*<orgname>([^<]+)<\/orgname>/s
  );
  const assignee = assigneeMatch?.[1]?.trim() || '';

  // Primary CPC code
  const cpcMatch = xmlText.match(
    /<classification-cpc>[\s\S]*?<section>([^<]+)<\/section>\s*<class>([^<]+)<\/class>\s*<subclass>([^<]+)<\/subclass>\s*<main-group>([^<]+)<\/main-group>\s*<subgroup>([^<]+)<\/subgroup>/s
  );
  const primaryCpc = cpcMatch
    ? `${cpcMatch[1]}${cpcMatch[2]}${cpcMatch[3]}${cpcMatch[4]}/${cpcMatch[5]}`
    : null;

  // Patent type from kind code
  const kindCode = xmlText.match(
    /<publication-reference>\s*<document-id>[^]*?<kind>([^<]+)<\/kind>/s
  )?.[1];
  let patentType = 'utility';
  if (kindCode?.startsWith('S')) patentType = 'design';
  else if (kindCode?.startsWith('PP')) patentType = 'plant';
  else if (kindCode?.startsWith('RE')) patentType = 'reissue';

  // Backward citations: extract US doc-numbers from <us-citation><patcit> blocks
  const backwardCitations: string[] = [];
  const citRegex = /<us-citation>[\s\S]*?<patcit[\s\S]*?>[\s\S]*?<country>([^<]+)<\/country>\s*<doc-number>([^<]+)<\/doc-number>[\s\S]*?<\/us-citation>/gs;
  let citMatch;
  while ((citMatch = citRegex.exec(xmlText)) !== null) {
    if (citMatch[1].trim() === 'US') {
      const citedId = citMatch[2].replace(/^0+/, '');
      if (citedId) backwardCitations.push(citedId);
    }
  }

  return {
    id: patentId,
    a: assignee,
    gd: grantDate,
    fd: filingDate,
    cpc: primaryCpc,
    t: patentType,
    bc: backwardCitations,
  };
}

// ---------------------------------------------------------------------------
// Build all manifests
// ---------------------------------------------------------------------------

export interface BuildManifestsOptions {
  startYear?: number;
  endYear?: number;
  force?: boolean;
  onProgress?: (msg: string) => void;
}

/**
 * Iterate all weekly XML files, building manifests for those that don't have one
 * (or whose XML size has changed).
 */
export async function buildAllManifests(options: BuildManifestsOptions = {}): Promise<{
  built: number;
  skipped: number;
  failed: number;
}> {
  const {
    startYear = new Date().getFullYear(),
    endYear = 2005,
    force = false,
    onProgress,
  } = options;

  const bulkDir = getBulkDataDir();
  if (!bulkDir || !fs.existsSync(bulkDir)) {
    throw new Error(`Bulk data directory not found: ${bulkDir}. Set USPTO_PATENT_GRANT_XML_DIR.`);
  }

  const weeklyFiles = getWeeklyXmlFiles(startYear, endYear);
  let built = 0;
  let skipped = 0;
  let failed = 0;

  onProgress?.(`Building manifests for ${weeklyFiles.length} weekly files (${startYear}→${endYear})...`);

  for (const file of weeklyFiles) {
    const manifestPath = getManifestPath(file.dirPath, file.xmlName);

    // Check if manifest already exists and is fresh
    if (!force && fs.existsSync(manifestPath)) {
      try {
        const existing: ManifestFile = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const xmlPath = path.join(file.dirPath, `${file.xmlName}.xml`);
        if (fs.existsSync(xmlPath)) {
          const xmlStat = fs.statSync(xmlPath);
          if (existing.xml_size === xmlStat.size) {
            skipped++;
            continue;
          }
        }
      } catch {
        // corrupt manifest — rebuild
      }
    }

    // Ensure XML is extracted
    const xmlPath = ensureExtracted(file);
    if (!xmlPath) {
      onProgress?.(`  Skipping ${file.xmlName} (could not extract)`);
      failed++;
      continue;
    }

    onProgress?.(`  Building manifest for ${file.xmlName}...`);

    try {
      const manifest = await buildManifestForWeek(xmlPath, file.xmlName);

      // Atomic write: write to .tmp then rename
      const tmpPath = manifestPath + '.tmp';
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(manifest));
      fs.renameSync(tmpPath, manifestPath);

      onProgress?.(`  ${file.xmlName}: ${manifest.count} patents`);
      built++;
    } catch (err) {
      onProgress?.(`  FAILED ${file.xmlName}: ${(err as Error).message}`);
      failed++;
    }
  }

  onProgress?.(`Manifest build complete: ${built} built, ${skipped} skipped, ${failed} failed`);
  return { built, skipped, failed };
}

// ---------------------------------------------------------------------------
// Forward citation counts
// ---------------------------------------------------------------------------

/**
 * Read all manifests, invert backward citations, and write forward-counts.ndjson.
 * Each line: {"p":"patentId","c":count}
 */
export async function buildForwardCounts(options: {
  startYear?: number;
  endYear?: number;
  onProgress?: (msg: string) => void;
} = {}): Promise<{ totalPatentsCited: number }> {
  const {
    startYear = new Date().getFullYear(),
    endYear = 2005,
    onProgress,
  } = options;

  const bulkDir = getBulkDataDir();
  const weeklyFiles = getWeeklyXmlFiles(startYear, endYear);
  const counts = new Map<string, number>();

  onProgress?.(`Building forward citation counts from manifests...`);
  let manifestsRead = 0;

  for (const file of weeklyFiles) {
    const manifestPath = getManifestPath(file.dirPath, file.xmlName);
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest: ManifestFile = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const entry of manifest.entries) {
        for (const cited of entry.bc) {
          counts.set(cited, (counts.get(cited) || 0) + 1);
        }
      }
      manifestsRead++;
    } catch {
      onProgress?.(`  Warning: could not read ${file.xmlName} manifest`);
    }
  }

  onProgress?.(`  Read ${manifestsRead} manifests, ${counts.size} unique cited patents`);

  // Sort by patent_id and write as NDJSON
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const outPath = getForwardCountsPath();
  const tmpPath = outPath + '.tmp';
  const ws = fs.createWriteStream(tmpPath);

  for (const [patentId, count] of sorted) {
    ws.write(`{"p":"${patentId}","c":${count}}\n`);
  }

  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve());
    ws.on('error', reject);
  });

  fs.renameSync(tmpPath, outPath);

  // Update meta
  const metaPath = getMetaPath();
  const meta: ManifestMeta = {
    last_full_build: null,
    last_forward_build: new Date().toISOString(),
    manifest_count: manifestsRead,
    forward_count_patents: counts.size,
  };
  try {
    const existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    meta.last_full_build = existingMeta.last_full_build;
  } catch {}
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  onProgress?.(`Forward counts written: ${counts.size} patents → ${outPath}`);
  return { totalPatentsCited: counts.size };
}

/**
 * Incrementally update forward counts after a single new manifest is added.
 */
export async function updateForwardCountsIncremental(manifestPath: string): Promise<void> {
  const countsPath = getForwardCountsPath();

  // Load existing counts
  const counts = fs.existsSync(countsPath) ? await loadForwardCountsFromDisk() : new Map<string, number>();

  // Read the new manifest and add its backward citations
  const manifest: ManifestFile = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  for (const entry of manifest.entries) {
    for (const cited of entry.bc) {
      counts.set(cited, (counts.get(cited) || 0) + 1);
    }
  }

  // Rewrite NDJSON
  const sorted = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const tmpPath = countsPath + '.tmp';
  const ws = fs.createWriteStream(tmpPath);

  for (const [patentId, count] of sorted) {
    ws.write(`{"p":"${patentId}","c":${count}}\n`);
  }

  await new Promise<void>((resolve, reject) => {
    ws.end(() => resolve());
    ws.on('error', reject);
  });

  fs.renameSync(tmpPath, countsPath);
}

// ---------------------------------------------------------------------------
// Load / release forward counts (cached in memory)
// ---------------------------------------------------------------------------

let forwardCountsCache: Map<string, number> | null = null;

/**
 * Load forward counts from NDJSON into memory. Cached after first load.
 */
export async function loadForwardCounts(): Promise<Map<string, number>> {
  if (forwardCountsCache) return forwardCountsCache;
  forwardCountsCache = await loadForwardCountsFromDisk();
  return forwardCountsCache;
}

/**
 * Free the in-memory forward counts cache.
 */
export function releaseForwardCounts(): void {
  forwardCountsCache = null;
}

async function loadForwardCountsFromDisk(): Promise<Map<string, number>> {
  const countsPath = getForwardCountsPath();
  const counts = new Map<string, number>();

  if (!fs.existsSync(countsPath)) return counts;

  const fileStream = fs.createReadStream(countsPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const { p, c } = JSON.parse(line);
        counts.set(p, c);
      } catch {
        // skip malformed lines
      }
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export interface ManifestStatus {
  bulkDataDir: string;
  totalWeeklyFiles: number;
  manifestsBuilt: number;
  manifestsMissing: number;
  forwardCountsExist: boolean;
  forwardCountPatents: number;
  meta: ManifestMeta | null;
}

export function getManifestStatus(startYear?: number, endYear?: number): ManifestStatus {
  const bulkDir = getBulkDataDir();
  const start = startYear ?? new Date().getFullYear();
  const end = endYear ?? 2005;

  if (!bulkDir || !fs.existsSync(bulkDir)) {
    return {
      bulkDataDir: bulkDir,
      totalWeeklyFiles: 0,
      manifestsBuilt: 0,
      manifestsMissing: 0,
      forwardCountsExist: false,
      forwardCountPatents: 0,
      meta: null,
    };
  }

  const weeklyFiles = getWeeklyXmlFiles(start, end);
  let manifestsBuilt = 0;
  let manifestsMissing = 0;

  for (const file of weeklyFiles) {
    const manifestPath = getManifestPath(file.dirPath, file.xmlName);
    if (fs.existsSync(manifestPath)) {
      manifestsBuilt++;
    } else {
      manifestsMissing++;
    }
  }

  const forwardCountsPath = getForwardCountsPath();
  const forwardCountsExist = fs.existsSync(forwardCountsPath);

  let meta: ManifestMeta | null = null;
  try {
    meta = JSON.parse(fs.readFileSync(getMetaPath(), 'utf-8'));
  } catch {}

  return {
    bulkDataDir: bulkDir,
    totalWeeklyFiles: weeklyFiles.length,
    manifestsBuilt,
    manifestsMissing,
    forwardCountsExist,
    forwardCountPatents: meta?.forward_count_patents ?? 0,
    meta,
  };
}
