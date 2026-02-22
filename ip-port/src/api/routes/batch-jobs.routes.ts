import { Router, Request, Response } from 'express';
import { exec, spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { invalidateEnrichmentCache } from './patents.routes.js';

// Export for use by enrichment endpoints that need fresh data
export { syncEnrichmentFlags };
import { clearScoringCache } from '../services/scoring-service.js';
import { enrichPatentCpcBatch } from '../services/patent-xml-parser-service.js';

const prisma = new PrismaClient();

const router = Router();

// Track if we've invalidated caches since last job completion detection
let lastCacheInvalidation = 0;

// Coverage types that can be run independently
type CoverageType = 'llm' | 'prosecution' | 'ipr' | 'family' | 'xml' | 'citing';
type TargetType = 'tier' | 'super-sector' | 'sector';

// API response shape (matches frontend BatchJob interface)
interface BatchJobResponse {
  id: string;
  groupId?: string;
  targetType: string;
  targetValue: string;
  coverageType: string;
  status: string;
  pid?: number | null;
  startedAt?: string;
  completedAt?: string;
  logFile?: string | null;
  error?: string | null;
  progress?: { total: number; completed: number };
  estimatedRate?: number | null;
  actualRate?: number | null;
  estimatedCompletion?: string;
  model?: string | null;
  batchMode?: boolean | null;
  portfolioId?: string | null;
  portfolioName?: string | null;
  useClaims?: boolean;
}

// Default rate estimates (patents per hour) - will be refined over time
const DEFAULT_RATES: Record<CoverageType, number> = {
  llm: 150, // ~5 patents per batch, ~20 sec/batch = 150/hour (conservative)
  prosecution: 600,
  ipr: 600,
  family: 500,
  xml: 2000, // Local disk extraction, very fast
  citing: 300, // PatentsView API calls for citing patent details
};

// Map DB record to API response format
function toResponse(job: any): BatchJobResponse {
  return {
    id: job.id,
    groupId: job.groupId || undefined,
    targetType: job.targetType,
    targetValue: job.targetValue,
    coverageType: job.coverageType,
    status: job.status,
    pid: job.pid,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    logFile: job.logFile,
    error: job.error,
    progress: { total: job.totalPatents, completed: job.completedPatents },
    estimatedRate: job.estimatedRate,
    actualRate: job.actualRate,
    estimatedCompletion: job.estimatedCompletion?.toISOString(),
    model: job.model,
    batchMode: job.batchMode,
    portfolioId: job.portfolioId,
    portfolioName: job.portfolioName,
    useClaims: job.useClaims,
  };
}

/**
 * Sync Postgres hasLlmData/hasProsecutionData flags from file cache.
 * Called after batch jobs complete so the enrichment summary reads correct values.
 */
async function syncEnrichmentFlags(): Promise<void> {
  const llmDir = path.join(process.cwd(), 'cache/llm-scores');
  const prosDir = path.join(process.cwd(), 'cache/prosecution-scores');
  const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '';

  const llmSet = fs.existsSync(llmDir)
    ? new Set(fs.readdirSync(llmDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')))
    : new Set<string>();
  const prosSet = fs.existsSync(prosDir)
    ? new Set(fs.readdirSync(prosDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')))
    : new Set<string>();

  // Build XML set: files like US10002051.xml → "10002051", US09959345.xml → "9959345"
  const xmlSet = new Set<string>();
  if (xmlDir && fs.existsSync(xmlDir)) {
    for (const f of fs.readdirSync(xmlDir)) {
      if (f.startsWith('US') && f.endsWith('.xml')) {
        const raw = f.replace(/^US/, '').replace(/\.xml$/, '');
        xmlSet.add(raw.replace(/^0+/, '') || raw); // Strip leading zeros to match DB patent IDs
      }
    }
  }

  // Find patents where any flag is false but cache file exists
  const stale = await prisma.patent.findMany({
    where: {
      OR: [
        { hasLlmData: false },
        { hasProsecutionData: false },
        { hasXmlData: false },
      ],
    },
    select: { patentId: true, hasLlmData: true, hasProsecutionData: true, hasXmlData: true },
  });

  let llmUpdated = 0;
  let prosUpdated = 0;
  let xmlUpdated = 0;

  for (const p of stale) {
    const updates: Record<string, boolean> = {};
    if (!p.hasLlmData && llmSet.has(p.patentId)) {
      updates.hasLlmData = true;
      llmUpdated++;
    }
    if (!p.hasProsecutionData && prosSet.has(p.patentId)) {
      updates.hasProsecutionData = true;
      prosUpdated++;
    }
    if (!p.hasXmlData && xmlSet.has(p.patentId)) {
      updates.hasXmlData = true;
      xmlUpdated++;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.patent.update({
        where: { patentId: p.patentId },
        data: updates,
      });
    }
  }

  if (llmUpdated > 0 || prosUpdated > 0 || xmlUpdated > 0) {
    console.log(`[BatchJobs] Synced enrichment flags: ${llmUpdated} LLM, ${prosUpdated} prosecution, ${xmlUpdated} XML`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Field definitions for LLM score import (matches migrate-patents-to-postgres.ts)
// ─────────────────────────────────────────────────────────────────────────────

const RATING_FIELDS = [
  'eligibility_score', 'validity_score', 'claim_breadth', 'claim_clarity_score',
  'enforcement_clarity', 'design_around_difficulty', 'evidence_accessibility_score',
  'market_relevance_score', 'trend_alignment_score', 'investigation_priority_score',
  'confidence',
];

const TEXT_FIELDS = [
  'technology_category', 'implementation_type', 'standards_relevance',
  'market_segment', 'detection_method', 'implementation_complexity',
  'claim_type_primary', 'geographic_scope', 'lifecycle_stage',
];

const LONG_TEXT_FIELDS = [
  'summary', 'prior_art_problem', 'technical_solution',
];

const FLOAT_FIELDS = [
  'legal_viability_score', 'enforcement_potential_score', 'market_value_score',
];

const DISPLAY_NAMES: Record<string, string> = {
  eligibility_score: 'Eligibility Score',
  validity_score: 'Validity Score',
  claim_breadth: 'Claim Breadth',
  claim_clarity_score: 'Claim Clarity',
  enforcement_clarity: 'Enforcement Clarity',
  design_around_difficulty: 'Design-Around Difficulty',
  evidence_accessibility_score: 'Evidence Accessibility',
  market_relevance_score: 'Market Relevance',
  trend_alignment_score: 'Trend Alignment',
  investigation_priority_score: 'Investigation Priority',
  confidence: 'Confidence',
  technology_category: 'Technology Category',
  implementation_type: 'Implementation Type',
  standards_relevance: 'Standards Relevance',
  market_segment: 'Market Segment',
  detection_method: 'Detection Method',
  implementation_complexity: 'Implementation Complexity',
  claim_type_primary: 'Claim Type (Primary)',
  geographic_scope: 'Geographic Scope',
  lifecycle_stage: 'Lifecycle Stage',
  summary: 'LLM Summary',
  prior_art_problem: 'Prior Art Problem',
  technical_solution: 'Technical Solution',
  legal_viability_score: 'Legal Viability Score',
  enforcement_potential_score: 'Enforcement Potential Score',
  market_value_score: 'Market Value Score',
};

/**
 * Sync LLM score data from cache/llm-scores/ into the patent_scores EAV table.
 * Only processes patents that have hasLlmData=true but no patent_scores rows.
 * This bridges the gap between the file-based LLM analysis pipeline and the
 * DB-backed patent data service.
 */
async function syncLlmScoresToDb(): Promise<{ imported: number; skipped: number; errors: number }> {
  const llmDir = path.join(process.cwd(), 'cache/llm-scores');
  if (!fs.existsSync(llmDir)) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Find patents with hasLlmData=true but no patent_scores rows
  const patentsNeedingSync = await prisma.$queryRaw<Array<{ patent_id: string }>>`
    SELECT p.patent_id
    FROM patents p
    WHERE p.has_llm_data = true
      AND NOT EXISTS (
        SELECT 1 FROM patent_scores ps
        WHERE ps.patent_id = p.patent_id
      )
  `;

  if (patentsNeedingSync.length === 0) {
    return { imported: 0, skipped: 0, errors: 0 };
  }

  console.log(`[BatchJobs] Syncing LLM scores to DB for ${patentsNeedingSync.length} patents...`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < patentsNeedingSync.length; i += BATCH_SIZE) {
    const batch = patentsNeedingSync.slice(i, i + BATCH_SIZE);
    const ops: any[] = [];

    for (const { patent_id: pid } of batch) {
      const cacheFile = path.join(llmDir, `${pid}.json`);
      if (!fs.existsSync(cacheFile)) {
        skipped++;
        continue;
      }

      let data: any;
      try {
        data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      } catch {
        errors++;
        continue;
      }

      const source = data.source || 'imported';

      // Rating fields (integer 1-5)
      for (const field of RATING_FIELDS) {
        if (data[field] != null) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                rating: Math.round(Number(data[field])),
                source,
              },
              update: {
                rating: Math.round(Number(data[field])),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }

      // Text fields
      for (const field of TEXT_FIELDS) {
        if (data[field]) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                textValue: String(data[field]),
                source,
              },
              update: {
                textValue: String(data[field]),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }

      // Long text fields (stored as reasoning)
      for (const field of LONG_TEXT_FIELDS) {
        if (data[field]) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                reasoning: String(data[field]),
                source,
              },
              update: {
                reasoning: String(data[field]),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }

      // Float fields (computed sub-scores)
      for (const field of FLOAT_FIELDS) {
        if (data[field] != null) {
          ops.push(
            prisma.patentScore.upsert({
              where: { patentId_fieldName: { patentId: pid, fieldName: field } },
              create: {
                patentId: pid,
                fieldName: field,
                displayName: DISPLAY_NAMES[field] || field,
                floatValue: Number(data[field]),
                source,
              },
              update: {
                floatValue: Number(data[field]),
                displayName: DISPLAY_NAMES[field] || field,
              },
            })
          );
        }
      }
    }

    if (ops.length > 0) {
      // Split into transaction chunks to avoid OOM
      const TX_LIMIT = 500;
      for (let j = 0; j < ops.length; j += TX_LIMIT) {
        await prisma.$transaction(ops.slice(j, j + TX_LIMIT));
      }
      imported += batch.length - skipped - errors;
    }

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= patentsNeedingSync.length) {
      console.log(`[BatchJobs] LLM score sync progress: ${Math.min(i + BATCH_SIZE, patentsNeedingSync.length)}/${patentsNeedingSync.length}`);
    }
  }

  console.log(`[BatchJobs] LLM score sync complete: ${imported} imported, ${skipped} skipped (no cache file), ${errors} errors`);
  return { imported, skipped, errors };
}

/**
 * Auto-create a ScoreSnapshot when a large LLM batch job completes.
 * Snapshots are created with isActive=false and autoGenerated flag.
 */
async function createAutoSnapshot(job: BatchJobResponse): Promise<void> {
  const patentCount = job.progress?.total ?? 0;
  if (patentCount < 50) return;

  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const sectorSlug = (job.targetValue || 'unknown').toLowerCase().replace(/[^a-z0-9]/g, '-');
  const modelLabel = job.model
    ? (job.model.includes('haiku') ? 'haiku' : job.model.includes('opus') ? 'opus' : 'sonnet4')
    : 'sonnet4';
  const snapshotName = `auto-${sectorSlug}-${modelLabel}-${dateStr}`;

  // Check if this auto-snapshot already exists
  const existing = await prisma.scoreSnapshot.findFirst({
    where: { name: snapshotName },
  });
  if (existing) return;

  await prisma.scoreSnapshot.create({
    data: {
      name: snapshotName,
      description: `Auto-generated after LLM batch job (${patentCount} patents, ${job.targetType}: ${job.targetValue})`,
      scoreType: 'LLM',
      config: {
        autoGenerated: true,
        model: job.model || 'claude-sonnet-4-20250514',
        batchMode: job.batchMode ?? true,
        patentCount,
        targetType: job.targetType,
        targetValue: job.targetValue,
        jobId: job.id,
      },
      isActive: false,
      patentCount,
    },
  });

  console.log(`[BatchJobs] Auto-snapshot created: ${snapshotName}`);
}

// Parse tier range - handles both "500" (legacy) and "501-1000" (range) formats
// Returns { skip, take } for proper partitioning
function parseTierRange(targetValue: string): { skip: number; take: number } {
  if (targetValue.includes('-')) {
    // Range format: "501-1000" → skip 500, take 500
    const parts = targetValue.split('-').map(s => parseInt(s.replace(/,/g, '')));
    const start = parts[0] || 1;
    const end = parts[1] || parts[0] || 500;
    return { skip: start - 1, take: end - start + 1 };
  }
  // Legacy format: "500" → skip 0, take 500
  const take = parseInt(targetValue.replace(/,/g, '')) || 500;
  return { skip: 0, take };
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
    xml: { total: 0, gap: 0, ids: [] as string[] },
    citing: { total: 0, gap: 0, ids: [] as string[] },
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
    // For 'tier', we partition by skip/take from the range

    // Determine skip + take for pagination
    let skip = 0;
    let take: number | undefined;
    if (targetType === 'tier') {
      const range = parseTierRange(targetValue);
      skip = range.skip;
      take = range.take;
    } else if (topN > 0) {
      take = topN;
    }

    // Order by baseScore when available, fall back to grantDate desc (most recent first)
    const patents = await prisma.patent.findMany({
      where,
      select: {
        patentId: true,
        grantDate: true,
        hasLlmData: true,
        hasProsecutionData: true,
        hasXmlData: true,
        hasCitationData: true,
        forwardCitations: true,
        isQuarantined: true,
        quarantine: true,
      },
      orderBy: [{ baseScore: 'desc' }, { grantDate: 'desc' }],
      ...(skip > 0 ? { skip } : {}),
      ...(take ? { take } : {}),
    });

    const ids = patents.map(p => p.patentId);

    // LLM, prosecution, and XML gaps come from Postgres flags
    // LLM gap: use quarantine to exclude LLM-ineligible patents (no abstract, no sector)
    const llmEligible = patents.filter(p => !(p.quarantine as any)?.llm);
    const llmGapIds = llmEligible.filter(p => !p.hasLlmData).map(p => p.patentId);
    const prosGapIds = patents.filter(p => !p.hasProsecutionData).map(p => p.patentId);
    // XML gap: use quarantine to exclude ineligible patents
    const xmlEligible = patents.filter(p => !(p.quarantine as any)?.xml);
    const xmlGapIds = xmlEligible.filter(p => !p.hasXmlData).map(p => p.patentId);

    // IPR, family, and citing gaps use file-based cache
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
    const citingSet = getCacheSet('cache/api/patentsview/citing-patent-details');

    const iprGapIds = ids.filter(id => !iprSet.has(id));
    const familyGapIds = ids.filter(id => !familySet.has(id));
    const citingGapIds = ids.filter(id => !citingSet.has(id));

    const quarantineCounts = {
      total: patents.filter(p => p.isQuarantined).length,
      xml: patents.filter(p => (p.quarantine as any)?.xml).length,
      llm: patents.filter(p => (p.quarantine as any)?.llm).length,
    };

    return {
      llm: { total: llmEligible.length, gap: llmGapIds.length, ids: llmGapIds },
      prosecution: { total: ids.length, gap: prosGapIds.length, ids: prosGapIds },
      ipr: { total: ids.length, gap: iprGapIds.length, ids: iprGapIds },
      family: { total: ids.length, gap: familyGapIds.length, ids: familyGapIds },
      xml: { total: xmlEligible.length, gap: xmlGapIds.length, ids: xmlGapIds },
      citing: { total: ids.length, gap: citingGapIds.length, ids: citingGapIds },
      quarantineCounts,
    };
  } catch (e) {
    console.error('Failed to analyze gaps:', e);
    return empty;
  }
}

// Get script command for a coverage type
function getEnrichmentCommand(
  coverageType: CoverageType,
  batchFile: string,
  logFile: string,
  options?: { model?: string; batchMode?: boolean }
): string {
  switch (coverageType) {
    case 'llm': {
      let cmd = `npx tsx scripts/run-llm-analysis-v3.ts ${batchFile} > ${logFile} 2>&1`;
      // Prepend environment variables for model and realtime mode
      const envVars: string[] = [];
      if (options?.model) envVars.push(`LLM_MODEL=${options.model}`);
      if (options?.batchMode === false) envVars.push('LLM_REALTIME=1');
      if (envVars.length > 0) cmd = `${envVars.join(' ')} ${cmd}`;
      return cmd;
    }
    case 'prosecution':
      return `npx tsx scripts/check-prosecution-history.ts ${batchFile} > ${logFile} 2>&1`;
    case 'ipr':
      return `npx tsx scripts/check-ipr-risk.ts ${batchFile} > ${logFile} 2>&1`;
    case 'family':
      // Family script uses comma-separated IDs
      return `npx tsx scripts/enrich-citations.ts --patent-ids "$(cat ${batchFile} | jq -r '.[]' | tr '\\n' ',' | sed 's/,$//')" > ${logFile} 2>&1`;
    case 'xml':
      return `npx tsx scripts/extract-patent-xmls-batch.ts ${batchFile} > ${logFile} 2>&1`;
    default:
      throw new Error(`Unknown coverage type: ${coverageType}`);
  }
}

// Detect running enrichment processes
function detectRunningProcesses(): Array<{ pid: number; type: string; cmd: string }> {
  try {
    const result = execSync(
      'ps aux | grep -E "run-llm-analysis|check-prosecution|check-ipr|enrich-citations|extract-patent-xmls" | grep -v grep',
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
      else if (line.includes('extract-patent-xmls')) type = 'xml';
      return { pid, type, cmd: parts.slice(10).join(' ') };
    });
  } catch {
    return [];
  }
}

/**
 * Parse the last progress line from a job's log file.
 * Supports formats:
 *   - "Progress: 25/100 (25%)"
 *   - "  Progress: 25/100 (25%)"
 *   - "Progress: 25/100 | ..."
 * Returns { completed, total } or null if no progress found.
 */
function parseLogProgress(logFile: string): { completed: number; total: number } | null {
  try {
    if (!fs.existsSync(logFile)) return null;

    // Read last 4KB of the file (enough to find the latest progress line)
    const stat = fs.statSync(logFile);
    const readSize = Math.min(stat.size, 4096);
    const fd = fs.openSync(logFile, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stat.size - readSize));
    fs.closeSync(fd);

    const text = buffer.toString('utf-8');
    const lines = text.split('\n').reverse();

    for (const line of lines) {
      const match = line.match(/Progress:\s*(\d+)\s*\/\s*(\d+)/);
      if (match) {
        return { completed: parseInt(match[1]), total: parseInt(match[2]) };
      }
    }
  } catch {
    // Non-fatal
  }
  return null;
}

/**
 * On startup, check for any jobs marked as "running" in the DB whose PIDs no longer exist.
 * Mark them as completed (they finished while server was down).
 */
async function reconcileJobsOnStartup(): Promise<void> {
  try {
    const runningJobs = await prisma.batchJob.findMany({
      where: { status: 'running' },
    });

    if (runningJobs.length === 0) return;

    const runningProcesses = detectRunningProcesses();

    for (const job of runningJobs) {
      if (job.pid) {
        const stillRunning = runningProcesses.some(p => p.pid === job.pid);
        if (!stillRunning) {
          const startTime = job.startedAt?.getTime() ?? Date.now();
          const hours = (Date.now() - startTime) / 3600000;
          const actualRate = hours > 0 ? Math.round(job.totalPatents / hours) : 0;

          await prisma.batchJob.update({
            where: { id: job.id },
            data: {
              status: 'completed',
              completedAt: new Date(),
              actualRate,
            },
          });
          console.log(`[BatchJobs] Reconciled stale job ${job.id} (${job.coverageType}) → completed`);
        }
      }
    }
  } catch (e) {
    console.error('[BatchJobs] Failed to reconcile jobs on startup:', e);
  }
}

// Initialize — reconcile any stale "running" jobs
reconcileJobsOnStartup();

/**
 * GET /api/batch-jobs
 * List all batch jobs (recent + running)
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // Get jobs from last 7 days + any active ones
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dbJobs = await prisma.batchJob.findMany({
      where: {
        OR: [
          { createdAt: { gte: cutoff } },
          { status: { in: ['running', 'pending'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Check running jobs against OS processes
    const runningProcesses = detectRunningProcesses();
    let jobsJustCompleted = false;

    for (const job of dbJobs) {
      if (job.status === 'running' && job.pid) {
        const stillRunning = runningProcesses.some(p => p.pid === job.pid);
        if (!stillRunning) {
          // Job finished — get final progress from log, then mark completed
          const finalProgress = job.logFile ? parseLogProgress(job.logFile) : null;
          const completedPatents = finalProgress?.completed ?? job.totalPatents;
          const startTime = job.startedAt?.getTime() ?? Date.now();
          const hours = (Date.now() - startTime) / 3600000;
          const actualRate = hours > 0 ? Math.round(completedPatents / hours) : 0;

          await prisma.batchJob.update({
            where: { id: job.id },
            data: {
              status: 'completed',
              completedAt: new Date(),
              completedPatents,
              actualRate,
            },
          });
          job.status = 'completed';
          job.completedAt = new Date();
          job.completedPatents = completedPatents;
          job.actualRate = actualRate;
          jobsJustCompleted = true;
        } else if (job.logFile) {
          // Still running — parse log for live progress update
          const progress = parseLogProgress(job.logFile);
          if (progress && progress.completed > job.completedPatents) {
            // Update DB and in-memory object with latest progress
            const startTime = job.startedAt?.getTime() ?? Date.now();
            const elapsedHours = (Date.now() - startTime) / 3600000;
            const currentRate = elapsedHours > 0 ? progress.completed / elapsedHours : job.estimatedRate ?? 0;
            const remaining = (progress.total || job.totalPatents) - progress.completed;
            const etaMs = currentRate > 0 ? (remaining / currentRate) * 3600000 : 0;

            await prisma.batchJob.update({
              where: { id: job.id },
              data: {
                completedPatents: progress.completed,
                actualRate: Math.round(currentRate),
                estimatedCompletion: etaMs > 0 ? new Date(Date.now() + etaMs) : null,
              },
            });
            job.completedPatents = progress.completed;
            job.actualRate = Math.round(currentRate);
            job.estimatedCompletion = etaMs > 0 ? new Date(Date.now() + etaMs) : null;
          }
        }
      }
    }

    // Invalidate caches and sync Postgres flags when jobs complete (throttled to once per 10 seconds)
    const now = Date.now();
    if (jobsJustCompleted && now - lastCacheInvalidation > 10000) {
      console.log('[BatchJobs] Jobs completed - invalidating enrichment and scoring caches');
      invalidateEnrichmentCache();
      clearScoringCache();
      lastCacheInvalidation = now;

      // Sync Postgres hasLlmData/hasProsecutionData flags from file cache
      syncEnrichmentFlags().catch(err =>
        console.error('[BatchJobs] Failed to sync enrichment flags:', err)
      );

      // Sync LLM score data from cache files into patent_scores EAV table
      syncLlmScoresToDb().catch(err =>
        console.error('[BatchJobs] Failed to sync LLM scores to DB:', err)
      );

      // Auto-snapshot for large completed LLM jobs
      const justCompletedLlm = dbJobs.filter(j =>
        j.status === 'completed' &&
        j.coverageType === 'llm' &&
        j.totalPatents >= 50
      );
      for (const job of justCompletedLlm) {
        createAutoSnapshot(toResponse(job)).catch(err =>
          console.error('[BatchJobs] Failed to create auto-snapshot:', err)
        );
      }
    }

    const responseJobs = dbJobs.map(toResponse);

    // Stats
    const stats = {
      pending: responseJobs.filter(j => j.status === 'pending').length,
      running: responseJobs.filter(j => j.status === 'running').length,
      completed: responseJobs.filter(j => j.status === 'completed').length,
      failed: responseJobs.filter(j => j.status === 'failed').length,
    };

    res.json({ jobs: responseJobs, stats });
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
      useClaims = false,  // When true, LLM jobs require XML data to be available
      model,       // Optional: LLM model override (e.g., 'claude-sonnet-4-20250514')
      batchMode,   // Optional: true = Batch API (50% off, ~24h), false = realtime
    } = req.body;

    if (!targetType || !['tier', 'super-sector', 'sector'].includes(targetType)) {
      return res.status(400).json({ error: 'Invalid targetType. Must be tier, super-sector, or sector' });
    }

    if (!targetValue) {
      return res.status(400).json({ error: 'targetValue is required' });
    }

    // Validate coverage types (citing is analysis-only, not a runnable job type)
    const validTypes: CoverageType[] = ['llm', 'prosecution', 'ipr', 'family', 'xml'];
    const selectedTypes = coverageTypes.filter((t: string) => validTypes.includes(t as CoverageType)) as CoverageType[];

    if (selectedTypes.length === 0) {
      return res.status(400).json({ error: 'At least one valid coverageType is required' });
    }

    // Analyze gaps to determine what needs to be done
    // For super-sector/sector, topN limits analysis to top N patents by score
    const gaps = await analyzeGaps(targetType, targetValue, topN, portfolioId);

    // Claims-gate: filter LLM gap to only patents WITH XML data (claims available)
    // If no LLM-eligible patents have XML yet, skip LLM silently — XML extraction
    // will run in parallel and LLM can be resubmitted once XML data is available.
    let claimsSkipped = 0;
    let llmDeferred = false;
    if (selectedTypes.includes('llm')) {
      const llmGapIds = gaps.llm.ids;
      const patentsWithXml = await prisma.patent.findMany({
        where: { patentId: { in: llmGapIds }, hasXmlData: true },
        select: { patentId: true },
      });
      const withXmlSet = new Set(patentsWithXml.map(p => p.patentId));
      const withXml = llmGapIds.filter(id => withXmlSet.has(id));
      claimsSkipped = llmGapIds.length - withXml.length;

      if (withXml.length === 0 && claimsSkipped > 0) {
        // No patents have XML yet — skip LLM, let other job types proceed
        console.log(`[BatchJobs] Claims-gate: deferring LLM — all ${claimsSkipped} patents missing XML. Other job types will proceed.`);
        const llmIdx = selectedTypes.indexOf('llm');
        if (llmIdx !== -1) selectedTypes.splice(llmIdx, 1);
        llmDeferred = true;
        if (selectedTypes.length === 0) {
          return res.status(200).json({
            groupId: `group-${Date.now()}`,
            jobs: [],
            llmDeferred: true,
            llmDeferredCount: claimsSkipped,
            message: `LLM scoring deferred: all ${claimsSkipped} patents need XML extraction first.`,
          });
        }
      } else {
        // Some patents have XML — run LLM on those, skip the rest
        gaps.llm.ids = withXml;
        gaps.llm.gap = withXml.length;
        if (claimsSkipped > 0) {
          console.log(`[BatchJobs] Claims-gate: running LLM on ${withXml.length} patents with XML, skipping ${claimsSkipped} without XML`);
        }
      }
    }

    // Resolve portfolio name for display
    let portfolioName: string | undefined;
    if (portfolioId) {
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: portfolioId },
        select: { name: true, displayName: true },
      });
      portfolioName = portfolio?.displayName || portfolio?.name || undefined;
    }

    // Create a group ID to link related jobs
    const groupId = `group-${Date.now()}`;
    const createdJobs: BatchJobResponse[] = [];

    const MAX_BATCH_SIZE = 500;
    const logsDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });

    for (const coverageType of selectedTypes) {
      const gapInfo = gaps[coverageType];

      if (gapInfo.gap === 0) {
        // No gap for this type, skip
        continue;
      }

      // Auto-split into chunks of MAX_BATCH_SIZE
      const allIds = gapInfo.ids;
      const chunkCount = Math.ceil(allIds.length / MAX_BATCH_SIZE);

      for (let chunkIdx = 0; chunkIdx < chunkCount; chunkIdx++) {
        const chunkStart = chunkIdx * MAX_BATCH_SIZE;
        const batchIds = allIds.slice(chunkStart, chunkStart + MAX_BATCH_SIZE);
        const actualBatchSize = batchIds.length;

        const batchFile = `/tmp/batch-${Date.now()}-${Math.random().toString(36).substr(2, 5)}.json`;
        const logFile = path.join(logsDir, `job-${Date.now()}-${Math.random().toString(36).substr(2, 3)}.log`);

        fs.writeFileSync(batchFile, JSON.stringify(batchIds));

        // Calculate estimated completion
        const rate = DEFAULT_RATES[coverageType];
        const estimatedHours = actualBatchSize / rate;
        const estimatedCompletion = new Date(Date.now() + estimatedHours * 3600000);

        // Start the job
        const cmd = getEnrichmentCommand(coverageType, batchFile, logFile,
          coverageType === 'llm' ? { model, batchMode } : undefined
        );
        const child = spawn('bash', ['-c', cmd], {
          detached: true,
          stdio: 'ignore',
          cwd: process.cwd(),
        });
        child.unref();

        const chunkLabel = chunkCount > 1 ? ` (${chunkIdx + 1}/${chunkCount})` : '';

        // Persist to DB
        const dbJob = await prisma.batchJob.create({
          data: {
            groupId,
            targetType,
            targetValue: targetValue + chunkLabel,
            coverageType,
            status: 'running',
            pid: child.pid ?? null,
            startedAt: new Date(),
            logFile,
            totalPatents: actualBatchSize,
            completedPatents: 0,
            estimatedRate: rate,
            estimatedCompletion,
            model: coverageType === 'llm' ? (model || null) : null,
            batchMode: coverageType === 'llm' ? (batchMode ?? null) : null,
            useClaims: useClaims || false,
            portfolioId: portfolioId || null,
            portfolioName: portfolioName || null,
          },
        });

        createdJobs.push(toResponse(dbJob));
      }
    }

    res.status(201).json({
      groupId,
      jobs: createdJobs,
      gaps: Object.fromEntries(
        Object.entries(gaps).map(([k, v]) => [k, { total: v.total, gap: v.gap }])
      ),
      ...(claimsSkipped > 0 && { claimsSkipped }),
      ...(llmDeferred && { llmDeferred: true, llmDeferredCount: claimsSkipped }),
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
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const job = await prisma.batchJob.findUnique({ where: { id } });
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

    const updated = await prisma.batchJob.update({
      where: { id },
      data: { status: 'cancelled', completedAt: new Date() },
    });

    res.json({ job: toResponse(updated) });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ error: 'Failed to cancel job' });
  }
});

/**
 * DELETE /api/batch-jobs/group/:groupId
 * Cancel all jobs in a group
 */
router.delete('/group/:groupId', async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    const groupJobs = await prisma.batchJob.findMany({
      where: { groupId, status: 'running' },
    });

    for (const job of groupJobs) {
      if (job.pid) {
        try {
          exec(`pkill -P ${job.pid}; kill ${job.pid}`);
        } catch (e) {
          console.error('Failed to kill process:', e);
        }
      }
    }

    await prisma.batchJob.updateMany({
      where: { groupId, status: 'running' },
      data: { status: 'cancelled', completedAt: new Date() },
    });

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
router.get('/:id/log', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const lines = parseInt(req.query.lines as string) || 50;

    const job = await prisma.batchJob.findUnique({ where: { id } });
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

/**
 * POST /api/batch-jobs/sync-flags
 * Manually sync Postgres enrichment flags from file cache
 */
router.post('/sync-flags', async (req: Request, res: Response) => {
  try {
    await syncEnrichmentFlags();
    invalidateEnrichmentCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error syncing flags:', error);
    res.status(500).json({ error: 'Failed to sync enrichment flags' });
  }
});

/**
 * POST /api/batch-jobs/sync-llm-scores
 * Import LLM analysis data from cache/llm-scores/ into the patent_scores EAV table.
 * Bridges the file-based LLM pipeline with the DB-backed patent data service.
 */
router.post('/sync-llm-scores', async (req: Request, res: Response) => {
  try {
    const result = await syncLlmScoresToDb();
    invalidateEnrichmentCache();
    clearScoringCache();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error syncing LLM scores:', error);
    res.status(500).json({ error: 'Failed to sync LLM scores to database' });
  }
});

/**
 * POST /api/batch-jobs/sync-cpc-designations
 * Backfill CPC inventive designations from existing XML files.
 * For patents with hasXmlData=true, checks if PatentCpc records have
 * isInventive set, and re-enriches from XML if not.
 */
router.post('/sync-cpc-designations', async (req: Request, res: Response) => {
  try {
    const xmlDir = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
    if (!xmlDir) {
      return res.status(400).json({ error: 'USPTO_PATENT_GRANT_XML_DIR not configured' });
    }

    // Find patents with XML data but no inventive CPC records
    const patentsWithXml = await prisma.patent.findMany({
      where: { hasXmlData: true },
      select: {
        patentId: true,
        cpcCodes: {
          where: { isInventive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    // Filter to patents that don't yet have any inventive CPCs
    const needsEnrichment = patentsWithXml
      .filter(p => p.cpcCodes.length === 0)
      .map(p => p.patentId);

    if (needsEnrichment.length === 0) {
      return res.json({
        message: 'All patents with XML data already have CPC designations',
        checked: patentsWithXml.length,
        enriched: 0,
      });
    }

    console.log(`[BatchJobs] Backfilling CPC designations for ${needsEnrichment.length} patents...`);
    const result = await enrichPatentCpcBatch(needsEnrichment, xmlDir, (current, total) => {
      if (current % 500 === 0) {
        console.log(`  CPC backfill: ${current}/${total}`);
      }
    });

    res.json({
      message: `CPC designations backfilled`,
      checked: patentsWithXml.length,
      needsEnrichment: needsEnrichment.length,
      ...result,
    });
  } catch (error) {
    console.error('Error syncing CPC designations:', error);
    res.status(500).json({ error: 'Failed to sync CPC designations' });
  }
});

/**
 * POST /api/batch-jobs/auto-quarantine
 * Auto-detect patents that should be quarantined based on known rules.
 * Sets quarantine JSON detail and isQuarantined flag.
 */
router.post('/auto-quarantine', async (req: Request, res: Response) => {
  try {
    const { portfolioId, dryRun } = req.body || {};

    const where: Record<string, any> = {};
    if (portfolioId) {
      where.portfolios = { some: { portfolioId } };
    }

    const patents = await prisma.patent.findMany({
      where,
      select: {
        patentId: true,
        grantDate: true,
        abstract: true,
        primarySector: true,
        hasXmlData: true,
        isQuarantined: true,
        quarantine: true,
      },
    });

    const updates: Array<{ patentId: string; quarantine: Record<string, string>; reasons: string[] }> = [];

    for (const p of patents) {
      const existing = (p.quarantine as Record<string, string>) || {};
      const newQ = { ...existing };
      const reasons: string[] = [];

      // ── XML quarantine rules ──

      // Design patent (D-prefix)
      if (p.patentId.startsWith('D') && !existing.xml) {
        newQ.xml = 'design-patent';
        reasons.push('design-patent');
      }
      // Reissue patent (RE/H-prefix)
      else if ((p.patentId.startsWith('RE') || p.patentId.startsWith('H')) && !existing.xml) {
        newQ.xml = 'reissue-patent';
        reasons.push('reissue-patent');
      }
      // Pre-2005 grant
      else if (p.grantDate && p.grantDate < '2005-01-01' && !existing.xml) {
        newQ.xml = 'pre-2005';
        reasons.push('pre-2005');
      }
      // Recent, no bulk data available
      else if (!p.hasXmlData && p.grantDate && p.grantDate >= '2024-01-01' && !existing.xml) {
        newQ.xml = 'recent-no-bulk';
        reasons.push('recent-no-bulk');
      }
      // Extraction attempted but patent not found in bulk ZIPs (2005-2023 range)
      // Only apply when scoped to a portfolio (implies extraction has been run for it)
      else if (portfolioId && !p.hasXmlData && p.grantDate && p.grantDate >= '2005-01-01' && p.grantDate < '2024-01-01' && !existing.xml) {
        newQ.xml = 'extraction-failed';
        reasons.push('extraction-failed');
      }

      // ── LLM readiness quarantine rules ──

      // No abstract available (patent not hydrated from PatentsView)
      if (!p.abstract && !existing.llm) {
        newQ.llm = 'no-abstract';
        reasons.push('no-abstract');
      }
      // No sector assigned (can't select scoring template)
      else if (!p.primarySector && !existing.llm) {
        newQ.llm = 'no-sector';
        reasons.push('no-sector');
      }

      if (reasons.length > 0) {
        updates.push({ patentId: p.patentId, quarantine: newQ, reasons });
      }
    }

    const summary: Record<string, number> = {};
    for (const u of updates) {
      for (const r of u.reasons) {
        summary[r] = (summary[r] || 0) + 1;
      }
    }

    if (dryRun) {
      return res.json({
        dryRun: true,
        totalScanned: patents.length,
        wouldQuarantine: updates.length,
        summary,
        sampleIds: updates.slice(0, 20).map(u => ({ patentId: u.patentId, reasons: u.reasons })),
      });
    }

    // Apply updates in batches
    let applied = 0;
    for (const u of updates) {
      await prisma.patent.update({
        where: { patentId: u.patentId },
        data: {
          quarantine: u.quarantine,
          isQuarantined: true,
        },
      });
      applied++;
    }

    res.json({
      totalScanned: patents.length,
      quarantined: applied,
      summary,
    });
  } catch (error) {
    console.error('Error in auto-quarantine:', error);
    res.status(500).json({ error: 'Failed to auto-quarantine patents' });
  }
});

export default router;
