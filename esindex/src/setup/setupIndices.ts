// === src/setup/setupIndices.ts ===
import { esClient } from '../lib/es';

export async function setupEnronIndex() {
  await esClient.indices.create({
    index: 'enron_emails',
    body: {
      settings: {
        analysis: {
          analyzer: {
            shingle_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'stop', 'shingle']
            }
          },
          filter: {
            shingle: {
              type: 'shingle',
              min_shingle_size: 2,
              max_shingle_size: 3,
              output_unigrams: true
            }
          }
        }
      },
      mappings: {
        properties: {
          file: { type: 'keyword' },
          message: {
            type: 'text',
            analyzer: 'shingle_analyzer',
            term_vector: 'yes'
          }
        }
      }
    }
  }, { ignore: [400] });
}

export async function setupTedIndex() {
  await esClient.indices.create({
    index: 'ted_talks',
    body: {
      settings: {
        analysis: {
          analyzer: {
            shingle_analyzer: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'stop', 'shingle']
            }
          },
          filter: {
            shingle: {
              type: 'shingle',
              min_shingle_size: 2,
              max_shingle_size: 3,
              output_unigrams: true
            }
          }
        }
      },
      mappings: {
        properties: {
          title: { type: 'text' },
          speaker: { type: 'keyword' },
          tags: { type: 'keyword' },
          url: { type: 'keyword' },
          published_date: { type: 'date' },
          transcript: {
            type: 'text',
            analyzer: 'shingle_analyzer',
            term_vector: 'yes'
          }
        }
      }
    }
  }, { ignore: [400] });
}
