// convert-pdfs.ts
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

// --------- Config Handling ---------
interface Config {
  inputDir: string;
  outputDir: string;
  converters: string[];
}

const readConfig = (configPath: string): Config => {
  const json = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(json);
};

// --------- Utility Functions ---------
const listPDFs = (dir: string): string[] =>
  fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));

const ensureDir = (dir: string) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

// --------- Converter Implementations ---------
const convertWithPdfParse = async (filePath: string): Promise<string> => {
  const pdfParse = await import('pdf-parse');
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse.default(dataBuffer);
  return data.text;
};

const convertWithPdf2Json = async (filePath: string): Promise<string> => {
  const PDFParser = (await import('pdf2json')).default;
  const parser = new PDFParser();
  return new Promise((resolve, reject) => {
    parser.on('pdfParser_dataError', err => reject(err.parserError));
    parser.on('pdfParser_dataReady', pdfData => {
      const text = pdfData.formImage.Pages.map(page =>
        page.Texts.map(t =>
          decodeURIComponent(t.R.map(r => r.T).join(' '))
        ).join(' ')
      ).join('\n');
      resolve(text);
    });
    parser.loadPDF(filePath);
  });
};

const convertWithPdfTextExtract = async (filePath: string): Promise<string> => {
  const pdfExtract = await import('pdf-text-extract');
  return new Promise((resolve, reject) => {
    pdfExtract.default(filePath, { layout: true }, (err, pages) => {
      if (err) return reject(err);
      resolve(pages.join('\n'));
    });
  });
};

// --------- Dispatcher ---------
const runConverter = async (
  converter: string,
  inputFile: string
): Promise<string> => {
  switch (converter) {
    case 'pdf-parse':
      return await convertWithPdfParse(inputFile);
    case 'pdf2json':
      return await convertWithPdf2Json(inputFile);
    case 'pdf-text-extract':
      return await convertWithPdfTextExtract(inputFile);
    default:
      throw new Error(`Unsupported converter: ${converter}`);
  }
};

// --------- Main Routine ---------
const run = async (configPath: string) => {
  const config = readConfig(configPath);
  const pdfs = listPDFs(config.inputDir);

  for (const converter of config.converters) {
    const outPath = path.join(config.outputDir, converter);
    ensureDir(outPath);

    console.log(`\n--- Using converter: ${converter} ---`);
    for (const file of pdfs) {
      const inputFile = path.join(config.inputDir, file);
      const outputFile = path.join(outPath, file.replace(/\.pdf$/i, '.txt'));

      try {
        const text = await runConverter(converter, inputFile);
        fs.writeFileSync(outputFile, text, 'utf-8');
        console.log(`${file}`);
      } catch (err) {
        console.error(`${file} (Error: ${err})`);
      }
    }
  }
};

run(process.argv[2] || 'config.json');
