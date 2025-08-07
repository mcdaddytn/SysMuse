// scripts/process-trial.ts
#!/usr/bin/env ts-node

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { TranscriptConfig } from '../src/types/config.types';
import { TranscriptParser } from '../src/parsers/TranscriptParser';
import { Phase2Processor } from '../src/parsers/Phase2Processor';
import { Phase3Processor } from '../src/parsers/Phase3Processor';
import { TranscriptExportService } from '../src/services/TranscriptExportService';
import logger from '../src/utils/logger';

const program = new Command();

program
  .name('process-trial')
  .description('Process a complete trial from transcript files')
  .argument('<directory>', 'Directory containing transcript files')
  .option('-n, --case-name <name>', 'Case name')
  .option('-c, --case-number <number>', 'Case number')
  .option('-f, --format <format>', 'File format (pdf|txt)', 'txt')
  .option('--skip-phase1', 'Skip Phase 1 processing')
  .option('--skip-phase2', 'Skip Phase 2 processing')
  .option('--skip-phase3', 'Skip Phase 3 processing')
  .option('-e, --export', 'Export transcript after processing')
  .option('--export-format <format>', 'Export format (text|markdown|json)', 'text')
  .option('--synopsis', 'Generate synopsis for sections')
  .action(async (directory, options) => {
    try {
      logger.info(`Processing trial from directory: ${directory}`);
      
      // Validate directory
      if (!fs.existsSync(directory)) {
        throw new Error(`Directory not found: ${directory}`);
      }
      
      // Create configuration
      const config: TranscriptConfig = {
        transcriptPath: path.resolve(directory),
        format: options.format,
        caseName: options.caseName,
        caseNumber: options.caseNumber,
        phases: {
          phase1: !options.skipPhase1,
          phase2: !options.skipPhase2,
          phase3: !options.skipPhase3
        },
        parsingOptions: {
          ignoreBlankLines: true,
          trimWhitespace: true
        },
        elasticsearchOptions: {
          url: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
          index: 'judicial_transcripts'
        }
      };
      
      // Run Phase 1
      let trialId: number | undefined;
      
      if (config.phases.phase1) {
        logger.info('Running Phase 1: Raw Parsing');
        const parser = new TranscriptParser(config);
        await parser.parseDirectory();
        
        // Get trial ID for export
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        const trial = await prisma.trial.findFirst({
          where: { caseNumber: options.caseNumber },
          orderBy: { createdAt: 'desc' }
        });
        trialId = trial?.id;
        await prisma.$disconnect();
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
      
      // Export if requested
      if (options.export && trialId) {
        logger.info('Exporting transcript');
        const exportService = new TranscriptExportService();
        
        const exportConfig = {
          trialId,
          outputPath: path.join(
            'exports',
            `${options.caseNumber || 'trial'}-${Date.now()}.${options.exportFormat}`
          ),
          format: options.exportFormat as any,
          includeMetadata: true,
          includeTimestamps: false,
          includeLineNumbers: false,
          renderMode: options.synopsis ? 'synopsis' : 'original' as any
        };
        
        await exportService.exportTranscript(exportConfig);
        logger.info(`Transcript exported to: ${exportConfig.outputPath}`);
      }
      
      logger.info('Processing completed successfully');
      
    } catch (error) {
      logger.error('Error processing trial:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);

