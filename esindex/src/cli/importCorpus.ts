// === src/cli/importCorpus.ts — Enhanced with TopSearchTermMode and term boosting ===
import fs from 'fs';
import path from 'path';
import { PrismaClient, TopSearchTermMode, TermSearchType } from '@prisma/client';
import { esClient } from '../lib/es';
import { getTopCorpusTerms } from '../lib/getTopCorpusTerms';
import { loadConfig } from '../lib/config';
import { StopwordCache } from '../lib/stopwords';
import { TermBooster } from '../lib/termBooster';
//import { formatDateForFilename } from '../lib/dateUtils';
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

// Helper function to format date for filenames
//function formatDateForFilename(): string {
//  const now = new Date();
//  const mm = String(now.getMonth() + 1).padStart(2, '0');
//  const dd = String(now.getDate()).padStart(2, '0');
//  const yyyy = now.getFullYear();
//  const hh = String(now.getHours()).padStart(2, '0');
//  const min = String(now.getMinutes()).padStart(2, '0');
//  const ss = String(now.getSeconds()).padStart(2, '0');
//  
//  return `${mm}${dd}${yyyy}_${hh}${min}${ss}`;
//}

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
  const topSearchTermMode = config.topSearchTermMode || 'LITERAL';
  const fields = config.fields || ['transcript'];
  const longFormField: string = config.longFormField;
  const fieldModes = config.fieldModes || {};
  const maxPhraseLength = config.maxPhraseLength || 1;
  const termBoostCategories = config.termBoostCategories || [];

  const jsonPath = path.join(process.env.IMPORT_DATA_PATH || './import', jsonFile);
  const records = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  // Initialize term booster with specified categories
  const termBooster = new TermBooster();
  await termBooster.loadCategories(termBoostCategories);

  // Get or create the corpus
  const corpus = await prisma.corpus.upsert({ 
    where: { name: corpusName }, 
    update: {}, 
    create: { name: corpusName } 
  });
  
  const stopwords = await StopwordCache.load(corpus.id);
  
  let docCount = 0;
  const esmap = new Map<number, string>();
  const statsmap = new Map<number, WordStats>();
  const idmap = new Map<number, number>();
  const docTextMap = new Map<number, string>();
  
  // First calculate total corpus statistics for ratio-based topN
  let totalCorpusWords = 0;
  let totalCorpusDistinctWords = 0;
  const distinctWordsSet = new Set<string>();
  
  if (topSearchTermMode === 'WORDRATIO' || topSearchTermMode === 'DISTINCTRATIO') {
    console.log(`Calculating corpus-wide statistics for ${topSearchTermMode} mode...`);
    
    for (const record of records) {
      const contentField = fields.find(f => record[f]);
      const recordTextContent = record[contentField];
      
      // Handle longform field content or direct content
      const text = longFormField && contentField === longFormField ? 
        fs.readFileSync(path.join(longTextPath, recordTextContent), 'utf8') : 
        recordTextContent;
      
      const stats = analyzeTextStats(text);
      totalCorpusWords += stats.wordCount;
      
      // Add words to distinct word set
      const words = text.match(/\b\w+\b/g) || [];
      words.forEach(w => distinctWordsSet.add(w.toLowerCase()));
    }
    
    totalCorpusDistinctWords = distinctWordsSet.size;
    console.log(`Corpus stats: Total words: ${totalCorpusWords}, Total distinct words: ${totalCorpusDistinctWords}`);
  }

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

  // Find field IDs for each field name
  const fieldIdMap = new Map<string, number>();
  for (const fieldName of fields) {
    // First, find the document types associated with this corpus
    const corpusDocTypes = await prisma.corpusDocumentType.findMany({
      where: {
        corpusType: {
          corpora: {
            some: {
              id: corpus.id
            }
          }
        }
      }
    });
    
    const docTypeIds = corpusDocTypes.map(dt => dt.id);
    
    // Then find fields with the given name in these document types
    if (docTypeIds.length > 0) {
      const field = await prisma.documentTypeField.findFirst({
        where: {
          name: fieldName,
          documentTypeId: {
            in: docTypeIds
          }
        }
      });
      
      if (field) {
        fieldIdMap.set(fieldName, field.id);
        console.log(`Found field ID ${field.id} for field ${fieldName}`);
      } else {
        console.log(`Warning: No field ID found for field ${fieldName}`);
      }
    } else {
      console.log(`Warning: No document types found for corpus ${corpus.name}`);
    }
  }
  
  // pass 2 - extract terms for each document
  for (const record of records) {
    const recordIndex: number = record["recordIndex"];
    const esid: string = esmap[recordIndex];
    const docId: number = idmap[recordIndex];
    const contentField = fields.find(f => record[f]);
    const fullText = docTextMap[recordIndex] || '';
    
    // Calculate dynamic topN based on mode
    let dynamicTopN = topN;
    
    if (topSearchTermMode === 'WORDRATIO' && totalCorpusWords > 0) {
      const docWords = statsmap[recordIndex].wordCount;
      const ratio = docWords / totalCorpusWords;
      dynamicTopN = Math.max(1, Math.round(topN * ratio * records.length));
      console.log(`Document ${recordIndex}: Word ratio ${ratio.toFixed(4)}, dynamic topN = ${dynamicTopN}`);
    } 
    else if (topSearchTermMode === 'DISTINCTRATIO' && totalCorpusDistinctWords > 0) {
      const docDistinctWords = statsmap[recordIndex].distinctWordCount;
      const ratio = docDistinctWords / totalCorpusDistinctWords;
      dynamicTopN = Math.max(1, Math.round(topN * ratio * records.length));
      console.log(`Document ${recordIndex}: Distinct word ratio ${ratio.toFixed(4)}, dynamic topN = ${dynamicTopN}`);
    }
    
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
        // Filter out terms that are only numbers or non-alphanumeric
        .filter(([term]) => {
          // Keep only terms that have at least one alphabetic character
          return /[a-zA-Z]/.test(term) && candidateSet.has(term) && !stopwords.has(term);
        })
        .map(([term, stat]: [string, any]) => {
          const tf = stat.term_freq;
          const df = stat.doc_freq;
          const idf = Math.log(1 + ((docCount - df + 0.5) / (df + 0.5)));
          const norm = tf && avgdl ? (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * (dl / avgdl))) : 0;
          const bm25 = idf * norm;
          const termLength = term.length;
          const termLengthRatio = statsmap[recordIndex].avgWordLength > 0 ? 
            termLength / statsmap[recordIndex].avgWordLength : 1;
          
          // Apply term boost
          const boostFactor = termBooster.getBoostForTerm(term);
          const adjbm25 = bm25 * termLengthRatio * boostFactor;
          
          return { 
            term, 
            bm25, 
            tf, 
            df, 
            termLength, 
            termLengthRatio, 
            adjbm25,
            termType: TermSearchType.KEYWORD,
            fieldName: field,
            boostFactor
          };
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
            statsmap[recordIndex].avgWordLength,
            termBooster
          );
          
          // Add field name to phrase terms
          phraseTerms.forEach(term => {
            term.fieldName = field;
            term.termType = TermSearchType.PHRASE;
          });
          
          allTerms.push(...phraseTerms);
        }
      }
    }
    
    // Sort all terms by score and take top N
    const terms = allTerms
      .sort((a, b) => b.adjbm25 - a.adjbm25)
      .slice(0, dynamicTopN);
    
    console.log(`Processing document ${recordIndex}: found ${terms.length} terms (incl. phrases) using dynamic topN=${dynamicTopN}`);

    for (const t of terms) {
      // Avoid duplicates using a hash set
      let termhash: string = `${t.term}.${docId}`;
      if (!termSet.has(termhash)) {
        try {
          // Get field ID if available
          const fieldId = fieldIdMap.get(t.fieldName);
          
          await prisma.searchTerm.create({
            data: {
              term: t.term,
              bm25: t.bm25,
              tf: t.tf,
              df: t.df,
              termLength: t.termLength,
              termLengthRatio: t.termLengthRatio,
              adjbm25: t.adjbm25,
              termType: t.termType,
              docId: docId,
              fieldId: fieldId || null
            }
          });
          
          if (t.boostFactor !== 1.0) {
            console.log(`Applied boost factor ${t.boostFactor} to term "${t.term}"`);
          }
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
 * @param termBooster Term booster for applying category and term-specific boosts
 */
function extractDocumentPhrases(
  text: string,
  candidateSet: Set<string>,
  maxPhraseLength: number,
  fieldTerms: any,
  docCount: number,
  avgdl: number,
  dl: number,
  avgWordLength: number,
  termBooster: TermBooster
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
      
      // Filter out phrases that are just numbers with no alphabetic characters
      if (!/[a-zA-Z]/.test(phrase)) continue;
      
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
          const lengthBoost = 1 + (length - 1) * 0.5; // 50% boost per additional word
          
          // Apply term boost
          const boostFactor = termBooster.getBoostForTerm(phrase);
          
          const adjbm25 = bm25 * termLengthRatio * lengthBoost * boostFactor;
          
          phraseTerms.push({
            term: phrase,
            bm25,
            tf: phraseTf,
            df: phraseDf,
            termLength,
            termLengthRatio,
            adjbm25,
            boostFactor
          });
        }
      }
    }
  }
  
  return phraseTerms;
}
