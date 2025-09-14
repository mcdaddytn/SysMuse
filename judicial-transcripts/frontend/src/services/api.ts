import axios, { AxiosInstance, AxiosResponse } from 'axios'

class ApiService {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: '/api',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    this.client.interceptors.request.use(
      config => {
        console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`)
        return config
      },
      error => {
        console.error('API Request Error:', error)
        return Promise.reject(error)
      }
    )

    this.client.interceptors.response.use(
      response => {
        console.log(`API Response: ${response.status} ${response.config.url}`)
        return response
      },
      error => {
        console.error('API Response Error:', error)
        if (error.response) {
          const message = error.response.data?.error || error.message
          return Promise.reject(new Error(message))
        }
        return Promise.reject(error)
      }
    )
  }

  async getTrials(): Promise<AxiosResponse> {
    return this.client.get('/trials')
  }

  async getTrial(id: number): Promise<AxiosResponse> {
    return this.client.get(`/trials/${id}`)
  }

  async getHierarchy(
    trialId: number,
    viewType: string = 'standard'
  ): Promise<AxiosResponse> {
    return this.client.get(`/hierarchy/views/${trialId}/${viewType}`)
  }

  async getSummary(
    trialId: number,
    nodeId: number,
    summaryType: string,
    options?: { offset?: number; limit?: number }
  ): Promise<AxiosResponse> {
    return this.client.get(`/hierarchy/summaries/${nodeId}`, {
      params: {
        type: summaryType,
        ...options
      }
    })
  }

  async getEvents(
    trialId: number,
    nodeId: number,
    eventType: string
  ): Promise<AxiosResponse> {
    return this.client.get(`/hierarchy/events/${nodeId}/${eventType}`)
  }

  async exportData(params: {
    trialId: number
    nodeId: number
    summaryType: string
    eventType: string
    format: string
  }): Promise<AxiosResponse> {
    return this.client.post('/export', params)
  }

  async exportNode(
    trialId: number,
    nodeId: number
  ): Promise<AxiosResponse> {
    return this.client.get(`/hierarchy/${trialId}/node/${nodeId}/export`)
  }

  async exportSummary(
    trialId: number,
    nodeId: number,
    summaryType: string
  ): Promise<AxiosResponse> {
    return this.client.get(`/hierarchy/${trialId}/node/${nodeId}/summary/export`, {
      params: { type: summaryType }
    })
  }

  async searchNodes(
    trialId: number,
    query: string
  ): Promise<AxiosResponse> {
    return this.client.get(`/hierarchy/${trialId}/search`, {
      params: { q: query }
    })
  }

  async getNodeFullText(
    trialId: number,
    nodeId: number
  ): Promise<AxiosResponse> {
    return this.client.get(`/trials/${trialId}/nodes/${nodeId}/fulltext`)
  }

  async getEventContext(
    trialId: number,
    eventId: number
  ): Promise<AxiosResponse> {
    return this.client.get(`/trials/${trialId}/events/${eventId}`)
  }

  async batchGenerateSummaries(
    trialId: number,
    nodeIds: number[],
    summaryType: string
  ): Promise<AxiosResponse> {
    return this.client.post(`/trials/${trialId}/summaries/batch`, {
      nodeIds,
      type: summaryType
    })
  }

  async getSummaryGenerationStatus(
    trialId: number,
    jobId: string
  ): Promise<AxiosResponse> {
    return this.client.get(`/trials/${trialId}/summaries/status/${jobId}`)
  }
}

export const api = new ApiService()