/**
 * LLM Workflow Engine Service
 *
 * DAG-based execution engine for multi-stage LLM workflows.
 * Supports tournament, two-stage, chained, and custom patterns.
 *
 * Core responsibilities:
 * - Workflow CRUD (create, get status, cancel)
 * - DAG planning (create jobs with dependencies)
 * - Dependency resolution (find ready jobs)
 * - Job execution (delegate to template service's callLlm)
 * - Tournament factory (plan multi-round DAGs from config)
 */

import { PrismaClient } from '@prisma/client';
import {
  callLlm,
  loadEnrichedPatents,
  buildPromptForTemplate,
  parseStructuredResponse,
  SYSTEM_MESSAGE_FREE_FORM,
  SYSTEM_MESSAGE_STRUCTURED,
  DEFAULT_DELIMITER_START,
  DEFAULT_DELIMITER_END,
} from './prompt-template-service.js';
import type { PatentData, StructuredQuestion } from './prompt-template-service.js';

const prisma = new PrismaClient();

const RATE_LIMIT_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkflowConfig {
  name: string;
  description?: string;
  workflowType: string; // "tournament", "two_stage", "chained", "custom"
  scopeType: string;    // "focus_area", "sector", "super_sector", "portfolio"
  scopeId?: string;
  config?: Record<string, unknown>;
}

export interface TournamentRoundConfig {
  templateId: string;
  topN: number;                // How many advance from each cluster
  sortScoreField: string;      // Which result field to rank by (e.g. "relevance_score")
}

export interface TournamentConfig {
  rounds: TournamentRoundConfig[];
  initialClusterStrategy: 'score' | 'sector' | 'random';
  clusterSizeTarget?: number;  // Per-cluster patent count (auto-calculated if absent)
  synthesisTemplateId?: string; // Optional final synthesis template
}

export interface JobSpec {
  templateId: string;
  targetType: string;     // "patent", "patent_group", "summary_group"
  targetIds: string[];
  targetData?: Record<string, unknown>;
  roundNumber?: number;
  clusterIndex?: number;
  priority?: number;
  dependsOnJobIndices?: number[]; // Indices into the jobSpecs array for planning
}

export interface WorkflowDetail {
  id: string;
  name: string;
  description: string | null;
  workflowType: string;
  scopeType: string;
  scopeId: string | null;
  config: Record<string, unknown> | null;
  status: string;
  finalResult: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  jobs: JobSummary[];
  progress: {
    total: number;
    pending: number;
    running: number;
    complete: number;
    error: number;
  };
}

