// === src/cli/importCorpus.ts — Complete implementation with phrase extraction ===
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
  const longFormField: string = config.longFormField;
  const fieldModes = config.fieldModes || {};
  const maxPhraseLength = config.maxPhraseLength || 1;

  const jsonPath = path.join(process.env.IMPORT_DATA_PATH || './import', jsonFile);
  const records = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const corpus = await prisma.corpus.upsert({ where: { name: corpusName }, update: {}, create: { name: corpusName } });
  const stopwords = await StopwordCache.load();
  let docCount = 0;
  const esmap = new Map<number, string>();
  const statsmap = new Map<number, WordStats>();
  const idmap = new Map<number, number>();
  const docTextMap = new Map<number, string>();

  // pass 1 - index documents and collect statistics
  for (const record of records) {
    const contentField = fields.find(f => record[f]);
    const recordTextContent = record[contentField];
    const recordIndex: number = record["recordIndex"];
    
    // Handle longform field content (read from file) or direct content
    const text = longFormField && contentField === longFormField ? 
      fs.readFileSync(path.join(longTextPath, recordTextContent), 'utf8') : 
      recordTextContent;
    
    const wordStats: WordStats = analyzeTextStats(text);

    const esDoc = { ...record };
    esDoc[contentField] = text;

    const esResult = await esClient.index({ index, refresh: true, document: esDoc });
    const esId: string = esResult._id;
    console.log(`Indexed field: ${contentField}, textContent: ${recordTextContent}, esId: ${esId}`);

    const doc = await prisma.document.create({
      data: {
        corpusId: corpus.id,
        content: '',
        esId: esId,
        wordCount: wordStats.wordCount,
        docLength: wordStats.docLength,
        distinctWordCount: wordStats.distinctWordCount,
        avgWordLength: wordStats.avgWordLength
      }
    });

    esmap[recordIndex] = esId;
    statsmap[recordIndex] = wordStats;
    idmap[recordIndex] = doc.id;
    docTextMap[recordIndex] = text;
  }

  // After indexing all documents, now get corpus-wide term candidates
  // This needs to happen AFTER the first pass because it relies on the ES index being populated
  const candidateSet = await getTopCorpusTerms({ 
    index, 
    fields, 
    dfMin, 
    dfMax, 
    fieldModes,
    maxPhraseLength
  });
  console.log(`Found ${candidateSet.size} candidates for ${index} (including phrases up to ${maxPhraseLength} words)`);

  const termSet: Set<string> = new Set<string>();

  // pass 2 - extract terms for each document
  for (const record of records) {
    const recordIndex: number = record["recordIndex"];
    const esid: string = esmap[recordIndex];
    const docId: number = idmap[recordIndex];
    const contentField = fields.find(f => record[f]);
    const fullText = docTextMap[recordIndex] || '';
    
    const allTerms = [];
    
    // Get term vectors for this document
    const vector = await esClient.termvectors({
      index,
      id: esid,
      fields,
      term_statistics: true
    });

    for (const field of fields) {
      const fieldTerms = vector.term_vectors?.[field]?.terms;
      const stats = vector.term_vectors?.[field]?.field_statistics;
      
      if (!fieldTerms || !stats) {
        console.log(`Missing from termvectors fieldTerms ${fieldTerms}, stats ${stats}`);
        continue;
      }

      const avgdl = stats.sum_ttf / stats.doc_count;
      const dl = Object.values(fieldTerms).reduce((sum: number, t: any) => sum + (t.term_freq || 0), 0);
      const docCount = stats.doc_count;

      // Process single-word terms
      const singleTerms = Object.entries(fieldTerms)
        .filter(([term]) => candidateSet.has(term) && !stopwords.has(term))
        .map(([term, stat]: [string, any]) => {
          const tf = stat.term_freq;
          const df = stat.doc_freq;
          const idf = Math.log(1 + ((docCount - df + 0.5) / (df + 0.5)));
          const norm = tf && avgdl ? (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * (dl / avgdl))) : 0;
          const bm25 = idf * norm;
          const termLength = term.length;
          const termLengthRatio = statsmap[recordIndex].avgWordLength > 0 ? 
            termLength / statsmap[recordIndex].avgWordLength : 1;
          const adjbm25 = bm25 * termLengthRatio;
          return { term, bm25, tf, df, termLength, termLengthRatio, adjbm25 };
        });
      
      allTerms.push(...singleTerms);

      // Process multi-word phrases if maxPhraseLength > 1
      if (maxPhraseLength > 1 && fullText) {
        // Only process phrases for text fields, not keyword fields
        const mode = fieldModes[field] || 'token';
        if (mode === 'token' && field === contentField) {
          const phraseTerms = extractDocumentPhrases(
            fullText,
            candidateSet,
            maxPhraseLength,
            fieldTerms,
            docCount,
            avgdl,
            dl,
            statsmap[recordIndex].avgWordLength
          );
          
          allTerms.push(...phraseTerms);
        }
      }
    }
    
    // Sort all terms by score and take top N
    const terms = allTerms
      .sort((a, b) => b.adjbm25 - a.adjbm25)
      .slice(0, topN);
    
    console.log(`Processing document ${recordIndex}: found ${terms.length} terms (incl. phrases)`);

    for (const t of terms) {
      // Avoid duplicates using a hash set
      let termhash: string = `${t.term}.${docId}`;
      if (!termSet.has(termhash)) {
        try {
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
        } catch (err) {
          console.error(`Failed to create term: ${t.term} for doc: ${docId}`, err);
        }
      }
      termSet.add(termhash);
    }
    
    docCount++;
  }

  console.log(`BM25 term extraction complete for ${docCount} documents.`);
}

