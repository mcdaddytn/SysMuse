#!/usr/bin/env node

import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { Phase2ReportGenerator } from '../services/Phase2ReportGenerator';
import * as path from 'path';

const program = new Command();
const prisma = new PrismaClient();

program
  .name('phase2-report')
  .description('Generate Phase 2 reports from parsed trial data')
  .version('1.0.0');

program
  .command('generate-all')
  .description('Generate all Phase 2 reports')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase2')
  .action(async (options) => {
    try {
      const generator = new Phase2ReportGenerator(prisma, options.output);
      await generator.generateAll(options.trialId);
      console.log('✅ All Phase 2 reports generated successfully');
    } catch (error) {
      console.error('Error generating Phase 2 reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('speaker-distribution')
  .description('Generate StatementEvent distribution by speaker reports')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase2')
  .action(async (options) => {
    try {
      const generator = new Phase2ReportGenerator(prisma, options.output);
      await generator.generateStatementEventBySpeakerReports(options.trialId);
      console.log('✅ Speaker distribution reports generated successfully');
    } catch (error) {
      console.error('Error generating speaker distribution reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('speaker-type-distribution')
  .description('Generate StatementEvent distribution by speaker type reports')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase2')
  .action(async (options) => {
    try {
      const generator = new Phase2ReportGenerator(prisma, options.output);
      await generator.generateStatementEventBySpeakerTypeReports(options.trialId);
      console.log('✅ Speaker type distribution reports generated successfully');
    } catch (error) {
      console.error('Error generating speaker type distribution reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('speaker-type-dist-all')
  .description('Generate speaker type distribution report for all trials')
  .option('-o, --output <dir>', 'Output directory', './output/phase2')
  .action(async (options) => {
    try {
      const generator = new Phase2ReportGenerator(prisma, options.output);
      await generator.generateAllTrialsSpeakerTypeDistribution();
      console.log('✅ All trials speaker type distribution report generated successfully');
    } catch (error) {
      console.error('Error generating all trials speaker type distribution report:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('event-timeline')
  .description('Generate event timeline reports')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase2')
  .action(async (options) => {
    try {
      const generator = new Phase2ReportGenerator(prisma, options.output);
      await generator.generateEventTimelineReports(options.trialId);
      console.log('✅ Event timeline reports generated successfully');
    } catch (error) {
      console.error('Error generating event timeline reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('examinations')
  .description('Generate examination reports')
  .option('-t, --trial-id <id>', 'Generate reports for specific trial', parseInt)
  .option('-o, --output <dir>', 'Output directory', './output/phase2')
  .action(async (options) => {
    try {
      const generator = new Phase2ReportGenerator(prisma, options.output);
      await generator.generateExaminationReports(options.trialId);
      console.log('✅ Examination reports generated successfully');
    } catch (error) {
      console.error('Error generating examination reports:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('list-trials')
  .description('List all trials in the database')
  .action(async () => {
    try {
      const trials = await prisma.trial.findMany({
        orderBy: { id: 'asc' }
      });

      console.log('\nAvailable trials:');
      console.log('================');
      for (const trial of trials) {
        console.log(`ID: ${trial.id} - ${trial.name || trial.caseNumber} (${trial.caseHandle})`);
      }
      console.log('');
    } catch (error) {
      console.error('Error listing trials:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);