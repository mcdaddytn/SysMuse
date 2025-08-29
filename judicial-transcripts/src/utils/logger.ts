// src/utils/logger.ts
import * as winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

const logger = winston.createLogger({
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
import * as fs from 'fs';
import * as path from 'path';

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

export default logger;
export { logger };

// Wrapper class for consistent logging interface
export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
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