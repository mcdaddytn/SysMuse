/**
 * LLM Workflow API Routes
 *
 * CRUD operations for workflows, job management, and execution.
 * Supports tournament, two-stage, chained, and custom workflow patterns.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  createWorkflow,
  getWorkflow,
  listWorkflows,
  cancelWorkflow,
  deleteWorkflow,
  executeWorkflow,
  executeJob,
  retryJob,
  getReadyJobs,
  planCustomWorkflow,
  planTournament,
  planTwoStage,
} from '../services/workflow-engine-service.js';
import type {
  WorkflowConfig,
  TournamentConfig,
  TwoStageConfig,
  JobSpec,
} from '../services/workflow-engine-service.js';

const router = Router();
const prisma = new PrismaClient();

// =============================================================================
// ENTITY ANALYSIS RESULTS (must be before /:id routes to avoid conflict)
// =============================================================================

/**
 * GET /api/workflows/results/:entityType/:entityId
 * Get all analysis results for an entity.
 */
router.get('/results/:entityType/:entityId', async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.params;
    const { templateId, objectType, objectId } = req.query;

    const where: Record<string, unknown> = { entityType, entityId };
    if (templateId) where.templateId = templateId;
    if (objectType) where.objectType = objectType;
    if (objectId) where.objectId = objectId;

    const results = await prisma.entityAnalysisResult.findMany({
      where,
      orderBy: { executedAt: 'desc' },
    });

    res.json(results);
  } catch (error) {
    console.error('Error fetching entity results:', error);
    res.status(500).json({ error: 'Failed to fetch entity results' });
  }
});

// =============================================================================
// WORKFLOW CRUD
// =============================================================================

/**
 * GET /api/workflows
 * List workflows with optional filters.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { scopeType, scopeId, workflowType, status } = req.query;
    const workflows = await listWorkflows({
      scopeType: scopeType as string | undefined,
      scopeId: scopeId as string | undefined,
      workflowType: workflowType as string | undefined,
      status: status as string | undefined,
    });
    res.json(workflows);
  } catch (error) {
    console.error('Error listing workflows:', error);
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

/**
 * GET /api/workflows/:id
 * Get workflow detail with jobs and progress.
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const detail = await getWorkflow(req.params.id);
    res.json(detail);
  } catch (error) {
    console.error('Error fetching workflow:', error);
    res.status(404).json({ error: 'Workflow not found' });
  }
});

/**
 * POST /api/workflows
 * Create a new workflow.
 * Body: { name, description?, workflowType, scopeType, scopeId?, config? }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const config: WorkflowConfig = {
      name: req.body.name,
      description: req.body.description,
      workflowType: req.body.workflowType || 'custom',
      scopeType: req.body.scopeType,
      scopeId: req.body.scopeId,
      config: req.body.config,
    };

    if (!config.name || !config.scopeType) {
      res.status(400).json({ error: 'name and scopeType are required' });
      return;
    }

    const workflow = await createWorkflow(config);
    res.status(201).json(workflow);
  } catch (error) {
    console.error('Error creating workflow:', error);
    res.status(500).json({ error: 'Failed to create workflow' });
  }
});

/**
 * DELETE /api/workflows/:id
 * Delete a workflow and all its jobs.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteWorkflow(req.params.id);
    res.json({ message: 'Workflow deleted' });
  } catch (error) {
    console.error('Error deleting workflow:', error);
    res.status(500).json({ error: 'Failed to delete workflow' });
  }
});

// =============================================================================
// WORKFLOW EXECUTION
// =============================================================================

/**
 * POST /api/workflows/:id/execute
 * Start workflow execution (async, returns immediately).
 */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const workflow = await prisma.llmWorkflow.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { jobs: true } } },
    });

    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    if (workflow.status === 'RUNNING') {
      res.status(409).json({ error: 'Workflow is already running' });
      return;
    }

    if (workflow._count.jobs === 0) {
      res.status(400).json({ error: 'Workflow has no jobs planned. Use /plan endpoint first.' });
      return;
    }

    // Fire and forget — don't await
    executeWorkflow(req.params.id).catch(err => {
      console.error(`[Workflow] Background execution failed for ${req.params.id}:`, err);
    });

    res.json({ status: 'RUNNING', message: 'Workflow execution started' });
  } catch (error) {
    console.error('Error starting workflow:', error);
    res.status(500).json({ error: 'Failed to start workflow' });
  }
});

