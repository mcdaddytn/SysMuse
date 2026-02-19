/**
 * Patent Hydration Service
 *
 * Fetches basic patent data from PatentsView API and writes it to the
 * Postgres Patent table. Used to fill in "bare" Patent rows that were
 * created with just a patentId (e.g., during migration or import).
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PATENTSVIEW_CACHE_DIR = path.join(process.cwd(), 'cache/api/patentsview/patent');

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface HydrationResult {
  hydrated: number;
  alreadyComplete: number;
  notFound: number;
  failedIds: string[];
}

export interface HydrationOptions {
  force?: boolean;       // Re-fetch even if title exists
  companyId?: string;    // Match affiliates to set Patent.affiliate field
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: calculate remaining years from filing date (20-year term)
// ─────────────────────────────────────────────────────────────────────────────

function calculateRemainingYears(dateStr: string | null): { remainingYears: number; isExpired: boolean } {
  if (!dateStr) return { remainingYears: 0, isExpired: false };
  const filingDate = new Date(dateStr);
  if (isNaN(filingDate.getTime())) return { remainingYears: 0, isExpired: false };
  const expirationDate = new Date(filingDate);
  expirationDate.setFullYear(expirationDate.getFullYear() + 20);
  const now = new Date();
  const diffMs = expirationDate.getTime() - now.getTime();
  const years = diffMs / (365.25 * 24 * 60 * 60 * 1000);
  const rounded = Math.round(Math.max(0, years) * 10) / 10;
  return { remainingYears: rounded, isExpired: rounded <= 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: hydratePatents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hydrate bare Patent rows with data from PatentsView API.
 * Bare = title is empty/default.
 */
