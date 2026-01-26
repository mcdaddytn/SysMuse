/**
 * Focus Areas API Routes
 *
 * CRUD operations for Focus Groups and Focus Areas
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { extractKeywords, extractKeywordsFromTitles } from '../services/keyword-extractor.js';
import { createElasticsearchService } from '../../../services/elasticsearch-service.js';

const router = Router();
const prisma = new PrismaClient();
const esService = createElasticsearchService();

// =============================================================================
// FOCUS GROUPS (Exploratory/Draft)
// =============================================================================

/**
 * GET /api/focus-groups
 * List all focus groups (optionally filtered by status)
 */
router.get('/focus-groups', async (req: Request, res: Response) => {
  try {
    const { status, ownerId } = req.query;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (ownerId) where.ownerId = ownerId;

    const focusGroups = await prisma.focusGroup.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, status: true } },
        formalizedAs: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(focusGroups);
  } catch (error) {
    console.error('Error fetching focus groups:', error);
    res.status(500).json({ error: 'Failed to fetch focus groups' });
  }
});

/**
 * GET /api/focus-groups/:id
 * Get a specific focus group
 */
router.get('/focus-groups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const focusGroup = await prisma.focusGroup.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, status: true } },
        formalizedAs: { select: { id: true, name: true } }
      }
    });

    if (!focusGroup) {
      return res.status(404).json({ error: 'Focus group not found' });
    }

    res.json(focusGroup);
  } catch (error) {
    console.error('Error fetching focus group:', error);
    res.status(500).json({ error: 'Failed to fetch focus group' });
  }
});

/**
 * POST /api/focus-groups
 * Create a new focus group
 */
router.post('/focus-groups', async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      ownerId,
      sourceType = 'MANUAL',
      sourceFilters,
      patentIds = [],
      parentId
    } = req.body;

    if (!name || !ownerId) {
      return res.status(400).json({ error: 'name and ownerId are required' });
    }

    const focusGroup = await prisma.focusGroup.create({
      data: {
        name,
        description,
        ownerId,
        sourceType,
        sourceFilters,
        patentIds,
        parentId,
        status: 'DRAFT'
      },
      include: {
        owner: { select: { id: true, name: true, email: true } }
      }
    });

    res.status(201).json(focusGroup);
  } catch (error) {
    console.error('Error creating focus group:', error);
    res.status(500).json({ error: 'Failed to create focus group' });
  }
});

/**
 * PUT /api/focus-groups/:id
 * Update a focus group
 */
router.put('/focus-groups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, status, patentIds, parentId } = req.body;

    const focusGroup = await prisma.focusGroup.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(status && { status }),
        ...(patentIds && { patentIds }),
        ...(parentId !== undefined && { parentId })
      },
      include: {
        owner: { select: { id: true, name: true, email: true } }
      }
    });

    res.json(focusGroup);
  } catch (error) {
    console.error('Error updating focus group:', error);
    res.status(500).json({ error: 'Failed to update focus group' });
  }
});

/**
 * DELETE /api/focus-groups/:id
 * Delete a focus group
 */
router.delete('/focus-groups/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.focusGroup.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting focus group:', error);
    res.status(500).json({ error: 'Failed to delete focus group' });
  }
});

/**
 * POST /api/focus-groups/:id/formalize
 * Convert a focus group to a focus area
 */
