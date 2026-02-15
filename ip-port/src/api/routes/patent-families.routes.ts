/**
 * Patent Family Exploration Routes
 *
 * REST endpoints for on-demand patent family exploration via BFS.
 */

import { Router, Request, Response } from 'express';
import {
  createExploration,
  executeExploration,
  getExplorationWithMembers,
  getExplorationStatus,
  listExplorations,
  deleteExploration,
  addMembersToFocusArea,
  getCacheStatus,
  previewMultiSeedExploration,
  executeMultiSeedExploration,
  createFocusAreaFromExploration,
  getAvailableCompetitors,
  getAvailableAffiliates,
  enrichWithLitigation,
  getCachedLitigationStatus,
  checkPatentIPR,
  checkPatentProsecution,
  fetchMissingPatentDetails,
  enrichPatentsWithDetails,
  type MultiSeedConfig,
  type MergeStrategy,
} from '../services/patent-family-service.js';
import {
  createExplorationV2,
  expandOneGeneration,
  expandSiblings,
  rescoreExploration,
  updateCandidateStatuses,
  getExplorationV2,
  saveExploration,
  createFocusAreaFromV2,
  getScoringPresets,
} from '../services/family-expansion-v2-service.js';

const router = Router();

/**
 * POST /explorations
 * Create a new exploration
 */
router.post('/explorations', async (req: Request, res: Response) => {
  try {
    const {
      seedPatentId,
      name,
      description,
      maxAncestorDepth,
      maxDescendantDepth,
      includeSiblings,
      includeCousins,
      limitToSectors,
      limitToCpcPrefixes,
      limitToFocusAreas,
      requireInPortfolio,
    } = req.body;

    if (!seedPatentId) {
      return res.status(400).json({ error: 'seedPatentId is required' });
    }

    const exploration = await createExploration({
      seedPatentId,
      name,
      description,
      maxAncestorDepth,
      maxDescendantDepth,
      includeSiblings,
      includeCousins,
      limitToSectors,
      limitToCpcPrefixes,
      limitToFocusAreas,
      requireInPortfolio,
    });

    res.status(201).json(exploration);
  } catch (error) {
    console.error('Error creating exploration:', error);
    res.status(500).json({ error: 'Failed to create exploration' });
  }
});

/**
 * GET /explorations
 * List explorations, optionally filtered by seedPatentId
 */
router.get('/explorations', async (req: Request, res: Response) => {
  try {
    const { seedPatentId } = req.query;
    const explorations = await listExplorations(seedPatentId as string | undefined);
    res.json(explorations);
  } catch (error) {
    console.error('Error listing explorations:', error);
    res.status(500).json({ error: 'Failed to list explorations' });
  }
});

/**
 * GET /explorations/:id
 * Get exploration detail with enriched members
 */
router.get('/explorations/:id', async (req: Request, res: Response) => {
  try {
    const result = await getExplorationWithMembers(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Exploration not found' });
    }
    res.json(result);
  } catch (error) {
    console.error('Error getting exploration:', error);
    res.status(500).json({ error: 'Failed to get exploration' });
  }
});

/**
 * DELETE /explorations/:id
 * Delete exploration and its members (cascade)
 */
router.delete('/explorations/:id', async (req: Request, res: Response) => {
  try {
    await deleteExploration(req.params.id);
    res.json({ message: 'Exploration deleted' });
  } catch (error) {
    console.error('Error deleting exploration:', error);
    res.status(500).json({ error: 'Failed to delete exploration' });
  }
});

/**
 * POST /explorations/:id/execute
 * Start BFS exploration (runs async if live API calls needed)
 */
router.post('/explorations/:id/execute', async (req: Request, res: Response) => {
  try {
    const explorationId = req.params.id;

    // Check if exploration exists and isn't already running
    const status = await getExplorationStatus(explorationId);
    if (!status) {
      return res.status(404).json({ error: 'Exploration not found' });
    }
    if (status.status === 'RUNNING') {
      return res.status(409).json({ error: 'Exploration is already running' });
    }

    // Fire and forget — run async so the endpoint returns immediately
    executeExploration(explorationId).catch(err => {
      console.error(`[PatentFamily] Async exploration ${explorationId} failed:`, err);
    });

    res.json({
      status: 'RUNNING',
      message: 'Exploration started',
      explorationId,
    });
  } catch (error) {
    console.error('Error executing exploration:', error);
    res.status(500).json({ error: 'Failed to start exploration' });
  }
});

/**
 * GET /explorations/:id/status
 * Poll exploration status
 */