/**
 * POST /api/workflows/:id/cancel
 * Cancel a running workflow.
 */
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    await cancelWorkflow(req.params.id);
    res.json({ status: 'CANCELLED', message: 'Workflow cancelled' });
  } catch (error) {
    console.error('Error cancelling workflow:', error);
    res.status(500).json({ error: 'Failed to cancel workflow' });
  }
});

/**
 * GET /api/workflows/:id/status
 * Get compact execution status for polling.
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const workflow = await prisma.llmWorkflow.findUnique({
      where: { id: req.params.id },
    });

    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const jobStats = await prisma.llmJob.groupBy({
      by: ['status'],
      where: { workflowId: req.params.id },
      _count: { id: true },
    });

    const progress = Object.fromEntries(
      jobStats.map(s => [s.status.toLowerCase(), s._count.id])
    );

    const totalJobs = jobStats.reduce((sum, s) => sum + s._count.id, 0);
    const completedJobs = progress['complete'] || 0;
    const errorJobs = progress['error'] || 0;

    const totalTokens = await prisma.llmJob.aggregate({
      where: { workflowId: req.params.id },
      _sum: { tokensUsed: true },
    });

    res.json({
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      workflowType: workflow.workflowType,
      progress: {
        total: totalJobs,
        ...progress,
      },
      completionPct: totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0,
      tokensUsed: totalTokens._sum.tokensUsed || 0,
      updatedAt: workflow.updatedAt,
    });
  } catch (error) {
    console.error('Error fetching workflow status:', error);
    res.status(500).json({ error: 'Failed to fetch workflow status' });
  }
});

// =============================================================================
// WORKFLOW PLANNING — Custom, Tournament, Two-Stage
// =============================================================================

/**
 * POST /api/workflows/:id/plan/custom
 * Plan a custom workflow by providing job specs with dependencies.
 * Body: { jobs: JobSpec[] }
 */
router.post('/:id/plan/custom', async (req: Request, res: Response) => {
  try {
    const { jobs } = req.body;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      res.status(400).json({ error: 'jobs array is required' });
      return;
    }

    const jobIds = await planCustomWorkflow(req.params.id, jobs as JobSpec[]);
    res.json({
      message: `Planned ${jobIds.length} jobs`,
      jobIds,
    });
  } catch (error) {
    console.error('Error planning custom workflow:', error);
    res.status(500).json({ error: 'Failed to plan custom workflow' });
  }
});

/**
 * POST /api/workflows/:id/plan/tournament
 * Plan a tournament workflow (multi-round progressive elimination).
 * Body: TournamentConfig
 */
router.post('/:id/plan/tournament', async (req: Request, res: Response) => {
  try {
    const config: TournamentConfig = {
      rounds: req.body.rounds,
      initialClusterStrategy: req.body.initialClusterStrategy || 'score',
      clusterSizeTarget: req.body.clusterSizeTarget,
      synthesisTemplateId: req.body.synthesisTemplateId,
    };

    if (!config.rounds || config.rounds.length === 0) {
      res.status(400).json({ error: 'At least one round configuration is required' });
      return;
    }

    const jobIds = await planTournament(req.params.id, config);
    const detail = await getWorkflow(req.params.id);

    res.json({
      message: `Tournament planned: ${jobIds.length} jobs`,
      jobIds,
      progress: detail.progress,
      config: detail.config,
    });
  } catch (error) {
    console.error('Error planning tournament:', error);
    res.status(500).json({ error: 'Failed to plan tournament' });
  }
});

/**
 * POST /api/workflows/:id/plan/two-stage
 * Plan a two-stage workflow (per-patent → synthesis).
 * Body: TwoStageConfig
 */
router.post('/:id/plan/two-stage', async (req: Request, res: Response) => {
  try {
    const config: TwoStageConfig = {
      perPatentTemplateId: req.body.perPatentTemplateId,
      synthesisTemplateId: req.body.synthesisTemplateId,
      sortScoreField: req.body.sortScoreField,
    };

    if (!config.perPatentTemplateId || !config.synthesisTemplateId) {
      res.status(400).json({ error: 'perPatentTemplateId and synthesisTemplateId are required' });
      return;
    }

    const jobIds = await planTwoStage(req.params.id, config);
    const detail = await getWorkflow(req.params.id);

    res.json({
      message: `Two-stage workflow planned: ${jobIds.length} jobs`,
      jobIds,
      progress: detail.progress,
    });
  } catch (error) {
    console.error('Error planning two-stage workflow:', error);
    res.status(500).json({ error: 'Failed to plan two-stage workflow' });
  }
});

