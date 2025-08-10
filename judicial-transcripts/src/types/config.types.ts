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
  // Trial info is optional - will be parsed from transcripts
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
  lastName?: string;
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
  id?: number;
  speakerPrefix: string;
  speakerType: SpeakerType;
  name?: string;
  attorneyId?: number;
  witnessId?: number;
  jurorId?: number;
  judgeId?: number;
}

// Re-export Prisma enums for use throughout the application
export type SpeakerType = PrismaSpeakerType;
export const SpeakerType = {
  ATTORNEY: 'ATTORNEY' as SpeakerType,
  JUDGE: 'JUDGE' as SpeakerType,
  WITNESS: 'WITNESS' as SpeakerType,
  JUROR: 'JUROR' as SpeakerType,
  ANONYMOUS: 'ANONYMOUS' as SpeakerType
};

// Witness-related types
export interface WitnessInfo {
  id?: number;
  name?: string;
  witnessType?: WitnessType;
  witnessCaller?: WitnessCaller;
  expertField?: string;
  speakerId?: number;
}

export type WitnessType = PrismaWitnessType;
export type WitnessCaller = PrismaWitnessCaller;

// Juror-related types
export interface JurorInfo {
  id?: number;
  name?: string;
  lastName?: string;
  jurorNumber?: number;
  speakerPrefix: string;
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
  COURT_DIRECTIVE: 'COURT_DIRECTIVE' as EventType,
  STATEMENT: 'STATEMENT' as EventType,
  WITNESS_CALLED: 'WITNESS_CALLED' as EventType,
  OBJECTION: 'OBJECTION' as EventType,
  RULING: 'RULING' as EventType,
  EXHIBIT: 'EXHIBIT' as EventType,
  OTHER: 'OTHER' as EventType
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

export type ExaminationType = PrismaExaminationType;
export type SwornStatus = PrismaSwornStatus;

// Phase 2 Processing Context
export interface Phase2Context {
  trialId: number;
  currentSpeaker?: SpeakerInfo;
  currentWitness?: WitnessInfo;
  currentExamination?: {
    witnessId: number;
    examinationType: ExaminationType;
    startTime?: string;
  };
  speakers: Map<string, SpeakerInfo>;
  attorneys: Map<string, number>;
  witnesses: Map<string, number>;
  jurors: Map<string, JurorInfo>;
  lineBuffer: ParsedLine[];
  eventBuffer: TrialEventData[];
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