router.get('/explorations/:id/status', async (req: Request, res: Response) => {
  try {
    const status = await getExplorationStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ error: 'Exploration not found' });
    }
    res.json(status);
  } catch (error) {
    console.error('Error getting exploration status:', error);
    res.status(500).json({ error: 'Failed to get exploration status' });
  }
});

/**
 * GET /explorations/:id/members
 * Get enriched members with generation summary
 */
router.get('/explorations/:id/members', async (req: Request, res: Response) => {
  try {
    const result = await getExplorationWithMembers(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Exploration not found' });
    }
    res.json({
      members: result.members,
      generations: result.generations,
      total: result.members.length,
    });
  } catch (error) {
    console.error('Error getting exploration members:', error);
    res.status(500).json({ error: 'Failed to get exploration members' });
  }
});

/**
 * POST /explorations/:id/add-to-focus-area
 * Add selected patents from exploration to a focus area
 */
router.post('/explorations/:id/add-to-focus-area', async (req: Request, res: Response) => {
  try {
    const { focusAreaId, patentIds } = req.body;

    if (!focusAreaId || !Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'focusAreaId and patentIds[] are required' });
    }

    const result = await addMembersToFocusArea(req.params.id, focusAreaId, patentIds);
    res.json(result);
  } catch (error) {
    console.error('Error adding members to focus area:', error);
    res.status(500).json({ error: 'Failed to add members to focus area' });
  }
});

/**
 * GET /cache-status/:patentId
 * Check citation cache status for a patent
 */
