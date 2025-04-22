// === src/cli/importCorpus.ts ===
import { PrismaClient } from '@prisma/client';
import { esClient } from '../lib/es';
import { loadConfig } from '../lib/config';
import { getAllStopwords } from '../setup/importStopwords';
import dotenv from 'dotenv';
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

  const { body: docs } = await esClient.search({
    index: config.index,
    size: 10000,
    query: { match_all: {} },
    _source: ['message', 'transcript']
  });

  for (const hit of docs.hits.hits) {
    const esId = hit._id;
    const content = hit._source.message || hit._source.transcript;

    const doc = await prisma.document.create({
      data: { corpusId: corpus.id, content, esId }
    });

    const vector = await esClient.termvectors({
      index: config.index,
      id: esId,
      fields: ['message', 'transcript'],
      term_statistics: true
    });

    const field = vector.body.term_vectors.message || vector.body.term_vectors.transcript;
    const terms = field.terms;
    const stats = field.field_statistics;

    const avgdl = stats.sum_ttf / stats.doc_count;
    const dl = Object.values(terms).reduce((sum: number, t: any) => sum + t.term_freq, 0);
    const docCount = stats.doc_count;

    for (const [term, stat] of Object.entries(terms)) {
      if (stopwords.has(term)) continue;

      const tf = stat.term_freq;
      const df = stat.doc_freq;
      const idf = Math.log(1 + ((docCount - df + 0.5) / (df + 0.5)));
      const norm = (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * (dl / avgdl)));
      const bm25 = idf * norm;

      await prisma.searchTerm.create({
        data: { term, bm25, tf, df, docId: doc.id }
      });
    }
  }

  console.log("BM25 term extraction complete");
}
