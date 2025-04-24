// === src/cli/importCorpus.ts — updated for JSON + longform text import ===
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { esClient } from '../lib/es';
import { getTopCorpusTerms } from '../lib/getTopCorpusTerms';
import { loadConfig } from '../lib/config';
import { StopwordCache } from '../lib/stopwords';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const longTextPath = process.env.LONG_TEXT_PATH || './longform';

interface WordStats {
  wordCount: number;
  docLength: number;
  distinctWordCount: number;
  avgWordLength: number;
}

function analyzeTextStats(text: string): WordStats {
  const words: string[] = text.match(/\b\w+\b/g) || [];
  const wordCount = words.length;
  const docLength = text.length;
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const distinctWordCount = uniqueWords.size;
  const avgWordLength = wordCount > 0 ? words.reduce((sum, w) => sum + w.length, 0) / wordCount : 0;
  return { wordCount, docLength, distinctWordCount, avgWordLength };
}

export async function importCorpus(configPath: string) {
  const config = loadConfig(configPath);
  const corpusName = config.corpus;
  const index = config.index;
  const jsonFile = config.dataFile || `${corpusName}.json`;
  const dfMin = config.dfMin ?? 2;
  const dfMax = config.dfMax ?? 100;
  const topN = config.topN ?? 5;
  const fields = config.fields || ['transcript'];
  const fieldModes = config.fieldModes || {};

  const jsonPath = path.join(process.env.IMPORT_DATA_PATH || './import', jsonFile);
  const records = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  //const candidateSet = await getTopCorpusTerms({ index, fields, dfMin, dfMax, fieldModes });
  //console.log(`Found ${candidateSet.size} candidates for ${index}`);

  const corpus = await prisma.corpus.upsert({ where: { name: corpusName }, update: {}, create: { name: corpusName } });
  const stopwords = await StopwordCache.load();
  let docCount = 0;
  const esmap = new Map<number, string>();
  const statsmap = new Map<number, WordStats>();
  const idmap = new Map<number, number>();

  // pass 1
  for (const record of records) {
    const contentField = fields.find(f => record[f]);
    const textFilename = record[contentField];
    const recordIndex: number = record["recordIndex"];
    const text = fs.readFileSync(path.join(longTextPath, textFilename), 'utf8');
    const wordStats: WordStats = analyzeTextStats(text);
    const { wordCount, docLength, distinctWordCount, avgWordLength } = wordStats;

    const esDoc = { ...record };
    esDoc[contentField] = text;

    //const esResult = await esClient.index({ index, document: esDoc });
    const esResult = await esClient.index({ index, refresh: true, document: esDoc });
    //esClient.indices.refresh({ index })

    // need to insert recordId from json here, could be used as id of table really
    const doc = await prisma.document.create({
      data: {
        corpusId: corpus.id,
        content: '',
        esId: esResult._id,
        wordCount,
        docLength,
        distinctWordCount,
        avgWordLength
      }
    });

    esmap[recordIndex] = esResult._id;
    statsmap[recordIndex] = wordStats;
    idmap[recordIndex] = doc.id;
  }

  const candidateSet = await getTopCorpusTerms({ index, fields, dfMin, dfMax, fieldModes });
  console.log(`Found ${candidateSet.size} candidates for ${index}`);

  for (const record of records) {
    const recordIndex: number = record["recordIndex"];
    const esid: string = esmap[recordIndex];
    const wordStats: WordStats = statsmap[recordIndex];
    const { wordCount, docLength, distinctWordCount, avgWordLength } = wordStats;
    const docId: number = idmap[recordIndex];

    const vector = await esClient.termvectors({
      index,
      id: esid,
      fields,
      term_statistics: true
    });

    for (const field of fields) {
      const fieldTerms = vector.term_vectors?.[field]?.terms;
      const stats = vector.term_vectors?.[field]?.field_statistics;
      if (!fieldTerms || !stats) continue;

      const avgdl = stats.sum_ttf / stats.doc_count;
      const dl = Object.values(fieldTerms).reduce((sum: number, t: any) => sum + (t.term_freq || 0), 0);
      const docCount = stats.doc_count;

      const terms = Object.entries(fieldTerms)
        .filter(([term]) => candidateSet.has(term) && !stopwords.has(term))
        .map(([term, stat]: [string, any]) => {
          const tf = stat.term_freq;
          const df = stat.doc_freq;
          const idf = Math.log(1 + ((docCount - df + 0.5) / (df + 0.5)));
          const norm = tf && avgdl ? (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * (dl / avgdl))) : 0;
          const bm25 = idf * norm;
          const termLength = term.length;
          const termLengthRatio = avgWordLength > 0 ? termLength / avgWordLength : 1;
          const adjbm25 = bm25 * termLengthRatio;
          return { term, bm25, tf, df, termLength, termLengthRatio, adjbm25 };
        })
        .sort((a, b) => b.adjbm25 - a.adjbm25)
        .slice(0, topN);

      for (const t of terms) {
        await prisma.searchTerm.create({
          data: {
            term: t.term,
            bm25: t.bm25,
            tf: t.tf,
            df: t.df,
            termLength: t.termLength,
            termLengthRatio: t.termLengthRatio,
            adjbm25: t.adjbm25,
            docId: docId
          }
        });
      }
    }
    docCount++;
  }

  console.log(`BM25 term extraction complete for ${docCount} documents.`);
}