router.post('/focus-groups/:id/formalize', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name: overrideName, description: overrideDescription } = req.body;

    // Get the focus group
    const focusGroup = await prisma.focusGroup.findUnique({
      where: { id }
    });

    if (!focusGroup) {
      return res.status(404).json({ error: 'Focus group not found' });
    }

    if (focusGroup.status === 'FORMALIZED') {
      return res.status(400).json({ error: 'Focus group already formalized' });
    }

    // Create focus area and update focus group in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the focus area
      const focusArea = await tx.focusArea.create({
        data: {
          name: overrideName || focusGroup.name,
          description: overrideDescription || focusGroup.description,
          ownerId: focusGroup.ownerId,
          sourceGroupId: focusGroup.id,
          status: 'ACTIVE',
          patentCount: focusGroup.patentIds.length
        }
      });

      // Create patent memberships
      if (focusGroup.patentIds.length > 0) {
        await tx.focusAreaPatent.createMany({
          data: focusGroup.patentIds.map(patentId => ({
            focusAreaId: focusArea.id,
            patentId,
            membershipType: 'MANUAL'
          }))
        });
      }

      // Update focus group status
      await tx.focusGroup.update({
        where: { id },
        data: { status: 'FORMALIZED' }
      });

      return focusArea;
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error formalizing focus group:', error);
    res.status(500).json({ error: 'Failed to formalize focus group' });
  }
});

// =============================================================================
// FOCUS AREAS (Stable/Formalized)
// =============================================================================

/**
 * GET /api/focus-areas
 * List all focus areas
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, ownerId, superSector } = req.query;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (ownerId) where.ownerId = ownerId;
    if (superSector) where.superSector = superSector;

    const focusAreas = await prisma.focusArea.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
        searchTerms: { where: { isActive: true } },
        _count: {
          select: { patents: true, facetDefs: true }
        }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(focusAreas);
  } catch (error) {
    console.error('Error fetching focus areas:', error);
    res.status(500).json({ error: 'Failed to fetch focus areas' });
  }
});

/**
 * GET /api/focus-areas/:id
 * Get a specific focus area with full details
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const focusArea = await prisma.focusArea.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true } },
        sourceGroup: { select: { id: true, name: true, sourceType: true } },
        searchTerms: true,
        facetDefs: {
          include: {
            _count: { select: { values: true } }
          }
        },
        _count: { select: { patents: true } }
      }
    });

    if (!focusArea) {
      return res.status(404).json({ error: 'Focus area not found' });
    }

    res.json(focusArea);
  } catch (error) {
    console.error('Error fetching focus area:', error);
    res.status(500).json({ error: 'Failed to fetch focus area' });
  }
});

/**
 * POST /api/focus-areas
 * Create a new focus area directly (without focus group)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      ownerId,
      superSector,
      primarySector,
      parentId,
      patentIds = []
    } = req.body;

    if (!name || !ownerId) {
      return res.status(400).json({ error: 'name and ownerId are required' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const focusArea = await tx.focusArea.create({
        data: {
          name,
          description,
          ownerId,
          superSector,
          primarySector,
          parentId,
          status: 'ACTIVE',
          patentCount: patentIds.length
        }
      });

      // Create patent memberships
      if (patentIds.length > 0) {
        await tx.focusAreaPatent.createMany({
          data: patentIds.map((patentId: string) => ({
            focusAreaId: focusArea.id,
            patentId,
            membershipType: 'MANUAL'
          }))
        });
      }

      return focusArea;
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating focus area:', error);
    res.status(500).json({ error: 'Failed to create focus area' });
  }
});

/**
 * PUT /api/focus-areas/:id
 * Update a focus area
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, status, superSector, primarySector, parentId } = req.body;

    const focusArea = await prisma.focusArea.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(status && { status }),
        ...(superSector !== undefined && { superSector }),
        ...(primarySector !== undefined && { primarySector }),
        ...(parentId !== undefined && { parentId })
      }
    });

    res.json(focusArea);
  } catch (error) {
    console.error('Error updating focus area:', error);
    res.status(500).json({ error: 'Failed to update focus area' });
  }
});

/**
 * DELETE /api/focus-areas/:id
 * Delete (archive) a focus area
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { hard = false } = req.query;

    if (hard === 'true') {
      // Hard delete - remove entirely
      await prisma.focusArea.delete({ where: { id } });
    } else {
      // Soft delete - archive
      await prisma.focusArea.update({
        where: { id },
        data: { status: 'ARCHIVED' }
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting focus area:', error);
    res.status(500).json({ error: 'Failed to delete focus area' });
  }
});

/**
 * GET /api/focus-areas/:id/patents
 * Get patents in a focus area
 */
