// src/services/api.ts

import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = process.env.VUE_APP_API_URL || 'http://localhost:3000/api';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Log the API call
    console.log(`CLIENT API: ${config.method?.toUpperCase()} ${config.url} - Starting request`);
    return config;
  },
  (error) => {
    console.error('CLIENT API: Request error', error);
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    // Log successful response
    console.log(`CLIENT API: ${response.config.method?.toUpperCase()} ${response.config.url} - Request completed successfully (${response.status})`);
    return response;
  },
  (error) => {
    // Log error response
    if (error.response) {
      console.error(`CLIENT API: ${error.config?.method?.toUpperCase()} ${error.config?.url} - Request failed (${error.response.status})`, error.response.data);
    } else {
      console.error(`CLIENT API: ${error.config?.method?.toUpperCase()} ${error.config?.url} - Request failed`, error.message);
    }
    
    if (error.response?.status === 401) {
      // Handle unauthorized access
      // Redirect to login or refresh token
    }
    return Promise.reject(error);
  }
);

