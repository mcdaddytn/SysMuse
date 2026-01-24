import axios from 'axios';
import type { Patent, PaginatedResponse, PortfolioFilters, PaginationParams } from '@/types';

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
  }
};

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

// Scoring API
export const scoringApi = {
  async getV2Scores(weights?: { citation: number; years: number; competitor: number }) {
    const { data } = await api.get('/scores/v2', { params: weights });
    return data;
  },

  async getV3Scores() {
    const { data } = await api.get('/scores/v3');
    return data;
  },

  async getConsensusScores() {
    const { data } = await api.get('/scores/consensus');
    return data;
  },

  async updateWeights(weights: { citation: number; years: number; competitor: number }) {
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

export default api;
