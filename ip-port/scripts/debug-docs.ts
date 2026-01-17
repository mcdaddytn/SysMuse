import * as dotenv from 'dotenv';
dotenv.config();

import { FileWrapperClient } from '../clients/odp-file-wrapper-client.js';

const apiKey = process.env.USPTO_ODP_API_KEY;
const client = new FileWrapperClient({ apiKey: apiKey! });

async function main() {
  const patentNum = '9569605';
  console.log('Testing prosecution check for patent ' + patentNum + '...\n');

  const app = await client.getApplicationByPatentNumber(patentNum);
  if (!app) {
    console.log('Application not found');
    return;
  }

  console.log('Application: ' + app.applicationNumberText);

  // Get documents using the fixed client
  const docs = await client.getDocuments(app.applicationNumberText);
  console.log('Total documents: ' + docs.recordTotalQuantity);
  console.log('Parsed documents: ' + docs.documents.length);

  // Count office actions
  let nonFinal = 0, final = 0, rce = 0, allowance = 0;
  for (const doc of docs.documents) {
    const code = doc.documentCode || '';
    if (code === 'CTNF') nonFinal++;
    else if (code === 'CTFR') final++;
    else if (code === 'RCEX') rce++;
    else if (code === 'N417' || code === 'NOA') allowance++;
  }

  console.log('\nProsecution Summary:');
  console.log('  Non-Final Rejections: ' + nonFinal);
  console.log('  Final Rejections: ' + final);
  console.log('  RCE Requests: ' + rce);
  console.log('  Allowances: ' + allowance);
}

main().catch(console.error);
