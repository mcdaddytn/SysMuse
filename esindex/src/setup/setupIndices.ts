// === src/setup/setupIndices.ts ===
import { esClient } from '../lib/es';
import fs from 'fs-extra';
import path from 'path';

export function writeCsvSubset(filePath: string, rows: any[], suffix: string) {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  //const fullPath = path.join(path.dirname(filePath), `${base}.${suffix}${ext}`);
  const fullPath = path.join(path.dirname(filePath), `${base}_${suffix}${ext}`);
  const headers = Object.keys(rows[0] || {}).join(',');
  const lines = rows.map(r => Object.values(r).map(v => JSON.stringify(v)).join(',')).join('\n');
  fs.writeFileSync(fullPath, `${headers}\n${lines}`);
  console.log(`Output written to ${fullPath}`);
}

// keywordSearch: boolean | Record<string, boolean> = true
// export async function setupEnronIndex(indexName: string, keywordSearch = true) {
export async function setupEnronIndex(indexName: string, keywordSearch: boolean | Record<string, boolean> = true) {
  const exists = await esClient.indices.exists({ index: indexName });
  if (exists) await esClient.indices.delete({ index: indexName });

  const isMap = (v: any): v is Record<string, boolean> => typeof v === 'object' && v !== null && !Array.isArray(v);

  let useKeyword = false;

  const resolveFieldType = (field: string): any => {
    useKeyword = isMap(keywordSearch)
      ? keywordSearch[field] ?? true
      : keywordSearch;
    console.log(`${indexName} index keywordSearch[${field}]: ${useKeyword}`);
  };

  const body: Record<string, any> = {
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
        message: useKeyword
          ? {
              type: 'text',
              analyzer: 'standard',
              term_vector: 'yes',
              fields: { keyword: { type: 'keyword' } }
            }
          : {
              type: 'text',
              analyzer: 'standard',
              term_vector: 'yes',
              fielddata: true
            }
      }
    }
  };

  await esClient.indices.create({ index: indexName, body });
  console.log(`Enron index recreated with keywordSearch=${keywordSearch}`);
  console.dir(body, { depth: null });
}

export async function setupTedIndex(indexName: string, keywordSearch: boolean | Record<string, boolean> = true) {
  const exists = await esClient.indices.exists({ index: indexName });
  if (exists) {
    await esClient.indices.delete({ index: indexName });
    console.log(`${indexName} index deleted`);
  }

  const isMap = (v: any): v is Record<string, boolean> => typeof v === 'object' && v !== null && !Array.isArray(v);

  const resolveFieldType = (field: string): any => {
    const useKeyword = isMap(keywordSearch)
      ? keywordSearch[field] ?? true
      : keywordSearch;
    console.log(`${indexName} index keywordSearch[${field}]: ${useKeyword}`);

    return useKeyword
      ? {
          type: 'text',
          fields: { keyword: { type: 'keyword', ignore_above: 512 } }
        }
      : {
          type: 'text',
          analyzer: 'standard',
          term_vector: 'yes',
          fielddata: true
        };
  };

  const body: Record<string, any> = {
    settings: {
      analysis: {
        analyzer: {
          default: { type: 'standard' }
        }
      }
    },
    mappings: {
      properties: {
        transcript: resolveFieldType('transcript'),
        title: resolveFieldType('title'),
        description: resolveFieldType('description'),
        speaker: { type: 'keyword' },
        tags: { type: 'keyword' },
        url: { type: 'keyword' },
        published_date: { type: 'date' }
      }
    }
  };

  await esClient.indices.create({ index: indexName, body });
  console.log(`${indexName} index recreated with keywordSearch:`, keywordSearch);
  console.log(JSON.stringify(body, null, 2));
}

// gm, tbd: remove
export async function setupTedIndex_Old(indexName: string, keywordSearch = true) {
  const exists = await esClient.indices.exists({ index: indexName });
  if (exists) await esClient.indices.delete({ index: indexName });

  const body: Record<string, any> = {
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
        transcript: keywordSearch
          ? {
              type: 'text',
              analyzer: 'standard',
              term_vector: 'yes',
              fields: { keyword: { type: 'keyword' } }
            }
          : {
              type: 'text',
              analyzer: 'standard',
              term_vector: 'yes',
              fielddata: true
            }
      }
    }
  };

  await esClient.indices.create({ index: indexName, body });
  console.log(`TED index recreated with keywordSearch=${keywordSearch}`);
  console.dir(body, { depth: null });
}
