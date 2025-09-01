export interface ParsedMetadata {
  pages: Map<number, PageMetadata>;
  lines: Map<number, LineMetadata>;
  fileLineMapping: Map<number, DocumentLocation>;
  rawContent: string[];
}

export interface PageMetadata {
  pageNumber: number;
  trialPageNumber: number;
  parsedTrialPage: number;
  headerText: string;
  startFileLine: number;
  endFileLine: number;
  headerLines: string[];
}

export interface LineMetadata {
  fileLineNumber: number;
  pageLineNumber: number;
  timestamp?: string;
  prefix: string;
  contentStart: number;
  rawText: string;
  cleanText: string;
}

export interface DocumentLocation {
  pageNumber: number;
  lineNumber: number;
  section?: DocumentSection;
}

export enum DocumentSection {
  SUMMARY = 'SUMMARY',
  PROCEEDINGS = 'PROCEEDINGS',
  CERTIFICATION = 'CERTIFICATION',
  UNKNOWN = 'UNKNOWN'
}

export interface SectionBoundary {
  section: DocumentSection;
  startLine: number;
  endLine: number;
  startPage: number;
  endPage: number;
}

export interface StructureAnalysis {
  sections: SectionBoundary[];
  sectionMapping: Map<number, DocumentSection>;
}

export interface MultiPassConfig {
  mode: 'multi-pass' | 'legacy';
  loadInMemory: boolean;
  validatePasses: boolean;
  debugOutput: boolean;
  batchSize: number;
  pageHeaderLines?: number;  // Number of lines to skip for page headers (default: 2)
}

export interface PassResult<T> {
  success: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
  stats: {
    startTime: Date;
    endTime: Date;
    duration: number;
    itemsProcessed: number;
  };
}