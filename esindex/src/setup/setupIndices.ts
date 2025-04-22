// === src/setup/setupIndices.ts ===
import { esClient } from '../lib/es';

export async function setupEnronIndex() {
  const indexName = 'enron_emails';
  const exists = await esClient.indices.exists({ index: indexName });
  if (exists) await esClient.indices.delete({ index: indexName });

  await esClient.indices.create({
    index: indexName,
    body: {
      settings: {
        analysis: {
          analyzer: {
            default: {
              type: 'standard'
            }
          }
        }
      },
      mappings: {
        properties: {
          file: { type: 'keyword' },
          message: {
            type: 'text',
            analyzer: 'standard',
            term_vector: 'yes',
            fielddata: true
          }
//          message: {
//            type: 'text',
//            analyzer: 'standard',
//            term_vector: 'yes',
//            fields: {
//              keyword: { type: 'keyword' }
//            }
//          }
        }
      }
    } as Record<string, any>
  });
  console.log(`Enron index recreated`);
}

export async function setupTedIndex() {
  const indexName = 'ted_talks';
  const exists = await esClient.indices.exists({ index: indexName });
  if (exists) await esClient.indices.delete({ index: indexName });

  await esClient.indices.create({
    index: indexName,
    body: {
      settings: {
        analysis: {
          analyzer: {
            default: {
              type: 'standard'
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
            analyzer: 'standard',
            term_vector: 'yes',
            fielddata: true
          }
//          transcript: {
//            type: 'text',
//            analyzer: 'standard',
//            term_vector: 'yes',
//            fields: {
//              keyword: { type: 'keyword' } 
//            }
//          }
        }
      }
    } as Record<string, any>
  });
  console.log(`TED index recreated`);
}
