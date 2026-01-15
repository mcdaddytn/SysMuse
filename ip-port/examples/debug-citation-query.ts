/**
 * Debug citation query format - using citation endpoint
 */

import * as dotenv from 'dotenv';
dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

async function fetchAPI(endpoint: string, method: 'GET' | 'POST', body?: any) {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': apiKey!,
    },
  };

  if (method === 'POST' && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${PATENTSVIEW_BASE_URL}${endpoint}`, options);

  const text = await response.text();
  console.log('Response status:', response.status);

  try {
    const data = JSON.parse(text);
    return data;
  } catch (e) {
    console.log('Response text (first 500 chars):', text.substring(0, 500));
    throw new Error('Invalid JSON response');
  }
}

async function test() {
  // Test 1: GET request to citation endpoint for a specific patent
  console.log('Test 1: GET /us_patent_citation/{patent_id}/ ...');
  try {
    const data = await fetchAPI('/patent/us_patent_citation/11000000/', 'GET');
    console.log('  Total:', data.total_hits || data.count);
    console.log('  First citation:', JSON.stringify(data.us_patent_citations?.[0], null, 2));
  } catch (e: any) {
    console.log('  Error:', e.message);
  }

  // Test 2: POST to citation endpoint with query for cited patent
  console.log('\nTest 2: POST /patent/us_patent_citation/ with citation_patent_id query...');
  try {
    const data = await fetchAPI('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: '9948663' },
      f: ['patent_id', 'citation_patent_id'],
      o: { size: 10 }
    });
    console.log('  Total hits:', data.total_hits);
    if (data.us_patent_citations) {
      for (const cite of data.us_patent_citations.slice(0, 3)) {
        console.log('  -', cite);
      }
    }
  } catch (e: any) {
    console.log('  Error:', e.message);
  }

  // Test 3: Full workflow test
  console.log('\nTest 3: Find competitors citing a Broadcom patent...');
  try {
    // First find all patents that cite Broadcom patent 9948663
    const citationData = await fetchAPI('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: '9948663' },
      f: ['patent_id'],
      o: { size: 300 }
    });

    console.log('  Found', citationData.total_hits, 'citation records');
    console.log('  Records in response:', citationData.us_patent_citations?.length || 0);

    if (citationData.us_patent_citations && citationData.us_patent_citations.length > 0) {
      // Get unique citing patent IDs
      const citingIds = [...new Set(citationData.us_patent_citations.map((c: any) => c.patent_id))];
      console.log('  Unique citing patents:', citingIds.length);

      // Get assignee info for these patents
      const patentData = await fetchAPI('/patent/', 'POST', {
        q: { _or: citingIds.slice(0, 100).map((id: string) => ({ patent_id: id })) },
        f: ['patent_id', 'patent_title', 'assignees'],
        o: { size: 100 }
      });

      console.log('  Got patent data for', patentData.patents?.length || 0, 'patents');

      // Check for competitors
      const competitors = ['Netflix', 'Google', 'Amazon', 'Apple', 'Disney', 'Roku', 'Comcast', 'Microsoft', 'Meta', 'Alphabet'];
      const competitorMatches: any[] = [];

      for (const patent of patentData.patents || []) {
        const assignee = patent.assignees?.[0]?.assignee_organization || '';
        if (competitors.some(c => assignee.toUpperCase().includes(c.toUpperCase()))) {
          competitorMatches.push({
            patent_id: patent.patent_id,
            assignee,
            title: patent.patent_title?.substring(0, 50)
          });
        }
      }

      console.log('\n  Competitor citations found:', competitorMatches.length);
      for (const match of competitorMatches.slice(0, 10)) {
        console.log(`    ${match.patent_id} - ${match.assignee}`);
        console.log(`      "${match.title}..."`);
      }
    }
  } catch (e: any) {
    console.log('  Error:', e.message);
  }
}

test().catch(console.error);
