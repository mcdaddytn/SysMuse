/**
 * Patent XML Parser Service
 *
 * Parses USPTO patent grant XML files to extract:
 * - CPC codes with designation (I = Inventive, A = Additional)
 * - Main CPC vs Further CPC distinction
 * - Full classification hierarchy
 *
 * Used for determining primary sub-sector assignments based on
 * inventive CPC codes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import { PrismaClient } from '@prisma/client';
import { calculateRemainingYears, calculateBaseScore } from './patent-hydration-service.js';
import { getPrimarySectorAsync, getSuperSectorAsync } from '../utils/sector-mapper.js';
import { formatXmlDate } from './bulk-patent-search-service.js';

const prisma = new PrismaClient();

// ============================================================================
// Types
// ============================================================================

export interface CPCClassification {
  code: string;           // Full CPC code (e.g., "G06F11/1453")
  section: string;        // e.g., "G"
  classId: string;        // e.g., "06"
  subclass: string;       // e.g., "F"
  mainGroup: string;      // e.g., "11"
  subgroup: string;       // e.g., "1453"
  designation: 'I' | 'A'; // Inventive or Additional
  isMainCpc: boolean;     // true if in <main-cpc>, false if in <further-cpc>
  position: number;       // Order in the classification list
}

export interface PatentCPCData {
  patentId: string;
  cpcClassifications: CPCClassification[];
  primaryCpc: CPCClassification | null;      // First main inventive CPC
  inventiveCpcs: CPCClassification[];        // All inventive CPCs
  additionalCpcs: CPCClassification[];       // All additional CPCs
  parseError?: string;
}

export interface EnrichmentResult {
  processed: number;
  found: number;
  notFound: number;
  errors: number;
  patentsWithInventive: number;
}

// ============================================================================
// Claims Types
// ============================================================================

export interface PatentClaim {
  number: number;
  text: string;
  isIndependent: boolean;
  dependsOn?: number;  // Claim number this depends on (for dependent claims)
}

export interface PatentClaimsData {
  patentId: string;
  claims: PatentClaim[];
  independentClaims: PatentClaim[];
  dependentClaims: PatentClaim[];
  totalClaimCount: number;
  independentClaimCount: number;
  parseError?: string;
}

export interface ClaimsExtractionOptions {
  independentOnly?: boolean;
  maxClaims?: number;
  maxTokens?: number;  // Approximate token limit
}

// ============================================================================
// XML Parser Configuration
// ============================================================================

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name) => {
    // These elements can appear multiple times
    return ['classification-cpc', 'classification-ipcr'].includes(name);
  },
});

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Find XML file for a patent ID, handling different naming conventions
 * USPTO XML files often use 8-digit patent numbers with leading zeros
 */