/**
 * Extract multi-word phrases from document text and score them
 * @param text The full document text
 * @param candidateSet Set of candidate terms/phrases from corpus analysis
 * @param maxPhraseLength Maximum phrase length to consider
 * @param fieldTerms Term vectors for the document's component terms
 * @param docCount Total document count in corpus
 * @param avgdl Average document length
 * @param dl Current document length
 * @param avgWordLength Average word length in document
 */
function extractDocumentPhrases(
  text: string,
  candidateSet: Set<string>,
  maxPhraseLength: number,
  fieldTerms: any,
  docCount: number,
  avgdl: number,
  dl: number,
  avgWordLength: number
): any[] {
  const phraseTerms = [];
  
  // Tokenize document text
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
    .split(/\s+/)              // Split on whitespace
    .filter(token => token.length > 1);  // Filter out single characters
  
  // Build phrase candidates
  for (let length = 2; length <= maxPhraseLength; length++) {
    for (let i = 0; i <= tokens.length - length; i++) {
      const phrase = tokens.slice(i, i + length).join(' ');
      
      // Only process phrases in the candidate set
      if (candidateSet.has(phrase)) {
        // Get component terms and their statistics
        const components = phrase.split(' ');
        const componentStats = components
          .map(term => fieldTerms[term])
          .filter(Boolean); // Filter out undefined stats
        
        // Only proceed if we have stats for all components
        if (componentStats.length === components.length) {
          // Calculate average term frequency and document frequency
          const avgTf = componentStats.reduce((sum, stat) => sum + stat.term_freq, 0) / componentStats.length;
          const avgDf = componentStats.reduce((sum, stat) => sum + stat.doc_freq, 0) / componentStats.length;
          
          // Modify TF for phrases (typically lower than individual terms)
          // Use phrase length as a scaling factor
          const phraseTf = avgTf / Math.sqrt(length);
          
          // Adjust DF for phrases (phrases are typically rarer)
          // Use a boosting factor to compensate
          const phraseDf = avgDf * 0.8;
          
          // Calculate BM25 score
          const idf = Math.log(1 + ((docCount - phraseDf + 0.5) / (phraseDf + 0.5)));
          const norm = phraseTf && avgdl ? 
            (phraseTf * 2.2) / (phraseTf + 1.2 * (1 - 0.75 + 0.75 * (dl / avgdl))) : 0;
          const bm25 = idf * norm;
          
          // Phrase-specific metrics
          const termLength = phrase.length;
          const termLengthRatio = avgWordLength > 0 ? termLength / avgWordLength : 1;
          
          // Boost phrases slightly in scoring
          //const lengthBoost = 1 + (length - 1) * 0.1; // 10% boost per additional word
          //gm, not getting through, lets up the boost
          const lengthBoost = 1 + (length - 1) * 0.5; // 10% boost per additional word
          const adjbm25 = bm25 * termLengthRatio * lengthBoost;
          
          phraseTerms.push({
            term: phrase,
            bm25,
            tf: phraseTf,
            df: phraseDf,
            termLength,
            termLengthRatio,
            adjbm25
          });
        }
      }
    }
  }
  
  return phraseTerms;
}
