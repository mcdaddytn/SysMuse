/**
 * Keyword Extraction Service
 *
 * Extracts significant keywords from patent abstracts for focus area definition.
 * Uses TF-IDF-like scoring to identify distinctive terms.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isStopWord } from '../../services/stopwords-service.js';

export interface KeywordResult {
  term: string;
  frequency: number;      // Count in selected patents
  selectedRatio: number;  // Fraction of selected patents containing term
  corpusRatio: number;    // Fraction of corpus patents containing term
  contrastScore: number;  // How much more common in selected vs corpus
  score: number;          // Combined relevance score
}

export interface ExtractionOptions {
  corpusPatentIds?: string[];  // IDs to compare against (default: all portfolio)
  minFrequency?: number;       // Minimum count to include (default: 2)
  maxTerms?: number;           // Maximum terms to return (default: 50)
  includeNgrams?: boolean;     // Include 2-grams (default: true)
}

interface RawPatent {
  patent_id: string;
  patent_title: string;
  patent_date?: string;
  assignee?: string;
  abstract?: string;
}

interface CandidatesFile {
  metadata: any;
  candidates: RawPatent[];
}

// Token pattern for word extraction
const WORD_PATTERN = /\b[a-z][a-z'-]{2,}\b/gi;

/**
 * Tokenize text into normalized terms
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  const matches = text.toLowerCase().match(WORD_PATTERN) || [];
  return matches
    .map(w => w.replace(/^-|-$/g, ''))  // Trim leading/trailing hyphens
    .filter(w => w.length >= 3)
    .filter(w => !isStopWord(w));
}

/**
 * Extract bigrams from tokens
 */
function extractBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    // Only create bigram if both words are meaningful
    if (tokens[i].length >= 3 && tokens[i + 1].length >= 3) {
      bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }
  return bigrams;
}

/**
 * Get term frequencies for a set of texts
 */
function getTermFrequencies(texts: string[], includeNgrams: boolean): Map<string, { count: number; docs: Set<string> }> {
  const termStats = new Map<string, { count: number; docs: Set<string> }>();

  texts.forEach((text, idx) => {
    const docId = idx.toString();
    const tokens = tokenize(text);
    const allTerms = includeNgrams ? [...tokens, ...extractBigrams(tokens)] : tokens;

    // Count unique terms per document
    const seenInDoc = new Set<string>();

    for (const term of allTerms) {
      if (!seenInDoc.has(term)) {
        seenInDoc.add(term);
        const existing = termStats.get(term) || { count: 0, docs: new Set<string>() };
        existing.count++;
        existing.docs.add(docId);
        termStats.set(term, existing);
      }
    }
  });

  return termStats;
}

/**
 * Load patents from candidates file
 */
function loadAllPatents(): RawPatent[] {
  const outputDir = './output';
  const files = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No candidates file found');
  }

  const filePath = path.join(outputDir, files[0]);
  const data: CandidatesFile = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.candidates;
}

/**
 * Get abstracts for patent IDs from PatentsView cache
 */
async function getAbstracts(patentIds: string[]): Promise<Map<string, string>> {
  const abstracts = new Map<string, string>();

  for (const id of patentIds) {
    // Try to load from PatentsView cache
    const cachePath = `./cache/api/patentsview/single/${id}.json`;
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        if (data.patent_abstract) {
          abstracts.set(id, data.patent_abstract);
        }
      } catch {
        // Skip invalid cache entries
      }
    }
  }

  return abstracts;
}

/**
 * Extract keywords from selected patents, contrasting against corpus
 */