export function findXmlPath(patentId: string, xmlDir: string): string | null {
  // Try as-is first
  const directPath = path.join(xmlDir, `US${patentId}.xml`);
  if (fs.existsSync(directPath)) return directPath;

  // Try with leading zeros to make 8 digits
  if (patentId.length < 8) {
    const paddedId = patentId.padStart(8, '0');
    const paddedPath = path.join(xmlDir, `US${paddedId}.xml`);
    if (fs.existsSync(paddedPath)) return paddedPath;
  }

  // Try without leading zeros (in case the XML has them stripped)
  const strippedId = patentId.replace(/^0+/, '');
  if (strippedId !== patentId) {
    const strippedPath = path.join(xmlDir, `US${strippedId}.xml`);
    if (fs.existsSync(strippedPath)) return strippedPath;
  }

  return null;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Parse a single patent XML file to extract CPC classifications with designations
 */
export function parsePatentXml(xmlPath: string): PatentCPCData {
  const patentId = path.basename(xmlPath, '.xml').replace(/^US/, '');

  try {
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    const parsed = xmlParser.parse(xmlContent);

    const grant = parsed['us-patent-grant'];
    if (!grant) {
      return {
        patentId,
        cpcClassifications: [],
        primaryCpc: null,
        inventiveCpcs: [],
        additionalCpcs: [],
        parseError: 'No us-patent-grant element found',
      };
    }

    const biblio = grant['us-bibliographic-data-grant'];
    if (!biblio) {
      return {
        patentId,
        cpcClassifications: [],
        primaryCpc: null,
        inventiveCpcs: [],
        additionalCpcs: [],
        parseError: 'No bibliographic data found',
      };
    }

    const cpcSection = biblio['classifications-cpc'];
    if (!cpcSection) {
      return {
        patentId,
        cpcClassifications: [],
        primaryCpc: null,
        inventiveCpcs: [],
        additionalCpcs: [],
        parseError: 'No CPC classifications found',
      };
    }

    const classifications: CPCClassification[] = [];
    let position = 0;

    // Parse main-cpc (primary classification)
    const mainCpc = cpcSection['main-cpc'];
    if (mainCpc) {
      const mainClassifications = extractCpcClassifications(mainCpc, true, position);
      classifications.push(...mainClassifications);
      position += mainClassifications.length;
    }

    // Parse further-cpc (additional classifications)
    const furtherCpc = cpcSection['further-cpc'];
    if (furtherCpc) {
      const furtherClassifications = extractCpcClassifications(furtherCpc, false, position);
      classifications.push(...furtherClassifications);
    }

    // Categorize by designation
    const inventiveCpcs = classifications.filter(c => c.designation === 'I');
    const additionalCpcs = classifications.filter(c => c.designation === 'A');

    // Primary CPC = first main inventive, or first inventive, or first overall
    const primaryCpc =
      inventiveCpcs.find(c => c.isMainCpc) ||
      inventiveCpcs[0] ||
      classifications[0] ||
      null;

    return {
      patentId,
      cpcClassifications: classifications,
      primaryCpc,
      inventiveCpcs,
      additionalCpcs,
    };
  } catch (error) {
    return {
      patentId,
      cpcClassifications: [],
      primaryCpc: null,
      inventiveCpcs: [],
      additionalCpcs: [],
      parseError: `Parse error: ${(error as Error).message}`,
    };
  }
}

/**
 * Extract CPC classifications from a main-cpc or further-cpc element
 */
function extractCpcClassifications(
  element: any,
  isMainCpc: boolean,
  startPosition: number
): CPCClassification[] {
  const results: CPCClassification[] = [];

  // Handle both single classification and array
  let classificationList = element['classification-cpc'];
  if (!classificationList) return results;

  if (!Array.isArray(classificationList)) {
    classificationList = [classificationList];
  }

  for (let i = 0; i < classificationList.length; i++) {
    const cpc = classificationList[i];

    const section = String(cpc.section || '');
    // Class ID should be 2 digits with leading zero preserved
    const rawClass = cpc.class || '';
    const classId = String(rawClass).padStart(2, '0');
    const subclass = String(cpc.subclass || '');
    const mainGroup = String(cpc['main-group'] || '');
    const subgroup = String(cpc.subgroup || '');
    const designation = (cpc['classification-value'] || 'A') as 'I' | 'A';

    // Build full CPC code (format: G06F11/1453)
    const code = `${section}${classId}${subclass}${mainGroup}/${subgroup}`;

    results.push({
      code,
      section,
      classId,
      subclass,
      mainGroup,
      subgroup,
      designation,
      isMainCpc,
      position: startPosition + i,
    });
  }

  return results;
}

/**
 * Batch parse multiple patent XMLs
 */
export function parsePatentXmlBatch(
  patentIds: string[],
  xmlDir: string,
  progressCallback?: (current: number, total: number) => void
): Map<string, PatentCPCData> {
  const results = new Map<string, PatentCPCData>();

  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    const xmlPath = findXmlPath(patentId, xmlDir);

    if (xmlPath) {
      results.set(patentId, parsePatentXml(xmlPath));
    } else {
      results.set(patentId, {
        patentId,
        cpcClassifications: [],
        primaryCpc: null,
        inventiveCpcs: [],
        additionalCpcs: [],
        parseError: 'XML file not found',
      });
    }

    if (progressCallback && (i + 1) % 1000 === 0) {
      progressCallback(i + 1, patentIds.length);
    }
  }

  return results;
}

