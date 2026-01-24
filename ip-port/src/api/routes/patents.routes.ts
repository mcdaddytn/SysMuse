/**
 * Patent API Routes
 *
 * Serves patent data from the cached portfolio
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// Types
interface Patent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
}

interface CandidatesFile {
  metadata: {
    totalPatents: number;
    activePatents: number;
    expiredPatents: number;
  };
  candidates: Patent[];
}

// Cache the loaded data
let patentsCache: Patent[] | null = null;
let lastLoadTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load patents from the candidates file
 */
function loadPatents(): Patent[] {
  const now = Date.now();

  // Return cached data if still valid
  if (patentsCache && (now - lastLoadTime) < CACHE_TTL) {
    return patentsCache;
  }

  // Find the most recent candidates file
  const outputDir = './output';
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No candidates file found. Run: npm run download:portfolio');
  }

  const filePath = path.join(outputDir, files[0]);
  console.log(`[Patents] Loading from: ${filePath}`);

  const data: CandidatesFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  patentsCache = data.candidates;
  lastLoadTime = now;

  console.log(`[Patents] Loaded ${patentsCache.length} patents`);
  return patentsCache;
}

/**
 * Apply filters to patents array
 */
function applyFilters(patents: Patent[], filters: Record<string, string | string[] | undefined>): Patent[] {
  let result = patents;

  // Search filter (searches patent_id, title, assignee)
  if (filters.search) {
    const searchLower = (filters.search as string).toLowerCase();
    result = result.filter(p =>
      p.patent_id.toLowerCase().includes(searchLower) ||
      p.patent_title.toLowerCase().includes(searchLower) ||
      p.assignee.toLowerCase().includes(searchLower)
    );
  }

  // Assignee filter
  if (filters.assignees) {
    const assigneeList = Array.isArray(filters.assignees)
      ? filters.assignees
      : [filters.assignees];
    result = result.filter(p =>
      assigneeList.some(a => p.assignee.toLowerCase().includes(a.toLowerCase()))
    );
  }

  // Date range filter
  if (filters.dateStart) {
    result = result.filter(p => p.patent_date >= filters.dateStart!);
  }
  if (filters.dateEnd) {
    result = result.filter(p => p.patent_date <= filters.dateEnd!);
  }

  // Score range filter
  if (filters.scoreMin) {
    const min = parseFloat(filters.scoreMin as string);
    result = result.filter(p => p.score >= min);
  }
  if (filters.scoreMax) {
    const max = parseFloat(filters.scoreMax as string);
    result = result.filter(p => p.score <= max);
  }

  // Remaining years filter
  if (filters.yearsMin) {
    const min = parseFloat(filters.yearsMin as string);
    result = result.filter(p => p.remaining_years >= min);
  }
  if (filters.yearsMax) {
    const max = parseFloat(filters.yearsMax as string);
    result = result.filter(p => p.remaining_years <= max);
  }

  // Has competitor citations filter
  if (filters.hasCompetitorCites === 'true') {
    result = result.filter(p => (p as any).competitor_citations > 0);
  }

  return result;
}

/**
 * Apply sorting to patents array
 */
function applySorting(patents: Patent[], sortBy: string, descending: boolean): Patent[] {
  const sorted = [...patents];

  sorted.sort((a, b) => {
    let aVal = (a as any)[sortBy];
    let bVal = (b as any)[sortBy];

    // Handle string comparison
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return descending
        ? bVal.localeCompare(aVal)
        : aVal.localeCompare(bVal);
    }

    // Handle numeric comparison
    aVal = aVal ?? 0;
    bVal = bVal ?? 0;
    return descending ? bVal - aVal : aVal - bVal;
  });

  return sorted;
}

/**
 * GET /api/patents
 * List patents with pagination, filtering, and sorting
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const {
      page = '1',
      limit = '50',
      sortBy = 'score',
      descending = 'true',
      ...filters
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string)));
    const isDescending = descending === 'true';

    // Load and filter patents
    let patents = loadPatents();
    patents = applyFilters(patents, filters as Record<string, string>);

    // Get total before pagination
    const total = patents.length;

    // Sort
    patents = applySorting(patents, sortBy as string, isDescending);

    // Paginate
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedPatents = patents.slice(startIndex, startIndex + limitNum);

    res.json({
      data: paginatedPatents,
      total,
      page: pageNum,
      rowsPerPage: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (error) {
    console.error('Error loading patents:', error);
    res.status(500).json({ error: 'Failed to load patents' });
  }
});

/**
 * GET /api/patents/stats
 * Get portfolio statistics
 */
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const patents = loadPatents();

    // Calculate statistics
    const active = patents.filter(p => p.remaining_years > 0);
    const expired = patents.filter(p => p.remaining_years <= 0);

    // Group by assignee
    const assigneeCounts: Record<string, number> = {};
    patents.forEach(p => {
      const assignee = p.assignee.split(',')[0].trim();
      assigneeCounts[assignee] = (assigneeCounts[assignee] || 0) + 1;
    });

    // Top assignees
    const topAssignees = Object.entries(assigneeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    res.json({
      total: patents.length,
      active: active.length,
      expired: expired.length,
      topAssignees,
      dateRange: {
        oldest: patents[patents.length - 1]?.patent_date,
        newest: patents[0]?.patent_date
      }
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * GET /api/patents/assignees
 * Get list of unique assignees for filtering
 */
router.get('/assignees', (_req: Request, res: Response) => {
  try {
    const patents = loadPatents();

    const assigneeCounts: Record<string, number> = {};
    patents.forEach(p => {
      assigneeCounts[p.assignee] = (assigneeCounts[p.assignee] || 0) + 1;
    });

    const assignees = Object.entries(assigneeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    res.json(assignees);
  } catch (error) {
    console.error('Error getting assignees:', error);
    res.status(500).json({ error: 'Failed to get assignees' });
  }
});

/**
 * GET /api/patents/:id
 * Get single patent details
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patents = loadPatents();

    const patent = patents.find(p => p.patent_id === id);
    if (!patent) {
      return res.status(404).json({ error: 'Patent not found' });
    }

    res.json(patent);
  } catch (error) {
    console.error('Error getting patent:', error);
    res.status(500).json({ error: 'Failed to get patent' });
  }
});

/**
 * GET /api/patents/:id/citations
 * Get citation data for a patent (from cache)
 */
router.get('/:id/citations', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Try to load from citation cache
    const cachePath = `./cache/api/patentsview/forward-citations/${id}.json`;

    if (fs.existsSync(cachePath)) {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      return res.json(data);
    }

    res.json({
      patent_id: id,
      cached: false,
      message: 'Citation data not yet cached. Queue a citation analysis job.'
    });
  } catch (error) {
    console.error('Error getting citations:', error);
    res.status(500).json({ error: 'Failed to get citations' });
  }
});

export default router;
