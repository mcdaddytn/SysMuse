import { Router, Request, Response } from 'express';
import { exec, spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { invalidateEnrichmentCache } from './patents.routes.js';
import { clearScoringCache } from '../services/scoring-service.js';

const prisma = new PrismaClient();

const router = Router();

// Track if we've invalidated caches since last job completion detection
let lastCacheInvalidation = 0;

// Coverage types that can be run independently
type CoverageType = 'llm' | 'prosecution' | 'ipr' | 'family';
type TargetType = 'tier' | 'super-sector' | 'sector';

interface BatchJob {
  id: string;
  groupId?: string; // Links related jobs together
  targetType: TargetType;
  targetValue: string; // tier topN, sector name
  coverageType: CoverageType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  pid?: number;
  startedAt?: string;
  completedAt?: string;
  logFile?: string;
  error?: string;
  // Progress & rate tracking
  progress?: {
    total: number;
    completed: number;
  };
  estimatedRate?: number; // patents per hour (set when queued)
  actualRate?: number; // patents per hour (set when completed)
  estimatedCompletion?: string;
}

// In-memory job store (persisted to file for durability)
const JOBS_FILE = 'logs/batch-jobs.json';
let batchJobs: BatchJob[] = [];

// Default rate estimates (patents per hour) - will be refined over time
const DEFAULT_RATES: Record<CoverageType, number> = {
  llm: 150, // ~5 patents per batch, ~20 sec/batch = 150/hour (conservative)
  prosecution: 600,
  ipr: 600,
  family: 500,
};

function loadJobs(): void {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      let loaded = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      // Filter out legacy jobs without coverageType
      loaded = loaded.filter((j: BatchJob) => j.coverageType);
      // Mark any "running" jobs as "completed" since we lost track on restart
      batchJobs = loaded.map((j: BatchJob) => ({
        ...j,
        status: j.status === 'running' ? 'completed' : j.status
      }));
    }
  } catch (e) {
    console.error('Failed to load batch jobs:', e);
    batchJobs = [];
  }
}

function saveJobs(): void {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    fs.writeFileSync(JOBS_FILE, JSON.stringify(batchJobs, null, 2));
  } catch (e) {
    console.error('Failed to save batch jobs:', e);
  }
}

// Parse tier value - handles both "5000" (legacy) and "4001-5000" (range) formats
function parseTierValue(targetValue: string): number {
  if (targetValue.includes('-')) {
    // Range format: "4001-5000" → use end value (5000)
    const parts = targetValue.split('-').map(s => parseInt(s.replace(/,/g, '')));
    return parts[1] || parts[0] || 6000;
  }
  return parseInt(targetValue.replace(/,/g, '')) || 6000;
}