export async function hydratePatents(
  patentIds: string[],
  options?: HydrationOptions
): Promise<HydrationResult> {
  if (patentIds.length === 0) {
    return { hydrated: 0, alreadyComplete: 0, notFound: 0, failedIds: [] };
  }

  const force = options?.force ?? false;
  const companyId = options?.companyId;

  // Step 1: Query Patent table — identify bare rows
  const existing = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, title: true },
  });
  const existingMap = new Map(existing.map(p => [p.patentId, p]));

  const toFetch: string[] = [];
  let alreadyComplete = 0;

  for (const id of patentIds) {
    const row = existingMap.get(id);
    if (!row) {
      toFetch.push(id); // Patent row doesn't exist at all
    } else if (force || !row.title || row.title === '') {
      toFetch.push(id); // Bare row
    } else {
      alreadyComplete++;
    }
  }

  if (toFetch.length === 0) {
    console.log(`[Hydration] All ${alreadyComplete} patents already complete`);
    return { hydrated: 0, alreadyComplete, notFound: 0, failedIds: [] };
  }

  console.log(`[Hydration] Fetching ${toFetch.length} patents from PatentsView API...`);

  // Step 2: Fetch from PatentsView API in batches of 100
  const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
  const pvClient = createPatentsViewClient();

  const fetchedMap = new Map<string, any>();
  const batchSize = 100;

  for (let i = 0; i < toFetch.length; i += batchSize) {
    const batch = toFetch.slice(i, i + batchSize);
    try {
      const patents = await pvClient.getPatentsBatch(batch, [
        'patent_id',
        'patent_title',
        'patent_abstract',
        'patent_date',
        'patent_type',
        'patent_num_times_cited_by_us_patents',
        'assignees',
        'inventors',
        'cpc_current',
        'application',
      ]);
      for (const p of patents) {
        fetchedMap.set(p.patent_id, p);
      }
    } catch (err) {
      console.error(`[Hydration] Batch fetch failed for ${batch.length} patents:`, err);
    }

    // Rate limiting between batches
    if (i + batchSize < toFetch.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // Step 3: Load affiliate patterns if companyId provided
  let affiliatePatterns: Array<{ affiliateName: string; pattern: string; isExact: boolean }> = [];
  if (companyId) {
    const affiliates = await prisma.affiliate.findMany({
      where: { companyId },
      include: { patterns: true },
    });
    for (const aff of affiliates) {
      for (const pat of aff.patterns) {
        affiliatePatterns.push({
          affiliateName: aff.name,
          pattern: pat.pattern,
          isExact: pat.isExact,
        });
      }
    }
  }

  // Step 4: Update Patent rows and upsert CPC codes
  let hydrated = 0;
  const failedIds: string[] = [];

  for (const patentId of toFetch) {
    const pvData = fetchedMap.get(patentId);
    if (!pvData) {
      failedIds.push(patentId);
      continue;
    }

    try {
      const assigneeOrg = pvData.assignees?.[0]?.assignee_organization || '';
      const inventors = (pvData.inventors || []).map(
        (inv: any) => `${inv.inventor_name_first || ''} ${inv.inventor_name_last || ''}`.trim()
      ).filter(Boolean);

      const cpcData = pvData.cpc_current || pvData.cpc || [];
      const cpcCodes: string[] = cpcData
        .map((c: any) => c.cpc_subgroup_id || c.cpc_group_id || '')
        .filter(Boolean);

      const filingDate = pvData.application?.[0]?.filing_date || null;
      const grantDate = pvData.patent_date || null;
      const forwardCitations = pvData.patent_num_times_cited_by_us_patents || 0;

      // Use filing date for remaining years calculation; fall back to grant date
      const dateForExpiry = filingDate || grantDate;
      const { remainingYears, isExpired } = calculateRemainingYears(dateForExpiry);

      // Match affiliate
      let affiliate: string | null = null;
      if (assigneeOrg && affiliatePatterns.length > 0) {
        for (const ap of affiliatePatterns) {
          if (ap.isExact) {
            if (assigneeOrg === ap.pattern) {
              affiliate = ap.affiliateName;
              break;
            }
          } else {
            if (assigneeOrg.includes(ap.pattern)) {
              affiliate = ap.affiliateName;
              break;
            }
          }
        }
      }

      // Upsert Patent row
      await prisma.patent.upsert({
        where: { patentId },
        create: {
          patentId,
          title: pvData.patent_title || '',
          abstract: pvData.patent_abstract || null,
          grantDate,
          filingDate,
          assignee: assigneeOrg,
          inventors,
          forwardCitations,
          remainingYears,
          isExpired,
          ...(affiliate && { affiliate }),
        },
        update: {
          title: pvData.patent_title || '',
          abstract: pvData.patent_abstract || null,
          grantDate,
          filingDate,
          assignee: assigneeOrg,
          inventors,
          forwardCitations,
          remainingYears,
          isExpired,
          ...(affiliate && { affiliate }),
        },
      });

      // Upsert CPC codes
      for (const code of cpcCodes) {
        await prisma.patentCpc.upsert({
          where: { patentId_cpcCode: { patentId, cpcCode: code } },
          create: { patentId, cpcCode: code },
          update: {},
        });
      }

      // Write file cache for backward compat
      try {
        if (!fs.existsSync(PATENTSVIEW_CACHE_DIR)) {
          fs.mkdirSync(PATENTSVIEW_CACHE_DIR, { recursive: true });
        }
        const cachePath = path.join(PATENTSVIEW_CACHE_DIR, `${patentId}.json`);
        fs.writeFileSync(cachePath, JSON.stringify(pvData, null, 2));
      } catch {
        // Non-fatal
      }

      hydrated++;
    } catch (err) {
      console.error(`[Hydration] Failed to update patent ${patentId}:`, err);
      failedIds.push(patentId);
    }
  }

  const notFound = failedIds.length;
  console.log(`[Hydration] Done: ${hydrated} hydrated, ${alreadyComplete} already complete, ${notFound} not found`);
  return { hydrated, alreadyComplete, notFound, failedIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: hydratePortfolio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hydrate all bare patents in a portfolio.
 */
export async function hydratePortfolio(
  portfolioId: string,
  options?: { force?: boolean }
): Promise<HydrationResult & { totalInPortfolio: number }> {
  // Get portfolio with company
  const portfolio = await prisma.portfolio.findUnique({
    where: { id: portfolioId },
    select: { companyId: true },
  });
  if (!portfolio) {
    throw new Error(`Portfolio not found: ${portfolioId}`);
  }

  // Get all patent IDs in portfolio
  const links = await prisma.portfolioPatent.findMany({
    where: { portfolioId },
    select: { patentId: true },
  });
  const patentIds = links.map(l => l.patentId);

  const result = await hydratePatents(patentIds, {
    force: options?.force,
    companyId: portfolio.companyId,
  });

  return { ...result, totalInPortfolio: patentIds.length };
}
