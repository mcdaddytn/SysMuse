// src/utils/logger.ts
import * as winston from 'winston';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigurableLogger, createLogger } from './configurable-logger';
import { LoggingConfig } from '../types/config.types';

// Check if we have a logging config from environment or global config
let loggingConfig: LoggingConfig | undefined;

// Try to load config from environment variable
if (process.env.LOGGING_CONFIG) {
  try {
    loggingConfig = JSON.parse(process.env.LOGGING_CONFIG);
  } catch (e) {
    console.warn('Failed to parse LOGGING_CONFIG from environment');
  }
}

// Initialize logger with config if available, otherwise use defaults
let logger: winston.Logger;

if (loggingConfig) {
  logger = createLogger(loggingConfig);
} else {
  // Use legacy logger for backward compatibility
  const logLevel = process.env.LOG_LEVEL || 'info';

  logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss'
      }),
      winston.format.errors({ stack: true }),
      winston.format.simple()
    ),
    transports: [
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

  // Only add file logging if logs directory exists

  const logsDir = path.join(process.cwd(), 'logs');
  try {
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    // Add file transports only if directory creation succeeded
    logger.add(new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error' 
    }));
    
    logger.add(new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log') 
    }));
  } catch (error) {
    // If we can't create logs directory, just use console
    console.warn('Could not create logs directory, using console only');
  }
}

export default logger;
export { logger };

// Wrapper class for consistent logging interface
export class Logger {
  private context: string;
  static globalConfig: LoggingConfig | undefined;

  constructor(context: string) {
    this.context = context;
  }

  /**
   * Initialize logger with configuration
   * Call this at application startup with your config
   */
  static initialize(config: LoggingConfig): void {
    Logger.globalConfig = config;
    const newLogger = createLogger(config);
    
    // Replace all transports in the existing logger instance
    logger.clear();
    newLogger.transports.forEach(transport => {
      logger.add(transport);
    });
    
    // Update logger level
    logger.level = newLogger.level;
    logger.format = newLogger.format;
  }

  /**
   * Reinitialize the logger with new configuration
   */
  static reconfigure(config: LoggingConfig): void {
    Logger.initialize(config);
  }

  info(message: string): void {
    logger.info(`[${this.context}] ${message}`);
  }

  warn(message: string): void {
    logger.warn(`[${this.context}] ${message}`);
  }

  error(message: string, error?: any): void {
    if (error) {
      logger.error(`[${this.context}] ${message}: ${error}`);
    } else {
      logger.error(`[${this.context}] ${message}`);
    }
  }

  debug(message: string): void {
    logger.debug(`[${this.context}] ${message}`);
  }

  setLevel(level: string): void {
    logger.level = level;
  }
}

// Add setLevel function to the logger object for compatibility
(logger as any).setLevel = (level: string) => {
  logger.level = level;
};

// Export function to get current log file paths
export function getLogFilePaths(): { combined: string; error: string; warning?: string } | null {
  // Check if Logger has been initialized with a config
  if (Logger.globalConfig) {
    return ConfigurableLogger.getLogFilePaths();
  }
  // Return legacy paths
  const logsDir = path.join(process.cwd(), 'logs');
  return {
    combined: path.join(logsDir, 'combined.log'),
    error: path.join(logsDir, 'error.log')
  };
}