/**
 * Enrich candidates file with CPC designation data
 */
export async function enrichCandidatesWithCpcDesignation(
  candidatesFile: string = 'streaming-candidates-2026-01-25.json',
  xmlDir: string = process.env.USPTO_PATENT_GRANT_XML_DIR || '',
  options: {
    progressCallback?: (current: number, total: number) => void;
    dryRun?: boolean;
  } = {}
): Promise<EnrichmentResult> {
  const { progressCallback, dryRun = false } = options;

  if (!xmlDir) {
    throw new Error('USPTO_PATENT_GRANT_XML_DIR not set in environment');
  }

  // Load candidates
  const candidatesPath = path.join(process.cwd(), 'output', candidatesFile);
  const data = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates = data.candidates || [];

  const result: EnrichmentResult = {
    processed: 0,
    found: 0,
    notFound: 0,
    errors: 0,
    patentsWithInventive: 0,
  };

  for (let i = 0; i < candidates.length; i++) {
    const patent = candidates[i];
    const patentId = patent.patent_id || patent.patent_number;

    if (!patentId) {
      result.errors++;
      continue;
    }

    const xmlPath = findXmlPath(patentId, xmlDir);

    if (xmlPath) {
      const cpcData = parsePatentXml(xmlPath);
      result.found++;

      if (cpcData.parseError) {
        result.errors++;
      } else {
        // Enrich the patent record
        patent.cpc_with_designation = cpcData.cpcClassifications.map(c => ({
          code: c.code,
          designation: c.designation,
          isMain: c.isMainCpc,
        }));

        patent.primary_cpc = cpcData.primaryCpc?.code || null;
        patent.primary_cpc_designation = cpcData.primaryCpc?.designation || null;

        patent.inventive_cpc_codes = cpcData.inventiveCpcs.map(c => c.code);
        patent.additional_cpc_codes = cpcData.additionalCpcs.map(c => c.code);

        if (cpcData.inventiveCpcs.length > 0) {
          result.patentsWithInventive++;
        }
      }
    } else {
      result.notFound++;

      // Fallback: use first existing CPC as primary (no designation known)
      if (patent.cpc_codes && patent.cpc_codes.length > 0) {
        patent.primary_cpc = patent.cpc_codes[0];
        patent.primary_cpc_designation = null; // Unknown
        patent.inventive_cpc_codes = [];
        patent.additional_cpc_codes = [];
      }
    }

    result.processed++;

    if (progressCallback && (i + 1) % 1000 === 0) {
      progressCallback(i + 1, candidates.length);
    }
  }

  // Save enriched candidates
  if (!dryRun) {
    data.lastCpcEnrichment = {
      date: new Date().toISOString(),
      ...result,
    };
    fs.writeFileSync(candidatesPath, JSON.stringify(data, null, 2));
  }

  return result;
}

/**
 * Get primary sub-sector for a patent based on inventive CPC
 */
export function determinePrimarySubSector(
  patent: any,
  sectorRules: Map<string, string> // CPC prefix -> sector name
): {
  primarySubSector: string | null;
  primaryCpc: string | null;
  confidence: 'high' | 'medium' | 'low';
} {
  // Prefer inventive CPC codes
  const inventiveCpcs = patent.inventive_cpc_codes || [];
  const primaryCpc = patent.primary_cpc;
  const allCpcs = patent.cpc_codes || [];

  // Try inventive CPCs first
  for (const cpc of inventiveCpcs) {
    const sector = findMatchingSector(cpc, sectorRules);
    if (sector) {
      return {
        primarySubSector: cpc, // Use CPC code as sub-sector identifier
        primaryCpc: cpc,
        confidence: 'high',
      };
    }
  }

  // Try primary CPC (from main-cpc element)
  if (primaryCpc) {
    const sector = findMatchingSector(primaryCpc, sectorRules);
    if (sector) {
      return {
        primarySubSector: primaryCpc,
        primaryCpc: primaryCpc,
        confidence: patent.primary_cpc_designation === 'I' ? 'high' : 'medium',
      };
    }
  }

  // Fallback to first CPC
  if (allCpcs.length > 0) {
    return {
      primarySubSector: allCpcs[0],
      primaryCpc: allCpcs[0],
      confidence: 'low',
    };
  }

  return {
    primarySubSector: null,
    primaryCpc: null,
    confidence: 'low',
  };
}

