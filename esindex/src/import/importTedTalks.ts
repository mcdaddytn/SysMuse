// === src/import/importTedTalks.ts ===
import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import { esClient } from '../lib/es';
import { setupTedIndex, writeCsvSubset } from '../setup/setupIndices';
import * as dotenv from 'dotenv';
dotenv.config();

const DATA_PATH = process.env.DATA_PATH!;
const MAIN_CSV = path.join(DATA_PATH, 'ted_main.csv');
const TRANSCRIPTS_CSV = path.join(DATA_PATH, 'transcripts.csv');

function normalizeUrl(u: string): string {
  return u.trim().toLowerCase();
}

function cleanTags(raw: string): string[] {
  if (!raw) return [];
  try {
    // Replace single quotes with double quotes and wrap in brackets if needed
    const fixed = raw.replace(/'/g, '"');
    return JSON.parse(fixed);
  } catch {
    return [];
  }
}

export async function importTEDTalks(indexName = 'ted_talks', keywordSearch = true, numRecords?: number, outputFileSuffix?: string) {
  await setupTedIndex(indexName, keywordSearch);
  const transcripts: Record<string, string> = {};
  const transcriptRows: any[] = [];

  await new Promise<void>((resolve) => {
    fs.createReadStream(TRANSCRIPTS_CSV)
      .pipe(csv())
      .on('data', row => {
        transcripts[normalizeUrl(row.url)] = row.transcript;
        transcriptRows.push(row);
      })
      .on('end', resolve);
  });

  const readRows: any[] = [];
  const stream = fs.createReadStream(MAIN_CSV).pipe(csv());
  let bulk: any[] = [];
  let count = 0;

  for await (const row of stream) {
    const url = normalizeUrl(row.url);
    if (!url || !transcripts[url]) continue;

    readRows.push(row);
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
    count++;

    if (bulk.length >= 1000) {
      await esClient.bulk({ body: bulk });
      bulk = [];
    }

    if (numRecords && count >= numRecords) break;
  }

  if (bulk.length > 0) await esClient.bulk({ body: bulk });
  console.log(`Imported ${count} TED documents into index ${indexName}`);

  if (outputFileSuffix && count > 0) {
    writeCsvSubset(MAIN_CSV, readRows.slice(0, count), outputFileSuffix);
    writeCsvSubset(TRANSCRIPTS_CSV, transcriptRows.filter(r => readRows.find(doc => normalizeUrl(doc.url) === normalizeUrl(r.url))), outputFileSuffix);
  }
}
