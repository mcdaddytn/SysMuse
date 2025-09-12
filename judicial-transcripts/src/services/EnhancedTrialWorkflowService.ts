import { PrismaClient, LLMTaskStatus, TrialWorkflowState, WorkflowStatus } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import logger from '../utils/logger';

export enum WorkflowStep {
  PDF_CONVERT = 'pdfConvert',
  LLM_OVERRIDE = 'llmOverride',
  OVERRIDE_REVIEW = 'overrideReview',
  OVERRIDE_IMPORT = 'overrideImport',
  PHASE1 = 'phase1',
  PHASE2 = 'phase2',
  PHASE2_INDEX = 'phase2Index',
  LLM_MARKER_1 = 'llmMarker1',
  MARKER1_REVIEW = 'marker1Review',
  MARKER1_IMPORT = 'marker1Import',
  PHASE3 = 'phase3',
  LLM_MARKER_2 = 'llmMarker2',
  MARKER2_REVIEW = 'marker2Review',
  MARKER2_IMPORT = 'marker2Import',
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
  autoReview?: {
    overrides?: boolean;
    markers1?: boolean;
    markers2?: boolean;
  };
  outputDir?: string;
  inputDir?: string;
  execTimeout?: number;  // Custom timeout for execSync operations in milliseconds
  maxBuffer?: number;  // Maximum buffer size for execSync operations in bytes
  workflow?: {
    enableLLMOverrides?: boolean;
    enableLLMMarkers?: boolean;
    noRegenLLMMetadata?: boolean;
    cleanupPhase2After?: boolean;
    phase2RetentionHours?: number;
    execTimeout?: number;
    maxBuffer?: number;
    autoReview?: {
      overrides?: boolean;
      markers1?: boolean;
      markers2?: boolean;
    };
  };
}

export interface StepResult {
  success: boolean;
  message?: string;
  error?: Error;
  data?: any;
  duration?: number;
  requiresReview?: boolean;
}

interface ConversionSummary {
  timestamp: string;
  filesConverted: string[];
  metadataCopied: string[];
  sourceDir: string;
  destDir: string;
  complete: boolean;
}

interface OverrideMetadata {
  generatedAt: string;
  llmModel?: string;
  userReviewed: boolean;
  reviewedAt?: string;
  reviewedBy?: string;
}

export class EnhancedTrialWorkflowService {
  private prisma: PrismaClient;
  private config: WorkflowConfig;

  constructor(prisma: PrismaClient, config: WorkflowConfig = {}) {
    this.prisma = prisma;
    
    // Handle both direct config and nested workflow config
    const autoReviewConfig = config.autoReview || config.workflow?.autoReview;
    
    this.config = {
      enableLLMOverrides: true, // Default to enabled for enhanced workflow
      enableLLMMarkers: true,
      cleanupPhase2After: false,
      phase2RetentionHours: 24,
      verbose: false,
      forceRerun: false,
      skipOptional: false,
      autoReview: {
        overrides: false,
        markers1: false,
        markers2: false,
        ...(autoReviewConfig || {})
      },
      ...config,
      // Ensure autoReview is properly set
      autoReview: autoReviewConfig || config.autoReview || {
        overrides: false,
        markers1: false,
        markers2: false
      }
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
    const requiredSteps = await this.getRequiredSteps(workflowState, targetPhase, trial);

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

      // Update status to indicate what we're doing
      await this.updateWorkflowStatus(trialId, this.getStatusForStep(step, 'running'));

      const startTime = Date.now();
      const result = await this.executeStep(trialId, step, trial);

      if (result.requiresReview) {
        await this.updateWorkflowStatus(trialId, this.getStatusForStep(step, 'review'));
        console.log(`\n⏸️  Workflow paused for review at step: ${step}`);
        console.log(`Please review files and run: npx ts-node src/cli/sync.ts ${this.getReviewSyncCommand(step)} --approve`);
        console.log(`Then resume with: npx ts-node src/cli/workflow.ts resume --trial-id ${trialId}`);
        return;
      }

      if (!result.success) {
        await this.updateErrorState(trialId, step, result.error);
        await this.updateWorkflowStatus(trialId, WorkflowStatus.ERROR);
        throw new Error(`Step ${step} failed: ${result.error?.message || result.message}`);
      }

      const duration = Date.now() - startTime;
      await this.updateStepState(trialId, step, true, duration);

      if (this.config.verbose) {
        console.log(`Step ${step} completed in ${(duration / 1000).toFixed(2)}s`);
      }
    }

    // Update final status
    if (targetPhase === WorkflowPhase.COMPLETE) {
      await this.updateWorkflowStatus(trialId, WorkflowStatus.COMPLETED);
    }
  }

