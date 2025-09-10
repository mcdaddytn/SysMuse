import { PrismaClient, LLMTaskStatus, TrialWorkflowState } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export enum WorkflowStep {
  PDF_CONVERT = 'pdfConvert',
  PHASE1 = 'phase1',
  LLM_OVERRIDE = 'llmOverride',
  OVERRIDE_IMPORT = 'overrideImport',
  PHASE2 = 'phase2',
  PHASE2_INDEX = 'phase2Index',
  PHASE3 = 'phase3',
  LLM_MARKER = 'llmMarker',
  MARKER_IMPORT = 'markerImport',
  PHASE3_INDEX = 'phase3Index',
  PHASE2_CLEANUP = 'phase2Cleanup'
}

export enum WorkflowPhase {
  CONVERT = 'convert',
  PHASE1 = 'phase1',
  PHASE2 = 'phase2',
  PHASE3 = 'phase3',
  COMPLETE = 'complete'
}

export interface WorkflowConfig {
  enableLLMOverrides?: boolean;
  enableLLMMarkers?: boolean;
  cleanupPhase2After?: boolean;
  phase2RetentionHours?: number;
  configFile?: string;
  verbose?: boolean;
  forceRerun?: boolean;
  skipOptional?: boolean;
}

export interface StepResult {
  success: boolean;
  message?: string;
  error?: Error;
  data?: any;
  duration?: number;
}

export class TrialWorkflowService {
  private prisma: PrismaClient;
  private config: WorkflowConfig;

  constructor(prisma: PrismaClient, config: WorkflowConfig = {}) {
    this.prisma = prisma;
    this.config = {
      enableLLMOverrides: false,
      enableLLMMarkers: false,
      cleanupPhase2After: false,
      phase2RetentionHours: 24,
      verbose: false,
      forceRerun: false,
      skipOptional: false,
      ...config
    };
  }

  /**
   * Run workflow to specified phase for a trial
   */
  async runToPhase(trialId: number, targetPhase: WorkflowPhase): Promise<void> {
    const trial = await this.prisma.trial.findUnique({
      where: { id: trialId },
      include: { workflowState: true }
    });

    if (!trial) {
      throw new Error(`Trial with id ${trialId} not found`);
    }

    // Get or create workflow state
    let workflowState = trial.workflowState;
    if (!workflowState) {
      workflowState = await this.createWorkflowState(trialId);
    }

    // Get required steps to reach target phase
    const requiredSteps = this.getRequiredSteps(workflowState, targetPhase);

    if (this.config.verbose) {
      console.log(`Trial ${trialId}: ${trial.shortName || trial.name}`);
      console.log(`Target phase: ${targetPhase}`);
      console.log(`Required steps: ${requiredSteps.join(', ')}`);
    }

    // Execute each step in sequence
    for (const step of requiredSteps) {
      if (this.config.verbose) {
        console.log(`\nExecuting step: ${step}`);
      }

      const startTime = Date.now();
      const result = await this.executeStep(trialId, step);

      if (!result.success) {
        await this.updateErrorState(trialId, step, result.error);
        throw new Error(`Step ${step} failed: ${result.error?.message || result.message}`);
      }

      const duration = Date.now() - startTime;
      await this.updateStepState(trialId, step, true, duration);

      if (this.config.verbose) {
        console.log(`Step ${step} completed in ${(duration / 1000).toFixed(2)}s`);
      }
    }
  }

