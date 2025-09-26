export type PostProcessorMode = 'NONE' | 'NORMALIZEWITNESS';

export interface PostProcessorConfig {
  mode: PostProcessorMode;
  trialId: string;
  outputDir: string;
  trialMetadataPath?: string;
}

export interface AttorneyMapping {
  speakerPrefix: string;
  side: 'PLAINTIFF' | 'DEFENDANT';
  fullName: string;
}

export interface PostProcessorResult {
  success: boolean;
  mode: PostProcessorMode;
  filesProcessed: number;
  backupSuffix?: string;
  error?: string;
  timestamp: string;
}

export interface ConversionSummary {
  postProcessorMode?: PostProcessorMode;
  postProcessorCompleted?: boolean;
  postProcessorTimestamp?: string;
  filesProcessed?: number;
  backupSuffix?: string;
  [key: string]: any;
}