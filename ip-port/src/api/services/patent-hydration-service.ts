/**
 * Patent Hydration Service
 *
 * Fetches basic patent data from PatentsView API and writes it to the
 * Postgres Patent table. Used to fill in "bare" Patent rows that were
 * created with just a patentId (e.g., during migration or import).
 *
 * Also computes:
 *   - primarySector / superSector from CPC codes
 *   - baseScore using multi-factor formula (citations + time + velocity × sector × expired)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { getPrimarySectorAsync, getSuperSectorAsync } from '../utils/sector-mapper.js';

const prisma = new PrismaClient();

const PATENTSVIEW_CACHE_DIR = path.join(process.cwd(), 'cache/api/patentsview/patent');
const CONFIG_DIR = path.join(process.cwd(), 'config');

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

export function calculateRemainingYears(dateStr: string | null): { remainingYears: number; isExpired: boolean } {
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
// Base Score Calculation
// Same formula as scripts/recalculate-base-scores.ts
// ─────────────────────────────────────────────────────────────────────────────

let sectorDamagesCache: Map<string, number> | null = null;

function loadSectorDamages(): Map<string, number> {
  if (sectorDamagesCache) return sectorDamagesCache;
  sectorDamagesCache = new Map();
  try {
    const configPath = path.join(CONFIG_DIR, 'sector-damages.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    for (const [sectorKey, data] of Object.entries(config.sectors as Record<string, { damages_rating: number }>)) {
      sectorDamagesCache.set(sectorKey, data.damages_rating || 1);
    }
  } catch {
    // Use defaults
  }
  return sectorDamagesCache;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateBaseScore(params: {
  forwardCitations: number;
  remainingYears: number;
  grantDate: string | null;
  primarySector: string | null;
}): number {
  const { forwardCitations, remainingYears, grantDate, primarySector } = params;

  // Years since grant (for velocity calculation)
  let yearsSinceGrant = 10; // default
  if (grantDate) {
    const grant = new Date(grantDate);
    if (!isNaN(grant.getTime())) {
      const years = (Date.now() - grant.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      yearsSinceGrant = Math.max(years, 0.5);
    }
  }

  // Component 1: Citation Score (log-scaled, ×20 — was ×40)
  const citationScore = Math.log10(forwardCitations + 1) * 20;

  // Component 2: Time Score (remaining years factor, ×45 — was ×25, floor raised from -0.5 to 0)
  const timeFactor = clamp(remainingYears / 20, 0, 1.0);
  const timeScore = timeFactor * 45;

  // Component 3: Velocity Score (citations per year, ×15 — was ×20)
  const citationsPerYear = forwardCitations / yearsSinceGrant;
  const velocityScore = Math.log10(citationsPerYear + 1) * 15;

  // Component 4: Youth Bonus (up to 10 pts for patents < 5 yrs old with 15+ yrs remaining)
  let youthBonus = 0;
  if (yearsSinceGrant < 5 && remainingYears >= 15) {
    youthBonus = 10 * (1 - yearsSinceGrant / 5);
  }

  // Component 5: Sector Multiplier
  let sectorMultiplier = 1.0;
  if (primarySector) {
    const damages = loadSectorDamages();
    const rating = damages.get(primarySector) || 1;
    sectorMultiplier = 0.8 + (rating - 1) * 0.233;
  }

  // Component 6: Expired Multiplier
  const expiredMultiplier = remainingYears <= 0 ? 0.1 : 1.0;

  const rawScore = citationScore + timeScore + velocityScore + youthBonus;
  const finalScore = rawScore * sectorMultiplier * expiredMultiplier;
  return Math.round(finalScore * 100) / 100;
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

  // Step 1: Query Patent table — identify rows needing hydration
  // Check title, abstract, AND remainingYears: import creates rows with title
  // but no abstract/filingDate/remainingYears, so title alone isn't sufficient.
  const existing = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, title: true, abstract: true, remainingYears: true },
  });
  const existingMap = new Map(existing.map(p => [p.patentId, p]));

  const toFetch: string[] = [];
  let alreadyComplete = 0;

  for (const id of patentIds) {
    const row = existingMap.get(id);
    if (!row) {
      toFetch.push(id); // Patent row doesn't exist at all
    } else if (force || !row.title || row.title === '' || row.abstract === null || row.remainingYears === null) {
      toFetch.push(id); // Partially hydrated or bare row
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

      // Compute sector from CPC codes (uses DB rules first, config fallback)
      const primarySector = await getPrimarySectorAsync(cpcCodes, pvData.patent_title, pvData.patent_abstract) || null;
      const superSector = primarySector ? await getSuperSectorAsync(primarySector) : null;
      const primaryCpc = cpcCodes[0] || null;

      // Compute base score
      const baseScore = calculateBaseScore({
        forwardCitations,
        remainingYears,
        grantDate,
        primarySector,
      });

      // Upsert Patent row
      const patentData = {
        title: pvData.patent_title || '',
        abstract: pvData.patent_abstract || null,
        grantDate,
        filingDate,
        assignee: assigneeOrg,
        inventors,
        forwardCitations,
        remainingYears,
        isExpired,
        baseScore,
        primarySector,
        superSector,
        primaryCpc,
        ...(affiliate && { affiliate }),
      };

      await prisma.patent.upsert({
        where: { patentId },
        create: { patentId, ...patentData },
        update: patentData,
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
