// === src/setup/importStopwords.ts ===
import fs from 'fs-extra';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const dataPath = process.env.DATA_PATH || '.';

function cleanWord(word: string): string {
  return word
    .replace(/^\W+/, '') // remove non-alphanum prefix
    .replace(/\W+$/, '') // remove non-alphanum suffix
    .trim()
    .toLowerCase();
}

function toCsvFormat(words: string[]): string {
  return words.map(w => `"${w}"`).join(',');
}

export async function importStopwords(category: string, filename: string, delimiter: string, convertCsv?: boolean) {
  const filePath = path.join(dataPath, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let words = normalized.split(delimiter).map(w => cleanWord(w)).filter(w => !!w);

  const uniqueWords: string[] = Array.from(new Set(words));
  const uniqueWordsExcerpt: string[] = uniqueWords.slice(0, 10);

  //console.log(`uniqueWordsExcerpt ${uniqueWordsExcerpt}`);
  console.log(`Imported ${uniqueWords.length} stopwords for category: ${category} with delimiter: ${delimiter} from filePath: ${filePath}`);

  if (convertCsv && delimiter !== ',') {
    const outputCsvPath = filePath.replace(/\.[^/.]+$/, '.csv');
    const csvContent = toCsvFormat(uniqueWords);
    fs.writeFileSync(outputCsvPath, csvContent, 'utf-8');
    console.log(`Converted and wrote cleaned CSV stopwords to ${outputCsvPath}`);
  }

  await prisma.stopword.deleteMany({ where: { category } });

  for (const word of uniqueWords) {
    try {
      //console.log(`Adding ${word} for category: ${category}`);
      await prisma.stopword.create({ data: { term: word, category } });
    } catch (err: any) {
      console.warn(`Skipping duplicate or error for term '${word}': ${err.message}`);
    }
  }

  console.log(`Finished importing ${uniqueWords.length} unique stopwords for category: ${category}`);
}

export async function getAllStopwords(): Promise<Set<string>> {
  const words = await prisma.stopword.findMany();
  return new Set(words.map(w => w.term));
}

