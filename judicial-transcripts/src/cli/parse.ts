// src/cli/parse.ts
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptParser } from '../parsers/TranscriptParser';
import { Phase2Processor } from '../parsers/Phase2Processor';
import { TranscriptConfig } from '../types/config.types';
import logger from '../utils/logger';

const program = new Command();

// Default configuration
const defaultConfig: TranscriptConfig = {
  inputDir: './transcripts',
  outputDir: './output',
  logLevel: 'info',
  batchSize: 100,
  enableElasticSearch: false
};

program
  .name('transcript-parser')
  .description('CLI for parsing judicial transcripts')
  .version('2.0.0');

program
  .command('parse')
  .description('Parse transcript files')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-d, --directory <path>', 'Directory containing transcript files')
  .option('-o, --output <path>', 'Output directory for parsed data')
  .option('--phase1', 'Run only Phase 1 (line parsing)')
  .option('--phase2', 'Run only Phase 2 (event processing)')
  .option('--trial-id <id>', 'Trial ID for Phase 2 processing', parseInt)
  .option('--log-level <level>', 'Log level (debug, info, warn, error)', 'info')
  .action(async (options) => {
    try {
      // Load configuration
      let config: TranscriptConfig = { ...defaultConfig };
      
      if (options.config) {
        const configPath = path.resolve(options.config);
        if (fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          config = { ...config, ...fileConfig };
          logger.info(`Loaded configuration from ${configPath}`);
        } else {
          logger.error(`Configuration file not found: ${configPath}`);
          process.exit(1);
        }
      }
      
      // Override with command line options
      if (options.directory) {
        config.inputDir = path.resolve(options.directory);
      }
      if (options.output) {
        config.outputDir = path.resolve(options.output);
      }
      if (options.logLevel) {
        config.logLevel = options.logLevel as 'debug' | 'info' | 'warn' | 'error';
      }
      
      // Validate input directory
      if (!fs.existsSync(config.inputDir)) {
        logger.error(`Input directory not found: ${config.inputDir}`);
        process.exit(1);
      }
      
      // Create output directory if needed
      if (!fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir, { recursive: true });
        logger.info(`Created output directory: ${config.outputDir}`);
      }
      
      // Determine which phases to run
      const runPhase1 = !options.phase2 || options.phase1;
      const runPhase2 = !options.phase1 || options.phase2;
      
      logger.info('='.repeat(60));
      logger.info('JUDICIAL TRANSCRIPT PARSER');
      logger.info('='.repeat(60));
      logger.info(`Input Directory: ${config.inputDir}`);
      logger.info(`Output Directory: ${config.outputDir}`);
      logger.info(`Log Level: ${config.logLevel}`);
      logger.info(`Phases to run: ${runPhase1 ? 'Phase 1' : ''}${runPhase1 && runPhase2 ? ' + ' : ''}${runPhase2 ? 'Phase 2' : ''}`);
      logger.info('='.repeat(60));
      
      const prisma = new PrismaClient();
      
      try {
        if (runPhase1) {
          logger.info('\n📚 Starting Phase 1: Line Parsing');
          logger.info('-'.repeat(40));
          
          const parser = new TranscriptParser(config);
          await parser.parseDirectory();
          
          logger.info('✅ Phase 1 completed successfully');
        }
        
        if (runPhase2) {
          logger.info('\n🔄 Starting Phase 2: Event Processing');
          logger.info('-'.repeat(40));
          
          let trialId = options.trialId;
          
          // If no trial ID provided, try to find the most recent trial
          if (!trialId) {
            const latestTrial = await prisma.trial.findFirst({
              orderBy: { createdAt: 'desc' }
            });
            
            if (latestTrial) {
              trialId = latestTrial.id;
              logger.info(`Using latest trial: ${latestTrial.caseNumber} (ID: ${trialId})`);
            } else {
              logger.error('No trial found in database. Please run Phase 1 first.');
              process.exit(1);
            }
          }
          
          const processor = new Phase2Processor(config);
          await processor.processTrial(trialId);
          
          logger.info('✅ Phase 2 completed successfully');
        }
        
        logger.info('\n' + '='.repeat(60));
        logger.info('✨ PROCESSING COMPLETED SUCCESSFULLY');
        logger.info('='.repeat(60));
        
      } finally {
        await prisma.$disconnect();
      }
      
    } catch (error) {
      logger.error(`Processing failed: ${error}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Display database statistics')
  .action(async () => {
    const prisma = new PrismaClient();
    
    try {
      const stats = await getDbStats(prisma);
      
      console.log('\n' + '='.repeat(60));
      console.log('📊 DATABASE STATISTICS');
      console.log('='.repeat(60));
      console.log(`Trials:          ${stats.trials.toLocaleString()}`);
      console.log(`Sessions:        ${stats.sessions.toLocaleString()}`);
      console.log(`Pages:           ${stats.pages.toLocaleString()}`);
      console.log(`Lines:           ${stats.lines.toLocaleString()}`);
      console.log(`Events:          ${stats.events.toLocaleString()}`);
      console.log(`Speakers:        ${stats.speakers.toLocaleString()}`);
      console.log(`  - Attorneys:   ${stats.attorneys.toLocaleString()}`);
      console.log(`  - Witnesses:   ${stats.witnesses.toLocaleString()}`);
      console.log(`  - Jurors:      ${stats.jurors.toLocaleString()}`);
      console.log(`  - Anonymous:   ${stats.anonymous.toLocaleString()}`);
      console.log(`Statements:      ${stats.statements.toLocaleString()}`);
      console.log(`Witness Events:  ${stats.witnessEvents.toLocaleString()}`);
      console.log(`Directives:      ${stats.directives.toLocaleString()}`);
      console.log('='.repeat(60));
      
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('search')
  .description('Search transcripts with SQL and Elasticsearch')
  .option('-f, --file <path>', 'Path to JSON query file')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .action(async (options) => {
    const { execSync } = require('child_process');
    const searchCmd = `ts-node src/cli/search.ts query -f ${options.file || './config/queries/query.json'} -o ${options.output}`;
    execSync(searchCmd, { stdio: 'inherit' });
  });

program
  .command('search-batch')
  .description('Execute multiple search queries')
  .option('-d, --directory <path>', 'Directory containing query files', './config/queries')
  .option('-o, --output <path>', 'Output directory for results', './output')
  .action(async (options) => {
    const { execSync } = require('child_process');
    const searchCmd = `ts-node src/cli/search.ts batch -d ${options.directory} -o ${options.output}`;
    execSync(searchCmd, { stdio: 'inherit' });
  });

program
  .command('sync-elasticsearch')
  .description('Sync all statement events to Elasticsearch')
  .action(async () => {
    const { execSync } = require('child_process');
    execSync('ts-node src/cli/search.ts sync', { stdio: 'inherit' });
  });

program
  .command('reset')
  .description('Reset the database')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (options) => {
    if (!options.confirm) {
      console.log('⚠️  WARNING: This will delete all data in the database!');
      console.log('Use --confirm flag to proceed without prompt.');
      process.exit(0);
    }
    
    const prisma = new PrismaClient();
    
    try {
      logger.info('Resetting database...');
      
      // Delete all data in reverse order of dependencies
      await prisma.searchIndex.deleteMany();
      await prisma.marker.deleteMany();
      await prisma.witnessCalledEvent.deleteMany();
      await prisma.statementEvent.deleteMany();
      await prisma.courtDirectiveEvent.deleteMany();
      await prisma.trialEvent.deleteMany();
      await prisma.line.deleteMany();
      await prisma.page.deleteMany();
      await prisma.session.deleteMany();
      await prisma.anonymousSpeaker.deleteMany();
      await prisma.juror.deleteMany();
      await prisma.witness.deleteMany();
      await prisma.judge.deleteMany();
      await prisma.trialAttorney.deleteMany();
      await prisma.attorney.deleteMany();
      await prisma.speaker.deleteMany();
      await prisma.lawFirmOffice.deleteMany();
      await prisma.lawFirm.deleteMany();
      await prisma.courtReporter.deleteMany();
      await prisma.address.deleteMany();
      await prisma.courtDirectiveType.deleteMany();
      await prisma.trial.deleteMany();
      
      logger.info('✅ Database reset successfully');
      
    } finally {
      await prisma.$disconnect();
    }
  });

async function getDbStats(prisma: PrismaClient) {
  const [
    trials,
    sessions,
    pages,
    lines,
    events,
    speakers,
    attorneys,
    witnesses,
    jurors,
    anonymous,
    statements,
    witnessEvents,
    directives
  ] = await Promise.all([
    prisma.trial.count(),
    prisma.session.count(),
    prisma.page.count(),
    prisma.line.count(),
    prisma.trialEvent.count(),
    prisma.speaker.count(),
    prisma.attorney.count(),
    prisma.witness.count(),
    prisma.juror.count(),
    prisma.anonymousSpeaker.count(),
    prisma.statementEvent.count(),
    prisma.witnessCalledEvent.count(),
    prisma.courtDirectiveEvent.count()
  ]);
  
  return {
    trials,
    sessions,
    pages,
    lines,
    events,
    speakers,
    attorneys,
    witnesses,
    jurors,
    anonymous,
    statements,
    witnessEvents,
    directives
  };
}

// Parse command line arguments
program.parse(process.argv);