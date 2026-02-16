import axios from 'axios';
import type { Patent, PaginatedResponse, PortfolioFilters, PaginationParams, ScoringProfile, V3ScoredPatent, SectorRanking, LlmCoverage, SectorDetail, SuperSectorDetail, SectorRule, SectorRuleType, RulePreviewResult, SeedSummary, V3ConsensusRole, V3ConsensusPreset, V3ConsensusConfig, V3ConsensusScoredPatent, V3ConsensusSnapshot } from '@/types';

const api = axios.create({
  baseURL: '/api',
  timeout: 60000, // 1 minute
  withCredentials: true
});

// Request interceptor for logging
api.interceptors.request.use(
  (config) => {
    console.log(`[API] ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API Error]', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Patent Preview type
export interface PatentPreview {
  patent_id: string;
  patent_title: string;
  abstract?: string | null;
  patent_date: string;
  assignee: string;
  affiliate: string;
  super_sector: string;
  primary_sector?: string;
  cpc_codes: string[];
  forward_citations: number;
  remaining_years: number;
  score: number;
  competitor_citations?: number;
  affiliate_citations?: number;
  neutral_citations?: number;
  competitor_count?: number;
  competitor_names?: string[];
  adjusted_forward_citations?: number;
  competitor_density?: number;
}

// Patent API
export const patentApi = {
  async getPatents(
    pagination: PaginationParams,
    filters?: PortfolioFilters
  ): Promise<PaginatedResponse<Patent>> {
    const params = {
      page: pagination.page,
      limit: pagination.rowsPerPage,
      sortBy: pagination.sortBy,
      descending: pagination.descending,
      ...filters
    };
    const { data } = await api.get('/patents', { params });
    return data;
  },

  async getPatent(id: string): Promise<Patent> {
    const { data } = await api.get(`/patents/${id}`);
    return data;
  },

  async getPatentPreview(id: string): Promise<PatentPreview> {
    const { data } = await api.get(`/patents/${id}/preview`);
    return data;
  },

  async getBatchPreviews(patentIds: string[]): Promise<{ previews: Record<string, PatentPreview | null> }> {
    const { data } = await api.post('/patents/batch-preview', { patentIds });
    return data;
  },

  async getPatentCitations(id: string) {
    const { data } = await api.get(`/patents/${id}/citations`);
    return data;
  },

  async getPatentProsecution(id: string) {
    const { data } = await api.get(`/patents/${id}/prosecution`);
    return data;
  },

  async getPatentPTAB(id: string) {
    const { data } = await api.get(`/patents/${id}/ptab`);
    return data;
  },

  async getEnrichmentSummary(tierSize = 5000): Promise<EnrichmentSummary> {
    const { data } = await api.get('/patents/enrichment-summary', { params: { tierSize } });
    return data;
  },

  async exportCSV(
    filters?: PortfolioFilters,
    columns?: string[],
    sortBy?: string,
    descending?: boolean
  ): Promise<void> {
    const params: Record<string, unknown> = {
      ...filters,
      sortBy: sortBy || 'score',
      descending: descending ?? true,
    };
    if (columns && columns.length > 0) {
      params.columns = columns.join(',');
    }

    const response = await api.get('/patents/export', {
      params,
      responseType: 'blob',
    });

    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    // Extract filename from Content-Disposition header, or use default
    const disposition = response.headers['content-disposition'];
    const match = disposition?.match(/filename="?([^"]+)"?/);
    link.download = match?.[1] || `patent-export-${new Date().toISOString().split('T')[0]}.csv`;

    link.click();
    URL.revokeObjectURL(url);
  }
};

// Enrichment Summary types
export interface EnrichmentTierData {
  tierLabel: string;
  count: number;
  scoreRange: string;
  expired: number;
  active3yr: number;
  yearsRemaining: { avg: number; median: number };
  forwardCitations: { avg: number; total: number };
  competitorCitations: { avg: number; total: number };
  enrichment: {
    llm: number; llmPct: number;
    prosecution: number; prosecutionPct: number;
    ipr: number; iprPct: number;
    family: number; familyPct: number;
  };
  topAffiliates: Array<{ name: string; count: number; pct: number }>;
  topSuperSectors: Array<{ name: string; count: number; pct: number }>;
}

export interface EnrichmentSummary {
  totalPatents: number;
  tierSize: number;
  enrichmentTotals: { llm: number; prosecution: number; ipr: number; family: number };
  tiers: EnrichmentTierData[];
}

// Auth API
export const authApi = {
  async login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password });
    return data;
  },

  async logout() {
    await api.post('/auth/logout');
  },

  async getCurrentUser() {
    const { data } = await api.get('/auth/me');
    return data;
  }
};

// Scoring types
export interface ScoreWeights {
  citation: number;
  years: number;
  competitor: number;
}

export interface WeightPreset {
  name: string;
  weights: ScoreWeights;
}

export interface ScoredPatent extends Patent {
  v2_score: number;
  rank: number;
  rank_change?: number;
}

export interface V2ScoresResponse {
  weights: ScoreWeights;
  data: ScoredPatent[];
  total: number;
  page: number;
  rowsPerPage: number;
}

// Scoring API
export const scoringApi = {
  async getV2Scores(
    weights?: ScoreWeights,
    pagination?: { page: number; limit: number },
    minScore?: number
  ): Promise<V2ScoresResponse> {
    const params = {
      ...weights,
      ...pagination,
      minScore
    };
    const { data } = await api.get('/scores/v2', { params });
    return data;
  },

  async getWeightPresets(): Promise<WeightPreset[]> {
    const { data } = await api.get('/scores/weights/presets');
    return data;
  },

  async getV3Scores(options?: {
    profile?: string;
    page?: number;
    limit?: number;
    sector?: string;
    minScore?: number;
  }): Promise<{
    profile: { id: string; displayName: string; description: string; weights: Record<string, number> };
    data: V3ScoredPatent[];
    total: number;
    page: number;
    rowsPerPage: number;
    llm_coverage: LlmCoverage;
  }> {
    const { data } = await api.get('/scores/v3', { params: options });
    return data;
  },

  async getProfiles(): Promise<ScoringProfile[]> {
    const { data } = await api.get('/scores/profiles');
    return data;
  },

  async getSectorRankings(options?: {
    profile?: string;
    topN?: number;
  }): Promise<{
    profile: { id: string; displayName: string };
    topN: number;
    sectors: SectorRanking[];
    total_sectors: number;
  }> {
    const { data } = await api.get('/scores/sectors', { params: options });
    return data;
  },

  async reloadScores(): Promise<{ message: string }> {
    const { data } = await api.post('/scores/reload');
    return data;
  },

  async getConsensusScores() {
    const { data } = await api.get('/scores/consensus');
    return data;
  },

  async updateWeights(weights: ScoreWeights) {
    const { data } = await api.post('/weights', weights);
    return data;
  }
};

// V2 Enhanced Scoring types
export type ScalingType = 'linear' | 'log' | 'sqrt';

export interface V2EnhancedConfig {
  weights: Record<string, number>;
  scaling: Record<string, ScalingType>;
  invert: Record<string, boolean>;
  topN: number;
  llmEnhancedOnly: boolean;
}

export interface V2EnhancedScoredPatent {
  patent_id: string;
  rank: number;
  rank_change?: number;
  score: number;
  normalized_metrics: Record<string, number>;
  raw_metrics: Record<string, number>;
  metrics_used: string[];
  year_multiplier: number;
  has_llm_data: boolean;
  patent_title: string;
  patent_abstract: string;
  patent_date: string;
  assignee: string;
  primary_sector: string;
  super_sector: string;
  years_remaining: number;
}

export interface V2EnhancedResponse {
  data: V2EnhancedScoredPatent[];
  total: number;
  config: V2EnhancedConfig;
}

export interface V2EnhancedPreset {
  id: string;
  name: string;
  description: string;
  isBuiltIn: boolean;
  config: V2EnhancedConfig;
}

export interface V2EnhancedMetric {
  key: string;
  label: string;
  category: 'quantitative' | 'llm' | 'api';
  defaultWeight: number;
  defaultScaling: ScalingType;
  description: string;
  coverage?: string;
}

// V2 Enhanced Scoring API
export const v2EnhancedApi = {
  async getScores(
    config: Partial<V2EnhancedConfig>,
    previousRankings?: Array<{ patent_id: string; rank: number }>
  ): Promise<V2EnhancedResponse> {
    const { data } = await api.post('/scores/v2-enhanced', {
      ...config,
      previousRankings,
    });
    return data;
  },

  async getPresets(): Promise<V2EnhancedPreset[]> {
    const { data } = await api.get('/scores/v2-enhanced/presets');
    return data;
  },

  async getMetrics(): Promise<V2EnhancedMetric[]> {
    const { data } = await api.get('/scores/v2-enhanced/metrics');
    return data;
  },
};

// =============================================================================
// Score Snapshots API
// =============================================================================

export type ScoreType = 'V2' | 'V3';

export interface ScoreSnapshot {
  id: string;
  name: string;
  description?: string;
  scoreType: ScoreType;
  config: V2EnhancedConfig | Record<string, unknown>;
  isActive: boolean;
  patentCount: number;
  llmDataCount: number;
  createdAt: string;
}

export interface ActiveSnapshots {
  V2: ScoreSnapshot | null;
  V3: ScoreSnapshot | null;
}

export interface SaveSnapshotRequest {
  name: string;
  description?: string;
  scoreType: ScoreType;
  config: V2EnhancedConfig | Record<string, unknown>;
  scores: Array<{
    patent_id: string;
    score: number;
    rank: number;
    raw_metrics?: Record<string, number>;
    normalized_metrics?: Record<string, number>;
  }>;
  setActive?: boolean;
}

export const snapshotApi = {
  /**
   * List all saved score snapshots
   */
  async list(): Promise<ScoreSnapshot[]> {
    const { data } = await api.get('/scores/snapshots');
    return data;
  },

  /**
   * Get currently active snapshots (one per score type)
   */
  async getActive(): Promise<ActiveSnapshots> {
    const { data } = await api.get('/scores/snapshots/active');
    return data;
  },

  /**
   * Save a new score snapshot
   */
  async save(request: SaveSnapshotRequest): Promise<ScoreSnapshot> {
    const { data } = await api.post('/scores/snapshots', request);
    return data;
  },

  /**
   * Activate a snapshot (set as current for its score type)
   */
  async activate(snapshotId: string): Promise<{ success: boolean; message: string }> {
    const { data } = await api.put(`/scores/snapshots/${snapshotId}/activate`);
    return data;
  },

  /**
   * Deactivate a snapshot
   */
  async deactivate(snapshotId: string): Promise<{ success: boolean; message: string }> {
    const { data } = await api.put(`/scores/snapshots/${snapshotId}/deactivate`);
    return data;
  },

  /**
   * Delete a snapshot
   */
  async delete(snapshotId: string): Promise<{ success: boolean; message: string }> {
    const { data } = await api.delete(`/scores/snapshots/${snapshotId}`);
    return data;
  },

  /**
   * Get scores from a snapshot (for debugging/export)
   */
  async getScores(snapshotId: string, options?: { limit?: number; offset?: number }): Promise<{
    scores: Array<{
      patentId: string;
      score: number;
      rank: number;
      rawMetrics?: Record<string, number>;
      normalizedMetrics?: Record<string, number>;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const { data } = await api.get(`/scores/snapshots/${snapshotId}/scores`, { params: options });
    return data;
  },
};

// Jobs API
export const jobsApi = {
  async getJobs(status?: string) {
    const { data } = await api.get('/jobs', { params: { status } });
    return data;
  },

  async createJob(type: string, patentId: string, params?: Record<string, unknown>) {
    const { data } = await api.post('/jobs', { type, patentId, params });
    return data;
  },

  async createBulkJobs(type: string, patentIds: string[], params?: Record<string, unknown>) {
    const { data } = await api.post('/jobs/bulk', { type, patentIds, params });
    return data;
  },

  async cancelJob(id: string) {
    await api.delete(`/jobs/${id}`);
  },

  async retryJob(id: string) {
    const { data } = await api.post(`/jobs/${id}/retry`);
    return data;
  }
};

// Focus Area types
export interface FocusGroup {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  owner?: { id: string; name: string; email: string };
  status: 'DRAFT' | 'NEEDS_REVIEW' | 'FORMALIZED' | 'ARCHIVED';
  sourceType: 'MANUAL' | 'GRID_FILTER' | 'LLM_SUGGESTION' | 'SEARCH_TERM';
  sourceFilters?: Record<string, unknown>;
  patentIds: string[];
  parentId?: string;
  parent?: { id: string; name: string };
  children?: { id: string; name: string; status: string }[];
  formalizedAs?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface SearchTerm {
  id: string;
  focusAreaId: string;
  termType: 'KEYWORD' | 'PHRASE' | 'PROXIMITY' | 'WILDCARD' | 'BOOLEAN';
  expression: string;
  sourceType: 'MANUAL' | 'FREQUENCY_ANALYSIS' | 'PHRASE_HIGHLIGHT' | 'LLM_SUGGESTION';
  sourcePatentIds: string[];
  hitCountPortfolio?: number;
  hitCountScope?: number;
  hitCountSector?: number;
  hitCountFocusArea?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SearchScopeType = 'PORTFOLIO' | 'SECTOR' | 'SUPER_SECTOR' | 'COMPOUND' | 'PATENT_FAMILY';

export interface SearchScopeConfig {
  sectors?: string[];
  superSectors?: string[];
  cpcCodes?: string[];
}

export interface FocusArea {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  owner?: { id: string; name: string; email: string };
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  sourceGroupId?: string;
  sourceGroup?: { id: string; name: string; sourceType: string };
  parentId?: string;
  parent?: { id: string; name: string };
  children?: { id: string; name: string }[];
  superSector?: string;
  primarySector?: string;
  searchScopeType: SearchScopeType;
  searchScopeConfig?: SearchScopeConfig;
  patentCount: number;
  lastCalculatedAt?: string;
  searchTerms?: SearchTerm[];
  _count?: { patents: number; facetDefs: number };
  createdAt: string;
  updatedAt: string;
}

export interface ScopeOption {
  term: string;
  count: number;
}

export interface ScopeOptions {
  sectors: ScopeOption[];
  superSectors: ScopeOption[];
}

export interface FocusAreaPatent {
  id: string;
  focusAreaId: string;
  patentId: string;
  membershipType: 'SEARCH_MATCH' | 'MANUAL' | 'LLM_SUGGESTED' | 'INHERITED';
  matchedTermIds: string[];
  matchScore?: number;
  manualInclude?: boolean;
  createdAt: string;
}

// Focus Area API
export const focusAreaApi = {
  // Focus Groups
  async getFocusGroups(filters?: { status?: string; ownerId?: string }): Promise<FocusGroup[]> {
    const { data } = await api.get('/focus-areas/focus-groups', { params: filters });
    return data;
  },

  async getFocusGroup(id: string): Promise<FocusGroup> {
    const { data } = await api.get(`/focus-areas/focus-groups/${id}`);
    return data;
  },

  async createFocusGroup(group: {
    name: string;
    description?: string;
    ownerId: string;
    sourceType?: string;
    sourceFilters?: Record<string, unknown>;
    patentIds?: string[];
    parentId?: string;
  }): Promise<FocusGroup> {
    const { data } = await api.post('/focus-areas/focus-groups', group);
    return data;
  },

  async updateFocusGroup(id: string, updates: Partial<FocusGroup>): Promise<FocusGroup> {
    const { data } = await api.put(`/focus-areas/focus-groups/${id}`, updates);
    return data;
  },

  async deleteFocusGroup(id: string): Promise<void> {
    await api.delete(`/focus-areas/focus-groups/${id}`);
  },

  async formalizeFocusGroup(id: string, overrides?: { name?: string; description?: string }): Promise<FocusArea> {
    const { data } = await api.post(`/focus-areas/focus-groups/${id}/formalize`, overrides);
    return data;
  },

  // Focus Areas
  async getFocusAreas(filters?: { status?: string; ownerId?: string; superSector?: string }): Promise<FocusArea[]> {
    const { data } = await api.get('/focus-areas', { params: filters });
    return data;
  },

  async getFocusArea(id: string): Promise<FocusArea> {
    const { data } = await api.get(`/focus-areas/${id}`);
    return data;
  },

  async createFocusArea(area: {
    name: string;
    description?: string;
    ownerId: string;
    superSector?: string;
    primarySector?: string;
    parentId?: string;
    patentIds?: string[];
    searchScopeType?: SearchScopeType;
    searchScopeConfig?: SearchScopeConfig;
  }): Promise<FocusArea> {
    const { data } = await api.post('/focus-areas', area);
    return data;
  },

  async updateFocusArea(id: string, updates: Partial<FocusArea>): Promise<FocusArea> {
    const { data } = await api.put(`/focus-areas/${id}`, updates);
    return data;
  },

  async deleteFocusArea(id: string, hard = false): Promise<void> {
    await api.delete(`/focus-areas/${id}`, { params: { hard } });
  },

  // Focus Area Patents
  async getFocusAreaPatents(id: string, pagination?: { page: number; limit: number }): Promise<{
    data: FocusAreaPatent[];
    total: number;
    page: number;
    rowsPerPage: number;
  }> {
    const { data } = await api.get(`/focus-areas/${id}/patents`, { params: pagination });
    return data;
  },

  async addPatentsToFocusArea(id: string, patentIds: string[], membershipType = 'MANUAL'): Promise<{ added: number; total: number; fetched?: number; fetchFailed?: number }> {
    const { data } = await api.post(`/focus-areas/${id}/patents`, { patentIds, membershipType });
    return data;
  },

  async removePatentsFromFocusArea(id: string, patentIds: string[]): Promise<{ removed: number; total: number }> {
    const { data } = await api.delete(`/focus-areas/${id}/patents`, { data: { patentIds } });
    return data;
  },

  async fetchPatentData(id: string): Promise<{ total: number; uncached: number; fetched: number; failed: number; failedIds?: string[] }> {
    const { data } = await api.post(`/focus-areas/${id}/fetch-patents`);
    return data;
  },

  // Search Terms
  async addSearchTerm(focusAreaId: string, term: {
    expression: string;
    termType?: string;
    sourceType?: string;
    sourcePatentIds?: string[];
  }): Promise<SearchTerm> {
    const { data } = await api.post(`/focus-areas/${focusAreaId}/search-terms`, term);
    return data;
  },

  async removeSearchTerm(focusAreaId: string, termId: string): Promise<void> {
    await api.delete(`/focus-areas/${focusAreaId}/search-terms/${termId}`);
  },

  // Keyword Extraction
  async extractKeywords(
    patentIds: string[],
    options?: {
      corpusPatentIds?: string[];
      minFrequency?: number;
      maxTerms?: number;
      includeNgrams?: boolean;
      titleOnly?: boolean;
    }
  ): Promise<KeywordExtractionResult> {
    const { data } = await api.post('/focus-areas/extract-keywords', {
      patentIds,
      ...options
    });
    return data;
  },

  async extractKeywordsFromFocusArea(
    focusAreaId: string,
    options?: {
      minFrequency?: number;
      maxTerms?: number;
      includeNgrams?: boolean;
      titleOnly?: boolean;
    }
  ): Promise<KeywordExtractionResult> {
    const { data } = await api.post(`/focus-areas/${focusAreaId}/extract-keywords`, options);
    return data;
  },

  // Prompt Templates
  async getPromptTemplates(focusAreaId: string): Promise<PromptTemplate[]> {
    const { data } = await api.get(`/focus-areas/${focusAreaId}/prompt-templates`);
    return data;
  },

  async createPromptTemplate(focusAreaId: string, template: {
    name: string;
    description?: string;
    templateType?: 'FREE_FORM' | 'STRUCTURED';
    objectType?: string;
    promptText?: string;
    questions?: StructuredQuestion[];
    executionMode?: 'PER_PATENT' | 'COLLECTIVE';
    contextFields?: string[];
    llmModel?: string;
  }): Promise<PromptTemplate> {
    const { data } = await api.post(`/focus-areas/${focusAreaId}/prompt-templates`, template);
    return data;
  },

  async updatePromptTemplate(focusAreaId: string, templateId: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate> {
    const { data } = await api.put(`/focus-areas/${focusAreaId}/prompt-templates/${templateId}`, updates);
    return data;
  },

  async deletePromptTemplate(focusAreaId: string, templateId: string): Promise<void> {
    await api.delete(`/focus-areas/${focusAreaId}/prompt-templates/${templateId}`);
  },

  async executePromptTemplate(focusAreaId: string, templateId: string): Promise<{ status: string; message: string }> {
    const { data } = await api.post(`/focus-areas/${focusAreaId}/prompt-templates/${templateId}/execute`);
    return data;
  },

  async getPromptTemplateStatus(focusAreaId: string, templateId: string): Promise<{
    id: string;
    status: string;
    completedCount: number;
    totalCount: number;
    lastRunAt?: string;
    errorMessage?: string;
  }> {
    const { data } = await api.get(`/focus-areas/${focusAreaId}/prompt-templates/${templateId}/status`);
    return data;
  },

  async getPromptResults(focusAreaId: string, templateId: string, pagination?: { page: number; limit: number }): Promise<{
    data: PromptResult[];
    total: number;
    page: number;
    rowsPerPage: number;
  }> {
    const { data } = await api.get(`/focus-areas/${focusAreaId}/prompt-templates/${templateId}/results`, { params: pagination });
    return data;
  },

  async getPromptResult(focusAreaId: string, templateId: string, patentId: string): Promise<PromptResult> {
    const { data } = await api.get(`/focus-areas/${focusAreaId}/prompt-templates/${templateId}/results/${patentId}`);
    return data;
  },

  async previewPromptTemplate(focusAreaId: string, templateId: string, patentId?: string): Promise<PromptPreviewResponse> {
    const { data } = await api.post(`/focus-areas/${focusAreaId}/prompt-templates/${templateId}/preview`, { patentId });
    return data;
  }
};

// Prompt Template types
export interface StructuredQuestion {
  fieldName: string;
  question: string;
  answerType: 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'TEXT' | 'ENUM' | 'TEXT_ARRAY';
  constraints?: {
    min?: number;
    max?: number;
    maxSentences?: number;
    maxItems?: number;
    options?: string[];
  };
  description?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  templateType: 'FREE_FORM' | 'STRUCTURED';
  objectType: string;
  promptText?: string | null;
  questions?: StructuredQuestion[] | null;
  executionMode: 'PER_PATENT' | 'COLLECTIVE';
  contextFields: string[];
  llmModel: string;
  delimiterStart: string;
  delimiterEnd: string;
  focusAreaId?: string | null;
  focusArea?: { id: string; name: string } | null;
  status: 'DRAFT' | 'RUNNING' | 'COMPLETE' | 'ERROR';
  completedCount: number;
  totalCount: number;
  lastRunAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PromptResult {
  templateId: string;
  templateType: 'FREE_FORM' | 'STRUCTURED';
  patentId?: string;
  model: string;
  promptSent: string;
  response: Record<string, unknown> | null;
  fields?: Record<string, unknown>;
  rawText?: string;
  inputTokens?: number;
  outputTokens?: number;
  executedAt: string;
}

export interface PromptPreviewResponse {
  resolvedPrompt: string;
  patentId: string | null;
  executionMode: string;
  patentCount: number;
}

export interface AnswerTypeOption {
  value: string;
  label: string;
  description: string;
}

export interface FieldOption {
  field: string;
  placeholder: string;
  description: string;
}

// Standalone Prompt Template API (library-level CRUD)
export const promptTemplateApi = {
  async getTemplates(filters?: { objectType?: string; focusAreaId?: string }): Promise<PromptTemplate[]> {
    const { data } = await api.get('/prompt-templates', { params: filters });
    return data;
  },

  async getTemplate(id: string): Promise<PromptTemplate> {
    const { data } = await api.get(`/prompt-templates/${id}`);
    return data;
  },

  async createTemplate(template: {
    name: string;
    description?: string;
    templateType?: 'FREE_FORM' | 'STRUCTURED';
    objectType?: string;
    promptText?: string;
    questions?: StructuredQuestion[];
    executionMode?: 'PER_PATENT' | 'COLLECTIVE';
    contextFields?: string[];
    llmModel?: string;
    delimiterStart?: string;
    delimiterEnd?: string;
    focusAreaId?: string;
  }): Promise<PromptTemplate> {
    const { data } = await api.post('/prompt-templates', template);
    return data;
  },

  async updateTemplate(id: string, updates: Partial<PromptTemplate>): Promise<PromptTemplate> {
    const { data } = await api.put(`/prompt-templates/${id}`, updates);
    return data;
  },

  async deleteTemplate(id: string): Promise<void> {
    await api.delete(`/prompt-templates/${id}`);
  },

  async getFields(objectType?: string, delimiterStart?: string, delimiterEnd?: string): Promise<FieldOption[]> {
    const { data } = await api.get('/prompt-templates/meta/fields', {
      params: { objectType, delimiterStart, delimiterEnd }
    });
    return data;
  },

  async getAnswerTypes(): Promise<AnswerTypeOption[]> {
    const { data } = await api.get('/prompt-templates/meta/answer-types');
    return data;
  }
};

// Keyword Extraction types
export interface KeywordResult {
  term: string;
  frequency: number;
  selectedRatio: number;
  corpusRatio: number;
  contrastScore: number;
  score: number;
}

export interface KeywordExtractionResult {
  patentCount: number;
  keywordCount: number;
  keywords: KeywordResult[];
  focusAreaId?: string;
  message?: string;
}

// Search Preview types
export interface SearchPreviewHit {
  patentId: string;
  title: string;
  score: number;
  highlight?: string;
}

export interface SearchPreviewResult {
  expression: string;
  termType: string;
  hitCounts: {
    portfolio: number;
    scope?: number;
    focusArea?: number;
  };
  scopeTotal?: number;
  sampleHits: SearchPreviewHit[];
  esAvailable: boolean;
}

// Search Preview API
export const searchApi = {
  async previewSearchTerm(
    expression: string,
    options?: {
      termType?: string;
      searchFields?: 'title' | 'abstract' | 'both';
      focusAreaId?: string;
      superSector?: string;
      primarySector?: string;
      sectors?: string[];
      superSectors?: string[];
    }
  ): Promise<SearchPreviewResult> {
    const { data } = await api.post('/focus-areas/search-preview', {
      expression,
      termType: options?.termType || 'KEYWORD',
      searchFields: options?.searchFields || 'both',
      scopes: {
        focusAreaId: options?.focusAreaId,
        superSector: options?.superSector,
        primarySector: options?.primarySector,
        sectors: options?.sectors,
        superSectors: options?.superSectors
      }
    });
    return data;
  },

  async getScopeOptions(): Promise<ScopeOptions> {
    const { data } = await api.get('/focus-areas/scope-options');
    return data;
  }
};

// =============================================================================
// LLM Workflow Types
// =============================================================================

export type WorkflowStatus = 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR' | 'CANCELLED';

export interface LlmWorkflow {
  id: string;
  name: string;
  description?: string;
  workflowType: string;
  scopeType: string;
  scopeId?: string;
  config?: Record<string, unknown>;
  status: WorkflowStatus;
  finalResult?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  _count?: { jobs: number };
}

export interface WorkflowDetail extends LlmWorkflow {
  jobs: LlmJobSummary[];
  progress: WorkflowProgress;
}

export interface WorkflowProgress {
  total: number;
  pending: number;
  running: number;
  complete: number;
  error: number;
}

export interface WorkflowStatusResponse {
  id: string;
  name: string;
  status: WorkflowStatus;
  workflowType: string;
  progress: WorkflowProgress & Record<string, number>;
  completionPct: number;
  tokensUsed: number;
  updatedAt: string;
}

export interface LlmJobSummary {
  id: string;
  templateId: string;
  templateName?: string;
  templateType?: string;
  targetType: string;
  targetIds: string[];
  status: WorkflowStatus;
  roundNumber?: number;
  clusterIndex?: number;
  sortScore?: number;
  tokensUsed?: number;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  dependsOnIds: string[];
  dependedByIds: string[];
}

export interface LlmJobDetail extends LlmJobSummary {
  workflowId: string;
  targetData?: Record<string, unknown>;
  priority: number;
  retryCount: number;
  maxRetries: number;
  result?: Record<string, unknown>;
  dependencies: {
    upstream: Array<{ jobId: string; status: string; roundNumber?: number; clusterIndex?: number }>;
    downstream: Array<{ jobId: string; status: string; roundNumber?: number; clusterIndex?: number }>;
  };
}

export interface TournamentRoundConfig {
  templateId: string;
  topN: number;
  sortScoreField: string;
}

export interface TournamentConfig {
  rounds: TournamentRoundConfig[];
  initialClusterStrategy: 'score' | 'sector' | 'random';
  clusterSizeTarget?: number;
  synthesisTemplateId?: string;
}

export interface TwoStageConfig {
  perPatentTemplateId: string;
  synthesisTemplateId: string;
  sortScoreField?: string;
}

export interface EntityAnalysisResult {
  id: string;
  entityType: string;
  entityId: string;
  templateId?: string;
  jobId?: string;
  objectType?: string;
  objectId?: string;
  result: Record<string, unknown>;
  resultType: string;
  fieldValues?: Record<string, unknown>;
  model?: string;
  tokensUsed?: number;
  promptSent?: string;
  executedAt: string;
  createdAt: string;
}

// Workflow API
export const workflowApi = {
  // CRUD
  async listWorkflows(filters?: {
    scopeType?: string;
    scopeId?: string;
    workflowType?: string;
    status?: string;
  }): Promise<LlmWorkflow[]> {
    const { data } = await api.get('/workflows', { params: filters });
    return data;
  },

  async getWorkflow(id: string): Promise<WorkflowDetail> {
    const { data } = await api.get(`/workflows/${id}`);
    return data;
  },

  async createWorkflow(config: {
    name: string;
    description?: string;
    workflowType: string;
    scopeType: string;
    scopeId?: string;
    config?: Record<string, unknown>;
  }): Promise<LlmWorkflow> {
    const { data } = await api.post('/workflows', config);
    return data;
  },

  async deleteWorkflow(id: string): Promise<void> {
    await api.delete(`/workflows/${id}`);
  },

  // Execution
  async executeWorkflow(id: string): Promise<{ status: string; message: string }> {
    const { data } = await api.post(`/workflows/${id}/execute`);
    return data;
  },

  async cancelWorkflow(id: string): Promise<{ status: string; message: string }> {
    const { data } = await api.post(`/workflows/${id}/cancel`);
    return data;
  },

  async getWorkflowStatus(id: string): Promise<WorkflowStatusResponse> {
    const { data } = await api.get(`/workflows/${id}/status`);
    return data;
  },

  // Planning
  async planCustomWorkflow(id: string, jobs: Array<{
    templateId: string;
    targetType: string;
    targetIds: string[];
    targetData?: Record<string, unknown>;
    roundNumber?: number;
    clusterIndex?: number;
    priority?: number;
    dependsOnJobIndices?: number[];
  }>): Promise<{ message: string; jobIds: string[] }> {
    const { data } = await api.post(`/workflows/${id}/plan/custom`, { jobs });
    return data;
  },

  async planTournament(id: string, config: TournamentConfig): Promise<{
    message: string;
    jobIds: string[];
    progress: WorkflowProgress;
    config: Record<string, unknown>;
  }> {
    const { data } = await api.post(`/workflows/${id}/plan/tournament`, config);
    return data;
  },

  async planTwoStage(id: string, config: TwoStageConfig): Promise<{
    message: string;
    jobIds: string[];
    progress: WorkflowProgress;
  }> {
    const { data } = await api.post(`/workflows/${id}/plan/two-stage`, config);
    return data;
  },

  // Jobs
  async listJobs(workflowId: string, filters?: {
    status?: string;
    round?: number;
  }): Promise<LlmJobSummary[]> {
    const { data } = await api.get(`/workflows/${workflowId}/jobs`, { params: filters });
    return data;
  },

  async getJob(workflowId: string, jobId: string): Promise<LlmJobDetail> {
    const { data } = await api.get(`/workflows/${workflowId}/jobs/${jobId}`);
    return data;
  },

  async retryJob(workflowId: string, jobId: string): Promise<{ message: string }> {
    const { data } = await api.post(`/workflows/${workflowId}/jobs/${jobId}/retry`);
    return data;
  },

  async getReadyJobs(workflowId: string): Promise<LlmJobSummary[]> {
    const { data } = await api.get(`/workflows/${workflowId}/ready-jobs`);
    return data;
  },

  // Entity Analysis Results
  async getEntityResults(entityType: string, entityId: string, filters?: {
    templateId?: string;
    objectType?: string;
    objectId?: string;
  }): Promise<EntityAnalysisResult[]> {
    const { data } = await api.get(`/workflows/results/${entityType}/${entityId}`, { params: filters });
    return data;
  },
};

// =============================================================================
// Patent Family Exploration Types
// =============================================================================

export interface PatentFamilyExploration {
  id: string;
  seedPatentId: string;
  name?: string;
  description?: string;
  maxAncestorDepth: number;
  maxDescendantDepth: number;
  includeSiblings: boolean;
  includeCousins: boolean;
  limitToSectors: string[];
  limitToCpcPrefixes: string[];
  limitToFocusAreas: string[];
  requireInPortfolio: boolean;
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'ERROR';
  discoveredCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt?: string;
  _count?: { members: number };
}

export interface PatentFamilyMember {
  id: string;
  patentId: string;
  relationToSeed: string;
  generationDepth: number;
  inPortfolio: boolean;
  patentTitle?: string;
  assignee?: string;
  patentDate?: string;
  primarySector?: string;
  superSector?: string;
  forwardCitations?: number;
  score?: number;
}

export interface FamilyExplorationResult {
  exploration: PatentFamilyExploration;
  members: PatentFamilyMember[];
  generations: Record<string, { label: string; count: number }>;
}

export interface FamilyCacheStatus {
  patentId: string;
  inPortfolio: boolean;
  hasForwardCitations: boolean;
  hasBackwardCitations: boolean;
  hasParentDetails: boolean;
}

// Multi-seed exploration types
export type MergeStrategy = 'UNION' | 'INTERSECTION';

export interface MultiSeedConfig {
  seedPatentIds: string[];
  maxAncestorDepth?: number;
  maxDescendantDepth?: number;
  includeSiblings?: boolean;
  includeCousins?: boolean;
  limitToSectors?: string[];
  limitToCpcPrefixes?: string[];
  limitToCompetitors?: string[];
  limitToAffiliates?: string[];
  requireInPortfolio?: boolean;
  mergeStrategy?: MergeStrategy;
  minFilingYear?: number;
  name?: string;
  description?: string;
}

export interface PreviewResult {
  estimatedMembers: {
    total: number;
    parents: number;
    children: number;
    siblings: number;
    seeds: number;
  };
  seedOverlap: {
    sharedCitationsCount: number;
    commonSectors: string[];
  };
  cachedDataAvailable: number;
  estimatedApiCalls: number;
  seedDetails: Array<{
    patentId: string;
    title?: string;
    inPortfolio: boolean;
    hasCachedCitations: boolean;
  }>;
}

export interface CompetitorMatch {
  company: string;
  category: string;
  pattern: string;
}

export type DataRetrievalStatus =
  | 'portfolio'       // Data from portfolio (complete)
  | 'cached'          // Data retrieved and cached
  | 'not_attempted'   // Not yet attempted to retrieve
  | 'not_found'       // Attempted but not found (too recent, invalid ID)
  | 'partial';        // Some data available but incomplete

export interface EnrichedFamilyMember {
  patentId: string;
  relationToSeed: string;
  generationDepth: number;
  inPortfolio: boolean;
  patentTitle: string;
  assignee: string;
  patentDate: string;
  primarySector: string;
  superSector: string;
  forwardCitations?: number;
  score?: number;
  affiliate: string;
  competitorMatch?: CompetitorMatch | null;
  seedPatentIds: string[];
  remainingYears?: number;
  dataStatus: DataRetrievalStatus;
  dataStatusReason?: string;
}

export interface MultiSeedExplorationResult {
  exploration: PatentFamilyExploration & {
    seedPatentIds: string[];
    mergeStrategy: MergeStrategy;
  };
  members: EnrichedFamilyMember[];
  memberCount: number;
}

export interface FilterOptions {
  competitors: string[];
  affiliates: Array<{ key: string; displayName: string }>;
}

// Litigation/IPR enrichment types
export interface LitigationIndicator {
  patentId: string;
  hasIPR: boolean;
  iprCount: number;
  iprTrials?: Array<{
    trialNumber: string;
    trialType: string;
    status?: string;
    petitionerName?: string;
    filingDate?: string;
    institutionDecision?: string;
  }>;
  hasProsecutionHistory: boolean;
  prosecutionStatus?: string;
  officeActionCount?: number;
  rejectionCount?: number;
}

export interface EnrichmentStatusItem {
  patentId: string;
  status: 'pending' | 'in_progress' | 'complete' | 'error';
  hasIPR?: boolean;
  hasProsecutionHistory?: boolean;
  error?: string;
}

export interface EnrichmentResult {
  enriched: number;
  total: number;
  indicators: LitigationIndicator[];
  truncated: boolean;
}

export interface FetchPatentDetailsResult {
  fetched: number;
  alreadyCached: number;
  failed: number;
  truncated: boolean;
  patentIds: {
    fetched: string[];
    alreadyCached: string[];
    failed: string[];
  };
}

export interface EnrichWithDetailsResult {
  detailsFetched: Omit<FetchPatentDetailsResult, 'truncated'>;
  litigation: {
    enriched: number;
    indicators: LitigationIndicator[];
  };
  total: number;
  truncated: boolean;
}

// Patent Family API
export const patentFamilyApi = {
  async createExploration(params: {
    seedPatentId: string;
    name?: string;
    description?: string;
    maxAncestorDepth?: number;
    maxDescendantDepth?: number;
    includeSiblings?: boolean;
    includeCousins?: boolean;
    limitToSectors?: string[];
    limitToCpcPrefixes?: string[];
    limitToFocusAreas?: string[];
    requireInPortfolio?: boolean;
  }): Promise<PatentFamilyExploration> {
    const { data } = await api.post('/patent-families/explorations', params);
    return data;
  },

  async listExplorations(seedPatentId?: string): Promise<PatentFamilyExploration[]> {
    const { data } = await api.get('/patent-families/explorations', {
      params: seedPatentId ? { seedPatentId } : {},
    });
    return data;
  },

  async getExploration(id: string): Promise<FamilyExplorationResult> {
    const { data } = await api.get(`/patent-families/explorations/${id}`);
    return data;
  },

  async deleteExploration(id: string): Promise<void> {
    await api.delete(`/patent-families/explorations/${id}`);
  },

  async executeExploration(id: string): Promise<{ status: string; message: string; explorationId: string }> {
    const { data } = await api.post(`/patent-families/explorations/${id}/execute`);
    return data;
  },

  async getStatus(id: string): Promise<{
    id: string;
    status: string;
    discoveredCount: number;
    errorMessage?: string;
    updatedAt: string;
  }> {
    const { data } = await api.get(`/patent-families/explorations/${id}/status`);
    return data;
  },

  async getMembers(id: string): Promise<{
    members: PatentFamilyMember[];
    generations: Record<string, { label: string; count: number }>;
    total: number;
  }> {
    const { data } = await api.get(`/patent-families/explorations/${id}/members`);
    return data;
  },

  async addToFocusArea(explorationId: string, focusAreaId: string, patentIds: string[]): Promise<{ added: number; total: number }> {
    const { data } = await api.post(`/patent-families/explorations/${explorationId}/add-to-focus-area`, {
      focusAreaId,
      patentIds,
    });
    return data;
  },

  async getCacheStatus(patentId: string): Promise<FamilyCacheStatus> {
    const { data } = await api.get(`/patent-families/cache-status/${patentId}`);
    return data;
  },

  // Multi-seed exploration
  async previewMultiSeed(config: MultiSeedConfig): Promise<PreviewResult> {
    const { data } = await api.post('/patent-families/explorations/preview', config);
    return data;
  },

  async executeMultiSeed(config: MultiSeedConfig): Promise<MultiSeedExplorationResult> {
    const { data } = await api.post('/patent-families/explorations/multi-seed', config);
    return data;
  },

  async createFocusAreaFromExploration(
    explorationId: string,
    params: {
      name: string;
      description?: string;
      patentIds: string[];
      includeExternalPatents?: boolean;
      ownerId?: string;
    }
  ): Promise<{ focusArea: { id: string; name: string; patentCount: number }; added: number }> {
    const { data } = await api.post(`/patent-families/explorations/${explorationId}/create-focus-area`, params);
    return data;
  },

  async createFocusAreaDirect(params: {
    name: string;
    description?: string;
    patentIds: string[];
    includeExternalPatents?: boolean;
    ownerId?: string;
  }): Promise<{ focusArea: { id: string; name: string; patentCount: number }; added: number }> {
    const { data } = await api.post('/patent-families/create-focus-area', params);
    return data;
  },

  async getFilterOptions(): Promise<FilterOptions> {
    const { data } = await api.get('/patent-families/filter-options');
    return data;
  },

  // Litigation/IPR enrichment
  async enrichLitigation(
    patentIds: string[],
    options?: { includeIpr?: boolean; includeProsecution?: boolean }
  ): Promise<EnrichmentResult> {
    const { data } = await api.post('/patent-families/enrich-litigation', {
      patentIds,
      ...options,
    });
    return data;
  },

  async getLitigationStatus(patentIds: string[]): Promise<{ statuses: EnrichmentStatusItem[] }> {
    const { data } = await api.get('/patent-families/litigation-status', {
      params: { patentIds: patentIds.join(',') },
    });
    return data;
  },

  async getPatentIPR(patentId: string): Promise<LitigationIndicator> {
    const { data } = await api.get(`/patent-families/ipr/${patentId}`);
    return data;
  },

  async getPatentProsecution(patentId: string): Promise<LitigationIndicator> {
    const { data } = await api.get(`/patent-families/prosecution/${patentId}`);
    return data;
  },

  async enrichExplorationLitigation(
    explorationId: string,
    options?: { patentIds?: string[]; includeIpr?: boolean; includeProsecution?: boolean }
  ): Promise<EnrichmentResult & { explorationId: string }> {
    const { data } = await api.post(`/patent-families/explorations/${explorationId}/enrich-litigation`, options);
    return data;
  },

  // Fetch basic patent details (title, assignee, etc.) for external patents
  async fetchPatentDetails(patentIds: string[]): Promise<FetchPatentDetailsResult> {
    const { data } = await api.post('/patent-families/fetch-details', { patentIds });
    return data;
  },

  // Fetch patent details AND litigation data in one call (recommended for enrichment)
  async enrichWithDetails(
    patentIds: string[],
    options?: {
      fetchBasicDetails?: boolean;
      includeIpr?: boolean;
      includeProsecution?: boolean;
      cacheOnly?: boolean;  // Only read from local cache, skip live API calls
      limit?: number;  // Default 200, max 500
    }
  ): Promise<EnrichWithDetailsResult & { originalCount?: number }> {
    const { data } = await api.post('/patent-families/enrich-with-details', {
      patentIds,
      ...options,
    });
    return data;
  },
};

// =============================================================================
// Patent Family V2 (Iterative Expansion) Types
// =============================================================================

export interface ScoringWeightsV2 {
  taxonomicOverlap: number;
  commonPriorArt: number;
  commonForwardCites: number;
  competitorOverlap: number;
  portfolioAffiliate: number;
  citationSectorAlignment: number;
  multiPathConnectivity: number;
  assigneeRelationship: number;
  temporalProximity: number;
  depthDecayRate: number;
}

export interface DimensionScoresV2 {
  taxonomicOverlap: number;
  commonPriorArt: number;
  commonForwardCites: number;
  competitorOverlap: number;
  portfolioAffiliate: number;
  citationSectorAlignment: number;
  multiPathConnectivity: number;
  assigneeRelationship: number;
  temporalProximity: number;
}

export interface CandidateScoreV2 {
  patentId: string;
  dimensions: DimensionScoresV2;
  compositeScore: number;
  rawWeightedScore: number;
  generationDistance: number;
  depthMultiplier: number;
  dataCompleteness: number;
}

export interface ScoredCandidateV2 {
  patentId: string;
  title?: string;
  assignee?: string;
  score: CandidateScoreV2;
  generation: number;
  relation: string;
  inPortfolio: boolean;
  isCompetitor: boolean;
  competitorName?: string;
  isAffiliate: boolean;
  sector?: string;
  superSector?: string;
  filingDate?: string;
  remainingYears?: number;
  forwardCitationCount?: number;
  discoveredVia: string[];
  dataStatus: string;
  zone: 'member' | 'expansion' | 'rejected';
}

export interface ExpansionResultV2 {
  candidates: ScoredCandidateV2[];
  stats: {
    totalDiscovered: number;
    aboveMembership: number;
    inExpansionZone: number;
    belowExpansion: number;
    pruned: number;
    direction: string;
    generationDepth: number;
  };
  scoreDistribution: number[];
  warnings: string[];
}

export interface ExpansionHistoryStep {
  stepNumber: number;
  direction: string;
  generationDepth: number;
  candidatesEvaluated: number;
  autoIncluded: number;
  expansionZone: number;
  autoRejected: number;
  createdAt: string;
}

export interface ExplorationStateV2 {
  id: string;
  name?: string;
  seedPatentIds: string[];
  weights: ScoringWeightsV2;
  membershipThreshold: number;
  expansionThreshold: number;
  currentGeneration: number;
  members: ScoredCandidateV2[];
  candidates: ScoredCandidateV2[];
  excluded: ScoredCandidateV2[];
  expansionHistory: ExpansionHistoryStep[];
  status: string;
  memberCount: number;
  candidateCount: number;
}

export interface ScoringPresetV2 {
  label: string;
  description: string;
  weights: ScoringWeightsV2;
}

export interface ExplorationSummaryV2 {
  id: string;
  name?: string;
  seedPatentId: string;
  seedPatentIds: string[];
  version: number;
  status: string;
  currentGeneration: number;
  memberCount: number;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
  _count?: { members: number };
}

// Patent Family V2 API
export const patentFamilyV2Api = {
  async listExplorations(): Promise<ExplorationSummaryV2[]> {
    const { data } = await api.get('/patent-families/explorations');
    // Filter to v2 only (version === 2)
    return (data as ExplorationSummaryV2[]).filter(e => e.version === 2);
  },

  async deleteExploration(id: string): Promise<void> {
    await api.delete(`/patent-families/explorations/${id}`);
  },

  async getPresets(): Promise<Record<string, ScoringPresetV2>> {
    const { data } = await api.get('/patent-families/v2/presets');
    return data;
  },

  async createExploration(params: {
    seedPatentIds: string[];
    name?: string;
    weights?: ScoringWeightsV2;
    membershipThreshold?: number;
    expansionThreshold?: number;
  }): Promise<ExplorationStateV2> {
    const { data } = await api.post('/patent-families/v2/explorations', params);
    return data;
  },

  async getExploration(id: string): Promise<ExplorationStateV2> {
    const { data } = await api.get(`/patent-families/v2/explorations/${id}`);
    return data;
  },

  async expand(id: string, params: {
    direction: 'forward' | 'backward' | 'both';
    weights?: ScoringWeightsV2;
    membershipThreshold?: number;
    expansionThreshold?: number;
    maxCandidates?: number;
  }): Promise<ExpansionResultV2> {
    const { data } = await api.post(`/patent-families/v2/explorations/${id}/expand`, params);
    return data;
  },

  async expandSiblings(id: string, params: {
    direction: 'forward' | 'backward' | 'both';
    weights?: ScoringWeightsV2;
    membershipThreshold?: number;
    expansionThreshold?: number;
    maxCandidates?: number;
  }): Promise<ExpansionResultV2> {
    const { data } = await api.post(`/patent-families/v2/explorations/${id}/expand-siblings`, params);
    return data;
  },

  async rescore(id: string, params: {
    weights: ScoringWeightsV2;
    membershipThreshold: number;
    expansionThreshold: number;
  }): Promise<ExpansionResultV2> {
    const { data } = await api.post(`/patent-families/v2/explorations/${id}/rescore`, params);
    return data;
  },

  async updateCandidates(id: string, updates: Array<{ patentId: string; status: 'member' | 'candidate' | 'excluded' }>): Promise<{
    updated: number;
    memberCount: number;
    candidateCount: number;
  }> {
    const { data } = await api.post(`/patent-families/v2/explorations/${id}/candidates`, { updates });
    return data;
  },

  async save(id: string, params: { name: string; description?: string }): Promise<{ message: string }> {
    const { data } = await api.post(`/patent-families/v2/explorations/${id}/save`, params);
    return data;
  },

  async createFocusArea(id: string, params: {
    name: string;
    description?: string;
    patentIds?: string[];
    includeExternalPatents?: boolean;
  }): Promise<{ focusArea: { id: string; name: string; patentCount: number }; added: number }> {
    // When explicit patentIds provided, use the generic endpoint that accepts them
    if (params.patentIds && params.patentIds.length > 0) {
      const { data } = await api.post(`/patent-families/explorations/${id}/create-focus-area`, params);
      return data;
    }
    // Otherwise use v2 endpoint that auto-selects server-side members
    const { data } = await api.post(`/patent-families/v2/explorations/${id}/create-focus-area`, params);
    return data;
  },
};

// =============================================================================
// Sector Management API
// =============================================================================

export const sectorApi = {
  // Sectors
  async getSectors(superSectorId?: string): Promise<SectorDetail[]> {
    const params = superSectorId ? { superSectorId } : {};
    const { data } = await api.get('/sectors', { params });
    return data;
  },

  async getSector(id: string): Promise<SectorDetail> {
    const { data } = await api.get(`/sectors/${id}`);
    return data;
  },

  async createSector(sector: {
    name: string;
    displayName: string;
    description?: string;
    superSectorId?: string;
    cpcPrefixes?: string[];
    damagesTier?: string;
    damagesRating?: number;
  }): Promise<SectorDetail> {
    const { data } = await api.post('/sectors', sector);
    return data;
  },

  async updateSector(id: string, updates: Partial<SectorDetail>): Promise<SectorDetail> {
    const { data } = await api.put(`/sectors/${id}`, updates);
    return data;
  },

  async deleteSector(id: string): Promise<void> {
    await api.delete(`/sectors/${id}`);
  },

  // Rules
  async getRules(sectorId: string): Promise<SectorRule[]> {
    const { data } = await api.get(`/sectors/${sectorId}/rules`);
    return data;
  },

  async addRule(sectorId: string, rule: {
    ruleType: SectorRuleType;
    expression: string;
    priority?: number;
    isExclusion?: boolean;
    scope?: string;
    portfolioId?: string;
    description?: string;
  }): Promise<SectorRule> {
    const { data } = await api.post(`/sectors/${sectorId}/rules`, rule);
    return data;
  },

  async updateRule(sectorId: string, ruleId: string, updates: Partial<SectorRule>): Promise<SectorRule> {
    const { data } = await api.put(`/sectors/${sectorId}/rules/${ruleId}`, updates);
    return data;
  },

  async deleteRule(sectorId: string, ruleId: string): Promise<void> {
    await api.delete(`/sectors/${sectorId}/rules/${ruleId}`);
  },

  async previewRule(rule: {
    ruleType: SectorRuleType;
    expression: string;
    sectorId: string;
  }): Promise<RulePreviewResult> {
    const { data } = await api.post('/sectors/preview-rule', rule);
    return data;
  },

  async promoteRule(ruleId: string): Promise<SectorRule> {
    const { data } = await api.post(`/sectors/rules/${ruleId}/promote`);
    return data;
  },

  // Actions
  async recalculateSector(sectorId: string): Promise<{ sectorId: string; patentCount: number }> {
    const { data } = await api.post(`/sectors/${sectorId}/recalculate`);
    return data;
  },

  async reassignAll(): Promise<{ message: string; sectorCounts: Record<string, number> }> {
    const { data } = await api.post('/sectors/reassign-all');
    return data;
  },

  async seed(): Promise<SeedSummary> {
    const { data } = await api.post('/sectors/seed');
    return data;
  },

  // Super-Sectors
  async getSuperSectors(): Promise<SuperSectorDetail[]> {
    const { data } = await api.get('/sectors/super-sectors');
    return data;
  },

  async createSuperSector(superSector: {
    name: string;
    displayName: string;
    description?: string;
  }): Promise<SuperSectorDetail> {
    const { data } = await api.post('/sectors/super-sectors', superSector);
    return data;
  },

  async updateSuperSector(id: string, updates: Partial<SuperSectorDetail>): Promise<SuperSectorDetail> {
    const { data } = await api.put(`/sectors/super-sectors/${id}`, updates);
    return data;
  },

  // Sub-Sectors
  async getSubSectors(sectorName: string): Promise<SubSector[]> {
    const { data } = await api.get(`/sectors/sub-sectors/${sectorName}`);
    return data;
  },
};

// Sub-Sector type
export interface SubSector {
  id: string;
  sectorId: string;
  name: string;
  displayName: string;
  description: string | null;
  groupingType: 'CPC_SUBGROUP' | 'DATE_RANGE' | 'MANUAL';
  cpcCode: string | null;
  cpcPrefix: string | null;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  status: 'PROSPECTIVE' | 'APPLIED' | 'REJECTED';
  patentCount: number;
  needsReview: boolean;
  reviewReason: string | null;
  sector?: {
    id: string;
    name: string;
    displayName: string;
  };
}

// Sector Enrichment types
export interface SectorEnrichmentData {
  name: string;
  totalPatents: number;
  checkedPatents: number;
  scoreRange: string;
  enrichment: {
    llm: number; llmPct: number;
    prosecution: number; prosecutionPct: number;
    ipr: number; iprPct: number;
    family: number; familyPct: number;
  };
  gaps: {
    llm: number;
    prosecution: number;
    ipr: number;
    family: number;
  };
}

export interface SectorEnrichmentSummary {
  totalPatents: number;
  topPerSector: number;
  sectors: SectorEnrichmentData[];
}

// Batch Job types
export type CoverageType = 'llm' | 'prosecution' | 'ipr' | 'family';
export type TargetType = 'tier' | 'super-sector' | 'sector';

export interface BatchJob {
  id: string;
  groupId?: string;
  targetType: TargetType;
  targetValue: string;
  coverageType: CoverageType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  pid?: number;
  startedAt?: string;
  completedAt?: string;
  logFile?: string;
  error?: string;
  progress?: {
    total: number;
    completed: number;
  };
  estimatedRate?: number;
  actualRate?: number;
  estimatedCompletion?: string;
}

export interface BatchJobsResponse {
  jobs: BatchJob[];
  stats: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export interface GapsResponse {
  targetType: TargetType;
  targetValue: string;
  gaps: Record<CoverageType, { total: number; gap: number }>;
  estimatedRates: Record<CoverageType, number>;
}

export interface StartJobsResponse {
  groupId: string;
  jobs: BatchJob[];
  gaps: Record<CoverageType, { total: number; gap: number }>;
}

// Sector Enrichment API (extension of patentApi)
export const enrichmentApi = {
  async getSectorEnrichment(topPerSector = 500): Promise<SectorEnrichmentSummary> {
    const { data } = await api.get('/patents/sector-enrichment', { params: { topPerSector } });
    return data;
  },
};

// Batch Jobs API
export const batchJobsApi = {
  async getJobs(): Promise<BatchJobsResponse> {
    const { data } = await api.get('/batch-jobs');
    return data;
  },

  async getGaps(targetType: TargetType, targetValue: string, topN?: number): Promise<GapsResponse> {
    const { data } = await api.get('/batch-jobs/gaps', { params: { targetType, targetValue, topN } });
    return data;
  },

  async startJobs(params: {
    targetType: TargetType;
    targetValue: string;
    coverageTypes: CoverageType[];
    maxHours?: number;
    topN?: number;  // For super-sector/sector: limit to top N patents by score
  }): Promise<StartJobsResponse> {
    const { data } = await api.post('/batch-jobs', params);
    return data;
  },

  async cancelJob(jobId: string): Promise<{ job: BatchJob }> {
    const { data } = await api.delete(`/batch-jobs/${jobId}`);
    return data;
  },

  async cancelJobGroup(groupId: string): Promise<{ cancelled: number }> {
    const { data } = await api.delete(`/batch-jobs/group/${groupId}`);
    return data;
  },

  async getJobLog(jobId: string, lines = 50): Promise<{ log: string }> {
    const { data } = await api.get(`/batch-jobs/${jobId}/log`, { params: { lines } });
    return data;
  },
};

// =============================================================================
// V3 Consensus Scoring API Helpers
// =============================================================================

// Re-export V3 types for convenience
export type { V3ConsensusRole, V3ConsensusPreset, V3ConsensusConfig, V3ConsensusScoredPatent, V3ConsensusSnapshot };

// Default roles with their default V2 presets
export const DEFAULT_V3_ROLES: V3ConsensusRole[] = [
  { roleId: 'executive', roleName: 'Executive', v2PresetId: 'default', consensusWeight: 25 },
  { roleId: 'defensive', roleName: 'Defensive Counsel', v2PresetId: 'defensive', consensusWeight: 20 },
  { roleId: 'balanced', roleName: 'Balanced Strategist', v2PresetId: 'default', consensusWeight: 20 },
  { roleId: 'licensing', roleName: 'Licensing Focus', v2PresetId: 'licensing_focused', consensusWeight: 15 },
  { roleId: 'litigation', roleName: 'Aggressive Litigator', v2PresetId: 'litigation_focused', consensusWeight: 10 },
  { roleId: 'quickwins', roleName: 'Quick Wins', v2PresetId: 'quick_wins', consensusWeight: 10 },
];

// Built-in V3 presets
export const BUILTIN_V3_PRESETS: V3ConsensusPreset[] = [
  {
    id: 'balanced-team',
    name: 'Balanced Team',
    description: 'Default weights - balances all stakeholder perspectives equally',
    isBuiltIn: true,
    roles: [...DEFAULT_V3_ROLES],
  },
  {
    id: 'executive-led',
    name: 'Executive-Led',
    description: 'Executive voice dominates - for board-level portfolio decisions',
    isBuiltIn: true,
    roles: [
      { roleId: 'executive', roleName: 'Executive', v2PresetId: 'default', consensusWeight: 40 },
      { roleId: 'defensive', roleName: 'Defensive Counsel', v2PresetId: 'defensive', consensusWeight: 15 },
      { roleId: 'balanced', roleName: 'Balanced Strategist', v2PresetId: 'default', consensusWeight: 15 },
      { roleId: 'licensing', roleName: 'Licensing Focus', v2PresetId: 'licensing_focused', consensusWeight: 15 },
      { roleId: 'litigation', roleName: 'Aggressive Litigator', v2PresetId: 'litigation_focused', consensusWeight: 10 },
      { roleId: 'quickwins', roleName: 'Quick Wins', v2PresetId: 'quick_wins', consensusWeight: 5 },
    ],
  },
  {
    id: 'litigation-ready',
    name: 'Litigation Ready',
    description: 'Emphasis on enforcement - for active litigation campaigns',
    isBuiltIn: true,
    roles: [
      { roleId: 'executive', roleName: 'Executive', v2PresetId: 'default', consensusWeight: 15 },
      { roleId: 'defensive', roleName: 'Defensive Counsel', v2PresetId: 'defensive', consensusWeight: 15 },
      { roleId: 'balanced', roleName: 'Balanced Strategist', v2PresetId: 'default', consensusWeight: 15 },
      { roleId: 'licensing', roleName: 'Licensing Focus', v2PresetId: 'licensing_focused', consensusWeight: 10 },
      { roleId: 'litigation', roleName: 'Aggressive Litigator', v2PresetId: 'litigation_focused', consensusWeight: 25 },
      { roleId: 'quickwins', roleName: 'Quick Wins', v2PresetId: 'quick_wins', consensusWeight: 20 },
    ],
  },
  {
    id: 'licensing-campaign',
    name: 'Licensing Campaign',
    description: 'Emphasis on licensing value - for monetization programs',
    isBuiltIn: true,
    roles: [
      { roleId: 'executive', roleName: 'Executive', v2PresetId: 'default', consensusWeight: 15 },
      { roleId: 'defensive', roleName: 'Defensive Counsel', v2PresetId: 'defensive', consensusWeight: 15 },
      { roleId: 'balanced', roleName: 'Balanced Strategist', v2PresetId: 'default', consensusWeight: 15 },
      { roleId: 'licensing', roleName: 'Licensing Focus', v2PresetId: 'licensing_focused', consensusWeight: 30 },
      { roleId: 'litigation', roleName: 'Aggressive Litigator', v2PresetId: 'litigation_focused', consensusWeight: 10 },
      { roleId: 'quickwins', roleName: 'Quick Wins', v2PresetId: 'quick_wins', consensusWeight: 15 },
    ],
  },
];

// ============================================================================
// CPC (Cooperative Patent Classification) API
// ============================================================================

export interface CpcDescription {
  code: string;
  title: string;
  titleLong?: string;
  level: 'SECTION' | 'CLASS' | 'SUBCLASS' | 'GROUP' | 'SUBGROUP';
  parentCode?: string;
  hierarchy?: CpcDescription[];
  sector?: string;
  superSector?: string;
}

export interface CpcHierarchy {
  section?: CpcDescription;
  class?: CpcDescription;
  subclass?: CpcDescription;
  group?: CpcDescription;
  subgroup?: CpcDescription;
}

export interface CpcStats {
  total: number;
  byLevel: Record<string, number>;
  withDefinitions: number;
  recentlyUpdated: number;
  cache: { size: number; hitRate: string };
}

export interface CpcSeedProgress {
  success: boolean;
  filesProcessed: number;
  codesInserted: number;
  codesUpdated: number;
  definitionsApplied: number;
  errors: string[];
}

export const cpcApi = {
  /**
   * Look up a single CPC code
   */
  async lookup(code: string, includeHierarchy = false): Promise<CpcDescription | null> {
    try {
      const { data } = await api.get(`/cpc/lookup/${code}`, {
        params: { hierarchy: includeHierarchy ? 'true' : undefined }
      });
      return data;
    } catch (error: any) {
      if (error.response?.status === 404) return null;
      throw error;
    }
  },

  /**
   * Batch look up multiple CPC codes
   */
  async batchLookup(codes: string[]): Promise<Record<string, CpcDescription | null>> {
    const { data } = await api.post('/cpc/batch-lookup', { codes });
    return data;
  },

  /**
   * Get full hierarchy for a CPC code
   */
  async getHierarchy(code: string): Promise<{ code: string; hierarchy: CpcHierarchy }> {
    const { data } = await api.get(`/cpc/hierarchy/${code}`);
    return data;
  },

  /**
   * Get immediate children of a CPC code
   */
  async getChildren(code: string): Promise<{ code: string; children: CpcDescription[]; count: number }> {
    const { data } = await api.get(`/cpc/children/${code}`);
    return data;
  },

  /**
   * Search CPC codes by text
   */
  async search(query: string, options?: { level?: string; limit?: number }): Promise<{
    query: string;
    results: CpcDescription[];
    count: number;
  }> {
    const { data } = await api.get('/cpc/search', {
      params: { q: query, ...options }
    });
    return data;
  },

  /**
   * Get all CPC codes under a prefix
   */
  async getByPrefix(prefix: string, options?: { includeNotAllocatable?: boolean; limit?: number }): Promise<{
    prefix: string;
    results: CpcDescription[];
    count: number;
  }> {
    const { data } = await api.get(`/cpc/prefix/${prefix}`, { params: options });
    return data;
  },

  /**
   * Get sector mapping for a CPC code
   */
  async getSector(code: string): Promise<{ code: string; sector: string | null; superSector: string | null }> {
    const { data } = await api.get(`/cpc/sector/${code}`);
    return data;
  },

  /**
   * Get CPC database statistics
   */
  async getStats(): Promise<CpcStats> {
    const { data } = await api.get('/cpc/stats');
    return data;
  },

  /**
   * Get CPC configuration status
   */
  async getConfig(): Promise<{ configured: boolean; schemeDir: string | null; definitionDir: string | null }> {
    const { data } = await api.get('/cpc/config');
    return data;
  },

  /**
   * Seed CPC codes from XML files
   */
  async seed(options?: { subclasses?: string[]; skipDefinitions?: boolean }): Promise<CpcSeedProgress> {
    const { data } = await api.post('/cpc/seed', options || {});
    return data;
  },

  /**
   * Seed only patent-relevant CPC codes (faster)
   */
  async seedRelevant(): Promise<CpcSeedProgress> {
    const { data } = await api.post('/cpc/seed-relevant');
    return data;
  },

  /**
   * Clear the CPC lookup cache
   */
  async clearCache(): Promise<{ success: boolean; message: string }> {
    const { data } = await api.post('/cpc/clear-cache');
    return data;
  },
};

// =============================================================================
// Scoring Templates Types
// =============================================================================

export interface ScoringQuestion {
  fieldName: string;
  displayName: string;
  question: string;
  answerType: 'numeric';
  scale: { min: number; max: number };
  weight: number;
  requiresReasoning: boolean;
  reasoningPrompt?: string;
  sourceLevel: 'portfolio' | 'super_sector' | 'sector' | 'sub_sector';
}

export interface ScoringTemplateConfig {
  id: string;
  name: string;
  description: string;
  level: 'portfolio' | 'super_sector' | 'sector' | 'sub_sector';
  questions: ScoringQuestion[];
  scoringGuidance?: string[];
  contextDescription?: string;
}

export interface MergedTemplate {
  level: 'super_sector' | 'sector' | 'sub_sector';
  inheritanceChain: string[];
  questionCount: number;
  totalWeight: number;
  questions: ScoringQuestion[];
  availableFields: string[];
}

export interface TemplatePreviewContext {
  patentId: string;
  patentTitle: string;
  context: {
    title: string;
    abstract: string;
    claims?: string;
    cpcCodes: string[];
  };
  renderedPrompt: string;
  estimatedTokens: number;
}

export interface TemplatePreviewResult extends TemplatePreviewContext {
  llmResponse: {
    scores: Record<string, number>;
    reasoning: Record<string, string>;
  };
  actualTokens: { input: number; output: number };
}

export interface SectorScoringProgress {
  level: 'super_sector' | 'sector' | 'sub_sector';
  name: string;
  displayName?: string;
  superSector?: string;
  total: number;
  scored: number;
  remaining: number;
  percentComplete: number;
  withClaims: number;
  avgScore?: number | null;
  lastScoredAt?: string;
}

export interface ScoredPatentMetric {
  fieldName: string;
  displayName: string;
  score: number;
  reasoning: string;
  confidence?: number;
}

export interface ScoredPatent {
  patentId: string;
  patentTitle: string;
  patentDate?: string;
  assignee?: string;
  compositeScore: number;
  withClaims: boolean;
  executedAt?: string;
  templateVersion?: number;
  metrics: ScoredPatentMetric[];
}

export interface SectorScoresResponse {
  sectorName: string;
  sectorDisplayName: string;
  superSector: string;
  total: number;
  limit: number;
  offset: number;
  metricNames: string[];
  results: ScoredPatent[];
}

export interface SuperSectorProgress {
  name: string;
  displayName: string;
  sectorCount: number;
  totals: {
    total: number;
    scored: number;
    withClaims: number;
    remaining: number;
    percentComplete: number;
    avgScore: number | null;
  };
  sectors: Array<{
    sectorId: string;
    sectorName: string;
    displayName: string;
    total: number;
    scored: number;
    withClaims: number;
    remaining: number;
    percentComplete: number;
    avgScore: number | null;
  }>;
}

export interface DynamicColumns {
  baseColumns: string[];
  scoreColumns: string[];
  reasoningColumns: string[];
  availableColumns: string[];
  commonColumns: string[];
}

export interface ScoringConfigSummary {
  portfolioDefault: ScoringTemplateConfig;
  superSectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
  sectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
  subSectors: Array<{ filename: string; template: ScoringTemplateConfig }>;
  summary: {
    superSectorCount: number;
    sectorCount: number;
    subSectorCount: number;
  };
}

export interface SubSectorInfo {
  id: string;
  name: string;
  displayName: string;
  cpcPatterns: string[];
  patentCount: number;
  scoredCount: number;
}

// Scoring Templates API
export const scoringTemplatesApi = {
  /**
   * Get all scoring template configs
   */
  async getConfig(): Promise<ScoringConfigSummary> {
    const { data } = await api.get('/scoring-templates/config');
    return data;
  },

  /**
   * Get merged template with inherited questions
   */
  async getMergedTemplate(superSectorName: string): Promise<MergedTemplate> {
    const { data } = await api.get(`/scoring-templates/config/merged/${superSectorName}`);
    return data;
  },

  /**
   * Sync templates from JSON config to database
   */
  async syncTemplates(): Promise<{ message: string; synced: number }> {
    const { data } = await api.post('/scoring-templates/sync');
    return data;
  },

  /**
   * Preview rendered prompt for a patent
   */
  async previewPrompt(params: {
    patentId: string;
    sectorName: string;
    includeClaims?: boolean;
  }): Promise<{
    patentId: string;
    patentTitle: string;
    sector: string;
    superSector: string;
    questionCount: number;
    inheritanceChain: string[];
    estimatedTokens: number;
    renderedPrompt: string;
    questions: Array<{ fieldName: string; displayName: string; weight: number }>;
  }> {
    const { data } = await api.post('/scoring-templates/llm/preview-patent', params);
    return data;
  },

  /**
   * Get scoring progress for a sector
   */
  async getSectorProgress(sectorName: string): Promise<SectorScoringProgress> {
    const { data } = await api.get(`/scoring-templates/llm/sector-progress/${sectorName}`);
    return data;
  },

  /**
   * Start scoring a sector
   */
  async scoreSector(
    sectorName: string,
    options?: { useClaims?: boolean; rescore?: boolean; minYear?: number; topN?: number }
  ): Promise<{ message: string; total: number }> {
    const params = new URLSearchParams();
    if (options?.useClaims) params.append('useClaims', 'true');
    if (options?.rescore) params.append('rescore', 'true');
    if (options?.minYear) params.append('minYear', options.minYear.toString());
    if (options?.topN) params.append('topN', options.topN.toString());
    const { data } = await api.post(`/scoring-templates/llm/score-sector/${sectorName}?${params}`);
    return data;
  },

  /**
   * Get scores for a sub-sector
   */
  async getSubSectorScores(subSectorId: string): Promise<{
    subSectorId: string;
    stats: { count: number; avgScore: number; minScore: number; maxScore: number };
    scores: Array<{
      patentId: string;
      compositeScore: number;
      normalizedScore: number | null;
      rank: number | null;
      metrics: Record<string, { score: number; reasoning: string }>;
    }>;
  }> {
    const { data } = await api.get(`/scoring-templates/scores/sub-sector/${subSectorId}`);
    return data;
  },

  /**
   * Get score for a specific patent
   */
  async getPatentScore(patentId: string): Promise<{
    patentId: string;
    templateId: string;
    compositeScore: number;
    normalizedScore: number | null;
    metrics: Record<string, { score: number; reasoning: string; confidence?: number }>;
    scoredAt: string;
  } | null> {
    try {
      const { data } = await api.get(`/scoring-templates/scores/patent/${patentId}`);
      return data;
    } catch (e) {
      return null;
    }
  },

  /**
   * Normalize scores within a sector
   */
  async normalizeSector(sectorId: string): Promise<{ message: string; normalized: number }> {
    const { data } = await api.post(`/scoring-templates/scores/normalize/sector/${sectorId}`);
    return data;
  },

  /**
   * Export scores for a super-sector
   */
  async exportScores(superSector: string): Promise<Blob> {
    const response = await api.get(`/scoring-templates/export/${superSector}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Get scored patents for a sector with full metrics
   */
  async getSectorScores(sectorName: string, options?: {
    limit?: number;
    offset?: number;
    sortBy?: string;
    order?: 'asc' | 'desc';
  }): Promise<SectorScoresResponse> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());
    if (options?.sortBy) params.append('sortBy', options.sortBy);
    if (options?.order) params.append('order', options.order);
    const { data } = await api.get(`/scoring-templates/llm/sector-scores/${sectorName}?${params}`);
    return data;
  },

  /**
   * Get aggregated progress for a super-sector
   */
  async getSuperSectorProgress(superSectorName: string): Promise<SuperSectorProgress> {
    const { data } = await api.get(`/scoring-templates/llm/super-sector-progress/${superSectorName}`);
    return data;
  },

  /**
   * Get claims analysis for a super-sector
   */
  async getClaimsAnalysis(superSector: string): Promise<{
    superSector: string;
    totalPatents: number;
    withClaims: number;
    withoutClaims: number;
    sectors: Array<{
      name: string;
      total: number;
      withClaims: number;
      percentage: number;
    }>;
  }> {
    const { data } = await api.get(`/scoring-templates/claims-analysis/${superSector}`);
    return data;
  },

  /**
   * Get claims stats for a patent
   */
  async getClaimsStats(patentId: string): Promise<{
    patentId: string;
    hasClaims: boolean;
    claimCount?: number;
    independentClaimCount?: number;
    totalCharacters?: number;
  }> {
    const { data } = await api.get(`/scoring-templates/claims/stats/${patentId}`);
    return data;
  },

  /**
   * Preview claims for a patent
   */
  async previewClaims(patentId: string): Promise<{
    patentId: string;
    claims: Array<{ number: number; text: string; isIndependent: boolean }>;
  }> {
    const { data } = await api.get(`/scoring-templates/claims/preview/${patentId}`);
    return data;
  },
};

export default api;