function findMatchingSector(
  cpc: string,
  sectorRules: Map<string, string>
): string | null {
  // Try exact match, then progressively shorter prefixes
  for (const [prefix, sector] of sectorRules) {
    if (cpc.startsWith(prefix.replace('/', ''))) {
      return sector;
    }
  }
  return null;
}

/**
 * Analyze CPC co-occurrence patterns in the portfolio
 * Used for grouping related CPCs under dominant inventive codes
 */
export function analyzeCpcCooccurrence(
  candidates: any[],
  minCooccurrence: number = 10
): Map<string, { cooccurs: Map<string, number>; totalPatents: number }> {
  const cpcStats = new Map<string, { cooccurs: Map<string, number>; totalPatents: number }>();

  for (const patent of candidates) {
    const cpcs = patent.inventive_cpc_codes || patent.cpc_codes || [];

    // Count each CPC
    for (const cpc of cpcs) {
      if (!cpcStats.has(cpc)) {
        cpcStats.set(cpc, { cooccurs: new Map(), totalPatents: 0 });
      }
      cpcStats.get(cpc)!.totalPatents++;
    }

    // Count co-occurrences
    for (let i = 0; i < cpcs.length; i++) {
      for (let j = i + 1; j < cpcs.length; j++) {
        const cpc1 = cpcs[i];
        const cpc2 = cpcs[j];

        const stats1 = cpcStats.get(cpc1)!;
        const stats2 = cpcStats.get(cpc2)!;

        stats1.cooccurs.set(cpc2, (stats1.cooccurs.get(cpc2) || 0) + 1);
        stats2.cooccurs.set(cpc1, (stats2.cooccurs.get(cpc1) || 0) + 1);
      }
    }
  }

  // Filter to significant co-occurrences
  for (const [cpc, stats] of cpcStats) {
    for (const [cooccurCpc, count] of stats.cooccurs) {
      if (count < minCooccurrence) {
        stats.cooccurs.delete(cooccurCpc);
      }
    }
  }

  return cpcStats;
}

// ============================================================================
// DB-Backed CPC Enrichment
// ============================================================================

export interface CpcEnrichmentResult {
  patentId: string;
  cpcsWritten: number;
  inventiveCount: number;
  primaryCpcUpdated: boolean;
  error?: string;
  /** XML exists but has no CPC section (older format) — not an error, just a data limitation */
  noCpcInXml?: boolean;
}

/**
 * Enrich a single patent's CPC records in the database from its XML file.
 * - Upserts each CPC into PatentCpc with isInventive designation
 * - Updates Patent.primaryCpc using inventive-aware logic
 */
