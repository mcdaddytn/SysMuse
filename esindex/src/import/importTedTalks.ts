// === src/import/importTedTalks.ts ===
import fs from 'fs-extra';
import path from 'path';
import csv from 'csv-parser';
import { esClient } from '../lib/es';
import { setupTedIndex } from '../setup/setupIndices';
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

async function loadTranscripts(): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  return new Promise((resolve) => {
    fs.createReadStream(TRANSCRIPTS_CSV)
      .pipe(csv())
      .on('data', row => {
        //map[row.url] = row.transcript;
        map[normalizeUrl(row.url)] = row.transcript;
      })
      .on('end', () => resolve(map));
  });
}

async function importTEDTalks() {
  await setupTedIndex();
  console.log(`Loading transcripts from file ${TRANSCRIPTS_CSV}`);  
  const transcripts = await loadTranscripts();
  console.log(`Loading main data from file ${MAIN_CSV}`);  
  
  const readStream = fs.createReadStream(MAIN_CSV).pipe(csv());
  let bulk: any[] = [];
  let count = 0;
  let skippedCount = 0;

  for await (const row of readStream) {
    //const url = row.url?.trim();
    const url = normalizeUrl(row.url);
    if (!url || !transcripts[url]) {
      console.warn(`Skipping unmatched URL: ${url}`);
      skippedCount++;
      continue;
    }
    
    if (!url || !transcripts[url]) continue;

    //console.log(`Row.tags ${row.tags}`);  

    const doc = {
      title: row.title,
      speaker: row.main_speaker,
      //tags: JSON.parse(row.tags || '[]'),
      tags: cleanTags(row.tags),
      published_date: new Date(parseInt(row.published_date) * 1000).toISOString(),
      transcript: transcripts[url],
      url
    };

    bulk.push({ index: { _index: 'ted_talks' } });
    bulk.push(doc);
    count++;

    if (bulk.length >= 1000) {
      await esClient.bulk({ body: bulk });
      bulk = [];
    }
  }

  if (bulk.length > 0) await esClient.bulk({ body: bulk });
  console.log(`Imported ${count} TED documents`);
  console.log(`Skipped ${skippedCount} TED documents`);
}

importTEDTalks().catch(console.error);