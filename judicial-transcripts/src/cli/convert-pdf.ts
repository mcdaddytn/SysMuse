#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { PdfToTextConverter, PdfToTextConfig } from '../parsers/PdfToTextConverter';
import { TranscriptConfig } from '../types/config.types';
import { logger } from '../utils/logger';

async function main() {
  const configPath = process.argv[2];
  
  if (!configPath) {
    console.error('Usage: npm run convert-pdf <config-file>');
    console.error('Example: npm run convert-pdf config/example-trial-config-mac.json');
    process.exit(1);
  }

  try {
    // Load main configuration
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config: TranscriptConfig = JSON.parse(configContent);
    
    // Set up logging
    (logger as any).setLevel(config.logLevel || 'info');
    
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
    
    // Load trial-specific configs if using multi-trial config
    let trialConfigs: Record<string, any> = {};
    if ((config as any).trials) {
      trialConfigs = (config as any).trials;
      logger.info(`Loaded ${Object.keys(trialConfigs).length} trial-specific configurations`);
    }
    
    // Create converter with trial configs
    const converter = new PdfToTextConverter(pdfConfig, trialConfigs);
    
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