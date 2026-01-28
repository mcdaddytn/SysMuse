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
} from '../services/patent-family-service.js';

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

export default router;
