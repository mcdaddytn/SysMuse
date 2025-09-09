// src/utils/log-config-loader.ts
import * as fs from 'fs';
import * as path from 'path';
import { LoggingConfig } from '../types/config.types';
import { Logger } from './logger';

/**
 * Load logging configuration from centralized log-config.json
 * Falls back to configuration passed or defaults if file not found
 */
export function loadLoggingConfig(fallbackConfig?: LoggingConfig): LoggingConfig | undefined {
  const logConfigPath = path.join(process.cwd(), 'config', 'log-config.json');
  
  try {
    if (fs.existsSync(logConfigPath)) {
      const configContent = fs.readFileSync(logConfigPath, 'utf-8');
      const logConfig = JSON.parse(configContent) as LoggingConfig;
      return logConfig;
    }
  } catch (error) {
    console.warn(`Failed to load log-config.json: ${error}`);
  }
  
  // Return fallback config if provided
  return fallbackConfig;
}

/**
 * Initialize logger with centralized config or fallback
 * This should be called at the start of any CLI command
 */
export function initializeLogger(fallbackConfig?: LoggingConfig): void {
  const loggingConfig = loadLoggingConfig(fallbackConfig);
  
  if (loggingConfig) {
    Logger.initialize(loggingConfig);
    
    // Log initialization details only at debug level
    const logger = new Logger('LogConfigLoader');
    logger.debug(`Initialized logger with profile: ${loggingConfig.profile || 'default'}`);
  }
}

/**
 * Get the active logging configuration
 * Useful for displaying current settings
 */
export function getActiveLoggingConfig(): LoggingConfig | undefined {
  return loadLoggingConfig();
}