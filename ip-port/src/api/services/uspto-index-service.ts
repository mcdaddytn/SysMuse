/**
 * USPTO Index Service — Indexing (write)
 *
 * Parses weekly USPTO bulk XML files and populates the ip_portfolio_uspto
 * database with patent data, CPC codes, and metadata.
 *
 * Eliminates the need for "hydration" — all fields are extracted during
 * indexing, so import is a single-step database query.
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
import { getUsptoPrisma } from '../../lib/uspto-prisma.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexWeeklyOptions {
  cpcSections?: string[];         // Default: ['H', 'G', 'B']
  includeUnclassified?: boolean;  // Include patents with no CPC (default: true)
  onProgress?: (msg: string) => void;
}

export interface IndexAllOptions extends IndexWeeklyOptions {
  startYear?: number;
  endYear?: number;
  force?: boolean;
}

export interface IndexStatus {
  totalWeeklyFiles: number;
  indexedFiles: number;
  totalPatents: number;
  filteredPatents: number;
  byYear: Array<{ year: number; files: number; patents: number }>;
}

interface ParsedPatent {
  patentId: string;
  patentIdNumeric: number | null;
  title: string;
  abstract: string | null;
  grantDate: string | null;   // YYYY-MM-DD
  filingDate: string | null;  // YYYY-MM-DD
  assignee: string;
  inventors: string[];
  patentType: string;
  kindCode: string | null;
  primaryCpc: string | null;
  cpcSection: string | null;
  xmlSource: string;
  cpcCodes: Array<{
    code: string;
    section: string;
    cpcClass: string;
    isInventive: boolean;
    position: number;
  }>;
  backwardCitations: string[];
}

// ---------------------------------------------------------------------------
// CPC section filter defaults
// ---------------------------------------------------------------------------

const DEFAULT_CPC_SECTIONS = ['H', 'G', 'B'];

// ---------------------------------------------------------------------------
// Index a single weekly file
// ---------------------------------------------------------------------------

export async function indexWeeklyFile(
  file: { zipPath: string; dirPath: string; xmlName: string; year: number },
  options: IndexWeeklyOptions = {},
): Promise<{ total: number; filtered: number; indexed: number }> {
  const {
    cpcSections = DEFAULT_CPC_SECTIONS,
    includeUnclassified = true,
    onProgress,
  } = options;

  const xmlPath = ensureExtracted(file);
  if (!xmlPath) {
    throw new Error(`Could not extract ${file.xmlName}`);
  }

  const xmlStat = fs.statSync(xmlPath);
  const usptoDb = getUsptoPrisma();

  // Parse all patents from the XML
  const allPatents: ParsedPatent[] = [];
  const fileStream = fs.createReadStream(xmlPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let currentBlock = '';
  let inPatent = false;

  try {
    for await (const line of rl) {
      if (line.startsWith('<?xml')) {
        if (inPatent && currentBlock.length > 0) {
          const patent = extractFullPatent(currentBlock, file.xmlName);
          if (patent) allPatents.push(patent);
        }
        currentBlock = line;
        inPatent = true;
      } else if (inPatent) {
        currentBlock += '\n' + line;
      }
    }

    // Process last block
    if (inPatent && currentBlock.length > 0) {
      const patent = extractFullPatent(currentBlock, file.xmlName);
      if (patent) allPatents.push(patent);
    }
  } finally {
    rl.close();
    fileStream.destroy();
  }

  const totalCount = allPatents.length;

  // Apply CPC section filter
  const filtered = allPatents.filter(p => {
    if (p.cpcCodes.length === 0) return includeUnclassified;
    return p.cpcCodes.some(c => cpcSections.includes(c.section));
  });

  const filteredCount = filtered.length;
  onProgress?.(`  ${file.xmlName}: ${totalCount} total, ${filteredCount} after CPC filter`);

  // Batch insert patents (skipDuplicates for idempotency)
  const BATCH_SIZE = 500;
  let indexed = 0;

  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);

    // Insert patents
    await usptoDb.indexedPatent.createMany({
      data: batch.map(p => ({
        patentId: p.patentId,
        patentIdNumeric: p.patentIdNumeric,
        title: p.title,
        abstract: p.abstract,
        grantDate: p.grantDate ? new Date(p.grantDate) : null,
        filingDate: p.filingDate ? new Date(p.filingDate) : null,
        assignee: p.assignee,
        inventors: p.inventors,
        patentType: p.patentType,
        kindCode: p.kindCode,
        primaryCpc: p.primaryCpc,
        cpcSection: p.cpcSection,
        forwardCitations: 0, // computed later
        xmlSource: p.xmlSource,
      })),
      skipDuplicates: true,
    });

    // Insert CPC codes
    const cpcRecords = batch.flatMap(p =>
      p.cpcCodes.map(c => ({
        patentId: p.patentId,
        cpcCode: c.code,
        cpcSection: c.section,
        cpcClass: c.cpcClass,
        isInventive: c.isInventive,
        position: c.position,
      }))
    );

    if (cpcRecords.length > 0) {
      await usptoDb.indexedPatentCpc.createMany({
        data: cpcRecords,
        skipDuplicates: true,
      });
    }

    indexed += batch.length;
  }

  // Write metadata
  await usptoDb.indexMetadata.upsert({
    where: { xmlSource: file.xmlName },
    create: {
      xmlSource: file.xmlName,
      year: file.year,
      xmlSize: BigInt(xmlStat.size),
      patentCount: totalCount,
      filteredCount: filteredCount,
      status: 'complete',
    },
    update: {
      xmlSize: BigInt(xmlStat.size),
      patentCount: totalCount,
      filteredCount: filteredCount,
      indexedAt: new Date(),
      status: 'complete',
    },
  });

  return { total: totalCount, filtered: filteredCount, indexed };
}

// ---------------------------------------------------------------------------
// Index all weekly files
// ---------------------------------------------------------------------------

export async function indexAll(options: IndexAllOptions = {}): Promise<{
  filesProcessed: number;
  filesSkipped: number;
  filesFailed: number;
  totalPatents: number;
  filteredPatents: number;
}> {
  const {
    startYear = new Date().getFullYear(),
    endYear = 2015,
    force = false,
    onProgress,
    ...weeklyOptions
  } = options;

  const bulkDir = getBulkDataDir();
  if (!bulkDir || !fs.existsSync(bulkDir)) {
    throw new Error(`Bulk data directory not found: ${bulkDir}. Set USPTO_PATENT_GRANT_XML_DIR.`);
  }

  const usptoDb = getUsptoPrisma();
  const weeklyFiles = getWeeklyXmlFiles(startYear, endYear);

  // Load already-indexed metadata
  const existingMeta = force ? [] : await usptoDb.indexMetadata.findMany({
    where: { status: 'complete' },
    select: { xmlSource: true, xmlSize: true },
  });
  const metaMap = new Map(existingMeta.map(m => [m.xmlSource, m.xmlSize]));

  let filesProcessed = 0;
  let filesSkipped = 0;
  let filesFailed = 0;
  let totalPatents = 0;
  let filteredPatents = 0;

  onProgress?.(`Indexing ${weeklyFiles.length} weekly files (${startYear}→${endYear})...`);

  for (const file of weeklyFiles) {
    // Check if already indexed with same file size
    if (!force && metaMap.has(file.xmlName)) {
      const xmlPath = path.join(file.dirPath, `${file.xmlName}.xml`);
      if (fs.existsSync(xmlPath)) {
        const xmlStat = fs.statSync(xmlPath);
        if (metaMap.get(file.xmlName) === BigInt(xmlStat.size)) {
          filesSkipped++;
          continue;
        }
      } else {
        // XML not extracted yet — check if zip size changed
        filesSkipped++;
        continue;
      }
    }

    try {
      const result = await indexWeeklyFile(file, { ...weeklyOptions, onProgress });
      totalPatents += result.total;
      filteredPatents += result.filtered;
      filesProcessed++;
    } catch (err) {
      onProgress?.(`  FAILED ${file.xmlName}: ${(err as Error).message}`);

      // Record failure in metadata
      await usptoDb.indexMetadata.upsert({
        where: { xmlSource: file.xmlName },
        create: {
          xmlSource: file.xmlName,
          year: file.year,
          status: 'error',
        },
        update: {
          status: 'error',
          indexedAt: new Date(),
        },
      }).catch(() => {});

      filesFailed++;
    }
  }

  onProgress?.(`Indexing complete: ${filesProcessed} processed, ${filesSkipped} skipped, ${filesFailed} failed`);
  onProgress?.(`  Total patents: ${totalPatents}, after CPC filter: ${filteredPatents}`);

  return { filesProcessed, filesSkipped, filesFailed, totalPatents, filteredPatents };
}

// ---------------------------------------------------------------------------
// Forward citation computation
// ---------------------------------------------------------------------------

/**
 * Compute forward citation counts from manifest backward citations.
 * Reads all manifests, inverts backward citations in memory, then bulk-UPDATEs
 * indexed_patents.forward_citations.
 *
 * CPC-filtered-out patents still contribute citations — we scan ALL patents'
 * backward citations, even if the citing patent isn't in the index.
 */
