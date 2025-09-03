/**
 * Type definitions for Trial Transcript State Management (Feature 03F)
 */

// Workflow step names
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

// Workflow phases (groups of steps)
export enum WorkflowPhase {
  CONVERT = 'convert',
  PHASE1 = 'phase1',
  PHASE2 = 'phase2',
  PHASE3 = 'phase3',
  COMPLETE = 'complete'
}

// LLM task status
export enum LLMTaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED'
}

// Step status for tracking
export enum StepStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED'
}

// Workflow state interface
export interface TrialWorkflowState {
  id: number;
  trialId: number;
  
  // Step completion tracking
  pdfConvertCompleted: boolean;
  pdfConvertAt?: Date;
  phase1Completed: boolean;
  phase1CompletedAt?: Date;
  llmOverrideCompleted: boolean;
  llmOverrideAt?: Date;
  overrideImportCompleted: boolean;
  overrideImportAt?: Date;
  phase2Completed: boolean;
  phase2CompletedAt?: Date;
  phase2IndexCompleted: boolean;
  phase2IndexAt?: Date;
  phase3Completed: boolean;
  phase3CompletedAt?: Date;
  llmMarkerCompleted: boolean;
  llmMarkerAt?: Date;
  markerImportCompleted: boolean;
  markerImportAt?: Date;
  phase3IndexCompleted: boolean;
  phase3IndexAt?: Date;
  phase2CleanupCompleted: boolean;
  phase2CleanupAt?: Date;
  
  // Configuration paths
  trialStylePath?: string;
  overrideFilesPath?: string;
  sourcePdfPath?: string;
  destinationTxtPath?: string;
  
  // LLM task tracking
  llmOverrideTaskId?: string;
  llmOverrideStatus: LLMTaskStatus;
  llmMarkerTaskId?: string;
  llmMarkerStatus: LLMTaskStatus;
  
  // Error tracking
  lastError?: string;
  lastErrorAt?: Date;
  retryCount: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Workflow configuration
export interface WorkflowConfig {
  enableLLMOverrides: boolean;
  enableLLMMarkers: boolean;
  cleanupPhase2After: boolean;
  phase2RetentionHours: number;
  
  overrides: {
    mode: 'merge' | 'replace' | 'manual';
    files: {
      attorneys?: string;
      judge?: string;
      witnesses?: string;
      metadata?: string;
    };
  };
  
  llm?: {
    provider: string;
    model: string;
    maxRetries: number;
    timeout: number;
  };
}

// Step definition
export interface StepDefinition {
  name: WorkflowStep;
  description: string;
  required: boolean;
  enabled: boolean;
  dependencies: WorkflowStep[];
  handler: StepHandler;
}

// Step handler function type
export type StepHandler = (
  trialId: number,
  config: WorkflowConfig,
  context: WorkflowContext
) => Promise<StepResult>;

// Step execution result
export interface StepResult {
  success: boolean;
  message?: string;
  error?: Error;
  data?: any;
  duration?: number;
}

// Workflow execution context
export interface WorkflowContext {
  trialId: number;
  trialName: string;
  config: WorkflowConfig;
  state: TrialWorkflowState;
  logger: WorkflowLogger;
  events: WorkflowEventEmitter;
}

// Workflow logger interface
export interface WorkflowLogger {
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, error?: Error): void;
  debug(message: string, data?: any): void;
}

// Workflow event emitter
export interface WorkflowEventEmitter {
  emit(event: WorkflowEvent, data?: any): void;
  on(event: WorkflowEvent, handler: (data?: any) => void): void;
}

// Workflow events
export enum WorkflowEvent {
  WORKFLOW_STARTED = 'workflow.started',
  WORKFLOW_COMPLETED = 'workflow.completed',
  WORKFLOW_FAILED = 'workflow.failed',
  STEP_STARTED = 'step.started',
  STEP_COMPLETED = 'step.completed',
  STEP_FAILED = 'step.failed',
  STEP_SKIPPED = 'step.skipped',
  LLM_TASK_STARTED = 'llm.task.started',
  LLM_TASK_COMPLETED = 'llm.task.completed',
  LLM_TASK_FAILED = 'llm.task.failed'
}

// Workflow execution options
export interface WorkflowExecutionOptions {
  targetPhase: WorkflowPhase;
  resetSystem?: boolean;
  forceRerun?: boolean;
  skipOptional?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

// Workflow status summary
export interface WorkflowStatusSummary {
  trialId: number;
  trialName: string;
  currentPhase: WorkflowPhase;
  completionPercentage: number;
  completedSteps: WorkflowStep[];
  pendingSteps: WorkflowStep[];
  failedSteps: WorkflowStep[];
  skippedSteps: WorkflowStep[];
  nextStep?: WorkflowStep;
  estimatedTimeRemaining?: string;
  lastActivity?: Date;
  errors?: Array<{
    step: WorkflowStep;
    error: string;
    timestamp: Date;
  }>;
}

// Multi-trial workflow status
export interface MultiTrialWorkflowStatus {
  totalTrials: number;
  completedTrials: number;
  inProgressTrials: number;
  failedTrials: number;
  trials: WorkflowStatusSummary[];
  startedAt?: Date;
  completedAt?: Date;
  estimatedCompletionTime?: Date;
}

// Override file structure
export interface OverrideFile {
  type: 'attorneys' | 'judge' | 'witnesses' | 'metadata';
  path: string;
  data: any;
  source: 'manual' | 'llm' | 'imported';
  timestamp: Date;
}

// LLM task request
export interface LLMTaskRequest {
  taskId: string;
  trialId: number;
  type: 'override' | 'marker';
  prompt: string;
  context: any;
  config: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
}

// LLM task response
export interface LLMTaskResponse {
  taskId: string;
  status: LLMTaskStatus;
  result?: any;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}