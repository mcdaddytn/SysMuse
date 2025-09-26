import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';
import { FileConventionDetector } from './FileConventionDetector';
import { TrialStyleConfig } from '../types/config.types';
import { PostProcessor } from '../services/postprocessor/PostProcessor';
import { PostProcessorMode } from '../services/postprocessor/types';

interface PostProcessingOptions {
  fixTranscriptSpacing?: boolean;
  fixTranscriptQuotes?: boolean;
  normalizeWhitespace?: boolean;
  normalizeLineNumberWhitespace?: boolean;
  removeBlankLines?: boolean;
}

interface PdfTextExtractOptions {
  layout?: boolean;
  simple?: boolean;
  simple2?: boolean;
  table?: boolean;
  lineprinter?: boolean;
  raw?: boolean;
  phys?: boolean;
  tsv?: boolean;
  nodiag?: boolean;
  nopgbrk?: boolean;
  bbox?: boolean;
  bbox_layout?: boolean;
  f?: number;
  l?: number;
  r?: number;
  x?: number;
  y?: number;
  W?: number;
  H?: number;
  fixed?: number;
  opw?: string;
  upw?: string;
  enc?: string;
  eol?: string;
}

export interface PdfToTextConfig {
  popplerPath?: string;
  pdfTextExtractOptions?: PdfTextExtractOptions;
  postProcessingOptions?: PostProcessingOptions;
  forceOverwrite?: boolean;  // Force copy all files without checking if up-to-date
}

export class PdfToTextConverter {
  private config: PdfToTextConfig;
  private defaultTrialStyle: any = {};
  private trialSelectionMode: 'ALL' | 'INCLUDE' | 'EXCLUDE' = 'ALL';
  private includedTrials: string[] = [];
  private excludedTrials: string[] = [];

  constructor(
    config: PdfToTextConfig = {}, 
    defaultTrialStyle?: any,
    trialSelectionMode?: 'ALL' | 'INCLUDE' | 'EXCLUDE',
    includedTrials?: string[],
    excludedTrials?: string[]
  ) {
    this.config = config;
    this.defaultTrialStyle = defaultTrialStyle || {};
    this.trialSelectionMode = trialSelectionMode || 'ALL';
    this.includedTrials = includedTrials || [];
    this.excludedTrials = excludedTrials || [];
  }

  private postProcessText(text: string, options: PostProcessingOptions): string {
    let processedText = text;
    
    // Fix common spacing issues in legal transcripts
    if (options.fixTranscriptSpacing) {
      // Fix line number touching Q/A (e.g., "9Q" → "9 Q")
      processedText = processedText.replace(/^(\d+)([QA])\s/gm, '$1 $2 ');
      processedText = processedText.replace(/\n(\d+)([QA])\s/g, '\n$1 $2 ');
      
      // Fix "BY MR." or "BY MS." patterns that might lose spaces
      processedText = processedText.replace(/BY(MR\.|MS\.|DR\.)/g, 'BY $1');
      
      // Fix time stamps that might concatenate (e.g., "9:30a.m." → "9:30 a.m.")
      processedText = processedText.replace(/(\d{1,2}:\d{2})(a\.m\.|p\.m\.)/gi, '$1 $2');
      
      // Fix page/line references (e.g., "page42" → "page 42")
      processedText = processedText.replace(/\b(page|Page|PAGE)(\d+)/g, '$1 $2');
      processedText = processedText.replace(/\b(line|Line|LINE)(\d+)/g, '$1 $2');
    }
    
    // Fix smart quotes and special characters
    if (options.fixTranscriptQuotes) {
      // Convert smart quotes to straight quotes
      processedText = processedText.replace(/[\u2018\u2019]/g, "'");  // Smart single quotes
      processedText = processedText.replace(/[\u201C\u201D]/g, '"');  // Smart double quotes
      
      // Fix em dashes and en dashes
      processedText = processedText.replace(/[\u2014]/g, '--');  // Em dash
      processedText = processedText.replace(/[\u2013]/g, '-');   // En dash
      
      // Fix ellipsis
      processedText = processedText.replace(/[\u2026]/g, '...');  // Ellipsis character
    }
    
    // Normalize whitespace
    if (options.normalizeWhitespace) {
      // Replace multiple spaces with single space (but preserve line structure)
      processedText = processedText.split('\n').map(line => 
        line.replace(/\s{2,}/g, ' ').trim()
      ).join('\n');
      
      // Remove trailing whitespace from each line
      processedText = processedText.replace(/\s+$/gm, '');
      
      // Ensure consistent spacing after punctuation
      processedText = processedText.replace(/([.!?])\s{2,}/g, '$1 ');
      processedText = processedText.replace(/([,;:])\s{2,}/g, '$1 ');
    }
    
    // Normalize line number whitespace - remove leading spaces before line numbers
    if (options.normalizeLineNumberWhitespace) {
      // Split into lines to process each individually
      const lines = processedText.split('\n');
      processedText = lines.map(line => {
        // Check if line starts with optional spaces followed by 1-2 digits
        const match = line.match(/^(\s*)(\d{1,2})(.*)$/);
        if (match) {
          const [, , lineNum, rest] = match;
          // Check if this is actually a line number (has space or end after it)
          if (rest === '' || rest.startsWith(' ') || rest.startsWith('\t')) {
            if (lineNum.length === 1) {
              // Single digit - add one extra space for alignment, plus two for indentation
              return lineNum + '   ' + rest;
            } else {
              // Two digits - just add two spaces for indentation
              return lineNum + '  ' + rest;
            }
          }
        }
        // Return unchanged if no line number found (including blank lines)
        return line;
      }).join('\n');
    }
    
    // Remove blank lines if requested
    if (options.removeBlankLines) {
      // Split into lines, filter out empty lines, rejoin
      processedText = processedText.split('\n')
        .filter(line => line.trim().length > 0)
        .join('\n');
    }
    
    return processedText;
  }

