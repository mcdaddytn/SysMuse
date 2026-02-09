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
 * Query params:
 *   - limit: max patents to score (default 2000)
 *   - model: LLM model to use
 *   - concurrency: parallel requests (default 2)
 *   - useClaims: 'true' to include patent claims in context (1.6x cost)
 *   - rescore: 'true' to re-score already scored patents (overwrites existing scores)
 *   - minYear: filter to patents from this year or later (e.g., 2015)
 *   - minScore: filter to patents with base score >= this value (e.g., 3)
 *   - excludeDesign: exclude design patents (D-prefix), defaults to true
 *   - prioritizeBy: 'base' (default) or 'v2' - how to prioritize patents for scoring
 *   - v2Citation: V2 citation weight (default 50) - only used when prioritizeBy=v2
 *   - v2Years: V2 years weight (default 30) - only used when prioritizeBy=v2
 *   - v2Competitor: V2 competitor weight (default 20) - only used when prioritizeBy=v2
 */
router.post('/llm/score-sector/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const { limit, model, concurrency, useClaims, rescore, minYear, minScore, excludeDesign, prioritizeBy, v2Citation, v2Years, v2Competitor } = req.query;

    const contextOptions = useClaims === 'true' ? CLAIMS_CONTEXT_OPTIONS : DEFAULT_CONTEXT_OPTIONS;

    console.log(`[LLM Scoring] Starting sector scoring: ${sectorName}`);
    if (useClaims === 'true') {
      console.log(`[LLM Scoring] CLAIMS CONTEXT ENABLED - expect ~1.6x token usage`);
    }
    if (rescore === 'true') {
      console.log(`[LLM Scoring] RESCORE MODE - will overwrite existing scores`);
    }
    if (minYear) {
      console.log(`[LLM Scoring] FILTER: patents from ${minYear}+`);
    }
    if (minScore) {
      console.log(`[LLM Scoring] FILTER: base score >= ${minScore}`);
    }
    if (excludeDesign !== 'false') {
      console.log(`[LLM Scoring] FILTER: excluding design patents`);
    }
    if (prioritizeBy === 'v2') {
      console.log(`[LLM Scoring] PRIORITIZING BY V2 SCORE`);
    }

    // Build V2 weights if prioritizing by V2
    const v2Weights = prioritizeBy === 'v2' ? {
      citation: v2Citation ? parseInt(v2Citation as string) : 50,
      years: v2Years ? parseInt(v2Years as string) : 30,
      competitor: v2Competitor ? parseInt(v2Competitor as string) : 20
    } : undefined;

    const result = await scoreSector(sectorName, {
      limit: limit ? parseInt(limit as string) : 2000,
      model: model as string,
      concurrency: concurrency ? parseInt(concurrency as string) : 2,
      contextOptions,
      rescore: rescore === 'true',
      minYear: minYear ? parseInt(minYear as string) : undefined,
      minScore: minScore ? parseFloat(minScore as string) : undefined,
      excludeDesign: excludeDesign !== 'false',
      prioritizeBy: (prioritizeBy as 'base' | 'v2') || 'base',
      v2Weights
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
 * POST /api/scoring-templates/llm/preview-patent
 * Preview how a scoring prompt would render for a specific patent
 */
router.post('/llm/preview-patent', async (req: Request, res: Response) => {
  try {
    const { patentId, sectorName, includeClaims } = req.body;

    if (!patentId) {
      return res.status(400).json({ error: 'patentId is required' });
    }

    // Get sector info
    const sector = await prisma.sector.findFirst({
      where: { name: sectorName },
      include: { superSector: true }
    });

    // Get merged template questions
    const superSectorName = sector?.superSector?.name || 'COMPUTING';
    const questions = getMergedQuestionsForSuperSector(superSectorName);

    // Get patent data
    const patentData = await getPatentsForSectorScoring(sectorName || '', {
      limit: 1000,
      onlyUnscored: false
    });

    const patent = patentData.find(p => p.patent_id === patentId);

    if (!patent) {
      return res.status(404).json({ error: `Patent ${patentId} not found in sector ${sectorName}` });
    }
    const questionText = questions.map((q: any, i: number) =>
      `${i + 1}. ${q.displayName} (${q.fieldName}): ${q.question}`
    ).join('\n\n');

    const promptPreview = `=== PATENT CONTEXT ===
Patent ID: ${patent.patent_id}
Title: ${patent.patent_title || 'N/A'}
${patent.patent_abstract ? `Abstract: ${patent.patent_abstract.substring(0, 500)}...` : ''}
${includeClaims && patent.claims_text ? `\nClaims: ${patent.claims_text.substring(0, 1000)}...` : ''}

=== SCORING QUESTIONS (${questions.length} total) ===
${questionText}

=== EXPECTED OUTPUT ===
JSON with scores (1-10) and reasoning for each field`;

    const estimatedTokens = Math.round(promptPreview.length / 4);

    res.json({
      patentId: patent.patent_id,
      patentTitle: patent.patent_title,
      sector: sectorName,
      superSector: superSectorName,
      questionCount: questions.length,
      inheritanceChain: ['portfolio-default', superSectorName, sectorName].filter(Boolean),
      estimatedTokens,
      renderedPrompt: promptPreview,
      questions: questions.map((q: any) => ({
        fieldName: q.fieldName,
        displayName: q.displayName,
        weight: q.weight
      }))
    });
  } catch (error) {
    console.error('[LLM Scoring] Preview patent error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/llm/sector-progress/:sectorName
 * Get scoring progress for a sector
 */
router.get('/llm/sector-progress/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;

    // Get sector info
    const sector = await prisma.sector.findFirst({
      where: { name: sectorName },
      include: { superSector: true }
    });

    if (!sector) {
      return res.status(404).json({ error: `Sector not found: ${sectorName}` });
    }

    // Get scoring stats from patent_sub_sector_scores using template_config_id
    const stats = await prisma.$queryRaw<Array<{ scored: bigint; with_claims: bigint; avg_score: number }>>`
      SELECT
        COUNT(*) as scored,
        SUM(CASE WHEN with_claims THEN 1 ELSE 0 END) as with_claims,
        AVG(composite_score) as avg_score
      FROM patent_sub_sector_scores
      WHERE template_config_id = ${sectorName}
    `;

    const scored = Number(stats[0]?.scored || 0);
    const withClaims = Number(stats[0]?.with_claims || 0);
    const avgScore = stats[0]?.avg_score || 0;
    const total = sector.patentCount || 0;
    const remaining = Math.max(0, total - scored);
    const percentComplete = total > 0 ? Math.round((scored / total) * 100) : 0;

    res.json({
      level: 'sector',
      name: sectorName,
      displayName: sector.displayName,
      superSector: sector.superSector?.name,
      total,
      scored,
      withClaims,
      remaining,
      percentComplete,
      avgScore: avgScore ? Number(avgScore.toFixed(2)) : null
    });
  } catch (error) {
    console.error('[LLM Scoring] Sector progress error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/llm/sector-scores/:sectorName
 * Get scored patents for a sector with all metrics and reasoning
 * Query params:
 *   - limit: max results (default 100)
 *   - offset: pagination offset
 *   - sortBy: 'composite_score' | metric field name (default 'composite_score')
 *   - order: 'asc' | 'desc' (default 'desc')
 */
router.get('/llm/sector-scores/:sectorName', async (req: Request, res: Response) => {
  try {
    const { sectorName } = req.params;
    const {
      limit = '100',
      offset = '0',
      sortBy = 'composite_score',
      order = 'desc'
    } = req.query;

    const limitNum = Math.min(parseInt(limit as string) || 100, 500);
    const offsetNum = parseInt(offset as string) || 0;

    // Get sector info for display
    const sector = await prisma.sector.findFirst({
      where: { name: sectorName },
      include: { superSector: true }
    });

    if (!sector) {
      return res.status(404).json({ error: `Sector not found: ${sectorName}` });
    }

    // Get total count
    const totalCount = await prisma.patentSubSectorScore.count({
      where: { templateConfigId: sectorName }
    });

    // Get scores with pagination
    const scores = await prisma.patentSubSectorScore.findMany({
      where: { templateConfigId: sectorName },
      orderBy: { compositeScore: order === 'asc' ? 'asc' : 'desc' },
      take: limitNum,
      skip: offsetNum
    });

    // Enrich with patent titles from candidates file
    const fs = await import('fs');
    const path = await import('path');
    const possiblePaths = [
      path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json'),
      path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-24.json'),
    ];

    let candidatesPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        candidatesPath = p;
        break;
      }
    }

    type PatentCandidate = {
      patent_id: string;
      patent_title?: string;
      patent_date?: string;
      assignee?: string;
    };

    let patentMap = new Map<string, PatentCandidate>();
    if (candidatesPath) {
      const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
      const candidates: PatentCandidate[] = Array.isArray(fileContent) ? fileContent : fileContent.candidates;
      const patentIds = scores.map(s => s.patentId);
      patentMap = new Map(
        candidates
          .filter((p: PatentCandidate) => patentIds.includes(p.patent_id))
          .map((p: PatentCandidate) => [p.patent_id, p])
      );
    }

    // Format response with metrics expanded
    const results = scores.map(score => {
      const patent = patentMap.get(score.patentId);
      const metrics = score.metrics as Record<string, { score: number; reasoning: string; confidence?: number }> || {};

      return {
        patentId: score.patentId,
        patentTitle: patent?.patent_title || 'Unknown',
        patentDate: patent?.patent_date,
        assignee: patent?.assignee,
        compositeScore: score.compositeScore,
        withClaims: score.withClaims,
        executedAt: score.executedAt,
        templateVersion: score.templateVersion,
        metrics: Object.entries(metrics).map(([fieldName, data]) => ({
          fieldName,
          displayName: fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          score: data.score,
          reasoning: data.reasoning,
          confidence: data.confidence
        }))
      };
    });

    // Get unique metric names for column headers
    const allMetricNames = new Set<string>();
    scores.forEach(s => {
      const metrics = s.metrics as Record<string, unknown> || {};
      Object.keys(metrics).forEach(k => allMetricNames.add(k));
    });

    res.json({
      sectorName,
      sectorDisplayName: sector.displayName,
      superSector: sector.superSector?.name,
      total: totalCount,
      limit: limitNum,
      offset: offsetNum,
      metricNames: Array.from(allMetricNames).sort(),
      results
    });
  } catch (error) {
    console.error('[LLM Scoring] Sector scores error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/llm/super-sector-progress/:superSectorName
 * Get aggregated scoring progress for a super-sector
 */
router.get('/llm/super-sector-progress/:superSectorName', async (req: Request, res: Response) => {
  try {
    const { superSectorName } = req.params;

    // Get super-sector and its sectors
    const superSector = await prisma.superSector.findFirst({
      where: { name: superSectorName },
      include: { sectors: true }
    });

    if (!superSector) {
      return res.status(404).json({ error: `Super-sector not found: ${superSectorName}` });
    }

    // Get scoring stats for each sector
    const sectorStats = await Promise.all(
      superSector.sectors.map(async (sector) => {
        const stats = await prisma.$queryRaw<Array<{ scored: bigint; with_claims: bigint; avg_score: number }>>`
          SELECT
            COUNT(*) as scored,
            SUM(CASE WHEN with_claims THEN 1 ELSE 0 END) as with_claims,
            AVG(composite_score) as avg_score
          FROM patent_sub_sector_scores
          WHERE template_config_id = ${sector.name}
        `;

        const scored = Number(stats[0]?.scored || 0);
        const withClaims = Number(stats[0]?.with_claims || 0);
        const avgScore = stats[0]?.avg_score || null;
        const total = sector.patentCount || 0;

        return {
          sectorId: sector.id,
          sectorName: sector.name,
          displayName: sector.displayName,
          total,
          scored,
          withClaims,
          remaining: Math.max(0, total - scored),
          percentComplete: total > 0 ? Math.round((scored / total) * 100) : 0,
          avgScore: avgScore ? Number(avgScore.toFixed(2)) : null
        };
      })
    );

    // Aggregate totals
    const totals = sectorStats.reduce((acc, s) => ({
      total: acc.total + s.total,
      scored: acc.scored + s.scored,
      withClaims: acc.withClaims + s.withClaims
    }), { total: 0, scored: 0, withClaims: 0 });

    // Calculate weighted average score
    const scoredSectors = sectorStats.filter(s => s.avgScore !== null && s.scored > 0);
    const weightedAvg = scoredSectors.length > 0
      ? scoredSectors.reduce((sum, s) => sum + (s.avgScore! * s.scored), 0) / totals.scored
      : null;

    res.json({
      name: superSectorName,
      displayName: superSector.displayName,
      sectorCount: superSector.sectors.length,
      totals: {
        total: totals.total,
        scored: totals.scored,
        withClaims: totals.withClaims,
        remaining: Math.max(0, totals.total - totals.scored),
        percentComplete: totals.total > 0 ? Math.round((totals.scored / totals.total) * 100) : 0,
        avgScore: weightedAvg ? Number(weightedAvg.toFixed(2)) : null
      },
      sectors: sectorStats.sort((a, b) => b.scored - a.scored)
    });
  } catch (error) {
    console.error('[LLM Scoring] Super-sector progress error:', error);
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

// =============================================================================
// ENHANCED EXPORT (with LLM metrics, reasoning, and claims availability)
// =============================================================================

/**
 * GET /api/scoring-templates/export/:superSector
 * Export patents with all columns including sector-specific LLM metrics with reasoning
 * Query params:
 *   - format: 'csv' (default) or 'json'
 *   - includeReasoning: 'true' to include reasoning text (default true)
 *   - minScore: minimum composite score filter
 */
router.get('/export/:superSector', async (req: Request, res: Response) => {
  try {
    const { superSector } = req.params;
    const { format = 'csv', includeReasoning = 'true', minScore } = req.query;

    console.log(`[Export] Starting export for super-sector: ${superSector}`);

    // Load candidates file
    const fs = await import('fs');
    const path = await import('path');
    const possiblePaths = [
      path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json'),
      path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-24.json'),
    ];

    let candidatesPath: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        candidatesPath = p;
        break;
      }
    }

    if (!candidatesPath) {
      return res.status(404).json({ error: 'Candidates file not found' });
    }

    const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
    const candidates = Array.isArray(fileContent) ? fileContent : fileContent.candidates;

    // Filter to super-sector
    const superSectorUpper = superSector.toUpperCase().replace(/-/g, '_');
    let patents = candidates.filter((p: any) =>
      p.super_sector?.toUpperCase().replace(/-/g, '_') === superSectorUpper
    );

    console.log(`[Export] Found ${patents.length} patents in ${superSector}`);

    // Get all LLM scores for these patents
    const patentIds = patents.map((p: any) => p.patent_id);
    const scores = await prisma.patentSubSectorScore.findMany({
      where: { patentId: { in: patentIds } }
    });

    console.log(`[Export] Found ${scores.length} LLM scores`);

    // Create lookup map
    const scoreMap = new Map(scores.map(s => [s.patentId, s]));

    // Check claims availability
    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';
    const checkClaimsAvailable = (patentId: string): boolean => {
      try {
        const stats = getClaimsStats(patentId, xmlDir);
        return stats !== null && stats.independentClaims > 0;
      } catch {
        return false;
      }
    };

    // Collect all unique metric names from scores
    const allMetricNames = new Set<string>();
    scores.forEach(s => {
      if (s.metrics && typeof s.metrics === 'object') {
        Object.keys(s.metrics as object).forEach(k => allMetricNames.add(k));
      }
    });
    const metricNames = Array.from(allMetricNames).sort();

    console.log(`[Export] Found ${metricNames.length} unique metrics: ${metricNames.join(', ')}`);

    // Build export rows
    const exportRows = patents.map((p: any) => {
      const score = scoreMap.get(p.patent_id);
      const metrics = (score?.metrics || {}) as Record<string, { score: number; reasoning: string; confidence: number }>;
      const claimsAvailable = checkClaimsAvailable(p.patent_id);

      // Base columns
      const row: Record<string, any> = {
        patent_id: p.patent_id,
        patent_title: p.patent_title,
        patent_date: p.patent_date,
        remaining_years: p.remaining_years,
        assignee: p.assignee,
        super_sector: p.super_sector,
        primary_sector: p.primary_sector,
        primary_sub_sector_name: p.primary_sub_sector_name,
        forward_citations: p.forward_citations,
        cpc_codes: Array.isArray(p.cpc_codes) ? p.cpc_codes.join('; ') : p.cpc_codes,
        base_score: p.score,

        // LLM composite score
        llm_composite_score: score?.compositeScore ?? null,
        has_llm_score: !!score,
        claims_available: claimsAvailable,
        scored_at: score?.executedAt?.toISOString() ?? null,
      };

      // Add each metric as separate columns
      for (const metricName of metricNames) {
        const metric = metrics[metricName];
        row[`${metricName}_score`] = metric?.score ?? null;
        row[`${metricName}_confidence`] = metric?.confidence ?? null;
        if (includeReasoning === 'true') {
          row[`${metricName}_reasoning`] = metric?.reasoning ?? null;
        }
      }

      return row;
    });

    // Apply minScore filter if specified
    let filteredRows = exportRows;
    if (minScore) {
      const threshold = parseFloat(minScore as string);
      filteredRows = exportRows.filter(r => r.llm_composite_score >= threshold);
      console.log(`[Export] Filtered to ${filteredRows.length} rows with score >= ${threshold}`);
    }

    // Sort by composite score descending
    filteredRows.sort((a, b) => (b.llm_composite_score ?? 0) - (a.llm_composite_score ?? 0));

    if (format === 'json') {
      res.json({
        superSector,
        totalPatents: patents.length,
        exportedPatents: filteredRows.length,
        metricsIncluded: metricNames,
        patents: filteredRows
      });
    } else {
      // Build CSV
      const escapeCSV = (val: unknown): string => {
        if (val === null || val === undefined) return '';
        if (Array.isArray(val)) return `"${val.join('; ')}"`;
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const columns = Object.keys(filteredRows[0] || {});
      const header = columns.join(',');
      const rows = filteredRows.map(row =>
        columns.map(col => escapeCSV(row[col])).join(',')
      );

      const csv = [header, ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${superSector}-export-${new Date().toISOString().split('T')[0]}.csv"`);
      console.log(`[Export] Completed CSV export: ${filteredRows.length} patents, ${columns.length} columns`);
      res.send(csv);
    }

  } catch (error) {
    console.error('[Export] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/scoring-templates/claims-analysis/:superSector
 * Analyze claims availability across a super-sector
 */
router.get('/claims-analysis/:superSector', async (req: Request, res: Response) => {
  try {
    const { superSector } = req.params;
    const { topN } = req.query;

    console.log(`[Claims Analysis] Analyzing ${superSector}...`);

    // Load candidates
    const fs = await import('fs');
    const path = await import('path');
    const candidatesPath = path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json');
    const fileContent = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
    const candidates = Array.isArray(fileContent) ? fileContent : fileContent.candidates;

    // Filter to super-sector
    const superSectorUpper = superSector.toUpperCase().replace(/-/g, '_');
    let patents = candidates.filter((p: any) =>
      p.super_sector?.toUpperCase().replace(/-/g, '_') === superSectorUpper
    );

    // Get LLM scores
    const patentIds = patents.map((p: any) => p.patent_id);
    const scores = await prisma.patentSubSectorScore.findMany({
      where: { patentId: { in: patentIds } }
    });
    const scoreMap = new Map(scores.map(s => [s.patentId, s.compositeScore]));

    // Sort by score if we have scores
    patents = patents.map((p: any) => ({
      ...p,
      llm_score: scoreMap.get(p.patent_id) ?? null
    }));
    patents.sort((a: any, b: any) => (b.llm_score ?? b.score ?? 0) - (a.llm_score ?? a.score ?? 0));

    // Limit to topN if specified
    if (topN) {
      patents = patents.slice(0, parseInt(topN as string));
    }

    // Check claims availability
    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '/Volumes/PortFat4/uspto/bulkdata/export';

    let withClaims = 0;
    let withoutClaims = 0;
    const missingClaimsList: any[] = [];
    const bySector: Record<string, { total: number; withClaims: number; withoutClaims: number }> = {};

    for (const p of patents) {
      const sector = p.primary_sector || 'unknown';
      if (!bySector[sector]) {
        bySector[sector] = { total: 0, withClaims: 0, withoutClaims: 0 };
      }
      bySector[sector].total++;

      try {
        const stats = getClaimsStats(p.patent_id, xmlDir);
        if (stats && stats.independentClaims > 0) {
          withClaims++;
          bySector[sector].withClaims++;
        } else {
          withoutClaims++;
          bySector[sector].withoutClaims++;
          missingClaimsList.push({
            patent_id: p.patent_id,
            patent_title: p.patent_title,
            patent_date: p.patent_date,
            sector: p.primary_sector,
            llm_score: p.llm_score,
            base_score: p.score
          });
        }
      } catch {
        withoutClaims++;
        bySector[sector].withoutClaims++;
        missingClaimsList.push({
          patent_id: p.patent_id,
          patent_title: p.patent_title,
          patent_date: p.patent_date,
          sector: p.primary_sector,
          llm_score: p.llm_score,
          base_score: p.score
        });
      }
    }

    res.json({
      superSector,
      totalAnalyzed: patents.length,
      withClaims,
      withoutClaims,
      claimsAvailabilityRate: (withClaims / patents.length * 100).toFixed(1) + '%',
      bySector,
      missingClaimsPatents: missingClaimsList.slice(0, 50)  // Top 50 missing
    });

  } catch (error) {
    console.error('[Claims Analysis] Error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
