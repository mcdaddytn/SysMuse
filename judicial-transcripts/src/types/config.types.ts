// src/types/config.types.ts
import { 
  WitnessType as PrismaWitnessType,
  WitnessCaller as PrismaWitnessCaller,
  ExaminationType as PrismaExaminationType,
  SwornStatus as PrismaSwornStatus,
  SpeakerType as PrismaSpeakerType,
  EventType as PrismaEventType
} from '@prisma/client';

export interface TranscriptConfig {
  inputDir: string;
  outputDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  batchSize: number;
  enableElasticSearch: boolean;
  elasticSearchUrl?: string;
  trial?: {
    name?: string;
    caseNumber?: string;
    court?: string;
    courtDivision?: string;
    courtDistrict?: string;
  };
}

export interface SessionInfo {
  sessionDate: Date;
  sessionType: 'MORNING' | 'AFTERNOON' | 'SPECIAL' | 'BENCH_TRIAL' | 'JURY_VERDICT' | 'OTHER';
  fileName?: string;
  documentNumber?: number;
}

export interface ParsedLine {
  lineNumber: number;
  timestamp?: string;
  text?: string;
  speakerPrefix?: string;
  isBlank: boolean;
}

export interface SummaryInfo {
  caseInfo: {
    name: string;
    caseNumber: string;
    court: string;
    courtDivision?: string;
    courtDistrict?: string;
  };
  judge?: {
    name: string;
    title?: string;
    honorific?: string;
  };
  courtReporter?: {
    name: string;
    credentials?: string;
    title?: string;
    stateNumber?: string;
    expirationDate?: Date;
    phone?: string;
    address?: AddressInfo;
  };
  plaintiffAttorneys: AttorneyInfo[];
  defendantAttorneys: AttorneyInfo[];
}

export interface AttorneyInfo {
  name: string;
  title?: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  suffix?: string;
  speakerPrefix?: string;
  barNumber?: string;
  lawFirm?: {
    name: string;
    office?: {
      name: string;
      address?: AddressInfo;
    };
  };
}

export interface AddressInfo {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

// Speaker-related types
export interface SpeakerInfo {
  id: number;
  speakerPrefix: string;
  speakerHandle?: string;
  speakerType: SpeakerType;
  name?: string;
  attorneyId?: number;
  witnessId?: number;
  jurorId?: number;
  judgeId?: number;
}

// Re-export Prisma enums with proper const assertions
export type SpeakerType = PrismaSpeakerType;
export const SpeakerType = {
  ATTORNEY: 'ATTORNEY' as const,
  JUDGE: 'JUDGE' as const,
  WITNESS: 'WITNESS' as const,
  JUROR: 'JUROR' as const,
  ANONYMOUS: 'ANONYMOUS' as const
};

// Witness-related types
export interface WitnessInfo {
  id: number;
  name?: string;
  firstName?: string;
  middleInitial?: string;
  lastName?: string;
  suffix?: string;
  displayName?: string;
  witnessType?: WitnessType;
  witnessCaller?: WitnessCaller;
  expertField?: string;
  speakerId?: number;
  swornStatus?: SwornStatus;
}

export type WitnessType = PrismaWitnessType;
export type WitnessCaller = PrismaWitnessCaller;

// Juror-related types
export interface JurorInfo {
  id: number;
  name?: string;
  lastName?: string;
  jurorNumber?: number;
  speakerPrefix: string;
  speakerId?: number;  // Add this field
  alias?: string;
}

// Event types
export interface TrialEventData {
  startTime?: string;
  endTime?: string;
  duration?: number;
  startLineNumber?: number;
  endLineNumber?: number;
  lineCount?: number;
  eventType: EventType;
  speakerId?: number;
  text?: string;
  metadata?: {
    [key: string]: any;
  };
}

export type EventType = PrismaEventType;
export const EventType = {
  COURT_DIRECTIVE: 'COURT_DIRECTIVE' as const,
  STATEMENT: 'STATEMENT' as const,
  WITNESS_CALLED: 'WITNESS_CALLED' as const,
  OBJECTION: 'OBJECTION' as const,
  RULING: 'RULING' as const,
  EXHIBIT: 'EXHIBIT' as const,
  OTHER: 'OTHER' as const
};

// Witness event specific types
export interface WitnessCalledEventData extends TrialEventData {
  witnessId?: number;
  witnessName?: string;
  examinationType: ExaminationType;
  swornStatus: SwornStatus;
  continued: boolean;
  presentedByVideo: boolean;
  rawText: string;
}

// Re-export examination and sworn status enums with const enums
export type ExaminationType = PrismaExaminationType;
export const ExaminationType = {
  DIRECT_EXAMINATION: 'DIRECT_EXAMINATION' as const,
  CROSS_EXAMINATION: 'CROSS_EXAMINATION' as const,
  REDIRECT_EXAMINATION: 'REDIRECT_EXAMINATION' as const,
  RECROSS_EXAMINATION: 'RECROSS_EXAMINATION' as const,
  VIDEO_DEPOSITION: 'VIDEO_DEPOSITION' as const
};

export type SwornStatus = PrismaSwornStatus;
export const SwornStatus = {
  SWORN: 'SWORN' as const,
  PREVIOUSLY_SWORN: 'PREVIOUSLY_SWORN' as const,
  NOT_SWORN: 'NOT_SWORN' as const
};

// Phase 2 Processing Context - FIXED VERSION
export interface Phase2Context {
  trialId: number;
  speakers: Map<string, SpeakerInfo>;
  attorneys: Map<string, number>;
  witnesses: Map<string, WitnessInfo>;  // Changed to store WitnessInfo objects
  jurors: Map<string, JurorInfo>;
  judge?: any;  // Add judge field
  currentSession?: any;  // Add currentSession field
  currentExaminationType?: ExaminationType | null;
  currentWitness?: WitnessInfo | null;  // Allow null
}

// Document Section Types
export type DocumentSection = 'SUMMARY' | 'PROCEEDINGS' | 'CERTIFICATION' | 'UNKNOWN';

// Database management types
export interface DatabaseBackupInfo {
  name: string;
  filePath: string;
  size: number;
  createdAt: Date;
  description?: string;
}

export interface DatabaseStats {
  totalTrials: number;
  totalSessions: number;
  totalPages: number;
  totalLines: number;
  totalEvents: number;
  totalMarkers: number;
  totalSpeakers: number;
  databaseSize: string;
}
