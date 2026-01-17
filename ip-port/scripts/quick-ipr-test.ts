import * as dotenv from 'dotenv';
dotenv.config();

import { PTABClient } from '../clients/odp-ptab-client.js';

const apiKey = process.env.USPTO_ODP_API_KEY;
const client = new PTABClient({ apiKey: apiKey! });

async function main() {
  // First, get a few sample patents WITH IPR history
  console.log('Getting sample patents from actual IPR database...');
  const response = await client.searchTrials({
    filters: [
      { name: 'trialMetaData.trialTypeCode', value: 'IPR' },
    ],
    size: 10,
  });

  console.log('\nPatent numbers from actual IPR records:');
  for (const trial of response.trials) {
    console.log(`  ${trial.trialNumber}: Patent ${trial.respondentPatentNumber}`);
  }

  // Now try to search for one of those patents
  if (response.trials.length > 0) {
    const testPatent = response.trials[0].respondentPatentNumber;
    if (testPatent) {
      console.log(`\nTesting search for ${testPatent}...`);
      const result = await client.searchIPRsByPatent(testPatent);
      console.log(`Found ${result.trials.length} trials for ${testPatent}`);

      // Try without leading zeros if it has them
      const stripped = testPatent.replace(/^0+/, '');
      if (stripped !== testPatent) {
        console.log(`\nTesting search for ${stripped} (stripped zeros)...`);
        const result2 = await client.searchIPRsByPatent(stripped);
        console.log(`Found ${result2.trials.length} trials for ${stripped}`);
      }
    }
  }

  // Test various formats
  const testPatent = '7844915';
  console.log('\n\nTesting formats for 7844915:');

  const formats = [
    testPatent,
    'US' + testPatent,
    testPatent.padStart(8, '0'),
    'US' + testPatent.padStart(8, '0'),
  ];

  for (const format of formats) {
    try {
      const result = await client.searchIPRsByPatent(format);
      console.log(`  ${format}: ${result.trials.length} trials`);
    } catch (err) {
      console.log(`  ${format}: error`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(console.error);
