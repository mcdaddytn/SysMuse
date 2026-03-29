/**
 * Formula Definition + Weight Profile API Routes
 *
 * CRUD for formula definitions and weight profiles,
 * plus a formula evaluation endpoint.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { evaluateFormula } from '../services/formula-engine.js';
import type { FormulaStructure, ScalingConfig } from '../services/formula-types.js';
import { resolveMetricsForPortfolio, extractAttributes } from '../services/metric-resolver.js';
import { generateFormulaForScope, getOrCreateFormula, listAvailableScopes } from '../services/formula-generator.js';

const prisma = new PrismaClient();
const router = Router();

// =============================================================================
// Formula Definitions
// =============================================================================

/** List formula definitions */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { scopeType, portfolioGroupId, active } = req.query;

    const where: any = {};
    if (scopeType) where.scopeType = scopeType;
    if (portfolioGroupId) where.portfolioGroupId = portfolioGroupId;
    if (active === 'true') where.isActive = true;

    const formulas = await prisma.formulaDefinition.findMany({
      where,
      include: {
        weightProfiles: {
          where: { formulaDefId: { not: undefined } },
          select: {
            id: true,
            name: true,
            description: true,
            isDefault: true,
            isBuiltIn: true,
          },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({ data: formulas, total: formulas.length });
  } catch (error: any) {
    console.error('Error listing formulas:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/formulas/scopes
 * List available taxonomy scopes that can have formulas generated.
 * MUST be before /:id to avoid Express treating "scopes" as an ID.
 */
router.get('/scopes', (_req: Request, res: Response) => {
  try {
    const scopes = listAvailableScopes();
    res.json(scopes);
  } catch (error: any) {
    console.error('Error listing scopes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/formulas/generate
 * Generate a taxonomy-scoped formula from scoring templates.
 * MUST be before /:id to avoid Express treating "generate" as an ID.
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { scopeType, scopeId, superSectorName, sectorName, subSectorName } = req.body;

    if (!scopeType || !scopeId || !superSectorName) {
      return res.status(400).json({ error: 'scopeType, scopeId, and superSectorName are required' });
    }

    const { formulaId, isNew } = await getOrCreateFormula(
      scopeType,
      scopeId,
      superSectorName,
      sectorName,
      subSectorName,
    );

    const formula = await prisma.formulaDefinition.findUnique({
      where: { id: formulaId },
      include: {
        weightProfiles: {
          where: { formulaDefId: { not: undefined } },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        },
      },
    });

    res.status(isNew ? 201 : 200).json({ formula, isNew });
  } catch (error: any) {
    console.error('Error generating formula:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Get formula definition with full weight profiles */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const formula = await prisma.formulaDefinition.findUnique({
      where: { id: req.params.id },
      include: {
        weightProfiles: {
          where: { formulaDefId: { not: undefined } },
          orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        },
      },
    });

    if (!formula) {
      return res.status(404).json({ error: 'Formula not found' });
    }

    res.json(formula);
  } catch (error: any) {
    console.error('Error getting formula:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Weight Profiles
// =============================================================================

/** List weight profiles for a formula */
router.get('/:formulaId/profiles', async (req: Request, res: Response) => {
  try {
    const profiles = await prisma.weightProfile.findMany({
      where: { formulaDefId: req.params.formulaId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    res.json({ data: profiles, total: profiles.length });
  } catch (error: any) {
    console.error('Error listing profiles:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Get a specific weight profile */
router.get('/:formulaId/profiles/:profileId', async (req: Request, res: Response) => {
  try {
    const profile = await prisma.weightProfile.findUnique({
      where: { id: req.params.profileId },
    });

    if (!profile || profile.formulaDefId !== req.params.formulaId) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json(profile);
  } catch (error: any) {
    console.error('Error getting profile:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Create a weight profile for a formula */
router.post('/:formulaId/profiles', async (req: Request, res: Response) => {
  try {
    const { name, displayName, description, weights, consensusWeight, userId } = req.body;

    if (!name || !weights) {
      return res.status(400).json({ error: 'name and weights are required' });
    }

    // Verify formula exists
    const formula = await prisma.formulaDefinition.findUnique({
      where: { id: req.params.formulaId },
    });
    if (!formula) {
      return res.status(404).json({ error: 'Formula not found' });
    }

    const profile = await prisma.weightProfile.create({
      data: {
        name,
        description: description ?? displayName ?? name,
        scopeType: 'GLOBAL',
        weights,
        isBuiltIn: false,
        isActive: true,
        formulaDefId: req.params.formulaId,
        consensusWeight: consensusWeight ?? null,
        userId: userId ?? null,
      },
    });

    res.status(201).json(profile);
  } catch (error: any) {
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Profile with this name already exists' });
    }
    console.error('Error creating profile:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Update a weight profile */
router.put('/:formulaId/profiles/:profileId', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.weightProfile.findUnique({
      where: { id: req.params.profileId },
    });
    if (!existing || existing.formulaDefId !== req.params.formulaId) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { weights, description, consensusWeight } = req.body;

    const profile = await prisma.weightProfile.update({
      where: { id: req.params.profileId },
      data: {
        ...(weights && { weights }),
        ...(description !== undefined && { description }),
        ...(consensusWeight !== undefined && { consensusWeight }),
      },
    });

    res.json(profile);
  } catch (error: any) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Delete a weight profile (non-builtin only) */
router.delete('/:formulaId/profiles/:profileId', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.weightProfile.findUnique({
      where: { id: req.params.profileId },
    });
    if (!existing || existing.formulaDefId !== req.params.formulaId) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    if (existing.isBuiltIn) {
      return res.status(403).json({ error: 'Cannot delete built-in profiles' });
    }

    await prisma.weightProfile.delete({ where: { id: req.params.profileId } });
    res.status(204).send();
  } catch (error: any) {
    console.error('Error deleting profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Formula Evaluation
// =============================================================================

/**
 * Evaluate a formula against patents.
 *
 * This endpoint loads patent metrics and runs them through the formula engine.
 * Accepts either a saved profileId or ad-hoc weights.
 *
 * For now, this requires rawMetrics to be provided in the request body
 * (batch evaluation with data loading will be added when we wire the adapter).
 */
router.post('/:id/evaluate', async (req: Request, res: Response) => {
  try {
    const formula = await prisma.formulaDefinition.findUnique({
      where: { id: req.params.id },
    });
    if (!formula) {
      return res.status(404).json({ error: 'Formula not found' });
    }

    const { profileId, weights: adHocWeights, rawMetrics, scalingOverrides } = req.body;

    // Resolve weights: either from saved profile or ad-hoc
    let weights: Record<string, number>;
    if (profileId) {
      const profile = await prisma.weightProfile.findUnique({
        where: { id: profileId },
      });
      if (!profile) {
        return res.status(404).json({ error: 'Profile not found' });
      }
      weights = profile.weights as Record<string, number>;
    } else if (adHocWeights) {
      weights = adHocWeights;
    } else {
      // Use default profile for this formula
      const defaultProfile = await prisma.weightProfile.findFirst({
        where: { formulaDefId: req.params.id, isDefault: true },
      });
      if (!defaultProfile) {
        return res.status(400).json({ error: 'No weights provided and no default profile found' });
      }
      weights = defaultProfile.weights as Record<string, number>;
    }

    const structure = formula.structure as unknown as FormulaStructure;

    // Single patent evaluation (rawMetrics provided directly)
    if (rawMetrics && !Array.isArray(rawMetrics)) {
      const result = evaluateFormula(
        structure,
        weights,
        rawMetrics,
        scalingOverrides as Record<string, ScalingConfig> | undefined,
      );
      return res.json(result);
    }

    // Batch evaluation (array of {patent_id, metrics})
    if (Array.isArray(rawMetrics)) {
      const results = rawMetrics.map((entry: { patent_id: string; metrics: Record<string, number | undefined> }) => {
        const result = evaluateFormula(
          structure,
          weights,
          entry.metrics,
          scalingOverrides as Record<string, ScalingConfig> | undefined,
        );
        return {
          patent_id: entry.patent_id,
          ...result,
        };
      });

      // Sort by score descending and assign ranks
      results.sort((a, b) => b.score - a.score);
      results.forEach((r, i) => { (r as any).rank = i + 1; });

      return res.json({
        data: results,
        total: results.length,
        formulaId: formula.id,
        formulaName: formula.name,
      });
    }

    return res.status(400).json({ error: 'rawMetrics (object or array) is required' });
  } catch (error: any) {
    console.error('Error evaluating formula:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Portfolio Evaluation (data-loading endpoint)
// =============================================================================

/**
 * POST /api/formulas/:id/evaluate-portfolio
 * Evaluate a formula against all patents in a portfolio, loading metrics from DB.
 */
router.post('/:id/evaluate-portfolio', async (req: Request, res: Response) => {
  try {
    const formula = await prisma.formulaDefinition.findUnique({
      where: { id: req.params.id },
    });
    if (!formula) {
      return res.status(404).json({ error: 'Formula not found' });
    }

    const {
      portfolioId,
      profileId,
      weights: adHocWeights,
      topN = 100,
      llmEnhancedOnly = false,
      previousRankings,
      subSectorId,
      scalingOverrides,
    } = req.body;

    if (!portfolioId) {
      return res.status(400).json({ error: 'portfolioId is required' });
    }

    // Resolve weights
    let weights: Record<string, number>;
    if (profileId) {
      const profile = await prisma.weightProfile.findUnique({ where: { id: profileId } });
      if (!profile) return res.status(404).json({ error: 'Profile not found' });
      weights = profile.weights as Record<string, number>;
    } else if (adHocWeights) {
      weights = adHocWeights;
    } else {
      const defaultProfile = await prisma.weightProfile.findFirst({
        where: { formulaDefId: req.params.id, isDefault: true },
      });
      if (!defaultProfile) return res.status(400).json({ error: 'No weights provided and no default profile found' });
      weights = defaultProfile.weights as Record<string, number>;
    }

    const structure = formula.structure as unknown as FormulaStructure;
    const attributes = extractAttributes(structure);

    // Load metrics from DB
    const resolved = await resolveMetricsForPortfolio(portfolioId, attributes, {
      llmEnhancedOnly,
      subSectorId,
    });

    // Evaluate each patent
    const scored = resolved.map(r => {
      const result = evaluateFormula(
        structure,
        weights,
        r.rawMetrics,
        scalingOverrides as Record<string, ScalingConfig> | undefined,
      );
      return {
        patent_id: r.patentId,
        rank: 0,
        rank_change: undefined as number | undefined,
        score: result.score,
        base_score: result.baseScore,
        group_scores: result.groupScores,
        normalized_metrics: result.normalizedMetrics,
        metrics_used: result.metricsUsed,
        year_multiplier: result.multiplierValues['years_remaining'],
        ...r.metadata,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Assign ranks and rank changes
    const prevRankMap = previousRankings
      ? new Map((previousRankings as Array<{ patent_id: string; rank: number }>).map(r => [r.patent_id, r.rank]))
      : null;

    for (let i = 0; i < scored.length; i++) {
      scored[i].rank = i + 1;
      if (prevRankMap) {
        const prev = prevRankMap.get(scored[i].patent_id);
        if (prev !== undefined) scored[i].rank_change = prev - scored[i].rank;
      }
    }

    // Apply topN
    const limited = topN > 0 ? scored.slice(0, topN) : scored;

    res.json({
      data: limited,
      total: scored.length,
      returned: limited.length,
      formulaId: formula.id,
      formulaName: formula.name,
      formulaDisplayName: formula.displayName,
    });
  } catch (error: any) {
    console.error('Error evaluating portfolio:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Consensus Scoring
// =============================================================================

/**
 * POST /api/formulas/:id/consensus
 * Evaluate a formula with multiple weight profiles and compute weighted consensus.
 */
router.post('/:id/consensus', async (req: Request, res: Response) => {
  try {
    const formula = await prisma.formulaDefinition.findUnique({
      where: { id: req.params.id },
    });
    if (!formula) {
      return res.status(404).json({ error: 'Formula not found' });
    }

    const { portfolioId, profiles, topN = 100, llmEnhancedOnly = false, subSectorId } = req.body;

    if (!portfolioId) return res.status(400).json({ error: 'portfolioId is required' });
    if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
      return res.status(400).json({ error: 'profiles array is required (each with profileId and consensusWeight)' });
    }

    const structure = formula.structure as unknown as FormulaStructure;
    const attributes = extractAttributes(structure);

    // Load metrics once (shared across all profiles)
    const resolved = await resolveMetricsForPortfolio(portfolioId, attributes, {
      llmEnhancedOnly,
      subSectorId,
    });

    // Load all profile weights
    const profileConfigs: Array<{ weights: Record<string, number>; consensusWeight: number; name: string }> = [];
    for (const p of profiles) {
      const profile = await prisma.weightProfile.findUnique({ where: { id: p.profileId } });
      if (!profile) return res.status(404).json({ error: `Profile ${p.profileId} not found` });
      profileConfigs.push({
        weights: profile.weights as Record<string, number>,
        consensusWeight: p.consensusWeight ?? 1,
        name: profile.name,
      });
    }

    const totalConsensusWeight = profileConfigs.reduce((s, p) => s + p.consensusWeight, 0);

    // Evaluate each patent with each profile, then compute consensus
    const consensusScored = resolved.map(r => {
      const roleScores: Record<string, number> = {};
      let weightedScoreSum = 0;

      for (const pc of profileConfigs) {
        const result = evaluateFormula(structure, pc.weights, r.rawMetrics);
        roleScores[pc.name] = result.score;
        weightedScoreSum += result.score * pc.consensusWeight;
      }

      const consensusScore = totalConsensusWeight > 0
        ? Math.round((weightedScoreSum / totalConsensusWeight) * 100) / 100
        : 0;

      return {
        patent_id: r.patentId,
        rank: 0,
        consensus_score: consensusScore,
        role_scores: roleScores,
        ...r.metadata,
      };
    });

    // Sort and rank
    consensusScored.sort((a, b) => b.consensus_score - a.consensus_score);
    consensusScored.forEach((s, i) => { s.rank = i + 1; });

    const limited = topN > 0 ? consensusScored.slice(0, topN) : consensusScored;

    res.json({
      data: limited,
      total: consensusScored.length,
      returned: limited.length,
      formulaId: formula.id,
      formulaName: formula.name,
      profiles: profileConfigs.map(p => ({ name: p.name, consensusWeight: p.consensusWeight })),
    });
  } catch (error: any) {
    console.error('Error computing consensus:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
