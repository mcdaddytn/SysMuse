// === src/lib/getTopCorpusTerms.ts — updated to handle .keyword suffix ===
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
    const fieldName = mode === 'keyword' ? `${field}.keyword` : field;
    console.log(`Running aggregation on field: ${fieldName}, index: ${index}`);

    try {
      const response = await esClient.search({
        index,
        size: 0,
        aggs: {
          candidate_terms: {
            terms: {
              field: fieldName,
              size: 10000,
              min_doc_count: dfMin,
              shard_min_doc_count: dfMin,
              order: { _count: 'desc' }
            }
          }
        }
      });

      const buckets = (response.aggregations as any)?.candidate_terms?.buckets || [];
      //console.log(`Field: ${field}, Mode: ${mode}, Buckets found: ${buckets.length}`);
      console.log(`Field: ${field}, Mode: ${mode}, dfMin: ${dfMin}, Buckets found: ${buckets.length}`);

      for (const bucket of buckets) {
        const { key, doc_count } = bucket;
        if (doc_count >= dfMin && doc_count <= dfMax) {
          candidateTerms.add(key);
        } else {
          console.log(`Skipping bucket '${key}' (doc_count=${doc_count}) outside range [${dfMin}, ${dfMax}]`);
        }
      }
    } catch (err) {
      console.warn(`Failed to aggregate terms for field '${field}': ${err}`);
    }
  }

  console.log(`Collected ${candidateTerms.size} total unique candidate terms across fields: ${fields.join(', ')}`);
  return candidateTerms;
}
