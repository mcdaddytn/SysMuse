// src/services/settings.ts

import { api } from './api';
import type { Settings, MatterLookaheadMode, TimesheetMode } from 'src/types/models';

class SettingsService {
  private cachedSettings: Settings | null = null;

  async getSettings(): Promise<Settings> {
    if (this.cachedSettings) {
      return this.cachedSettings;
    }

    const response = await api.get('/settings');
    this.cachedSettings = response.data as Settings;
    return this.cachedSettings;
  }

  async getSetting(key: string): Promise<any> {
    const response = await api.get(`/settings/${key}`);
    return response.data.value;
  }

  async updateSetting(key: string, value: any, description?: string): Promise<void> {
    await api.put(`/settings/${key}`, { value, description });
    // Invalidate cache
    this.cachedSettings = null;
  }

  async getMatterLookaheadMode(): Promise<MatterLookaheadMode> {
    try {
      return await this.getSetting('matterLookaheadMode');
    } catch (error) {
      return 'INDIVIDUAL_STARTS_WITH'; // default
    }
  }

  async getTimesheetMode(): Promise<TimesheetMode> {
    try {
      return await this.getSetting('timesheetMode');
    } catch (error) {
      return 'WEEKLY'; // default
    }
  }

  async setMatterLookaheadMode(mode: MatterLookaheadMode): Promise<void> {
    await this.updateSetting('matterLookaheadMode', mode, 'Mode for matter search lookahead');
  }

  async setTimesheetMode(mode: TimesheetMode): Promise<void> {
    await this.updateSetting('timesheetMode', mode, 'Mode for timesheet display (Weekly/Daily/Both)');
  }

  // Clear cache - useful when settings are changed
  clearCache(): void {
    this.cachedSettings = null;
  }
}

export const settingsService = new SettingsService();