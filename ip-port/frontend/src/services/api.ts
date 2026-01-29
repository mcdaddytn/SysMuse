import axios from 'axios';
import type { Patent, PaginatedResponse, PortfolioFilters, PaginationParams, ScoringProfile, V3ScoredPatent, SectorRanking, LlmCoverage, SectorDetail, SuperSectorDetail, SectorRule, SectorRuleType, RulePreviewResult, SeedSummary } from '@/types';

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

  async addPatentsToFocusArea(id: string, patentIds: string[], membershipType = 'MANUAL'): Promise<{ added: number; total: number }> {
    const { data } = await api.post(`/focus-areas/${id}/patents`, { patentIds, membershipType });
    return data;
  },

  async removePatentsFromFocusArea(id: string, patentIds: string[]): Promise<{ removed: number; total: number }> {
    const { data } = await api.delete(`/focus-areas/${id}/patents`, { data: { patentIds } });
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
};

export default api;