  /**
   * Get required steps to reach target phase
   */
  private getRequiredSteps(state: TrialWorkflowState, targetPhase: WorkflowPhase): WorkflowStep[] {
    const steps: WorkflowStep[] = [];

    // Define phase dependencies
    const phaseSteps: Record<WorkflowPhase, WorkflowStep[]> = {
      [WorkflowPhase.CONVERT]: [WorkflowStep.PDF_CONVERT],
      [WorkflowPhase.PHASE1]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.LLM_OVERRIDE] : []),
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.OVERRIDE_IMPORT] : [])
      ],
      [WorkflowPhase.PHASE2]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.LLM_OVERRIDE] : []),
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.OVERRIDE_IMPORT] : []),
        WorkflowStep.PHASE2,
        WorkflowStep.PHASE2_INDEX
      ],
      [WorkflowPhase.PHASE3]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.LLM_OVERRIDE] : []),
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.OVERRIDE_IMPORT] : []),
        WorkflowStep.PHASE2,
        WorkflowStep.PHASE2_INDEX,
        WorkflowStep.PHASE3,
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [WorkflowStep.LLM_MARKER] : []),
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [WorkflowStep.MARKER_IMPORT] : []),
        WorkflowStep.PHASE3_INDEX,
        ...(this.config.cleanupPhase2After && !this.config.skipOptional ? [WorkflowStep.PHASE2_CLEANUP] : [])
      ],
      [WorkflowPhase.COMPLETE]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.LLM_OVERRIDE] : []),
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [WorkflowStep.OVERRIDE_IMPORT] : []),
        WorkflowStep.PHASE2,
        WorkflowStep.PHASE2_INDEX,
        WorkflowStep.PHASE3,
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [WorkflowStep.LLM_MARKER] : []),
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [WorkflowStep.MARKER_IMPORT] : []),
        WorkflowStep.PHASE3_INDEX,
        ...(this.config.cleanupPhase2After && !this.config.skipOptional ? [WorkflowStep.PHASE2_CLEANUP] : [])
      ]
    };

    const targetSteps = phaseSteps[targetPhase] || [];

    // Filter out already completed steps unless force rerun
    for (const step of targetSteps) {
      if (this.config.forceRerun || !this.isStepCompleted(state, step)) {
        steps.push(step);
      }
    }

    return steps;
  }

  /**
   * Check if a step is completed
   */
  private isStepCompleted(state: TrialWorkflowState, step: WorkflowStep): boolean {
    const stepCompletionMap: Record<WorkflowStep, boolean> = {
      [WorkflowStep.PDF_CONVERT]: state.pdfConvertCompleted,
      [WorkflowStep.PHASE1]: state.phase1Completed,
      [WorkflowStep.LLM_OVERRIDE]: state.llmOverrideCompleted,
      [WorkflowStep.OVERRIDE_IMPORT]: state.overrideImportCompleted,
      [WorkflowStep.PHASE2]: state.phase2Completed,
      [WorkflowStep.PHASE2_INDEX]: state.phase2IndexCompleted,
      [WorkflowStep.PHASE3]: state.phase3Completed,
      [WorkflowStep.LLM_MARKER]: state.llmMarker1Completed,
      [WorkflowStep.MARKER_IMPORT]: state.marker1ImportCompleted,
      [WorkflowStep.PHASE3_INDEX]: state.phase3IndexCompleted,
      [WorkflowStep.PHASE2_CLEANUP]: state.phase2CleanupCompleted
    };

    return stepCompletionMap[step] || false;
  }

  /**
   * Execute a workflow step
   */
  private async executeStep(trialId: number, step: WorkflowStep): Promise<StepResult> {
    try {
      switch (step) {
        case WorkflowStep.PDF_CONVERT:
          return await this.executePdfConvert(trialId);
        case WorkflowStep.PHASE1:
          return await this.executePhase1(trialId);
        case WorkflowStep.LLM_OVERRIDE:
          return await this.executeLLMOverride(trialId);
        case WorkflowStep.OVERRIDE_IMPORT:
          return await this.executeOverrideImport(trialId);
        case WorkflowStep.PHASE2:
          return await this.executePhase2(trialId);
        case WorkflowStep.PHASE2_INDEX:
          return await this.executePhase2Index(trialId);
        case WorkflowStep.PHASE3:
          return await this.executePhase3(trialId);
        case WorkflowStep.LLM_MARKER:
          return await this.executeLLMMarker(trialId);
        case WorkflowStep.MARKER_IMPORT:
          return await this.executeMarkerImport(trialId);
        case WorkflowStep.PHASE3_INDEX:
          return await this.executePhase3Index(trialId);
        case WorkflowStep.PHASE2_CLEANUP:
          return await this.executePhase2Cleanup(trialId);
        default:
          throw new Error(`Unknown step: ${step}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Execute PDF conversion step
   */
  private async executePdfConvert(trialId: number): Promise<StepResult> {
    if (!this.config.configFile) {
      return { success: false, message: 'Config file not specified' };
    }

    try {
      const command = `npm run convert-pdf ${this.config.configFile}`;
      if (this.config.verbose) {
        console.log(`Running: ${command}`);
      }
      execSync(command, { 
        stdio: this.config.verbose ? 'inherit' : 'ignore',
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Execute Phase 1 parsing
   */
  private async executePhase1(trialId: number): Promise<StepResult> {
    if (!this.config.configFile) {
      return { success: false, message: 'Config file not specified' };
    }

    try {
      const command = `npx ts-node src/cli/parse.ts parse --phase1 --config ${this.config.configFile}`;
      if (this.config.verbose) {
        console.log(`Running: ${command}`);
      }
      execSync(command, { 
        stdio: this.config.verbose ? 'inherit' : 'ignore',
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Execute Phase 2 processing
   */
  private async executePhase2(trialId: number): Promise<StepResult> {
    if (!this.config.configFile) {
      return { success: false, message: 'Config file not specified' };
    }

    try {
      const command = `npx ts-node src/cli/parse.ts parse --phase2 --config ${this.config.configFile}`;
      if (this.config.verbose) {
        console.log(`Running: ${command}`);
      }
      execSync(command, { 
        stdio: this.config.verbose ? 'inherit' : 'ignore',
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Execute Phase 3 processing
   */
  private async executePhase3(trialId: number): Promise<StepResult> {
    try {
      const command = `npx ts-node src/cli/phase3.ts process -t ${trialId}`;
      if (this.config.verbose) {
        console.log(`Running: ${command}`);
      }
      execSync(command, { 
        stdio: this.config.verbose ? 'inherit' : 'ignore',
        maxBuffer: 50 * 1024 * 1024 // 50MB buffer
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Placeholder for LLM override generation
   */
  private async executeLLMOverride(trialId: number): Promise<StepResult> {
    // TODO: Implement LLM override generation
    console.log('LLM override generation not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Placeholder for override import
   */
  private async executeOverrideImport(trialId: number): Promise<StepResult> {
    // TODO: Implement override import
    console.log('Override import not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Placeholder for Phase 2 indexing
   */
  private async executePhase2Index(trialId: number): Promise<StepResult> {
    // Phase 2 automatically indexes to Elasticsearch during processing
    return { success: true, message: 'Indexed during Phase 2 processing' };
  }

  /**
   * Placeholder for LLM marker discovery
   */
  private async executeLLMMarker(trialId: number): Promise<StepResult> {
    // TODO: Implement LLM marker discovery
    console.log('LLM marker discovery not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Placeholder for marker import
   */
  private async executeMarkerImport(trialId: number): Promise<StepResult> {
    // TODO: Implement marker import
    console.log('Marker import not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Placeholder for Phase 3 indexing
   */
  private async executePhase3Index(trialId: number): Promise<StepResult> {
    // TODO: Implement Phase 3 Elasticsearch indexing
    console.log('Phase 3 indexing not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Placeholder for Phase 2 cleanup
   */
  private async executePhase2Cleanup(trialId: number): Promise<StepResult> {
    // TODO: Implement Phase 2 cleanup
    console.log('Phase 2 cleanup not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Create workflow state for a trial
   */
  private async createWorkflowState(trialId: number): Promise<TrialWorkflowState> {
    return await this.prisma.trialWorkflowState.create({
      data: {
        trialId,
        llmOverrideStatus: LLMTaskStatus.PENDING,
        llmMarker1Status: LLMTaskStatus.PENDING,
        llmMarker2Status: LLMTaskStatus.PENDING
      }
    });
  }

  /**
   * Update step completion state
   */
  private async updateStepState(trialId: number, step: WorkflowStep, success: boolean, duration?: number): Promise<void> {
    const updateData: any = {};
    const now = new Date();

    switch (step) {
      case WorkflowStep.PDF_CONVERT:
        updateData.pdfConvertCompleted = success;
        updateData.pdfConvertAt = success ? now : null;
        break;
      case WorkflowStep.PHASE1:
        updateData.phase1Completed = success;
        updateData.phase1CompletedAt = success ? now : null;
        break;
      case WorkflowStep.LLM_OVERRIDE:
        updateData.llmOverrideCompleted = success;
        updateData.llmOverrideAt = success ? now : null;
        updateData.llmOverrideStatus = success ? LLMTaskStatus.COMPLETED : LLMTaskStatus.FAILED;
        break;
      case WorkflowStep.OVERRIDE_IMPORT:
        updateData.overrideImportCompleted = success;
        updateData.overrideImportAt = success ? now : null;
        break;
      case WorkflowStep.PHASE2:
        updateData.phase2Completed = success;
        updateData.phase2CompletedAt = success ? now : null;
        break;
      case WorkflowStep.PHASE2_INDEX:
        updateData.phase2IndexCompleted = success;
        updateData.phase2IndexAt = success ? now : null;
        break;
      case WorkflowStep.PHASE3:
        updateData.phase3Completed = success;
        updateData.phase3CompletedAt = success ? now : null;
        break;
      case WorkflowStep.LLM_MARKER:
        updateData.llmMarker1Completed = success;
        updateData.llmMarker1At = success ? now : null;
        updateData.llmMarker1Status = success ? LLMTaskStatus.COMPLETED : LLMTaskStatus.FAILED;
        break;
      case WorkflowStep.MARKER_IMPORT:
        updateData.marker1ImportCompleted = success;
        updateData.marker1ImportAt = success ? now : null;
        break;
      case WorkflowStep.PHASE3_INDEX:
        updateData.phase3IndexCompleted = success;
        updateData.phase3IndexAt = success ? now : null;
        break;
      case WorkflowStep.PHASE2_CLEANUP:
        updateData.phase2CleanupCompleted = success;
        updateData.phase2CleanupAt = success ? now : null;
        break;
    }

    await this.prisma.trialWorkflowState.upsert({
      where: { trialId },
      create: {
        trialId,
        ...updateData,
        llmOverrideStatus: LLMTaskStatus.PENDING,
        llmMarker1Status: LLMTaskStatus.PENDING,
        llmMarker2Status: LLMTaskStatus.PENDING
      },
      update: updateData
    });
  }

  /**
   * Update error state
   */
  private async updateErrorState(trialId: number, step: WorkflowStep, error?: Error): Promise<void> {
    await this.prisma.trialWorkflowState.update({
      where: { trialId },
      data: {
        lastError: `Step ${step} failed: ${error?.message || 'Unknown error'}`,
        lastErrorAt: new Date(),
        retryCount: { increment: 1 }
      }
    });
  }

  /**
   * Get workflow status for a trial
   */
  async getWorkflowStatus(trialId: number): Promise<any> {
    const trial = await this.prisma.trial.findUnique({
      where: { id: trialId },
      include: { workflowState: true }
    });

    if (!trial) {
      throw new Error(`Trial with id ${trialId} not found`);
    }

    const state = trial.workflowState;
    if (!state) {
      return {
        trialId,
        trialName: trial.shortName || trial.name,
        caseNumber: trial.caseNumber,
        completionPercentage: 0,
        completedSteps: [],
        pendingSteps: Object.values(WorkflowStep),
        lastError: null,
        lastErrorAt: null,
        retryCount: 0,
        lastActivity: null
      };
    }

    const completedSteps: WorkflowStep[] = [];
    const pendingSteps: WorkflowStep[] = [];

    for (const step of Object.values(WorkflowStep)) {
      if (this.isStepCompleted(state, step)) {
        completedSteps.push(step);
      } else {
        pendingSteps.push(step);
      }
    }

    const totalSteps = Object.values(WorkflowStep).length;
    const completionPercentage = totalSteps > 0 ? Math.round((completedSteps.length / totalSteps) * 100) : 0;

    return {
      trialId,
      trialName: trial.shortName || trial.name,
      caseNumber: trial.caseNumber,
      completionPercentage,
      completedSteps,
      pendingSteps,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt,
      retryCount: state.retryCount,
      lastActivity: state.updatedAt
    };
  }

  /**
   * Get workflow status for all trials
   */
  async getAllWorkflowStatus(): Promise<any[]> {
    const trials = await this.prisma.trial.findMany({
      include: { workflowState: true }
    });

    const statuses = [];
    for (const trial of trials) {
      statuses.push(await this.getWorkflowStatus(trial.id));
    }

    return statuses;
  }
}