// Analyze gaps for a given target using Postgres
// topN: for super-sector/sector, only analyze top N patents by score (0 = all)
// portfolioId: optional — scope to a specific portfolio
async function analyzeGaps(
  targetType: TargetType,
  targetValue: string,
  topN: number = 0,
  portfolioId?: string
): Promise<Record<CoverageType, { total: number; gap: number; ids: string[] }>> {
  const empty = {
    llm: { total: 0, gap: 0, ids: [] as string[] },
    prosecution: { total: 0, gap: 0, ids: [] as string[] },
    ipr: { total: 0, gap: 0, ids: [] as string[] },
    family: { total: 0, gap: 0, ids: [] as string[] },
  };

  try {
    // Build where clause based on target type
    const where: Record<string, any> = {};

    // Portfolio scoping via PortfolioPatent join
    if (portfolioId) {
      where.portfolios = { some: { portfolioId } };
    }

    if (targetType === 'super-sector') {
      where.superSector = targetValue;
    } else if (targetType === 'sector') {
      where.primarySector = targetValue;
    }
    // For 'tier', we take top N by baseScore (no sector filter)

    // Determine how many patents to take
    let take: number | undefined;
    if (targetType === 'tier') {
      take = parseTierValue(targetValue);
    } else if (topN > 0) {
      take = topN;
    }

    // Query patents ordered by baseScore descending
    const patents = await prisma.patent.findMany({
      where,
      select: {
        patentId: true,
        hasLlmData: true,
        hasProsecutionData: true,
      },
      orderBy: { baseScore: 'desc' },
      ...(take ? { take } : {}),
    });

    const ids = patents.map(p => p.patentId);

    // LLM and prosecution gaps come from Postgres flags
    const llmGapIds = patents.filter(p => !p.hasLlmData).map(p => p.patentId);
    const prosGapIds = patents.filter(p => !p.hasProsecutionData).map(p => p.patentId);

    // IPR and family gaps still use file-based cache
    function getCacheSet(dir: string): Set<string> {
      const fullPath = path.join(process.cwd(), dir);
      if (!fs.existsSync(fullPath)) return new Set();
      try {
        return new Set(
          fs.readdirSync(fullPath)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''))
        );
      } catch {
        return new Set();
      }
    }

    const iprSet = getCacheSet('cache/ipr-scores');
    const familySet = getCacheSet('cache/patent-families/parents');

    const iprGapIds = ids.filter(id => !iprSet.has(id));
    const familyGapIds = ids.filter(id => !familySet.has(id));

    return {
      llm: { total: ids.length, gap: llmGapIds.length, ids: llmGapIds },
      prosecution: { total: ids.length, gap: prosGapIds.length, ids: prosGapIds },
      ipr: { total: ids.length, gap: iprGapIds.length, ids: iprGapIds },
      family: { total: ids.length, gap: familyGapIds.length, ids: familyGapIds },
    };
  } catch (e) {
    console.error('Failed to analyze gaps:', e);
    return empty;
  }
}

// Get script command for a coverage type
function getEnrichmentCommand(coverageType: CoverageType, batchFile: string, logFile: string): string {
  switch (coverageType) {
    case 'llm':
      return `npx tsx scripts/run-llm-analysis-v3.ts ${batchFile} > ${logFile} 2>&1`;
    case 'prosecution':
      return `npx tsx scripts/check-prosecution-history.ts ${batchFile} > ${logFile} 2>&1`;
    case 'ipr':
      return `npx tsx scripts/check-ipr-risk.ts ${batchFile} > ${logFile} 2>&1`;
    case 'family':
      // Family script uses comma-separated IDs
      return `npx tsx scripts/enrich-citations.ts --patent-ids "$(cat ${batchFile} | jq -r '.[]' | tr '\\n' ',' | sed 's/,$//')" > ${logFile} 2>&1`;
    default:
      throw new Error(`Unknown coverage type: ${coverageType}`);
  }
}

// Detect running enrichment processes
function detectRunningProcesses(): Array<{ pid: number; type: string; cmd: string }> {
  try {
    const result = execSync(
      'ps aux | grep -E "run-llm-analysis|check-prosecution|check-ipr|enrich-citations" | grep -v grep',
      { encoding: 'utf-8' }
    );

    return result.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split(/\s+/);
      const pid = parseInt(parts[1]);
      let type = 'unknown';
      if (line.includes('run-llm-analysis')) type = 'llm';
      else if (line.includes('check-prosecution')) type = 'prosecution';
      else if (line.includes('check-ipr')) type = 'ipr';
      else if (line.includes('enrich-citations')) type = 'family';
      return { pid, type, cmd: parts.slice(10).join(' ') };
    });
  } catch {
    return [];
  }
}

// Initialize
loadJobs();

