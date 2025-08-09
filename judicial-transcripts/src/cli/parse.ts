// src/cli/parse.ts
// Updated CLI with proper Phase 2 integration

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptConfig } from '../types/config.types';
import { TranscriptParser } from '../parsers/TranscriptParser';
import { Phase2Processor } from '../parsers/Phase2Processor';
import { Phase3Processor } from '../parsers/Phase3Processor';
import logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

const program = new Command();

program
  .name('judicial-transcripts')
  .description('CLI for parsing and processing judicial transcripts')
  .version('1.0.0');

// Main parse command with "extract" alias for backward compatibility
const parseCommand = program
  .command('parse')
  .alias('extract')
  .description('Parse transcript files through various phases')
  .option('-c, --config <path>', 'Path to configuration JSON file', './config/default-config.json')
  .option('-d, --directory <path>', 'Directory containing transcript files')
  .option('-f, --format <format>', 'File format (pdf or txt)', 'txt')
  .option('--phase1', 'Run Phase 1 (raw parsing) only')
  .option('--phase2', 'Run Phase 2 (line groups) only')
  .option('--phase3', 'Run Phase 3 (section markers) only')
  .option('--all', 'Run all phases')
  .option('--verbose', 'Enable verbose logging')
  .action(async (options) => {
    try {
      // Set verbose logging if requested
      if (options.verbose) {
        process.env.LOG_LEVEL = 'debug';
      }
      
      // DEBUG: Log what we received
      console.log('=== CONFIG LOADING DEBUG ===');
      console.log('Attempting to load config from:', path.resolve(options.config));
      
      // Load configuration
      const config = loadConfig(options.config);
      console.log('Config file loaded successfully');
      console.log('============================');
      
      // Override with command line options
      if (options.directory) {
        config.transcriptPath = options.directory;
      }
      if (options.format) {
        config.format = options.format as 'pdf' | 'txt';
      }
      
      // Determine which phases to run
      let phasesToRun = {
        phase1: false,
        phase2: false,
        phase3: false
      };
      
      if (options.all) {
        phasesToRun = { phase1: true, phase2: true, phase3: true };
        logger.info('🎯 Running ALL phases');
      } else {
        // Check individual phase flags
        if (options.phase1) phasesToRun.phase1 = true;
        if (options.phase2) phasesToRun.phase2 = true;
        if (options.phase3) phasesToRun.phase3 = true;
        
        // If no phase specified, check config
        if (!options.phase1 && !options.phase2 && !options.phase3) {
          if (config.phases) {
            phasesToRun = { ...config.phases };
          } else {
            // Default to phase1 if nothing specified
            logger.warn('⚠️  No phases specified, defaulting to Phase 1');
            phasesToRun.phase1 = true;
          }
        }
      }
      
      // Update config with final phase decisions
      config.phases = phasesToRun;
      
      // Validate required configuration for Phase 1
      if (phasesToRun.phase1 && !config.transcriptPath) {
        logger.error('❌ Transcript path is required for Phase 1. Please specify with -d flag or in config file.');
        process.exit(1);
      }
      
      logger.info('📋 Configuration loaded successfully');
      
      // List phases to run
      const phasesArray = [];
      if (phasesToRun.phase1) phasesArray.push('Phase 1 (Raw Parsing)');
      if (phasesToRun.phase2) phasesArray.push('Phase 2 (Line Groups)');
      if (phasesToRun.phase3) phasesArray.push('Phase 3 (Section Markers)');
      
      if (phasesArray.length > 0) {
        logger.info(`🎯 Phases to run: ${phasesArray.join(', ')}`);
      } else {
        logger.warn('⚠️  No phases selected or enabled in config');
        return;
      }
      
      // Check database connection before starting
      await checkDatabaseConnection();
      
      // Run Phase 1
      if (phasesToRun.phase1) {
        logger.info('');
        logger.info('🚀 Starting Phase 1: Raw Parsing');
        logger.info('=' .repeat(50));
        
        const prisma = new PrismaClient();
        try {
          const parser = new TranscriptParser(config, prisma);
          await parser.parseDirectory(config.transcriptPath);
          logger.info('✅ Phase 1 completed successfully');
        } finally {
          await prisma.$disconnect();
        }
      }
      
      // Run Phase 2
      if (phasesToRun.phase2) {
        logger.info('');
        logger.info('🚀 Starting Phase 2: Line Groups');
        logger.info('=' .repeat(50));
        
        // Check if we have data from Phase 1
        const hasPhase1Data = await checkPhase1Data();
        if (!hasPhase1Data && !phasesToRun.phase1) {
          logger.error('❌ No Phase 1 data found. Please run Phase 1 first.');
          process.exit(1);
        }
        
        const processor = new Phase2Processor(config);
        await processor.process();
        
        logger.info('✅ Phase 2 completed successfully');
      }
      
      // Run Phase 3
      if (phasesToRun.phase3) {
        logger.info('');
        logger.info('🚀 Starting Phase 3: Section Markers');
        logger.info('=' .repeat(50));
        
        // Check if we have data from Phase 2
        const hasPhase2Data = await checkPhase2Data();
        if (!hasPhase2Data && !phasesToRun.phase2) {
          logger.error('❌ No Phase 2 data found. Please run Phase 2 first.');
          process.exit(1);
        }
        
        const processor = new Phase3Processor(config);
        await processor.process();
        
        logger.info('✅ Phase 3 completed successfully');
      }
      
      logger.info('');
      logger.info('🎉 Transcript processing completed successfully');
      
      // Print summary statistics
      await printProcessingSummary();
      
    } catch (error) {
      logger.error('❌ Error during transcript processing:', error);
      if (error instanceof Error) {
        logger.error('Stack trace:', error.stack);
      }
      process.exit(1);
    }
  });

