/**
 * Scores API Routes
 *
 * Handles scoring calculations with customizable weights
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

interface Patent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  competitor_citations?: number;
}

interface ScoreWeights {
  citation: number;
  years: number;
  competitor: number;
}

// Default weights
const DEFAULT_WEIGHTS: ScoreWeights = {
  citation: 50,
  years: 30,
  competitor: 20
};

/**
 * Load patents from candidates file
 */
function loadPatents(): Patent[] {
  const outputDir = './output';
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No candidates file found');
  }

  const filePath = path.join(outputDir, files[0]);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.candidates;
}

/**
 * Calculate v2 score with custom weights
 */
function calculateV2Score(patent: Patent, weights: ScoreWeights): number {
  const totalWeight = weights.citation + weights.years + weights.competitor;
  if (totalWeight === 0) return 0;

  // Normalize weights
  const citationNorm = weights.citation / totalWeight;
  const yearsNorm = weights.years / totalWeight;
  const competitorNorm = weights.competitor / totalWeight;

  // Calculate weighted score
  // Forward citations: log scale to reduce impact of outliers
  const citationScore = Math.log10(patent.forward_citations + 1) * 30 * citationNorm;

  // Remaining years: linear scale (max 20 years)
  const yearsScore = Math.min(patent.remaining_years / 20, 1) * 100 * yearsNorm;

  // Competitor citations: direct multiplier
  const competitorCites = patent.competitor_citations || 0;
  const competitorScore = competitorCites * 15 * competitorNorm;

  return citationScore + yearsScore + competitorScore;
}

/**
 * GET /api/scores/v2
 * Get v2 scored rankings with custom weights
 */
router.get('/v2', (req: Request, res: Response) => {
  try {
    const {
      citation = DEFAULT_WEIGHTS.citation.toString(),
      years = DEFAULT_WEIGHTS.years.toString(),
      competitor = DEFAULT_WEIGHTS.competitor.toString(),
      page = '1',
      limit = '100'
    } = req.query;

    const weights: ScoreWeights = {
      citation: parseFloat(citation as string),
      years: parseFloat(years as string),
      competitor: parseFloat(competitor as string)
    };

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    // Load and score patents
    const patents = loadPatents();
    const scored = patents.map(p => ({
      ...p,
      v2_score: calculateV2Score(p, weights)
    }));

    // Sort by v2_score descending
    scored.sort((a, b) => b.v2_score - a.v2_score);

    // Add ranks
    const ranked = scored.map((p, index) => ({
      ...p,
      rank: index + 1
    }));

    // Paginate
    const total = ranked.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = ranked.slice(startIndex, startIndex + limitNum);

    res.json({
      weights,
      data: paginated,
      total,
      page: pageNum,
      rowsPerPage: limitNum
    });
  } catch (error) {
    console.error('Error calculating v2 scores:', error);
    res.status(500).json({ error: 'Failed to calculate scores' });
  }
});

/**
 * GET /api/scores/v3
 * Get v3 scored rankings (placeholder - requires user weights from DB)
 */
router.get('/v3', (req: Request, res: Response) => {
  // TODO: Implement with user-specific weights from database
  res.json({
    message: 'v3 scoring requires user authentication and stored weights',
    placeholder: true
  });
});

/**
 * GET /api/scores/consensus
 * Get consensus rankings (placeholder - requires multiple user weights)
 */
router.get('/consensus', (req: Request, res: Response) => {
  // TODO: Implement consensus calculation
  res.json({
    message: 'Consensus scoring requires multiple users with stored weights',
    placeholder: true
  });
});

/**
 * POST /api/weights
 * Save user's weights (placeholder - requires auth)
 */
router.post('/weights', (req: Request, res: Response) => {
  const { citation, years, competitor } = req.body;

  // TODO: Save to database with user association
  console.log('Weights received:', { citation, years, competitor });

  res.json({
    message: 'Weights saved (placeholder - not persisted yet)',
    weights: { citation, years, competitor }
  });
});

/**
 * GET /api/weights/presets
 * Get weight presets
 */
router.get('/weights/presets', (_req: Request, res: Response) => {
  res.json([
    { name: 'Default', weights: DEFAULT_WEIGHTS },
    { name: 'Citation Focus', weights: { citation: 70, years: 20, competitor: 10 } },
    { name: 'Value Focus', weights: { citation: 40, years: 50, competitor: 10 } },
    { name: 'Competitor Focus', weights: { citation: 30, years: 30, competitor: 40 } },
    { name: 'Balanced', weights: { citation: 33, years: 33, competitor: 34 } }
  ]);
});

export default router;
