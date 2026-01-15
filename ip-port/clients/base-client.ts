/**
 * Base HTTP Client for USPTO APIs
 * 
 * Provides common functionality:
 * - Rate limiting
 * - Error handling
 * - Retry logic
 * - Request/response logging
 */

export interface APIConfig {
  baseUrl: string;
  apiKey: string;
  rateLimit?: {
    requestsPerMinute: number;
    requestsPerHour?: number;
  };
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export interface APIError extends Error {
  statusCode?: number;
  response?: any;
  endpoint?: string;
}

export class RateLimiter {
  private requestTimestamps: number[] = [];
  private requestsPerMinute: number;
  private requestsPerHour: number;

  constructor(requestsPerMinute: number, requestsPerHour?: number) {
    this.requestsPerMinute = requestsPerMinute;
    this.requestsPerHour = requestsPerHour || requestsPerMinute * 60;
  }

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;

    // Clean up old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => timestamp > oneHourAgo
    );

    // Check minute limit
    const recentMinute = this.requestTimestamps.filter(
      timestamp => timestamp > oneMinuteAgo
    );

    if (recentMinute.length >= this.requestsPerMinute) {
      const oldestInMinute = Math.min(...recentMinute);
      const waitTime = oldestInMinute + 60 * 1000 - now + 100; // Add 100ms buffer
      
      if (waitTime > 0) {
        console.log(`Rate limit: waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    // Check hour limit if specified
    if (this.requestsPerHour && this.requestTimestamps.length >= this.requestsPerHour) {
      const oldestInHour = Math.min(...this.requestTimestamps);
      const waitTime = oldestInHour + 60 * 60 * 1000 - now + 100;
      
      if (waitTime > 0) {
        console.log(`Hourly rate limit: waiting ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    this.requestTimestamps.push(now);
  }
}

export class BaseAPIClient {
  protected config: APIConfig;
  protected rateLimiter?: RateLimiter;

  constructor(config: APIConfig) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      ...config,
    };

    if (config.rateLimit) {
      this.rateLimiter = new RateLimiter(
        config.rateLimit.requestsPerMinute,
        config.rateLimit.requestsPerHour
      );
    }
  }

  protected async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    // Wait for rate limiter
    if (this.rateLimiter) {
      await this.rateLimiter.waitIfNeeded();
    }

    const url = `${this.config.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      console.log(`[API Request] ${options.method || 'GET'} ${url}`);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeout);

      // Check for rate limit headers and log them
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      const rateLimitReset = response.headers.get('X-RateLimit-Reset');
      
      if (rateLimitRemaining) {
        console.log(`[Rate Limit] Remaining: ${rateLimitRemaining}, Reset: ${rateLimitReset}`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        const error: APIError = new Error(
          `API Error: ${response.status} ${response.statusText}`
        );
        error.statusCode = response.status;
        error.endpoint = endpoint;
        
        try {
          error.response = JSON.parse(errorText);
        } catch {
          error.response = errorText;
        }

        console.error(`[API Error] ${response.status} ${endpoint}`, error.response);
        throw error;
      }

      const data = await response.json();
      console.log(`[API Success] ${endpoint}`);
      
      return data as T;

    } catch (error) {
      clearTimeout(timeout);

      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms: ${endpoint}`);
      }

      throw error;
    }
  }

  protected async get<T>(endpoint: string, headers: Record<string, string> = {}): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'GET',
      headers,
    });
  }

  protected async post<T>(
    endpoint: string,
    body: any,
    headers: Record<string, string> = {}
  ): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  /**
   * Retry a request with exponential backoff
   */
  protected async retryRequest<T>(
    requestFn: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await requestFn();
    } catch (error) {
      if (attempt >= this.config.retryAttempts!) {
        throw error;
      }

      const apiError = error as APIError;
      
      // Don't retry 4xx errors (client errors) - only retry 5xx (server errors) or network errors
      if (apiError.statusCode && apiError.statusCode >= 400 && apiError.statusCode < 500) {
        throw error;
      }

      const delay = this.config.retryDelay! * Math.pow(2, attempt - 1);
      console.log(`[Retry] Attempt ${attempt}/${this.config.retryAttempts} after ${delay}ms`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return this.retryRequest(requestFn, attempt + 1);
    }
  }
}

/**
 * Helper function to build query parameters
 */
export function buildQueryString(params: Record<string, any>): string {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      if (typeof value === 'object') {
        searchParams.append(key, JSON.stringify(value));
      } else {
        searchParams.append(key, String(value));
      }
    }
  });

  return searchParams.toString();
}

/**
 * Helper to paginate through API results
 */
export async function* paginateResults<T>(
  fetchPage: (offset: number, size: number) => Promise<{ results: T[]; total: number }>,
  pageSize: number = 100
): AsyncGenerator<T[], void, unknown> {
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const response = await fetchPage(offset, pageSize);
    total = response.total;
    
    if (response.results.length === 0) {
      break;
    }

    yield response.results;
    offset += response.results.length;
  }
}
