/**
 * Company management routes — CRUD for companies, competitors, and affiliates.
 * Companies are the first-class entity; portfolios and affiliates belong to companies.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// =============================================================================
// COMPANY CRUD
// =============================================================================

/** GET /api/companies — list all companies with counts */
router.get('/', async (req: Request, res: Response) => {
  try {
    const companies = await prisma.company.findMany({
      include: {
        _count: {
          select: { affiliates: true, portfolios: true, competitorsOf: true },
        },
      },
      orderBy: { displayName: 'asc' },
    });
    res.json(companies);
  } catch (err: unknown) {
    console.error('[Companies] List error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/companies/:id — company detail with affiliates, portfolios, competitors */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        affiliates: {
          include: { patterns: true, children: { select: { id: true, name: true } } },
          orderBy: { name: 'asc' },
        },
        portfolios: {
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { patents: true } } },
        },
        _count: { select: { competitorsOf: true, competitorTo: true } },
      },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json(company);
  } catch (err: unknown) {
    console.error('[Companies] Get error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies — create company */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, website } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ error: 'name and displayName are required' });
    }
    const company = await prisma.company.create({
      data: { name, displayName, description: description || null, website: website || null },
    });
    res.status(201).json(company);
  } catch (err: unknown) {
    console.error('[Companies] Create error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** PUT /api/companies/:id — update company */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { displayName, description, website } = req.body;
    const company = await prisma.company.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(description !== undefined && { description }),
        ...(website !== undefined && { website }),
      },
    });
    res.json(company);
  } catch (err: unknown) {
    console.error('[Companies] Update error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id — delete company (cascades) */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.company.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Delete error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// COMPETITOR MANAGEMENT
// =============================================================================

/** GET /api/companies/:id/competitors — list competitor relationships */
router.get('/:id/competitors', async (req: Request, res: Response) => {
  try {
    const relationships = await prisma.competitorRelationship.findMany({
      where: { companyId: req.params.id },
      include: {
        competitor: {
          include: { _count: { select: { portfolios: true, affiliates: true } } },
        },
      },
      orderBy: { competitor: { displayName: 'asc' } },
    });
    res.json(relationships);
  } catch (err: unknown) {
    console.error('[Companies] List competitors error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/competitors — add competitor relationship */
router.post('/:id/competitors', async (req: Request, res: Response) => {
  try {
    const { competitorId, sectors, discoverySource, strength, notes } = req.body;
    if (!competitorId) {
      return res.status(400).json({ error: 'competitorId is required' });
    }
    const relationship = await prisma.competitorRelationship.create({
      data: {
        companyId: req.params.id,
        competitorId,
        sectors: sectors || [],
        discoverySource: discoverySource || 'MANUAL',
        strength: strength || null,
        notes: notes || null,
      },
      include: { competitor: true },
    });
    res.status(201).json(relationship);
  } catch (err: unknown) {
    console.error('[Companies] Add competitor error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id/competitors/:competitorId — remove relationship */
router.delete('/:id/competitors/:competitorId', async (req: Request, res: Response) => {
  try {
    await prisma.competitorRelationship.delete({
      where: {
        companyId_competitorId: {
          companyId: req.params.id,
          competitorId: req.params.competitorId,
        },
      },
    });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Remove competitor error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/companies/:id/discover-competitors — LLM-assisted competitor discovery */
router.post('/:id/discover-competitors', async (req: Request, res: Response) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.params.id },
      include: {
        competitorsOf: { include: { competitor: true } },
      },
    });
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { companyName } = req.body;
    const nameToSearch = companyName || company.displayName;

    const existingNames = company.competitorsOf.map(r => r.competitor.displayName);

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `List the top competitors of "${nameToSearch}" in the technology/patent space. Focus on companies that would have overlapping patent portfolios.

Already known competitors: ${existingNames.slice(0, 30).join(', ')}${existingNames.length > 30 ? ` (and ${existingNames.length - 30} more)` : ''}

Return JSON array: [{ "name": "Company Name", "slug": "company-slug", "sectors": ["sector1"], "notes": "why they compete" }]

Only return NEW companies not in the known list. Return raw JSON array, no markdown.`,
      }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    let suggestions;
    try {
      suggestions = JSON.parse(responseText);
    } catch {
      suggestions = [];
    }

    res.json({ suggestions, companyName: nameToSearch, existingCount: existingNames.length });
  } catch (err: unknown) {
    console.error('[Companies] Discover competitors error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// AFFILIATE CRUD (under company)
// =============================================================================

/** POST /api/companies/:id/affiliates — add affiliate with optional patterns */
router.post('/:id/affiliates', async (req: Request, res: Response) => {
  try {
    const { name, displayName, acquiredYear, parentId, notes, patterns } = req.body;
    if (!name || !displayName) {
      return res.status(400).json({ error: 'name and displayName are required' });
    }

    const affiliate = await prisma.affiliate.create({
      data: {
        companyId: req.params.id,
        name,
        displayName,
        acquiredYear: acquiredYear || null,
        parentId: parentId || null,
        notes: notes || null,
        patterns: patterns?.length
          ? { create: patterns.map((p: string) => ({ pattern: p, isExact: false })) }
          : undefined,
      },
      include: { patterns: true },
    });

    res.status(201).json(affiliate);
  } catch (err: unknown) {
    console.error('[Companies] Add affiliate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** PUT /api/companies/:id/affiliates/:aid — update affiliate */
router.put('/:id/affiliates/:aid', async (req: Request, res: Response) => {
  try {
    const { displayName, acquiredYear, parentId, notes } = req.body;
    const affiliate = await prisma.affiliate.update({
      where: { id: req.params.aid },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(acquiredYear !== undefined && { acquiredYear }),
        ...(parentId !== undefined && { parentId }),
        ...(notes !== undefined && { notes }),
      },
      include: { patterns: true },
    });
    res.json(affiliate);
  } catch (err: unknown) {
    console.error('[Companies] Update affiliate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id/affiliates/:aid — delete affiliate (cascades patterns) */
router.delete('/:id/affiliates/:aid', async (req: Request, res: Response) => {
  try {
    await prisma.affiliate.delete({ where: { id: req.params.aid } });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Delete affiliate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// AFFILIATE PATTERN CRUD (under company)
// =============================================================================

/** POST /api/companies/:id/affiliates/:aid/patterns — add pattern */
router.post('/:id/affiliates/:aid/patterns', async (req: Request, res: Response) => {
  try {
    const { pattern, isExact } = req.body;
    if (!pattern) {
      return res.status(400).json({ error: 'pattern is required' });
    }
    const created = await prisma.affiliatePattern.create({
      data: {
        affiliateId: req.params.aid,
        pattern,
        isExact: isExact || false,
      },
    });
    res.status(201).json(created);
  } catch (err: unknown) {
    console.error('[Companies] Add pattern error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** DELETE /api/companies/:id/affiliates/:aid/patterns/:pid — delete pattern */
router.delete('/:id/affiliates/:aid/patterns/:pid', async (req: Request, res: Response) => {
  try {
    await prisma.affiliatePattern.delete({ where: { id: req.params.pid } });
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[Companies] Delete pattern error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
