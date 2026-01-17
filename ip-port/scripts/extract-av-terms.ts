/**
 * Avago Audio/Video Term Extraction Script
 *
 * Phase 1 of the Avago A/V Analysis Approach:
 * - Extracts significant terms from Avago A/V patent abstracts
 * - Identifies CPC code distribution
 * - Generates term vectors for technology categorization
 * - Outputs terms for subsequent USPTO API queries
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { isStopWord, getStopwords } from '../services/stopwords-service.js';

dotenv.config();

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'patents';
const OUTPUT_DIR = './output/avago-av';

// A/V-related CPC codes
const AV_CPC_PREFIXES = [
  'H04N',  // Video coding/transmission
  'H04R',  // Audio/acoustics
  'G10L',  // Speech/audio processing
  'G06T',  // Image processing
  'G11B',  // Information storage (video/audio)
  'H04S',  // Stereophonic systems
  'G09G',  // Display control
  'H04H',  // Broadcast communication
];

// A/V-related keywords for additional filtering
const AV_KEYWORDS = [
  'video', 'audio', 'codec', 'streaming', 'display', 'hdmi', 'displayport',
  'pixel', 'frame', 'bitrate', 'media', 'playback', 'encoding', 'decoding',
  'compression', 'decompression', 'multimedia', 'broadcast', 'television',
  'speaker', 'microphone', 'sound', 'acoustic', 'digital signal', 'dsp'
];

interface ESSearchResponse {
  hits: {
    total: { value: number };
    hits: Array<{
      _id: string;
      _source: {
        patent_id: string;
        title: string;
        abstract?: string;
        assignee?: string;
        cpc_codes?: string[];
        grant_date?: string;
        forward_citations?: number;
      };
    }>;
  };
  aggregations?: Record<string, any>;
}

interface TermResult {
  term: string;
  doc_count: number;
  score: number;
}

interface PatentSummary {
  patent_id: string;
  title: string;
  abstract_snippet: string;
  cpc_codes: string[];
  grant_date?: string;
  forward_citations?: number;
}

/**
 * Make a request to ElasticSearch
 */
