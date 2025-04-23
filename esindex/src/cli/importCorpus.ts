// === Project: BM25 Corpus Analyzer ===
// Full file: src/cli/importCorpus.ts � type-safe with Elasticsearch client

import { PrismaClient } from '@prisma/client';
import { esClient } from '../lib/es';
import { loadConfig } from '../lib/config';
import { getTopCorpusTerms } from '../lib/getTopCorpusTerms';
import { getAllStopwords } from '../setup/importStopwords';
//import { StopwordCache } from '../lib/stopwords';
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

function analyzeTextStats(text: string) {
  //const words = text.match(/\b\w+\b/g) || [];
  const words: string[] = text.match(/\b\w+\b/g) || [];
  const wordCount = words.length;
  const docLength = text.length;
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  const distinctWordCount = uniqueWords.size;
  const avgWordLength = wordCount > 0 ? words.reduce((sum, w) => sum + w.length, 0) / wordCount : 0;

  return { docLength, wordCount, distinctWordCount, avgWordLength };
}


export async function importCorpus(configPath: string) {
  const config = loadConfig(configPath);
  console.log(`importCorpus config.corpus ${config.corpus}`);
  console.log(`importCorpus config`, config);

  const dfMin = config.dfMin ?? 2;
  const dfMax = config.dfMax ?? 100;
  const topN = config.topN ?? 5;

  const fields = config.fields || ['transcript'];
  const fieldModes = config.fieldModes || {};

  const candidateSet = await getTopCorpusTerms({
    index: config.index,
    fields,
    dfMin,
    dfMax,
    fieldModes
  });

  console.log(`Found ${candidateSet.size} candidates for ${config.index}`);

  const corpus = await prisma.corpus.upsert({
    where: { name: config.corpus },
    update: {},
    create: { name: config.corpus }
  });

  const { hits } = await esClient.search({
    index: config.index,
    size: 10000,
    query: { match_all: {} },
    _source: fields
  }).then(r => r.hits);

  console.log(`Found ${hits.length} documents in ${config.index}`);
  // llm seems to have added stuff we do not have 
  //const stopwords = await StopwordCache.load();
  const stopwords = await getAllStopwords();

  for (const hit of hits) {
    const esId = hit._id;

    // gm tweak
    //const content = hit._source.transcript || hit._source.title || '';
    const hitSource: any = hit._source;
    const content = hitSource.transcript || hitSource.title || '';

    if (!content) continue;
    console.log(`Indexing doc ${esId}: ${content?.substring(0, 60)}...`);

    const { wordCount, docLength, distinctWordCount, avgWordLength } = analyzeTextStats(content);

    const doc = await prisma.document.create({
      data: {
        corpusId: corpus.id,
        content: '',
        esId,
        wordCount,
        docLength,
        distinctWordCount,
        avgWordLength
      }
    });

    const vector = await esClient.termvectors({
      index: config.index,
      id: esId,
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
            docId: doc.id
          }
        });
      }
    }
  }

  console.log(`BM25 term extraction complete`);
}

// gm, tbd: remove
export async function importCorpus_Old(configPath: string) {
  const config = loadConfig(configPath);
  //console.log(`importCorpus config.corpus ${config.corpus}`);
  //const configText = JSON.stringify(config);
  //console.log(`importCorpus config ${configText}`);

  const stopwords = await getAllStopwords();
  const corpus = await createCorpus(config.corpus);
  const maxPhraseLength = config.maxPhraseLength || 1; // Default to keywords only
  const dfMin = config.dfMin ?? 5;
  const dfMax = config.dfMax ?? 100;
  const topN = config.topN ?? 5;

  //const candidateSet = await getTopCorpusTerms(config.index, dfMin, dfMax);
  //gm new way
  const fields = config.fields || ['transcript'];
  const fieldModes = config.fieldModes || {};
  const candidateSet = await getTopCorpusTerms({
    index: config.index,
    fields,
    dfMin,
    dfMax,
    fieldModes
  });
  //gm new way end

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
    const content = source.message || source.transcript;
    //let content = source.message || source.transcript;
    if (!content) continue;
    console.log(`Indexing doc ${esId}: ${content?.substring(0, 60)}...`);
    // gm, blanking it for now to save space, why do I need this in mysql ?
    //content = ""

    const stats = analyzeTextStats(content);

    const doc = await prisma.document.create({
      data: {
        corpusId: corpus.id,
        content: '', // no need to persist actual content
        esId,
        docLength: stats.docLength,
        wordCount: stats.wordCount,
        distinctWordCount: stats.distinctWordCount,
        avgWordLength: stats.avgWordLength
      }
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
    const fieldStats = field.field_statistics;
    
    const avgdl: number = fieldStats.sum_ttf && fieldStats.doc_count ? fieldStats.sum_ttf / fieldStats.doc_count : 1;
    const dl = Object.values(terms).reduce((sum: number, t) => sum + (t.term_freq || 0), 0);
    const docCount: number = fieldStats.doc_count || 1;

    const rankedTerms: {
      term: string;
      bm25: number;
      tf: number;
      df: number;
      termLength: number;
      termLengthRatio: number;
      adjbm25: number;
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

      const termLength = term.length;
      const termLengthRatio = stats.avgWordLength > 0 ? termLength / stats.avgWordLength : 1;
      const adjbm25 = bm25 * termLengthRatio; // simplistic weighting

      rankedTerms.push({ term, bm25, tf, df, termLength, termLengthRatio, adjbm25 });
    }

    //rankedTerms.sort((a, b) => b.bm25 - a.bm25);
    rankedTerms.sort((a, b) => b.adjbm25 - a.adjbm25);
    const topTerms = rankedTerms.slice(0, topN);

    for (const termEntry of topTerms) {
      await prisma.searchTerm.create({
        data: {
          term: termEntry.term,
          bm25: termEntry.bm25,
          tf: termEntry.tf,
          df: termEntry.df,
          termLength: termEntry.termLength,
          termLengthRatio: termEntry.termLengthRatio,
          adjbm25: termEntry.adjbm25,
          docId: doc.id
        }
      });
    }
  }

  console.log("BM25 term extraction complete");
}