/**
 * GET /api/batch-jobs
 * List all batch jobs (recent + running)
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    // Get jobs from last 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let recentJobs = batchJobs.filter(j =>
      (j.startedAt && j.startedAt > cutoff) || j.status === 'running' || j.status === 'pending'
    );

    // Update status of jobs that claim to be running
    const runningProcesses = detectRunningProcesses();
    let jobsJustCompleted = false;
    recentJobs = recentJobs.map(j => {
      if (j.status === 'running' && j.pid) {
        const stillRunning = runningProcesses.some(p => p.pid === j.pid);
        if (!stillRunning) {
          // Job finished - calculate actual rate
          const startTime = j.startedAt ? new Date(j.startedAt).getTime() : Date.now();
          const endTime = Date.now();
          const hours = (endTime - startTime) / 3600000;
          const completed = j.progress?.completed || j.progress?.total || 0;
          const actualRate = hours > 0 ? Math.round(completed / hours) : 0;

          jobsJustCompleted = true;

          return {
            ...j,
            status: 'completed' as const,
            completedAt: new Date().toISOString(),
            actualRate,
          };
        }
      }
      return j;
    });

    // Invalidate caches when jobs complete (throttled to once per 10 seconds)
    const now = Date.now();
    if (jobsJustCompleted && now - lastCacheInvalidation > 10000) {
      console.log('[BatchJobs] Jobs completed - invalidating enrichment and scoring caches');
      invalidateEnrichmentCache();
      clearScoringCache();
      lastCacheInvalidation = now;
    }

    // Save any status updates
    batchJobs = batchJobs.map(j => {
      const updated = recentJobs.find(r => r.id === j.id);
      return updated || j;
    });
    saveJobs();

    // Stats
    const stats = {
      pending: recentJobs.filter(j => j.status === 'pending').length,
      running: recentJobs.filter(j => j.status === 'running').length,
      completed: recentJobs.filter(j => j.status === 'completed').length,
      failed: recentJobs.filter(j => j.status === 'failed').length,
    };

    res.json({
      jobs: recentJobs.slice(0, 100),
      stats,
    });
  } catch (error) {
    console.error('Error listing batch jobs:', error);
    res.status(500).json({ error: 'Failed to list batch jobs' });
  }
});

/**
 * POST /api/batch-jobs
 * Start enrichment jobs for selected coverage types
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      targetType,
      targetValue,
      coverageTypes = ['llm', 'prosecution', 'ipr', 'family'],
      maxHours = 4,
      topN = 0,  // For super-sector/sector: limit to top N patents by score (0 = all)
      portfolioId,  // Optional: scope to a specific portfolio
    } = req.body;

    if (!targetType || !['tier', 'super-sector', 'sector'].includes(targetType)) {
      return res.status(400).json({ error: 'Invalid targetType. Must be tier, super-sector, or sector' });
    }

    if (!targetValue) {
      return res.status(400).json({ error: 'targetValue is required' });
    }

    // Validate coverage types
    const validTypes: CoverageType[] = ['llm', 'prosecution', 'ipr', 'family'];
    const selectedTypes = coverageTypes.filter((t: string) => validTypes.includes(t as CoverageType)) as CoverageType[];

    if (selectedTypes.length === 0) {
      return res.status(400).json({ error: 'At least one valid coverageType is required' });
    }

    // Analyze gaps to determine what needs to be done
    // For super-sector/sector, topN limits analysis to top N patents by score
    const gaps = await analyzeGaps(targetType, targetValue, topN, portfolioId);

    // Create a group ID to link related jobs
    const groupId = `group-${Date.now()}`;
    const createdJobs: BatchJob[] = [];

    for (const coverageType of selectedTypes) {
      const gapInfo = gaps[coverageType];

      if (gapInfo.gap === 0) {
        // No gap for this type, skip
        continue;
      }

      const jobId = `${coverageType}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const batchFile = `/tmp/batch-${jobId}.json`;
      const logsDir = path.join(process.cwd(), 'logs');
      fs.mkdirSync(logsDir, { recursive: true });
      const logFile = path.join(logsDir, `job-${jobId}.log`);

      // Write batch file with patent IDs (process up to 500 at a time)
      const MAX_BATCH_SIZE = 500;
      const batchIds = gapInfo.ids.slice(0, MAX_BATCH_SIZE);
      const actualBatchSize = batchIds.length;
      fs.writeFileSync(batchFile, JSON.stringify(batchIds));

      // Calculate estimated completion based on actual batch size, not full gap
      const rate = DEFAULT_RATES[coverageType];
      const estimatedHours = actualBatchSize / rate;
      const estimatedCompletion = new Date(Date.now() + estimatedHours * 3600000).toISOString();

      // Start the job
      const cmd = getEnrichmentCommand(coverageType, batchFile, logFile);
      const child = spawn('bash', ['-c', cmd], {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
      });
      child.unref();

      const job: BatchJob = {
        id: jobId,
        groupId,
        targetType,
        targetValue,
        coverageType,
        status: 'running',
        pid: child.pid,
        startedAt: new Date().toISOString(),
        logFile,
        progress: {
          total: actualBatchSize,  // Actual patents being processed, not full gap
          completed: 0,
        },
        estimatedRate: rate,
        estimatedCompletion,
      };

      batchJobs.unshift(job);
      createdJobs.push(job);
    }

    saveJobs();

    res.status(201).json({
      groupId,
      jobs: createdJobs,
      gaps: Object.fromEntries(
        Object.entries(gaps).map(([k, v]) => [k, { total: v.total, gap: v.gap }])
      ),
    });
  } catch (error) {
    console.error('Error starting batch jobs:', error);
    res.status(500).json({ error: 'Failed to start batch jobs' });
  }
});

/**
 * DELETE /api/batch-jobs/:id
 * Cancel a running job
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = batchJobs.find(j => j.id === id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'running') {
      return res.status(400).json({ error: 'Job is not running' });
    }

    if (job.pid) {
      try {
        exec(`pkill -P ${job.pid}; kill ${job.pid}`, (err) => {
          if (err) console.log('Kill process warning:', err.message);
        });
      } catch (e) {
        console.error('Failed to kill process:', e);
      }
    }

    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    saveJobs();

    res.json({ job });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

/**
 * DELETE /api/batch-jobs/group/:groupId
 * Cancel all jobs in a group
 */
