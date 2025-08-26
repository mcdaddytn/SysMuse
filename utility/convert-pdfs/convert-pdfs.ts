const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pdfParse = require('pdf-parse');
const pdfExtract = require('pdf-text-extract');
const PDFParser = require('pdf2json');

interface Config {
  inputDir: string;
  outputDir: string;
  converters: string[];
  useSubdirectories?: boolean;  // New option - defaults to false
  pdfTextExtractOptions?: any;   // New option for pdf-text-extract options
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

const convertWithPdfParse = async (filePath: string): Promise<string> => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
};

const convertWithPdfTextExtract = async (filePath: string, options?: any): Promise<string> => {
  // Build options array for pdf-text-extract
  // The library expects options as command-line flags
  let extractOptions = [];
  
  if (options) {
    // Convert boolean options to command-line flags
    if (options.layout) extractOptions.push('-layout');
    if (options.table) extractOptions.push('-table');
    if (options.nopgbrk) extractOptions.push('-nopgbrk');
    if (options.raw) extractOptions.push('-raw');
    if (options.nodiag) extractOptions.push('-nodiag');
    
    // Add other options that take values
    if (options.f) extractOptions.push('-f', options.f);
    if (options.l) extractOptions.push('-l', options.l);
    if (options.r) extractOptions.push('-r', options.r);
    if (options.x) extractOptions.push('-x', options.x);
    if (options.y) extractOptions.push('-y', options.y);
    if (options.W) extractOptions.push('-W', options.W);
    if (options.H) extractOptions.push('-H', options.H);
    if (options.fixed) extractOptions.push('-fixed', options.fixed);
    if (options.opw) extractOptions.push('-opw', options.opw);
    if (options.upw) extractOptions.push('-upw', options.upw);
    if (options.enc) extractOptions.push('-enc', options.enc);
  } else {
    // Default to layout mode if no options specified
    extractOptions = ['-layout'];
  }
  
  // Debug logging
  console.log(`    pdftotext options:`, extractOptions);
  
  return new Promise((resolve, reject) => {
    // pdf-text-extract expects options as an object with 'options' array
    const optionsObject = extractOptions.length > 0 ? { options: extractOptions } : {};
    
    pdfExtract(filePath, optionsObject, (err: any, pages: string[]) => {
      if (err) return reject(err);
      resolve(pages.join('\n'));
    });
  });
};

const convertWithPdftotextDirect = async (filePath: string, options?: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    // Build command arguments
    const args = [];
    
    if (options) {
      // Convert boolean options to command-line flags
      if (options.layout) args.push('-layout');
      if (options.table) args.push('-table');
      if (options.nopgbrk) args.push('-nopgbrk');
      if (options.raw) args.push('-raw');
      if (options.nodiag) args.push('-nodiag');
      
      // Add other options that take values - check for undefined instead of falsy
      if (options.f !== undefined) args.push('-f', options.f.toString());
      if (options.l !== undefined) args.push('-l', options.l.toString());
      if (options.r !== undefined) args.push('-r', options.r.toString());
      if (options.x !== undefined) args.push('-x', options.x.toString());
      if (options.y !== undefined) args.push('-y', options.y.toString());
      if (options.W !== undefined) args.push('-W', options.W.toString());
      if (options.H !== undefined) args.push('-H', options.H.toString());
      if (options.fixed !== undefined) args.push('-fixed', options.fixed.toString());
      if (options.opw !== undefined) args.push('-opw', options.opw);
      if (options.upw !== undefined) args.push('-upw', options.upw);
      if (options.enc !== undefined) args.push('-enc', options.enc);
    }
    
    // Add input file and - for stdout
    args.push(filePath);
    args.push('-');
    
    console.log(`    Executing: pdftotext ${args.join(' ')}`);
    
    const pdftotext = spawn('pdftotext', args);
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
        resolve(output);
      }
    });
    
    pdftotext.on('error', (err: Error) => {
      reject(new Error(`Failed to spawn pdftotext: ${err.message}`));
    });
  });
};

const convertWithPdf2Json = async (filePath: string): Promise<string> => {
  const parser = new PDFParser();

  return new Promise((resolve, reject) => {
    parser.on('pdfParser_dataError', (err: any) => reject(err.parserError));
    parser.on('pdfParser_dataReady', (pdfData: any) => {
      if (!pdfData?.formImage?.Pages) {
        return reject(
          new Error(`pdf2json failed to parse structure in: ${filePath}`)
        );
      }

      try {
        const text = pdfData.formImage.Pages.map((page: any) =>
          page.Texts.map((t: any) =>
            decodeURIComponent(t.R.map((r: any) => r.T).join(' '))
          ).join(' ')
        ).join('\n');
        resolve(text);
      } catch (err) {
        reject(
          new Error(
            `pdf2json failed to extract text in: ${filePath} — ${err}`
          )
        );
      }
    });

    parser.loadPDF(filePath);
  });
};

const runConverter = async (
  converter: string,
  inputFile: string,
  config: Config
): Promise<string> => {
  switch (converter) {
    case 'pdf-parse':
      return await convertWithPdfParse(inputFile);
    case 'pdf-text-extract':
      return await convertWithPdfTextExtract(inputFile, config.pdfTextExtractOptions);
    case 'pdftotext-direct':
      return await convertWithPdftotextDirect(inputFile, config.pdfTextExtractOptions);
    case 'pdf2json':
      return await convertWithPdf2Json(inputFile);
    default:
      throw new Error(`Unsupported converter: ${converter}`);
  }
};

const run = async (configPath: string) => {
  const config = readConfig(configPath);
  const pdfs = listPDFs(config.inputDir);
  
  // Default useSubdirectories to false if not specified
  const useSubdirectories = config.useSubdirectories !== undefined ? config.useSubdirectories : false;

  for (const converter of config.converters) {
    // Determine output path based on configuration
    const outPath = useSubdirectories 
      ? path.join(config.outputDir, converter)
      : config.outputDir;
    
    ensureDir(outPath);

    console.log(`\n--- Using converter: ${converter} ---`);
    if ((converter === 'pdf-text-extract' || converter === 'pdftotext-direct') && config.pdfTextExtractOptions) {
      console.log(`    Options: ${JSON.stringify(config.pdfTextExtractOptions)}`);
    }
    
    for (const file of pdfs) {
      const inputFile = path.join(config.inputDir, file);
      const outputFile = path.join(outPath, file.replace(/\.pdf$/i, '.txt'));

      try {
        const text = await runConverter(converter, inputFile, config);
        fs.writeFileSync(outputFile, text, 'utf-8');
        console.log(`✔ ${file}`);
      } catch (err) {
        console.error(`✗ ${file} (Error: ${err})`);
      }
    }
  }
};

run(process.argv[2] || 'config.json');