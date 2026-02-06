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
import { seedSectorsFromConfig, seedCpcOnlyTaxonomy, listTaxonomyConfigs } from '../services/sector-seed-service.js';
import {
  previewRule,
  recalculatePatentCounts,
  recalculateSectorPatentCount,
  reassignAllPatents,
  clearRuleCache,
} from '../services/sector-assignment-service.js';
import {
  generateSubSectors,
  applySubSectors,
  getSubSectors,
  analyzeSubSectorPotential,
  manualSplitSubSector,
  updateSubSectorStatus,
  SubSectorConfig,
} from '../services/sub-sector-service.js';
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
 * Re-count patents by existing sector assignments (fast, no re-evaluation)
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
 * POST /api/sectors/reassign-patents
 * Fully re-evaluate all patents against current CPC rules and update assignments.
 * This is a heavier operation that updates the candidates file.
 * Body: { dryRun?: boolean }
 */
router.post('/reassign-patents', async (req: Request, res: Response) => {
  try {
    const { dryRun } = req.body;

    console.log('[Sectors] Starting full patent reassignment...');
    console.log(`  Dry run: ${dryRun || false}`);

    const summary = await reassignAllPatents({
      dryRun,
      progressCallback: (current, total) => {
        console.log(`  Progress: ${current}/${total} patents (${Math.round(100 * current / total)}%)`);
      },
    });

    clearRuleCache();
    clearSectorCache();

    res.json({
      message: dryRun ? 'Dry run completed (no changes saved)' : 'All patents reassigned based on CPC rules',
      ...summary,
    });
  } catch (err: unknown) {
    console.error('[Sectors] Reassign-patents error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/seed
 * Seed DB from config files (legacy format)
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

/**
 * GET /api/sectors/taxonomy-configs
 * List available taxonomy config files
 */
router.get('/taxonomy-configs', (_req: Request, res: Response) => {
  try {
    const configs = listTaxonomyConfigs();
    res.json({ configs });
  } catch (err: unknown) {
    console.error('[Sectors] List taxonomy configs error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/seed-taxonomy
 * Seed DB from CPC-only taxonomy format
 * Body: { configFile?: string, cleanStart?: boolean }
 *   - configFile: taxonomy config filename (default: 'sector-taxonomy-cpc-only.json')
 *   - cleanStart: if true, deletes all existing sectors/rules first (default: false)
 */
router.post('/seed-taxonomy', async (req: Request, res: Response) => {
  try {
    const { configFile, cleanStart } = req.body;

    console.log('[Sectors] Seeding from CPC-only taxonomy...');
    console.log(`  Config file: ${configFile || 'sector-taxonomy-cpc-only.json'}`);
    console.log(`  Clean start: ${cleanStart || false}`);

    const summary = await seedCpcOnlyTaxonomy(configFile, cleanStart);
    clearRuleCache();
    clearSectorCache();

    res.json({
      message: 'Sectors seeded from CPC-only taxonomy',
      configFile: configFile || 'sector-taxonomy-cpc-only.json',
      ...summary,
    });
  } catch (err: unknown) {
    console.error('[Sectors] Seed taxonomy error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// SUB-SECTORS (must be before /:id)
// =============================================================================

/**
 * GET /api/sectors/sub-sectors/analyze/:sectorName
 * Analyze sub-sector potential for a sector (quick summary)
 */
router.get('/sub-sectors/analyze/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const { candidatesFile } = req.query;

    const analysis = await analyzeSubSectorPotential(
      sectorName,
      candidatesFile as string | undefined
    );

    res.json(analysis);
  } catch (err: unknown) {
    console.error('[SubSectors] Analyze error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/sub-sectors/generate
 * Generate prospective sub-sectors for a sector
 * Body: {
 *   sectorName: string,
 *   candidatesFile?: string,
 *   config?: Partial<SubSectorConfig>
 * }
 */
router.post('/sub-sectors/generate', async (req: Request, res: Response) => {
  try {
    const { sectorName, candidatesFile, config } = req.body;

    if (!sectorName) {
      return res.status(400).json({ error: 'sectorName is required' });
    }

    console.log(`[SubSectors] Generating sub-sectors for ${sectorName}...`);
    if (config) {
      console.log('  Config:', JSON.stringify(config));
    }

    const result = await generateSubSectors(sectorName, candidatesFile, config);

    console.log(`[SubSectors] Generated ${result.stats.totalSubSectors} sub-sectors`);
    console.log(`  Under threshold: ${result.stats.underThreshold}`);
    console.log(`  Over threshold: ${result.stats.overThreshold}`);
    console.log(`  Needs review: ${result.stats.needsReview}`);

    res.json(result);
  } catch (err: unknown) {
    console.error('[SubSectors] Generate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/sub-sectors/apply
 * Apply generated sub-sectors to database
 * Body: {
 *   result: SubSectorGenerationResult (from generate endpoint),
 *   replaceExisting?: boolean
 * }
 */
router.post('/sub-sectors/apply', async (req: Request, res: Response) => {
  try {
    const { result, replaceExisting } = req.body;

    if (!result || !result.sectorId) {
      return res.status(400).json({ error: 'result with sectorId is required' });
    }

    console.log(`[SubSectors] Applying ${result.subSectors?.length || 0} sub-sectors...`);

    const applyResult = await applySubSectors(result, { replaceExisting });

    console.log(`[SubSectors] Applied: created=${applyResult.created}, deleted=${applyResult.deleted}`);

    res.json({
      message: 'Sub-sectors applied to database',
      ...applyResult,
    });
  } catch (err: unknown) {
    console.error('[SubSectors] Apply error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/sectors/sub-sectors/:sectorName
 * Get existing sub-sectors for a sector
 */
router.get('/sub-sectors/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const { status } = req.query;

    const subSectors = await getSubSectors(
      sectorName,
      status as any
    );

    res.json(subSectors);
  } catch (err: unknown) {
    console.error('[SubSectors] Get error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/sub-sectors/:subSectorId/split
 * Manually split a sub-sector that needs review
 * Body: {
 *   splitType: 'date' | 'chunks' | 'custom',
 *   targetSize?: number,
 *   chunkCount?: number,
 *   customGroups?: Array<{ name: string; patentIds: string[] }>
 * }
 */
router.post('/sub-sectors/:subSectorId/split', async (req: Request, res: Response) => {
  try {
    const { subSectorId } = req.params;
    const { splitType, targetSize, chunkCount, customGroups } = req.body;

    if (!splitType || !['date', 'chunks', 'custom'].includes(splitType)) {
      return res.status(400).json({ error: 'splitType must be one of: date, chunks, custom' });
    }

    const newSubSectors = await manualSplitSubSector(subSectorId, splitType, {
      targetSize,
      chunkCount,
      customGroups,
    });

    res.json({
      message: `Split into ${newSubSectors.length} sub-sectors`,
      subSectors: newSubSectors,
    });
  } catch (err: unknown) {
    console.error('[SubSectors] Split error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * PUT /api/sectors/sub-sectors/:subSectorId/status
 * Update sub-sector status (PROSPECTIVE -> APPLIED, etc.)
 * Body: { status: 'PROSPECTIVE' | 'APPLIED' | 'ARCHIVED' }
 */
router.put('/sub-sectors/:subSectorId/status', async (req: Request, res: Response) => {
  try {
    const { subSectorId } = req.params;
    const { status } = req.body;

    if (!status || !['PROSPECTIVE', 'APPLIED', 'ARCHIVED'].includes(status)) {
      return res.status(400).json({ error: 'status must be one of: PROSPECTIVE, APPLIED, ARCHIVED' });
    }

    const updated = await updateSubSectorStatus(subSectorId, status);

    res.json(updated);
  } catch (err: unknown) {
    console.error('[SubSectors] Update status error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sectors/sub-sectors/assign
 * Assign primary sub-sector to each patent based on inventive CPC codes
 * Body: { dryRun?: boolean }
 */
router.post('/sub-sectors/assign', async (req: Request, res: Response) => {
  try {
    const { dryRun = false } = req.body;

    // Import the assignment function
    const { assignPrimarySubSectors } = await import('../services/sub-sector-service.js');

    console.log(`[SubSectors] Starting primary sub-sector assignment (dryRun: ${dryRun})...`);

    const result = await assignPrimarySubSectors(undefined, {
      dryRun,
      progressCallback: (current, total) => {
        if (current % 5000 === 0) {
          console.log(`[SubSectors] Assignment progress: ${current}/${total}`);
        }
      }
    });

    console.log(`[SubSectors] Assignment complete: ${result.assigned} assigned, ${result.noMatch} no match`);

    res.json({
      success: true,
      dryRun,
      result,
      coverage: {
        assignedPct: Math.round(result.assigned / result.processed * 1000) / 10,
        byMatchType: result.byMatchType,
        byConfidence: result.byConfidence,
      }
    });
  } catch (err: unknown) {
    console.error('[SubSectors] Assignment error:', err);
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
