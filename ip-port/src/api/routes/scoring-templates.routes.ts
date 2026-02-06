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
  syncTemplatesFromConfig,
  getSubSectorScores,
  getSubSectorScoreStats,
  getPatentScore,
  normalizeSubSectorScores,
  normalizeSectorScores,
  listTemplateConfigFiles,
  getMergedQuestionsForSuperSector,
  CreateTemplateInput
} from '../services/scoring-template-service.js';
import {
  scorePatent,
  scoreSubSector,
  scoreSector,
  getPatentsForScoring,
  getPatentsForSectorScoring,
  PatentForScoring,
  comparePatentScoring,
  runComparisonTest,
  getComparisonTestSet,
  CLAIMS_CONTEXT_OPTIONS,
  DEFAULT_CONTEXT_OPTIONS
} from '../services/llm-scoring-service.js';
import { getClaimsStats, extractClaimsText } from '../services/patent-xml-parser-service.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// =============================================================================
// CONFIG FILES (must be before /:id to avoid route conflicts)
// =============================================================================

/**
 * GET /api/scoring-templates/config
 * List all available template config files from the filesystem
 */
router.get('/config', async (_req: Request, res: Response) => {
  try {
    const configs = listTemplateConfigFiles();
    res.json({
      configDir: 'config/scoring-templates',
      ...configs,
      summary: {
        hasPortfolioDefault: !!configs.portfolioDefault,
        superSectorCount: configs.superSectors.length,
        sectorCount: configs.sectors.length,
        subSectorCount: configs.subSectors.length
      }
    });
  } catch (error) {
    console.error('[ScoringTemplates] Config list error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/config/merged/:superSectorName
 * Get merged questions for a super-sector (portfolio default + super-sector specific)
 */
router.get('/config/merged/:superSectorName', async (req: Request, res: Response) => {
  try {
    const { superSectorName } = req.params;
    const questions = getMergedQuestionsForSuperSector(superSectorName.toUpperCase());

    const totalWeight = questions.reduce((sum, q) => sum + q.weight, 0);

    res.json({
      superSectorName: superSectorName.toUpperCase(),
      questionCount: questions.length,
      totalWeight: Math.round(totalWeight * 100) / 100,
      questions
    });
  } catch (error) {
    console.error('[ScoringTemplates] Merged config error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// =============================================================================
// TEMPLATE RESOLUTION (must be before /:id to avoid route conflicts)
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
// SEEDING
// =============================================================================

/**
 * POST /api/scoring-templates/seed
 * Seed default templates for all super-sectors from JSON config files
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

/**
 * POST /api/scoring-templates/sync
 * Sync existing templates with JSON config files (updates questions from config)
 * Use this after modifying JSON config files to push changes to database
 */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    console.log('[ScoringTemplates] Syncing templates from config files...');

    const result = await syncTemplatesFromConfig();

    console.log(`[ScoringTemplates] Sync complete: ${result.updated} updated, ${result.created} created`);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[ScoringTemplates] Sync error:', error);
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

// =============================================================================
// LLM SCORING
// =============================================================================

/**
 * POST /api/scoring-templates/llm/score-patent
 * Score a single patent using LLM
 */
router.post('/llm/score-patent', async (req: Request, res: Response) => {
  try {
    const patent: PatentForScoring = req.body;
    const { model, saveToDb } = req.query;

    if (!patent.patent_id) {
      return res.status(400).json({ error: 'patent_id is required' });
    }

    console.log(`[LLM Scoring] Scoring patent ${patent.patent_id}`);

    const result = await scorePatent(patent, {
      model: model as string,
      saveToDb: saveToDb !== 'false'
    });

    res.json(result);
  } catch (error) {
    console.error('[LLM Scoring] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/scoring-templates/llm/score-sub-sector/:subSectorId
 * Score all unscored patents in a sub-sector
 */
router.post('/llm/score-sub-sector/:subSectorId', async (req: Request, res: Response) => {
  try {
    const { subSectorId } = req.params;
    const { limit, model } = req.query;

    console.log(`[LLM Scoring] Scoring sub-sector ${subSectorId}`);

    const result = await scoreSubSector(subSectorId, {
      limit: limit ? parseInt(limit as string) : 10,
      model: model as string
    });

    res.json(result);
  } catch (error) {
    console.error('[LLM Scoring] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/scoring-templates/llm/score-sector/:sectorName
 * Score all unscored patents in a sector (batch operation)
 */
router.post('/llm/score-sector/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const { limit, model, concurrency } = req.query;

    console.log(`[LLM Scoring] Starting sector scoring: ${sectorName}`);

    const result = await scoreSector(sectorName, {
      limit: limit ? parseInt(limit as string) : 500,
      model: model as string,
      concurrency: concurrency ? parseInt(concurrency as string) : 2
    });

    res.json(result);
  } catch (error) {
    console.error('[LLM Scoring] Sector scoring error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/llm/sector-preview/:sectorName
 * Preview patents ready for scoring in a sector
 */
router.get('/llm/sector-preview/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const { limit } = req.query;

    const patents = await getPatentsForSectorScoring(sectorName, {
      limit: limit ? parseInt(limit as string) : 10,
      onlyUnscored: true
    });

    res.json({
      sectorName,
      unscoredCount: patents.length,
      patents: patents.slice(0, 5).map(p => ({
        patent_id: p.patent_id,
        patent_title: p.patent_title,
        primary_sub_sector_name: p.primary_sub_sector_name
      }))
    });
  } catch (error) {
    console.error('[LLM Scoring] Sector preview error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/llm/preview/:subSectorId
 * Preview patents ready for scoring in a sub-sector (without actually scoring)
 */
router.get('/llm/preview/:subSectorId', async (req: Request, res: Response) => {
  try {
    const { subSectorId } = req.params;
    const { limit } = req.query;

    const patents = await getPatentsForScoring(subSectorId, {
      limit: limit ? parseInt(limit as string) : 5,
      onlyUnscored: true
    });

    // Get effective template to show questions
    const template = await resolveEffectiveTemplate(subSectorId);

    res.json({
      subSectorId,
      patentCount: patents.length,
      template: template ? {
        name: template.templateName,
        questionCount: template.questions.length,
        questions: template.questions.map(q => ({
          fieldName: q.fieldName,
          displayName: q.displayName,
          weight: q.weight
        }))
      } : null,
      patents: patents.map(p => ({
        patent_id: p.patent_id,
        patent_title: p.patent_title,
        abstract: p.abstract?.substring(0, 200) + '...',
        super_sector: p.super_sector,
        primary_sector: p.primary_sector
      }))
    });
  } catch (error) {
    console.error('[LLM Scoring] Preview error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// =============================================================================
// CLAIMS COMPARISON TESTING
// =============================================================================

/**
 * GET /api/scoring-templates/claims/stats/:patentId
 * Get claims statistics for a patent
 */
router.get('/claims/stats/:patentId', async (req: Request, res: Response) => {
  try {
    const { patentId } = req.params;
    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';

    const stats = getClaimsStats(patentId, xmlDir);
    if (!stats) {
      return res.status(404).json({
        patentId,
        found: false,
        message: 'XML file not found or claims could not be extracted'
      });
    }

    res.json({ patentId, ...stats });
  } catch (error) {
    console.error('[Claims] Stats error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/claims/preview/:patentId
 * Preview extracted claims text for a patent
 */
router.get('/claims/preview/:patentId', async (req: Request, res: Response) => {
  try {
    const { patentId } = req.params;
    const { independentOnly, maxClaims, maxTokens } = req.query;

    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';

    const claimsText = extractClaimsText(patentId, xmlDir, {
      independentOnly: independentOnly !== 'false',
      maxClaims: maxClaims ? parseInt(maxClaims as string) : 5,
      maxTokens: maxTokens ? parseInt(maxTokens as string) : 800,
    });

    if (!claimsText) {
      return res.status(404).json({
        patentId,
        found: false,
        message: 'XML file not found or claims could not be extracted'
      });
    }

    const stats = getClaimsStats(patentId, xmlDir);

    res.json({
      patentId,
      found: true,
      stats,
      extractedText: claimsText,
      estimatedTokens: Math.ceil(claimsText.length / 4),
    });
  } catch (error) {
    console.error('[Claims] Preview error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/scoring-templates/compare/single/:patentId
 * Compare scoring with and without claims for a single patent
 */
router.post('/compare/single/:patentId', async (req: Request, res: Response) => {
  try {
    const { patentId } = req.params;
    const { model } = req.query;

    // Load patent data from candidates file
    const fs = await import('fs');
    const path = await import('path');

    const candidatesPath = path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json');
    const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
    const candidates = Array.isArray(fileContent) ? fileContent : fileContent.candidates;

    const candidate = candidates.find((c: any) => c.patent_id === patentId);
    if (!candidate) {
      return res.status(404).json({ error: `Patent ${patentId} not found in candidates` });
    }

    const patent: PatentForScoring = {
      patent_id: candidate.patent_id,
      patent_title: candidate.patent_title,
      primary_sub_sector_id: candidate.primary_sub_sector_id,
      primary_sub_sector_name: candidate.primary_sub_sector_name,
      primary_sector: candidate.primary_sector,
      super_sector: candidate.super_sector,
      cpc_codes: candidate.cpc_codes || [],
    };

    console.log(`[Compare] Running comparison for ${patentId}...`);
    const result = await comparePatentScoring(patent, { model: model as string });

    res.json(result);
  } catch (error) {
    console.error('[Compare] Single patent error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/compare/test-set/:sectorName
 * Get a stratified test set from scored patents in a sector
 */
router.get('/compare/test-set/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const { count } = req.query;

    const testSet = await getComparisonTestSet(sectorName, {
      count: count ? parseInt(count as string) : 50
    });

    // Get claims stats for each patent
    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';
    const withStats = testSet.map(p => ({
      ...p,
      claimsStats: getClaimsStats(p.patent_id, xmlDir)
    }));

    const claimsAvailable = withStats.filter(p => p.claimsStats?.found).length;

    res.json({
      sectorName,
      totalPatents: testSet.length,
      claimsAvailable,
      coverage: Math.round((claimsAvailable / testSet.length) * 100) + '%',
      testSet: withStats.map(p => ({
        patent_id: p.patent_id,
        patent_title: p.patent_title,
        primary_sector: p.primary_sector,
        claimsAvailable: p.claimsStats?.found || false,
        estimatedClaimTokens: p.claimsStats?.estimatedTokens || 0,
      }))
    });
  } catch (error) {
    console.error('[Compare] Test set error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/scoring-templates/compare/run/:sectorName
 * Run full comparison test on a sector
 * WARNING: This is expensive - scores each patent twice!
 */
router.post('/compare/run/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const { count, model } = req.query;

    console.log(`[Compare] Starting comparison test for sector: ${sectorName}`);

    // Get test set
    const testSet = await getComparisonTestSet(sectorName, {
      count: count ? parseInt(count as string) : 20  // Default to 20 for cost control
    });

    if (testSet.length === 0) {
      return res.status(404).json({ error: `No scored patents found in sector: ${sectorName}` });
    }

    console.log(`[Compare] Running comparison on ${testSet.length} patents...`);

    // Run comparison
    const result = await runComparisonTest(testSet, {
      model: model as string,
      progressCallback: (completed, total) => {
        console.log(`[Compare] Progress: ${completed}/${total}`);
      }
    });

    res.json(result);
  } catch (error) {
    console.error('[Compare] Run error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