router.get('/:id/patents', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { page = '1', limit = '50' } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const [patents, total] = await Promise.all([
      prisma.focusAreaPatent.findMany({
        where: { focusAreaId: id },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.focusAreaPatent.count({ where: { focusAreaId: id } })
    ]);

    res.json({
      data: patents,
      total,
      page: pageNum,
      rowsPerPage: limitNum
    });
  } catch (error) {
    console.error('Error fetching focus area patents:', error);
    res.status(500).json({ error: 'Failed to fetch patents' });
  }
});

/**
 * POST /api/focus-areas/:id/patents
 * Add patents to a focus area
 */
router.post('/:id/patents', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { patentIds, membershipType = 'MANUAL' } = req.body;

    if (!patentIds || !Array.isArray(patentIds)) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    // Use upsert to avoid duplicates
    const results = await Promise.all(
      patentIds.map((patentId: string) =>
        prisma.focusAreaPatent.upsert({
          where: {
            focusAreaId_patentId: { focusAreaId: id, patentId }
          },
          update: { membershipType },
          create: { focusAreaId: id, patentId, membershipType }
        })
      )
    );

    // Update patent count
    const count = await prisma.focusAreaPatent.count({ where: { focusAreaId: id } });
    await prisma.focusArea.update({
      where: { id },
      data: { patentCount: count }
    });

    res.json({ added: results.length, total: count });
  } catch (error) {
    console.error('Error adding patents to focus area:', error);
    res.status(500).json({ error: 'Failed to add patents' });
  }
});

/**
 * DELETE /api/focus-areas/:id/patents
 * Remove patents from a focus area
 */
router.delete('/:id/patents', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { patentIds } = req.body;

    if (!patentIds || !Array.isArray(patentIds)) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    await prisma.focusAreaPatent.deleteMany({
      where: {
        focusAreaId: id,
        patentId: { in: patentIds }
      }
    });

    // Update patent count
    const count = await prisma.focusAreaPatent.count({ where: { focusAreaId: id } });
    await prisma.focusArea.update({
      where: { id },
      data: { patentCount: count }
    });

    res.json({ removed: patentIds.length, total: count });
  } catch (error) {
    console.error('Error removing patents from focus area:', error);
    res.status(500).json({ error: 'Failed to remove patents' });
  }
});

// =============================================================================
// SEARCH TERMS
// =============================================================================

/**
 * POST /api/focus-areas/:id/search-terms
 * Add a search term to a focus area
 */
router.post('/:id/search-terms', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      expression,
      termType = 'KEYWORD',
      sourceType = 'MANUAL',
      sourcePatentIds = []
    } = req.body;

    if (!expression) {
      return res.status(400).json({ error: 'expression is required' });
    }

    const searchTerm = await prisma.searchTerm.create({
      data: {
        focusAreaId: id,
        expression,
        termType,
        sourceType,
        sourcePatentIds,
        isActive: true
      }
    });

    res.status(201).json(searchTerm);
  } catch (error) {
    console.error('Error creating search term:', error);
    res.status(500).json({ error: 'Failed to create search term' });
  }
});

/**
 * DELETE /api/focus-areas/:id/search-terms/:termId
 * Remove a search term
 */
router.delete('/:id/search-terms/:termId', async (req: Request, res: Response) => {
  try {
    const { termId } = req.params;

    await prisma.searchTerm.delete({ where: { id: termId } });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting search term:', error);
    res.status(500).json({ error: 'Failed to delete search term' });
  }
});

// =============================================================================
// KEYWORD EXTRACTION
// =============================================================================

/**
 * POST /api/focus-areas/extract-keywords
 * Extract keywords from selected patents for search term suggestions
 *
 * Body: {
 *   patentIds: string[],      // Patents to analyze
 *   corpusPatentIds?: string[], // Comparison corpus (optional, defaults to portfolio)
 *   minFrequency?: number,    // Min occurrences (default: 2)
 *   maxTerms?: number,        // Max terms to return (default: 50)
 *   includeNgrams?: boolean,  // Include 2-grams (default: true)
 *   titleOnly?: boolean       // Only use titles, skip abstract lookup (faster)
 * }
 */
