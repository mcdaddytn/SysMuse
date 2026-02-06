/**
 * Scoring Templates API Routes
 *
 * CRUD for scoring templates with inheritance.
 * Template resolution and score management.
 */

import { Router, Request, Response } from 'express';
import {
  createTemplate,
  updateTemplate,
  listTemplates,
  resolveEffectiveTemplate,
  getTemplateWithInheritance,
  seedDefaultTemplates,
  getSubSectorScores,
  getSubSectorScoreStats,
  getPatentScore,
  normalizeSubSectorScores,
  normalizeSectorScores,
  CreateTemplateInput
} from '../services/scoring-template-service.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// =============================================================================
// TEMPLATE CRUD
// =============================================================================

/**
 * GET /api/scoring-templates
 * List all scoring templates
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { superSectorId, sectorId, subSectorId, active } = req.query;

    const templates = await listTemplates({
      superSectorId: superSectorId as string | undefined,
      sectorId: sectorId as string | undefined,
      subSectorId: subSectorId as string | undefined,
      isActive: active === 'true' ? true : active === 'false' ? false : undefined
    });

    res.json(templates);
  } catch (error) {
    console.error('[ScoringTemplates] List error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/:id
 * Get a single template with inheritance info
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await getTemplateWithInheritance(id);
    if (!result) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json(result);
  } catch (error) {
    console.error('[ScoringTemplates] Get error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/scoring-templates
 * Create a new scoring template
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const input: CreateTemplateInput = req.body;

    const template = await createTemplate(input);
    res.status(201).json(template);
  } catch (error) {
    console.error('[ScoringTemplates] Create error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * PUT /api/scoring-templates/:id
 * Update a scoring template
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const input: Partial<CreateTemplateInput> = req.body;

    const template = await updateTemplate(id, input);
    res.json(template);
  } catch (error) {
    console.error('[ScoringTemplates] Update error:', error);
    res.status(400).json({ error: (error as Error).message });
  }
});

/**
 * DELETE /api/scoring-templates/:id
 * Delete a scoring template (soft delete via isActive = false)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.scoringTemplate.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Template deactivated' });
  } catch (error) {
    console.error('[ScoringTemplates] Delete error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// =============================================================================
// TEMPLATE RESOLUTION
// =============================================================================

/**
 * GET /api/scoring-templates/resolve/:subSectorId
 * Get the effective template for a sub-sector (with inheritance resolved)
 */
router.get('/resolve/:subSectorId', async (req: Request, res: Response) => {
  try {
    const { subSectorId } = req.params;

    const effective = await resolveEffectiveTemplate(subSectorId);
    if (!effective) {
      return res.status(404).json({
        error: 'No template found',
        message: 'No scoring template available for this sub-sector. Seed default templates first.'
      });
    }

    res.json(effective);
  } catch (error) {
    console.error('[ScoringTemplates] Resolve error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// =============================================================================
// SEEDING
// =============================================================================

/**
 * POST /api/scoring-templates/seed
 * Seed default templates for all super-sectors
 */
router.post('/seed', async (_req: Request, res: Response) => {
  try {
    console.log('[ScoringTemplates] Seeding default templates...');

    const result = await seedDefaultTemplates();

    console.log(`[ScoringTemplates] Seeding complete: ${result.created} created, ${result.skipped} skipped`);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[ScoringTemplates] Seed error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// =============================================================================
// SCORES
// =============================================================================

/**
 * GET /api/scoring-templates/scores/sub-sector/:subSectorId
 * Get scores for all patents in a sub-sector
 */
router.get('/scores/sub-sector/:subSectorId', async (req: Request, res: Response) => {
  try {
    const { subSectorId } = req.params;
    const { limit, offset } = req.query;

    const scores = await getSubSectorScores(subSectorId, {
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    const stats = await getSubSectorScoreStats(subSectorId);

    res.json({
      subSectorId,
      stats,
      scores
    });
  } catch (error) {
    console.error('[ScoringTemplates] Get sub-sector scores error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/scores/patent/:patentId
 * Get score for a specific patent
 */
router.get('/scores/patent/:patentId', async (req: Request, res: Response) => {
  try {
    const { patentId } = req.params;

    const score = await getPatentScore(patentId);
    if (!score) {
      return res.status(404).json({
        patentId,
        scored: false,
        message: 'No score found for this patent'
      });
    }

    res.json({
      patentId,
      scored: true,
      ...score
    });
  } catch (error) {
    console.error('[ScoringTemplates] Get patent score error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/scoring-templates/scores/normalize/sub-sector/:subSectorId
 * Recalculate ranks and normalized scores for a sub-sector
 */
router.post('/scores/normalize/sub-sector/:subSectorId', async (req: Request, res: Response) => {
  try {
    const { subSectorId } = req.params;

    const result = await normalizeSubSectorScores(subSectorId);

    res.json({
      success: true,
      subSectorId,
      ...result
    });
  } catch (error) {
    console.error('[ScoringTemplates] Normalize sub-sector error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/scoring-templates/scores/normalize/sector/:sectorId
 * Recalculate sector-level ranks from sub-sector scores
 */
router.post('/scores/normalize/sector/:sectorId', async (req: Request, res: Response) => {
  try {
    const { sectorId } = req.params;

    const result = await normalizeSectorScores(sectorId);

    res.json({
      success: true,
      sectorId,
      ...result
    });
  } catch (error) {
    console.error('[ScoringTemplates] Normalize sector error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// =============================================================================
// TEMPLATE PREVIEW
// =============================================================================

/**
 * POST /api/scoring-templates/preview
 * Preview what a template would look like with questions
 * Useful for testing before saving
 */
router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { questions, inheritsFromId } = req.body;

    // If inheriting, get parent questions
    let inheritedQuestions: any[] = [];
    if (inheritsFromId) {
      const parent = await getTemplateWithInheritance(inheritsFromId);
      if (parent) {
        inheritedQuestions = parent.inheritedQuestions;
      }
    }

    // Merge questions (provided override inherited)
    const merged = new Map();
    for (const q of inheritedQuestions) {
      merged.set(q.fieldName, { ...q, source: 'inherited' });
    }
    for (const q of questions || []) {
      merged.set(q.fieldName, { ...q, source: 'direct' });
    }

    const finalQuestions = Array.from(merged.values());

    // Calculate total weight
    const totalWeight = finalQuestions.reduce((sum, q) => sum + (q.weight || 0), 0);

    res.json({
      questionCount: finalQuestions.length,
      totalWeight,
      weightNormalized: Math.abs(totalWeight - 1.0) < 0.01,
      questions: finalQuestions
    });
  } catch (error) {
    console.error('[ScoringTemplates] Preview error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