router.get('/cache-status/:patentId', (req: Request, res: Response) => {
  try {
    const status = getCacheStatus(req.params.patentId);
    res.json(status);
  } catch (error) {
    console.error('Error getting cache status:', error);
    res.status(500).json({ error: 'Failed to get cache status' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Seed Exploration Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /explorations/preview
 * Preview multi-seed exploration results before execution
 */
router.post('/explorations/preview', async (req: Request, res: Response) => {
  try {
    const {
      seedPatentIds,
      maxAncestorDepth = 1,
      maxDescendantDepth = 1,
      includeSiblings = true,
      includeCousins = false,
      limitToSectors = [],
      limitToCpcPrefixes = [],
      limitToCompetitors = [],
      limitToAffiliates = [],
      requireInPortfolio = false,
      mergeStrategy = 'INTERSECTION',
      minFilingYear,
    } = req.body;

    if (!seedPatentIds || !Array.isArray(seedPatentIds) || seedPatentIds.length === 0) {
      return res.status(400).json({ error: 'seedPatentIds array is required' });
    }

    const config: MultiSeedConfig = {
      seedPatentIds,
      maxAncestorDepth,
      maxDescendantDepth,
      includeSiblings,
      includeCousins,
      limitToSectors,
      limitToCpcPrefixes,
      limitToCompetitors,
      limitToAffiliates,
      requireInPortfolio,
      mergeStrategy: mergeStrategy as MergeStrategy,
      minFilingYear,
    };

    const preview = await previewMultiSeedExploration(config);
    res.json(preview);
  } catch (error) {
    console.error('Error previewing exploration:', error);
    res.status(500).json({ error: 'Failed to preview exploration' });
  }
});

/**
 * POST /explorations/multi-seed
 * Create and execute multi-seed exploration
 */
router.post('/explorations/multi-seed', async (req: Request, res: Response) => {
  try {
    const {
      seedPatentIds,
      name,
      description,
      maxAncestorDepth = 1,
      maxDescendantDepth = 1,
      includeSiblings = true,
      includeCousins = false,
      limitToSectors = [],
      limitToCpcPrefixes = [],
      limitToCompetitors = [],
      limitToAffiliates = [],
      requireInPortfolio = false,
      mergeStrategy = 'INTERSECTION',
      minFilingYear,
    } = req.body;

    if (!seedPatentIds || !Array.isArray(seedPatentIds) || seedPatentIds.length === 0) {
      return res.status(400).json({ error: 'seedPatentIds array is required' });
    }

    const config: MultiSeedConfig = {
      seedPatentIds,
      maxAncestorDepth,
      maxDescendantDepth,
      includeSiblings,
      includeCousins,
      limitToSectors,
      limitToCpcPrefixes,
      limitToCompetitors,
      limitToAffiliates,
      requireInPortfolio,
      mergeStrategy: mergeStrategy as MergeStrategy,
      minFilingYear,
    };

    // For multi-seed, we create a special exploration with the first seed as primary
    // and store all seeds in the description for now (schema supports single seed)
    const exploration = await createExploration({
      seedPatentId: seedPatentIds[0],
      name: name || `Multi-seed family (${seedPatentIds.length} seeds)`,
      description: description || `Seeds: ${seedPatentIds.join(', ')}`,
      maxAncestorDepth,
      maxDescendantDepth,
      includeSiblings,
      includeCousins,
      limitToSectors,
      limitToCpcPrefixes,
      requireInPortfolio,
    });

    // Execute the multi-seed exploration
    const members = await executeMultiSeedExploration(exploration.id, config);

    res.status(201).json({
      exploration: {
        ...exploration,
        seedPatentIds,
        mergeStrategy,
      },
      members,
      memberCount: members.length,
    });
  } catch (error) {
    console.error('Error creating multi-seed exploration:', error);
    res.status(500).json({ error: 'Failed to create multi-seed exploration' });
  }
});

/**
 * POST /explorations/:id/create-focus-area
 * Create a Focus Area from exploration results
 */
router.post('/explorations/:id/create-focus-area', async (req: Request, res: Response) => {
  try {
    const { name, description, patentIds, includeExternalPatents = true, ownerId = 'default-user' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    if (!patentIds || !Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    const result = await createFocusAreaFromExploration({
      explorationId: req.params.id,
      name,
      description,
      patentIds,
      includeExternalPatents,
      ownerId,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating focus area from exploration:', error);
    res.status(500).json({ error: 'Failed to create focus area' });
  }
});

/**
 * POST /create-focus-area
 * Create a Focus Area directly from patent IDs (without exploration)
 */
router.post('/create-focus-area', async (req: Request, res: Response) => {
  try {
    const { name, description, patentIds, includeExternalPatents = true, ownerId = 'default-user' } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    if (!patentIds || !Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    const result = await createFocusAreaFromExploration({
      name,
      description,
      patentIds,
      includeExternalPatents,
      ownerId,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating focus area:', error);
    res.status(500).json({ error: 'Failed to create focus area' });
  }
});

/**
 * GET /filter-options
 * Get available competitors and affiliates for filtering
 */
router.get('/filter-options', (_req: Request, res: Response) => {
  try {
    const competitors = getAvailableCompetitors();
    const affiliates = getAvailableAffiliates();
    res.json({ competitors, affiliates });
  } catch (error) {
    console.error('Error getting filter options:', error);
    res.status(500).json({ error: 'Failed to get filter options' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Prosecution/IPR Enrichment Endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /enrich-litigation
 * Batch enrich patents with IPR and prosecution data
 */
router.post('/enrich-litigation', async (req: Request, res: Response) => {
  try {
    const { patentIds, includeIpr = true, includeProsecution = true } = req.body;

    if (!patentIds || !Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    // Limit batch size to prevent long-running requests
    const limitedIds = patentIds.slice(0, 50);

    const result = await enrichWithLitigation(limitedIds, {
      includeIpr,
      includeProsecution,
    });

    res.json({
      enriched: result.enriched,
      total: limitedIds.length,
      indicators: result.indicators,
      truncated: patentIds.length > 50,
    });
  } catch (error) {
    console.error('Error enriching litigation data:', error);
    res.status(500).json({ error: 'Failed to enrich litigation data' });
  }
});

/**
 * GET /litigation-status
 * Get cached litigation status for patents
 */
router.get('/litigation-status', (req: Request, res: Response) => {
  try {
    const patentIdsParam = req.query.patentIds;
    if (!patentIdsParam) {
      return res.status(400).json({ error: 'patentIds query parameter is required' });
    }

    const patentIds = Array.isArray(patentIdsParam)
      ? patentIdsParam as string[]
      : (patentIdsParam as string).split(',');

    const statuses = getCachedLitigationStatus(patentIds);
    res.json({ statuses });
  } catch (error) {
    console.error('Error getting litigation status:', error);
    res.status(500).json({ error: 'Failed to get litigation status' });
  }
});

/**
 * GET /ipr/:patentId
 * Get IPR history for a single patent
 */
router.get('/ipr/:patentId', async (req: Request, res: Response) => {
  try {
    const indicator = await checkPatentIPR(req.params.patentId);
    res.json(indicator);
  } catch (error) {
    console.error('Error checking IPR:', error);
    res.status(500).json({ error: 'Failed to check IPR' });
  }
});

/**
 * GET /prosecution/:patentId
 * Get prosecution history for a single patent
 */
router.get('/prosecution/:patentId', async (req: Request, res: Response) => {
  try {
    const indicator = await checkPatentProsecution(req.params.patentId);
    res.json(indicator);
  } catch (error) {
    console.error('Error checking prosecution:', error);
    res.status(500).json({ error: 'Failed to check prosecution' });
  }
});

/**
 * POST /explorations/:id/enrich-litigation
 * Enrich exploration members with litigation data
 */
router.post('/explorations/:id/enrich-litigation', async (req: Request, res: Response) => {
  try {
    const { includeIpr = true, includeProsecution = true, patentIds } = req.body;

    // Get exploration members
    const exploration = await getExplorationWithMembers(req.params.id);
    if (!exploration) {
      return res.status(404).json({ error: 'Exploration not found' });
    }

    // Use provided patentIds or all members
    const idsToEnrich = patentIds && Array.isArray(patentIds)
      ? patentIds
      : exploration.members.map(m => m.patentId);

    // Limit batch size
    const limitedIds = idsToEnrich.slice(0, 50);

    const result = await enrichWithLitigation(limitedIds, {
      includeIpr,
      includeProsecution,
    });

    res.json({
      explorationId: req.params.id,
      enriched: result.enriched,
      total: limitedIds.length,
      indicators: result.indicators,
      truncated: idsToEnrich.length > 50,
    });
  } catch (error) {
    console.error('Error enriching exploration:', error);
    res.status(500).json({ error: 'Failed to enrich exploration' });
  }
});

/**
 * POST /fetch-details
 * Fetch basic patent details (title, assignee, etc.) for external patents
 * Call this before viewing patents or doing enrichment
 */
router.post('/fetch-details', async (req: Request, res: Response) => {
  try {
    const { patentIds } = req.body;

    if (!patentIds || !Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    // Limit batch size to avoid overwhelming the API
    const limitedIds = patentIds.slice(0, 100);

    const result = await fetchMissingPatentDetails(limitedIds);

    res.json({
      ...result,
      truncated: patentIds.length > 100,
    });
  } catch (error) {
    console.error('Error fetching patent details:', error);
    res.status(500).json({ error: 'Failed to fetch patent details' });
  }
});

/**
 * POST /enrich-with-details
 * Fetch patent details AND litigation data in one call
 * This is the recommended endpoint for enrichment - ensures basic data is present first
 */
router.post('/enrich-with-details', async (req: Request, res: Response) => {
  try {
    const {
      patentIds,
      fetchBasicDetails = true,
      includeIpr = true,
      includeProsecution = true,
      limit = 200,  // Default to 200, max 500
    } = req.body;

    if (!patentIds || !Array.isArray(patentIds) || patentIds.length === 0) {
      return res.status(400).json({ error: 'patentIds array is required' });
    }

    // Limit batch size (max 500 to avoid timeouts)
    const maxLimit = Math.min(limit, 500);
    const limitedIds = patentIds.slice(0, maxLimit);

    console.log(`[PatentFamily] Enriching ${limitedIds.length} of ${patentIds.length} patents...`);

    const result = await enrichPatentsWithDetails(limitedIds, {
      fetchBasicDetails,
      includeIpr,
      includeProsecution,
    });

    res.json({
      detailsFetched: result.detailsFetched,
      litigation: result.litigation,
      total: limitedIds.length,
      truncated: patentIds.length > maxLimit,
      originalCount: patentIds.length,
    });
  } catch (error) {
    console.error('Error enriching patents with details:', error);
    res.status(500).json({ error: 'Failed to enrich patents' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// V2 Family Expansion Endpoints (Iterative, Scored)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /v2/presets
 * Get available scoring weight presets
 */
router.get('/v2/presets', (_req: Request, res: Response) => {
  try {
    const presets = getScoringPresets();
    res.json(presets);
  } catch (error) {
    console.error('Error getting presets:', error);
    res.status(500).json({ error: 'Failed to get presets' });
  }
});

/**
 * POST /v2/explorations
 * Create a new v2 exploration with seed patents
 */
router.post('/v2/explorations', async (req: Request, res: Response) => {
  try {
    const { seedPatentIds, name, weights, membershipThreshold, expansionThreshold } = req.body;

    if (!seedPatentIds || !Array.isArray(seedPatentIds) || seedPatentIds.length === 0) {
      return res.status(400).json({ error: 'seedPatentIds array is required' });
    }

    const exploration = await createExplorationV2({
      seedPatentIds,
      name,
      weights,
      membershipThreshold,
      expansionThreshold,
    });

    res.status(201).json(exploration);
  } catch (error) {
    console.error('Error creating v2 exploration:', error);
    res.status(500).json({ error: 'Failed to create exploration' });
  }
});

/**
 * GET /v2/explorations/:id
 * Get full v2 exploration state with members, candidates, excluded
 */
router.get('/v2/explorations/:id', async (req: Request, res: Response) => {
  try {
    const state = await getExplorationV2(req.params.id);
    res.json(state);
  } catch (error) {
    console.error('Error getting v2 exploration:', error);
    res.status(500).json({ error: 'Failed to get exploration' });
  }
});

/**
 * POST /v2/explorations/:id/expand
 * Expand one generation (forward, backward, or both)
 */
router.post('/v2/explorations/:id/expand', async (req: Request, res: Response) => {
  try {
    const {
      direction = 'both',
      weights,
      membershipThreshold,
      expansionThreshold,
      maxCandidates,
      portfolioBoost,
    } = req.body;

    if (!['forward', 'backward', 'both'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be forward, backward, or both' });
    }

    const result = await expandOneGeneration(req.params.id, {
      direction,
      weights,
      membershipThreshold,
      expansionThreshold,
      maxCandidates,
      portfolioBoost,
    });

    res.json(result);
  } catch (error) {
    console.error('Error expanding generation:', error);
    res.status(500).json({ error: 'Failed to expand generation' });
  }
});

/**
 * POST /v2/explorations/:id/expand-siblings
 * Discover siblings via parent/child traversal
 */
router.post('/v2/explorations/:id/expand-siblings', async (req: Request, res: Response) => {
  try {
    const {
      direction = 'both',
      weights,
      membershipThreshold,
      expansionThreshold,
      maxCandidates,
      portfolioBoost,
    } = req.body;

    if (!['forward', 'backward', 'both'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be forward, backward, or both' });
    }

    const result = await expandSiblings(req.params.id, {
      direction,
      weights,
      membershipThreshold,
      expansionThreshold,
      maxCandidates,
      portfolioBoost,
    });

    res.json(result);
  } catch (error) {
    console.error('Error expanding siblings:', error);
    res.status(500).json({ error: 'Failed to expand siblings' });
  }
});

/**
 * POST /v2/explorations/:id/rescore
 * Re-score all candidates with new weights/thresholds (no new expansion)
 */
router.post('/v2/explorations/:id/rescore', async (req: Request, res: Response) => {
  try {
    const { weights, membershipThreshold, expansionThreshold, portfolioBoost } = req.body;

    if (!weights) {
      return res.status(400).json({ error: 'weights object is required' });
    }
    if (membershipThreshold == null || expansionThreshold == null) {
      return res.status(400).json({ error: 'membershipThreshold and expansionThreshold are required' });
    }

    const result = await rescoreExploration(req.params.id, {
      weights,
      membershipThreshold,
      expansionThreshold,
      portfolioBoost,
    });

    res.json(result);
  } catch (error) {
    console.error('Error rescoring exploration:', error);
    res.status(500).json({ error: 'Failed to rescore exploration' });
  }
});

/**
 * POST /v2/explorations/:id/candidates
 * Update candidate statuses (include/exclude/neutral)
 */
router.post('/v2/explorations/:id/candidates', async (req: Request, res: Response) => {
  try {
    const { updates } = req.body;

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates array is required with {patentId, status} objects' });
    }

    for (const u of updates) {
      if (!u.patentId || !['member', 'candidate', 'excluded'].includes(u.status)) {
        return res.status(400).json({ error: 'Each update must have patentId and status (member|candidate|excluded)' });
      }
    }

    const result = await updateCandidateStatuses(req.params.id, updates);
    res.json(result);
  } catch (error) {
    console.error('Error updating candidates:', error);
    res.status(500).json({ error: 'Failed to update candidates' });
  }
});

/**
 * POST /v2/explorations/:id/save
 * Save/name an exploration
 */
router.post('/v2/explorations/:id/save', async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    await saveExploration(req.params.id, { name, description });
    res.json({ message: 'Exploration saved' });
  } catch (error) {
    console.error('Error saving exploration:', error);
    res.status(500).json({ error: 'Failed to save exploration' });
  }
});

/**
 * POST /v2/explorations/:id/create-focus-area
 * Create a focus area from accepted members
 */
router.post('/v2/explorations/:id/create-focus-area', async (req: Request, res: Response) => {
  try {
    const { name, description, includeExternalPatents } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    const result = await createFocusAreaFromV2(req.params.id, {
      name,
      description,
      includeExternalPatents,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error creating focus area from v2 exploration:', error);
    res.status(500).json({ error: 'Failed to create focus area' });
  }
});

export default router;
