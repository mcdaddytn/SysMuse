// === src/lib/getTopCorpusTerms.ts ===
import { esClient } from './es';

export async function getTopCorpusTerms(index: string, dfMin: number, dfMax: number): Promise<Set<string>> {
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