export async function enrichPatentCpcFromXml(
  patentId: string,
  exportDir: string
): Promise<CpcEnrichmentResult> {
  const xmlPath = findXmlPath(patentId, exportDir);
  if (!xmlPath) {
    return { patentId, cpcsWritten: 0, inventiveCount: 0, primaryCpcUpdated: false, error: 'XML file not found' };
  }

  const cpcData = parsePatentXml(xmlPath);
  if (cpcData.parseError) {
    // Distinguish "no CPC section in XML" (older format, expected) from actual parse errors
    const isNoCpcSection = cpcData.parseError === 'No CPC classifications found';
    if (isNoCpcSection) {
      return { patentId, cpcsWritten: 0, inventiveCount: 0, primaryCpcUpdated: false, noCpcInXml: true };
    }
    return { patentId, cpcsWritten: 0, inventiveCount: 0, primaryCpcUpdated: false, error: cpcData.parseError };
  }

  if (cpcData.cpcClassifications.length === 0) {
    return { patentId, cpcsWritten: 0, inventiveCount: 0, primaryCpcUpdated: false };
  }

  // Upsert each CPC code with its inventive designation
  let cpcsWritten = 0;
  for (const cpc of cpcData.cpcClassifications) {
    await prisma.patentCpc.upsert({
      where: { patentId_cpcCode: { patentId, cpcCode: cpc.code } },
      create: {
        patentId,
        cpcCode: cpc.code,
        isInventive: cpc.designation === 'I',
      },
      update: {
        isInventive: cpc.designation === 'I',
      },
    });
    cpcsWritten++;
  }

  // Update Patent.primaryCpc using inventive-aware logic
  const newPrimaryCpc = cpcData.primaryCpc?.code || null;
  if (newPrimaryCpc) {
    await prisma.patent.update({
      where: { patentId },
      data: { primaryCpc: newPrimaryCpc },
    });
  }

  return {
    patentId,
    cpcsWritten,
    inventiveCount: cpcData.inventiveCpcs.length,
    primaryCpcUpdated: !!newPrimaryCpc,
  };
}

/**
 * Batch enrich CPC data for multiple patents from their XML files.
 */
export async function enrichPatentCpcBatch(
  patentIds: string[],
  exportDir: string,
  progressCallback?: (current: number, total: number) => void
): Promise<{
  processed: number;
  enriched: number;
  errors: number;
  noCpcInXml: number;
  xmlNotFound: number;
  totalCpcsWritten: number;
  totalInventive: number;
}> {
  let processed = 0;
  let enriched = 0;
  let errors = 0;
  let noCpcInXml = 0;
  let xmlNotFound = 0;
  let totalCpcsWritten = 0;
  let totalInventive = 0;

  for (let i = 0; i < patentIds.length; i++) {
    const result = await enrichPatentCpcFromXml(patentIds[i], exportDir);
    processed++;

    if (result.noCpcInXml) {
      noCpcInXml++;
    } else if (result.error) {
      if (result.error === 'XML file not found') xmlNotFound++;
      errors++;
    } else if (result.cpcsWritten > 0) {
      enriched++;
      totalCpcsWritten += result.cpcsWritten;
      totalInventive += result.inventiveCount;
    }

    if (progressCallback && (i + 1) % 50 === 0) {
      progressCallback(i + 1, patentIds.length);
    }
  }

  return { processed, enriched, errors, noCpcInXml, xmlNotFound, totalCpcsWritten, totalInventive };
}

// ============================================================================
// Claims Extraction Functions
// ============================================================================

/**
 * Parse a single patent XML file to extract claims
 */
