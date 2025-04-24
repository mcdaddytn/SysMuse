// === src/convert/convertEnron.ts — fixed message/header parsing ===
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const DATA_PATH = process.env.DATA_PATH || './data';
const IMPORT_PATH = process.env.IMPORT_DATA_PATH || './import';
const LONG_PATH = process.env.LONG_TEXT_PATH || './longform';

export async function convertEnronEmails(config: any) {
  //const csvPath = path.join(IMPORT_PATH, config.csv || 'emails.csv');
  const csvPath = path.join(DATA_PATH, config.csv || 'emails.csv');
  const dataset = config.dataset || 'enron_emails';
  const prefix = config.outputFilePrefix || dataset;
  const outJson = path.join(IMPORT_PATH, `${prefix}.json`);
  const maxRecords = config.maxRecords || Infinity;
  const output: any[] = [];

  const raw = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n');
  let count = 0;

  for (let i = 1; i < lines.length && count < maxRecords; i++) {
    const [file, rawMessage] = lines[i].split(/,(?=\"?Message-ID:)/);
    if (!rawMessage) continue;

    const cleaned = rawMessage.replace(/^\"|\"$/g, '').replace(/\\n/g, '\n');
    const sections = cleaned.split(/\n\s*\n/); // split into headers and body
    if (sections.length < 2) continue;

    const headers = sections[0].split('\n');
    const messageBody = sections.slice(1).join('\n').trim();

    const parts: Record<string, string> = {};
    for (const line of headers) {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const key = line.slice(0, idx).trim().replace(/\W+/g, '_');
        const val = line.slice(idx + 1).trim();
        parts[key] = val;
      }
    }

    const recordIndex = count + 1;
    const filename = `${prefix}_${recordIndex}.txt`;
    fs.writeFileSync(path.join(LONG_PATH, filename), messageBody, 'utf8');

    const doc = { recordIndex, message: filename, ...parts };
    output.push(doc);
    count++;
  }

  fs.writeFileSync(outJson, JSON.stringify(output, null, 2));
  console.log(`Converted ${count} Enron emails to ${outJson}`);
}
