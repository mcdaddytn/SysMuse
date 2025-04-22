// === src/import/importEnron.ts ===
import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import { esClient } from '../lib/es';
import { setupEnronIndex } from '../setup/setupIndices';
import * as dotenv from 'dotenv';
dotenv.config();

const DATA_PATH = process.env.DATA_PATH!;
const EMAILS_CSV = path.join(DATA_PATH, 'emails.csv');

async function importEnronEmails() {
  await setupEnronIndex();
  console.log(`Loading emails from file ${EMAILS_CSV}`);  
  const readStream = fs.createReadStream(EMAILS_CSV).pipe(csv());
  let bulk: any[] = [];
  let count = 0;

  for await (const row of readStream) {
    const doc = {
      file: row.file,
      message: row.message
    };

    bulk.push({ index: { _index: 'enron_emails' } });
    bulk.push(doc);
    count++;

    if (bulk.length >= 1000) {
      await esClient.bulk({ body: bulk });
      bulk = [];
    }
  }

  if (bulk.length > 0) await esClient.bulk({ body: bulk });
  console.log(`Imported ${count} Enron emails`);
}

importEnronEmails().catch(console.error);
