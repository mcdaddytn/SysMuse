import { Router, Request, Response } from 'express';
import { exec, spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

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

// Analyze gaps for a given target
function analyzeGaps(targetType: TargetType, targetValue: string): Record<CoverageType, { total: number; gap: number; ids: string[] }> {
  try {
    const tierTopN = targetType === 'tier' ? parseTierValue(targetValue) : 6000;

    // Build sector matching condition that handles legacy uppercase names
    let sectorCondition = `p.super_sector === '${targetValue}'`;
    if (targetValue === 'Video & Streaming') {
      sectorCondition = `(p.super_sector === 'Video & Streaming' || p.super_sector === 'VIDEO_STREAMING')`;
    } else if (targetValue === 'SDN & Network Infrastructure') {
      sectorCondition = `(p.super_sector === 'SDN & Network Infrastructure' || p.super_sector === 'SDN_NETWORK')`;
    } else if (targetValue === 'Computing & Data') {
      sectorCondition = `(p.super_sector === 'Computing & Data' || p.super_sector === 'COMPUTING')`;
    } else if (targetValue === 'Virtualization & Cloud') {
      sectorCondition = `(p.super_sector === 'Virtualization & Cloud' || p.super_sector === 'VIRTUALIZATION')`;
    } else if (targetValue === 'Imaging & Optics') {
      sectorCondition = `(p.super_sector === 'Imaging & Optics' || p.super_sector === 'IMAGING')`;
    } else if (targetValue === 'Wireless & RF') {
      sectorCondition = `(p.super_sector === 'Wireless & RF' || p.super_sector === 'WIRELESS')`;
    } else if (targetValue === 'Semiconductor') {
      sectorCondition = `(p.super_sector === 'Semiconductor' || p.super_sector === 'SEMICONDUCTOR')`;
    } else if (targetValue === 'Security') {
      sectorCondition = `(p.super_sector === 'Security' || p.super_sector === 'SECURITY')`;
    } else if (targetValue === 'Audio') {
      sectorCondition = `(p.super_sector === 'Audio' || p.super_sector === 'AUDIO')`;
    } else if (targetValue === 'AI & Machine Learning') {
      sectorCondition = `(p.super_sector === 'AI & Machine Learning' || p.super_sector === 'AI_ML')`;
    }

    const script = `
      const fs = require('fs');
      const candidatesFile = fs.readdirSync('output')
        .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
        .sort().pop();
      const data = JSON.parse(fs.readFileSync('output/' + candidatesFile, 'utf-8'));

      let patents;
      if ('${targetType}' === 'tier') {
        patents = data.candidates.sort((a, b) => b.score - a.score).slice(0, ${tierTopN});
      } else if ('${targetType}' === 'super-sector') {
        patents = data.candidates.filter(p => ${sectorCondition});
      } else {
        patents = data.candidates.filter(p => p.primary_sector === '${targetValue}');
      }

      function getCacheSet(dir) {
        if (!fs.existsSync(dir)) return new Set();
        return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
      }

      const llmSet = getCacheSet('cache/llm-scores');
      const prosSet = getCacheSet('cache/prosecution-scores');
      const iprSet = getCacheSet('cache/ipr-scores');
      const familySet = getCacheSet('cache/patent-families/parents');

      const ids = patents.map(p => p.patent_id);
      const result = {
        llm: { total: ids.length, gap: ids.filter(id => !llmSet.has(id)).length, ids: ids.filter(id => !llmSet.has(id)) },
        prosecution: { total: ids.length, gap: ids.filter(id => !prosSet.has(id)).length, ids: ids.filter(id => !prosSet.has(id)) },
        ipr: { total: ids.length, gap: ids.filter(id => !iprSet.has(id)).length, ids: ids.filter(id => !iprSet.has(id)) },
        family: { total: ids.length, gap: ids.filter(id => !familySet.has(id)).length, ids: ids.filter(id => !familySet.has(id)) },
      };
      console.log(JSON.stringify(result));
    `;

    const result = execSync(`node -e "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
      encoding: 'utf-8',
      cwd: process.cwd(),
    });

    return JSON.parse(result.trim());
  } catch (e) {
    console.error('Failed to analyze gaps:', e);
    return {
      llm: { total: 0, gap: 0, ids: [] },
      prosecution: { total: 0, gap: 0, ids: [] },
      ipr: { total: 0, gap: 0, ids: [] },
      family: { total: 0, gap: 0, ids: [] },
    };
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
router.post('/', (req: Request, res: Response) => {
  try {
    const {
      targetType,
      targetValue,
      coverageTypes = ['llm', 'prosecution', 'ipr', 'family'],
      maxHours = 4
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
    const gaps = analyzeGaps(targetType, targetValue);

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

      // Write batch file with patent IDs
      const batchIds = gapInfo.ids.slice(0, 500); // Process up to 500 at a time
      fs.writeFileSync(batchFile, JSON.stringify(batchIds));

      // Calculate estimated completion
      const rate = DEFAULT_RATES[coverageType];
      const estimatedHours = gapInfo.gap / rate;
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
          total: gapInfo.gap,
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
router.get('/gaps', (req: Request, res: Response) => {
  try {
    const targetType = req.query.targetType as TargetType;
    const targetValue = req.query.targetValue as string;

    if (!targetType || !targetValue) {
      return res.status(400).json({ error: 'targetType and targetValue are required' });
    }

    const gaps = analyzeGaps(targetType, targetValue);

    res.json({
      targetType,
      targetValue,
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