  /**
   * Get required steps to reach target phase with smart detection
   */
  private async getRequiredSteps(
    state: TrialWorkflowState, 
    targetPhase: WorkflowPhase,
    trial: any
  ): Promise<WorkflowStep[]> {
    const steps: WorkflowStep[] = [];

    // Define phase dependencies
    const phaseSteps: Record<WorkflowPhase, WorkflowStep[]> = {
      [WorkflowPhase.CONVERT]: [WorkflowStep.PDF_CONVERT],
      [WorkflowPhase.PHASE1]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [
          WorkflowStep.LLM_OVERRIDE,
          ...(this.config.autoReview?.overrides ? [] : [WorkflowStep.OVERRIDE_REVIEW]),
          WorkflowStep.OVERRIDE_IMPORT
        ] : [])
      ],
      [WorkflowPhase.PHASE2]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [
          WorkflowStep.LLM_OVERRIDE,
          ...(this.config.autoReview?.overrides ? [] : [WorkflowStep.OVERRIDE_REVIEW]),
          WorkflowStep.OVERRIDE_IMPORT
        ] : []),
        WorkflowStep.PHASE2,
        WorkflowStep.PHASE2_INDEX
      ],
      [WorkflowPhase.PHASE3]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [
          WorkflowStep.LLM_OVERRIDE,
          ...(this.config.autoReview?.overrides ? [] : [WorkflowStep.OVERRIDE_REVIEW]),
          WorkflowStep.OVERRIDE_IMPORT
        ] : []),
        WorkflowStep.PHASE2,
        WorkflowStep.PHASE2_INDEX,
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [
          WorkflowStep.LLM_MARKER_1,
          ...(this.config.autoReview?.markers1 ? [] : [WorkflowStep.MARKER1_REVIEW]),
          WorkflowStep.MARKER1_IMPORT
        ] : []),
        WorkflowStep.PHASE3,
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [
          WorkflowStep.LLM_MARKER_2,
          ...(this.config.autoReview?.markers2 ? [] : [WorkflowStep.MARKER2_REVIEW]),
          WorkflowStep.MARKER2_IMPORT
        ] : []),
        WorkflowStep.PHASE3_INDEX,
        ...(this.config.cleanupPhase2After && !this.config.skipOptional ? [WorkflowStep.PHASE2_CLEANUP] : [])
      ],
      [WorkflowPhase.COMPLETE]: [
        WorkflowStep.PDF_CONVERT,
        WorkflowStep.PHASE1,
        ...(this.config.enableLLMOverrides && !this.config.skipOptional ? [
          WorkflowStep.LLM_OVERRIDE,
          ...(this.config.autoReview?.overrides ? [] : [WorkflowStep.OVERRIDE_REVIEW]),
          WorkflowStep.OVERRIDE_IMPORT
        ] : []),
        WorkflowStep.PHASE2,
        WorkflowStep.PHASE2_INDEX,
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [
          WorkflowStep.LLM_MARKER_1,
          ...(this.config.autoReview?.markers1 ? [] : [WorkflowStep.MARKER1_REVIEW]),
          WorkflowStep.MARKER1_IMPORT
        ] : []),
        WorkflowStep.PHASE3,
        ...(this.config.enableLLMMarkers && !this.config.skipOptional ? [
          WorkflowStep.LLM_MARKER_2,
          ...(this.config.autoReview?.markers2 ? [] : [WorkflowStep.MARKER2_REVIEW]),
          WorkflowStep.MARKER2_IMPORT
        ] : []),
        WorkflowStep.PHASE3_INDEX,
        ...(this.config.cleanupPhase2After && !this.config.skipOptional ? [WorkflowStep.PHASE2_CLEANUP] : [])
      ]
    };

    const targetSteps = phaseSteps[targetPhase] || [];

    // Filter out already completed steps using smart detection
    for (const step of targetSteps) {
      const shouldRun = await this.shouldRunStep(state, step, trial);
      if (shouldRun) {
        steps.push(step);
      }
    }

    return steps;
  }

  /**
   * Smart detection to determine if a step should run
   */
  private async shouldRunStep(
    state: TrialWorkflowState,
    step: WorkflowStep,
    trial: any
  ): Promise<boolean> {
    // Force rerun overrides all checks
    if (this.config.forceRerun) {
      return true;
    }

    // Check basic completion flags first
    if (this.isStepCompleted(state, step)) {
      return false;
    }

    // Additional smart checks based on file existence
    switch (step) {
      case WorkflowStep.PDF_CONVERT:
        return await this.shouldRunPdfConvert(trial);
      
      case WorkflowStep.LLM_OVERRIDE:
        return await this.shouldRunLLMOverride(trial);
      
      case WorkflowStep.OVERRIDE_REVIEW:
        return await this.shouldRunOverrideReview(trial);
      
      case WorkflowStep.LLM_MARKER_1:
        return await this.shouldRunLLMMarker1(trial);
      
      case WorkflowStep.MARKER1_REVIEW:
        return await this.shouldRunMarker1Review(trial);
      
      case WorkflowStep.LLM_MARKER_2:
        return await this.shouldRunLLMMarker2(trial);
      
      case WorkflowStep.MARKER2_REVIEW:
        return await this.shouldRunMarker2Review(trial);
      
      default:
        return true; // Run if not completed
    }
  }

  /**
   * Check if PDF conversion should run
   */
  private async shouldRunPdfConvert(trial: any): Promise<boolean> {
    if (!this.config.outputDir) {
      logger.debug(`[shouldRunPdfConvert] No output directory configured, returning true`);
      return true;
    }

    const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
    const summaryPath = path.join(trialDir, 'conversion-summary.json');

    logger.debug(`[shouldRunPdfConvert] Checking trial: ${trial.shortName || trial.name}`);
    logger.debug(`[shouldRunPdfConvert] Summary path: ${summaryPath}`);

    if (!fs.existsSync(summaryPath)) {
      logger.info(`[shouldRunPdfConvert] No conversion summary found for ${trial.shortName || trial.name}, PDF conversion needed`);
      return true; // No summary, need to convert
    }

    try {
      const summary: ConversionSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      logger.debug(`[shouldRunPdfConvert] Conversion summary: complete=${summary.complete}, filesConverted=${summary.filesConverted?.length || 0}, metadataCopied=${summary.metadataCopied?.length || 0}`);
      
      if (!summary.complete) {
        logger.info(`[shouldRunPdfConvert] Conversion incomplete for ${trial.shortName || trial.name}, re-running PDF conversion`);
        return true;
      } else {
        logger.info(`[shouldRunPdfConvert] Conversion complete for ${trial.shortName || trial.name}, skipping PDF conversion`);
        return false;
      }
    } catch (error) {
      logger.error(`[shouldRunPdfConvert] Error reading conversion summary: ${error}`);
      return true; // Error reading, re-run
    }
  }

  /**
   * Check if LLM override generation should run
   */
  private async shouldRunLLMOverride(trial: any): Promise<boolean> {
    if (!this.config.outputDir) {
      logger.debug(`[shouldRunLLMOverride] No output directory configured, returning true`);
      return true;
    }

    const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
    const metadataPath = path.join(trialDir, 'trial-metadata.json');
    const summaryPath = path.join(trialDir, 'conversion-summary.json');

    logger.debug(`[shouldRunLLMOverride] Checking trial: ${trial.shortName || trial.name}`);
    logger.debug(`[shouldRunLLMOverride] Metadata path: ${metadataPath}`);
    logger.debug(`[shouldRunLLMOverride] Summary path: ${summaryPath}`);

    // Check for metadata file first
    if (!fs.existsSync(metadataPath)) {
      logger.info(`[shouldRunLLMOverride] No metadata file found for ${trial.shortName || trial.name}, LLM override needed`);
      return true; // No metadata file, need to generate
    }
    
    // If noRegenLLMMetadata is set and metadata exists, skip regeneration
    if (this.config.workflow?.noRegenLLMMetadata) {
      logger.info(`[shouldRunLLMOverride] noRegenLLMMetadata is set and metadata exists for ${trial.shortName || trial.name}, skipping LLM generation`);
      return false;
    }

    // Check if metadata was copied during PDF conversion
    if (fs.existsSync(summaryPath)) {
      try {
        const summary: ConversionSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        logger.debug(`[shouldRunLLMOverride] Conversion summary found, metadataCopied: ${JSON.stringify(summary.metadataCopied)}`);
        
        if (summary.metadataCopied && summary.metadataCopied.includes('trial-metadata.json')) {
          logger.info(`[shouldRunLLMOverride] Metadata was copied from input directory for ${trial.shortName || trial.name}, skipping LLM generation`);
          // Metadata was copied from input directory, don't regenerate with LLM
          return false;
        } else {
          logger.debug(`[shouldRunLLMOverride] Conversion summary exists but metadata was not copied`);
        }
      } catch (error) {
        logger.warn(`[shouldRunLLMOverride] Error reading conversion summary: ${error}`);
        // Ignore errors reading summary, continue with other checks
      }
    } else {
      logger.debug(`[shouldRunLLMOverride] No conversion summary found`);
    }

    // Check if metadata has userReviewed flag (indicating it's complete)
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      logger.debug(`[shouldRunLLMOverride] Metadata file exists, checking completion status`);
      
      // If metadata exists but doesn't have the metadata section or userReviewed flag,
      // it might be incomplete
      if (!metadata.metadata || metadata.metadata.userReviewed === undefined) {
        logger.info(`[shouldRunLLMOverride] Metadata incomplete for ${trial.shortName || trial.name}, regenerating`);
        return true; // Metadata incomplete, regenerate
      }
      
      logger.info(`[shouldRunLLMOverride] Metadata complete for ${trial.shortName || trial.name}, skipping LLM generation`);
      return false; // Metadata exists and is complete
    } catch (error) {
      logger.error(`[shouldRunLLMOverride] Error reading metadata file: ${error}`);
      return true; // Error reading, regenerate
    }
  }

  /**
   * Check if override review is needed
   */
  private async shouldRunOverrideReview(trial: any): Promise<boolean> {
    if (this.config.autoReview?.overrides) {
      return false; // Auto-approved, skip review
    }

    if (!this.config.outputDir) return true;

    const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
    const overrideFiles = ['Attorney.json', 'Witness.json', 'Trial.json'];

    for (const file of overrideFiles) {
      const filePath = path.join(trialDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const metadata = content.metadata as OverrideMetadata;
          if (!metadata?.userReviewed) {
            return true; // Needs review
          }
        } catch {
          return true; // Error reading, needs review
        }
      }
    }

    return false; // All reviewed
  }

  /**
   * Similar checks for marker files
   */
  private async shouldRunLLMMarker1(trial: any): Promise<boolean> {
    if (!this.config.outputDir) return true;

    const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
    const markerPath = path.join(trialDir, 'markers-phase2.json');

    return !fs.existsSync(markerPath);
  }

  private async shouldRunMarker1Review(trial: any): Promise<boolean> {
    if (this.config.autoReview?.markers1) {
      return false;
    }

    if (!this.config.outputDir) return true;

    const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
    const markerPath = path.join(trialDir, 'markers-phase2.json');

    if (fs.existsSync(markerPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        const metadata = content.metadata as OverrideMetadata;
        return !metadata?.userReviewed;
      } catch {
        return true;
      }
    }

    return true;
  }

  private async shouldRunLLMMarker2(trial: any): Promise<boolean> {
    if (!this.config.outputDir) return true;

    const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
    const markerPath = path.join(trialDir, 'markers-phase3.json');

    return !fs.existsSync(markerPath);
  }

  private async shouldRunMarker2Review(trial: any): Promise<boolean> {
    if (this.config.autoReview?.markers2) {
      return false;
    }

    if (!this.config.outputDir) return true;

    const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
    const markerPath = path.join(trialDir, 'markers-phase3.json');

    if (fs.existsSync(markerPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
        const metadata = content.metadata as OverrideMetadata;
        return !metadata?.userReviewed;
      } catch {
        return true;
      }
    }

    return true;
  }

  /**
   * Check if a step is completed based on state flags
   */
  private isStepCompleted(state: TrialWorkflowState, step: WorkflowStep): boolean {
    const stepCompletionMap: Record<WorkflowStep, boolean> = {
      [WorkflowStep.PDF_CONVERT]: state.pdfConvertCompleted,
      [WorkflowStep.LLM_OVERRIDE]: state.llmOverrideCompleted,
      [WorkflowStep.OVERRIDE_REVIEW]: state.overrideReviewCompleted,
      [WorkflowStep.OVERRIDE_IMPORT]: state.overrideImportCompleted,
      [WorkflowStep.PHASE1]: state.phase1Completed,
      [WorkflowStep.PHASE2]: state.phase2Completed,
      [WorkflowStep.PHASE2_INDEX]: state.phase2IndexCompleted,
      [WorkflowStep.LLM_MARKER_1]: state.llmMarker1Completed,
      [WorkflowStep.MARKER1_REVIEW]: state.marker1ReviewCompleted,
      [WorkflowStep.MARKER1_IMPORT]: state.marker1ImportCompleted,
      [WorkflowStep.PHASE3]: state.phase3Completed,
      [WorkflowStep.LLM_MARKER_2]: state.llmMarker2Completed,
      [WorkflowStep.MARKER2_REVIEW]: state.marker2ReviewCompleted,
      [WorkflowStep.MARKER2_IMPORT]: state.marker2ImportCompleted,
      [WorkflowStep.PHASE3_INDEX]: state.phase3IndexCompleted,
      [WorkflowStep.PHASE2_CLEANUP]: state.phase2CleanupCompleted
    };

    return stepCompletionMap[step] || false;
  }

  /**
   * Log entity counts for debugging
   */
  private async logEntityCounts(context: string): Promise<void> {
    const attorneyCount = await this.prisma.attorney.count();
    const lawFirmCount = await this.prisma.lawFirm.count();
    const speakerCount = await this.prisma.speaker.count();
    const trialAttorneyCount = await this.prisma.trialAttorney.count();
    
    logger.info(`\n📊 [${context}] Entity counts:`);
    logger.info(`   Attorneys: ${attorneyCount}`);
    logger.info(`   Law Firms: ${lawFirmCount}`);
    logger.info(`   Speakers: ${speakerCount}`);
    logger.info(`   Trial Attorneys: ${trialAttorneyCount}\n`);
  }

  /**
   * Execute a workflow step
   */
  private async executeStep(trialId: number, step: WorkflowStep, trial: any): Promise<StepResult> {
    try {
      // Log counts before the step
      //await this.logEntityCounts(`BEFORE ${step}`);
      
      let result: StepResult;
      switch (step) {
        case WorkflowStep.PDF_CONVERT:
          result = await this.executePdfConvert(trialId, trial);
          break;
        case WorkflowStep.LLM_OVERRIDE:
          result = await this.executeLLMOverride(trialId, trial);
          break;
        case WorkflowStep.OVERRIDE_REVIEW:
          result = await this.executeOverrideReview(trialId, trial);
          break;
        case WorkflowStep.OVERRIDE_IMPORT:
          result = await this.executeOverrideImport(trialId, trial);
          break;
        case WorkflowStep.PHASE1:
          result = await this.executePhase1(trialId, trial);
          break;
        case WorkflowStep.PHASE2:
          result = await this.executePhase2(trialId);
          break;
        case WorkflowStep.PHASE2_INDEX:
          result = await this.executePhase2Index(trialId);
          break;
        case WorkflowStep.LLM_MARKER_1:
          result = await this.executeLLMMarker1(trialId, trial);
          break;
        case WorkflowStep.MARKER1_REVIEW:
          result = await this.executeMarker1Review(trialId, trial);
          break;
        case WorkflowStep.MARKER1_IMPORT:
          result = await this.executeMarker1Import(trialId, trial);
          break;
        case WorkflowStep.PHASE3:
          result = await this.executePhase3(trialId);
          break;
        case WorkflowStep.LLM_MARKER_2:
          result = await this.executeLLMMarker2(trialId, trial);
          break;
        case WorkflowStep.MARKER2_REVIEW:
          result = await this.executeMarker2Review(trialId, trial);
          break;
        case WorkflowStep.MARKER2_IMPORT:
          result = await this.executeMarker2Import(trialId, trial);
          break;
        case WorkflowStep.PHASE3_INDEX:
          result = await this.executePhase3Index(trialId);
          break;
        case WorkflowStep.PHASE2_CLEANUP:
          result = await this.executePhase2Cleanup(trialId);
          break;
        default:
          throw new Error(`Unknown step: ${step}`);
      }
      
      // Log counts after the step
      await this.logEntityCounts(`AFTER ${step}`);
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Enhanced PDF conversion with summary generation
   */
  private async executePdfConvert(trialId: number, trial: any): Promise<StepResult> {
    if (!this.config.configFile) {
      return { success: false, message: 'Config file not specified' };
    }

    try {
      // Check if conversion is actually needed
      const trialDir = path.join(this.config.outputDir || 'output/multi-trial', trial.shortName || trial.name);
      const summaryPath = path.join(trialDir, 'conversion-summary.json');
      
      // Get source directory from config file
      const configContent = fs.readFileSync(this.config.configFile, 'utf-8');
      const fullConfig = JSON.parse(configContent);
      const sourceDir = path.join(fullConfig.inputDir || '', trial.shortName || trial.name);
      
      // Check if we need to run full conversion
      let needsFullConversion = true;
      let needsMetadataSync = false;
      
      if (fs.existsSync(summaryPath)) {
        try {
          const existingSummary: ConversionSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
          if (existingSummary.complete) {
            // Check if we need to sync metadata files
            needsMetadataSync = await this.hasNewerSourceFiles(sourceDir, trialDir, existingSummary);
            needsFullConversion = false; // PDFs already converted
            
            if (!needsMetadataSync) {
              if (this.config.verbose) {
                console.log(`Skipping PDF conversion for ${trial.shortName}: already complete and up to date`);
              }
              return { success: true, message: 'Conversion already complete' };
            }
          }
        } catch (e) {
          // Error reading summary, run full conversion
          needsFullConversion = true;
        }
      }
      
      if (needsFullConversion) {
        // Run full PDF conversion
        const trialFilter = trial?.shortName ? ` --trial "${trial.shortName}"` : '';
        const command = `npx ts-node src/cli/convert-pdf.ts "${this.config.configFile}"${trialFilter}`;
        if (this.config.verbose) {
          console.log(`Running: ${command}`);
        }
        execSync(command, { 
          stdio: this.config.verbose ? 'inherit' : 'pipe',
          timeout: this.config.execTimeout || 600000 // Default 10 minutes, configurable
        });
      } else if (needsMetadataSync) {
        // Just sync metadata files without converting PDFs
        if (this.config.verbose) {
          console.log(`Syncing metadata files for ${trial.shortName}`);
        }
        
        // Copy newer metadata files
        const metadataFiles = ['trial-metadata.json', 'Attorney.json', 'Witness.json', 'Trial.json'];
        for (const metaFile of metadataFiles) {
          const sourcePath = path.join(sourceDir, metaFile);
          const destPath = path.join(trialDir, metaFile);
          
          if (fs.existsSync(sourcePath)) {
            // Check if source is newer or dest doesn't exist
            if (!fs.existsSync(destPath) || 
                fs.statSync(sourcePath).mtime > fs.statSync(destPath).mtime) {
              fs.copyFileSync(sourcePath, destPath);
              if (this.config.verbose) {
                console.log(`  Copied ${metaFile} to destination`);
              }
            }
          }
        }
        
        // Update conversion summary to reflect metadata sync
        const existingSummary: ConversionSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
        existingSummary.timestamp = new Date().toISOString();
        existingSummary.metadataCopied = metadataFiles.filter(f => 
          fs.existsSync(path.join(sourceDir, f))
        );
        fs.writeFileSync(summaryPath, JSON.stringify(existingSummary, null, 2));
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }
  
  private async hasNewerSourceFiles(sourceDir: string, destDir: string, summary: ConversionSummary): Promise<boolean> {
    // Check if trial-metadata.json exists in source but not dest
    const sourceMetadata = path.join(sourceDir, 'trial-metadata.json');
    const destMetadata = path.join(destDir, 'trial-metadata.json');
    
    if (fs.existsSync(sourceMetadata) && !fs.existsSync(destMetadata)) {
      return true; // Need to copy metadata
    }
    
    // Check if source metadata is newer than dest
    if (fs.existsSync(sourceMetadata) && fs.existsSync(destMetadata)) {
      const sourceStat = fs.statSync(sourceMetadata);
      const destStat = fs.statSync(destMetadata);
      if (sourceStat.mtime > destStat.mtime) {
        return true; // Source is newer
      }
    }
    
    // TODO: Check PDF files for newer versions
    
    return false; // No newer files found
  }

  /**
   * Execute LLM override generation
   */
  private async executeLLMOverride(trialId: number, trial: any): Promise<StepResult> {
    try {
      const trialPath = path.join(this.config.outputDir || 'output/multi-trial', trial.shortName || trial.name);
      const outputFile = path.join(trialPath, 'trial-metadata.json');
      const command = `npx ts-node src/cli/override.ts extract --trial-path "${trialPath}" --output "${outputFile}"`;
      if (this.config.verbose) {
        console.log(`Running: ${command}`);
      }
      execSync(command, { 
        stdio: this.config.verbose ? 'inherit' : 'ignore', // Use 'ignore' instead of 'pipe' to avoid buffer overflow
        timeout: this.config.execTimeout || 600000, // Default 10 minutes, configurable
        maxBuffer: this.config.maxBuffer || 209715200 // Use config maxBuffer or default to 200MB
      });

      // Set auto-review if configured
      if (this.config.autoReview?.overrides && this.config.outputDir) {
        const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
        const overrideFiles = ['Attorney.json', 'Witness.json', 'Trial.json'];

        for (const file of overrideFiles) {
          const filePath = path.join(trialDir, file);
          if (fs.existsSync(filePath)) {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            content.metadata = {
              ...content.metadata,
              userReviewed: true,
              reviewedAt: new Date().toISOString(),
              reviewedBy: 'auto-review'
            };
            fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Check if override review is needed
   */
  private async executeOverrideReview(trialId: number, trial: any): Promise<StepResult> {
    // Never require review if autoReview is enabled
    if (this.config.autoReview?.overrides) {
      return { success: true };
    }
    
    const needsReview = await this.shouldRunOverrideReview(trial);
    
    if (needsReview) {
      return { 
        success: true, 
        requiresReview: true,
        message: 'Override files need user review'
      };
    }

    return { success: true };
  }

  /**
   * Import reviewed overrides
   */
  private async executeOverrideImport(trialId: number, trial: any): Promise<StepResult> {
    if (!this.config.outputDir) {
      return { success: false, message: 'Output directory not specified' };
    }

    try {
      const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
      
      // First check for trial-metadata.json (the new format)
      const trialMetadataPath = path.join(trialDir, 'trial-metadata.json');
      
      if (fs.existsSync(trialMetadataPath)) {
        // Import trial-metadata.json
        const command = `npx ts-node src/cli/override.ts import "${trialMetadataPath}"`;
        if (this.config.verbose) {
          console.log(`Running: ${command}`);
        }
        execSync(command, { 
          stdio: this.config.verbose ? 'inherit' : 'pipe',
          timeout: this.config.execTimeout || 600000 // Default 10 minutes, configurable
        });
      } else {
        // Fall back to old format files if trial-metadata.json doesn't exist
        const overrideFiles = ['Attorney.json', 'Witness.json', 'Trial.json'];

        for (const file of overrideFiles) {
          const filePath = path.join(trialDir, file);
          if (fs.existsSync(filePath)) {
            const command = `npx ts-node src/cli/override.ts import "${filePath}"`;
            if (this.config.verbose) {
              console.log(`Running: ${command}`);
            }
            execSync(command, { 
              stdio: this.config.verbose ? 'inherit' : 'pipe',
              timeout: this.config.execTimeout || 600000 // Default 10 minutes, configurable
            });
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Execute Phase 1 parsing
   */
  private async executePhase1(trialId: number, trial?: any): Promise<StepResult> {
    if (!this.config.configFile) {
      return { success: false, message: 'Config file not specified' };
    }

    try {
      // Pass trial name to filter to single trial
      const trialFilter = trial?.shortName ? ` --trial "${trial.shortName}"` : '';
      const command = `npx ts-node src/cli/parse.ts parse --phase1 --config ${this.config.configFile}${trialFilter}`;
      if (this.config.verbose) {
        console.log(`Running: ${command}`);
      }
      execSync(command, { 
        stdio: this.config.verbose ? 'inherit' : 'ignore', // Use 'ignore' instead of 'pipe' to avoid buffer overflow
        timeout: this.config.execTimeout || 600000, // Default 10 minutes, configurable
        maxBuffer: this.config.maxBuffer || 209715200 // Use config maxBuffer or default to 200MB
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
      // Pass trial ID to filter to single trial
      const command = `npx ts-node src/cli/parse.ts parse --phase2 --config ${this.config.configFile} --trial-id ${trialId}`;
      if (this.config.verbose) {
        console.log(`Running: ${command}`);
      }
      
      // Try with pipe first to capture errors, fall back to ignore if buffer issues
      try {
        execSync(command, { 
          stdio: this.config.verbose ? 'inherit' : ['ignore', 'ignore', 'pipe'], // Capture stderr only
          timeout: this.config.execTimeout || 600000,
          maxBuffer: this.config.maxBuffer || 209715200
        });
      } catch (execError: any) {
        // If it's a buffer error, retry with ignore
        if (execError.code === 'ENOBUFS') {
          console.log('⚠️ Buffer overflow detected, retrying with output suppression...');
          execSync(command, { 
            stdio: this.config.verbose ? 'inherit' : 'ignore',
            timeout: this.config.execTimeout || 600000,
            maxBuffer: this.config.maxBuffer || 209715200
          });
        } else {
          // Log the actual error
          console.error(`Phase2 error output: ${execError.stderr?.toString() || execError.message}`);
          throw execError;
        }
      }
      
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
        stdio: this.config.verbose ? 'inherit' : 'ignore', // Use 'ignore' instead of 'pipe' to avoid buffer overflow
        timeout: this.config.execTimeout || 600000, // Default 10 minutes, configurable
        maxBuffer: this.config.maxBuffer || 209715200 // Use config maxBuffer or default to 200MB
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error as Error };
    }
  }

  /**
   * Execute LLM marker generation (Phase 2)
   */
  private async executeLLMMarker1(trialId: number, trial: any): Promise<StepResult> {
    // TODO: Implement actual LLM marker generation
    console.log('LLM marker generation (post-Phase2) not yet fully implemented');
    
    // Create placeholder file for testing
    if (this.config.outputDir) {
      const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
      const markerData = {
        metadata: {
          generatedAt: new Date().toISOString(),
          llmModel: 'gpt-4',
          userReviewed: this.config.autoReview?.markers1 === true,  // Ensure boolean
          phase: 'post-phase2'
        },
        markers: []
      };

      fs.mkdirSync(trialDir, { recursive: true });
      fs.writeFileSync(
        path.join(trialDir, 'markers-phase2.json'),
        JSON.stringify(markerData, null, 2)
      );
    }

    return { success: true };
  }

  /**
   * Check if marker review is needed (Phase 2)
   */
  private async executeMarker1Review(trialId: number, trial: any): Promise<StepResult> {
    // Never require review if autoReview is enabled
    if (this.config.autoReview?.markers1) {
      return { success: true };
    }
    
    const needsReview = await this.shouldRunMarker1Review(trial);
    
    if (needsReview) {
      return { 
        success: true, 
        requiresReview: true,
        message: 'Phase 2 markers need user review'
      };
    }

    return { success: true };
  }

  /**
   * Import Phase 2 markers
   */
  private async executeMarker1Import(trialId: number, trial: any): Promise<StepResult> {
    // TODO: Implement marker import
    console.log('Marker import (Phase 2) not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Execute LLM marker generation (Phase 3)
   */
  private async executeLLMMarker2(trialId: number, trial: any): Promise<StepResult> {
    // TODO: Implement actual LLM marker generation
    console.log('LLM marker generation (post-Phase3) not yet fully implemented');
    
    // Create placeholder file for testing
    if (this.config.outputDir) {
      const trialDir = path.join(this.config.outputDir, trial.shortName || trial.name);
      const markerData = {
        metadata: {
          generatedAt: new Date().toISOString(),
          llmModel: 'gpt-4',
          userReviewed: this.config.autoReview?.markers2 === true,  // Ensure boolean
          phase: 'post-phase3'
        },
        markers: []
      };

      fs.mkdirSync(trialDir, { recursive: true });
      fs.writeFileSync(
        path.join(trialDir, 'markers-phase3.json'),
        JSON.stringify(markerData, null, 2)
      );
    }

    return { success: true };
  }

  /**
   * Check if marker review is needed (Phase 3)
   */
  private async executeMarker2Review(trialId: number, trial: any): Promise<StepResult> {
    // Never require review if autoReview is enabled
    if (this.config.autoReview?.markers2) {
      return { success: true };
    }
    
    const needsReview = await this.shouldRunMarker2Review(trial);
    
    if (needsReview) {
      return { 
        success: true, 
        requiresReview: true,
        message: 'Phase 3 markers need user review'
      };
    }

    return { success: true };
  }

  /**
   * Import Phase 3 markers
   */
  private async executeMarker2Import(trialId: number, trial: any): Promise<StepResult> {
    // TODO: Implement marker import
    console.log('Marker import (Phase 3) not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Phase 2 indexing
   */
  private async executePhase2Index(trialId: number): Promise<StepResult> {
    // Phase 2 automatically indexes to Elasticsearch during processing
    return { success: true, message: 'Indexed during Phase 2 processing' };
  }

  /**
   * Phase 3 indexing
   */
  private async executePhase3Index(trialId: number): Promise<StepResult> {
    // Phase 3 indexing if needed
    return { success: true, message: 'Phase 3 indexing complete' };
  }

  /**
   * Phase 2 cleanup
   */
  private async executePhase2Cleanup(trialId: number): Promise<StepResult> {
    // TODO: Implement cleanup logic
    console.log('Phase 2 cleanup not yet implemented');
    return { success: true, message: 'Skipped (not implemented)' };
  }

  /**
   * Create initial workflow state
   */
  private async createWorkflowState(trialId: number): Promise<TrialWorkflowState> {
    return await this.prisma.trialWorkflowState.create({
      data: {
        trialId,
        currentStatus: WorkflowStatus.NOT_STARTED
      }
    });
  }

  /**
   * Update workflow status
   */
  private async updateWorkflowStatus(trialId: number, status: WorkflowStatus): Promise<void> {
    await this.prisma.trialWorkflowState.update({
      where: { trialId },
      data: { currentStatus: status }
    });
  }

  /**
   * Update step completion state
   */
  private async updateStepState(trialId: number, step: WorkflowStep, completed: boolean, duration?: number): Promise<void> {
    const updateData: any = {};
    const now = new Date();

    switch (step) {
      case WorkflowStep.PDF_CONVERT:
        updateData.pdfConvertCompleted = completed;
        if (completed) updateData.pdfConvertAt = now;
        break;
      case WorkflowStep.LLM_OVERRIDE:
        updateData.llmOverrideCompleted = completed;
        if (completed) updateData.llmOverrideAt = now;
        break;
      case WorkflowStep.OVERRIDE_REVIEW:
        updateData.overrideReviewCompleted = completed;
        if (completed) updateData.overrideReviewAt = now;
        break;
      case WorkflowStep.OVERRIDE_IMPORT:
        updateData.overrideImportCompleted = completed;
        if (completed) updateData.overrideImportAt = now;
        break;
      case WorkflowStep.PHASE1:
        updateData.phase1Completed = completed;
        if (completed) updateData.phase1CompletedAt = now;
        break;
      case WorkflowStep.PHASE2:
        updateData.phase2Completed = completed;
        if (completed) updateData.phase2CompletedAt = now;
        break;
      case WorkflowStep.PHASE2_INDEX:
        updateData.phase2IndexCompleted = completed;
        if (completed) updateData.phase2IndexAt = now;
        break;
      case WorkflowStep.LLM_MARKER_1:
        updateData.llmMarker1Completed = completed;
        if (completed) updateData.llmMarker1At = now;
        break;
      case WorkflowStep.MARKER1_REVIEW:
        updateData.marker1ReviewCompleted = completed;
        if (completed) updateData.marker1ReviewAt = now;
        break;
      case WorkflowStep.MARKER1_IMPORT:
        updateData.marker1ImportCompleted = completed;
        if (completed) updateData.marker1ImportAt = now;
        break;
      case WorkflowStep.PHASE3:
        updateData.phase3Completed = completed;
        if (completed) updateData.phase3CompletedAt = now;
        break;
      case WorkflowStep.LLM_MARKER_2:
        updateData.llmMarker2Completed = completed;
        if (completed) updateData.llmMarker2At = now;
        break;
      case WorkflowStep.MARKER2_REVIEW:
        updateData.marker2ReviewCompleted = completed;
        if (completed) updateData.marker2ReviewAt = now;
        break;
      case WorkflowStep.MARKER2_IMPORT:
        updateData.marker2ImportCompleted = completed;
        if (completed) updateData.marker2ImportAt = now;
        break;
      case WorkflowStep.PHASE3_INDEX:
        updateData.phase3IndexCompleted = completed;
        if (completed) updateData.phase3IndexAt = now;
        break;
      case WorkflowStep.PHASE2_CLEANUP:
        updateData.phase2CleanupCompleted = completed;
        if (completed) updateData.phase2CleanupAt = now;
        break;
    }

    await this.prisma.trialWorkflowState.update({
      where: { trialId },
      data: updateData
    });
  }

  /**
   * Update error state
   */
  private async updateErrorState(trialId: number, step: WorkflowStep, error?: Error): Promise<void> {
    await this.prisma.trialWorkflowState.update({
      where: { trialId },
      data: {
        lastError: error?.message || `Error at step: ${step}`,
        lastErrorAt: new Date(),
        retryCount: { increment: 1 }
      }
    });
  }

  /**
   * Get status for a step
   */
  private getStatusForStep(step: WorkflowStep, phase: 'running' | 'review'): WorkflowStatus {
    if (phase === 'running') {
      switch (step) {
        case WorkflowStep.PDF_CONVERT: return WorkflowStatus.PDF_CONVERTING;
        case WorkflowStep.LLM_OVERRIDE: return WorkflowStatus.GENERATING_OVERRIDES;
        case WorkflowStep.OVERRIDE_IMPORT: return WorkflowStatus.IMPORTING_OVERRIDES;
        case WorkflowStep.PHASE1: return WorkflowStatus.PHASE1_PROCESSING;
        case WorkflowStep.PHASE2: return WorkflowStatus.PHASE2_PROCESSING;
        case WorkflowStep.LLM_MARKER_1: return WorkflowStatus.GENERATING_MARKERS_1;
        case WorkflowStep.MARKER1_IMPORT: return WorkflowStatus.IMPORTING_MARKERS_1;
        case WorkflowStep.PHASE3: return WorkflowStatus.PHASE3_PROCESSING;
        case WorkflowStep.LLM_MARKER_2: return WorkflowStatus.GENERATING_MARKERS_2;
        case WorkflowStep.MARKER2_IMPORT: return WorkflowStatus.IMPORTING_MARKERS_2;
        default: return WorkflowStatus.IN_PROGRESS;
      }
    } else {
      switch (step) {
        case WorkflowStep.OVERRIDE_REVIEW: return WorkflowStatus.AWAITING_OVERRIDE_REVIEW;
        case WorkflowStep.MARKER1_REVIEW: return WorkflowStatus.AWAITING_MARKER1_REVIEW;
        case WorkflowStep.MARKER2_REVIEW: return WorkflowStatus.AWAITING_MARKER2_REVIEW;
        default: return WorkflowStatus.PAUSED;
      }
    }
  }

  /**
   * Get sync command for review step
   */
  private getReviewSyncCommand(step: WorkflowStep): string {
    switch (step) {
      case WorkflowStep.OVERRIDE_REVIEW: return 'overrides';
      case WorkflowStep.MARKER1_REVIEW: return 'markers --phase 1';
      case WorkflowStep.MARKER2_REVIEW: return 'markers --phase 2';
      default: return '';
    }
  }

  /**
   * Get workflow status for a specific trial
   */
  public async getWorkflowStatus(trialId: number): Promise<any> {
    const trial = await this.prisma.trial.findUnique({
      where: { id: trialId },
      include: {
        workflowState: true,
        _count: {
          select: {
            sessions: true,
            attorneys: true,
            witnesses: true
          }
        }
      }
    });

    if (!trial) {
      throw new Error(`Trial ${trialId} not found`);
    }

    return {
      trial: {
        id: trial.id,
        name: trial.name,
        caseNumber: trial.caseNumber,
        shortName: trial.shortName
      },
      status: trial.workflowState?.currentStatus || WorkflowStatus.NOT_STARTED,
      stats: trial._count,
      workflowState: trial.workflowState
    };
  }

  /**
   * Get workflow status for all trials
   */
  public async getAllWorkflowStatus(): Promise<any[]> {
    const trials = await this.prisma.trial.findMany({
      include: {
        workflowState: true,
        _count: {
          select: {
            sessions: true,
            attorneys: true,
            witnesses: true
          }
        }
      }
    });

    return trials.map(trial => ({
      trial: {
        id: trial.id,
        name: trial.name,
        caseNumber: trial.caseNumber,
        shortName: trial.shortName
      },
      status: trial.workflowState?.currentStatus || WorkflowStatus.NOT_STARTED,
      stats: trial._count,
      workflowState: trial.workflowState
    }));
  }
}