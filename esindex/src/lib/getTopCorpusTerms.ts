// === src/lib/getTopCorpusTerms.ts — Updated interface with maxPhraseLength ===
import { esClient } from './es';

interface Params {
  index: string;
  fields: string[];
  dfMin: number;
  dfMax: number;
  fieldModes: Record<string, string>; // field => 'keyword' | 'token'
  maxPhraseLength?: number;          // Added parameter for phrase extraction
}

export async function getTopCorpusTerms({ 
  index, 
  fields, 
  dfMin, 
  dfMax, 
  fieldModes,
  maxPhraseLength = 1            // Set default to 1 (single terms only)
}: Params): Promise<Set<string>> {
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
      
      // Extract phrases if maxPhraseLength > 1
      if (maxPhraseLength > 1 && mode === 'token') {
        await extractPhrases(index, field, maxPhraseLength, dfMin, dfMax, candidateTerms);
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
  
  console.log(`Extracted ${Object.keys(termFrequency).length} individual terms from field: ${field}`);
}

/**
 * Extract multi-word phrases using sampling and validation
 */
async function extractPhrases(
  index: string,
  field: string,
  maxPhraseLength: number,
  dfMin: number,
  dfMax: number,
  candidateTerms: Set<string>
): Promise<void> {
  console.log(`Extracting phrases (up to ${maxPhraseLength} words) from field: ${field}`);
  
  // First, get a sample of documents to analyze
  const sampleSize = Math.min(100, await esClient.count({ index }).then(res => res.count));
  const sampleResponse = await esClient.search({
    index,
    size: sampleSize,
    _source: [field]
  });
  
  const docs = sampleResponse.hits.hits;
  if (docs.length === 0) {
    console.log(`No documents found in index: ${index}`);
    return;
  }
  
  // Collect n-grams from the sample documents
  const ngramCounts: Record<string, number> = {};
  
  for (const doc of docs) {
    const text = doc._source[field];
    if (!text || typeof text !== 'string') continue;
    
    // Tokenize the text
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Replace punctuation with spaces
      .split(/\s+/)              // Split on whitespace
      .filter(token => token.length > 1);  // Filter out single characters
    
    // Generate n-grams for each phrase length
    for (let n = 2; n <= maxPhraseLength; n++) {
      for (let i = 0; i <= tokens.length - n; i++) {
        const ngram = tokens.slice(i, i + n).join(' ');
        if (ngram.length > 3) {  // Minimum phrase length
          ngramCounts[ngram] = (ngramCounts[ngram] || 0) + 1;
        }
      }
    }
  }
  
  // Filter n-grams by minimum document frequency within sample
  // This is an approximation based on the sample
  const sampleRatio = sampleSize / (await esClient.count({ index })).count;
  const estimatedDfMin = Math.max(1, Math.floor(dfMin * sampleRatio));
  
  // Convert promising n-grams to query filters
  const phrasesToCheck: string[] = [];
  for (const [phrase, count] of Object.entries(ngramCounts)) {
    if (count >= estimatedDfMin) {
      phrasesToCheck.push(phrase);
    }
  }
  
  console.log(`Found ${phrasesToCheck.length} potential phrases to validate`);
  
  // Check actual document frequency for each phrase
  // Process in batches to avoid overloading Elasticsearch
  const batchSize = 100;
  for (let i = 0; i < phrasesToCheck.length; i += batchSize) {
    const batch = phrasesToCheck.slice(i, i + batchSize);
    await validatePhraseBatch(index, field, batch, dfMin, dfMax, candidateTerms);
  }
}

/**
 * Validate a batch of phrases by checking their actual document frequencies
 */
async function validatePhraseBatch(
  index: string,
  field: string,
  phrases: string[],
  dfMin: number,
  dfMax: number,
  candidateTerms: Set<string>
): Promise<void> {
  if (phrases.length === 0) return;

  // Create a multi-search request
  const msearchBody: any[] = [];
  
  for (const phrase of phrases) {
    // Add header and body for each search
    msearchBody.push(
      // Header
      { index },
      // Body - use match_phrase to count documents containing the exact phrase
      {
        size: 0,
        query: {
          match_phrase: {
            [field]: phrase
          }
        }
      }
    );
  }
  
  try {
    // Execute the multi-search
    const response = await esClient.msearch({ body: msearchBody });
    
    // Process each response
    const responses = response.responses || [];
    for (let i = 0; i < responses.length && i < phrases.length; i++) {
      const phrase = phrases[i];
      const result = responses[i];
      
      // Check if response has error
      if ('error' in result) {
        console.warn(`Error validating phrase "${phrase}": ${JSON.stringify(result.error)}`);
        continue;
      }
      
      // Safe access to total count
      const total = result.hits?.total;
      let docCount = 0;
      
      // Handle both object format and number format for total
      if (typeof total === 'object' && total !== null) {
        docCount = total.value || 0;
      } else if (typeof total === 'number') {
        docCount = total;
      }
      
      if (docCount >= dfMin && docCount <= dfMax) {
        candidateTerms.add(phrase);
        console.log(`Added phrase: "${phrase}" with doc count: ${docCount}`);
      }
    }
  } catch (err) {
    console.error(`Failed to execute msearch for phrase validation: ${err}`);
  }
}
