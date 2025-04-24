// === src/convert/convertTed.ts — add outputFilePrefix support ===
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import * as dotenv from 'dotenv';
dotenv.config();

const DATA_PATH = process.env.DATA_PATH || './data';
const IMPORT_PATH = process.env.IMPORT_DATA_PATH || './import';
const LONG_PATH = process.env.LONG_TEXT_PATH || './longform';

export async function convertTedTalks(config: any) {
  //const mainPath = path.join(IMPORT_PATH, config.mainCsv || 'ted_main.csv');
  //const transcriptPath = path.join(IMPORT_PATH, config.transcriptCsv || 'transcripts.csv');
  const mainPath = path.join(DATA_PATH, config.mainCsv || 'ted_main.csv');
  const transcriptPath = path.join(DATA_PATH, config.transcriptCsv || 'transcripts.csv');
  const dataset = config.dataset || 'ted_talks';
  const prefix = config.outputFilePrefix || dataset;
  const outJson = path.join(IMPORT_PATH, `${prefix}.json`);
  const maxRecords = config.maxRecords || Infinity;

  const mainData: Record<string, any> = {};
  const transcripts: Record<string, string> = {};

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(mainPath)
      .pipe(csv())
      .on('data', (row) => {
        const url = (row.url || '').trim().replace(/\s|\n/g, '');
        if (url) mainData[url] = row;
      })
      .on('end', resolve)
      .on('error', reject);
  });

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(transcriptPath)
      .pipe(csv())
      .on('data', (row) => {
        const url = (row.url || '').trim().replace(/\s|\n/g, '');
        if (url) transcripts[url] = row.transcript?.trim();
      })
      .on('end', resolve)
      .on('error', reject);
  });

  const output: any[] = [];
  const urls = Object.keys(mainData);
  let count = 0;

  for (let i = 0; i < urls.length && count < maxRecords; i++) {
    const url = urls[i];
    const main = mainData[url];
    const transcript = transcripts[url];
    if (!transcript) continue;

    const recordIndex = count + 1;
    const filename = `${prefix}_${recordIndex}.txt`;
    fs.writeFileSync(path.join(LONG_PATH, filename), transcript, 'utf8');

    output.push({
      recordIndex,
      title: main.name,
      speaker: main.main_speaker,
      tags: main.tags?.split('|') || [],
      published_date: new Date(Number(main.published_date) * 1000).toISOString(),
      url,
      description: main.description,
      transcript: filename
    });

    count++;
  }

  fs.writeFileSync(outJson, JSON.stringify(output, null, 2));
  console.log(`Converted ${count} TED records to ${outJson}`);
}