router.post('/extract-keywords', async (req: Request, res: Response) => {
  try {
    const {
      patentIds,
      corpusPatentIds,
      minFrequency = 2,
      maxTerms = 50,
      includeNgrams = true,
      titleOnly = false
    } = req.body;

    if (!patentIds || !Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    if (patentIds.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 patents per request' });
    }

    let keywords;
    if (titleOnly) {
      keywords = extractKeywordsFromTitles(patentIds, {
        corpusPatentIds,
        minFrequency,
        maxTerms,
        includeNgrams
      });
    } else {
      keywords = await extractKeywords(patentIds, {
        corpusPatentIds,
        minFrequency,
        maxTerms,
        includeNgrams
      });
    }

    res.json({
      patentCount: patentIds.length,
      keywordCount: keywords.length,
      keywords
    });
  } catch (error) {
    console.error('Error extracting keywords:', error);
    res.status(500).json({ error: 'Failed to extract keywords' });
  }
});

/**
 * POST /api/focus-areas/:id/extract-keywords
 * Extract keywords from patents already in a focus area
 */
router.post('/:id/extract-keywords', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      minFrequency = 2,
      maxTerms = 50,
      includeNgrams = true,
      titleOnly = false
    } = req.body;

    // Get patents in this focus area
    const focusAreaPatents = await prisma.focusAreaPatent.findMany({
      where: { focusAreaId: id },
      select: { patentId: true }
    });

    if (focusAreaPatents.length === 0) {
      return res.json({
        patentCount: 0,
        keywordCount: 0,
        keywords: [],
        message: 'No patents in this focus area'
      });
    }

    const patentIds = focusAreaPatents.map(p => p.patentId);

    let keywords;
    if (titleOnly) {
      keywords = extractKeywordsFromTitles(patentIds, {
        minFrequency,
        maxTerms,
        includeNgrams
      });
    } else {
      keywords = await extractKeywords(patentIds, {
        minFrequency,
        maxTerms,
        includeNgrams
      });
    }

    res.json({
      focusAreaId: id,
      patentCount: patentIds.length,
      keywordCount: keywords.length,
      keywords
    });
  } catch (error) {
    console.error('Error extracting keywords for focus area:', error);
    res.status(500).json({ error: 'Failed to extract keywords' });
  }
});

// =============================================================================
// SEARCH TERM PREVIEW
// =============================================================================

/**
 * POST /api/focus-areas/search-preview
 * Preview hit counts for a search expression across different scopes
 *
 * Body: {
 *   expression: string,           // Search query (keywords, phrase, etc.)
 *   termType?: string,            // KEYWORD, PHRASE, PROXIMITY, WILDCARD, BOOLEAN
 *   scopes?: {
 *     focusAreaId?: string,       // Limit to focus area patents
 *     superSector?: string,       // Filter by super sector
 *     primarySector?: string      // Filter by primary sector
 *   }
 * }
 *
 * Returns:
 *   hitCounts: {
 *     portfolio: number,          // Total hits in entire portfolio
 *     sector: number,             // Hits in specified sector (if provided)
 *     focusArea: number           // Hits in focus area (if provided)
 *   },
 *   sampleHits: [...]             // First few matching patents
 */
