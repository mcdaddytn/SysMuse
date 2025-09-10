export interface OverrideData {
  Trial?: TrialOverride | TrialOverride[];  // Can be single object or array
  Attorney?: AttorneyOverride[];
  Witness?: WitnessOverride[];
  LawFirm?: LawFirmOverride[];
  LawFirmOffice?: LawFirmOfficeOverride[];
  Address?: AddressOverride[];
  Judge?: JudgeOverride[];
  CourtReporter?: CourtReporterOverride[];
  TrialAttorney?: TrialAttorneyOverride[];
  Marker?: MarkerOverride[];
  MarkerSection?: MarkerSectionOverride[];
  metadata?: MetadataOverride;  // Metadata with import flags
}

export interface MetadataOverride {
  userReview?: boolean;
  importAttorney?: boolean;
  importJudge?: boolean;
  importCourtReporter?: boolean;
  [key: string]: any;  // Allow other metadata fields
}

export interface BaseOverride {
  id?: number | string;  // Made optional for new records
  overrideAction?: 'Insert' | 'Update' | 'Upsert' | 'ConditionalInsert';  // Added ConditionalInsert
  overrideKey?: string;  // Field to use for matching (default: 'id', can be 'attorneyFingerprint', etc.)
  createdAt?: string;
  updatedAt?: string;
}

export interface TrialOverride extends BaseOverride {
  name: string;
  shortName?: string | null;
  shortNameHandle?: string | null;  // Generated via generateFileToken(shortName)
  caseNumber: string;
  caseHandle?: string | null;
  plaintiff?: string | null;
  defendant?: string | null;
  alternateCaseNumber?: string | null;
  alternateDefendant?: string | null;
  court: string;
  courtDivision?: string | null;
  courtDistrict?: string | null;
  totalPages?: number | null;
}

export interface AttorneyOverride extends BaseOverride {
  name: string;
  title?: string | null;
  firstName?: string | null;
  middleInitial?: string | null;
  lastName?: string | null;
  suffix?: string | null;
  speakerPrefix?: string | null;
  barNumber?: string | null;
  attorneyFingerprint?: string | null;
  speakerId?: number;
}

export interface LawFirmOverride extends BaseOverride {
  name: string;
  lawFirmFingerprint?: string | null;
}

export interface LawFirmOfficeOverride extends BaseOverride {
  lawFirmId: number | string;
  name: string;
  addressId?: number | string | null;
  lawFirmOfficeFingerprint?: string | null;
}

export interface AddressOverride extends BaseOverride {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  fullAddress?: string | null;
}

export interface JudgeOverride extends BaseOverride {
  name: string;
  title?: string | null;
  honorific?: string | null;
  judgeFingerprint?: string | null;
  speakerId?: number;
  trialId?: number | string;
}

export interface CourtReporterOverride extends BaseOverride {
  name: string;
  credentials?: string | null;
  title?: string | null;
  stateNumber?: string | null;
  expirationDate?: string | null;
  addressId?: number | string | null;
  phone?: string | null;
  courtReporterFingerprint?: string | null;
  trialId?: number | string;
}

export interface TrialAttorneyOverride extends BaseOverride {
  trialId: number | string;
  attorneyId: number | string;
  speakerId?: number | null;
  lawFirmId?: number | string | null;
  lawFirmOfficeId?: number | string | null;
  role?: 'PLAINTIFF' | 'DEFENDANT' | 'THIRD_PARTY' | 'UNKNOWN';
}

export interface WitnessOverride extends BaseOverride {
  name: string;
  trialId?: number | string;
  witnessType?: 'FACT_WITNESS' | 'EXPERT_WITNESS' | 'CHARACTER_WITNESS' | 'UNKNOWN';
  witnessCaller?: 'PLAINTIFF' | 'DEFENDANT' | 'COURT' | 'JOINT' | 'UNKNOWN';
  expertField?: string | null;
  witnessFingerprint?: string | null;
  speakerId?: number;
}

export interface MarkerOverride extends BaseOverride {
  name: string;
  trialId?: number | string;
  markerType?: string;
  startLineId?: number | string;
  endLineId?: number | string;
  metadata?: any;
}

export interface MarkerSectionOverride extends BaseOverride {
  markerId: number | string;
  sectionName: string;
  startLineId?: number | string;
  endLineId?: number | string;
  orderIndex?: number;
}

export interface CorrelationMap {
  Trial: Map<number | string, number>;
  Attorney: Map<number | string, number>;
  Witness: Map<number | string, number>;
  LawFirm: Map<number | string, number>;
  LawFirmOffice: Map<number | string, number>;
  Address: Map<number | string, number>;
  Judge: Map<number | string, number>;
  CourtReporter: Map<number | string, number>;
  Speaker: Map<number | string, number>;
  Marker: Map<number | string, number>;
  MarkerSection: Map<number | string, number>;
}

export interface ImportResult {
  success: boolean;
  imported: {
    trials?: number;
    attorneys?: number;
    witnesses?: number;
    lawFirms?: number;
    lawFirmOffices?: number;
    addresses?: number;
    judges?: number;
    courtReporters?: number;
    trialAttorneys?: number;
    markers?: number;
    markerSections?: number;
  };
  errors?: string[];
  correlationMap?: CorrelationMap;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}