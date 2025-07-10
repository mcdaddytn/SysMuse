// src/services/auth.ts

import { api } from './api';
import type { AuthUser, LoginRequest, LoginResponse } from 'src/types/models';

class AuthService {
  private currentUser: AuthUser | null = null;

  async login(credentials: LoginRequest): Promise<AuthUser> {
    const response = await api.post<LoginResponse>('/auth/login', credentials);
    this.currentUser = response.data.user;
    return this.currentUser;
  }

  async logout(): Promise<void> {
    await api.post('/auth/logout');
    this.currentUser = null;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (this.currentUser) {
      return this.currentUser;
    }

    try {
      const response = await api.get<{ user: AuthUser }>('/auth/me');
      this.currentUser = response.data.user;
      return this.currentUser;
    } catch (error) {
      this.currentUser = null;
      return null;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    const user = await this.getCurrentUser();
    return user !== null;
  }

  clearUser(): void {
    this.currentUser = null;
  }

  get user(): AuthUser | null {
    return this.currentUser;
  }
}

export const authService = new AuthService();