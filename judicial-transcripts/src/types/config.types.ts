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
  documentNumber?: number;
  pageId?: string;
  transcriptPageNumber?: number;
  headerText?: string;
  lines: ParsedLine[];
}

export interface SessionInfo {
  sessionDate: Date;
  sessionType: 'MORNING' | 'AFTERNOON' | 'SPECIAL' | 'BENCH_TRIAL' | 'JURY_VERDICT' | 'OTHER';
  fileName: string;
  documentNumber?: number;
}

export interface TrialSummaryInfo {
  trialName: string;
  caseNumber: string;
  court: string;
  courtDivision?: string;
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

