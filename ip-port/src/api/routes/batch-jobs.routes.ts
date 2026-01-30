import { Router, Request, Response } from 'express';
import { exec, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

// Track running jobs in memory (would be better in Redis/DB for production)
interface BatchJob {
  id: string;
  type: 'tier' | 'super-sector' | 'sector' | 'queue';
  target: string; // tier topN, sector name, or queue file
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  pid?: number;
  startedAt?: string;
  completedAt?: string;
  progress?: {
    llmGap: number;
    prosGap: number;
    iprGap: number;
    familyGap: number;
  };
  error?: string;
  logFile?: string;
}

// In-memory job store (persisted to file for durability across restarts)
const JOBS_FILE = 'logs/batch-jobs.json';
let batchJobs: BatchJob[] = [];

// Load jobs from file on startup
function loadJobs(): void {
  try {
    if (fs.existsSync(JOBS_FILE)) {
      batchJobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
      // Mark any "running" jobs as "unknown" since we lost track
      batchJobs = batchJobs.map(j => ({
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

// Check for running enrichment processes
function detectRunningJobs(): BatchJob | null {
  try {
    const result = require('child_process').execSync(
      'ps aux | grep -E "run-auto-enrichment|run-llm-analysis" | grep -v grep',
      { encoding: 'utf-8' }
    );

    if (result.trim()) {
      const lines = result.trim().split('\n');
      // Parse the first line for PID and command
      for (const line of lines) {
        if (line.includes('run-auto-enrichment.sh')) {
          const parts = line.split(/\s+/);
          const pid = parseInt(parts[1]);

          // Detect job type from command line
          let type: BatchJob['type'] = 'tier';
          let target = '6000';

          if (line.includes('--super-sector')) {
            type = 'super-sector';
            const match = line.match(/--super-sector\s+"?([^"]+)"?/);
            target = match?.[1] || 'Unknown';
          } else if (line.includes('--sector')) {
            type = 'sector';
            const match = line.match(/--sector\s+"?([^"]+)"?/);
            target = match?.[1] || 'Unknown';
          } else if (line.includes('--queue')) {
            type = 'queue';
            target = 'queue file';
          } else {
            // Tier-based: extract topN from args
            const match = line.match(/run-auto-enrichment\.sh\s+(\d+)/);
            target = match?.[1] || '6000';
          }

          return {
            id: `running-${pid}`,
            type,
            target,
            status: 'running',
            pid,
            startedAt: new Date().toISOString(),
          };
        }
      }
    }
    return null;
  } catch (e) {
    return null;
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
    // Check for any running jobs not in our list
    const runningDetected = detectRunningJobs();

    // Get jobs from last 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let recentJobs = batchJobs.filter(j =>
      (j.startedAt && j.startedAt > cutoff) || j.status === 'running' || j.status === 'pending'
    );

    // If we detected a running job not in our list, add it
    if (runningDetected && !recentJobs.find(j => j.pid === runningDetected.pid)) {
      recentJobs = [runningDetected, ...recentJobs];
    }

    // Update status of jobs that claim to be running but aren't
    recentJobs = recentJobs.map(j => {
      if (j.status === 'running' && j.pid) {
        try {
          process.kill(j.pid, 0); // Check if process exists
          return j;
        } catch {
          return { ...j, status: 'completed' as const, completedAt: new Date().toISOString() };
        }
      }
      return j;
    });

    // Stats
    const stats = {
      pending: recentJobs.filter(j => j.status === 'pending').length,
      running: recentJobs.filter(j => j.status === 'running').length,
      completed: recentJobs.filter(j => j.status === 'completed').length,
      failed: recentJobs.filter(j => j.status === 'failed').length,
    };

    res.json({
      jobs: recentJobs.slice(0, 50), // Last 50
      stats,
    });
  } catch (error) {
    console.error('Error listing batch jobs:', error);
    res.status(500).json({ error: 'Failed to list batch jobs' });
  }
});

/**
 * POST /api/batch-jobs
 * Start a new batch enrichment job
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { type, target, maxHours = 4 } = req.body;

    if (!type || !['tier', 'super-sector', 'sector'].includes(type)) {
      return res.status(400).json({ error: 'Invalid job type. Must be tier, super-sector, or sector' });
    }

    // Check if another job is already running
    const running = detectRunningJobs();
    if (running) {
      return res.status(409).json({
        error: 'Another batch job is already running',
        runningJob: running
      });
    }

    const jobId = `job-${Date.now()}`;
    const logFile = `logs/batch-${jobId}.log`;

    // Build command
    let cmd: string;
    if (type === 'tier') {
      cmd = `./scripts/run-auto-enrichment.sh ${target || 6000} ${maxHours}`;
    } else if (type === 'super-sector') {
      cmd = `./scripts/run-auto-enrichment.sh --super-sector "${target}" ${maxHours}`;
    } else {
      cmd = `./scripts/run-auto-enrichment.sh --sector "${target}" ${maxHours}`;
    }

    // Start the job
    const child = spawn('bash', ['-c', `${cmd} > ${logFile} 2>&1`], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    });
    child.unref();

    const job: BatchJob = {
      id: jobId,
      type,
      target: target || '6000',
      status: 'running',
      pid: child.pid,
      startedAt: new Date().toISOString(),
      logFile,
    };

    batchJobs.unshift(job);
    saveJobs();

    res.status(201).json({ job });
  } catch (error) {
    console.error('Error starting batch job:', error);
    res.status(500).json({ error: 'Failed to start batch job' });
  }
});

/**
 * DELETE /api/batch-jobs/:id
 * Cancel/stop a running batch job
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

    // Kill the process tree
    if (job.pid) {
      try {
        // Kill process group
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
    console.error('Error cancelling batch job:', error);
    res.status(500).json({ error: 'Failed to cancel batch job' });
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

    if (!job.logFile || !fs.existsSync(job.logFile)) {
      return res.json({ log: 'Log file not available' });
    }

    // Read last N lines
    const content = fs.readFileSync(job.logFile, 'utf-8');
    const allLines = content.split('\n');
    const lastLines = allLines.slice(-lines).join('\n');

    res.json({ log: lastLines });
  } catch (error) {
    console.error('Error reading job log:', error);
    res.status(500).json({ error: 'Failed to read job log' });
  }
});

/**
 * POST /api/batch-jobs/queue
 * Queue multiple jobs to run in sequence
 */
router.post('/queue', (req: Request, res: Response) => {
  try {
    const { jobs: queuedJobs } = req.body;

    if (!Array.isArray(queuedJobs) || queuedJobs.length === 0) {
      return res.status(400).json({ error: 'Must provide an array of jobs to queue' });
    }

    // Check if another job is already running
    const running = detectRunningJobs();
    if (running) {
      return res.status(409).json({
        error: 'Another batch job is already running',
        runningJob: running
      });
    }

    // Write queue file
    const queueFile = `config/enrichment-queue-${Date.now()}.json`;
    const queueConfig = queuedJobs.map(j => ({
      mode: j.type,
      name: j.type !== 'tier' ? j.target : undefined,
      topN: j.type === 'tier' ? parseInt(j.target) || 6000 : undefined,
      maxHours: j.maxHours || 2,
    }));
    fs.writeFileSync(queueFile, JSON.stringify(queueConfig, null, 2));

    const jobId = `queue-${Date.now()}`;
    const logFile = `logs/batch-${jobId}.log`;

    // Start queue job
    const cmd = `./scripts/run-auto-enrichment.sh --queue ${queueFile}`;
    const child = spawn('bash', ['-c', `${cmd} > ${logFile} 2>&1`], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
    });
    child.unref();

    const job: BatchJob = {
      id: jobId,
      type: 'queue',
      target: `${queuedJobs.length} jobs`,
      status: 'running',
      pid: child.pid,
      startedAt: new Date().toISOString(),
      logFile,
    };

    batchJobs.unshift(job);
    saveJobs();

    res.status(201).json({ job, queueFile });
  } catch (error) {
    console.error('Error starting queue:', error);
    res.status(500).json({ error: 'Failed to start job queue' });
  }
});

export default router;