router.delete('/group/:groupId', (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    const groupJobs = batchJobs.filter(j => j.groupId === groupId && j.status === 'running');

    for (const job of groupJobs) {
      if (job.pid) {
        try {
          exec(`pkill -P ${job.pid}; kill ${job.pid}`);
        } catch (e) {
          console.error('Failed to kill process:', e);
        }
      }
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
    }

    saveJobs();

    res.json({ cancelled: groupJobs.length });
  } catch (error) {
    console.error('Error cancelling job group:', error);
    res.status(500).json({ error: 'Failed to cancel job group' });
  }
});

/**
 * GET /api/batch-jobs/:id/log
 * Get the last N lines of a job's log file
 */
router.get('/:id/log', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const lines = parseInt(req.query.lines as string) || 50;

    const job = batchJobs.find(j => j.id === id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Handle both absolute and relative log paths (legacy jobs)
    let logPath = job.logFile;
    if (logPath && !path.isAbsolute(logPath)) {
      logPath = path.join(process.cwd(), logPath);
    }

    if (!logPath || !fs.existsSync(logPath)) {
      return res.json({ log: 'Log file not available' });
    }

    const content = fs.readFileSync(logPath, 'utf-8');
    const allLines = content.split('\n');
    const lastLines = allLines.slice(-lines).join('\n');

    res.json({ log: lastLines });
  } catch (error) {
    console.error('Error reading job log:', error);
    res.status(500).json({ error: 'Failed to read job log' });
  }
});

/**
 * GET /api/batch-jobs/gaps
 * Analyze enrichment gaps for a target
 */
router.get('/gaps', async (req: Request, res: Response) => {
  try {
    const targetType = req.query.targetType as TargetType;
    const targetValue = req.query.targetValue as string;
    const topN = parseInt(req.query.topN as string) || 0;
    const portfolioId = req.query.portfolioId as string | undefined;

    if (!targetType || !targetValue) {
      return res.status(400).json({ error: 'targetType and targetValue are required' });
    }

    const gaps = await analyzeGaps(targetType, targetValue, topN, portfolioId);

    res.json({
      targetType,
      targetValue,
      topN,
      gaps: Object.fromEntries(
        Object.entries(gaps).map(([k, v]) => [k, { total: v.total, gap: v.gap }])
      ),
      estimatedRates: DEFAULT_RATES,
    });
  } catch (error) {
    console.error('Error analyzing gaps:', error);
    res.status(500).json({ error: 'Failed to analyze gaps' });
  }
});

export default router;