export async function extractKeywords(
  selectedPatentIds: string[],
  options: ExtractionOptions = {}
): Promise<KeywordResult[]> {
  const {
    corpusPatentIds,
    minFrequency = 2,
    maxTerms = 50,
    includeNgrams = true
  } = options;

  // Get abstracts for selected patents
  const selectedAbstracts = await getAbstracts(selectedPatentIds);

  // If no abstracts found, try using titles from portfolio data
  const allPatents = loadAllPatents();
  const patentMap = new Map(allPatents.map(p => [p.patent_id, p]));

  // Collect texts for selected patents
  const selectedTexts: string[] = [];
  for (const id of selectedPatentIds) {
    const abstract = selectedAbstracts.get(id);
    const patent = patentMap.get(id);
    const title = patent?.patent_title || '';

    // Combine title and abstract (abstract has more weight by repetition)
    const text = abstract ? `${title} ${abstract} ${abstract}` : title;
    if (text.trim()) {
      selectedTexts.push(text);
    }
  }

  if (selectedTexts.length === 0) {
    return [];
  }

  // Collect corpus texts for comparison
  let corpusTexts: string[];
  if (corpusPatentIds && corpusPatentIds.length > 0) {
    const corpusAbstracts = await getAbstracts(corpusPatentIds);
    corpusTexts = corpusPatentIds.map(id => {
      const abstract = corpusAbstracts.get(id);
      const patent = patentMap.get(id);
      const title = patent?.patent_title || '';
      return abstract ? `${title} ${abstract}` : title;
    }).filter(t => t.trim());
  } else {
    // Use all portfolio patents as corpus
    corpusTexts = allPatents
      .slice(0, 5000)  // Limit for performance
      .map(p => p.patent_title)
      .filter(t => t?.trim());
  }

  // Calculate term frequencies
  const selectedStats = getTermFrequencies(selectedTexts, includeNgrams);
  const corpusStats = getTermFrequencies(corpusTexts, includeNgrams);

  // Calculate scores for each term
  const results: KeywordResult[] = [];
  const selectedCount = selectedTexts.length;
  const corpusCount = corpusTexts.length;

  for (const [term, stats] of selectedStats) {
    if (stats.count < minFrequency) continue;

    const selectedRatio = stats.docs.size / selectedCount;
    const corpusData = corpusStats.get(term);
    const corpusRatio = corpusData
      ? corpusData.docs.size / corpusCount
      : 0.0001;  // Small value for terms not in corpus

    // Contrast score: how much more common in selected vs corpus
    const contrastScore = selectedRatio / Math.max(corpusRatio, 0.0001);

    // Combined score favoring terms that are:
    // 1. Common in selected patents (frequency)
    // 2. More distinctive vs corpus (contrast)
    // 3. Present in multiple selected patents (coverage)
    const score = Math.log(1 + stats.count) * Math.log(1 + contrastScore) * selectedRatio;

    results.push({
      term,
      frequency: stats.count,
      selectedRatio: Math.round(selectedRatio * 100) / 100,
      corpusRatio: Math.round(corpusRatio * 1000) / 1000,
      contrastScore: Math.round(contrastScore * 10) / 10,
      score: Math.round(score * 1000) / 1000
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Return top terms
  return results.slice(0, maxTerms);
}

/**
 * Quick analyze titles only (no abstract lookup)
 */
export function extractKeywordsFromTitles(
  patentIds: string[],
  options: ExtractionOptions = {}
): KeywordResult[] {
  const {
    minFrequency = 2,
    maxTerms = 50,
    includeNgrams = true
  } = options;

  // Load all patents
  const allPatents = loadAllPatents();
  const patentMap = new Map(allPatents.map(p => [p.patent_id, p]));

  // Collect titles for selected patents
  const selectedTexts = patentIds
    .map(id => patentMap.get(id)?.patent_title || '')
    .filter(t => t.trim());

  if (selectedTexts.length === 0) {
    return [];
  }

  // Use all portfolio titles as corpus
  const corpusTexts = allPatents
    .slice(0, 5000)
    .map(p => p.patent_title)
    .filter(t => t?.trim());

  // Calculate frequencies
  const selectedStats = getTermFrequencies(selectedTexts, includeNgrams);
  const corpusStats = getTermFrequencies(corpusTexts, includeNgrams);

  const selectedCount = selectedTexts.length;
  const corpusCount = corpusTexts.length;

  const results: KeywordResult[] = [];

  for (const [term, stats] of selectedStats) {
    if (stats.count < minFrequency) continue;

    const selectedRatio = stats.docs.size / selectedCount;
    const corpusData = corpusStats.get(term);
    const corpusRatio = corpusData ? corpusData.docs.size / corpusCount : 0.0001;
    const contrastScore = selectedRatio / Math.max(corpusRatio, 0.0001);

    const score = Math.log(1 + stats.count) * Math.log(1 + contrastScore) * selectedRatio;

    results.push({
      term,
      frequency: stats.count,
      selectedRatio: Math.round(selectedRatio * 100) / 100,
      corpusRatio: Math.round(corpusRatio * 1000) / 1000,
      contrastScore: Math.round(contrastScore * 10) / 10,
      score: Math.round(score * 1000) / 1000
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxTerms);
}
