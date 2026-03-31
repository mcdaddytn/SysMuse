/**
 * Classification Query API Routes
 *
 * Provides endpoints for querying multi-classification data:
 * - Find patents by secondary/tertiary associations
 * - Find cross-domain patents spanning super-sectors
 * - Get classification statistics
 */

import { Router, Request, Response } from 'express';
import {
  crossClassificationService,
  ClassificationQueryParams,
  CrossDomainQueryParams,
} from '../services/cross-classification-service.js';

const router = Router();

// =============================================================================
// QUERY ENDPOINTS
// =============================================================================

/**
 * GET /api/classifications/patents
 * Find patents by taxonomy association
 *
 * Query params:
 * - taxonomyNodeId: Filter by specific node ID
 * - taxonomyNodeCode: Filter by node code (alternative to ID)
 * - ranks: Comma-separated association ranks (e.g., "2,3" for non-primary)
 * - minConfidence: Minimum confidence threshold
 * - minWeight: Minimum weight threshold
 * - portfolioGroupId: Limit to portfolio group
 * - portfolioId: Limit to specific portfolio
 * - limit: Max results (default 100)
 * - offset: Pagination offset
 */
router.get('/patents', async (req: Request, res: Response) => {
  try {
    const params: ClassificationQueryParams = {
      taxonomyNodeId: req.query.taxonomyNodeId as string | undefined,
      taxonomyNodeCode: req.query.taxonomyNodeCode as string | undefined,
      associationRanks: req.query.ranks
        ? (req.query.ranks as string).split(',').map(Number)
        : undefined,
      minConfidence: req.query.minConfidence
        ? parseFloat(req.query.minConfidence as string)
        : undefined,
      minWeight: req.query.minWeight
        ? parseFloat(req.query.minWeight as string)
        : undefined,
      portfolioGroupId: req.query.portfolioGroupId as string | undefined,
      portfolioId: req.query.portfolioId as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    const results = await crossClassificationService.findPatentsByAssociation(params);
    res.json({
      count: results.length,
      params,
      patents: results,
    });
  } catch (err: unknown) {
    console.error('[Classifications] Query error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/classifications/cross-domain
 * Find patents spanning multiple super-sectors
 *
 * Query params:
 * - superSectorIds: Comma-separated super-sector IDs (must span ALL)
 * - superSectorCodes: Comma-separated super-sector codes (alternative)
 * - ranks: Which association ranks to consider
 * - portfolioGroupId, portfolioId, limit, offset
 */
router.get('/cross-domain', async (req: Request, res: Response) => {
  try {
    const params: CrossDomainQueryParams = {
      superSectorIds: req.query.superSectorIds
        ? (req.query.superSectorIds as string).split(',')
        : undefined,
      superSectorCodes: req.query.superSectorCodes
        ? (req.query.superSectorCodes as string).split(',')
        : undefined,
      associationRanks: req.query.ranks
        ? (req.query.ranks as string).split(',').map(Number)
        : undefined,
      portfolioGroupId: req.query.portfolioGroupId as string | undefined,
      portfolioId: req.query.portfolioId as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    if (!params.superSectorIds && !params.superSectorCodes) {
      res.status(400).json({
        error: 'Either superSectorIds or superSectorCodes is required',
      });
      return;
    }

    const results = await crossClassificationService.findCrossDomainPatents(params);
    res.json({
      count: results.length,
      params,
      patents: results,
    });
  } catch (err: unknown) {
    console.error('[Classifications] Cross-domain query error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/classifications/patent/:patentId
 * Get all classifications for a specific patent
 */
router.get('/patent/:patentId', async (req: Request, res: Response) => {
  try {
    const { patentId } = req.params;
    const results = await crossClassificationService.getPatentsWithClassifications([patentId]);

    if (results.length === 0) {
      res.status(404).json({ error: 'Patent not found or has no classifications' });
      return;
    }

    res.json(results[0]);
  } catch (err: unknown) {
    console.error('[Classifications] Patent lookup error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// STATISTICS ENDPOINTS
// =============================================================================

/**
 * GET /api/classifications/stats
 * Get classification statistics
 *
 * Query params:
 * - portfolioGroupId: Limit to portfolio group
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const portfolioGroupId = req.query.portfolioGroupId as string | undefined;
    const stats = await crossClassificationService.getClassificationStats(portfolioGroupId);
    res.json(stats);
  } catch (err: unknown) {
    console.error('[Classifications] Stats error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/classifications/super-sector-distribution
 * Get patent distribution by super-sector
 *
 * Query params:
 * - portfolioGroupId: Limit to portfolio group
 */
router.get('/super-sector-distribution', async (req: Request, res: Response) => {
  try {
    const portfolioGroupId = req.query.portfolioGroupId as string | undefined;
    const distribution = await crossClassificationService.getSuperSectorDistribution(portfolioGroupId);
    res.json({
      count: distribution.length,
      distribution,
    });
  } catch (err: unknown) {
    console.error('[Classifications] Distribution error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// =============================================================================
// EXPORT
// =============================================================================

export default router;
