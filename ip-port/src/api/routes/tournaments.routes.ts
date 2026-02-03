/**
 * Tournament API Routes
 *
 * Endpoints for creating, executing, and monitoring patent tournaments.
 *
 * POST /api/tournaments        - Start a new tournament
 * GET  /api/tournaments        - List completed tournaments
 * GET  /api/tournaments/:id    - Get tournament status or result
 * GET  /api/tournaments/:id/summary - Get tournament summary
 */

import { Router, Request, Response } from 'express';
import {
  executeTournament,
  getTournamentStatus,
  listTournaments,
  getTournamentResult,
  loadInputPatents,
  TournamentConfig,
  TournamentInput,
} from '../services/tournament-service.js';

const router = Router();

// Default POS tournament configuration
const DEFAULT_POS_CONFIG: TournamentConfig = {
  name: 'POS Patent Tournament',
  description: 'Identify patents relevant to Point-of-Sale system licensing',
  round1: {
    templateId: 'tmpl_pos_round1_eval',
    advanceCount: 2,    // Top 2 from each cluster of 10 = 20%
    clusterSize: 10,
  },
  round2: {
    templateId: 'tmpl_pos_round2_eval',
    advanceCount: 3,    // Top 3 from each cluster of 10 = 30%
    clusterSize: 10,
  },
  finalTemplateId: 'tmpl_pos_final_synthesis',
};

/**
 * POST /api/tournaments
 * Start a new tournament.
 *
 * Body:
 *   sourceType: 'v2' | 'v3' | 'super_sector'
 *   sourceId?: string (required for super_sector)
 *   topN: number (default 100)
 *   llmEnhancedOnly: boolean (default true)
 *   config?: TournamentConfig (optional, uses POS default)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      sourceType = 'v2',
      sourceId,
      topN = 100,
      llmEnhancedOnly = true,
      config,
      name,
      description,
    } = req.body;

    // Validate input
    if (!['v2', 'v3', 'super_sector'].includes(sourceType)) {
      res.status(400).json({ error: 'Invalid sourceType. Must be v2, v3, or super_sector' });
      return;
    }

    if (sourceType === 'super_sector' && !sourceId) {
      res.status(400).json({ error: 'sourceId required for super_sector source type' });
      return;
    }

    const input: TournamentInput = {
      sourceType,
      sourceId,
      topN: Math.max(10, Math.min(topN, 5000)), // Clamp to 10-5000
      llmEnhancedOnly,
    };

    // Use provided config or default POS config
    const tournamentConfig: TournamentConfig = config || {
      ...DEFAULT_POS_CONFIG,
      name: name || DEFAULT_POS_CONFIG.name,
      description: description || DEFAULT_POS_CONFIG.description,
    };

    // Start tournament in background
    console.log(`[API] Starting tournament: ${tournamentConfig.name}`);
    console.log(`[API] Input: ${sourceType}, topN=${topN}, llmEnhancedOnly=${llmEnhancedOnly}`);

    // Fire and forget - tournament runs in background
    executeTournament(tournamentConfig, input)
      .then(result => {
        console.log(`[API] Tournament ${result.tournamentId} completed successfully`);
      })
      .catch(err => {
        console.error(`[API] Tournament failed:`, err);
      });

    // Return immediately with tournament ID
    // Generate ID synchronously for immediate response
    const date = new Date().toISOString().split('T')[0];
    const rand = Math.random().toString(36).substring(2, 8);
    const estimatedId = `pos-${date}-${rand}`;

    res.status(202).json({
      message: 'Tournament started',
      estimatedTournamentId: estimatedId,
      config: tournamentConfig,
      input,
      note: 'Tournament is running in background. Check /api/tournaments for status.',
    });

  } catch (error) {
    console.error('Error starting tournament:', error);
    res.status(500).json({
      error: 'Failed to start tournament',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/tournaments
 * List completed tournaments.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const tournaments = listTournaments();
    res.json({
      tournaments,
      count: tournaments.length,
    });
  } catch (error) {
    console.error('Error listing tournaments:', error);
    res.status(500).json({ error: 'Failed to list tournaments' });
  }
});

/**
 * GET /api/tournaments/preview
 * Preview input patents before starting tournament.
 *
 * Query:
 *   sourceType: 'v2' | 'v3' | 'super_sector'
 *   sourceId?: string
 *   topN: number
 *   llmEnhancedOnly: boolean
 */
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const {
      sourceType = 'v2',
      sourceId,
      topN = '100',
      llmEnhancedOnly = 'true',
    } = req.query;

    const input: TournamentInput = {
      sourceType: sourceType as 'v2' | 'v3' | 'super_sector',
      sourceId: sourceId as string | undefined,
      topN: parseInt(topN as string),
      llmEnhancedOnly: llmEnhancedOnly === 'true',
    };

    const patentIds = await loadInputPatents(input);

    res.json({
      input,
      patentCount: patentIds.length,
      patentIds: patentIds.slice(0, 20), // Preview first 20
      expectedClusters: Math.ceil(patentIds.length / 10),
      expectedRound1Advancing: Math.ceil(patentIds.length / 10) * 2, // 2 per cluster
    });

  } catch (error) {
    console.error('Error previewing tournament:', error);
    res.status(500).json({
      error: 'Failed to preview tournament input',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/tournaments/:id
 * Get tournament status (if running) or result (if complete).
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if running
    const status = getTournamentStatus(id);
    if (status) {
      res.json({
        type: 'status',
        ...status,
      });
      return;
    }

    // Check for completed result
    const result = getTournamentResult(id);
    if (result) {
      res.json({
        type: 'result',
        ...result,
      });
      return;
    }

    res.status(404).json({ error: 'Tournament not found' });

  } catch (error) {
    console.error('Error getting tournament:', error);
    res.status(500).json({ error: 'Failed to get tournament' });
  }
});

/**
 * GET /api/tournaments/:id/summary
 * Get just the summary (faster than full result).
 */
router.get('/:id/summary', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = getTournamentResult(id);
    if (!result) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }

    res.json({
      tournamentId: result.tournamentId,
      name: result.name,
      inputPatentCount: result.inputPatentCount,
      round1AdvancingCount: result.round1AdvancingCount,
      round2AdvancingCount: result.round2AdvancingCount,
      tier1Count: result.tier1Count,
      tier2Count: result.tier2Count,
      tier3Count: result.tier3Count,
      totalTokensUsed: result.totalTokensUsed,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      summary: result.summary,
    });

  } catch (error) {
    console.error('Error getting tournament summary:', error);
    res.status(500).json({ error: 'Failed to get tournament summary' });
  }
});

/**
 * GET /api/tournaments/config/default
 * Get the default POS tournament configuration.
 */
router.get('/config/default', (_req: Request, res: Response) => {
  res.json(DEFAULT_POS_CONFIG);
});

export default router;
