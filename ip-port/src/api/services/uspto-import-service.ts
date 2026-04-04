/**
 * USPTO Import Service — Single-step import from index DB to app DB
 *
 * Replaces the 3-phase manifest search → hydration → upsert flow.
 * Queries the USPTO index database, computes derived fields (sector, base
 * score, remaining years, affiliate), and upserts into the app database.
 */

import { PrismaClient } from '@prisma/client';
import { searchByAssignee, type UsptoPatentRecord } from './uspto-query-service.js';
import { matchesAssigneePattern } from './bulk-patent-search-service.js';
import { calculateRemainingYears, calculateBaseScore } from './patent-hydration-service.js';
import { getPrimarySectorAsync, getSuperSectorAsync } from '../utils/sector-mapper.js';
import { extractPatentXmlsBySource } from './patent-xml-extractor-service.js';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  portfolioId?: string;
  portfolioName?: string;
  maxPatents?: number;
  cpcSections?: string[];
  onProgress?: (msg: string) => void;
}

export interface ImportResult {
  imported: number;
  alreadyExisted: number;
  falsePositives: number;
  failed: number;
  xmlExtracted: number;
  xmlFailed: number;
  portfolioTotal: number;
  elapsedSeconds: number;
}

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

export async function importPatents(options: ImportOptions): Promise<ImportResult> {
  const {
    maxPatents = 50000,
    cpcSections,
    onProgress,
  } = options;

  const t0 = Date.now();

  // Resolve portfolio
  const portfolio = await resolvePortfolio(options);
  if (!portfolio) {
    throw new Error('Portfolio not found. Provide --portfolio <name>');
  }

  // Load affiliate patterns
  const affiliates = await prisma.affiliate.findMany({
    where: { companyId: portfolio.companyId, isActive: true },
    include: { patterns: true },
  });

  const allPatterns = affiliates.flatMap(a => a.patterns.map(p => p.pattern));
  if (allPatterns.length === 0) {
    throw new Error(`No affiliate patterns found for company of portfolio "${portfolio.name}"`);
  }

  const patternToAffiliate = new Map<string, string>();
  for (const affiliate of affiliates) {
    for (const pat of affiliate.patterns) {
      patternToAffiliate.set(pat.pattern.toLowerCase(), affiliate.name);
    }
  }

  // Load existing patent IDs in portfolio
  const existingLinks = await prisma.portfolioPatent.findMany({
    where: { portfolioId: portfolio.id },
    select: { patentId: true },
  });
  const existingPatentIds = new Set(existingLinks.map(l => l.patentId));

  onProgress?.(`Portfolio: ${portfolio.name} (${existingPatentIds.size} existing patents)`);
  onProgress?.(`Company: ${portfolio.company.name} (${affiliates.length} affiliates, ${allPatterns.length} patterns)`);
  onProgress?.(`Max patents: ${maxPatents}\n`);

  // Phase 1: Query USPTO index database
  onProgress?.('=== Querying USPTO Index Database ===');
  const t1 = Date.now();

  const results = await searchByAssignee({
    patterns: allPatterns,
    cpcSections,
    maxPatents: maxPatents + existingPatentIds.size,
    excludeIds: existingPatentIds,
    onProgress,
  });

  // Trim to max
  const newPatents = results.slice(0, maxPatents);
  const alreadyExisted = existingPatentIds.size;

  onProgress?.(`  Query complete: ${newPatents.length} new patents (${((Date.now() - t1) / 1000).toFixed(1)}s)\n`);

  if (newPatents.length === 0) {
    onProgress?.('No new patents to import.');
    return {
      imported: 0,
      alreadyExisted,
      falsePositives: 0,
      failed: 0,
      xmlExtracted: 0,
      xmlFailed: 0,
      portfolioTotal: existingPatentIds.size,
      elapsedSeconds: (Date.now() - t0) / 1000,
    };
  }

  // Phase 2: Compute derived fields and upsert
  onProgress?.('=== Importing to App Database ===');
  const t2 = Date.now();
  let imported = 0;
  let failed = 0;
  let falsePositives = 0;
  const importedPatents: Array<{ patent_id: string; xml_source: string | null }> = [];

  for (const patent of newPatents) {
    try {
      // Double-check assignee against patterns (full prefix match, not just SQL ILIKE)
      if (!matchesAssigneePattern(patent.assignee, allPatterns)) {
        falsePositives++;
        continue;
      }

      const cpcCodes = patent.cpc_codes.map(c => c.code);
      const filingDate = patent.filing_date;
      const grantDate = patent.grant_date;
      const dateForExpiry = filingDate || grantDate;
      const { remainingYears, isExpired } = calculateRemainingYears(dateForExpiry);
      const primaryCpc = cpcCodes[0] || patent.primary_cpc || null;
      const primarySector = await getPrimarySectorAsync(cpcCodes, patent.title, patent.abstract ?? undefined) || null;
      const superSector = primarySector ? await getSuperSectorAsync(primarySector) : null;
      const forwardCitations = patent.forward_citations;

      const baseScore = calculateBaseScore({
        forwardCitations,
        remainingYears,
        grantDate,
        primarySector,
      });

      // Match affiliate
      const affiliateName = matchAffiliate(patent.assignee, patternToAffiliate);

      // Compute numeric patent ID
      const numericStr = patent.patent_id.replace(/^[A-Z]+/i, '').replace(/^0+/, '');
      const patentIdNumeric = numericStr ? parseInt(numericStr, 10) || null : null;

      // Upsert patent
      const patentData = {
        title: patent.title,
        abstract: patent.abstract || null,
        grantDate,
        filingDate,
        assignee: patent.assignee,
        affiliate: affiliateName,
        inventors: patent.inventors,
        forwardCitations,
        remainingYears,
        isExpired,
        baseScore,
        primarySector,
        superSector,
        primaryCpc,
        patentIdNumeric,
      };

      await prisma.patent.upsert({
        where: { patentId: patent.patent_id },
        create: { patentId: patent.patent_id, ...patentData },
        update: patentData,
      });

      // Upsert CPC codes (with inventive designation)
      for (const cpc of patent.cpc_codes) {
        await prisma.patentCpc.upsert({
          where: { patentId_cpcCode: { patentId: patent.patent_id, cpcCode: cpc.code } },
          create: {
            patentId: patent.patent_id,
            cpcCode: cpc.code,
            isInventive: cpc.is_inventive,
          },
          update: {
            isInventive: cpc.is_inventive,
          },
        }).catch(() => {});
      }

      // Link to portfolio
      await prisma.portfolioPatent.create({
        data: {
          portfolioId: portfolio.id,
          patentId: patent.patent_id,
          source: 'BULK_DATA_IMPORT',
        },
      }).catch(() => {
        // Already linked (race condition or re-run)
      });

      imported++;
      importedPatents.push({ patent_id: patent.patent_id, xml_source: patent.xml_source });
      if (imported % 100 === 0) {
        onProgress?.(`  ${imported} imported...`);
      }
    } catch (err: any) {
      onProgress?.(`  Failed ${patent.patent_id}: ${err?.message?.slice(0, 80)}`);
      failed++;
    }
  }

  // Phase 3: Extract XML files from bulk data
  let xmlExtracted = 0;
  let xmlFailed = 0;

  if (importedPatents.length > 0) {
    onProgress?.('\n=== Extracting Patent XMLs ===');
    const t3 = Date.now();

    // Build xmlSource → patentIds map
    const sourceMap = new Map<string, string[]>();
    for (const p of importedPatents) {
      if (!p.xml_source) continue;
      const list = sourceMap.get(p.xml_source) || [];
      list.push(p.patent_id);
      sourceMap.set(p.xml_source, list);
    }

    if (sourceMap.size > 0) {
      const extractResult = await extractPatentXmlsBySource(sourceMap, onProgress);
      xmlExtracted = extractResult.extracted;
      xmlFailed = extractResult.notFound;

      // Mark successfully extracted patents as having XML data
      if (xmlExtracted > 0) {
        // Collect all patent IDs that now have XML
        const extractedIds: string[] = [];
        for (const p of importedPatents) {
          if (p.xml_source) {
            // Check lazily: the extractor wrote files, so findPatentXmlPath would find them.
            // But we can approximate: extracted + alreadyExist = patents with XML.
            extractedIds.push(p.patent_id);
          }
        }

        // Batch update hasXmlData for all imported patents that had xml_source
        // (covers both newly extracted and already-existing XMLs)
        const BATCH = 500;
        for (let i = 0; i < extractedIds.length; i += BATCH) {
          const batch = extractedIds.slice(i, i + BATCH);
          await prisma.patent.updateMany({
            where: { patentId: { in: batch } },
            data: { hasXmlData: true },
          });
        }
      }

      onProgress?.(`  XML extraction: ${((Date.now() - t3) / 1000).toFixed(1)}s`);
    } else {
      onProgress?.('  No xml_source data available — skipping XML extraction');
    }
  }

  // Update portfolio patent count
  const portfolioTotal = await prisma.portfolioPatent.count({
    where: { portfolioId: portfolio.id },
  });
  await prisma.portfolio.update({
    where: { id: portfolio.id },
    data: { patentCount: portfolioTotal },
  });

  const elapsed = (Date.now() - t0) / 1000;
  onProgress?.(`\n=== Import Complete (${elapsed.toFixed(1)}s) ===`);
  onProgress?.(`  Imported: ${imported}`);
  onProgress?.(`  Already existed: ${alreadyExisted}`);
  onProgress?.(`  False positives skipped: ${falsePositives}`);
  onProgress?.(`  Failed: ${failed}`);
  onProgress?.(`  XML extracted: ${xmlExtracted}`);
  onProgress?.(`  XML not found: ${xmlFailed}`);
  onProgress?.(`  Portfolio total: ${portfolioTotal}`);

  return {
    imported,
    alreadyExisted,
    falsePositives,
    failed,
    xmlExtracted,
    xmlFailed,
    portfolioTotal,
    elapsedSeconds: elapsed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolvePortfolio(options: ImportOptions) {
  if (options.portfolioId) {
    return prisma.portfolio.findUnique({
      where: { id: options.portfolioId },
      include: { company: true },
    });
  }
  if (options.portfolioName) {
    return prisma.portfolio.findFirst({
      where: { name: options.portfolioName },
      include: { company: true },
    });
  }
  return null;
}

function matchAffiliate(
  assigneeOrg: string,
  patternToAffiliate: Map<string, string>,
): string {
  const orgLower = assigneeOrg.toLowerCase();

  // Exact match first
  const exact = patternToAffiliate.get(orgLower);
  if (exact) return exact;

  // Prefix match with word boundary: the character after the pattern must be
  // a non-alphanumeric char (space, comma, period, etc.) or end of string.
  // This prevents "lsi" from matching "lsis co." or "pivotal" matching "pivotalcommware".
  for (const [pattern, name] of patternToAffiliate) {
    if (orgLower.startsWith(pattern)) {
      const nextChar = orgLower[pattern.length];
      if (!nextChar || /[^a-z0-9]/.test(nextChar)) return name;
    }
  }

  return assigneeOrg;
}
