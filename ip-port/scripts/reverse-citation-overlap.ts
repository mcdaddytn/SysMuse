/**
 * Reverse Citation Overlap Analysis
 *
 * For a specific competitor, finds their patents that CITE Broadcom patents.
 * This is the reverse of the normal approach - we check competitor -> Broadcom citations.
 *
 * Usage: npx tsx scripts/reverse-citation-overlap.ts <competitor> [start] [end]
 * Example: npx tsx scripts/reverse-citation-overlap.ts Tencent 0 500
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1400;

interface BroadcomPatent {
  patent_id: string;
  patent_title: string;
  assignee: string;
}

interface CitationResult {
  competitor_patent_id: string;
  competitor_patent_title: string;
  competitor_patent_date: string;
  broadcom_patents_cited: {
    patent_id: string;
    patent_title: string;
    assignee: string;
  }[];
}

// Load Broadcom portfolio into a lookup set
async function loadBroadcomPatents(): Promise<Map<string, BroadcomPatent>> {
  console.log('Loading Broadcom portfolio...');
  const data = JSON.parse(
    await fs.readFile('./output/streaming-candidates-2026-01-15.json', 'utf-8')
  );

  const patentMap = new Map<string, BroadcomPatent>();
  const candidates = data.candidates || data;

  for (const c of candidates) {
    if (!patentMap.has(c.patent_id)) {
      patentMap.set(c.patent_id, {
        patent_id: c.patent_id,
        patent_title: c.patent_title,
        assignee: c.assignee
      });
    }
  }

  console.log(`  Loaded ${patentMap.size} unique Broadcom patents`);
  return patentMap;
}

// Load competitor streaming portfolio
async function loadCompetitorPortfolio(competitor: string): Promise<any[]> {
  const lowerName = competitor.toLowerCase();
  const streamingFile = `./output/competitors/${lowerName}-streaming-2026-01-17.json`;

  try {
    const data = JSON.parse(await fs.readFile(streamingFile, 'utf-8'));
    // Handle both array format and {metadata, patents} format
    const patents = data.patents || data;
    console.log(`  Loaded ${patents.length} streaming patents for ${competitor}`);
    return patents;
  } catch (error) {
    console.error(`Failed to load ${streamingFile}`);
    throw error;
  }
}

async function rateLimitedFetch(endpoint: string, method: 'GET' | 'POST', body?: any): Promise<any> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

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

  if (!response.ok) {
    if (response.status === 429) {
      console.log('    Rate limited, waiting 30s...');
      await new Promise(r => setTimeout(r, 30000));
      return rateLimitedFetch(endpoint, method, body);
    }
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

// Get backward citations for a patent (what patents it cites)
async function getBackwardCitations(patentId: string): Promise<string[]> {
  try {
    // Query the us_patent_citation endpoint to find what this patent cites
    const data = await rateLimitedFetch('/patent/us_patent_citation/', 'POST', {
      q: { patent_id: patentId },
      f: ['citation_patent_id'],
      o: { size: 500 }
    });

    if (!data.us_patent_citations || data.us_patent_citations.length === 0) {
      return [];
    }

    return data.us_patent_citations.map((c: any) => c.citation_patent_id);
  } catch (error: any) {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);
  const competitor = args[0];
  const start = parseInt(args[1]) || 0;
  const end = parseInt(args[2]) || 500;

  if (!competitor) {
    console.log('Usage: npx tsx scripts/reverse-citation-overlap.ts <competitor> [start] [end]');
    console.log('Example: npx tsx scripts/reverse-citation-overlap.ts Tencent 0 500');
    process.exit(1);
  }

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`     REVERSE CITATION OVERLAP: ${competitor.toUpperCase()}`);
  console.log(`     Batch: ${start}-${end}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Load Broadcom patents
  const broadcomPatents = await loadBroadcomPatents();

  // Load competitor portfolio
  const competitorPatents = await loadCompetitorPortfolio(competitor);
  const batch = competitorPatents.slice(start, end);

  console.log(`\nAnalyzing ${batch.length} ${competitor} patents (${start}-${end})...\n`);

  const results: CitationResult[] = [];
  let processed = 0;
  let withBroadcomCites = 0;
  let totalBroadcomCites = 0;

  for (const patent of batch) {
    const patentId = patent.patent_id;

    // Get backward citations
    const citedIds = await getBackwardCitations(patentId);

    // Check which cited patents are Broadcom patents
    const broadcomCites: BroadcomPatent[] = [];
    for (const citedId of citedIds) {
      const broadcomPatent = broadcomPatents.get(citedId);
      if (broadcomPatent) {
        broadcomCites.push(broadcomPatent);
      }
    }

    if (broadcomCites.length > 0) {
      withBroadcomCites++;
      totalBroadcomCites += broadcomCites.length;

      results.push({
        competitor_patent_id: patentId,
        competitor_patent_title: patent.patent_title || '',
        competitor_patent_date: patent.patent_date || '',
        broadcom_patents_cited: broadcomCites
      });
    }

    processed++;
    if (processed % 10 === 0 || processed === batch.length) {
      process.stdout.write(
        `\r  Progress: ${processed}/${batch.length} | Found ${withBroadcomCites} patents citing ${totalBroadcomCites} Broadcom patents`
      );
    }
  }

  console.log('\n');

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  ${competitor} patents analyzed: ${batch.length}`);
  console.log(`  ${competitor} patents citing Broadcom: ${withBroadcomCites} (${(withBroadcomCites/batch.length*100).toFixed(1)}%)`);
  console.log(`  Total Broadcom patents cited: ${totalBroadcomCites}`);

  // Aggregate which Broadcom patents are most cited
  const broadcomCiteCounts = new Map<string, { patent: BroadcomPatent; count: number }>();
  for (const result of results) {
    for (const bp of result.broadcom_patents_cited) {
      const existing = broadcomCiteCounts.get(bp.patent_id);
      if (existing) {
        existing.count++;
      } else {
        broadcomCiteCounts.set(bp.patent_id, { patent: bp, count: 1 });
      }
    }
  }

  if (broadcomCiteCounts.size > 0) {
    console.log(`\n  Most Cited Broadcom Patents by ${competitor}:`);
    const sorted = [...broadcomCiteCounts.values()].sort((a, b) => b.count - a.count);
    for (const item of sorted.slice(0, 15)) {
      console.log(`    ${item.patent.patent_id}: ${item.count} citations - ${item.patent.patent_title.substring(0, 50)}...`);
    }
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = `./output/reverse-citation`;
  await fs.mkdir(outputDir, { recursive: true });

  const outputFile = `${outputDir}/${competitor.toLowerCase()}-${start}-${end}-${timestamp}.json`;

  await fs.writeFile(outputFile, JSON.stringify({
    metadata: {
      competitor,
      generatedDate: new Date().toISOString(),
      range: { start, end },
      patentsAnalyzed: batch.length,
      patentsCitingBroadcom: withBroadcomCites,
      totalBroadcomCitations: totalBroadcomCites
    },
    results,
    broadcomPatentCiteCounts: Object.fromEntries(
      [...broadcomCiteCounts.entries()].map(([id, data]) => [id, { ...data.patent, citeCount: data.count }])
    )
  }, null, 2));

  console.log(`\n✓ Results saved to ${outputFile}`);
}

main().catch(console.error);
