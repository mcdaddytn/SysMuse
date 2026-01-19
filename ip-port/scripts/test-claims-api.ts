import 'dotenv/config';

/**
 * Test the separate claims endpoint in PatentsView API
 * Claims data is at /api/v1/g_claim/ (NOT embedded in /patent/)
 */

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';

interface ClaimRecord {
  patent_id: string;
  claim_sequence: number;
  claim_number: string;
  claim_text: string;
  exemplary: number;
  claim_dependent: string | null;
}

interface ClaimsResponse {
  error: boolean;
  count: number;
  total_hits: number;
  g_claims: ClaimRecord[];
}

async function fetchClaims(patentId: string): Promise<ClaimsResponse> {
  const apiKey = process.env.PATENTSVIEW_API_KEY;
  if (!apiKey) throw new Error('PATENTSVIEW_API_KEY not set');

  const response = await fetch(`${PATENTSVIEW_BASE_URL}/g_claim/`, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: { patent_id: patentId },
      f: ['patent_id', 'claim_sequence', 'claim_number', 'claim_text', 'exemplary', 'claim_dependent'],
      o: { size: 100 }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API Error: ${response.status} - ${text}`);
  }

  return response.json();
}

async function test() {
  console.log('Testing PatentsView Claims Endpoint (/api/v1/g_claim/)...\n');
  console.log('Note: Claims data is in BETA - currently only 2023 data available\n');

  // Test with a 2023 patent (since that's what's available)
  const testPatentIds = ['10000000', '11500000', '11800000'];

  for (const patentId of testPatentIds) {
    console.log(`\n--- Testing patent: ${patentId} ---`);
    try {
      const result = await fetchClaims(patentId);

      console.log(`Total claims found: ${result.total_hits}`);
      console.log(`Claims in response: ${result.count}`);

      if (result.g_claims && result.g_claims.length > 0) {
        const claims = result.g_claims;
        const independentClaims = claims.filter(c => c.claim_dependent === null);
        const dependentClaims = claims.filter(c => c.claim_dependent !== null);
        const totalTextLength = claims.reduce((sum, c) => sum + (c.claim_text?.length || 0), 0);

        console.log(`Independent claims: ${independentClaims.length}`);
        console.log(`Dependent claims: ${dependentClaims.length}`);
        console.log(`Total claims text length: ${totalTextLength} chars`);
        console.log(`Average claim length: ${Math.round(totalTextLength / claims.length)} chars`);

        console.log('\nFirst claim sample:');
        console.log(`  Number: ${claims[0].claim_number}`);
        console.log(`  Dependent on: ${claims[0].claim_dependent || 'N/A (independent)'}`);
        console.log(`  Text preview: ${claims[0].claim_text?.substring(0, 200)}...`);
      } else {
        console.log('No claims data available (patent may not be in 2023 or data not yet backfilled)');
      }
    } catch (e) {
      console.error(`Error for ${patentId}:`, e);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1500));
  }
}

test();
