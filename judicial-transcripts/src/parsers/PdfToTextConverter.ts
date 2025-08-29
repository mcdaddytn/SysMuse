import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';
import { FileConventionDetector } from './FileConventionDetector';
import { TrialStyleConfig } from '../types/config.types';

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
}

export class PdfToTextConverter {
  private config: PdfToTextConfig;

  constructor(config: PdfToTextConfig = {}) {
    this.config = config;
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
      const subDirs = fs.readdirSync(inputDir)
        .filter(f => fs.statSync(path.join(inputDir, f)).isDirectory());
      
      logger.info(`Found ${subDirs.length} subdirectories to process`);
      
      for (const subDir of subDirs) {
        const inputSubDir = path.join(inputDir, subDir);
        const outputSubDir = path.join(outputDir, subDir);
        
        // Get PDFs in this subdirectory
        const pdfs = this.listPDFs(inputSubDir);
        
        if (pdfs.length === 0) {
          logger.info(`Skipping "${subDir}" (no PDFs found)`);
          continue;
        }
        
        logger.info(`Processing "${subDir}" (${pdfs.length} PDFs)...`);
        
        // Ensure output subdirectory exists
        if (!fs.existsSync(outputSubDir)) {
          fs.mkdirSync(outputSubDir, { recursive: true });
        }

        // Generate trialstyle.json for this subdirectory
        await this.generateTrialStyleConfig(outputSubDir, pdfs);
        
        for (const file of pdfs) {
          const inputFile = path.join(inputSubDir, file);
          const outputFile = path.join(outputSubDir, file.replace(/\.pdf$/i, '.txt'));

          try {
            const text = await this.convertFile(inputFile);
            fs.writeFileSync(outputFile, text, 'utf-8');
            logger.info(`✔ ${file}`);
          } catch (err) {
            logger.error(`✗ ${file} (Error: ${err})`);
          }
        }
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
      await this.generateTrialStyleConfig(outputDir, pdfs);
    }
  }

  private listPDFs(dir: string): string[] {
    return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
  }

  private async generateTrialStyleConfig(outputDir: string, files: string[]): Promise<void> {
    const detector = new FileConventionDetector();
    
    // Load default config if exists
    let defaultConfig: Partial<TrialStyleConfig> = {};
    const defaultConfigPath = path.join(process.cwd(), 'config', 'trialstyle.json');
    if (fs.existsSync(defaultConfigPath)) {
      const configContent = fs.readFileSync(defaultConfigPath, 'utf-8');
      defaultConfig = JSON.parse(configContent);
    }
    
    // Convert PDF names to txt names for detection
    const txtFiles = files.map(f => f.replace(/\.pdf$/i, '.txt'));
    
    // Generate config
    await detector.generateTrialStyleConfig(outputDir, txtFiles, defaultConfig);
  }
}