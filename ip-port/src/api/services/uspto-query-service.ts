/**
 * USPTO Query Service — Read from index database
 *
 * Fast SQL queries against the ip_portfolio_uspto database.
 * Replaces manifest-search-service + hydrateFromXml with single-step queries.
 */

import { getUsptoPrisma } from '../../lib/uspto-prisma.js';
import { Prisma } from '../../../node_modules/.prisma/uspto-client/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsptoPatentRecord {
  patent_id: string;
  title: string;
  abstract: string | null;
  grant_date: string | null;  // YYYY-MM-DD
  filing_date: string | null; // YYYY-MM-DD
  assignee: string;
  inventors: string[];
  patent_type: string;
  kind_code: string | null;
  forward_citations: number;
  primary_cpc: string | null;
  xml_source: string | null;
  cpc_codes: Array<{ code: string; is_inventive: boolean }>;
}

export interface AssigneeSearchOptions {
  patterns: string[];
  cpcSections?: string[];
  maxPatents?: number;
  excludeIds?: Set<string>;
  onProgress?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Assignee search
// ---------------------------------------------------------------------------

/**
 * Search indexed patents by assignee prefix patterns.
 * Uses the btree text_pattern_ops index for fast prefix matching.
 */
export async function searchByAssignee(
  options: AssigneeSearchOptions,
): Promise<UsptoPatentRecord[]> {
  const {
    patterns,
    cpcSections,
    maxPatents = 50000,
    excludeIds,
    onProgress,
  } = options;

  if (patterns.length === 0) return [];

  const usptoDb = getUsptoPrisma();

  // Build WHERE clause for assignee prefix matching with word boundary.
  // Each pattern becomes: assignee ~* '^pattern([^a-z0-9]|$)'
  // This prevents "lsi" from matching "LSIS Co." or "pivotal" from matching "Pivotal Commware".
  const assigneeConditions = patterns.map(
    (_, i) => `ip.assignee ~* $${i + 1}`
  );
  const assigneeParams = patterns.map(p => {
    // Escape regex special characters in the pattern
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^${escaped}([^a-z0-9]|$)`;
  });

  // CPC section filter
  let cpcFilter = '';
  if (cpcSections?.length) {
    const sectionPlaceholders = cpcSections.map((_, i) => `$${patterns.length + i + 1}`);
    cpcFilter = `AND (ip.cpc_section IN (${sectionPlaceholders.join(',')}) OR ip.cpc_section IS NULL)`;
  }

  const params = [...assigneeParams, ...(cpcSections || [])];

  // Query patents with CPC codes
  const query = `
    SELECT
      ip.patent_id,
      ip.title,
      ip.abstract,
      ip.grant_date::text,
      ip.filing_date::text,
      ip.assignee,
      ip.inventors,
      ip.patent_type,
      ip.kind_code,
      ip.forward_citations,
      ip.primary_cpc,
      ip.xml_source
    FROM indexed_patents ip
    WHERE (${assigneeConditions.join(' OR ')})
    ${cpcFilter}
    ORDER BY ip.grant_date DESC
    LIMIT ${maxPatents}
  `;

  onProgress?.(`Querying USPTO index for ${patterns.length} assignee patterns...`);

  const patents: any[] = await usptoDb.$queryRawUnsafe(query, ...params);

  onProgress?.(`  Found ${patents.length} patents`);

  // Filter out excluded IDs
  let filtered = patents;
  if (excludeIds && excludeIds.size > 0) {
    filtered = patents.filter(p => !excludeIds.has(p.patent_id));
    onProgress?.(`  After excluding existing: ${filtered.length}`);
  }

  // Load CPC codes for matched patents in batches
  const patentIds = filtered.map(p => p.patent_id);
  const cpcMap = await getCpcCodesBatch(patentIds);

  return filtered.map(p => ({
    patent_id: p.patent_id,
    title: p.title || '',
    abstract: p.abstract || null,
    grant_date: p.grant_date || null,
    filing_date: p.filing_date || null,
    assignee: p.assignee || '',
    inventors: p.inventors || [],
    patent_type: p.patent_type || 'utility',
    kind_code: p.kind_code || null,
    forward_citations: p.forward_citations || 0,
    primary_cpc: p.primary_cpc || null,
    xml_source: p.xml_source || null,
    cpc_codes: cpcMap.get(p.patent_id) || [],
  }));
}

/**
 * Batch lookup patents by IDs.
 */
export async function getPatentsByIds(ids: string[]): Promise<Map<string, UsptoPatentRecord>> {
  if (ids.length === 0) return new Map();

  const usptoDb = getUsptoPrisma();
  const BATCH_SIZE = 1000;
  const results = new Map<string, UsptoPatentRecord>();

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    const patents = await usptoDb.indexedPatent.findMany({
      where: { patentId: { in: batch } },
    });

    const cpcMap = await getCpcCodesBatch(batch);

    for (const p of patents) {
      results.set(p.patentId, {
        patent_id: p.patentId,
        title: p.title || '',
        abstract: p.abstract || null,
        grant_date: p.grantDate ? p.grantDate.toISOString().slice(0, 10) : null,
        filing_date: p.filingDate ? p.filingDate.toISOString().slice(0, 10) : null,
        assignee: p.assignee || '',
        inventors: p.inventors || [],
        patent_type: p.patentType || 'utility',
        kind_code: p.kindCode || null,
        forward_citations: p.forwardCitations || 0,
        primary_cpc: p.primaryCpc || null,
        xml_source: p.xmlSource || null,
        cpc_codes: cpcMap.get(p.patentId) || [],
      });
    }
  }

  return results;
}

/**
 * Get forward citation counts for a list of patent IDs.
 */
export async function getForwardCitationCounts(ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();

  const usptoDb = getUsptoPrisma();
  const results = new Map<string, number>();

  const BATCH_SIZE = 1000;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);

    const patents = await usptoDb.indexedPatent.findMany({
      where: { patentId: { in: batch } },
      select: { patentId: true, forwardCitations: true },
    });

    for (const p of patents) {
      results.set(p.patentId, p.forwardCitations);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCpcCodesBatch(
  patentIds: string[],
): Promise<Map<string, Array<{ code: string; is_inventive: boolean }>>> {
  if (patentIds.length === 0) return new Map();

  const usptoDb = getUsptoPrisma();
  const result = new Map<string, Array<{ code: string; is_inventive: boolean }>>();

  const BATCH_SIZE = 1000;
  for (let i = 0; i < patentIds.length; i += BATCH_SIZE) {
    const batch = patentIds.slice(i, i + BATCH_SIZE);

    const cpcs = await usptoDb.indexedPatentCpc.findMany({
      where: { patentId: { in: batch } },
      select: { patentId: true, cpcCode: true, isInventive: true },
      orderBy: { position: 'asc' },
    });

    for (const cpc of cpcs) {
      const existing = result.get(cpc.patentId) || [];
      existing.push({ code: cpc.cpcCode, is_inventive: cpc.isInventive });
      result.set(cpc.patentId, existing);
    }
  }

  return result;
}