// Reset command
program
  .command('reset')
  .description('Reset database (delete all data)')
  .option('--confirm', 'Confirm database reset')
  .option('--force', 'Force reset without confirmation prompt')
  .action(async (options) => {
    if (!options.confirm && !options.force) {
      console.log('⚠️  This will delete ALL data in the database!');
      console.log('Please add --confirm flag to proceed with database reset');
      return;
    }
    
    try {
      logger.warn('🗑️  Resetting database...');
      const { execSync } = require('child_process');
      
      // Use Prisma to reset the database
      execSync('npx prisma db push --force-reset', { stdio: 'inherit' });
      
      logger.info('✅ Database reset completed');
    } catch (error) {
      logger.error('❌ Error resetting database:', error);
      process.exit(1);
    }
  });

// Seed command
program
  .command('seed')
  .description('Seed database with initial data')
  .option('--clear', 'Clear existing seed data first')
  .action(async (options) => {
    try {
      if (options.clear) {
        logger.info('🧹 Clearing existing seed data...');
        process.env.CLEAR_BEFORE_SEED = 'true';
      }
      
      logger.info('🌱 Seeding database...');
      const { execSync } = require('child_process');
      execSync('npm run seed', { stdio: 'inherit' });
      logger.info('✅ Database seeding completed');
    } catch (error) {
      logger.error('❌ Error seeding database:', error);
      process.exit(1);
    }
  });

// Stats command
program
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    try {
      await printProcessingSummary();
    } catch (error) {
      logger.error('❌ Error getting statistics:', error);
      process.exit(1);
    }
  });

// Helper function to load configuration
function loadConfig(configPath: string): TranscriptConfig {
  const fullPath = path.resolve(configPath);
  
  console.log('File exists:', fs.existsSync(fullPath));
  
  if (!fs.existsSync(fullPath)) {
    console.log('❌ Configuration file not found:', fullPath);
    console.log('');
    console.log('Available files in config directory:');
    const configDir = path.dirname(fullPath);
    if (fs.existsSync(configDir)) {
      fs.readdirSync(configDir).forEach(file => {
        console.log('  -', file);
      });
    }
    throw new Error(`Configuration file not found: ${fullPath}`);
  }
  
  try {
    const configData = fs.readFileSync(fullPath, 'utf-8');
    const config = JSON.parse(configData);
    
    // Set defaults if not present
    if (!config.phases) {
      config.phases = {
        phase1: false,
        phase2: false,
        phase3: false
      };
    }
    
    return config;
  } catch (error) {
    throw new Error(`Failed to parse configuration file: ${error}`);
  }
}

// Check database connection
async function checkDatabaseConnection(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    logger.info('✅ Database connection established');
  } catch (error) {
    logger.error('❌ Failed to connect to database:', error);
    logger.error('Make sure PostgreSQL is running (docker-compose up -d)');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Check if Phase 1 data exists
async function checkPhase1Data(): Promise<boolean> {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.line.count();
    return count > 0;
  } catch (error) {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Check if Phase 2 data exists
async function checkPhase2Data(): Promise<boolean> {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.trialEvent.count();
    return count > 0;
  } catch (error) {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Print processing summary
async function printProcessingSummary(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const stats = {
      trials: await prisma.trial.count(),
      sessions: await prisma.session.count(),
      pages: await prisma.page.count(),
      lines: await prisma.line.count(),
      trialEvents: await prisma.trialEvent.count(),
      courtDirectives: await prisma.courtDirectiveEvent.count(),
      statements: await prisma.statementEvent.count(),
      witnesses: await prisma.witness.count(),
      attorneys: await prisma.attorney.count(),
      markers: await prisma.marker.count()
    };
    
    console.log('');
    console.log('📊 Database Statistics:');
    console.log('=' .repeat(40));
    console.log(`  Trials:           ${stats.trials}`);
    console.log(`  Sessions:         ${stats.sessions}`);
    console.log(`  Pages:            ${stats.pages}`);
    console.log(`  Lines:            ${stats.lines}`);
    console.log('');
    console.log('📋 Phase 2 Results:');
    console.log(`  Trial Events:     ${stats.trialEvents}`);
    console.log(`  Court Directives: ${stats.courtDirectives}`);
    console.log(`  Statements:       ${stats.statements}`);
    console.log('');
    console.log('👥 Participants:');
    console.log(`  Attorneys:        ${stats.attorneys}`);
    console.log(`  Witnesses:        ${stats.witnesses}`);
    console.log('');
    console.log('🔖 Phase 3 Results:');
    console.log(`  Markers:          ${stats.markers}`);
    console.log('=' .repeat(40));
    
  } catch (error) {
    logger.warn('Could not retrieve statistics');
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
program.parse(process.argv);

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}