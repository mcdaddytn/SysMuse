/**
 * CPC (Cooperative Patent Classification) Routes
 *
 * REST API for CPC code management:
 * - Lookup and search CPC codes
 * - Seed database from XML files
 * - Manage sector mappings
 * - View hierarchy and statistics
 */

import { Router, Request, Response } from 'express';
import {
  resolveCpcDescription,
  resolveCpcDescriptions,
  getCpcHierarchy,
  getCpcWithHierarchy,
  searchCpcCodes,
  getCpcCodesUnderPrefix,
  getCpcChildren,
  getSectorFromCpc,
  updateCpcSectorMapping,
  clearCpcCache,
  getCpcCacheStats,
} from '../services/cpc-resolver-service.js';
import {
  seedCpcFromXml,
  seedPatentRelevantCpc,
  getCpcStats,
} from '../services/cpc-xml-parser-service.js';
import { CpcLevel } from '@prisma/client';

const router = Router();

// ============================================================================
// Lookup Endpoints
// ============================================================================

/**
 * GET /api/cpc/lookup/:code(*)
 * Look up a single CPC code with optional hierarchy
 * Note: Uses wildcard to handle slashes in CPC codes (e.g., H04L63/14)
 */
router.get('/lookup/*', async (req: Request, res: Response) => {
  try {
    const code = req.params[0]; // Wildcard captures everything after /lookup/
    const { hierarchy } = req.query;

    if (hierarchy === 'true') {
      const result = await getCpcWithHierarchy(code);
      if (!result) {
        return res.status(404).json({ error: 'CPC code not found', code });
      }
      res.json(result);
    } else {
      const result = await resolveCpcDescription(code);
      if (!result) {
        return res.status(404).json({ error: 'CPC code not found', code });
      }
      res.json(result);
    }
  } catch (error) {
    console.error('CPC lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup CPC code' });
  }
});

/**
 * POST /api/cpc/batch-lookup
 * Look up multiple CPC codes at once
 * Body: { codes: string[] }
 */
router.post('/batch-lookup', async (req: Request, res: Response) => {
  try {
    const { codes } = req.body;

    if (!Array.isArray(codes)) {
      return res.status(400).json({ error: 'codes must be an array' });
    }

    if (codes.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 codes per request' });
    }

    const results = await resolveCpcDescriptions(codes);

    // Convert Map to object for JSON response
    const response: Record<string, any> = {};
    for (const [code, description] of results) {
      response[code] = description;
    }

    res.json(response);
  } catch (error) {
    console.error('CPC batch lookup error:', error);
    res.status(500).json({ error: 'Failed to batch lookup CPC codes' });
  }
});

/**
 * GET /api/cpc/hierarchy/*
 * Get full hierarchy for a CPC code
 */
router.get('/hierarchy/*', async (req: Request, res: Response) => {
  try {
    const code = req.params[0];
    const hierarchy = await getCpcHierarchy(code);
    res.json({ code, hierarchy });
  } catch (error) {
    console.error('CPC hierarchy error:', error);
    res.status(500).json({ error: 'Failed to get CPC hierarchy' });
  }
});

/**
 * GET /api/cpc/children/*
 * Get immediate children of a CPC code
 */
router.get('/children/*', async (req: Request, res: Response) => {
  try {
    const code = req.params[0];
    const children = await getCpcChildren(code);
    res.json({ code, children, count: children.length });
  } catch (error) {
    console.error('CPC children error:', error);
    res.status(500).json({ error: 'Failed to get CPC children' });
  }
});

// ============================================================================
// Search Endpoints
// ============================================================================

/**
 * GET /api/cpc/search
 * Search CPC codes by text
 * Query params: q (search query), level (optional), limit (optional)
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q, level, limit } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    const options: { level?: CpcLevel; limit?: number } = {};

    if (level && typeof level === 'string') {
      const validLevels = ['SECTION', 'CLASS', 'SUBCLASS', 'GROUP', 'SUBGROUP'];
      if (validLevels.includes(level.toUpperCase())) {
        options.level = level.toUpperCase() as CpcLevel;
      }
    }

    if (limit) {
      options.limit = Math.min(parseInt(limit as string, 10) || 50, 200);
    }

    const results = await searchCpcCodes(q, options);
    res.json({ query: q, results, count: results.length });
  } catch (error) {
    console.error('CPC search error:', error);
    res.status(500).json({ error: 'Failed to search CPC codes' });
  }
});

/**
 * GET /api/cpc/prefix/:prefix
 * Get all CPC codes under a prefix
 */
