#!/usr/bin/env node

import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { Phase1ReportGenerator } from '../services/Phase1ReportGenerator';
import * as path from 'path';

const prisma = new PrismaClient();

const program = new Command();

program
  .name('report')
  .description('Generate reports from Phase 1 parsed data')
  .version('1.0.0');

// Generate all reports
program
  .command('generate-all')
  .description('Generate all Phase 1 reports')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial ID', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase1')
  .action(async (options) => {
    try {
      logger.info('Starting Phase 1 report generation...');
      
      const generator = new Phase1ReportGenerator(prisma, options.output);
      await generator.generateAllReports(options.trialId);
      
      logger.info('Report generation completed successfully');
    } catch (error) {
      logger.error('Report generation failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Generate SessionSection reports (Report 1)
program
  .command('session-sections')
  .description('Generate SessionSection reports for each Trial/Session')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial ID', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase1')
  .action(async (options) => {
    try {
      logger.info('Generating SessionSection reports...');
      
      const generator = new Phase1ReportGenerator(prisma, options.output);
      await generator.generateSessionSectionReports(options.trialId);
      
      logger.info('SessionSection report generation completed');
    } catch (error) {
      logger.error('SessionSection report generation failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Generate Summary Line reports (Report 2)
program
  .command('summary-lines')
  .description('Generate clean summary text for each Trial/Session')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial ID', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase1')
  .action(async (options) => {
    try {
      logger.info('Generating Summary Line reports...');
      
      const generator = new Phase1ReportGenerator(prisma, options.output);
      await generator.generateSummaryLineReports(options.trialId);
      
      logger.info('Summary Line report generation completed');
    } catch (error) {
      logger.error('Summary Line report generation failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Generate full line reports with metadata
program
  .command('full-lines')
  .description('Generate full line reports with metadata')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial ID', parseInt)
  .option('-s, --section <type>', 'Filter by document section (SUMMARY, PROCEEDINGS, etc.)')
  .option('-o, --output <dir>', 'Output directory', './output/phase1')
  .action(async (options) => {
    try {
      logger.info('Generating Full Line reports...');
      
      const generator = new Phase1ReportGenerator(prisma, options.output);
      await generator.generateFullLineReports(options.trialId, options.section);
      
      logger.info('Full Line report generation completed');
    } catch (error) {
      logger.error('Full Line report generation failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Generate session statistics
program
  .command('statistics')
  .description('Generate session statistics reports')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial ID', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase1')
  .action(async (options) => {
    try {
      logger.info('Generating Session Statistics...');
      
      const generator = new Phase1ReportGenerator(prisma, options.output);
      await generator.generateSessionStatistics(options.trialId);
      
      logger.info('Session Statistics generation completed');
    } catch (error) {
      logger.error('Session Statistics generation failed:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// List available trials
program
  .command('list-trials')
  .description('List all trials in the database')
  .action(async () => {
    try {
      const trials = await prisma.trial.findMany({
        select: {
          id: true,
          name: true,
          caseNumber: true,
          plaintiff: true,
          defendant: true,
          _count: {
            select: {
              sessions: true
            }
          }
        },
        orderBy: { name: 'asc' }
      });

      console.log('\nAvailable Trials:');
      console.log('=====================================');
      
      for (const trial of trials) {
        console.log(`\nID: ${trial.id}`);
        console.log(`Name: ${trial.name}`);
        console.log(`Case: ${trial.caseNumber}`);
        console.log(`Parties: ${trial.plaintiff} v. ${trial.defendant}`);
        console.log(`Sessions: ${trial._count.sessions}`);
        console.log('-------------------------------------');
      }
      
      console.log(`\nTotal trials: ${trials.length}`);
    } catch (error) {
      logger.error('Failed to list trials:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);