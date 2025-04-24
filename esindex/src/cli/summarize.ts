// === src/cli/summarize.ts ===
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../lib/config';

const prisma = new PrismaClient();

export async function summarizeCorpus(configPath: string) {
  const config = loadConfig(configPath);
  const corpusName = config.corpus;

  const corpus = await prisma.corpus.findUnique({
    where: { name: corpusName },
    include: {
      documents: {
        include: { terms: true }
      }
    }
  });

  if (!corpus) {
    console.error(`Corpus not found: ${corpusName}`);
    return;
  }

  const numDocs = corpus.documents.length;
  const totalTerms = corpus.documents.reduce((sum, doc) => sum + doc.terms.length, 0);
  const totalLength = corpus.documents.reduce((sum, doc) => sum + doc.docLength, 0);
  const avgTerms = numDocs > 0 ? totalTerms / numDocs : 0;
  const avgLength = numDocs > 0 ? totalLength / numDocs : 0;

  console.log(`Summary for dataset: ${corpusName}`);
  console.log(`  Total documents: ${numDocs}`);
  console.log(`  Total terms extracted: ${totalTerms}`);
  console.log(`  Avg terms per doc: ${avgTerms.toFixed(2)}`);
  console.log(`  Avg document length: ${avgLength.toFixed(2)} characters`);
}
