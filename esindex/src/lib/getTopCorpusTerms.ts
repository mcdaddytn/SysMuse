// === src/lib/getTopCorpusTerms.ts — Updated to handle both token and keyword field types ===
import { esClient } from './es';

interface Params {
  index: string;
  fields: string[];
  dfMin: number;
  dfMax: number;
  fieldModes: Record<string, string>; // field => 'keyword' | 'token'
}

export async function getTopCorpusTerms({ index, fields, dfMin, dfMax, fieldModes }: Params): Promise<Set<string>> {
  const candidateTerms = new Set<string>();

  try {
    const countResult = await esClient.count({ index });
    if (countResult.count === 0) {
      console.warn(`Index '${index}' exists but contains 0 documents.`);
      return candidateTerms;
    }
  } catch (err) {
    console.error(`Index '${index}' does not exist or is inaccessible.`);
    return candidateTerms;
  }

  for (const field of fields) {
    const mode = fieldModes[field] || 'token';
    
    try {
      if (mode === 'keyword') {
        await processKeywordField(index, field, dfMin, dfMax, candidateTerms);
      } else {
        await processTokenField(index, field, dfMin, dfMax, candidateTerms);
      }
    } catch (err) {
      console.warn(`Failed to aggregate terms for field '${field}': ${err}`);
    }
  }

  console.log(`Collected ${candidateTerms.size} total unique candidate terms across fields: ${fields.join(', ')}`);
  return candidateTerms;
}

/**
 * Process a token field using standard terms aggregation
 */
async function processTokenField(
  index: string, 
  field: string, 
  dfMin: number, 
  dfMax: number, 
  candidateTerms: Set<string>
): Promise<void> {
  console.log(`Running token aggregation on field: ${field}, index: ${index}`);
  
  const response = await esClient.search({
    index,
    size: 0,
    aggs: {
      candidate_terms: {
        terms: {
          field: field,
          size: 10000,
          min_doc_count: dfMin,
          shard_min_doc_count: dfMin,
          order: { _count: 'desc' }
        }
      }
    }
  });

  const buckets = (response.aggregations as any)?.candidate_terms?.buckets || [];
  console.log(`Field: ${field}, Mode: token, dfMin: ${dfMin}, Buckets found: ${buckets.length}`);

  for (const bucket of buckets) {
    const { key, doc_count } = bucket;
    if (doc_count >= dfMin && doc_count <= dfMax) {
      candidateTerms.add(key);
    }
  }
}

/**
 * Process a keyword field by:
 * 1. First getting distinct keyword values
 * 2. Then tokenizing those values to extract individual words
 */
async function processKeywordField(
  index: string, 
  field: string, 
  dfMin: number, 
  dfMax: number, 
  candidateTerms: Set<string>
): Promise<void> {
  console.log(`Running keyword aggregation on field: ${field}.keyword, index: ${index}`);
  
  // First get all the unique field values (as keywords)
  const response = await esClient.search({
    index,
    size: 0,
    aggs: {
      keyword_values: {
        terms: {
          field: `${field}.keyword`,
          size: 10000, 
          min_doc_count: 1
        }
      }
    }
  });

  const buckets = (response.aggregations as any)?.keyword_values?.buckets || [];
  console.log(`Field: ${field}, Mode: keyword, Full values found: ${buckets.length}`);
  
  // Analyze each keyword value to extract individual terms
  const termFrequency: Record<string, number> = {};
  
  for (const bucket of buckets) {
    const fullText: string = bucket.key;
    const docCount: number = bucket.doc_count;
    
    // Simple tokenization - split by spaces, punctuation, etc.
    const words = fullText.toLowerCase()
      .split(/[\s,.!?;:()\[\]{}'"]+/)
      .filter(word => word.length > 1); // filter out single characters
      
    for (const word of words) {
      termFrequency[word] = (termFrequency[word] || 0) + docCount;
    }
  }
  
  // Apply dfMin and dfMax filters
  for (const [term, count] of Object.entries(termFrequency)) {
    if (count >= dfMin && count <= dfMax) {
      candidateTerms.add(term);
    }
  }
  
  // Alternatively, use Elasticsearch's analyze API for more accurate tokenization
  // This approach uses ES's analysis capabilities for consistent tokenization
  if (buckets.length > 0 && Object.keys(termFrequency).length === 0) {
    console.log("Basic tokenization found no terms, trying analyzer API...");
    await analyzeKeywordValues(index, buckets, dfMin, dfMax, candidateTerms);
  }
  
  console.log(`Extracted ${Object.keys(termFrequency).length} individual terms from field: ${field}`);
}

/**
 * Use Elasticsearch's analyze API to tokenize values
 * This is a fallback method that ensures consistent tokenization with ES
 */
async function analyzeKeywordValues(
  index: string,
  buckets: any[],
  dfMin: number,
  dfMax: number,
  candidateTerms: Set<string>
): Promise<void> {
  const termFrequency: Record<string, number> = {};
  
  for (const bucket of buckets) {
    const fullText: string = bucket.key;
    const docCount: number = bucket.doc_count;
    
    try {
      const analysis = await esClient.indices.analyze({
        index,
        body: {
          analyzer: "standard",
          text: fullText
        }
      });
      
      const tokens = analysis.tokens || [];
      for (const token of tokens) {
        const term = token.token;
        termFrequency[term] = (termFrequency[term] || 0) + docCount;
      }
    } catch (err) {
      console.warn(`Failed to analyze text: ${fullText}`, err);
    }
  }
  
  // Apply dfMin and dfMax filters
  for (const [term, count] of Object.entries(termFrequency)) {
    if (count >= dfMin && count <= dfMax) {
      candidateTerms.add(term);
    }
  }
  
  console.log(`Analyzed ${buckets.length} values, extracted ${Object.keys(termFrequency).length} tokens`);
}
