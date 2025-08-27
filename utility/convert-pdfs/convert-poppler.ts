const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

interface PostProcessingOptions {
  fixTranscriptSpacing?: boolean;
  fixTranscriptQuotes?: boolean;
  normalizeWhitespace?: boolean;
  normalizeLineNumberWhitespace?: boolean;
  removeBlankLines?: boolean;
}

interface Config {
  inputDir: string;
  outputDir: string;
  processSubDirs?: boolean;  // Process subdirectories (defaults to false)
  popplerPath?: string;  // Optional path to pdftotext executable
  pdfTextExtractOptions?: any;
  postProcessingOptions?: PostProcessingOptions;
}

const readConfig = (configPath: string): Config => {
  const json = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(json);
};

const listPDFs = (dir: string): string[] =>
  fs.readdirSync(dir).filter((f: string) => f.toLowerCase().endsWith('.pdf'));

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const postProcessText = (text: string, options: PostProcessingOptions): string => {
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
        const [, spaces, lineNum, rest] = match;
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
};

const convertWithPoppler = async (
  filePath: string, 
  popplerPath: string | undefined,
  pdfOptions?: any,
  postOptions?: PostProcessingOptions
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Build command arguments
    const args = [];
    
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
    const executable = popplerPath ? path.join(popplerPath, 'pdftotext') : 'pdftotext';
    
    console.log(`    Executing: ${executable} ${args.join(' ')}`);
    
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
        const finalOutput = postOptions ? postProcessText(output, postOptions) : output;
        resolve(finalOutput);
      }
    });
    
    pdftotext.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn pdftotext: ${err.message}`));
    });
  });
};

const run = async (configPath: string) => {
  const config = readConfig(configPath);
  const processSubDirs = config.processSubDirs || false;
  
  console.log(`\n--- PDF to Text Conversion using Poppler ---`);
  console.log(`Input directory: ${config.inputDir}`);
  console.log(`Output directory: ${config.outputDir}`);
  console.log(`Process subdirectories: ${processSubDirs}`);
  
  if (config.popplerPath) {
    console.log(`Using pdftotext from: ${config.popplerPath}`);
  } else {
    console.log(`Using pdftotext from system PATH`);
  }
  
  if (config.pdfTextExtractOptions) {
    console.log(`PDF options: ${JSON.stringify(config.pdfTextExtractOptions)}`);
  }
  
  if (config.postProcessingOptions) {
    console.log(`Post-processing: ${JSON.stringify(config.postProcessingOptions)}`);
  }
  
  if (processSubDirs) {
    // Process subdirectories
    const subDirs = fs.readdirSync(config.inputDir)
      .filter((f: string) => fs.statSync(path.join(config.inputDir, f)).isDirectory());
    
    console.log(`\nFound ${subDirs.length} subdirectories to process`);
    
    for (const subDir of subDirs) {
      const inputSubDir = path.join(config.inputDir, subDir);
      const outputSubDir = path.join(config.outputDir, subDir);
      
      // Get PDFs in this subdirectory
      const pdfs = listPDFs(inputSubDir);
      
      if (pdfs.length === 0) {
        console.log(`\nSkipping "${subDir}" (no PDFs found)`);
        continue;
      }
      
      console.log(`\nProcessing "${subDir}" (${pdfs.length} PDFs)...`);
      
      // Ensure output subdirectory exists
      ensureDir(outputSubDir);
      
      for (const file of pdfs) {
        const inputFile = path.join(inputSubDir, file);
        const outputFile = path.join(outputSubDir, file.replace(/\.pdf$/i, '.txt'));

        try {
          const text = await convertWithPoppler(
            inputFile,
            config.popplerPath,
            config.pdfTextExtractOptions,
            config.postProcessingOptions
          );
          fs.writeFileSync(outputFile, text, 'utf-8');
          console.log(`  ✔ ${file}`);
        } catch (err) {
          console.error(`  ✗ ${file} (Error: ${err})`);
        }
      }
    }
  } else {
    // Process single directory (original behavior)
    const pdfs = listPDFs(config.inputDir);
    
    console.log(`\nNumber of PDFs found: ${pdfs.length}`);
    
    // Ensure output directory exists
    ensureDir(config.outputDir);
    
    console.log(`\nProcessing files...`);
    
    for (const file of pdfs) {
      const inputFile = path.join(config.inputDir, file);
      const outputFile = path.join(config.outputDir, file.replace(/\.pdf$/i, '.txt'));

      try {
        const text = await convertWithPoppler(
          inputFile,
          config.popplerPath,
          config.pdfTextExtractOptions,
          config.postProcessingOptions
        );
        fs.writeFileSync(outputFile, text, 'utf-8');
        console.log(`✔ ${file}`);
      } catch (err) {
        console.error(`✗ ${file} (Error: ${err})`);
      }
    }
  }
  
  console.log(`\nConversion complete.`);
};

// Run the converter
run(process.argv[2] || 'config.json').catch(console.error);