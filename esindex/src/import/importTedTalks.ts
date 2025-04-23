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

function normalizeUrl_New(u: string): string {
  return u?.trim().replace(/\s+$/, '').toLowerCase();
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

// keywordSearch: boolean | Record<string, boolean> = true
// export async function importTEDTalks(indexName = 'ted_talks', keywordSearch = true, numRecords?: number, outputFileSuffix?: string) {
export async function importTEDTalks(indexName = 'ted_talks', keywordSearch: boolean | Record<string, boolean> = true, numRecords?: number, outputFileSuffix?: string) {
  await setupTedIndex(indexName, keywordSearch);
  const transcripts: Record<string, string> = {};
  const transcriptRows: any[] = [];
  const readRows: any[] = [];
  const unmatchedUrls: { mainUrl: string; transUrl: string; lineMain: number; lineTrans?: number }[] = [];
  const maxUrlLen = 1000;

  let transLine = 0;
  await new Promise<void>((resolve) => {
    fs.createReadStream(TRANSCRIPTS_CSV)
      .pipe(csv())
      .on('data', row => {
        transLine++;
        const rowUrl: string = row.url;
        const urlLen = rowUrl.length;

        console.info(`Processing line ${transLine}, urlLen ${urlLen}`);
        if (urlLen < maxUrlLen) {
          const normUrl = normalizeUrl(row.url);
          console.info(`Normalized URL ${row.url} to ${normUrl}`);
          //console.info(`Adding transcript for URL ${normUrl}`);
          transcripts[normUrl] = row.transcript;
          transcriptRows.push({ ...row, line: transLine });  
        }
      })
      .on('end', resolve);
  });

  const stream = fs.createReadStream(MAIN_CSV).pipe(csv({ strict: false }));
  let bulk: any[] = [];
  let count = 0;
  let mainLine: number = 0;
  let skipped = 0;

  for await (const row of stream) {
    mainLine++;
    const rawUrl: string = row.url;
    const urlLen = rawUrl.length;
    const url = normalizeUrl(rawUrl);
    //const urlMismatch: boolean = false;
    //const urlMismatch: boolean = !url || !transcripts[url];
    const urlMismatch: boolean = !url || !transcripts[url] || urlLen >= maxUrlLen;
    
    // if (!url || !transcripts[url]) {
    if (urlMismatch) {
      console.log(`URL mismatch at line ${mainLine}: main CSV url="${rawUrl}" => normalized="${url}"`);
      const match = transcriptRows.find(r => normalizeUrl(r.url) === url);
      if (match) console.log(`Matched in transcripts at line ${match.line}`);
      unmatchedUrls.push({ mainUrl: rawUrl, transUrl: url, lineMain: mainLine });
      skipped++;
      continue;
    }
    else {
      const transcript = transcripts[url];

      if (!transcript) {
        //console.warn(`Skipping: No transcript found for URL ${url}`);
        console.warn(`Skipping: No transcript found for URL ${url}`);
        skipped++;
        continue;
      }  
    }

    readRows.push(row);
    const doc = {
      title: row.title,
      speaker: row.main_speaker,
      tags: cleanTags(row.tags),
      published_date: new Date(parseInt(row.published_date) * 1000).toISOString(),
      transcript: transcripts[url],
      url
    };

    bulk.push({ index: { _index: indexName } });
    bulk.push(doc);
    count++;

    if (bulk.length > 0) {
    //if (bulk.length >= 1000) {
      await esClient.bulk({ body: bulk });
      bulk = [];
      console.log(`Imported ${count} TED documents into index ${indexName}`);
      if (skipped > 0) {
        console.log(`Skipped ${skipped} documents due to missing transcript`);
      }
    } else {
      console.log('No TED documents to import.');
    }
  
    if (numRecords && count >= numRecords) break;
  }

  if (bulk.length > 0) await esClient.bulk({ body: bulk });
  console.log(`Imported ${count} TED documents into index ${indexName}`);

  if (outputFileSuffix && count > 0) {
    writeCsvSubset(MAIN_CSV, readRows.slice(0, count), outputFileSuffix);
    const matchedUrls = new Set(readRows.map(r => normalizeUrl(r.url)));
    const matchedTrans = transcriptRows.filter(r => matchedUrls.has(normalizeUrl(r.url)));
    writeCsvSubset(TRANSCRIPTS_CSV, matchedTrans, outputFileSuffix);
  }

  if (unmatchedUrls.length) {
    console.warn(`${unmatchedUrls.length} unmatched URL(s) found during import.`);
    unmatchedUrls.forEach(e => console.warn(`- main line ${e.lineMain}: ${e.mainUrl}`));
  }
}

export async function importTEDTalks_Old(indexName = 'ted_talks', keywordSearch = true, numRecords?: number, outputFileSuffix?: string) {
  //gm: if do this here, do not need separate step for this
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
      tags: cleanTags(row.tags),
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
