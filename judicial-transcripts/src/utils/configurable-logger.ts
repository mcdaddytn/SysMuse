// src/utils/configurable-logger.ts
import * as winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import { LoggingConfig, LoggingProfile } from '../types/config.types';

// Default logging profiles
const DEFAULT_PROFILES: { [key: string]: LoggingProfile } = {
  Default: {
    appendTimestamp: false,
    timestampFormat: '',
    logLevel: 'info',
    enableWarningLog: true,
    logDirectory: 'logs'
  },
  AppendDatetime: {
    appendTimestamp: true,
    timestampFormat: 'YYYY-MM-DD-HHmmss',
    logLevel: 'info',
    enableWarningLog: true,
    logDirectory: 'logs'
  }
};

export class ConfigurableLogger {
  private static instance: winston.Logger | null = null;
  private static config: LoggingProfile | null = null;
  private static logDirectory: string = 'logs';

  /**
   * Initialize the logger with configuration
   */
  static initialize(config?: LoggingConfig): winston.Logger {
    // Resolve the effective configuration
    const effectiveConfig = this.resolveConfig(config);
    this.config = effectiveConfig;
    this.logDirectory = effectiveConfig.logDirectory || 'logs';

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), this.logDirectory);
    try {
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }
    } catch (error) {
      console.warn(`Could not create logs directory ${logsDir}, using console only`);
    }

    // Generate log filenames based on configuration
    const combinedLogFile = this.generateLogFilename('combined.log', effectiveConfig);
    const errorLogFile = this.generateLogFilename('error.log', effectiveConfig);
    const warningLogFile = this.generateLogFilename('warning.log', effectiveConfig);

    // Create Winston logger
    const logger = winston.createLogger({
      level: effectiveConfig.logLevel || 'info',
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        // Console transport
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp }) => {
              return `${timestamp} [${level}]: ${message}`;
            })
          )
        })
      ]
    });

    // Add file transports if directory exists
    if (fs.existsSync(logsDir)) {
      // Combined log (all levels)
      logger.add(new winston.transports.File({
        filename: path.join(logsDir, combinedLogFile),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} [${level}]: ${message}`;
          })
        )
      }));

      // Error log
      logger.add(new winston.transports.File({
        filename: path.join(logsDir, errorLogFile),
        level: 'error',
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.printf(({ level, message, timestamp, stack }) => {
            return `${timestamp} [${level}]: ${message}${stack ? '\n' + stack : ''}`;
          })
        )
      }));

      // Warning log (if enabled)
      if (effectiveConfig.enableWarningLog) {
        logger.add(new winston.transports.File({
          filename: path.join(logsDir, warningLogFile),
          level: 'warn',
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(({ level, message, timestamp }) => {
              return `${timestamp} [${level}]: ${message}`;
            })
          )
        }));
      }
    }

    this.instance = logger;
    return logger;
  }

  /**
   * Resolve the effective logging configuration
   */
  private static resolveConfig(config?: LoggingConfig): LoggingProfile {
    // Default to AppendDatetime profile if no config provided
    if (!config) {
      return DEFAULT_PROFILES.AppendDatetime;
    }

    // If a profile is specified, use it
    if (config.profile) {
      // Check custom profiles first
      if (config.profiles && config.profiles[config.profile]) {
        return config.profiles[config.profile];
      }
      // Check default profiles
      if (DEFAULT_PROFILES[config.profile]) {
        return DEFAULT_PROFILES[config.profile];
      }
      // Profile not found, fall back to default
      console.warn(`Logging profile '${config.profile}' not found, using AppendDatetime`);
      return DEFAULT_PROFILES.AppendDatetime;
    }

    // Use direct configuration if provided
    if (config.appendTimestamp !== undefined) {
      return {
        appendTimestamp: config.appendTimestamp,
        timestampFormat: config.timestampFormat || 'YYYY-MM-DD-HHmmss',
        logLevel: config.logLevel || 'info',
        enableWarningLog: config.enableWarningLog !== false,
        logDirectory: config.logDirectory || 'logs'
      };
    }

    // Default to AppendDatetime profile
    return DEFAULT_PROFILES.AppendDatetime;
  }

  /**
   * Generate log filename based on configuration
   */
  private static generateLogFilename(baseName: string, config: LoggingProfile): string {
    if (!config.appendTimestamp) {
      return baseName;
    }

    // Generate timestamp
    const now = new Date();
    let timestamp: string;

    if (config.timestampFormat === 'YYYY-MM-DD-HHmmss') {
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      timestamp = `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
    } else {
      // Simple fallback format
      timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    }

    // Split filename and extension
    const ext = path.extname(baseName);
    const name = path.basename(baseName, ext);

    return `${name}-${timestamp}${ext}`;
  }

  /**
   * Get the singleton logger instance
   */
  static getInstance(): winston.Logger {
    if (!this.instance) {
      this.instance = this.initialize();
    }
    return this.instance;
  }

  /**
   * Get current log files being used
   */
  static getLogFiles(): { combined: string; error: string; warning?: string } {
    if (!this.config) {
      this.initialize();
    }

    const result: { combined: string; error: string; warning?: string } = {
      combined: this.generateLogFilename('combined.log', this.config!),
      error: this.generateLogFilename('error.log', this.config!)
    };

    if (this.config!.enableWarningLog) {
      result.warning = this.generateLogFilename('warning.log', this.config!);
    }

    return result;
  }

  /**
   * Get full paths to log files
   */
  static getLogFilePaths(): { combined: string; error: string; warning?: string } {
    const files = this.getLogFiles();
    const logsDir = path.join(process.cwd(), this.logDirectory);
    
    const result: { combined: string; error: string; warning?: string } = {
      combined: path.join(logsDir, files.combined),
      error: path.join(logsDir, files.error)
    };

    if (files.warning) {
      result.warning = path.join(logsDir, files.warning);
    }

    return result;
  }
}

// Export a factory function for backward compatibility
export function createLogger(config?: LoggingConfig): winston.Logger {
  return ConfigurableLogger.initialize(config);
}

// Export default logger getter
export function getLogger(): winston.Logger {
  return ConfigurableLogger.getInstance();
}