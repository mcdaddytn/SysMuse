/**
 * Currency API Routes — revAIQ Question Version Tracking
 *
 * Endpoints for querying question versions, patent currency status,
 * and currency gap analysis for enrichment planning.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  getCurrentVersion,
  getCurrentVersions,
  getRevAIQ,
  getPatentCurrency,
  getAllPatentCurrency,
  computeCurrencyGaps,
  bumpVersion,
  syncVersionsFromTemplates,
} from '../services/currency-service.js';

const prisma = new PrismaClient();
const router = Router();

// =============================================================================
// Question Versions
// =============================================================================

/** List all current question versions (latest per scope) */
router.get('/versions', async (_req: Request, res: Response) => {
  try {
    // Get latest version per (level, scopeId) using raw groupBy
    const allVersions = await prisma.questionVersion.findMany({
      orderBy: [{ level: 'asc' }, { scopeId: 'asc' }, { version: 'desc' }],
    });

    // Deduplicate to latest per scope
    const seen = new Set<string>();
    const latest = allVersions.filter(v => {
      const key = `${v.level}:${v.scopeId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({
      data: latest,
      total: latest.length,
      byLevel: {
        portfolio: latest.filter(v => v.level === 'portfolio').length,
        super_sector: latest.filter(v => v.level === 'super_sector').length,
        sector: latest.filter(v => v.level === 'sector').length,
        sub_sector: latest.filter(v => v.level === 'sub_sector').length,
      },
    });
  } catch (error: any) {
    console.error('Error listing versions:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Get version history for a specific scope */
router.get('/versions/:level/:scopeId', async (req: Request, res: Response) => {
  try {
    const versions = await prisma.questionVersion.findMany({
      where: { level: req.params.level, scopeId: req.params.scopeId },
      orderBy: { version: 'desc' },
    });

    res.json({ data: versions, total: versions.length });
  } catch (error: any) {
    console.error('Error getting version history:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Get revAIQ for a taxonomy path */
router.get('/revaiq/:taxonomyPath(*)', async (req: Request, res: Response) => {
  try {
    const versions = await getCurrentVersions(req.params.taxonomyPath);
    res.json(versions);
  } catch (error: any) {
    console.error('Error getting revAIQ:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Patent Currency
// =============================================================================

/** Get all currency records for a patent */
router.get('/patent/:patentId', async (req: Request, res: Response) => {
  try {
    const records = await getAllPatentCurrency(req.params.patentId);
    res.json({ data: records, total: records.length });
  } catch (error: any) {
    console.error('Error getting patent currency:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Gap Analysis
// =============================================================================

/** Compute currency gaps for a portfolio at a taxonomy path */
router.get('/gaps/:portfolioId/:taxonomyPath(*)', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const gaps = await computeCurrencyGaps(
      req.params.portfolioId,
      req.params.taxonomyPath,
      { limit },
    );
    res.json(gaps);
  } catch (error: any) {
    console.error('Error computing gaps:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// Admin Operations
// =============================================================================

/** Sync versions from template files */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncVersionsFromTemplates();
    res.json(result);
  } catch (error: any) {
    console.error('Error syncing versions:', error);
    res.status(500).json({ error: error.message });
  }
});

/** Manually bump a version */
router.post('/bump', async (req: Request, res: Response) => {
  try {
    const { level, scopeId, changeSummary } = req.body;
    if (!level || !scopeId) {
      return res.status(400).json({ error: 'level and scopeId are required' });
    }
    const result = await bumpVersion(level, scopeId, changeSummary);
    res.json(result);
  } catch (error: any) {
    console.error('Error bumping version:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
