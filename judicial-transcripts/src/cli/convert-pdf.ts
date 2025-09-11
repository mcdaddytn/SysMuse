#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { PdfToTextConverter, PdfToTextConfig } from '../parsers/PdfToTextConverter';
import { TranscriptConfig } from '../types/config.types';
import { logger } from '../utils/logger';
import { initializeLogger } from '../utils/log-config-loader';

async function main() {
  // Initialize logger with centralized config first
  initializeLogger();
  
  const configPath = process.argv[2];
  const trialFilter = process.argv.includes('--trial') ? 
    process.argv[process.argv.indexOf('--trial') + 1] : null;
  
  if (!configPath) {
    console.error('Usage: npm run convert-pdf <config-file> [--trial <trial-name>]');
    console.error('Example: npm run convert-pdf config/example-trial-config-mac.json');
    console.error('Example: npm run convert-pdf config/example-trial-config-mac.json --trial "21 Cassidian V Microdata"');
    process.exit(1);
  }

  try {
    // Load main configuration
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config: TranscriptConfig = JSON.parse(configContent);
    
    logger.info('=== PDF to Text Conversion Phase ===');
    logger.info(`Input directory: ${config.inputDir}`);
    logger.info(`Output directory: ${config.outputDir}`);
    logger.info(`Process subdirectories: ${config.processSubDirs || false}`);
    
    // Load PDF to text configuration
    let pdfConfig: PdfToTextConfig = {};
    if (config.pdfToTextConfig) {
      const pdfConfigPath = path.isAbsolute(config.pdfToTextConfig) ? 
        config.pdfToTextConfig : 
        path.join(process.cwd(), config.pdfToTextConfig);
      
      if (fs.existsSync(pdfConfigPath)) {
        const pdfConfigContent = fs.readFileSync(pdfConfigPath, 'utf-8');
        pdfConfig = JSON.parse(pdfConfigContent);
        logger.info(`Loaded PDF config from: ${pdfConfigPath}`);
      } else {
        logger.warn(`PDF config file not found: ${pdfConfigPath}, using defaults`);
      }
    }
    
    // Apply forceOverwrite from main config if set
    if (config.forceOverwrite !== undefined) {
      pdfConfig.forceOverwrite = config.forceOverwrite;
      if (config.forceOverwrite) {
        logger.info('Force overwrite mode enabled - will overwrite all existing files');
      }
    }
    
    // Get trial selection settings and default trial style from config
    let trialSelectionMode = (config as any).trialSelectionMode || 'ALL';
    let includedTrials = (config as any).includedTrials || [];
    const excludedTrials = (config as any).excludedTrials || [];
    const defaultTrialStyle = (config as any).defaultTrialStyle || {};
    
    // Apply --trial filter if specified
    if (trialFilter) {
      trialSelectionMode = 'INCLUDE';
      includedTrials = [trialFilter];
      logger.info(`Filtering to single trial: ${trialFilter}`);
    }
    
    logger.info(`Trial selection mode: ${trialSelectionMode}`);
    if (trialSelectionMode === 'INCLUDE' && includedTrials.length > 0) {
      logger.info(`Including trials: ${includedTrials.join(', ')}`);
    } else if (trialSelectionMode === 'EXCLUDE' && excludedTrials.length > 0) {
      logger.info(`Excluding trials: ${excludedTrials.join(', ')}`);
    }
    
    // Create converter with new parameters
    const converter = new PdfToTextConverter(
      pdfConfig, 
      defaultTrialStyle,
      trialSelectionMode,
      includedTrials,
      excludedTrials
    );
    
    // Convert PDFs
    await converter.convertDirectory(
      config.inputDir,
      config.outputDir,
      config.processSubDirs || false
    );
    
    logger.info('=== PDF Conversion Complete ===');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Review the generated trialstyle.json files in the output directory');
    logger.info('2. Adjust file ordering if needed');
    logger.info('3. Run phase 1 parsing: npm run parse:phase1 <config-file>');
    
  } catch (error) {
    logger.error('PDF conversion failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});