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

export default router;
