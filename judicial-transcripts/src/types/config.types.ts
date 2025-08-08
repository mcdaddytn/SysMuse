// src/types/config.types.ts

export interface TranscriptConfig {
  transcriptPath: string;
  format: 'pdf' | 'txt';
  caseName?: string;
  caseNumber?: string;
  phases: {
    phase1: boolean;
    phase2: boolean;
    phase3: boolean;
  };
  pdfExtractOptions?: {
    layout?: string;
    encoding?: string;
    password?: string;
    max?: number;
    version?: string;
  };
  parsingOptions?: {
    ignoreBlankLines: boolean;
    trimWhitespace: boolean;
    lineDelimiters?: string[];
    pageDelimiters?: string[];
  };
  elasticsearchOptions?: {
    url: string;
    index: string;
    apiKey?: string;
  };
}

export interface ParsingContext {
  currentSession?: {
    id: number;
    date: Date;
    type: string;
  };
  currentPage?: {
    id: number;
    number: number;
    documentSection: DocumentSection;
  };
  currentSpeaker?: {
    type: string;
    name?: string;
    attorneyId?: number;
    witnessId?: number;
  };
  currentWitness?: {
    id: number;
    name: string;
    type: string;
  };
  currentExaminationType?: string;
  attorneys: Map<string, number>; // name -> id
  witnesses: Map<string, number>; // name -> id
}

export interface ParsedLine {
  lineNumber: number;
  timestamp?: string;
  text: string;
  speakerPrefix?: string;
  isBlank: boolean;
}

export interface ParsedPage {
  pageNumber: number;
  totalPages?: number;
  documentSection: DocumentSection;
  trialPageNumber?: number; // Renamed from transcriptPageNumber
  pageId?: string;
  headerText?: string;
  lines: ParsedLine[];
}

export interface SessionInfo {
  sessionDate: Date;
  sessionType: 'MORNING' | 'AFTERNOON' | 'SPECIAL' | 'BENCH_TRIAL' | 'JURY_VERDICT' | 'OTHER';
  fileName: string;
  documentNumber?: number; // Moved from Page to Session
}

export interface TrialSummaryInfo {
  trialName: string;
  caseNumber: string;
  court: string;           // e.g., "UNITED STATES DISTRICT COURT"
  courtDivision?: string;  // e.g., "EASTERN DISTRICT OF TEXAS"
  judge: {
    name: string;
    title?: string;
    honorific?: string;
  };
  plaintiffAttorneys: AttorneyInfo[];
  defendantAttorneys: AttorneyInfo[];
  courtReporter?: {
    name: string;
    credentials?: string;
    phone?: string;
    address?: AddressInfo;
  };
}

export interface AttorneyInfo {
  name: string;
  lawFirm?: {
    name: string;
    address?: AddressInfo;
  };
}

export interface AddressInfo {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

// Document Section Types
export type DocumentSection = 'SUMMARY' | 'PROCEEDINGS' | 'CERTIFICATION' | 'UNKNOWN';

// Phase 2 Processing Types
export interface Phase2Context {
  currentSpeaker?: string;
  speakerType?: SpeakerType;
  currentExamination?: {
    witnessName: string;
    examinationType: ExaminationType;
    startTime?: string;
  };
  lineBuffer: ParsedLine[];
  eventBuffer: TrialEventData[];
}

export interface TrialEventData {
  startTime?: string;
  endTime?: string;
  eventType: EventType;
  text: string;
  speakerInfo?: {
    type: SpeakerType;
    name?: string;
    attorneyId?: number;
    witnessId?: number;
  };
  metadata?: {
    [key: string]: any;
  };
}

// Enums matching Prisma schema
export enum EventType {
  COURT_DIRECTIVE = 'COURT_DIRECTIVE',
  STATEMENT = 'STATEMENT',
  WITNESS_CALLED = 'WITNESS_CALLED',
  OBJECTION = 'OBJECTION',
  RULING = 'RULING',
  EXHIBIT = 'EXHIBIT',
  OTHER = 'OTHER'
}

export enum SpeakerType {
  ATTORNEY = 'ATTORNEY',
  COURT = 'COURT',
  WITNESS = 'WITNESS',
  COURT_REPORTER = 'COURT_REPORTER',
  BAILIFF = 'BAILIFF',
  OTHER = 'OTHER'
}

export enum ExaminationType {
  DIRECT_EXAMINATION = 'DIRECT_EXAMINATION',
  CROSS_EXAMINATION = 'CROSS_EXAMINATION',
  REDIRECT_EXAMINATION = 'REDIRECT_EXAMINATION',
  RECROSS_EXAMINATION = 'RECROSS_EXAMINATION',
  EXAMINATION_CONTINUED = 'EXAMINATION_CONTINUED',
  VIDEO_DEPOSITION = 'VIDEO_DEPOSITION'
}

// Database management types
// gm: do not think we need these are for fancy scripts 
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
  databaseSize: string;
}