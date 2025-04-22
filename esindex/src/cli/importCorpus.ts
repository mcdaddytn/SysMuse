// === Project: BM25 Corpus Analyzer ===
// Full file: src/cli/importCorpus.ts — type-safe with Elasticsearch client

import { PrismaClient } from '@prisma/client';
import { esClient } from '../lib/es';
import { loadConfig } from '../lib/config';
import { getAllStopwords } from '../setup/importStopwords';
import { getTopCorpusTerms } from '../lib/getTopCorpusTerms';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function createCorpus(name: string) {
  return prisma.corpus.upsert({
    where: { name },
    update: {},
    create: { name }
  });
}

export async function importCorpus(configPath: string) {
  const config = loadConfig(configPath);
  const stopwords = await getAllStopwords();
  const corpus = await createCorpus(config.corpus);
  const maxPhraseLength = config.maxPhraseLength || 1; // Default to keywords only
  const dfMin = config.dfMin ?? 5;
  const dfMax = config.dfMax ?? 100;
  const topN = config.topN ?? 5;

  const candidateSet = await getTopCorpusTerms(config.index, dfMin, dfMax);
  console.log(`Found ${candidateSet.size} candidates for ${config.index}`);

  const docs = await esClient.search({
    index: config.index,
    size: 10000,
    query: { match_all: {} },
    _source: ['message', 'transcript']
  });

  console.log(`Found ${docs.hits.hits.length} documents in ${config.index}`);

  for (const hit of docs.hits.hits) {
    const esId = hit._id;
    const source = hit._source as any;
    //const content = source.message || source.transcript;
    let content = source.message || source.transcript;
    if (!content) continue;
    console.log(`Indexing doc ${esId}: ${content?.substring(0, 60)}...`);
    // gm, blanking it for now to save space, why do I need this in mysql ?
    content = ""

    const doc = await prisma.document.create({
      data: { corpusId: corpus.id, content, esId }
      //data: { corpusId: corpus.id, esId }
    });

    const vector: any = await esClient.termvectors({
      index: config.index,
      id: esId,
      fields: ['message', 'transcript'],
      term_statistics: true
    });

    const field = vector.term_vectors?.message || vector.term_vectors?.transcript;
    if (!field) continue;

    const terms: Record<string, any> = field.terms;
    const stats = field.field_statistics;
    
    const avgdl: number = stats.sum_ttf && stats.doc_count ? stats.sum_ttf / stats.doc_count : 1;
    const dl = Object.values(terms).reduce((sum: number, t) => sum + (t.term_freq || 0), 0);
    const docCount: number = stats.doc_count || 1;

    const rankedTerms: {
      term: string;
      bm25: number;
      tf: number;
      df: number;
    }[] = [];

    for (const [term, stat] of Object.entries(terms)) {
      if (!candidateSet.has(term)) continue;
      if (stopwords.has(term)) continue;
      if (maxPhraseLength === 1 && (term.includes('_') || term.includes(' '))) continue;

      const tf: number = stat.term_freq || 0;
      const df: number = stat.doc_freq || 1;

      const idf = Math.log(1 + ((docCount - df + 0.5) / (df + 0.5)));
      const norm = (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * (dl / avgdl)));
      const bm25 = idf * norm;

      rankedTerms.push({ term, bm25, tf, df });
    }

    rankedTerms.sort((a, b) => b.bm25 - a.bm25);
    const topTerms = rankedTerms.slice(0, topN);

    for (const termEntry of topTerms) {
      await prisma.searchTerm.create({
        data: {
          term: termEntry.term,
          bm25: termEntry.bm25,
          tf: termEntry.tf,
          df: termEntry.df,
          docId: doc.id
        }
      });
    }
  }

  console.log("BM25 term extraction complete");
}
