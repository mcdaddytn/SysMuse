/**
 * Patent Stopwords Service
 *
 * Provides configurable stopword filtering for term extraction.
 * Loads from config/patent-stopwords.json and provides methods
 * for filtering terms in search and clustering operations.
 */

import * as fs from 'fs';
import * as path from 'path';

interface StopwordsConfig {
  version: string;
  allStopwords: string[];
  preserveTerms: {
    terms: string[];
  };
  categories: Record<string, { terms: string[] }>;
}

let cachedStopwords: Set<string> | null = null;
let cachedPreserveTerms: Set<string> | null = null;

/**
 * Load stopwords from config file
 */
function loadConfig(): StopwordsConfig {
  const configPath = path.join(process.cwd(), 'config/patent-stopwords.json');

  if (!fs.existsSync(configPath)) {
    console.warn('Warning: patent-stopwords.json not found, using defaults');
    return {
      version: '0.0',
      allStopwords: getDefaultStopwords(),
      preserveTerms: { terms: [] },
      categories: {}
    };
  }

  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Default stopwords if config not found
 */
function getDefaultStopwords(): string[] {
  return [
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'them', 'their', 'its', 'my', 'your', 'our', 'his', 'her',
    'which', 'who', 'whom', 'what', 'where', 'when', 'why', 'how',
    'method', 'system', 'device', 'apparatus', 'comprising', 'includes',
    'first', 'second', 'third', 'one', 'two', 'three', 'plurality',
    'portion', 'unit', 'module', 'based', 'associated', 'configured'
  ];
}

/**
 * Get the set of all stopwords (cached)
 */
export function getStopwords(): Set<string> {
  if (cachedStopwords) {
    return cachedStopwords;
  }

  const config = loadConfig();
  cachedStopwords = new Set(config.allStopwords.map(w => w.toLowerCase()));

  // Add English common words as well
  const englishCommon = [
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we',
    'they', 'them', 'their', 'its', 'my', 'your', 'our', 'his', 'her',
    'which', 'who', 'whom', 'what', 'where', 'when', 'why', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than', 'too',
    'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once'
  ];

  for (const word of englishCommon) {
    cachedStopwords.add(word.toLowerCase());
  }

  return cachedStopwords;
}

/**
 * Get the set of preserved terms that should NOT be filtered
 */
export function getPreserveTerms(): Set<string> {
  if (cachedPreserveTerms) {
    return cachedPreserveTerms;
  }

  const config = loadConfig();
  cachedPreserveTerms = new Set(
    (config.preserveTerms?.terms || []).map(w => w.toLowerCase())
  );

  return cachedPreserveTerms;
}

/**
 * Check if a term is a stopword (should be filtered)
 *
 * A term is filtered if:
 * 1. It's in the stopwords list AND
 * 2. It's NOT in the preserve list
 */
export function isStopWord(term: string): boolean {
  const normalizedTerm = term.toLowerCase().trim();

  // Never filter preserved terms
  if (getPreserveTerms().has(normalizedTerm)) {
    return false;
  }

  // Filter if in stopwords
  return getStopwords().has(normalizedTerm);
}

/**
 * Filter an array of terms, removing stopwords
 */
export function filterStopwords(terms: string[]): string[] {
  return terms.filter(term => !isStopWord(term));
}

/**
 * Filter terms from an object (e.g., term -> score map)
 */
export function filterTermScores<T>(
  termScores: Record<string, T>
): Record<string, T> {
  const filtered: Record<string, T> = {};

  for (const [term, score] of Object.entries(termScores)) {
    if (!isStopWord(term)) {
      filtered[term] = score;
    }
  }

  return filtered;
}

/**
 * Get stopwords by category
 */
export function getStopwordsByCategory(category: string): string[] {
  const config = loadConfig();
  return config.categories[category]?.terms || [];
}

/**
 * Get all available categories
 */
export function getCategories(): string[] {
  const config = loadConfig();
  return Object.keys(config.categories);
}

/**
 * Clear cached data (useful for testing or config reload)
 */
export function clearCache(): void {
  cachedStopwords = null;
  cachedPreserveTerms = null;
}

/**
 * Get stats about the current stopwords configuration
 */
export function getStats(): {
  totalStopwords: number;
  totalPreserved: number;
  categories: Record<string, number>;
} {
  const config = loadConfig();
  const categories: Record<string, number> = {};

  for (const [name, cat] of Object.entries(config.categories)) {
    categories[name] = cat.terms.length;
  }

  return {
    totalStopwords: config.allStopwords.length,
    totalPreserved: config.preserveTerms?.terms?.length || 0,
    categories
  };
}

// CLI test if run directly
if (process.argv[1]?.includes('stopwords-service')) {
  const stats = getStats();
  console.log('Stopwords Service Statistics:');
  console.log(`  Total stopwords: ${stats.totalStopwords}`);
  console.log(`  Preserved terms: ${stats.totalPreserved}`);
  console.log(`  Categories:`);
  for (const [cat, count] of Object.entries(stats.categories)) {
    console.log(`    - ${cat}: ${count} terms`);
  }

  console.log('\nTest isStopWord():');
  const testTerms = ['method', 'video', 'comprising', 'encryption', 'apparatus', 'baw'];
  for (const term of testTerms) {
    console.log(`  "${term}" -> ${isStopWord(term) ? 'FILTERED' : 'KEPT'}`);
  }
}
