/**
 * Portfolio management routes — CRUD for portfolios, patent listing,
 * patent import, and the two-step analyze → create-from-patents flow.
 *
 * Affiliates have moved to companies.routes.ts (affiliates belong to companies, not portfolios).
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// =============================================================================
// PORTFOLIO CRUD
// =============================================================================

/** GET /api/portfolios — list all portfolios with stats, company info */
router.get('/', async (req: Request, res: Response) => {
  try {
    const where: Record<string, unknown> = {};
    if (req.query.companyId) {
      where.companyId = req.query.companyId;
    }

    const portfolios = await prisma.portfolio.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, displayName: true } },
        _count: { select: { patents: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(portfolios);
  } catch (err: unknown) {
    console.error('[Portfolios] List error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/portfolios/:id — portfolio detail with company affiliates & patterns */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: req.params.id },
      include: {
        company: {
          include: {
            affiliates: {
              include: { patterns: true, children: { select: { id: true, name: true } } },
              orderBy: { name: 'asc' },
            },
          },
        },
        _count: { select: { patents: true } },
      },
    });
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }
    res.json(portfolio);
  } catch (err: unknown) {
    console.error('[Portfolios] Get error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/portfolios — create portfolio (requires companyId) */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, companyId } = req.body;
    if (!name || !displayName || !companyId) {
      return res.status(400).json({ error: 'name, displayName, and companyId are required' });
    }
    const portfolio = await prisma.portfolio.create({
      data: {
        name,
        displayName,
        description: description || null,
        companyId,
      },
    });
    res.status(201).json(portfolio);
  } catch (err: unknown) {
    console.error('[Portfolios] Create error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** PUT /api/portfolios/:id — update portfolio */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { displayName, description } = req.body;
    const portfolio = await prisma.portfolio.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(description !== undefined && { description }),
      },
    });
    res.json(portfolio);
  } catch (err: unknown) {
    console.error('[Portfolios] Update error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/portfolios/:id — delete portfolio (cascades patents) */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.portfolio.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Portfolios] Delete error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// ANALYZE PATENTS — preview assignee clusters before creating a portfolio
// =============================================================================

/** POST /api/portfolios/analyze-patents — analyze patent IDs to preview assignee clusters */
router.post('/analyze-patents', async (req: Request, res: Response) => {
  try {
    const { patentIds } = req.body;
    if (!patentIds?.length) {
      return res.status(400).json({ error: 'patentIds is required' });
    }

    // Resolve from cache
    const { resolvePatents } = await import('../services/patent-fetch-service.js');
    const resolved = resolvePatents(patentIds);
    const unresolvedIds = patentIds.filter((id: string) => !resolved.has(id));

    // Fetch unresolved from PatentsView
    let pvFetched = 0;
    if (unresolvedIds.length > 0) {
      try {
        const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
        const pvClient = createPatentsViewClient();
        const fetched = await pvClient.getPatentsBatch(unresolvedIds, [
          'patent_id', 'patent_title', 'patent_date',
          'assignees.assignee_organization',
        ]);
        for (const p of fetched) {
          resolved.set(p.patent_id, {
            patent_id: p.patent_id,
            patent_title: p.patent_title || '',
            patent_date: p.patent_date || '',
            assignee: p.assignees?.[0]?.assignee_organization || 'Unknown',
            affiliate: '',
            super_sector: '',
            primary_sector: '',
            cpc_codes: [],
            forward_citations: 0,
            remaining_years: 0,
            score: 0,
            in_portfolio: false,
            data_source: 'patentsview' as any,
          } as any);
          pvFetched++;
        }
      } catch (err) {
        console.warn('[AnalyzePatents] PatentsView fetch error:', (err as Error).message);
      }
    }

    // Cluster by assignee
    const assigneeClusters: Record<string, Array<{ patentId: string; title: string; date: string }>> = {};
    for (const [patentId, patent] of resolved) {
      const p = patent as any;
      const assignee = p.assignee || 'Unknown';
      if (!assigneeClusters[assignee]) assigneeClusters[assignee] = [];
      assigneeClusters[assignee].push({
        patentId,
        title: p.patent_title || '',
        date: p.patent_date || '',
      });
    }

    // Suggest affiliate names
    const suggestedAffiliates = Object.entries(assigneeClusters)
      .filter(([name]) => name !== 'Unknown')
      .map(([assignee, patents]) => ({
        assignee,
        suggestedName: assignee.replace(/,?\s*(Inc\.?|Corp\.?|Corporation|LLC|Ltd\.?|Co\.?)$/i, '').trim(),
        patentCount: patents.length,
        patents,
      }))
      .sort((a, b) => b.patentCount - a.patentCount);

    res.json({
      totalRequested: patentIds.length,
      resolved: resolved.size,
      fetchedFromPatentsView: pvFetched,
      stillUnresolved: patentIds.length - resolved.size,
      unresolvedIds: patentIds.filter((id: string) => !resolved.has(id)),
      suggestedAffiliates,
    });
  } catch (err: unknown) {
    console.error('[Portfolios] Analyze patents error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// CREATE FROM PATENTS — accepts pre-analyzed data from analyze-patents
// Two-step flow: 1) analyze-patents → user reviews → 2) create-from-patents
// =============================================================================

/** POST /api/portfolios/create-from-patents — create portfolio + company from analyzed patent data */
router.post('/create-from-patents', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, companyId, analyzedData } = req.body;
    if (!name || !displayName || !analyzedData?.suggestedAffiliates) {
      return res.status(400).json({
        error: 'name, displayName, and analyzedData (from analyze-patents) are required',
      });
    }

    const suggestedAffiliates: Array<{
      assignee: string;
      suggestedName: string;
      patentCount: number;
      patents: Array<{ patentId: string; title: string; date: string }>;
    }> = analyzedData.suggestedAffiliates;

    // Ensure a company exists — create one if companyId not provided
    let resolvedCompanyId = companyId;
    if (!resolvedCompanyId) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
      const company = await prisma.company.upsert({
        where: { name: slug },
        update: {},
        create: { name: slug, displayName },
      });
      resolvedCompanyId = company.id;
    }

    // Step 1: Create portfolio
    const portfolio = await prisma.portfolio.create({
      data: {
        name,
        displayName,
        description: description || null,
        companyId: resolvedCompanyId,
      },
    });

    // Step 2: Create affiliates under the company from analyzed clusters
    const affiliateResults: Array<{
      name: string; displayName: string; patternCount: number; patentCount: number;
    }> = [];

    for (const cluster of suggestedAffiliates) {
      await prisma.affiliate.upsert({
        where: { companyId_name: { companyId: resolvedCompanyId, name: cluster.suggestedName } },
        update: {},
        create: {
          companyId: resolvedCompanyId,
          name: cluster.suggestedName,
          displayName: cluster.assignee,
          patterns: {
            create: [{ pattern: cluster.assignee, isExact: false }],
          },
        },
      });

      affiliateResults.push({
        name: cluster.suggestedName,
        displayName: cluster.assignee,
        patternCount: 1,
        patentCount: cluster.patentCount,
      });

      // Step 3: Upsert Patent rows + PortfolioPatent join records
      for (const p of cluster.patents) {
        // Ensure Patent row exists
        await prisma.patent.upsert({
          where: { patentId: p.patentId },
          create: {
            patentId: p.patentId,
            title: p.title || '',
            grantDate: p.date || null,
            assignee: cluster.assignee,
            affiliate: cluster.suggestedName,
          },
          update: {},
        });
        // Link to portfolio
        await prisma.portfolioPatent.upsert({
          where: { portfolioId_patentId: { portfolioId: portfolio.id, patentId: p.patentId } },
          update: {},
          create: {
            portfolioId: portfolio.id,
            patentId: p.patentId,
            source: 'MANUAL',
          },
        });
      }
    }

    // Step 4: Update counts
    const patentCount = await prisma.portfolioPatent.count({ where: { portfolioId: portfolio.id } });
    const affiliateCount = await prisma.affiliate.count({ where: { companyId: resolvedCompanyId } });
    await prisma.portfolio.update({
      where: { id: portfolio.id },
      data: { patentCount, affiliateCount },
    });

    // Step 5: Fetch full details and compute derived fields for all patents
    const allPatentIds = suggestedAffiliates.flatMap((c: any) => c.patents.map((p: any) => p.patentId));
    if (allPatentIds.length > 0) {
      try {
        const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
        const pvClient = createPatentsViewClient();
        const { calculateRemainingYears, calculateBaseScore } = await import('../services/patent-hydration-service.js');
        const { getPrimarySectorAsync, getSuperSectorAsync } = await import('../utils/sector-mapper.js');

        // Batch-fetch full details
        const batchSize = 100;
        for (let i = 0; i < allPatentIds.length; i += batchSize) {
          const batch = allPatentIds.slice(i, i + batchSize);
          try {
            const patents = await pvClient.getPatentsBatch(batch, [
              'patent_id', 'patent_title', 'patent_abstract', 'patent_date', 'patent_type',
              'patent_num_times_cited_by_us_patents', 'assignees', 'inventors', 'cpc_current', 'application',
            ]);

            for (const pvData of patents) {
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
                const dateForExpiry = filingDate || grantDate;
                const { remainingYears, isExpired } = calculateRemainingYears(dateForExpiry);
                const primaryCpc = cpcCodes[0] || null;
                const primarySector = await getPrimarySectorAsync(cpcCodes, pvData.patent_title, pvData.patent_abstract) || null;
                const superSector = primarySector ? await getSuperSectorAsync(primarySector) : null;
                const baseScore = calculateBaseScore({ forwardCitations, remainingYears, grantDate, primarySector });

                await prisma.patent.update({
                  where: { patentId: pvData.patent_id },
                  data: {
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
                  },
                });

                for (const code of cpcCodes) {
                  await prisma.patentCpc.upsert({
                    where: { patentId_cpcCode: { patentId: pvData.patent_id, cpcCode: code } },
                    create: { patentId: pvData.patent_id, cpcCode: code },
                    update: {},
                  }).catch(() => {});
                }
              } catch (err) {
                console.error(`[CreateFromPatents] Failed to enrich patent ${pvData.patent_id}:`, err);
              }
            }
          } catch (err) {
            console.error(`[CreateFromPatents] Batch fetch failed:`, err);
          }

          // Rate limiting between batches
          if (i + batchSize < allPatentIds.length) {
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }

        // Run sector assignment as safety net
        import('../services/sector-assignment-service.js').then(({ reassignPortfolioPatents }) =>
          reassignPortfolioPatents({ portfolioId: portfolio.id })
        ).then((result) => {
          console.log(`[CreateFromPatents] Auto-sector assignment: ${result.assigned} assigned, ${result.noMatch} unmatched`);
        }).catch(err =>
          console.error('[CreateFromPatents] Sector-assignment failed:', err)
        );
      } catch (err) {
        console.error('[CreateFromPatents] Enrichment failed:', err);
      }
    }

    res.status(201).json({
      portfolio: { id: portfolio.id, name: portfolio.name, displayName: portfolio.displayName },
      affiliates: affiliateResults,
      patentCount,
    });
  } catch (err: unknown) {
    console.error('[Portfolios] Create from patents error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// PORTFOLIO PATENTS
// =============================================================================

/** GET /api/portfolios/:id/patents — list portfolio patents with pagination
 *  Now returns full Patent data (same shape as /api/patents) scoped to this portfolio.
 */
router.get('/:id/patents', async (req: Request, res: Response) => {
  try {
    const { getPatents } = await import('../services/patent-data-service.js');

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
    const sortBy = (req.query.sortBy as string) || 'score';
    const descending = req.query.descending !== 'false';

    const result = await getPatents({
      portfolioId: req.params.id,
      pagination: { page, limit, sortBy, descending },
    });

    res.json(result);
  } catch (err: unknown) {
    console.error('[Portfolios] List patents error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// PATENT COUNTS (PatentsView assignee search — count only)
// Uses company affiliates to search by assignee patterns
// =============================================================================

/** GET /api/portfolios/:id/patent-counts — per-affiliate patent counts from PatentsView */
router.get('/:id/patent-counts', async (req: Request, res: Response) => {
  try {
    const cpcPrefix = req.query.cpcPrefix as string | undefined;

    // Load portfolio to get companyId, then load company's affiliates
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: req.params.id },
      select: { companyId: true },
    });
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const affiliates = await prisma.affiliate.findMany({
      where: { companyId: portfolio.companyId },
      include: { patterns: true },
    });

    const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
    const pvClient = createPatentsViewClient();

    const results: Array<{
      affiliateId: string;
      affiliateName: string;
      totalCount: number;
      filteredCount: number | null;
    }> = [];

    for (const affiliate of affiliates) {
      let totalCount = 0;
      let filteredCount: number | null = null;

      for (const pat of affiliate.patterns) {
        try {
          const baseQuery: Record<string, unknown> = {
            _and: [{ _contains: { 'assignees.assignee_organization': pat.pattern } }],
          };

          const result = await pvClient.searchPatents({
            query: baseQuery,
            fields: ['patent_id'],
            options: { size: 1 },
          });
          totalCount += result.total_hits || 0;

          if (cpcPrefix) {
            const cpcQuery: Record<string, unknown> = {
              _and: [
                { _contains: { 'assignees.assignee_organization': pat.pattern } },
                { _begins: { 'cpc_current.cpc_group_id': cpcPrefix } },
              ],
            };
            const cpcResult = await pvClient.searchPatents({
              query: cpcQuery,
              fields: ['patent_id'],
              options: { size: 1 },
            });
            filteredCount = (filteredCount || 0) + (cpcResult.total_hits || 0);
          }
        } catch (err) {
          console.warn(`[PatentCounts] Error for pattern "${pat.pattern}":`, (err as Error).message);
        }
      }

      results.push({
        affiliateId: affiliate.id,
        affiliateName: affiliate.name,
        totalCount,
        filteredCount,
      });
    }

    res.json({ counts: results, cpcPrefix: cpcPrefix || null });
  } catch (err: unknown) {
    console.error('[Portfolios] Patent counts error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// HYDRATE PATENTS (fill bare Patent rows from PatentsView)
// =============================================================================

/** POST /api/portfolios/:id/hydrate — hydrate bare patents in a portfolio */
router.post('/:id/hydrate', async (req: Request, res: Response) => {
  try {
    const { force } = req.body || {};
    const { hydratePortfolio } = await import('../services/patent-hydration-service.js');
    const result = await hydratePortfolio(req.params.id, { force });
    res.json(result);
  } catch (err: unknown) {
    console.error('[Portfolios] Hydrate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// IMPORT PATENTS (PatentsView → Patent + PortfolioPatent records)
// Uses company affiliates for pattern matching
// =============================================================================

/** POST /api/portfolios/:id/import-patents — import patents from USPTO index database */
router.post('/:id/import-patents', async (req: Request, res: Response) => {
  try {
    const { maxPatents = 1000, cpcPrefixes: cpcSections } = req.body;
    const portfolioId = req.params.id;

    // Verify portfolio exists
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
      select: { id: true, name: true },
    });
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const { importPatents } = await import('../services/uspto-import-service.js');

    const result = await importPatents({
      portfolioId,
      maxPatents,
      cpcSections,
      onProgress: (msg) => console.log(`[Import] ${msg}`),
    });

    // Run sector reassignment as safety net
    if (result.imported > 0) {
      import('../services/sector-assignment-service.js').then(({ reassignPortfolioPatents }) =>
        reassignPortfolioPatents({ portfolioId })
      ).then((sectorResult) => {
        console.log(`[Import] Auto-sector assignment: ${sectorResult.assigned} assigned, ${sectorResult.noMatch} unmatched`);
      }).catch(err =>
        console.error('[Import] Background sector-assignment failed:', err)
      );
    }

    res.json({
      imported: result.imported,
      alreadyExists: result.alreadyExisted,
      falsePositives: result.falsePositives,
      failed: result.failed,
      totalInPortfolio: result.portfolioTotal,
      elapsedSeconds: result.elapsedSeconds,
    });
  } catch (err: unknown) {
    console.error('[Portfolios] Import error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// MANIFEST BUILD / STATUS
// =============================================================================

// In-memory manifest build job tracking
const manifestBuildJobs = new Map<string, {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  logs: string[];
  result?: any;
  error?: string;
}>();

/** POST /api/portfolios/manifests/build — trigger manifest build (background job) */
router.post('/manifests/build', async (req: Request, res: Response) => {
  try {
    const { startYear, endYear, force } = req.body || {};
    const jobKey = 'manifest-build';

    const existing = manifestBuildJobs.get(jobKey);
    if (existing?.status === 'running') {
      return res.json({ status: 'running', message: 'Manifest build already in progress', logs: existing.logs });
    }

    const job = { status: 'running' as const, startedAt: new Date().toISOString(), logs: [] as string[] };
    manifestBuildJobs.set(jobKey, job);

    res.json({ status: 'started', message: 'Manifest build started in background' });

    // Run in background
    import('../services/manifest-builder-service.js').then(async ({ buildAllManifests, buildForwardCounts }) => {
      try {
        const log = (msg: string) => { job.logs.push(msg); console.log(`[ManifestBuild] ${msg}`); };
        const buildResult = await buildAllManifests({ startYear, endYear, force, onProgress: log });
        const fcResult = await buildForwardCounts({ startYear, endYear, onProgress: log });
        job.status = 'completed';
        (job as any).result = { manifests: buildResult, forwardCounts: fcResult };
      } catch (err) {
        job.status = 'failed';
        (job as any).error = (err as Error).message;
        console.error('[ManifestBuild] Job failed:', err);
      }
    });
  } catch (err: unknown) {
    console.error('[Portfolios] Manifest build error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/portfolios/manifests/status — report manifest coverage */
router.get('/manifests/status', async (req: Request, res: Response) => {
  try {
    const { getManifestStatus } = await import('../services/manifest-builder-service.js');
    const startYear = req.query.startYear ? parseInt(req.query.startYear as string) : undefined;
    const endYear = req.query.endYear ? parseInt(req.query.endYear as string) : undefined;
    const status = getManifestStatus(startYear, endYear);

    const jobKey = 'manifest-build';
    const job = manifestBuildJobs.get(jobKey);

    res.json({
      ...status,
      buildJob: job ? { status: job.status, startedAt: job.startedAt, logs: job.logs, result: (job as any).result, error: (job as any).error } : null,
    });
  } catch (err: unknown) {
    console.error('[Portfolios] Manifest status error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// USPTO INDEX DATABASE
// =============================================================================

// In-memory index job tracking
const indexJobs = new Map<string, {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  logs: string[];
  result?: any;
  error?: string;
}>();

/** GET /api/portfolios/uspto-index/status — report USPTO index database coverage */
router.get('/uspto-index/status', async (req: Request, res: Response) => {
  try {
    const { getIndexStatus } = await import('../services/uspto-index-service.js');
    const startYear = req.query.startYear ? parseInt(req.query.startYear as string) : undefined;
    const endYear = req.query.endYear ? parseInt(req.query.endYear as string) : undefined;
    const status = await getIndexStatus(startYear, endYear);

    const job = indexJobs.get('index-run');

    res.json({
      ...status,
      indexJob: job ? {
        status: job.status,
        startedAt: job.startedAt,
        logs: job.logs.slice(-20),
        result: job.result,
        error: job.error,
      } : null,
    });
  } catch (err: unknown) {
    console.error('[USPTO Index] Status error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/portfolios/uspto-index/run — trigger indexing (background job) */
router.post('/uspto-index/run', async (req: Request, res: Response) => {
  try {
    const { startYear, endYear, force } = req.body || {};
    const jobKey = 'index-run';

    const existing = indexJobs.get(jobKey);
    if (existing?.status === 'running') {
      return res.json({ status: 'running', message: 'Indexing already in progress', logs: existing.logs.slice(-20) });
    }

    const job = { status: 'running' as const, startedAt: new Date().toISOString(), logs: [] as string[] };
    indexJobs.set(jobKey, job);

    res.json({ status: 'started', message: 'Indexing started in background' });

    // Run in background
    const { indexAll } = await import('../services/uspto-index-service.js');
    indexAll({
      startYear: startYear || new Date().getFullYear(),
      endYear: endYear || 2015,
      force: force || false,
      onProgress: (msg) => {
        job.logs.push(msg);
        console.log(`[USPTO Index] ${msg}`);
      },
    }).then(result => {
      (job as any).status = 'completed';
      (job as any).result = result;
    }).catch(err => {
      (job as any).status = 'failed';
      (job as any).error = (err as Error).message;
      console.error('[USPTO Index] Build error:', err);
    });
  } catch (err: unknown) {
    console.error('[USPTO Index] Run error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// EXTRACT PATENT XMLs (USPTO bulk data → individual XML files for claims)
// =============================================================================

// In-memory extraction job tracking
const extractionJobs = new Map<string, {
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  logs: string[];
  result?: any;
  error?: string;
}>();

/** POST /api/portfolios/:id/extract-xmls — start XML extraction (async background job) */
router.post('/:id/extract-xmls', async (req: Request, res: Response) => {
  try {
    const portfolioId = req.params.id;

    // Check for already-running job
    const existing = extractionJobs.get(portfolioId);
    if (existing?.status === 'running') {
      return res.json({ status: 'running', message: 'Extraction already in progress', logs: existing.logs });
    }

    // Get all patents in this portfolio with grant dates
    const portfolioPatents = await prisma.portfolioPatent.findMany({
      where: { portfolioId },
      include: { patent: { select: { patentId: true, grantDate: true } } },
    });

    if (!portfolioPatents.length) {
      return res.json({ status: 'failed', error: 'No patents in portfolio' });
    }

    const requests = portfolioPatents
      .filter(pp => pp.patent.grantDate)
      .map(pp => ({
        patentId: pp.patent.patentId,
        grantDate: pp.patent.grantDate!,
      }));

    if (!requests.length) {
      return res.json({ status: 'failed', error: 'No patents have grant dates — hydrate first' });
    }

    // Start background job
    const job = { status: 'running' as const, startedAt: new Date().toISOString(), logs: [] as string[] };
    extractionJobs.set(portfolioId, job);

    // Respond immediately
    res.json({ status: 'started', totalPatents: requests.length, message: 'Extraction started in background' });

    // Run extraction in background (detached from request lifecycle)
    import('../services/patent-xml-extractor-service.js').then(async ({ extractPatentXmls }) => {
      try {
        const result = await extractPatentXmls(requests, (msg) => {
          job.logs.push(msg);
          console.log(`[ExtractXMLs] ${msg}`);
        });
        job.status = 'completed';
        (job as any).result = result;
      } catch (err) {
        job.status = 'failed';
        (job as any).error = (err as Error).message;
        console.error('[ExtractXMLs] Job failed:', err);
      }
    });
  } catch (err: unknown) {
    console.error('[Portfolios] Extract XMLs error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/portfolios/:id/extract-xmls/status — poll extraction job status */
router.get('/:id/extract-xmls/status', async (req: Request, res: Response) => {
  const job = extractionJobs.get(req.params.id);
  if (!job) {
    return res.json({ status: 'none', message: 'No extraction job found' });
  }
  res.json({
    status: job.status,
    startedAt: job.startedAt,
    logs: job.logs,
    result: (job as any).result || null,
    error: (job as any).error || null,
  });
});

export default router;
