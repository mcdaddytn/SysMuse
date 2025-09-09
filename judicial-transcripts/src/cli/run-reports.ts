#!/usr/bin/env node
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { initializeLogger } from '../utils/log-config-loader';
import { Phase1ReportGenerator } from '../services/Phase1ReportGenerator';
import { HierarchyViewService } from '../services/HierarchyViewService';
import { TranscriptConfig } from '../types/config.types';
import { TrialResolver } from '../utils/trialResolver';

const program = new Command();
const prisma = new PrismaClient();

// Default configuration
const defaultConfig: TranscriptConfig = {
  inputDir: './transcripts',
  outputDir: './output',
  logLevel: 'info',
  batchSize: 100,
  enableElasticSearch: false
};

async function loadConfig(configPath: string): Promise<TranscriptConfig> {
  // Initialize logger with centralized config first
  initializeLogger();
  
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }
  
  const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const config = { ...defaultConfig, ...fileConfig };
  
  return config;
}

async function getIncludedTrials(config: any): Promise<number[]> {
  const resolver = new TrialResolver(prisma);
  return resolver.getTrialIds(config);
}

program
  .name('run-reports')
  .description('Run reports for all phases with unified configuration')
  .version('1.0.0');

// Helper to find default config
function findDefaultConfig(): string | null {
  const possibleConfigs = [
    'config/multi-trial-config-mac.json',
    'config/multi-trial-config-win.json',
    'config/multi-trial-config.json',
    'config/config.json'
  ];
  
  for (const configPath of possibleConfigs) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

// Phase 1 Reports
program
  .command('phase1')
  .description('Run Phase 1 reports for trials in config')
  .option('-c, --config <path>', 'Path to configuration file')
  .option('-o, --output <dir>', 'Output directory override')
  .action(async (options) => {
    const logger = new Logger('Phase1Reports');
    
    try {
      // Use provided config or find default
      let configPath = options.config;
      if (!configPath) {
        configPath = findDefaultConfig();
        if (!configPath) {
          logger.error('No configuration file provided and no default config found');
          logger.error('Please specify a config file with --config or create config/multi-trial-config-mac.json');
          process.exit(1);
        }
        logger.info(`Using default config: ${configPath}`);
      }
      
      const config = await loadConfig(configPath);
      const outputDir = options.output || path.join(config.outputDir, 'phase1-reports');
      const trialIds = await getIncludedTrials(config);
      
      logger.info(`Running Phase 1 reports for ${trialIds.length} trials`);
      logger.info(`Output directory: ${outputDir}`);
      
      const generator = new Phase1ReportGenerator(prisma, outputDir);
      
      const resolver = new TrialResolver(prisma);
      
      for (const trialId of trialIds) {
        const trial = await resolver.getTrialDetails(trialId);
        
        if (trial) {
          const trialIdentifier = trial.shortName || trial.name || trial.caseNumber;
          logger.info(`Generating Phase 1 reports for trial ${trialId}: ${trialIdentifier}`);
          await generator.generateAllReports(trialId);
        }
      }
      
      logger.info('Phase 1 reports completed successfully');
    } catch (error) {
      logger.error('Failed to generate Phase 1 reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Phase 2 Reports
program
  .command('phase2')
  .description('Run Phase 2 reports for trials in config')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .option('-o, --output <dir>', 'Output directory override')
  .action(async (options) => {
    const logger = new Logger('Phase2Reports');
    
    try {
      // Use provided config or find default
      let configPath = options.config;
      if (!configPath) {
        configPath = findDefaultConfig();
        if (!configPath) {
          logger.error('No configuration file provided and no default config found');
          logger.error('Please specify a config file with --config or create config/multi-trial-config-mac.json');
          process.exit(1);
        }
        logger.info(`Using default config: ${configPath}`);
      }
      
      const config = await loadConfig(configPath);
      const outputDir = options.output || path.join(config.outputDir, 'phase2-reports');
      const trialIds = await getIncludedTrials(config);
      
      logger.info(`Running Phase 2 reports for ${trialIds.length} trials`);
      logger.info(`Output directory: ${outputDir}`);
      
      // Create output directory if needed
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const resolver = new TrialResolver(prisma);
      
      for (const trialId of trialIds) {
        const trial = await resolver.getTrialDetails(trialId);
        
        if (trial) {
          const trialIdentifier = trial.shortName || trial.name || trial.caseNumber;
          logger.info(`Generating Phase 2 report for trial ${trialId}: ${trialIdentifier}`);
          
          // Get session and event counts
          const sessions = await prisma.session.count({
            where: { trialId }
          });
          
          const events = await prisma.trialEvent.count({
            where: { trialId }
          });
          
          const speakers = await prisma.speaker.count({
            where: { trialId }
          });
          
          const report = {
            trialId,
            shortName: trial.shortName,
            trialName: trial.name || trial.caseNumber,
            caseNumber: trial.caseNumber,
            statistics: {
              sessions,
              events,
              speakers
            },
            generatedAt: new Date().toISOString()
          };
          
          // Save report
          const reportPath = path.join(outputDir, `trial-${trialId}-phase2.json`);
          fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
          logger.info(`Saved report to ${reportPath}`);
        }
      }
      
      logger.info('Phase 2 reports completed successfully');
    } catch (error) {
      logger.error('Failed to generate Phase 2 reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Phase 3 Reports
program
  .command('phase3')
  .description('Run Phase 3 reports and hierarchy views for trials in config')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .option('-o, --output <dir>', 'Output directory override')
  .option('--views <views>', 'Comma-separated list of views (standard,session,objections,interactions)', 'standard,session,objections,interactions')
  .action(async (options) => {
    const logger = new Logger('Phase3Reports');
    
    try {
      // Use provided config or find default
      let configPath = options.config;
      if (!configPath) {
        configPath = findDefaultConfig();
        if (!configPath) {
          logger.error('No configuration file provided and no default config found');
          logger.error('Please specify a config file with --config or create config/multi-trial-config-mac.json');
          process.exit(1);
        }
        logger.info(`Using default config: ${configPath}`);
      }
      
      const config = await loadConfig(configPath);
      const outputDir = options.output || path.join(config.outputDir, 'phase3-reports');
      const trialIds = await getIncludedTrials(config);
      const views = options.views.split(',').map((v: string) => v.trim());
      
      logger.info(`Running Phase 3 reports for ${trialIds.length} trials`);
      logger.info(`Output directory: ${outputDir}`);
      logger.info(`Generating views: ${views.join(', ')}`);
      
      // Create output directory if needed
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const hierarchyService = new HierarchyViewService(prisma);
      
      const resolver = new TrialResolver(prisma);
      
      for (const trialId of trialIds) {
        const trial = await resolver.getTrialDetails(trialId);
        
        if (trial) {
          const trialIdentifier = trial.shortName || trial.name || trial.caseNumber;
          logger.info(`Generating Phase 3 reports for trial ${trialId}: ${trialIdentifier}`);
          
          // Generate Phase 3 statistics
          const markers = await prisma.marker.count({
            where: { trialId }
          });
          
          const markerSections = await prisma.markerSection.count({
            where: { trialId }
          });
          
          const accumulatorResults = await prisma.accumulatorResult.count({
            where: { trialId }
          });
          
          const elasticSearchResults = await prisma.elasticSearchResult.count({
            where: { trialId }
          });
          
          const statsReport = {
            trialId,
            shortName: trial.shortName,
            trialName: trial.name || trial.caseNumber,
            caseNumber: trial.caseNumber,
            statistics: {
              markers,
              markerSections,
              accumulatorResults,
              elasticSearchResults
            },
            generatedAt: new Date().toISOString()
          };
          
          // Save statistics report
          const statsPath = path.join(outputDir, `trial-${trialId}-phase3-stats.json`);
          fs.writeFileSync(statsPath, JSON.stringify(statsReport, null, 2));
          logger.info(`Saved statistics to ${statsPath}`);
          
          // Generate hierarchy views
          for (const view of views) {
            try {
              logger.info(`Generating ${view} view for trial ${trialId}`);
              const result = await hierarchyService.getHierarchyView({
                trialId,
                view: view as any,
                includeTranscript: false
              });
              
              const viewPath = path.join(outputDir, `trial-${trialId}-${view}.json`);
              fs.writeFileSync(viewPath, JSON.stringify(result, null, 2));
              logger.info(`Saved ${view} view to ${viewPath}`);
            } catch (error) {
              logger.error(`Failed to generate ${view} view for trial ${trialId}:`, error);
            }
          }
        }
      }
      
      logger.info('Phase 3 reports completed successfully');
    } catch (error) {
      logger.error('Failed to generate Phase 3 reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// All Reports
program
  .command('all')
  .description('Run all phase reports for trials in config')
  .requiredOption('-c, --config <path>', 'Path to configuration file')
  .option('-o, --output <dir>', 'Output directory override')
  .action(async (options) => {
    const logger = new Logger('AllReports');
    
    try {
      logger.info('Running all phase reports...');
      
      // Run Phase 1
      await program.parseAsync(['node', 'run-reports', 'phase1', '--config', options.config, ...(options.output ? ['--output', path.join(options.output, 'phase1')] : [])]);
      
      // Run Phase 2
      await program.parseAsync(['node', 'run-reports', 'phase2', '--config', options.config, ...(options.output ? ['--output', path.join(options.output, 'phase2')] : [])]);
      
      // Run Phase 3
      await program.parseAsync(['node', 'run-reports', 'phase3', '--config', options.config, ...(options.output ? ['--output', path.join(options.output, 'phase3')] : [])]);
      
      logger.info('All reports completed successfully');
    } catch (error) {
      logger.error('Failed to generate all reports:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);