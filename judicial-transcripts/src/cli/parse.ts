// Fix 1: src/cli/parse.ts - Updated CLI structure

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptConfig } from '../types/config.types';
import { TranscriptParser } from '../parsers/TranscriptParser';
import { Phase2Processor } from '../parsers/Phase2Processor';
import { Phase3Processor } from '../parsers/Phase3Processor';
import logger from '../utils/logger';

const program = new Command();

program
  .name('judicial-transcripts')
  .description('CLI for parsing and processing judicial transcripts')
  .version('1.0.0');

program
  .command('parse')
  .description('Parse transcript files')
  .option('-c, --config <path>', 'Path to configuration JSON file', './config/default-config.json')
  //.option('-c, --config <path>', 'Path to configuration JSON file', './config/example-trial-config.json')
  .option('-d, --directory <path>', 'Directory containing transcript files')
  .option('-f, --format <format>', 'File format (pdf or txt)', 'txt')
  .option('--phase1', 'Run Phase 1 (raw parsing) only')
  .option('--phase2', 'Run Phase 2 (line groups) only')
  .option('--phase3', 'Run Phase 3 (section groups) only')
  .option('--all', 'Run all phases')
  .action(async (options) => {
    try {
      // DEBUG: Log what we received
      console.log('=== CLI DEBUG ===');
      console.log('Received options:', JSON.stringify(options, null, 2));
      console.log('Config path from options:', options.config);
      console.log('================');
      
      // Load configuration
      const config = loadConfig(options.config);
      
      // Override with command line options
      if (options.directory) {
        config.transcriptPath = options.directory;
      }
      if (options.format) {
        config.format = options.format as 'pdf' | 'txt';
      }
      
      // Determine which phases to run
      if (options.all) {
        config.phases = { phase1: true, phase2: true, phase3: true };
      } else {
        // Fix: Reset phases first, then set requested ones
        config.phases = { phase1: false, phase2: false, phase3: false };
        if (options.phase1) config.phases.phase1 = true;
        if (options.phase2) config.phases.phase2 = true;
        if (options.phase3) config.phases.phase3 = true;
        
        // If no phase specified, default to phase1
        if (!options.phase1 && !options.phase2 && !options.phase3 && !options.all) {
          config.phases.phase1 = true;
        }
      }
      
      logger.info('Starting transcript processing with config:', config);
      
      // Run Phase 1
      if (config.phases.phase1) {
        logger.info('Running Phase 1: Raw Parsing');
        const parser = new TranscriptParser(config);
        await parser.parseDirectory();
      }
      
      // Run Phase 2
      if (config.phases.phase2) {
        logger.info('Running Phase 2: Line Groups');
        const processor = new Phase2Processor(config);
        await processor.process();
      }
      
      // Run Phase 3
      if (config.phases.phase3) {
        logger.info('Running Phase 3: Section Groups');
        const processor = new Phase3Processor(config);
        await processor.process();
      }
      
      logger.info('Transcript processing completed successfully');
    } catch (error) {
      logger.error('Error during transcript processing:', error);
      process.exit(1);
    }
  });

program
  .command('reset')
  .description('Reset database (delete all data)')
  .option('--confirm', 'Confirm database reset')
  .action(async (options) => {
    if (!options.confirm) {
      console.log('Please add --confirm flag to reset database');
      return;
    }
    
    try {
      logger.warn('Resetting database...');
      const { execSync } = require('child_process');
      execSync('npm run prisma:reset', { stdio: 'inherit' });
      logger.info('Database reset completed');
    } catch (error) {
      logger.error('Error resetting database:', error);
      process.exit(1);
    }
  });

program
  .command('seed')
  .description('Seed database with initial data')
  .option('--clear', 'Clear existing seed data first')
  .action(async (options) => {
    try {
      if (options.clear) {
        process.env.CLEAR_BEFORE_SEED = 'true';
      }
      
      logger.info('Seeding database...');
      const { execSync } = require('child_process');
      execSync('npm run seed', { stdio: 'inherit' });
      logger.info('Database seeding completed');
    } catch (error) {
      logger.error('Error seeding database:', error);
      process.exit(1);
    }
  });

function loadConfig(configPath: string): TranscriptConfig {
  const fullPath = path.resolve(configPath);
  
  console.log('=== CONFIG LOADING DEBUG ===');
  console.log('Attempting to load config from:', fullPath);
  console.log('File exists:', fs.existsSync(fullPath));
  
  if (!fs.existsSync(fullPath)) {
    console.log('Available files in config directory:');
    const configDir = path.dirname(fullPath);
    if (fs.existsSync(configDir)) {
      fs.readdirSync(configDir).forEach(file => {
        console.log(' -', file);
      });
    }
    throw new Error(`Configuration file not found: ${fullPath}`);
  }
  
  const configData = fs.readFileSync(fullPath, 'utf-8');
  console.log('Config file loaded successfully');
  console.log('============================');
  
  return JSON.parse(configData);
}

// Parse command line arguments
program.parse(process.argv);

