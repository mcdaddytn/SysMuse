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

export async function importStopwords(
  category: string, 
  filename: string, 
  delimiter: string, 
  convertCsv?: boolean,
  corpusName?: string
): Promise<void> {
  const filePath = path.join(dataPath, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let words = normalized.split(delimiter).map(w => cleanWord(w)).filter(w => !!w);

  const uniqueWords: string[] = Array.from(new Set(words));
  const uniqueWordsExcerpt: string[] = uniqueWords.slice(0, 10);

  console.log(`Imported ${uniqueWords.length} stopwords for category: ${category} with delimiter: ${delimiter} from filePath: ${filePath}`);

  if (convertCsv && delimiter !== ',') {
    const outputCsvPath = filePath.replace(/\.[^/.]+$/, '.csv');
    const csvContent = toCsvFormat(uniqueWords);
    fs.writeFileSync(outputCsvPath, csvContent, 'utf-8');
    console.log(`Converted and wrote cleaned CSV stopwords to ${outputCsvPath}`);
  }

  // Find corpus if specified
  let corpus = null;
  if (corpusName) {
    corpus = await prisma.corpus.findUnique({
      where: { name: corpusName }
    });
    
    if (!corpus) {
      console.warn(`Corpus "${corpusName}" not found, stopwords will not be linked to a corpus`);
    }
  }

  // Delete existing stopwords for this category
  await prisma.stopword.deleteMany({ 
    where: { 
      category,
      ...(corpus ? { corpusId: corpus.id } : {})
    } 
  });

  // Insert new stopwords
  for (const word of uniqueWords) {
    try {
      await prisma.stopword.create({ 
        data: { 
          term: word, 
          category,
          ...(corpus ? { corpus: { connect: { id: corpus.id } } } : {})
        } 
      });
    } catch (err: any) {
      console.warn(`Skipping duplicate or error for term '${word}': ${err.message}`);
    }
  }

  console.log(`Finished importing ${uniqueWords.length} unique stopwords for category: ${category}${corpus ? ` linked to corpus "${corpusName}"` : ''}`);
}

export async function getAllStopwords(corpusId?: number): Promise<Set<string>> {
  const words = await prisma.stopword.findMany({
    where: corpusId ? { corpusId } : undefined
  });
  return new Set(words.map(w => w.term));
}
