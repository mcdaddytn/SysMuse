// === src/setup/importStopwords.ts ===
//import fs from 'fs';
import * as fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
//import dotenv from 'dotenv';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const dataPath = process.env.DATA_PATH!;

export async function importStopwords(category: string, filename: string, delimiter: string) {
  const filePath = path.join(dataPath, filename);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const words = raw.split(delimiter).map(w => w.trim().toLowerCase()).filter(w => !!w);

  await prisma.stopword.deleteMany({ where: { category } });
  for (const word of words) {
    await prisma.stopword.create({ data: { term: word, category } });
  }

  console.log(`Imported ${words.length} stopwords for category: ${category}`);
}

export async function getAllStopwords(): Promise<Set<string>> {
  const words = await prisma.stopword.findMany();
  return new Set(words.map(w => w.term));
}