  async convertFile(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Build command arguments
      const args: string[] = [];
      const pdfOptions = this.config.pdfTextExtractOptions;
      
      if (pdfOptions) {
        // Boolean options
        if (pdfOptions.layout) args.push('-layout');
        if (pdfOptions.simple) args.push('-simple');
        if (pdfOptions.simple2) args.push('-simple2');
        if (pdfOptions.table) args.push('-table');
        if (pdfOptions.lineprinter) args.push('-lineprinter');
        if (pdfOptions.raw) args.push('-raw');
        if (pdfOptions.phys) args.push('-phys');
        if (pdfOptions.tsv) args.push('-tsv');
        if (pdfOptions.nodiag) args.push('-nodiag');
        if (pdfOptions.nopgbrk) args.push('-nopgbrk');
        if (pdfOptions.bbox) args.push('-bbox');
        if (pdfOptions.bbox_layout) args.push('-bbox-layout');
        
        // Options with values
        if (pdfOptions.f !== undefined) args.push('-f', pdfOptions.f.toString());
        if (pdfOptions.l !== undefined) args.push('-l', pdfOptions.l.toString());
        if (pdfOptions.r !== undefined) args.push('-r', pdfOptions.r.toString());
        if (pdfOptions.x !== undefined) args.push('-x', pdfOptions.x.toString());
        if (pdfOptions.y !== undefined) args.push('-y', pdfOptions.y.toString());
        if (pdfOptions.W !== undefined) args.push('-W', pdfOptions.W.toString());
        if (pdfOptions.H !== undefined) args.push('-H', pdfOptions.H.toString());
        if (pdfOptions.fixed !== undefined) args.push('-fixed', pdfOptions.fixed.toString());
        if (pdfOptions.opw !== undefined) args.push('-opw', pdfOptions.opw);
        if (pdfOptions.upw !== undefined) args.push('-upw', pdfOptions.upw);
        if (pdfOptions.enc !== undefined) args.push('-enc', pdfOptions.enc);
        if (pdfOptions.eol !== undefined) args.push('-eol', pdfOptions.eol);
      }
      
      // Add input file and - for stdout
      args.push(filePath);
      args.push('-');
      
      // Determine the executable path
      const executable = this.config.popplerPath ? 
        path.join(this.config.popplerPath, 'pdftotext') : 'pdftotext';
      
      logger.debug(`Executing: ${executable} ${args.join(' ')}`);
      
      const pdftotext = spawn(executable, args);
      let output = '';
      let error = '';
      
      pdftotext.stdout.on('data', (data: Buffer) => {
        output += data.toString();
      });
      
      pdftotext.stderr.on('data', (data: Buffer) => {
        error += data.toString();
      });
      
      pdftotext.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(new Error(`pdftotext exited with code ${code}: ${error}`));
        } else {
          // Apply post-processing if options are provided
          const finalOutput = this.config.postProcessingOptions ? 
            this.postProcessText(output, this.config.postProcessingOptions) : output;
          resolve(finalOutput);
        }
      });
      
      pdftotext.on('error', (err: Error) => {
        reject(new Error(`Failed to spawn pdftotext: ${err.message}`));
      });
    });
  }

  async convertDirectory(inputDir: string, outputDir: string, processSubDirs: boolean = false): Promise<void> {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    if (processSubDirs) {
      // Process subdirectories
      let subDirs = fs.readdirSync(inputDir)
        .filter(f => fs.statSync(path.join(inputDir, f)).isDirectory());
      
      // Apply trial selection filter
      subDirs = this.filterTrials(subDirs);
      
      logger.info(`Found ${subDirs.length} subdirectories to process after filtering`);
      
      for (const subDir of subDirs) {
        const inputSubDir = path.join(inputDir, subDir);
        const outputSubDir = path.join(outputDir, subDir);
        
        logger.info(`\n=== Processing trial: ${subDir} ===`);
        logger.info(`  Input dir: ${inputSubDir}`);
        logger.info(`  Output dir: ${outputSubDir}`);
        
        // Check if input directory exists
        if (!fs.existsSync(inputSubDir)) {
          logger.error(`  ❌ Input directory does not exist: ${inputSubDir}`);
          continue;
        }
        
        // Get PDFs in this subdirectory
        const pdfs = this.listPDFs(inputSubDir);
        logger.info(`  PDFs found in input: ${pdfs.length}`);
        if (pdfs.length > 0) {
          logger.debug(`    PDF files: ${pdfs.slice(0, 3).join(', ')}${pdfs.length > 3 ? '...' : ''}`);
        }
        
        // Also check for existing text files
        const existingTextFiles = fs.existsSync(outputSubDir) 
          ? fs.readdirSync(outputSubDir).filter(f => f.toLowerCase().endsWith('.txt'))
          : [];
        logger.info(`  Text files already in output: ${existingTextFiles.length}`);
        if (existingTextFiles.length > 0) {
          logger.debug(`    Text files: ${existingTextFiles.slice(0, 3).join(', ')}${existingTextFiles.length > 3 ? '...' : ''}`);
        }
        
        // Ensure output subdirectory exists
        if (!fs.existsSync(outputSubDir)) {
          logger.info(`  Creating output directory: ${outputSubDir}`);
          fs.mkdirSync(outputSubDir, { recursive: true });
        } else {
          logger.debug(`  Output directory already exists`);
        }
        
        // Track converted files for summary
        const convertedFiles: string[] = [];
        const metadataCopied: string[] = [];
        const skippedExisting: string[] = [];
        
        // Read trial-specific config from PDF directory if exists
        const pdfDirConfigPath = path.join(inputSubDir, 'trialstyle.json');
        let trialSpecificConfig = {};
        if (fs.existsSync(pdfDirConfigPath)) {
          const configContent = fs.readFileSync(pdfDirConfigPath, 'utf-8');
          trialSpecificConfig = JSON.parse(configContent);
          logger.info(`  Found trial-specific config in input directory`);
        } else {
          logger.info(`  No trialstyle.json found in input directory`);
        }
        
        if (pdfs.length === 0) {
          logger.info(`  No PDFs to convert (all text files may already exist)`);
          
          // If no PDFs but we have text files, treat them as already converted
          if (existingTextFiles.length > 0) {
            logger.info(`  Using existing ${existingTextFiles.length} text files`);
            convertedFiles.push(...existingTextFiles);
            skippedExisting.push(...existingTextFiles);
            
            // Still generate/copy trialstyle.json using existing text files
            const pseudoPdfs = existingTextFiles.map(f => f.replace(/\.txt$/i, '.pdf'));
            await this.generateTrialStyleConfig(outputSubDir, pseudoPdfs, trialSpecificConfig);
          } else {
            logger.warn(`  No PDFs found and no existing text files!`);
          }
        } else {
          logger.info(`  Converting ${pdfs.length} PDFs...`);
          
          // Generate trialstyle.json for this subdirectory
          await this.generateTrialStyleConfig(outputSubDir, pdfs, trialSpecificConfig);
          
          for (const file of pdfs) {
            const inputFile = path.join(inputSubDir, file);
            const outputFile = path.join(outputSubDir, file.replace(/\.pdf$/i, '.txt'));
            const outputFileName = file.replace(/\.pdf$/i, '.txt');

            // Check if text file already exists
            if (fs.existsSync(outputFile) && !this.config.forceOverwrite) {
              logger.info(`⏩ ${file} (text file already exists)`);
              convertedFiles.push(outputFileName);
              skippedExisting.push(outputFileName);
            } else {
              try {
                const text = await this.convertFile(inputFile);
                fs.writeFileSync(outputFile, text, 'utf-8');
                logger.info(`✔ ${file}${this.config.forceOverwrite && fs.existsSync(outputFile) ? ' (forced overwrite)' : ''}`);
                convertedFiles.push(outputFileName);
              } catch (err) {
                logger.error(`✗ ${file} (Error: ${err})`);
              }
            }
          }
        }
        
        // ALWAYS copy metadata files if they exist (even if no PDFs found)
        // NOTE: trialstyle.json is handled separately via generateTrialStyleConfig to merge configs
        logger.info(`\n  Checking for metadata files to copy...`);
        const metadataFiles = ['trial-metadata.json', 'Attorney.json', 'Witness.json', 'Trial.json', 'Judge.json', 'CourtReporter.json'];
        for (const metaFile of metadataFiles) {
          const sourcePath = path.join(inputSubDir, metaFile);
          const destPath = path.join(outputSubDir, metaFile);
          
          if (!fs.existsSync(sourcePath)) {
            logger.debug(`    ${metaFile}: not found in source`);
            continue;
          }
          
          if (this.config.forceOverwrite) {
            // Force copy without checking
            fs.copyFileSync(sourcePath, destPath);
            metadataCopied.push(metaFile);
            logger.info(`    ✔ Copied ${metaFile} (forced)`);
          } else if (!fs.existsSync(destPath)) {
            fs.copyFileSync(sourcePath, destPath);
            metadataCopied.push(metaFile);
            logger.info(`    ✔ Copied ${metaFile} (new file)`);
          } else {
            // Check if destination file is different
            const sourceContent = fs.readFileSync(sourcePath, 'utf-8');
            const destContent = fs.readFileSync(destPath, 'utf-8');
            if (sourceContent !== destContent) {
              fs.copyFileSync(sourcePath, destPath);
              metadataCopied.push(metaFile);
              logger.info(`    ✔ Copied ${metaFile} (updated)`);
            } else {
              logger.info(`    ⏩ ${metaFile} already up-to-date`);
            }
          }
        }
        
        // Run post-processor if configured
        const trialStylePath = path.join(outputSubDir, 'trialstyle.json');
        let postProcessorMode: PostProcessorMode = 'NONE';

        if (fs.existsSync(trialStylePath)) {
          const trialStyle = JSON.parse(fs.readFileSync(trialStylePath, 'utf-8'));
          postProcessorMode = trialStyle.postProcessorMode || 'NONE';

          if (postProcessorMode !== 'NONE') {
            logger.info(`\n  Running post-processor (mode: ${postProcessorMode})...`);
            const postProcessor = new PostProcessor();
            const postResult = await postProcessor.process({
              mode: postProcessorMode,
              trialId: subDir,
              outputDir: outputSubDir,
              trialMetadataPath: path.join(outputSubDir, 'trial-metadata.json')
            });

            if (postResult.success) {
              logger.info(`    ✔ Post-processor completed: ${postResult.filesProcessed} files processed`);
            } else {
              logger.error(`    ✗ Post-processor failed: ${postResult.error}`);
            }
          }
        }

        // ALWAYS generate conversion summary (even if no PDFs found)
        logger.info(`\n  Creating conversion summary...`);
        const conversionSummary = {
          timestamp: new Date().toISOString(),
          trialName: subDir,
          filesConverted: convertedFiles,
          metadataCopied: metadataCopied,
          skippedExisting: skippedExisting,
          sourceDir: inputSubDir,
          destDir: outputSubDir,
          pdfCount: pdfs.length,
          textFilesFound: existingTextFiles.length,
          successCount: convertedFiles.length,
          complete: pdfs.length === 0 ? existingTextFiles.length > 0 : convertedFiles.length === pdfs.length
        };

        const summaryPath = path.join(outputSubDir, 'conversion-summary.json');
        logger.info(`    Writing to: ${summaryPath}`);
        fs.writeFileSync(summaryPath, JSON.stringify(conversionSummary, null, 2));
        logger.info(`    ✔ Conversion summary created`);
        logger.info(`    Summary: ${pdfs.length} PDFs, ${convertedFiles.length} converted, ${skippedExisting.length} skipped, ${metadataCopied.length} metadata copied`);
      }
    } else {
      // Process single directory
      const pdfs = this.listPDFs(inputDir);
      
      logger.info(`Number of PDFs found: ${pdfs.length}`);
      
      for (const file of pdfs) {
        const inputFile = path.join(inputDir, file);
        const outputFile = path.join(outputDir, file.replace(/\.pdf$/i, '.txt'));

        try {
          const text = await this.convertFile(inputFile);
          fs.writeFileSync(outputFile, text, 'utf-8');
          logger.info(`✔ ${file}`);
        } catch (err) {
          logger.error(`✗ ${file} (Error: ${err})`);
        }
      }

      // Generate trialstyle.json for this directory
      await this.generateTrialStyleConfig(outputDir, pdfs, null);
    }
  }

  private listPDFs(dir: string): string[] {
    return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
  }

  private filterTrials(trials: string[]): string[] {
    switch (this.trialSelectionMode) {
      case 'INCLUDE':
        return trials.filter(trial => this.includedTrials.includes(trial));
      case 'EXCLUDE':
        return trials.filter(trial => !this.excludedTrials.includes(trial));
      case 'ALL':
      default:
        return trials;
    }
  }

  private async generateTrialStyleConfig(
    outputDir: string, 
    files: string[], 
    trialSpecificConfig?: any
  ): Promise<void> {
    const detector = new FileConventionDetector();
    
    // Start with default trial style from main config
    let mergedConfig: Partial<TrialStyleConfig> = { ...this.defaultTrialStyle };
    
    // Merge with trial-specific config from PDF directory if provided
    if (trialSpecificConfig) {
      // Deep merge the configurations
      mergedConfig = { ...mergedConfig, ...trialSpecificConfig };
      
      // Handle nested expectedPatterns specially
      if (trialSpecificConfig.expectedPatterns) {
        mergedConfig.expectedPatterns = {
          ...this.defaultTrialStyle.expectedPatterns,
          ...trialSpecificConfig.expectedPatterns
        };
        
        // Convert expected patterns to the format used by FileConventionDetector
        if (trialSpecificConfig.expectedPatterns.question) {
          mergedConfig.questionPatterns = trialSpecificConfig.expectedPatterns.question;
        }
        if (trialSpecificConfig.expectedPatterns.answer) {
          mergedConfig.answerPatterns = trialSpecificConfig.expectedPatterns.answer;
        }
        if (trialSpecificConfig.expectedPatterns.attorney) {
          // Convert simple attorney patterns to regex patterns
          mergedConfig.attorneyIndicatorPatterns = trialSpecificConfig.expectedPatterns.attorney
            .map((p: string) => p.includes('(') ? p : `${p} ([A-Z][A-Z\\s'-]+?)`);
        }
      }
      
      // Set file convention if specified
      if (trialSpecificConfig.fileConvention) {
        mergedConfig.fileConvention = trialSpecificConfig.fileConvention;
      }
      
      // Enable generic fallback based on config
      if (trialSpecificConfig.enableGenericFallback !== undefined) {
        mergedConfig.enableGenericFallback = trialSpecificConfig.enableGenericFallback;
      }
      
      // Merge exclude patterns if provided
      if (trialSpecificConfig.excludePatterns) {
        mergedConfig.excludePatterns = trialSpecificConfig.excludePatterns;
      }
    }
    
    // Convert PDF names to txt names for detection
    const txtFiles = files.map(f => f.replace(/\.pdf$/i, '.txt'));
    
    // Generate config with merged settings
    await detector.generateTrialStyleConfig(outputDir, txtFiles, mergedConfig);
  }
}