async function esRequest<T>(path: string, method: string = 'GET', body?: any): Promise<T> {
  const url = `${ES_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ES request failed: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Build Avago A/V patent query combining CPC codes and keywords
 */
function buildAvagoAVQuery(): any {
  // Build CPC prefix conditions
  const cpcConditions = AV_CPC_PREFIXES.map(prefix => ({
    prefix: { cpc_codes: prefix }
  }));

  // Build keyword conditions for title/abstract
  const keywordConditions = AV_KEYWORDS.map(keyword => ({
    multi_match: {
      query: keyword,
      fields: ['title', 'abstract'],
      type: 'phrase_prefix'
    }
  }));

  return {
    bool: {
      must: [
        // Must be Avago patent
        {
          bool: {
            should: [
              { wildcard: { 'assignee.keyword': '*Avago*' } },
              { wildcard: { 'assignee.keyword': '*AVAGO*' } }
            ]
          }
        }
      ],
      should: [
        // Should match A/V CPC codes
        ...cpcConditions,
        // OR should match A/V keywords
        ...keywordConditions
      ],
      minimum_should_match: 1
    }
  };
}

/**
 * Get all Avago A/V patents
 */
async function getAvagoAVPatents(): Promise<PatentSummary[]> {
  console.log('Querying Avago A/V patents...');

  const query = buildAvagoAVQuery();
  const allPatents: PatentSummary[] = [];
  let from = 0;
  const size = 500;

  while (true) {
    const response = await esRequest<ESSearchResponse>(`/${INDEX_NAME}/_search`, 'POST', {
      query,
      size,
      from,
      _source: ['patent_id', 'title', 'abstract', 'cpc_codes', 'grant_date', 'forward_citations']
    });

    const hits = response.hits.hits;
    if (hits.length === 0) break;

    for (const hit of hits) {
      const src = hit._source;
      allPatents.push({
        patent_id: src.patent_id,
        title: src.title,
        abstract_snippet: src.abstract ? src.abstract.substring(0, 300) + '...' : '',
        cpc_codes: src.cpc_codes || [],
        grant_date: src.grant_date,
        forward_citations: src.forward_citations
      });
    }

    console.log(`  Retrieved ${allPatents.length} / ${response.hits.total.value} patents`);

    if (allPatents.length >= response.hits.total.value) break;
    from += size;
  }

  return allPatents;
}

/**
 * Extract significant terms from Avago A/V patent abstracts
 */
async function extractSignificantTerms(): Promise<TermResult[]> {
  console.log('\nExtracting significant terms from abstracts...');

  const query = buildAvagoAVQuery();

  const response = await esRequest<ESSearchResponse>(`/${INDEX_NAME}/_search`, 'POST', {
    query,
    size: 0,
    aggs: {
      significant_abstract_terms: {
        significant_text: {
          field: 'abstract',
          size: 100,
          min_doc_count: 3
        }
      },
      significant_title_terms: {
        significant_text: {
          field: 'title',
          size: 50,
          min_doc_count: 3
        }
      }
    }
  });

  const abstractTerms = response.aggregations?.significant_abstract_terms?.buckets || [];
  const titleTerms = response.aggregations?.significant_title_terms?.buckets || [];

  // Combine and deduplicate
  const termMap = new Map<string, TermResult>();

  for (const bucket of abstractTerms) {
    termMap.set(bucket.key.toLowerCase(), {
      term: bucket.key,
      doc_count: bucket.doc_count,
      score: bucket.score
    });
  }

  for (const bucket of titleTerms) {
    const key = bucket.key.toLowerCase();
    if (termMap.has(key)) {
      // Boost score if in both title and abstract
      const existing = termMap.get(key)!;
      existing.score += bucket.score;
      existing.doc_count = Math.max(existing.doc_count, bucket.doc_count);
    } else {
      termMap.set(key, {
        term: bucket.key,
        doc_count: bucket.doc_count,
        score: bucket.score * 1.5 // Title terms get boost
      });
    }
  }

  // Sort by score
  return Array.from(termMap.values())
    .sort((a, b) => b.score - a.score);
}

/**
 * Get CPC code distribution
 */
async function getCPCDistribution(): Promise<Array<{ cpc: string; count: number }>> {
  console.log('\nAnalyzing CPC code distribution...');

  const query = buildAvagoAVQuery();

  const response = await esRequest<ESSearchResponse>(`/${INDEX_NAME}/_search`, 'POST', {
    query,
    size: 0,
    aggs: {
      cpc_distribution: {
        terms: {
          field: 'cpc_codes',
          size: 100
        }
      }
    }
  });

  const buckets = response.aggregations?.cpc_distribution?.buckets || [];
  return buckets.map((b: any) => ({ cpc: b.key, count: b.doc_count }));
}

/**
 * Generate search queries for USPTO API and product search
 */
function generateSearchQueries(terms: TermResult[]): {
  usptoQueries: string[];
  productSearchQueries: string[];
} {
  // Filter technical terms using shared stopwords service
  const technicalTerms = terms
    .filter(t => !isStopWord(t.term))
    .filter(t => t.term.length > 3)
    .slice(0, 40);

  // USPTO queries - combine related terms
  const usptoQueries = [
    // Codec/compression terms
    `"video codec" OR "audio codec" OR "encoding" OR "decoding"`,
    `"adaptive bitrate" OR "ABR" OR "streaming"`,
    `"HDMI" OR "DisplayPort" OR "video interface"`,
    `"H.264" OR "HEVC" OR "AVC" OR "H.265"`,
    `"DRM" OR "content protection" OR "digital rights"`,
    // Add specific technical terms from extraction
    ...technicalTerms.slice(0, 15).map(t => `"${t.term}"`)
  ];

  // Product search queries - map to commercial terms
  const productSearchQueries = technicalTerms.slice(0, 20).map(t => {
    const term = t.term;
    return [
      `${term} product specification`,
      `${term} chip manufacturer`,
      `${term} implementation`,
      `${term} professional equipment`
    ];
  }).flat();

  return { usptoQueries, productSearchQueries };
}

/**
 * Categorize patents by technology area
 */
function categorizeTechnologyAreas(patents: PatentSummary[]): Map<string, PatentSummary[]> {
  const categories = new Map<string, PatentSummary[]>();

  const categoryRules: Array<{
    name: string;
    keywords: string[];
    cpcPrefixes: string[];
  }> = [
    {
      name: 'Video Codecs & Compression',
      keywords: ['codec', 'encoding', 'decoding', 'compression', 'h.264', 'hevc', 'avc'],
      cpcPrefixes: ['H04N19']
    },
    {
      name: 'Streaming & Adaptive Bitrate',
      keywords: ['streaming', 'bitrate', 'adaptive', 'abr', 'buffer', 'playback'],
      cpcPrefixes: ['H04N21']
    },
    {
      name: 'Display Interfaces (HDMI/DP)',
      keywords: ['hdmi', 'displayport', 'display interface', 'video output', 'pixel'],
      cpcPrefixes: ['H04N5', 'G09G']
    },
    {
      name: 'Audio Processing',
      keywords: ['audio', 'sound', 'speaker', 'acoustic', 'dsp', 'codec'],
      cpcPrefixes: ['H04R', 'G10L', 'H04S']
    },
    {
      name: 'Wireless Media Transport',
      keywords: ['wireless', 'wifi', 'bluetooth', 'wlan', 'wireless display'],
      cpcPrefixes: ['H04W', 'H04B']
    },
    {
      name: 'Storage & Recording',
      keywords: ['storage', 'recording', 'disk', 'memory', 'read', 'write'],
      cpcPrefixes: ['G11B']
    },
    {
      name: 'DRM & Content Protection',
      keywords: ['drm', 'encryption', 'protection', 'rights', 'secure', 'watermark'],
      cpcPrefixes: ['G06F21']
    }
  ];

  for (const patent of patents) {
    const titleLower = patent.title.toLowerCase();
    const abstractLower = (patent.abstract_snippet || '').toLowerCase();
    const text = titleLower + ' ' + abstractLower;

    for (const rule of categoryRules) {
      const keywordMatch = rule.keywords.some(kw => text.includes(kw));
      const cpcMatch = patent.cpc_codes.some(cpc =>
        rule.cpcPrefixes.some(prefix => cpc.startsWith(prefix))
      );

      if (keywordMatch || cpcMatch) {
        if (!categories.has(rule.name)) {
          categories.set(rule.name, []);
        }
        categories.get(rule.name)!.push(patent);
        break; // Only categorize once
      }
    }
  }

  // Uncategorized
  const categorizedIds = new Set(
    Array.from(categories.values()).flat().map(p => p.patent_id)
  );
  const uncategorized = patents.filter(p => !categorizedIds.has(p.patent_id));
  if (uncategorized.length > 0) {
    categories.set('Other A/V Technologies', uncategorized);
  }

  return categories;
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Avago Audio/Video Term Extraction');
  console.log('Phase 1: ElasticSearch Analysis');
  console.log('='.repeat(60));

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Step 1: Get all Avago A/V patents
  const patents = await getAvagoAVPatents();
  console.log(`\nFound ${patents.length} Avago A/V patents`);

  // Step 2: Extract significant terms
  const terms = await extractSignificantTerms();
  console.log(`Extracted ${terms.length} significant terms`);

  // Step 3: Get CPC distribution
  const cpcDistribution = await getCPCDistribution();
  console.log(`Found ${cpcDistribution.length} unique CPC codes`);

  // Step 4: Generate search queries
  const queries = generateSearchQueries(terms);

  // Step 5: Categorize by technology area
  const categories = categorizeTechnologyAreas(patents);

  // Display summary
  console.log('\n' + '='.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(60));

  console.log('\nTop 30 Significant Terms:');
  console.log('-'.repeat(40));
  terms.slice(0, 30).forEach((t, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${t.term.padEnd(25)} (${t.doc_count} docs, score: ${t.score.toFixed(2)})`);
  });

  console.log('\nTop 15 CPC Codes:');
  console.log('-'.repeat(40));
  cpcDistribution.slice(0, 15).forEach((c, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${c.cpc.padEnd(20)} (${c.count} patents)`);
  });

  console.log('\nTechnology Categories:');
  console.log('-'.repeat(40));
  for (const [category, catPatents] of categories) {
    console.log(`${category}: ${catPatents.length} patents`);
  }

  // Save outputs
  const timestamp = new Date().toISOString().split('T')[0];

  // Save terms
  const termsFile = path.join(OUTPUT_DIR, `avago-av-key-terms-${timestamp}.json`);
  fs.writeFileSync(termsFile, JSON.stringify({
    extracted_at: new Date().toISOString(),
    total_patents: patents.length,
    significant_terms: terms,
    cpc_distribution: cpcDistribution
  }, null, 2));
  console.log(`\nSaved terms to: ${termsFile}`);

  // Save patent list
  const patentsFile = path.join(OUTPUT_DIR, `avago-av-patents-${timestamp}.json`);
  fs.writeFileSync(patentsFile, JSON.stringify({
    extracted_at: new Date().toISOString(),
    count: patents.length,
    patents: patents
  }, null, 2));
  console.log(`Saved patent list to: ${patentsFile}`);

  // Save categorized patents
  const categoriesFile = path.join(OUTPUT_DIR, `avago-av-categories-${timestamp}.json`);
  const categoriesObj: Record<string, PatentSummary[]> = {};
  for (const [name, catPatents] of categories) {
    categoriesObj[name] = catPatents;
  }
  fs.writeFileSync(categoriesFile, JSON.stringify({
    extracted_at: new Date().toISOString(),
    categories: categoriesObj
  }, null, 2));
  console.log(`Saved categories to: ${categoriesFile}`);

  // Save search queries
  const queriesFile = path.join(OUTPUT_DIR, `av-search-queries-${timestamp}.json`);
  fs.writeFileSync(queriesFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    uspto_queries: queries.usptoQueries,
    product_search_queries: queries.productSearchQueries.slice(0, 50)
  }, null, 2));
  console.log(`Saved search queries to: ${queriesFile}`);

  console.log('\n' + '='.repeat(60));
  console.log('Phase 1 Complete');
  console.log('Next: Run portfolio clustering (scripts/cluster-av-patents.ts)');
  console.log('='.repeat(60));
}

main().catch(console.error);
