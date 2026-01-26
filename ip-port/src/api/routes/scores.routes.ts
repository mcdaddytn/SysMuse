/**
 * Scores API Routes
 *
 * Handles scoring calculations with customizable weights.
 * V2: Simple 3-weight scoring (legacy)
 * V3: Multi-metric scoring with configurable profiles and year multiplier
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  scoreAllPatents,
  scorePatentsBySector,
  getProfiles,
  getProfile,
  getDefaultProfileId,
  loadAllClassifications,
  loadAllLlmScores,
  clearScoringCache,
  getLlmStats,
} from '../services/scoring-service.js';

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

// Cache for patent lookup by ID (used by v3 endpoint)
let patentsMap: Map<string, any> | null = null;

function loadPatentsMap(): Map<string, any> {
  if (patentsMap) return patentsMap;
  const patents = loadPatents();
  patentsMap = new Map(patents.map(p => [p.patent_id, p]));
  return patentsMap;
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
 * V3 scored rankings with configurable weight profiles
 *
 * Query params:
 *   profile  - Profile ID (default: 'executive')
 *   page     - Page number (default: 1)
 *   limit    - Results per page (default: 100)
 *   sector   - Filter by sector key
 *   minScore - Minimum score filter
 */
router.get('/v3', (req: Request, res: Response) => {
  try {
    const {
      profile: profileId = getDefaultProfileId(),
      page = '1',
      limit = '100',
      sector,
      minScore,
    } = req.query;

    const profile = getProfile(profileId as string);
    if (!profile) {
      res.status(400).json({ error: `Unknown profile: ${profileId}` });
      return;
    }

    const pageNum = parseInt(page as string);
    const limitNum = Math.min(parseInt(limit as string), 1000);

    // Score all patents
    let scored = scoreAllPatents(profileId as string);

    // Load candidates for metadata (title, assignee, sector, etc.)
    const candidates = loadPatentsMap();

    // Apply filters
    if (sector) {
      const sectorFilter = sector as string;
      scored = scored.filter(s => {
        const c = candidates.get(s.patent_id);
        return c?.primary_sector === sectorFilter;
      });
      // Re-rank after filtering
      for (let i = 0; i < scored.length; i++) {
        scored[i].rank = i + 1;
      }
    }

    if (minScore) {
      const min = parseFloat(minScore as string);
      scored = scored.filter(s => s.score >= min);
    }

    // Paginate
    const total = scored.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginated = scored.slice(startIndex, startIndex + limitNum);

    // Enrich with candidate metadata
    const classifications = loadAllClassifications();
    const llmScores = loadAllLlmScores();

    const enriched = paginated.map(s => {
      const c = candidates.get(s.patent_id);
      const classification = classifications.get(s.patent_id);
      const llm = llmScores.get(s.patent_id);
      return {
        ...s,
        patent_title: c?.patent_title || '',
        patent_date: c?.patent_date || '',
        assignee: c?.assignee || '',
        forward_citations: c?.forward_citations || 0,
        remaining_years: c?.remaining_years || 0,
        primary_sector: c?.primary_sector || 'general',
        super_sector: c?.super_sector || '',
        cpc_codes: c?.cpc_codes || [],
        competitor_citations: classification?.competitor_citations || 0,
        affiliate_citations: classification?.affiliate_citations || 0,
        neutral_citations: classification?.neutral_citations || 0,
        competitor_count: classification?.competitor_count || 0,
        competitor_names: classification?.competitor_names || [],
        has_llm_scores: !!llm,
        llm_scores: llm ? {
          eligibility_score: llm.eligibility_score,
          validity_score: llm.validity_score,
          claim_breadth: llm.claim_breadth,
          enforcement_clarity: llm.enforcement_clarity,
          design_around_difficulty: llm.design_around_difficulty,
        } : null,
      };
    });

    const llmStats = getLlmStats();

    res.json({
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        description: profile.description,
        weights: profile.weights,
      },
      data: enriched,
      total,
      page: pageNum,
      rowsPerPage: limitNum,
      llm_coverage: llmStats,
    });
  } catch (error) {
    console.error('Error calculating v3 scores:', error);
    res.status(500).json({ error: 'Failed to calculate v3 scores' });
  }
});

