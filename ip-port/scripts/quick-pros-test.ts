import * as dotenv from 'dotenv';
dotenv.config();

import { FileWrapperClient } from '../clients/odp-file-wrapper-client.js';

const apiKey = process.env.USPTO_ODP_API_KEY;
const client = new FileWrapperClient({ apiKey: apiKey! });

async function main() {
  const patents = ['10200706', '9569605', '8046374'];

  for (const pat of patents) {
    console.log('\nSearching for patent ' + pat + '...');
    const app = await client.getApplicationByPatentNumber(pat);
    if (app) {
      console.log('  Application: ' + app.applicationNumberText);
      const title = app.inventionTitle || app.applicationMetaData?.inventionTitle || 'N/A';
      console.log('  Title: ' + String(title).substring(0, 50) + '...');
    } else {
      console.log('  Not found');
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

main().catch(console.error);