// =============================================================================
// JOB MANAGEMENT
// =============================================================================

/**
 * GET /api/workflows/:id/jobs
 * List jobs for a workflow with optional status filter.
 */
router.get('/:id/jobs', async (req: Request, res: Response) => {
  try {
    const { status, round } = req.query;
    const where: Record<string, unknown> = { workflowId: req.params.id };
    if (status) where.status = status;
    if (round) where.roundNumber = parseInt(round as string);

    const jobs = await prisma.llmJob.findMany({
      where,
      include: {
        template: { select: { id: true, name: true, templateType: true } },
        dependsOn: { select: { upstreamJobId: true } },
        dependedBy: { select: { downstreamJobId: true } },
      },
      orderBy: [{ roundNumber: 'asc' }, { clusterIndex: 'asc' }, { createdAt: 'asc' }],
    });

    res.json(jobs.map(j => ({
      id: j.id,
      templateId: j.templateId,
      templateName: j.template.name,
      templateType: j.template.templateType,
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
    })));
  } catch (error) {
    console.error('Error listing jobs:', error);
    res.status(500).json({ error: 'Failed to list jobs' });
  }
});

/**
 * GET /api/workflows/:id/jobs/:jobId
 * Get a specific job with full result.
 */
router.get('/:id/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const job = await prisma.llmJob.findUnique({
      where: { id: req.params.jobId },
      include: {
        template: { select: { id: true, name: true, templateType: true } },
        dependsOn: {
          include: {
            upstreamJob: {
              select: { id: true, status: true, roundNumber: true, clusterIndex: true },
            },
          },
        },
        dependedBy: {
          include: {
            downstreamJob: {
              select: { id: true, status: true, roundNumber: true, clusterIndex: true },
            },
          },
        },
      },
    });

    if (!job || job.workflowId !== req.params.id) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    res.json({
      id: job.id,
      workflowId: job.workflowId,
      templateId: job.templateId,
      templateName: job.template.name,
      templateType: job.template.templateType,
      targetType: job.targetType,
      targetIds: job.targetIds,
      targetData: job.targetData,
      status: job.status,
      priority: job.priority,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      roundNumber: job.roundNumber,
      clusterIndex: job.clusterIndex,
      sortScore: job.sortScore,
      result: job.result,
      tokensUsed: job.tokensUsed,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      dependencies: {
        upstream: job.dependsOn.map(d => ({
          jobId: d.upstreamJob.id,
          status: d.upstreamJob.status,
          roundNumber: d.upstreamJob.roundNumber,
          clusterIndex: d.upstreamJob.clusterIndex,
        })),
        downstream: job.dependedBy.map(d => ({
          jobId: d.downstreamJob.id,
          status: d.downstreamJob.status,
          roundNumber: d.downstreamJob.roundNumber,
          clusterIndex: d.downstreamJob.clusterIndex,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

/**
 * POST /api/workflows/:id/jobs/:jobId/retry
 * Retry a failed job.
 */
router.post('/:id/jobs/:jobId/retry', async (req: Request, res: Response) => {
  try {
    await retryJob(req.params.jobId);
    res.json({ message: 'Job queued for retry' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retry job';
    console.error('Error retrying job:', error);
    res.status(400).json({ error: message });
  }
});

/**
 * GET /api/workflows/:id/ready-jobs
 * Get jobs that are ready to execute (all dependencies met).
 */
router.get('/:id/ready-jobs', async (req: Request, res: Response) => {
  try {
    const readyJobs = await getReadyJobs(req.params.id);
    res.json(readyJobs.map(j => ({
      id: j.id,
      templateId: j.templateId,
      targetType: j.targetType,
      targetIds: j.targetIds,
      roundNumber: j.roundNumber,
      clusterIndex: j.clusterIndex,
      priority: j.priority,
    })));
  } catch (error) {
    console.error('Error fetching ready jobs:', error);
    res.status(500).json({ error: 'Failed to fetch ready jobs' });
  }
});

export default router;
