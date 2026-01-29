/**
 * Sector Management API Routes
 *
 * CRUD for sectors, super-sectors, and sector rules.
 * Actions: seed, preview, recalculate, reassign, promote.
 *
 * IMPORTANT: Literal paths (e.g., /super-sectors, /preview-rule)
 * must be defined BEFORE parameterized paths (e.g., /:id) to
 * prevent Express from matching the literal as a param value.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { seedSectorsFromConfig } from '../services/sector-seed-service.js';
import {
  previewRule,
  recalculatePatentCounts,
  recalculateSectorPatentCount,
  clearRuleCache,
} from '../services/sector-assignment-service.js';
import { clearSectorCache } from './scores.routes.js';

const router = Router();
const prisma = new PrismaClient();

// =============================================================================
// SUPER-SECTORS (must be before /:id)
// =============================================================================

/**
 * GET /api/sectors/super-sectors
 * List super-sectors with nested sectors
 */
router.get('/super-sectors', async (_req: Request, res: Response) => {
  try {
    const superSectors = await prisma.superSector.findMany({
      include: {
        sectors: {
          select: {
            id: true,
            name: true,
            displayName: true,
            patentCount: true,
            damagesTier: true,
            damagesRating: true,
            _count: { select: { rules: true } },
          },
          orderBy: { name: 'asc' },
        },
      },
      orderBy: { displayName: 'asc' },
    });

    res.json(superSectors);
  } catch (err: unknown) {
    console.error('[SuperSectors] List error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/super-sectors
 * Create a super-sector
 */
router.post('/super-sectors', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description } = req.body;

    if (!name || !displayName) {
      return res.status(400).json({ error: 'name and displayName are required' });
    }

    const superSector = await prisma.superSector.create({
      data: { name, displayName, description },
    });

    res.status(201).json(superSector);
  } catch (err: unknown) {
    console.error('[SuperSectors] Create error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * PUT /api/sectors/super-sectors/:id
 * Update a super-sector
 */
router.put('/super-sectors/:id', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description } = req.body;

    const superSector = await prisma.superSector.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(displayName !== undefined && { displayName }),
        ...(description !== undefined && { description }),
      },
    });

    res.json(superSector);
  } catch (err: unknown) {
    console.error('[SuperSectors] Update error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// RULE ACTIONS (must be before /:id)
// =============================================================================

/**
 * POST /api/sectors/preview-rule
 * Preview what a rule would match
 */
router.post('/preview-rule', async (req: Request, res: Response) => {
  try {
    const { ruleType, expression, sectorId } = req.body;

    if (!ruleType || !expression || !sectorId) {
      return res.status(400).json({ error: 'ruleType, expression, and sectorId are required' });
    }

    const result = await previewRule({ ruleType, expression, sectorId });
    res.json(result);
  } catch (err: unknown) {
    console.error('[Sectors] Preview rule error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/rules/:ruleId/promote
 * Promote a portfolio rule to library scope
 */
router.post('/rules/:ruleId/promote', async (req: Request, res: Response) => {
  try {
    const sourceRule = await prisma.sectorRule.findUnique({
      where: { id: req.params.ruleId },
    });

    if (!sourceRule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    if (sourceRule.scope !== 'PORTFOLIO') {
      return res.status(400).json({ error: 'Only PORTFOLIO-scoped rules can be promoted' });
    }

    const promoted = await prisma.sectorRule.create({
      data: {
        sectorId: sourceRule.sectorId,
        ruleType: sourceRule.ruleType,
        expression: sourceRule.expression,
        priority: sourceRule.priority,
        isExclusion: sourceRule.isExclusion,
        scope: 'LIBRARY',
        description: sourceRule.description,
        promotedFrom: sourceRule.id,
        promotedAt: new Date(),
      },
    });

    clearRuleCache();
    res.json(promoted);
  } catch (err: unknown) {
    console.error('[Sectors] Promote rule error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/reassign-all
 * Re-evaluate all patents against current rules
 */
router.post('/reassign-all', async (_req: Request, res: Response) => {
  try {
    const counts = await recalculatePatentCounts();
    res.json({
      message: 'Patent counts recalculated for all sectors',
      sectorCounts: counts,
    });
  } catch (err: unknown) {
    console.error('[Sectors] Reassign-all error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/seed
 * Seed DB from config files
 */
router.post('/seed', async (_req: Request, res: Response) => {
  try {
    const summary = await seedSectorsFromConfig();
    clearRuleCache();
    clearSectorCache();
    res.json({
      message: 'Sectors seeded from config files',
      ...summary,
    });
  } catch (err: unknown) {
    console.error('[Sectors] Seed error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// SECTORS — CRUD
// =============================================================================

/**
 * GET /api/sectors
 * List sectors with optional super-sector filter
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { superSectorId } = req.query;
    const where: Record<string, unknown> = {};
    if (superSectorId) where.superSectorId = superSectorId;

    const sectors = await prisma.sector.findMany({
      where,
      include: {
        superSector: { select: { id: true, name: true, displayName: true } },
        _count: { select: { rules: true } },
      },
      orderBy: [{ superSectorId: 'asc' }, { name: 'asc' }],
    });

    res.json(sectors);
  } catch (err: unknown) {
    console.error('[Sectors] List error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors
 * Create a new sector
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, superSectorId, cpcPrefixes, damagesTier, damagesRating, facets } = req.body;

    if (!name || !displayName) {
      return res.status(400).json({ error: 'name and displayName are required' });
    }

    const sector = await prisma.sector.create({
      data: {
        name,
        displayName,
        description,
        superSectorId: superSectorId || null,
        cpcPrefixes: cpcPrefixes || [],
        damagesTier,
        damagesRating,
        facets,
      },
      include: {
        superSector: { select: { id: true, name: true, displayName: true } },
      },
    });

    clearSectorCache();
    res.status(201).json(sector);
  } catch (err: unknown) {
    console.error('[Sectors] Create error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/sectors/:id
 * Sector detail with rules and stats
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const sector = await prisma.sector.findUnique({
      where: { id: req.params.id },
      include: {
        superSector: { select: { id: true, name: true, displayName: true } },
        rules: {
          orderBy: [{ priority: 'desc' }, { ruleType: 'asc' }],
        },
      },
    });

    if (!sector) {
      return res.status(404).json({ error: 'Sector not found' });
    }

    res.json(sector);
  } catch (err: unknown) {
    console.error('[Sectors] Get error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * PUT /api/sectors/:id
 * Update sector metadata
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, superSectorId, cpcPrefixes, damagesTier, damagesRating, facets } = req.body;

    const sector = await prisma.sector.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(displayName !== undefined && { displayName }),
        ...(description !== undefined && { description }),
        ...(superSectorId !== undefined && { superSectorId }),
        ...(cpcPrefixes !== undefined && { cpcPrefixes }),
        ...(damagesTier !== undefined && { damagesTier }),
        ...(damagesRating !== undefined && { damagesRating }),
        ...(facets !== undefined && { facets }),
      },
      include: {
        superSector: { select: { id: true, name: true, displayName: true } },
      },
    });

    clearSectorCache();
    res.json(sector);
  } catch (err: unknown) {
    console.error('[Sectors] Update error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * DELETE /api/sectors/:id
 * Delete sector (cascades to rules)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.sector.delete({ where: { id: req.params.id } });
    clearRuleCache();
    clearSectorCache();
    res.json({ deleted: true });
  } catch (err: unknown) {
    console.error('[Sectors] Delete error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// SECTOR RULES — CRUD (nested under /:id/rules)
// =============================================================================

/**
 * GET /api/sectors/:id/rules
 * List rules for a sector
 */
router.get('/:id/rules', async (req: Request, res: Response) => {
  try {
    const rules = await prisma.sectorRule.findMany({
      where: { sectorId: req.params.id },
      orderBy: [{ priority: 'desc' }, { ruleType: 'asc' }],
    });

    res.json(rules);
  } catch (err: unknown) {
    console.error('[Sectors] List rules error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/:id/rules
 * Add a rule to a sector
 */
router.post('/:id/rules', async (req: Request, res: Response) => {
  try {
    const { ruleType, expression, priority, isExclusion, scope, portfolioId, description } = req.body;

    if (!ruleType || !expression) {
      return res.status(400).json({ error: 'ruleType and expression are required' });
    }

    const rule = await prisma.sectorRule.create({
      data: {
        sectorId: req.params.id,
        ruleType,
        expression,
        priority: priority ?? 0,
        isExclusion: isExclusion ?? false,
        scope: scope ?? 'LIBRARY',
        portfolioId: portfolioId || null,
        description,
      },
    });

    clearRuleCache();
    res.status(201).json(rule);
  } catch (err: unknown) {
    console.error('[Sectors] Add rule error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * PUT /api/sectors/:id/rules/:ruleId
 * Update a rule
 */
router.put('/:id/rules/:ruleId', async (req: Request, res: Response) => {
  try {
    const { ruleType, expression, priority, isExclusion, scope, portfolioId, description, isActive } = req.body;

    const rule = await prisma.sectorRule.update({
      where: { id: req.params.ruleId },
      data: {
        ...(ruleType !== undefined && { ruleType }),
        ...(expression !== undefined && { expression }),
        ...(priority !== undefined && { priority }),
        ...(isExclusion !== undefined && { isExclusion }),
        ...(scope !== undefined && { scope }),
        ...(portfolioId !== undefined && { portfolioId }),
        ...(description !== undefined && { description }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    clearRuleCache();
    res.json(rule);
  } catch (err: unknown) {
    console.error('[Sectors] Update rule error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * DELETE /api/sectors/:id/rules/:ruleId
 * Delete a rule
 */
router.delete('/:id/rules/:ruleId', async (req: Request, res: Response) => {
  try {
    await prisma.sectorRule.delete({ where: { id: req.params.ruleId } });
    clearRuleCache();
    res.json({ deleted: true });
  } catch (err: unknown) {
    console.error('[Sectors] Delete rule error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/:id/recalculate
 * Recalculate patent count for a single sector
 */
router.post('/:id/recalculate', async (req: Request, res: Response) => {
  try {
    const count = await recalculateSectorPatentCount(req.params.id);
    res.json({ sectorId: req.params.id, patentCount: count });
  } catch (err: unknown) {
    console.error('[Sectors] Recalculate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
