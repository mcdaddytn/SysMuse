// src/index.ts - Main entry point
import dotenv from 'dotenv';
import path from 'path';
import logger from './utils/logger';

// Load environment variables
dotenv.config();

// Import the API server
import './api/server';

// Log startup
logger.info('Judicial Transcripts System Started');
logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
logger.info(`Database: ${process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'not configured'}`);
logger.info(`ElasticSearch: ${process.env.ELASTICSEARCH_URL || 'not configured'}`);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