export function parsePatentClaims(xmlPath: string): PatentClaimsData {
  const patentId = path.basename(xmlPath, '.xml').replace(/^US/, '');

  try {
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');

    // Find the claims section
    const claimsMatch = xmlContent.match(/<claims[^>]*>([\s\S]*?)<\/claims>/);
    if (!claimsMatch) {
      return {
        patentId,
        claims: [],
        independentClaims: [],
        dependentClaims: [],
        totalClaimCount: 0,
        independentClaimCount: 0,
        parseError: 'No claims section found',
      };
    }

    const claimsXml = claimsMatch[1];
    const claims: PatentClaim[] = [];

    // Extract individual claims
    const claimMatches = Array.from(claimsXml.matchAll(/<claim id="CLM-(\d+)"[^>]*>([\s\S]*?)<\/claim>/g));

    for (const match of claimMatches) {
      const claimNum = parseInt(match[1], 10);
      const claimContent = match[2];

      // Extract claim text, stripping XML tags
      let text = claimContent
        .replace(/<claim-ref[^>]*>([^<]*)<\/claim-ref>/g, '$1')  // Keep claim ref text
        .replace(/<[^>]+>/g, ' ')  // Remove other XML tags
        .replace(/\s+/g, ' ')       // Normalize whitespace
        .trim();

      // Check if this claim references another (dependent claim)
      const refMatch = claimContent.match(/<claim-ref idref="CLM-(\d+)"/);
      const dependsOn = refMatch ? parseInt(refMatch[1], 10) : undefined;
      const isIndependent = !refMatch;

      claims.push({
        number: claimNum,
        text,
        isIndependent,
        dependsOn,
      });
    }

    // Categorize claims
    const independentClaims = claims.filter(c => c.isIndependent);
    const dependentClaims = claims.filter(c => !c.isIndependent);

    return {
      patentId,
      claims,
      independentClaims,
      dependentClaims,
      totalClaimCount: claims.length,
      independentClaimCount: independentClaims.length,
    };
  } catch (error) {
    return {
      patentId,
      claims: [],
      independentClaims: [],
      dependentClaims: [],
      totalClaimCount: 0,
      independentClaimCount: 0,
      parseError: `Parse error: ${(error as Error).message}`,
    };
  }
}

/**
 * Extract claims text for use in LLM prompts
 *
 * @param patentId - Patent ID to look up
 * @param xmlDir - Directory containing patent XML files
 * @param options - Extraction options (independentOnly, maxClaims, maxTokens)
 * @returns Formatted claims text for LLM prompt, or null if not found
 */
export function extractClaimsText(
  patentId: string,
  xmlDir: string = process.env.USPTO_PATENT_GRANT_XML_DIR || '',
  options: ClaimsExtractionOptions = {}
): string | null {
  const { independentOnly = true, maxClaims = 5, maxTokens = 800 } = options;

  if (!xmlDir) {
    return null;
  }

  const xmlPath = findXmlPath(patentId, xmlDir);
  if (!xmlPath) {
    return null;
  }

  const claimsData = parsePatentClaims(xmlPath);
  if (claimsData.parseError || claimsData.claims.length === 0) {
    return null;
  }

  // Select which claims to include
  const selectedClaims = independentOnly
    ? claimsData.independentClaims
    : claimsData.claims;

  // Limit number of claims
  const limitedClaims = selectedClaims.slice(0, maxClaims);

  // Build text with token limit
  const charLimit = maxTokens * 4;  // Rough estimate: 4 chars per token
  let result = '';
  let totalChars = 0;

  for (const claim of limitedClaims) {
    const claimText = `Claim ${claim.number}: ${claim.text}\n\n`;

    if (totalChars + claimText.length > charLimit) {
      // Truncate this claim if needed
      const remaining = charLimit - totalChars;
      if (remaining > 100) {  // Only add if meaningful space
        result += `Claim ${claim.number}: ${claim.text.substring(0, remaining - 50)}...\n\n`;
      }
      break;
    }

    result += claimText;
    totalChars += claimText.length;
  }

  return result.trim() || null;
}

/**
 * Get claims statistics for a patent
 */
export function getClaimsStats(patentId: string, xmlDir: string): {
  found: boolean;
  totalClaims: number;
  independentClaims: number;
  dependentClaims: number;
  totalChars: number;
  estimatedTokens: number;
} | null {
  if (!xmlDir) return null;

  const xmlPath = findXmlPath(patentId, xmlDir);
  if (!xmlPath) return null;

  const claimsData = parsePatentClaims(xmlPath);
  if (claimsData.parseError) return null;

  const totalChars = claimsData.claims.reduce((sum, c) => sum + c.text.length, 0);

  return {
    found: true,
    totalClaims: claimsData.totalClaimCount,
    independentClaims: claimsData.independentClaimCount,
    dependentClaims: claimsData.dependentClaims.length,
    totalChars,
    estimatedTokens: Math.ceil(totalChars / 4),
  };
}

