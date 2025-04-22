// src/importTedTalks.ts

import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import { Client } from '@elastic/elasticsearch';

const client = new Client({ node: 'http://localhost:9200' });
const indexName = 'ted_talks';
const mainFile = path.join(__dirname, '../data/ted_main.csv');
const transcriptsFile = path.join(__dirname, '../data/transcripts.csv');

async function createIndex() {
  await client.indices.create({
    index: indexName,
    body: tedIndexMapping
  }, { ignore: [400] });
}

async function loadTranscripts(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  return new Promise((resolve) => {
    fs.createReadStream(transcriptsFile)
      .pipe(csv())
      .on('data', row => {
        const url = row.url.trim();
        map[url] = row.transcript;
      })
      .on('end', () => resolve(map));
  });
}

async function importTed() {
  await createIndex();
  const transcripts = await loadTranscripts();

  const stream = fs.createReadStream(mainFile).pipe(csv());
  let bulk: any[] = [];

  for await (const row of stream) {
    const url = row.url?.trim();
    if (!url || !transcripts[url]) continue;

    const doc = {
      title: row.title,
      speaker: row.main_speaker,
      tags: JSON.parse(row.tags || '[]'),
      published_date: new Date(parseInt(row.published_date) * 1000).toISOString(),
      transcript: transcripts[url],
      url
    };

    bulk.push({ index: { _index: indexName } });
    bulk.push(doc);

    if (bulk.length >= 1000) {
      await client.bulk({ body: bulk });
      bulk = [];
    }
  }

  if (bulk.length > 0) await client.bulk({ body: bulk });

  console.log('TED import complete');
}
