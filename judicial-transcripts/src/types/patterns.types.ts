// src/types/patterns.types.ts
export interface LinePattern {
  pattern: RegExp;
  type: 'timestamp' | 'speaker' | 'directive' | 'witness_call' | 'examination_type' | 'other';
  extract?: (match: RegExpMatchArray) => any;
}

export interface CourtDirectivePattern {
  id: string;
  name: string;
  patterns: string[];
  isPaired: boolean;
  pairMateId?: string;
  isStart?: boolean;
}

export interface ObjectionPattern {
  type: 'start' | 'end';
  patterns: string[];
  result?: 'sustained' | 'overruled' | 'allowed';
}

export interface SpeakerPattern {
  pattern: RegExp;
  type: 'judge' | 'attorney' | 'witness' | 'court_officer' | 'other';
  extractName?: (match: RegExpMatchArray) => string;
}

