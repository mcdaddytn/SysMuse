// convert-pdfs.ts

import fs from 'fs';
import path from 'path';
import PDFParser from 'pdf2json';
//import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.js');


const pdfParse = require('pdf-parse');
const pdfExtract = require('pdf-text-extract');

interface Config {
  inputDir: string;
  outputDir: string;
  converters: string[];
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

// ----- Converter Implementations -----

const convertWithPdfTextExtract = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    pdfExtract(filePath, { layout: true }, (err: any, pages: string[]) => {
      if (err) return reject(err);
      resolve(pages.join('\n'));
    });
  });
};

const convertWithPdfParse = async (filePath: string): Promise<string> => {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdfParse(dataBuffer);
  return data.text;
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

const convertWithPdfjsDist = async (filePath: string): Promise<string> => {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const pdf = await getDocument({ data }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const lines: Map<number, string[]> = new Map();

    for (const item of content.items) {
      const text = (item as any).str;
      const y = Math.round((item as any).transform[5]);

      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push(text);
    }

    const pageLines = Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0]) // top to bottom
      .map(([, tokens]) => tokens.join(' '))
      .join('\n');

    fullText += `\n\nPage ${i}\n${pageLines}`;
  }

  return fullText;
};

// ----- Dispatcher -----

const runConverter = async (
  converter: string,
  inputFile: string
): Promise<string> => {
  switch (converter) {
    case 'pdf-text-extract':
      return await convertWithPdfTextExtract(inputFile);
    case 'pdfjs-dist':
      return await convertWithPdfjsDist(inputFile);
    case 'pdf-parse':
      return await convertWithPdfParse(inputFile);
    case 'pdf2json':
      return await convertWithPdf2Json(inputFile);
    default:
      throw new Error(`Unsupported converter: ${converter}`);
  }
};

// ----- Main Routine -----

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
        console.log(`Success ${file}`);
      } catch (err) {
        console.error(`Error ${file} (Error: ${err})`);
      }
    }
  }
};

run(process.argv[2] || 'config.json');