export async function computeForwardCitations(options: {
  startYear?: number;
  endYear?: number;
  onProgress?: (msg: string) => void;
} = {}): Promise<{ totalCited: number; updated: number }> {
  const {
    startYear = new Date().getFullYear(),
    endYear = 2005,
    onProgress,
  } = options;

  const bulkDir = getBulkDataDir();
  const weeklyFiles = getWeeklyXmlFiles(startYear, endYear);
  const counts = new Map<string, number>();

  onProgress?.(`Computing forward citations from manifests (${startYear}→${endYear})...`);
  let manifestsRead = 0;

  for (const file of weeklyFiles) {
    const manifestPath = path.join(file.dirPath, `${file.xmlName}.manifest.json`);
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
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

  // Bulk UPDATE in batches using raw SQL for performance
  const usptoDb = getUsptoPrisma();
  const UPDATE_BATCH = 5000;
  const entries = [...counts.entries()];
  let updated = 0;

  // First, reset all forward_citations to 0
  await usptoDb.$executeRawUnsafe(`UPDATE indexed_patents SET forward_citations = 0`);

  for (let i = 0; i < entries.length; i += UPDATE_BATCH) {
    const batch = entries.slice(i, i + UPDATE_BATCH);

    // Build a VALUES clause for bulk update
    const values = batch.map(([id, count]) =>
      `('${id.replace(/'/g, "''")}', ${count})`
    ).join(',');

    await usptoDb.$executeRawUnsafe(`
      UPDATE indexed_patents ip
      SET forward_citations = v.count
      FROM (VALUES ${values}) AS v(patent_id, count)
      WHERE ip.patent_id = v.patent_id
    `);

    updated += batch.length;
    if (updated % 100000 === 0) {
      onProgress?.(`  Updated ${updated}/${entries.length} forward citation counts...`);
    }
  }

  onProgress?.(`Forward citations computed: ${counts.size} cited patents, ${updated} updates applied`);
  return { totalCited: counts.size, updated };
}

// ---------------------------------------------------------------------------
// Index status
// ---------------------------------------------------------------------------

export async function getIndexStatus(startYear?: number, endYear?: number): Promise<IndexStatus> {
  const bulkDir = getBulkDataDir();
  const start = startYear ?? new Date().getFullYear();
  const end = endYear ?? 2005;
  const weeklyFiles = getWeeklyXmlFiles(start, end);

  const usptoDb = getUsptoPrisma();
  const metadata = await usptoDb.indexMetadata.findMany({
    where: { status: 'complete' },
  });

  const indexedSet = new Set(metadata.map(m => m.xmlSource));

  // Group by year
  const yearMap = new Map<number, { files: number; patents: number }>();
  for (const m of metadata) {
    const entry = yearMap.get(m.year) || { files: 0, patents: 0 };
    entry.files++;
    entry.patents += m.filteredCount;
    yearMap.set(m.year, entry);
  }

  const totalPatents = metadata.reduce((sum, m) => sum + m.patentCount, 0);
  const filteredPatents = metadata.reduce((sum, m) => sum + m.filteredCount, 0);

  return {
    totalWeeklyFiles: weeklyFiles.length,
    indexedFiles: metadata.length,
    totalPatents,
    filteredPatents,
    byYear: [...yearMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, data]) => ({ year, ...data })),
  };
}