export interface JobSummary {
  id: string;
  templateId: string;
  targetType: string;
  targetIds: string[];
  status: string;
  roundNumber: number | null;
  clusterIndex: number | null;
  sortScore: number | null;
  tokensUsed: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  dependsOnIds: string[];
  dependedByIds: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new workflow (without any jobs yet).
 */
export async function createWorkflow(config: WorkflowConfig) {
  return prisma.llmWorkflow.create({
    data: {
      name: config.name,
      description: config.description || null,
      workflowType: config.workflowType,
      scopeType: config.scopeType,
      scopeId: config.scopeId || null,
      config: config.config || null,
      status: 'PENDING',
    },
  });
}

/**
 * Get workflow detail with job summaries and progress counts.
 */
export async function getWorkflow(workflowId: string): Promise<WorkflowDetail> {
  const workflow = await prisma.llmWorkflow.findUniqueOrThrow({
    where: { id: workflowId },
    include: {
      jobs: {
        include: {
          dependsOn: { select: { upstreamJobId: true } },
          dependedBy: { select: { downstreamJobId: true } },
        },
        orderBy: [{ roundNumber: 'asc' }, { clusterIndex: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });

  const jobs: JobSummary[] = workflow.jobs.map(j => ({
    id: j.id,
    templateId: j.templateId,
    targetType: j.targetType,
    targetIds: j.targetIds,
    status: j.status,
    roundNumber: j.roundNumber,
    clusterIndex: j.clusterIndex,
    sortScore: j.sortScore,
    tokensUsed: j.tokensUsed,
    errorMessage: j.errorMessage,
    startedAt: j.startedAt,
    completedAt: j.completedAt,
    createdAt: j.createdAt,
    dependsOnIds: j.dependsOn.map(d => d.upstreamJobId),
    dependedByIds: j.dependedBy.map(d => d.downstreamJobId),
  }));

  const progress = {
    total: jobs.length,
    pending: jobs.filter(j => j.status === 'PENDING').length,
    running: jobs.filter(j => j.status === 'RUNNING').length,
    complete: jobs.filter(j => j.status === 'COMPLETE').length,
    error: jobs.filter(j => j.status === 'ERROR').length,
  };

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    workflowType: workflow.workflowType,
    scopeType: workflow.scopeType,
    scopeId: workflow.scopeId,
    config: workflow.config as Record<string, unknown> | null,
    status: workflow.status,
    finalResult: workflow.finalResult as Record<string, unknown> | null,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    jobs,
    progress,
  };
}

/**
 * List workflows with optional filters.
 */
export async function listWorkflows(filters?: {
  scopeType?: string;
  scopeId?: string;
  workflowType?: string;
  status?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.scopeType) where.scopeType = filters.scopeType;
  if (filters?.scopeId) where.scopeId = filters.scopeId;
  if (filters?.workflowType) where.workflowType = filters.workflowType;
  if (filters?.status) where.status = filters.status;

  return prisma.llmWorkflow.findMany({
    where,
    include: {
      _count: { select: { jobs: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Cancel a running or pending workflow and all its pending jobs.
 */
export async function cancelWorkflow(workflowId: string) {
  await prisma.$transaction([
    prisma.llmJob.updateMany({
      where: { workflowId, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'CANCELLED' },
    }),
    prisma.llmWorkflow.update({
      where: { id: workflowId },
      data: { status: 'CANCELLED' },
    }),
  ]);
}

/**
 * Delete a workflow and all its jobs.
 */
export async function deleteWorkflow(workflowId: string) {
  // Dependencies are cascade-deleted via LlmJob onDelete: Cascade
  await prisma.llmWorkflow.delete({ where: { id: workflowId } });
}

// ─────────────────────────────────────────────────────────────────────────────
// DAG Planning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Plan a custom workflow by adding jobs with explicit dependencies.
 * Returns the created job IDs.
 */
export async function planCustomWorkflow(
  workflowId: string,
  jobSpecs: JobSpec[]
): Promise<string[]> {
  const createdJobIds: string[] = [];

  // Create all jobs first
  for (const spec of jobSpecs) {
    const job = await prisma.llmJob.create({
      data: {
        workflowId,
        templateId: spec.templateId,
        targetType: spec.targetType,
        targetIds: spec.targetIds,
        targetData: spec.targetData || null,
        roundNumber: spec.roundNumber ?? null,
        clusterIndex: spec.clusterIndex ?? null,
        priority: spec.priority ?? 0,
        status: 'PENDING',
      },
    });
    createdJobIds.push(job.id);
  }

  // Wire dependencies
  for (let i = 0; i < jobSpecs.length; i++) {
    const spec = jobSpecs[i];
    if (spec.dependsOnJobIndices && spec.dependsOnJobIndices.length > 0) {
      for (const depIdx of spec.dependsOnJobIndices) {
        if (depIdx >= 0 && depIdx < createdJobIds.length) {
          await prisma.llmJobDependency.create({
            data: {
              upstreamJobId: createdJobIds[depIdx],
              downstreamJobId: createdJobIds[i],
            },
          });
        }
      }
    }
  }

  return createdJobIds;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find jobs that are ready to execute: PENDING status with all upstream
 * dependencies in COMPLETE status.
 */
export async function getReadyJobs(workflowId: string) {
  const pendingJobs = await prisma.llmJob.findMany({
    where: { workflowId, status: 'PENDING' },
    include: {
      dependsOn: {
        include: {
          upstreamJob: { select: { status: true } },
        },
      },
    },
    orderBy: [{ priority: 'desc' }, { roundNumber: 'asc' }, { clusterIndex: 'asc' }],
  });

  return pendingJobs.filter(job => {
    if (job.dependsOn.length === 0) return true;
    return job.dependsOn.every(dep => dep.upstreamJob.status === 'COMPLETE');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Job Execution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a single LLM job.
 *
 * Flow:
 * 1. Mark job as RUNNING
 * 2. Load template and target data
 * 3. For patent/patent_group targets: load patent data, build prompt from template
 * 4. For summary_group targets: collect upstream results, inject into template
 * 5. Call LLM
 * 6. Store result in job + EntityAnalysisResult
 * 7. Mark job as COMPLETE (or ERROR)
 */
export async function executeJob(jobId: string): Promise<void> {
  const job = await prisma.llmJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      template: true,
      dependsOn: {
        include: {
          upstreamJob: { select: { id: true, result: true, sortScore: true } },
        },
      },
    },
  });

  // Mark as running
  await prisma.llmJob.update({
    where: { id: jobId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  try {
    const template = job.template;
    const isStructured = template.templateType === 'STRUCTURED';
    const questions = isStructured ? (template.questions as StructuredQuestion[] || []) : [];
    const systemMsg = isStructured ? SYSTEM_MESSAGE_STRUCTURED : SYSTEM_MESSAGE_FREE_FORM;
    const delimStart = template.delimiterStart || DEFAULT_DELIMITER_START;
    const delimEnd = template.delimiterEnd || DEFAULT_DELIMITER_END;

    // Load workflow context (for scope-based focus area resolution and result storage)
    const workflow = job.workflowId
      ? await prisma.llmWorkflow.findUnique({ where: { id: job.workflowId } })
      : null;

    let resolvedPrompt: string;

    if (job.targetType === 'patent' || job.targetType === 'patent_group') {
      // Load patent data
      const patents = loadEnrichedPatents(job.targetIds);

      if (job.targetType === 'patent' && job.targetIds.length === 1) {
        // Single patent execution
        const patent = patents.get(job.targetIds[0]) || { patent_id: job.targetIds[0] };
        resolvedPrompt = buildPromptForTemplate(
          { ...template, delimiterStart: delimStart, delimiterEnd: delimEnd },
          patent,
          null,
          job.targetIds,
          patents,
          template.contextFields
        );
      } else {
        // Patent group (collective) execution
        let focusArea: { name: string; description?: string | null } | null = null;

        // Load focus area context from workflow scope or targetData
        if (workflow?.scopeType === 'focus_area' && workflow.scopeId) {
          const fa = await prisma.focusArea.findUnique({
            where: { id: workflow.scopeId },
            select: { name: true, description: true },
          });
          if (fa) focusArea = fa;
        }
        const targetData = job.targetData as Record<string, unknown> | null;
        if (!focusArea && targetData?.focusAreaName) {
          focusArea = {
            name: targetData.focusAreaName as string,
            description: targetData.focusAreaDescription as string | null,
          };
        }

        resolvedPrompt = buildPromptForTemplate(
          { ...template, delimiterStart: delimStart, delimiterEnd: delimEnd },
          null,
          focusArea,
          job.targetIds,
          patents,
          template.contextFields
        );
      }
    } else if (job.targetType === 'summary_group') {
      // Aggregate upstream results for multi-round workflows
      const upstreamResults = job.dependsOn.map(dep => ({
        jobId: dep.upstreamJob.id,
        result: dep.upstreamJob.result as Record<string, unknown> | null,
        sortScore: dep.upstreamJob.sortScore,
      }));

      // Inject upstream data into template via placeholder substitution
      // Use <<upstream.data>> to reference aggregated upstream results
      const upstreamDataJson = JSON.stringify(
        upstreamResults.map(r => r.result).filter(Boolean),
        null,
        2
      );

      // Build prompt: substitute template placeholders, then replace upstream placeholder
      let promptText = template.promptText || '';
      const startEsc = delimStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const endEsc = delimEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Replace <<upstream.data>> with the JSON data from previous round
      const upstreamPattern = new RegExp(`${startEsc}upstream\\.data${endEsc}`, 'g');
      promptText = promptText.replace(upstreamPattern, upstreamDataJson);

      // Replace <<upstream.count>> with count of upstream results
      const upstreamCountPattern = new RegExp(`${startEsc}upstream\\.count${endEsc}`, 'g');
      promptText = promptText.replace(upstreamCountPattern, String(upstreamResults.length));

      // Also substitute any patent/focusArea variables that might be in the template
      // (these will remain unresolved if no context, which is expected for summary jobs)
      resolvedPrompt = promptText;

      // If targetData has additional context, inject it
      if (job.targetData) {
        const td = job.targetData as Record<string, unknown>;
        if (td.additionalContext) {
          resolvedPrompt += '\n\nAdditional Context:\n' + String(td.additionalContext);
        }
      }
    } else {
      throw new Error(`Unknown target type: ${job.targetType}`);
    }

    // Call LLM
    const llmResult = await callLlm(resolvedPrompt, template.llmModel, systemMsg);

    // Parse structured fields if applicable
    let fields: Record<string, unknown> | undefined;
    if (isStructured && llmResult.response && questions.length > 0) {
      fields = parseStructuredResponse(llmResult.response, questions);
    }

    // Extract sort score from result if configured
    let sortScore: number | null = null;
    const jobTargetData = job.targetData as Record<string, unknown> | null;
    const sortScoreField = jobTargetData?.sortScoreField as string | undefined;
    if (sortScoreField && llmResult.response) {
      const scoreVal = fields?.[sortScoreField] ?? llmResult.response[sortScoreField];
      if (typeof scoreVal === 'number') {
        sortScore = scoreVal;
      } else if (typeof scoreVal === 'string') {
        const parsed = parseFloat(scoreVal);
        if (!isNaN(parsed)) sortScore = parsed;
      }
    }

    const totalTokens = (llmResult.inputTokens || 0) + (llmResult.outputTokens || 0);

    // Store result in job
    await prisma.llmJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETE',
        result: {
          response: llmResult.response,
          fields: fields || null,
          rawText: llmResult.response ? undefined : llmResult.rawText,
          inputTokens: llmResult.inputTokens,
          outputTokens: llmResult.outputTokens,
        },
        sortScore,
        tokensUsed: totalTokens || null,
        completedAt: new Date(),
      },
    });

    // Also store in EntityAnalysisResult for queryability
    if (workflow) {
      // For patent-targeted jobs, store per-patent results
      if (job.targetType === 'patent' && job.targetIds.length === 1) {
        await prisma.entityAnalysisResult.create({
          data: {
            entityType: workflow.scopeType,
            entityId: workflow.scopeId || workflow.id,
            templateId: job.templateId,
            jobId: job.id,
            objectType: 'patent',
            objectId: job.targetIds[0],
            result: llmResult.response || { rawText: llmResult.rawText },
            resultType: isStructured ? 'structured' : 'free_form',
            fieldValues: fields || null,
            model: template.llmModel,
            tokensUsed: totalTokens || null,
            promptSent: resolvedPrompt,
            executedAt: new Date(),
          },
        });
      } else {
        // Collective/summary results
        await prisma.entityAnalysisResult.create({
          data: {
            entityType: workflow.scopeType,
            entityId: workflow.scopeId || workflow.id,
            templateId: job.templateId,
            jobId: job.id,
            objectType: null,
            objectId: null,
            result: llmResult.response || { rawText: llmResult.rawText },
            resultType: job.targetType === 'summary_group' ? 'tournament_summary' : 'free_form',
            fieldValues: fields || null,
            model: template.llmModel,
            tokensUsed: totalTokens || null,
            promptSent: resolvedPrompt,
            executedAt: new Date(),
          },
        });
      }
    }

    console.log(`[Workflow] Job ${jobId} completed (${totalTokens} tokens)`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[Workflow] Job ${jobId} failed:`, errorMessage);

    await prisma.llmJob.update({
      where: { id: jobId },
      data: {
        status: 'ERROR',
        errorMessage,
        completedAt: new Date(),
        retryCount: { increment: 1 },
      },
    });
  }
}

/**
 * Retry a failed job (reset to PENDING for re-execution).
 */
export async function retryJob(jobId: string) {
  const job = await prisma.llmJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status !== 'ERROR') {
    throw new Error(`Can only retry ERROR jobs, current status: ${job.status}`);
  }
  if (job.retryCount >= job.maxRetries) {
    throw new Error(`Max retries (${job.maxRetries}) exceeded`);
  }

  await prisma.llmJob.update({
    where: { id: jobId },
    data: {
      status: 'PENDING',
      errorMessage: null,
      result: null,
      sortScore: null,
      tokensUsed: null,
      startedAt: null,
      completedAt: null,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Execution Loop
// ─────────────────────────────────────────────────────────────────────────────

// Track running workflows to prevent double-execution
const runningWorkflows = new Set<string>();

/**
 * Execute a workflow by repeatedly finding and executing ready jobs.
 * This is the main execution loop — runs in background (fire-and-forget).
 */
export async function executeWorkflow(workflowId: string): Promise<void> {
  if (runningWorkflows.has(workflowId)) {
    console.log(`[Workflow] ${workflowId} is already running, skipping`);
    return;
  }

  runningWorkflows.add(workflowId);

  try {
    // Mark workflow as RUNNING
    await prisma.llmWorkflow.update({
      where: { id: workflowId },
      data: { status: 'RUNNING' },
    });

    console.log(`[Workflow] Starting execution of workflow ${workflowId}`);

    let iteration = 0;
    const MAX_ITERATIONS = 10000; // Safety limit

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // Check if workflow was cancelled
      const workflow = await prisma.llmWorkflow.findUnique({
        where: { id: workflowId },
        select: { status: true },
      });
      if (!workflow || workflow.status === 'CANCELLED') {
        console.log(`[Workflow] ${workflowId} was cancelled, stopping`);
        break;
      }

      // Find ready jobs
      const readyJobs = await getReadyJobs(workflowId);

      if (readyJobs.length === 0) {
        // Check if any jobs are still RUNNING (shouldn't happen in serial mode)
        const runningCount = await prisma.llmJob.count({
          where: { workflowId, status: 'RUNNING' },
        });

        if (runningCount > 0) {
          // Wait and check again (shouldn't happen in our serial execution)
          await sleep(RATE_LIMIT_MS);
          continue;
        }

        // No ready jobs and nothing running — workflow is done
        break;
      }

      // Execute ready jobs one at a time (serial execution with rate limiting)
      for (const job of readyJobs) {
        // Re-check cancellation between jobs
        const currentStatus = await prisma.llmWorkflow.findUnique({
          where: { id: workflowId },
          select: { status: true },
        });
        if (!currentStatus || currentStatus.status === 'CANCELLED') break;

        await executeJob(job.id);
        await sleep(RATE_LIMIT_MS);
      }
    }

    // Determine final workflow status
    const jobStats = await prisma.llmJob.groupBy({
      by: ['status'],
      where: { workflowId },
      _count: { id: true },
    });

    const statusMap = Object.fromEntries(
      jobStats.map(s => [s.status, s._count.id])
    );

    const hasErrors = (statusMap['ERROR'] || 0) > 0;
    const hasPending = (statusMap['PENDING'] || 0) > 0;
    const allComplete = !hasErrors && !hasPending && !statusMap['RUNNING'];

    let finalStatus: string;
    if (allComplete) {
      finalStatus = 'COMPLETE';
    } else if (hasErrors) {
      finalStatus = 'ERROR';
    } else {
      finalStatus = 'ERROR'; // Shouldn't happen
    }

    // Collect final result (last round's results for tournaments)
    let finalResult: Record<string, unknown> | null = null;
    const lastJobs = await prisma.llmJob.findMany({
      where: {
        workflowId,
        status: 'COMPLETE',
        dependedBy: { none: {} }, // Terminal jobs (no downstream dependencies)
      },
      select: { id: true, result: true, roundNumber: true, clusterIndex: true },
      orderBy: [{ roundNumber: 'desc' }, { clusterIndex: 'asc' }],
    });

    if (lastJobs.length > 0) {
      finalResult = {
        terminalJobs: lastJobs.map(j => ({
          jobId: j.id,
          roundNumber: j.roundNumber,
          clusterIndex: j.clusterIndex,
          result: j.result,
        })),
      };
    }

    await prisma.llmWorkflow.update({
      where: { id: workflowId },
      data: {
        status: finalStatus,
        finalResult,
      },
    });

    const totalTokens = await prisma.llmJob.aggregate({
      where: { workflowId },
      _sum: { tokensUsed: true },
    });

    console.log(`[Workflow] ${workflowId} finished with status ${finalStatus}. ` +
      `Total tokens: ${totalTokens._sum.tokensUsed || 0}`);
  } catch (err) {
    console.error(`[Workflow] Fatal error in workflow ${workflowId}:`, err);
    try {
      await prisma.llmWorkflow.update({
        where: { id: workflowId },
        data: {
          status: 'ERROR',
          finalResult: {
            error: err instanceof Error ? err.message : String(err),
          },
        },
      });
    } catch {
      // DB update failed
    }
  } finally {
    runningWorkflows.delete(workflowId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tournament Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate optimal cluster size based on patent count.
 * Targets 8-16 patents per cluster, adjusting for total count.
 */
export function calculateClusterSize(
  patentCount: number,
  targetSize?: number
): number {
  if (targetSize && targetSize > 0) return targetSize;

  // Heuristic: aim for 8-16 patents per cluster
  if (patentCount <= 16) return patentCount; // Single cluster
  if (patentCount <= 32) return Math.ceil(patentCount / 2);
  if (patentCount <= 64) return Math.ceil(patentCount / 4);
  if (patentCount <= 128) return 16;
  if (patentCount <= 256) return 16;
  if (patentCount <= 512) return 16;
  return 16; // Cap at 16 per cluster for large sets
}

/**
 * Form clusters of patent IDs based on strategy.
 */
export function formClusters(
  patentIds: string[],
  _strategy: string,
  clusterSize: number,
  _patents?: Map<string, PatentData>
): string[][] {
  // For now, simple sequential chunking.
  // TODO: Implement score-based, sector-based, and random strategies
  // The patents should arrive pre-sorted by score (default strategy).
  const clusters: string[][] = [];
  for (let i = 0; i < patentIds.length; i += clusterSize) {
    clusters.push(patentIds.slice(i, i + clusterSize));
  }
  return clusters;
}

/**
 * Plan a tournament workflow: create multi-round DAG with progressive elimination.
 *
 * Example: 256 patents, clusterSize=16, topN=4 per round:
 * - Round 1: 16 clusters of 16 patents each → 16 jobs
 * - Round 2: 4 clusters of 16 (4 top from each R1 cluster) → 4 jobs
 * - Round 3: 1 cluster of 16 (4 top from each R2 cluster) → 1 job
 * - Synthesis (optional): 1 final job combining R3 results
 *
 * Each round can use a different template and scoring criteria.
 */
export async function planTournament(
  workflowId: string,
  config: TournamentConfig
): Promise<string[]> {
  const workflow = await prisma.llmWorkflow.findUniqueOrThrow({
    where: { id: workflowId },
  });

  // Load patent IDs from scope
  const patentIds = await loadPatentIdsFromScope(workflow.scopeType, workflow.scopeId);
  if (patentIds.length === 0) {
    throw new Error('No patents found for workflow scope');
  }

  const clusterSize = calculateClusterSize(patentIds.length, config.clusterSizeTarget);
  const allJobSpecs: JobSpec[] = [];
  let currentRound = 0;

  // Track job indices per round for dependency wiring
  const roundJobIndices: number[][] = [];

  // Round 1: cluster original patents
  const initialClusters = formClusters(patentIds, config.initialClusterStrategy, clusterSize);
  const round1Config = config.rounds[0] || config.rounds[config.rounds.length - 1];
  const round1Indices: number[] = [];

  for (let ci = 0; ci < initialClusters.length; ci++) {
    round1Indices.push(allJobSpecs.length);
    allJobSpecs.push({
      templateId: round1Config.templateId,
      targetType: 'patent_group',
      targetIds: initialClusters[ci],
      targetData: { sortScoreField: round1Config.sortScoreField },
      roundNumber: 1,
      clusterIndex: ci,
      priority: 0,
    });
  }
  roundJobIndices.push(round1Indices);

  // Subsequent rounds: cluster upstream results
  let prevRoundClusterCount = initialClusters.length;
  currentRound = 2;

  while (prevRoundClusterCount > 1) {
    const roundConfig = config.rounds[Math.min(currentRound - 1, config.rounds.length - 1)];
    const prevRoundIndices = roundJobIndices[currentRound - 2];

    // Each cluster in this round takes topN results from multiple previous clusters
    const topN = roundConfig.topN;
    const itemsPerNewCluster = clusterSize;
    const prevClustersPerNewCluster = Math.ceil(itemsPerNewCluster / topN);

    const thisRoundIndices: number[] = [];
    let newClusterIndex = 0;

    for (let i = 0; i < prevRoundIndices.length; i += prevClustersPerNewCluster) {
      const upstreamJobIndices = prevRoundIndices.slice(
        i,
        Math.min(i + prevClustersPerNewCluster, prevRoundIndices.length)
      );

      thisRoundIndices.push(allJobSpecs.length);
      allJobSpecs.push({
        templateId: roundConfig.templateId,
        targetType: 'summary_group',
        targetIds: upstreamJobIndices.map(idx => `job:${idx}`), // Placeholder — actual IDs wired after creation
        targetData: {
          sortScoreField: roundConfig.sortScoreField,
          topN,
          roundNumber: currentRound,
        },
        roundNumber: currentRound,
        clusterIndex: newClusterIndex,
        priority: currentRound, // Higher rounds = higher priority
        dependsOnJobIndices: upstreamJobIndices,
      });

      newClusterIndex++;
    }

    roundJobIndices.push(thisRoundIndices);
    prevRoundClusterCount = thisRoundIndices.length;
    currentRound++;
  }

  // Optional synthesis job
  if (config.synthesisTemplateId) {
    const lastRoundIndices = roundJobIndices[roundJobIndices.length - 1];
    allJobSpecs.push({
      templateId: config.synthesisTemplateId,
      targetType: 'summary_group',
      targetIds: lastRoundIndices.map(idx => `job:${idx}`),
      targetData: { isSynthesis: true },
      roundNumber: currentRound,
      clusterIndex: 0,
      priority: currentRound,
      dependsOnJobIndices: lastRoundIndices,
    });
  }

  // Create all jobs via planCustomWorkflow
  const jobIds = await planCustomWorkflow(workflowId, allJobSpecs);

  // Store tournament metadata on workflow
  await prisma.llmWorkflow.update({
    where: { id: workflowId },
    data: {
      config: {
        ...((workflow.config as Record<string, unknown>) || {}),
        tournament: {
          ...config,
          patentCount: patentIds.length,
          clusterSize,
          totalRounds: currentRound - 1,
          totalJobs: jobIds.length,
        },
      },
    },
  });

  console.log(`[Tournament] Planned ${jobIds.length} jobs across ${currentRound - 1} rounds ` +
    `for ${patentIds.length} patents (clusters of ${clusterSize})`);

  return jobIds;
}

/**
 * Load patent IDs from a workflow scope (focus area, sector, etc.).
 */
async function loadPatentIdsFromScope(
  scopeType: string,
  scopeId: string | null
): Promise<string[]> {
  if (!scopeId) return [];

  switch (scopeType) {
    case 'focus_area': {
      const faPatents = await prisma.focusAreaPatent.findMany({
        where: { focusAreaId: scopeId },
        select: { patentId: true },
      });
      return faPatents.map(p => p.patentId);
    }
    case 'sector': {
      // Load patents by sector classification from the enriched data
      // For now, return an empty array — sector-based patent loading
      // will be implemented when we have sector-patent mapping in DB
      console.warn(`[Workflow] Sector-scoped workflows not yet implemented`);
      return [];
    }
    case 'super_sector': {
      console.warn(`[Workflow] SuperSector-scoped workflows not yet implemented`);
      return [];
    }
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-Stage Workflow Factory
// ─────────────────────────────────────────────────────────────────────────────

export interface TwoStageConfig {
  perPatentTemplateId: string;
  synthesisTemplateId: string;
  sortScoreField?: string;
}

/**
 * Plan a two-stage workflow: per-patent analysis → collective synthesis.
 * This wraps the existing focus-area prompt template pattern into the
 * workflow engine for tracking and dependency management.
 */
export async function planTwoStage(
  workflowId: string,
  config: TwoStageConfig
): Promise<string[]> {
  const workflow = await prisma.llmWorkflow.findUniqueOrThrow({
    where: { id: workflowId },
  });

  const patentIds = await loadPatentIdsFromScope(workflow.scopeType, workflow.scopeId);
  if (patentIds.length === 0) {
    throw new Error('No patents found for workflow scope');
  }

  const jobSpecs: JobSpec[] = [];

  // Stage 1: Per-patent analysis jobs
  const perPatentIndices: number[] = [];
  for (let i = 0; i < patentIds.length; i++) {
    perPatentIndices.push(jobSpecs.length);
    jobSpecs.push({
      templateId: config.perPatentTemplateId,
      targetType: 'patent',
      targetIds: [patentIds[i]],
      targetData: { sortScoreField: config.sortScoreField },
      roundNumber: 1,
      clusterIndex: i,
      priority: 0,
    });
  }

  // Stage 2: Synthesis job (depends on all Stage 1 jobs)
  jobSpecs.push({
    templateId: config.synthesisTemplateId,
    targetType: 'summary_group',
    targetIds: patentIds,
    targetData: { isSynthesis: true },
    roundNumber: 2,
    clusterIndex: 0,
    priority: 1,
    dependsOnJobIndices: perPatentIndices,
  });

  const jobIds = await planCustomWorkflow(workflowId, jobSpecs);

  await prisma.llmWorkflow.update({
    where: { id: workflowId },
    data: {
      config: {
        ...((workflow.config as Record<string, unknown>) || {}),
        twoStage: {
          ...config,
          patentCount: patentIds.length,
          totalJobs: jobIds.length,
        },
      },
    },
  });

  console.log(`[TwoStage] Planned ${jobIds.length} jobs (${patentIds.length} per-patent + 1 synthesis)`);

  return jobIds;
}