/**
 * GET /api/scores/profiles
 * List available scoring profiles
 */
router.get('/profiles', (_req: Request, res: Response) => {
  const profiles = getProfiles().map(p => ({
    id: p.id,
    displayName: p.displayName,
    description: p.description,
    category: p.category,
    weights: p.weights,
    isDefault: p.id === getDefaultProfileId(),
  }));
  res.json(profiles);
});

/**
 * GET /api/scores/sectors
 * Sector ranking summary with top patents per sector
 *
 * Query params:
 *   profile - Profile ID (default: 'executive')
 *   topN    - Number of top patents per sector (default: 15)
 */
router.get('/sectors', (req: Request, res: Response) => {
  try {
    const {
      profile: profileId = getDefaultProfileId(),
      topN = '15',
    } = req.query;

    const profile = getProfile(profileId as string);
    if (!profile) {
      res.status(400).json({ error: `Unknown profile: ${profileId}` });
      return;
    }

    const topNNum = parseInt(topN as string);
    const bySector = scorePatentsBySector(profileId as string);
    const candidates = loadPatentsMap();

    // Load sector damages config
    const damagesConfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'config/sector-damages.json'), 'utf-8')
    );

    // Load sector names from breakout config
    const sectorConfig = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'config/sector-breakout-v2.json'), 'utf-8')
    );

    const sectors: any[] = [];

    for (const [sectorKey, patents] of bySector) {
      const scores = patents.map(p => p.score);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const damagesInfo = damagesConfig.sectors[sectorKey];
      const sectorInfo = sectorConfig.sectorMappings[sectorKey];

      const topPatents = patents.slice(0, topNNum).map(p => {
        const c = candidates.get(p.patent_id);
        return {
          patent_id: p.patent_id,
          score: p.score,
          rank: p.rank,
          title: c?.patent_title || '',
          assignee: c?.assignee || '',
          remaining_years: c?.remaining_years || 0,
        };
      });

      sectors.push({
        sector: sectorKey,
        sector_name: sectorInfo?.name || sectorKey,
        super_sector: candidates.get(patents[0]?.patent_id)?.super_sector || '',
        patent_count: patents.length,
        avg_score: Math.round(avgScore * 100) / 100,
        max_score: Math.round(Math.max(...scores) * 100) / 100,
        damages_rating: damagesInfo?.damages_rating || 1,
        damages_label: damagesInfo?.label || 'Low',
        top_patents: topPatents,
      });
    }

    // Sort by damages_rating desc, then avg_score desc
    sectors.sort((a, b) => {
      if (b.damages_rating !== a.damages_rating) return b.damages_rating - a.damages_rating;
      return b.avg_score - a.avg_score;
    });

    res.json({
      profile: {
        id: profile.id,
        displayName: profile.displayName,
      },
      topN: topNNum,
      sectors,
      total_sectors: sectors.length,
    });
  } catch (error) {
    console.error('Error calculating sector rankings:', error);
    res.status(500).json({ error: 'Failed to calculate sector rankings' });
  }
});

/**
 * POST /api/scores/reload
 * Clear scoring caches and reload data
 */
router.post('/reload', (_req: Request, res: Response) => {
  clearScoringCache();
  patentsMap = null;
  res.json({ message: 'Scoring caches cleared' });
});

/**
 * GET /api/scores/stats
 * Get scoring statistics including LLM coverage
 */
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const llmStats = getLlmStats();
    res.json({
      llm_coverage: llmStats,
      profiles_count: getProfiles().length,
    });
  } catch (error) {
    console.error('Error getting scoring stats:', error);
    res.status(500).json({ error: 'Failed to get scoring stats' });
  }
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
 * Get weight presets (legacy v2 presets)
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