router.post('/search-preview', async (req: Request, res: Response) => {
  try {
    const {
      expression,
      termType = 'KEYWORD',
      searchFields = 'both',
      scopes = {}
    } = req.body;

    if (!expression || !expression.trim()) {
      return res.status(400).json({ error: 'expression is required' });
    }

    // Check if ES is available
    const esHealthy = await esService.healthCheck();
    if (!esHealthy) {
      return res.status(503).json({ error: 'Elasticsearch is not available' });
    }

    // Map searchFields to ES field names
    let fields: string[];
    switch (searchFields) {
      case 'title':
        fields = ['title'];
        break;
      case 'abstract':
        fields = ['abstract'];
        break;
      default:
        fields = ['title', 'abstract'];
    }

    // Build the search query based on term type
    let searchQuery: string;
    switch (termType) {
      case 'PHRASE':
        searchQuery = `"${expression}"`;
        break;
      case 'BOOLEAN':
        // Pass through as-is for boolean expressions
        searchQuery = expression;
        break;
      case 'WILDCARD':
        // Add wildcards to each word
        searchQuery = expression.split(/\s+/).map((w: string) => `${w}*`).join(' ');
        break;
      case 'PROXIMITY':
        // Already in proximity format, pass through
        searchQuery = expression;
        break;
      default:
        // KEYWORD / KEYWORD_AND - simple search
        searchQuery = expression;
    }

    // Disable fuzziness for keyword types (exact term matching)
    const fuzziness = (termType === 'KEYWORD' || termType === 'KEYWORD_AND') ? '0' : 'AUTO';

    // Get portfolio-wide hit count
    const portfolioResults = await esService.search(searchQuery, {
      fields,
      size: 5,
      highlight: true,
      fuzziness
    });

    const hitCounts: Record<string, number> = {
      portfolio: portfolioResults.total
    };

    // If sector scope provided, get sector-specific count
    if (scopes.superSector) {
      const sectorResults = await esService.search(searchQuery, {
        fields,
        size: 0,
        fuzziness,
        filters: {
          // Note: This requires the sector to be indexed in ES
          // For now we'll use the portfolio count as a fallback
        }
      });
      // Fallback to portfolio count if sector filtering not available in ES
      hitCounts.sector = sectorResults.total;
    }

    // If focus area scope provided, get focus area-specific count
    if (scopes.focusAreaId) {
      // Get patent IDs in the focus area
      const focusAreaPatents = await prisma.focusAreaPatent.findMany({
        where: { focusAreaId: scopes.focusAreaId },
        select: { patentId: true }
      });

      console.log(`[search-preview] focusAreaId=${scopes.focusAreaId}, focusAreaPatent records=${focusAreaPatents.length}`);

      if (focusAreaPatents.length > 0) {
        const patentIds = focusAreaPatents.map(p => p.patentId);
        console.log(`[search-preview] Sample DB patentIds: ${patentIds.slice(0, 3).join(', ')}`);

        // Count how many of the search results are in the focus area
        // For a simple implementation, we intersect search results with focus area patents
        const focusAreaResults = await esService.search(searchQuery, {
          fields,
          size: 10000, // Get all to count overlap
          fuzziness,
          filters: {}
        });

        console.log(`[search-preview] ES hits: ${focusAreaResults.hits.length}, sample ES patent_ids: ${focusAreaResults.hits.slice(0, 3).map(h => h.patent_id).join(', ')}`);

        const focusAreaPatentSet = new Set(patentIds);
        const matchingInFocusArea = focusAreaResults.hits.filter(
          hit => focusAreaPatentSet.has(hit.patent_id)
        );

        console.log(`[search-preview] Intersection matches: ${matchingInFocusArea.length}`);
        hitCounts.focusArea = matchingInFocusArea.length;
      } else {
        console.log(`[search-preview] No focusAreaPatent records found for ${scopes.focusAreaId}`);
        hitCounts.focusArea = 0;
      }
    }

    // Format sample hits for display
    const sampleHits = portfolioResults.hits.slice(0, 5).map(hit => ({
      patentId: hit.patent_id,
      title: hit.title,
      score: hit.score,
      highlight: hit.highlights?.title?.[0] || hit.highlights?.abstract?.[0]
    }));

    res.json({
      expression,
      termType,
      hitCounts,
      sampleHits,
      esAvailable: true
    });
  } catch (error) {
    console.error('Error previewing search term:', error);
    res.status(500).json({ error: 'Failed to preview search term' });
  }
});

export default router;
