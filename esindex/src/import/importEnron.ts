// === src/import/importEnron.ts ===
import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import { esClient } from '../lib/es';
import { writeCsvSubset, setupEnronIndex } from '../setup/setupIndices';
import * as dotenv from 'dotenv';
dotenv.config();

const DATA_PATH = process.env.DATA_PATH!;
const EMAILS_CSV = path.join(DATA_PATH, 'emails.csv');

export async function importEnronEmails(indexName = 'enron_emails', keywordSearch = true, numRecords?: number, outputFileSuffix?: string) {
  await setupEnronIndex(indexName, keywordSearch);
  const readRows: any[] = [];
  const stream = fs.createReadStream(EMAILS_CSV).pipe(csv());
  let bulk: any[] = [];
  let count = 0;

  for await (const row of stream) {
    const doc = {
      file: row.file,
      message: row.message
    };

    readRows.push(row);
    bulk.push({ index: { _index: indexName } });
    bulk.push(doc);
    count++;

    if (bulk.length >= 1000) {
      await esClient.bulk({ body: bulk });
      bulk = [];
    }

    if (numRecords && count >= numRecords) break;
  }

  if (bulk.length > 0) await esClient.bulk({ body: bulk });
  console.log(`Imported ${count} Enron emails into index ${indexName}`);

  if (outputFileSuffix && count > 0) {
    writeCsvSubset(EMAILS_CSV, readRows.slice(0, count), outputFileSuffix);
  }
}