/**
 * Batch extract claims for multiple patents
 * Returns a map of patentId -> claims text
 */
export function extractClaimsBatch(
  patentIds: string[],
  xmlDir: string = process.env.USPTO_PATENT_GRANT_XML_DIR || '',
  options: ClaimsExtractionOptions = {},
  progressCallback?: (current: number, total: number) => void
): Map<string, string | null> {
  const results = new Map<string, string | null>();

  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    results.set(patentId, extractClaimsText(patentId, xmlDir, options));

    if (progressCallback && (i + 1) % 100 === 0) {
      progressCallback(i + 1, patentIds.length);
    }
  }

  return results;
}

// ============================================================================
// Full Patent Enrichment from XML
// ============================================================================

export interface PatentEnrichmentResult {
  patentId: string;
  status: 'enriched' | 'skipped' | 'failed';
  error?: string;
}

/**
 * Extract full metadata from a single patent XML file using regex
 * (same patterns as hydrateBlock() in manifest-search-service.ts).
 */
function extractMetadataFromXml(xmlText: string): {
  title: string;
  abstract: string | null;
  assignees: string[];
  inventors: string[];
  grantDate: string | null;
  filingDate: string | null;
} {
  // Title
  const title = xmlText.match(/<invention-title[^>]*>([^<]+)<\/invention-title>/)?.[1]?.trim() || '';

  // Abstract
  const abstractMatch = xmlText.match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/);
  let abstract: string | null = null;
  if (abstractMatch) {
    abstract = abstractMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Assignee organizations
  const assignees: string[] = [];
  const assigneeRegex = /<assignee>\s*<addressbook>\s*<orgname>([^<]+)<\/orgname>/gs;
  let m;
  while ((m = assigneeRegex.exec(xmlText)) !== null) {
    assignees.push(m[1].trim());
  }

  // Inventors (applicant-inventor first, fallback to <inventor>)
  const inventors: string[] = [];
  const inventorRegex = /<applicant[^>]*app-type="applicant-inventor"[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
  while ((m = inventorRegex.exec(xmlText)) !== null) {
    inventors.push(`${m[2].trim()} ${m[1].trim()}`);
  }
  if (inventors.length === 0) {
    const invRegex2 = /<inventor[^>]*>[\s\S]*?<last-name>([^<]+)<\/last-name>[\s\S]*?<first-name>([^<]+)<\/first-name>/gs;
    while ((m = invRegex2.exec(xmlText)) !== null) {
      inventors.push(`${m[2].trim()} ${m[1].trim()}`);
    }
  }

  // Grant date from <publication-reference>...<date>
  const grantDateRaw = xmlText.match(
    /<publication-reference>\s*<document-id[^>]*>[\s\S]*?<date>(\d{8})<\/date>/
  )?.[1];
  const grantDate = grantDateRaw ? formatXmlDate(grantDateRaw) : null;

  // Filing date from <application-reference>...<date>
  const filingDateRaw = xmlText.match(
    /<application-reference[^>]*>[\s\S]*?<date>(\d{8})<\/date>/
  )?.[1];
  const filingDate = filingDateRaw ? formatXmlDate(filingDateRaw) : null;

  return { title, abstract, assignees, inventors, grantDate, filingDate };
}

/**
 * Enrich a single patent with full metadata from its USPTO XML file.
 * Reads the XML, extracts title/abstract/dates/assignees/inventors/CPC,
 * computes derived fields, and upserts into Patent + PatentCpc tables.
 */
export async function enrichPatentFromXml(
  patentId: string,
  exportDir: string
): Promise<PatentEnrichmentResult> {
  try {
    const xmlPath = findXmlPath(patentId, exportDir);
    if (!xmlPath) {
      return { patentId, status: 'failed', error: 'XML file not found' };
    }

    const xmlText = fs.readFileSync(xmlPath, 'utf-8');
    const meta = extractMetadataFromXml(xmlText);

    if (!meta.title) {
      return { patentId, status: 'failed', error: 'No title found in XML' };
    }

    // Parse CPC codes using existing structured parser
    const cpcData = parsePatentXml(xmlPath);
    const cpcCodes = cpcData.cpcClassifications.map(c => c.code);

    // Compute derived fields
    const dateForTerm = meta.filingDate || meta.grantDate;
    const { remainingYears, isExpired } = calculateRemainingYears(dateForTerm);

    const primarySector = await getPrimarySectorAsync(cpcCodes, meta.title, meta.abstract || undefined);
    const superSector = primarySector ? await getSuperSectorAsync(primarySector) : null;

    // Get existing patent to preserve forwardCitations
    const existing = await prisma.patent.findUnique({
      where: { patentId },
      select: { forwardCitations: true },
    });
    const forwardCitations = existing?.forwardCitations || 0;

    const baseScore = calculateBaseScore({
      forwardCitations,
      remainingYears,
      grantDate: meta.grantDate,
      primarySector,
    });

    // Upsert Patent record
    await prisma.patent.upsert({
      where: { patentId },
      create: {
        patentId,
        title: meta.title,
        abstract: meta.abstract,
        grantDate: meta.grantDate,
        filingDate: meta.filingDate,
        assignee: meta.assignees.join('; '),
        inventors: meta.inventors,
        forwardCitations,
        remainingYears,
        isExpired,
        baseScore,
        primarySector,
        superSector,
        primaryCpc: cpcData.primaryCpc?.code || null,
        hasXmlData: true,
      },
      update: {
        title: meta.title,
        abstract: meta.abstract,
        grantDate: meta.grantDate,
        filingDate: meta.filingDate,
        assignee: meta.assignees.join('; '),
        inventors: meta.inventors,
        remainingYears,
        isExpired,
        baseScore,
        primarySector,
        superSector,
        primaryCpc: cpcData.primaryCpc?.code || null,
        hasXmlData: true,
      },
    });

    // Upsert PatentCpc records with isInventive designation
    for (const cpc of cpcData.cpcClassifications) {
      await prisma.patentCpc.upsert({
        where: { patentId_cpcCode: { patentId, cpcCode: cpc.code } },
        create: {
          patentId,
          cpcCode: cpc.code,
          isInventive: cpc.designation === 'I',
        },
        update: {
          isInventive: cpc.designation === 'I',
        },
      });
    }

    return { patentId, status: 'enriched' };
  } catch (error) {
    return { patentId, status: 'failed', error: (error as Error).message };
  }
}

/**
 * Batch enrich patents from USPTO XML files.
 * Skips patents that already have hasXmlData=true and a non-empty title.
 */
export async function enrichPatentsFromXml(
  patentIds: string[],
  exportDir: string,
  onProgress?: (msg: string) => void
): Promise<{ enriched: string[]; failed: string[]; skipped: string[] }> {
  const enriched: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  // Check which patents already have XML data
  const existing = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, title: true, hasXmlData: true },
  });
  const existingMap = new Map(existing.map(p => [p.patentId, p]));

  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    const row = existingMap.get(patentId);

    // Skip if already enriched with XML data and has a title
    if (row?.hasXmlData && row.title && row.title.length > 0) {
      skipped.push(patentId);
      continue;
    }

    const result = await enrichPatentFromXml(patentId, exportDir);

    if (result.status === 'enriched') {
      enriched.push(patentId);
    } else if (result.status === 'failed') {
      failed.push(patentId);
      if (onProgress) onProgress(`Failed ${patentId}: ${result.error}`);
    }

    if (onProgress && (i + 1) % 10 === 0) {
      onProgress(`Progress: ${i + 1}/${patentIds.length} (enriched: ${enriched.length}, failed: ${failed.length}, skipped: ${skipped.length})`);
    }
  }

  if (onProgress) {
    onProgress(`Done: ${enriched.length} enriched, ${failed.length} failed, ${skipped.length} skipped`);
  }

  return { enriched, failed, skipped };
}
