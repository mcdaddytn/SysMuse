// === src/setup/setupIndices.ts — driven by indexFields.json ===
import { Client } from '@elastic/elasticsearch';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

export const esClient = new Client({ node: process.env.ELASTICSEARCH_URL });

const INDEX_FIELDS_FILE = path.join('config', 'indexFields.json');
const indexFields = JSON.parse(fs.readFileSync(INDEX_FIELDS_FILE, 'utf8'));

export async function setupIndex(indexName: string, dataset: string) {
  const exists = await esClient.indices.exists({ index: indexName });
  if (exists) {
    await esClient.indices.delete({ index: indexName });
    console.log(`${indexName} index deleted`);
  }

  const fieldDefs = indexFields[dataset];
  if (!fieldDefs) throw new Error(`No indexFields defined for dataset: ${dataset}`);

  const mappings: Record<string, any> = {};
  for (const [field, mode] of Object.entries(fieldDefs)) {
    if (mode === 'token') {
      mappings[field] = {
        type: 'text',
        analyzer: 'standard',
        term_vector: 'yes',
        fielddata: true
      };
    } else {
      mappings[field] = {
        type: 'text',
        fields: {
          keyword: {
            type: 'keyword',
            ignore_above: 512
          }
        }
      };
    }
  }

  // Add safe defaults for other metadata fields
  mappings['url'] = { type: 'keyword' };
  mappings['published_date'] = { type: 'date' };
  mappings['tags'] = { type: 'keyword' };
  mappings['speaker'] = { type: 'keyword' };

  const body: Record<string, any> = {
    settings: {
      analysis: {
        analyzer: {
          default: { type: 'standard' }
        }
      }
    },
    mappings: { properties: mappings }
  };

  await esClient.indices.create({ index: indexName, body });
  console.log(`${indexName} index created with fields for dataset '${dataset}'`);
  console.log(JSON.stringify(body, null, 2));
}
