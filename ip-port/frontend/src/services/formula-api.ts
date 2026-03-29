/**
 * Formula API Client
 *
 * Communicates with /api/formulas endpoints for formula-based scoring.
 */

import axios from 'axios';

const api = axios.create({
  baseURL: '/api/formulas',
  timeout: 120000, // 2 minutes for large evaluations
});

// =============================================================================
// Types
// =============================================================================

export interface FormulaDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  scopeType: string;
  scopeId: string | null;
  structure: FormulaStructure;
  version: number;
  isActive: boolean;
  portfolioGroupId: string | null;
  weightProfiles?: WeightProfileSummary[];
}

export interface WeightProfileSummary {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isBuiltIn: boolean;
}

export interface WeightProfile extends WeightProfileSummary {
  weights: Record<string, number>;
  consensusWeight: number | null;
  userId: string | null;
}

export interface FormulaStructure {
  version: number;
  outputScale: number;
  terms: FormulaTerm[];
  multipliers?: any[];
  sparseHandling: string;
}

export type FormulaTerm = MetricTerm | GroupTerm | ConstantTerm;

export interface MetricTerm {
  type: 'metric';
  attribute: string;
  weightKey: string;
  displayName?: string;
  scaling: { fn: string; params: Record<string, number> };
  invert?: boolean;
  sparseGroup?: string;
}

export interface GroupTerm {
  type: 'group';
  name: string;
  weightKey: string;
  terms: FormulaTerm[];
  normalize: boolean;
  sparseHandling?: string;
}

export interface ConstantTerm {
  type: 'constant';
  value: number;
  weightKey: string;
}

export interface EvaluatedPatent {
  patent_id: string;
  rank: number;
  rank_change?: number;
  score: number;
  base_score: number;
  group_scores?: Record<string, { score: number; weight: number; termsUsed: number; totalTerms: number }>;
  normalized_metrics: Record<string, number>;
  metrics_used: string[];
  year_multiplier?: number;
  title: string;
  assignee: string;
  sector: string;
  superSector: string;
  yearsRemaining: number;
  hasLlmData: boolean;
  hasTaxonomyScores: boolean;
}

export interface EvaluationResponse {
  data: EvaluatedPatent[];
  total: number;
  returned: number;
  formulaId: string;
  formulaName: string;
  formulaDisplayName?: string;
}

export interface ConsensusPatent {
  patent_id: string;
  rank: number;
  consensus_score: number;
  role_scores: Record<string, number>;
  title: string;
  assignee: string;
  sector: string;
  superSector: string;
  yearsRemaining: number;
  hasLlmData: boolean;
}

export interface AvailableScopes {
  superSectors: string[];
  sectors: Array<{ name: string; superSector: string }>;
  subSectors: Array<{ name: string; sector: string; superSector: string }>;
}

// =============================================================================
// API Functions
// =============================================================================

export const formulaApi = {
  /** List all formula definitions */
  async listFormulas(params?: { scopeType?: string; active?: boolean }): Promise<FormulaDefinition[]> {
    const query: Record<string, string> = {};
    if (params?.scopeType) query.scopeType = params.scopeType;
    if (params?.active !== undefined) query.active = String(params.active);
    const { data } = await api.get('/', { params: query });
    return data.data;
  },

  /** Get formula with weight profiles */
  async getFormula(id: string): Promise<FormulaDefinition> {
    const { data } = await api.get(`/${id}`);
    return data;
  },

  /** List weight profiles for a formula */
  async getProfiles(formulaId: string): Promise<WeightProfile[]> {
    const { data } = await api.get(`/${formulaId}/profiles`);
    return data.data;
  },

  /** Get a specific weight profile */
  async getProfile(formulaId: string, profileId: string): Promise<WeightProfile> {
    const { data } = await api.get(`/${formulaId}/profiles/${profileId}`);
    return data;
  },

  /** Save a new weight profile */
  async saveProfile(formulaId: string, profile: { name: string; description?: string; weights: Record<string, number> }): Promise<WeightProfile> {
    const { data } = await api.post(`/${formulaId}/profiles`, profile);
    return data;
  },

  /** Update an existing weight profile */
  async updateProfile(formulaId: string, profileId: string, updates: { weights?: Record<string, number>; description?: string }): Promise<WeightProfile> {
    const { data } = await api.put(`/${formulaId}/profiles/${profileId}`, updates);
    return data;
  },

  /** Delete a weight profile */
  async deleteProfile(formulaId: string, profileId: string): Promise<void> {
    await api.delete(`/${formulaId}/profiles/${profileId}`);
  },

  /** Evaluate formula against portfolio data */
  async evaluatePortfolio(formulaId: string, config: {
    portfolioId: string;
    profileId?: string;
    weights?: Record<string, number>;
    topN?: number;
    llmEnhancedOnly?: boolean;
    previousRankings?: Array<{ patent_id: string; rank: number }>;
    subSectorId?: string;
  }): Promise<EvaluationResponse> {
    const { data } = await api.post(`/${formulaId}/evaluate-portfolio`, config);
    return data;
  },

  /** Consensus scoring with multiple profiles */
  async consensus(formulaId: string, config: {
    portfolioId: string;
    profiles: Array<{ profileId: string; consensusWeight: number }>;
    topN?: number;
    llmEnhancedOnly?: boolean;
  }): Promise<{ data: ConsensusPatent[]; total: number; returned: number }> {
    const { data } = await api.post(`/${formulaId}/consensus`, config);
    return data;
  },

  /** Generate a formula for a taxonomy scope */
  async generateFormula(params: {
    scopeType: string;
    scopeId: string;
    superSectorName: string;
    sectorName?: string;
    subSectorName?: string;
  }): Promise<{ formula: FormulaDefinition; isNew: boolean }> {
    const { data } = await api.post('/generate', params);
    return data;
  },

  /** List available taxonomy scopes */
  async getScopes(): Promise<AvailableScopes> {
    const { data } = await api.get('/scopes');
    return data;
  },
};
