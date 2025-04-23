// === src/lib/getTopCorpusTerms.ts ===
import { esClient } from './es';

interface TermOptions {
  index: string;
  fields: string[]; // e.g., ['transcript', 'title']
  dfMin: number;
  dfMax: number;
  fieldModes?: Record<string, 'token' | 'keyword'>; // optional override
}

export async function getTopCorpusTerms(options: TermOptions): Promise<Set<string>> {
  const { index, fields, dfMin, dfMax, fieldModes = {} } = options;
  const allTerms = new Set<string>();

  for (const field of fields) {
    const mode = fieldModes[field] || 'token';
    const aggField = mode === 'keyword' ? `${field}.keyword` : field;

    try {
      const response = await esClient.search({
        index,
        size: 0,
        aggs: {
          candidate_terms: {
            terms: {
              field: aggField,
              size: 1000,
              min_doc_count: dfMin,
              shard_min_doc_count: dfMin,
              order: { _count: 'desc' }
            }
          }
        }
      });

      const buckets = (response.aggregations as any)?.candidate_terms?.buckets || [];
      console.log(`Field: ${field}, Mode: ${mode}, Buckets found: ${buckets.length}`);

      for (const bucket of buckets) {
        const term = bucket.key;
        const docCount = bucket.doc_count;
        if (docCount <= dfMax) allTerms.add(term);
      }
    } catch (err) {
      console.warn(`Failed to aggregate terms for field '${field}':`, err);
    }
  }

  console.log(`Collected ${allTerms.size} total unique candidate terms across fields: ${fields.join(', ')}`);
  return allTerms;
}

// gm, tbd: remove
export async function getTopCorpusTerms_Old(index: string, dfMin: number, dfMax: number): Promise<Set<string>> {
  const response = await esClient.search({
    index,
    size: 0,
    aggs: {
      candidate_terms: {
        terms: {
          field: 'transcript',
          size: 1000,
          min_doc_count: dfMin,
          shard_min_doc_count: dfMin,
          order: { _count: 'desc' }
        }
      }
    }
  });

  //const responseString = JSON.stringify(response)
  const responseString = JSON.stringify(response).substring(0, 500)
  console.log(`getTopCorpusTerms: responseString ${responseString}`);

  //const buckets = response.aggregations?.candidate_terms?.buckets || [];
  const buckets = (response.aggregations?.candidate_terms as any)?.buckets || [];
  console.log(`Pre-filtered buckets.size: ${buckets.size}`);
  
  const terms = new Set<string>();
  for (const bucket of buckets) {
    const term = bucket.key;
    const docCount = bucket.doc_count;
    console.log(`bucket.key: ${term}, bucket.doc_count: ${docCount}`);
    if (docCount <= dfMax) terms.add(term);
  }

  console.log(`Pre-filtered ${terms.size} candidate terms with df [${dfMin}, ${dfMax}]`);
  return terms;
}