// ---------------------------------------------------------------------------
// Extract all fields from a single patent XML block
// ---------------------------------------------------------------------------

function extractFullPatent(xmlText: string, xmlSource: string): ParsedPatent | null {
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
  if (!grantDate) return null;

  // Filing date
  const filingDateRaw = xmlText.match(
    /<application-reference[^>]*>\s*<document-id>[^]*?<date>(\d{8})<\/date>\s*<\/document-id>/s
  )?.[1];
  const filingDate = formatXmlDate(filingDateRaw || '');

  // Kind code
  const kindCode = xmlText.match(
    /<publication-reference>\s*<document-id>[^]*?<kind>([^<]+)<\/kind>/s
  )?.[1] || null;

  // Patent type from kind code
  let patentType = 'utility';
  if (kindCode?.startsWith('S')) patentType = 'design';
  else if (kindCode?.startsWith('PP')) patentType = 'plant';
  else if (kindCode?.startsWith('RE')) patentType = 'reissue';

  // Primary assignee org
  const assigneeMatch = xmlText.match(
    /<assignee>\s*<addressbook>\s*<orgname>([^<]+)<\/orgname>/s
  );
  const assignee = assigneeMatch?.[1]?.trim() || '';

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

  // Inventors
  const inventors: string[] = [];
  let m;
  const inventorRegex = /<applicant[^>]*app-type="applicant-inventor"[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
  while ((m = inventorRegex.exec(xmlText)) !== null) {
    inventors.push(`${m[2].trim()} ${m[1].trim()}`);
  }
  // Fallback: <inventor> tags
  if (inventors.length === 0) {
    const invRegex2 = /<inventor[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
    while ((m = invRegex2.exec(xmlText)) !== null) {
      inventors.push(`${m[2].trim()} ${m[1].trim()}`);
    }
  }

  // Extract ALL CPC codes with designation (I=Inventive, A=Additional)
  const cpcCodes: ParsedPatent['cpcCodes'] = [];
  const cpcRegex = /<classification-cpc>[\s\S]*?<section>([^<]+)<\/section>\s*<class>([^<]+)<\/class>\s*<subclass>([^<]+)<\/subclass>\s*<main-group>([^<]+)<\/main-group>\s*<subgroup>([^<]+)<\/subgroup>[\s\S]*?<classification-value>([^<]+)<\/classification-value>[\s\S]*?<\/classification-cpc>/gs;
  let cpcPosition = 0;
  while ((m = cpcRegex.exec(xmlText)) !== null) {
    const section = m[1];
    const classId = m[2];
    const subclass = m[3];
    const mainGroup = m[4];
    const subgroup = m[5];
    const designation = m[6].trim(); // 'I' or 'A'
    const code = `${section}${classId}${subclass}${mainGroup}/${subgroup}`;
    cpcCodes.push({
      code,
      section,
      cpcClass: `${section}${classId}${subclass}`,
      isInventive: designation === 'I',
      position: cpcPosition++,
    });
  }

  // If the more detailed regex didn't match, fall back to simpler one
  if (cpcCodes.length === 0) {
    const simpleCpcRegex = /<classification-cpc>[\s\S]*?<section>([^<]+)<\/section>\s*<class>([^<]+)<\/class>\s*<subclass>([^<]+)<\/subclass>\s*<main-group>([^<]+)<\/main-group>\s*<subgroup>([^<]+)<\/subgroup>/gs;
    while ((m = simpleCpcRegex.exec(xmlText)) !== null) {
      const section = m[1];
      const classId = m[2];
      const subclass = m[3];
      const mainGroup = m[4];
      const subgroup = m[5];
      const code = `${section}${classId}${subclass}${mainGroup}/${subgroup}`;
      cpcCodes.push({
        code,
        section,
        cpcClass: `${section}${classId}${subclass}`,
        isInventive: cpcPosition === 0, // assume first is inventive
        position: cpcPosition++,
      });
    }
  }

  // Primary CPC: first inventive, or first overall
  const inventiveCpc = cpcCodes.find(c => c.isInventive);
  const primaryCpc = inventiveCpc?.code || cpcCodes[0]?.code || null;
  const cpcSection = primaryCpc ? primaryCpc[0] : null;

  // Backward citations: US doc-numbers
  const backwardCitations: string[] = [];
  const citRegex = /<us-citation>[\s\S]*?<patcit[\s\S]*?>[\s\S]*?<country>([^<]+)<\/country>\s*<doc-number>([^<]+)<\/doc-number>[\s\S]*?<\/us-citation>/gs;
  while ((m = citRegex.exec(xmlText)) !== null) {
    if (m[1].trim() === 'US') {
      const citedId = m[2].replace(/^0+/, '');
      if (citedId) backwardCitations.push(citedId);
    }
  }

  // Compute numeric patent ID
  const numericStr = patentId.replace(/^[A-Z]+/i, '').replace(/^0+/, '');
  const patentIdNumeric = numericStr ? parseInt(numericStr, 10) || null : null;

  return {
    patentId,
    patentIdNumeric,
    title,
    abstract: abstractText,
    grantDate,
    filingDate,
    assignee,
    inventors,
    patentType,
    kindCode,
    primaryCpc,
    cpcSection,
    xmlSource,
    cpcCodes,
    backwardCitations,
  };
}