router.get('/prefix/:prefix', async (req: Request, res: Response) => {
  try {
    const { prefix } = req.params;
    const { includeNotAllocatable, limit } = req.query;

    const results = await getCpcCodesUnderPrefix(prefix, {
      includeNotAllocatable: includeNotAllocatable === 'true',
      limit: limit ? Math.min(parseInt(limit as string, 10), 1000) : 500,
    });

    res.json({ prefix, results, count: results.length });
  } catch (error) {
    console.error('CPC prefix error:', error);
    res.status(500).json({ error: 'Failed to get CPC codes by prefix' });
  }
});

// ============================================================================
// Sector Mapping Endpoints
// ============================================================================

/**
 * GET /api/cpc/sector/*
 * Get sector mapping for a CPC code
 */
router.get('/sector/*', async (req: Request, res: Response) => {
  try {
    const code = req.params[0];
    const mapping = await getSectorFromCpc(code);

    if (!mapping) {
      return res.json({ code, sector: null, superSector: null });
    }

    res.json({ code, ...mapping });
  } catch (error) {
    console.error('CPC sector lookup error:', error);
    res.status(500).json({ error: 'Failed to get sector mapping' });
  }
});

/**
 * PUT /api/cpc/sector/*
 * Update sector mapping for a CPC code
 * Body: { sectorId?: string, superSectorId?: string }
 */
router.put('/sector/*', async (req: Request, res: Response) => {
  try {
    const code = req.params[0];
    const { sectorId, superSectorId } = req.body;

    const updated = await updateCpcSectorMapping(code, sectorId, superSectorId);

    if (!updated) {
      return res.status(404).json({ error: 'CPC code not found', code });
    }

    res.json({ success: true, code, sectorId, superSectorId });
  } catch (error) {
    console.error('CPC sector update error:', error);
    res.status(500).json({ error: 'Failed to update sector mapping' });
  }
});

// ============================================================================
// Seeding Endpoints
// ============================================================================

/**
 * POST /api/cpc/seed
 * Seed CPC codes from XML files
 * Body: { subclasses?: string[], skipDefinitions?: boolean }
 */
router.post('/seed', async (req: Request, res: Response) => {
  try {
    const { subclasses, skipDefinitions } = req.body;

    console.log('Starting CPC seed...');
    console.log('  Subclasses filter:', subclasses || 'all');
    console.log('  Skip definitions:', skipDefinitions || false);

    const progress = await seedCpcFromXml({
      subclasses,
      skipDefinitions,
      onProgress: (p) => {
        // Log progress periodically
        if (p.filesProcessed % 100 === 0) {
          console.log(`  Progress: ${p.filesProcessed} files, ${p.codesInserted + p.codesUpdated} codes`);
        }
      },
    });

    res.json({
      success: true,
      ...progress,
    });
  } catch (error) {
    console.error('CPC seed error:', error);
    res.status(500).json({
      error: 'Failed to seed CPC codes',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/cpc/seed-relevant
 * Seed only patent-relevant CPC subclasses (H04L, G06F, etc.)
 * Faster than full seed, covers most IP portfolios
 */
router.post('/seed-relevant', async (req: Request, res: Response) => {
  try {
    console.log('Starting patent-relevant CPC seed...');

    const progress = await seedPatentRelevantCpc();

    res.json({
      success: true,
      ...progress,
    });
  } catch (error) {
    console.error('CPC seed-relevant error:', error);
    res.status(500).json({
      error: 'Failed to seed CPC codes',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// Admin/Stats Endpoints
// ============================================================================

/**
 * GET /api/cpc/stats
 * Get CPC database statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getCpcStats();
    const cacheStats = getCpcCacheStats();

    res.json({
      ...stats,
      cache: cacheStats,
    });
  } catch (error) {
    console.error('CPC stats error:', error);
    res.status(500).json({ error: 'Failed to get CPC stats' });
  }
});

/**
 * POST /api/cpc/clear-cache
 * Clear the CPC lookup cache
 */
router.post('/clear-cache', (_req: Request, res: Response) => {
  try {
    clearCpcCache();
    res.json({ success: true, message: 'CPC cache cleared' });
  } catch (error) {
    console.error('CPC cache clear error:', error);
    res.status(500).json({ error: 'Failed to clear CPC cache' });
  }
});

/**
 * GET /api/cpc/config
 * Get CPC configuration status
 */
router.get('/config', (_req: Request, res: Response) => {
  const schemeDir = process.env.CPC_SCHEME_XML_DIR;
  const definitionDir = process.env.CPC_DEFINITION_XML_DIR;

  res.json({
    configured: Boolean(schemeDir),
    schemeDir: schemeDir || null,
    definitionDir: definitionDir || null,
  });
});

export default router;
