// src/importEnron.ts

import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { Client } from '@elastic/elasticsearch';

const client = new Client({ node: 'http://localhost:9200' });
const csvPath = path.join(__dirname, '../data/emails.csv');
const indexName = 'enron_emails';

async function createIndex() {
  await client.indices.create({
    index: indexName,
    body: enronIndexMapping
  }, { ignore: [400] });
}

async function importEnron() {
  await createIndex();

  const stream = fs.createReadStream(csvPath).pipe(csv());
  let bulk: any[] = [];

  for await (const row of stream) {
    bulk.push({ index: { _index: indexName } });
    bulk.push({
      file: row.file,
      message: row.message
    });

    if (bulk.length >= 1000) {
      await client.bulk({ body: bulk });
      bulk = [];
    }
  }

  if (bulk.length > 0) await client.bulk({ body: bulk });

  console.log('Enron import complete');
}
