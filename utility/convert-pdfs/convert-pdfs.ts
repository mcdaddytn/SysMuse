const fs = require('fs');
const path = require('path');
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
  // Default options if none provided
  const extractOptions = options || { layout: true };
  
  return new Promise((resolve, reject) => {
    pdfExtract(filePath, extractOptions, (err: any, pages: string[]) => {
      if (err) return reject(err);
      resolve(pages.join('\n'));
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
    if (converter === 'pdf-text-extract' && config.pdfTextExtractOptions) {
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