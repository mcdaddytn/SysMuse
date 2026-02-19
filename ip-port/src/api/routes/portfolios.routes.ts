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

    // Step 5: Auto-hydrate — fill missing fields (abstract, CPC codes, forward citations)
    const allPatentIds = suggestedAffiliates.flatMap((c: any) => c.patents.map((p: any) => p.patentId));
    import('../services/patent-hydration-service.js').then(({ hydratePatents }) =>
      hydratePatents(allPatentIds, { companyId: resolvedCompanyId }).catch(err =>
        console.error('[AutoHydrate] Background hydration failed:', err)
      )
    );

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

/** POST /api/portfolios/:id/import-patents — import patents from PatentsView */
router.post('/:id/import-patents', async (req: Request, res: Response) => {
  try {
    const { cpcPrefixes, maxPatents = 1000 } = req.body;
    const portfolioId = req.params.id;

    // Verify portfolio exists, get company affiliates
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
      include: {
        company: {
          include: { affiliates: { include: { patterns: true } } },
        },
      },
    });
    if (!portfolio) {
      return res.status(404).json({ error: 'Portfolio not found' });
    }

    const { createPatentsViewClient } = await import('../../../clients/patentsview-client.js');
    const pvClient = createPatentsViewClient();

    let imported = 0;
    let alreadyExists = 0;
    let failed = 0;
    const newPatentIds: string[] = [];
    const seenPatentIds = new Set<string>();

    const patentFields = [
      'patent_id', 'patent_title', 'patent_date', 'patent_type',
      'assignees.assignee_organization',
      'cpc_current.cpc_group_id', 'cpc_current.cpc_subgroup_id',
    ];

    for (const affiliate of portfolio.company.affiliates) {
      for (const pat of affiliate.patterns) {
        if (seenPatentIds.size >= maxPatents) break;
        try {
          const queryParts: Record<string, unknown>[] = [
            { _contains: { 'assignees.assignee_organization': pat.pattern } },
          ];

          if (cpcPrefixes?.length) {
            const cpcOr = cpcPrefixes.map((prefix: string) => ({
              _begins: { 'cpc_current.cpc_group_id': prefix },
            }));
            queryParts.push(cpcOr.length === 1 ? cpcOr[0] : { _or: cpcOr });
          }

          const query = queryParts.length === 1 ? queryParts[0] : { _and: queryParts };

          // Paginate through all results
          const pageSize = 100;
          for await (const patents of pvClient.searchPaginated(
            { query, fields: patentFields, sort: [{ patent_date: 'desc' }] },
            pageSize
          )) {
            for (const p of patents) {
              if (seenPatentIds.size >= maxPatents) break;
              const patentId = p.patent_id;
              if (seenPatentIds.has(patentId)) continue;
              seenPatentIds.add(patentId);

              try {
                // Upsert Patent row with basic data
                await prisma.patent.upsert({
                  where: { patentId },
                  create: {
                    patentId,
                    title: p.patent_title || '',
                    grantDate: p.patent_date || null,
                    assignee: p.assignees?.[0]?.assignee_organization || '',
                    affiliate: affiliate.name,
                  },
                  update: {},  // Don't overwrite if already exists with richer data
                });

                // Upsert CPC codes from search results
                const cpcCodes = (p.cpc_current || p.cpcs || [])
                  .map((c: any) => c.cpc_subgroup_id || c.cpc_group_id || '')
                  .filter(Boolean);
                for (const code of cpcCodes) {
                  await prisma.patentCpc.upsert({
                    where: { patentId_cpcCode: { patentId, cpcCode: code } },
                    create: { patentId, cpcCode: code },
                    update: {},
                  }).catch(() => {}); // Ignore race conditions
                }

                // Link to portfolio
                const link = await prisma.portfolioPatent.upsert({
                  where: { portfolioId_patentId: { portfolioId, patentId } },
                  update: {},
                  create: {
                    portfolioId,
                    patentId,
                    source: 'PATENTSVIEW_IMPORT',
                  },
                });

                if (link) {
                  newPatentIds.push(patentId);
                  imported++;
                }
              } catch {
                alreadyExists++;
              }
            }
            if (seenPatentIds.size >= maxPatents) break;
          }
        } catch (err) {
          console.warn(`[Import] Error for pattern "${pat.pattern}":`, (err as Error).message);
          failed++;
        }
      }
    }

    // Update portfolio patent count
    const patentCount = await prisma.portfolioPatent.count({ where: { portfolioId } });
    await prisma.portfolio.update({ where: { id: portfolioId }, data: { patentCount } });

    // Background-hydrate new patents to fill abstract, filing date, forward citations, etc.
    if (newPatentIds.length > 0) {
      import('../services/patent-hydration-service.js').then(({ hydratePatents }) =>
        hydratePatents(newPatentIds, { companyId: portfolio.companyId }).catch(err =>
          console.error('[Import] Background hydration failed:', err)
        )
      );
    }

    res.json({ imported, alreadyExists, failed, totalInPortfolio: patentCount });
  } catch (err: unknown) {
    console.error('[Portfolios] Import error:', err);
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
