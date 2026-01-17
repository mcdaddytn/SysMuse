/**
 * Test IPR API with known patents that have IPR history
 */

import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.USPTO_ODP_API_KEY;

async function testIPR(patentNumber: string) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing IPR lookup for patent: ${patentNumber}`);
  console.log('='.repeat(50));

  const url = 'https://api.uspto.gov/api/v1/patent/trials/proceedings/search';
  const body = {
    filters: [
      { name: 'trialMetaData.trialTypeCode', value: 'IPR' },
      { name: 'patentOwnerData.patentNumber', value: patentNumber },
    ],
    pagination: { offset: 0, limit: 100 },
  };

  console.log('Request URL:', url);
  console.log('Request body:', JSON.stringify(body, null, 2));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey!,
    },
    body: JSON.stringify(body),
  });

  console.log(`Response status: ${response.status}`);
  const data = await response.json();

  if (data.results && data.results.length > 0) {
    console.log(`\n✓ FOUND ${data.results.length} IPR proceedings!`);
    for (const trial of data.results.slice(0, 3)) {
      console.log(`  - Trial: ${trial.trialNumber}`);
      console.log(`    Petitioner: ${trial.petitionerPartyName}`);
      console.log(`    Status: ${trial.trialStatusText}`);
    }
  } else {
    console.log('\n✗ No IPR proceedings found');
    console.log('Response:', JSON.stringify(data, null, 2).substring(0, 500));
  }
}

// Also try searching all IPRs to verify API works
async function testAPIWorking() {
  console.log('\n' + '='.repeat(50));
  console.log('Testing PTAB API connectivity - searching recent IPRs');
  console.log('='.repeat(50));

  const url = 'https://api.uspto.gov/api/v1/patent/trials/proceedings/search';
  const body = {
    filters: [
      { name: 'trialMetaData.trialTypeCode', value: 'IPR' },
    ],
    pagination: { offset: 0, limit: 5 },
    sort: [{ name: 'trialMetaData.filingDate', direction: 'desc' }],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey!,
    },
    body: JSON.stringify(body),
  });

  console.log(`Response status: ${response.status}`);
  const data = await response.json();

  if (data.results && data.results.length > 0) {
    console.log(`\n✓ API working - found ${data.totalHits || data.results.length} total IPRs`);
    console.log('\nMost recent IPRs:');
    for (const trial of data.results.slice(0, 5)) {
      console.log(`  - ${trial.trialNumber}: Patent ${trial.patentOwnerData?.patentNumber || 'N/A'}`);
      console.log(`    Filed: ${trial.filingDate}`);
    }
  } else {
    console.log('\n✗ API test failed');
    console.log('Response:', JSON.stringify(data, null, 2));
  }
}

async function main() {
  if (!apiKey) {
    console.error('USPTO_ODP_API_KEY not set');
    process.exit(1);
  }

  // First verify API is working
  await testAPIWorking();

  // Test with patents known to have IPR history
  // These are well-known patents that have been challenged
  const knownIPRPatents = [
    '7844915',   // Apple patent challenged by Samsung
    '6928433',   // Popular patent with multiple IPRs
    '8838949',   // Another heavily challenged patent
    '5946647',   // Qualcomm patent with IPR
  ];

  for (const patent of knownIPRPatents) {
    await testIPR(patent);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Also test one of our portfolio patents
  console.log('\n\nNow testing one of our portfolio patents:');
  await testIPR('8046374');  // From our top 250
}

main().catch(console.error);
