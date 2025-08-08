// FIRST FIX: src/utils/logger.ts - Fix Winston logging format
import winston from 'winston';

const logLevel = process.env.LOG_LEVEL || 'info';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...metadata }) => {
      // Fix: Use direct string concatenation instead of template literals with objects
      let msg = `${timestamp} [${level}]: ${message}`;
      // Only add metadata if it exists and is not just timestamp
      const cleanMetadata = { ...metadata };
      delete cleanMetadata.timestamp;
      if (Object.keys(cleanMetadata).length > 0) {
        msg += ` ${JSON.stringify(cleanMetadata)}`;
      }
      return msg;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...metadata }) => {
          // Clean format for console - no metadata serialization issues
          return `${timestamp} [${level}]: ${message}`;
        })
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

export default logger;

