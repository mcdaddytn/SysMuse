/**
 * Citation Overlap Analysis - Avago A/V Patents
 *
 * Runs citation overlap analysis on Avago A/V patents against the updated
 * competitor list (including new RF/acoustic competitors).
 *
 * Usage: npx tsx scripts/citation-overlap-avago-av.ts [start] [end]
 * Example: npx tsx scripts/citation-overlap-avago-av.ts 0 100
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;
const INPUT_DIR = './output/avago-av';
const OUTPUT_DIR = './output/avago-av';

// Load competitor config
const competitorMatcher = new CompetitorMatcher();
console.log(`\n${competitorMatcher.getSummary()}\n`);

interface AvagoPatent {
  patent_id: string;
  title: string;
  abstract_snippet: string;
  cpc_codes: string[];
  grant_date?: string;
  forward_citations?: number;
}

interface CitingPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  competitor_name?: string;
  competitor_category?: string;
}

interface OverlapResult {
  avago_patent_id: string;
  avago_title: string;
  avago_date: string;
  cpc_codes: string[];
  forward_citations: number;
  total_citing_patents: number;
  competitor_citations: number;
  competitor_cites: CitingPatent[];
  competitors_citing: string[];
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5s between requests

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
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

async function findCitingPatents(
  patentId: string
): Promise<{ totalCiting: number; competitorCites: CitingPatent[] }> {
  const competitorCites: CitingPatent[] = [];
  let totalCiting = 0;

  try {
    // Step 1: Find all patents citing this one
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 }
    });

    totalCiting = citationData.total_hits || 0;

    if (!citationData.us_patent_citations || citationData.us_patent_citations.length === 0) {
      return { totalCiting: 0, competitorCites: [] };
    }

    // Get unique citing patent IDs
    const citingIds = [...new Set(citationData.us_patent_citations.map((c: any) => c.patent_id))] as string[];

    if (citingIds.length === 0) {
      return { totalCiting: 0, competitorCites: [] };
    }

    // Step 2: Get details of citing patents in batches
    const batchSize = 50;
    for (let i = 0; i < citingIds.length; i += batchSize) {
      const batch = citingIds.slice(i, i + batchSize);

      const patentData = await rateLimitedFetch('/patent/', 'POST', {
        q: { _or: batch.map(id => ({ patent_id: id })) },
        f: ['patent_id', 'patent_title', 'patent_date', 'assignees.assignee_organization'],
        o: { size: batchSize }
      });

      if (patentData.patents) {
        for (const patent of patentData.patents) {
          const assignees = patent.assignees || [];
          for (const assignee of assignees) {
            const org = assignee.assignee_organization;
            if (!org) continue;

            const match = competitorMatcher.matchCompetitor(org);
            if (match) {
              competitorCites.push({
                patent_id: patent.patent_id,
                patent_title: patent.patent_title,
                patent_date: patent.patent_date,
                assignee: org,
                competitor_name: match.company,
                competitor_category: match.category,
              });
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`  Error for patent ${patentId}: ${error}`);
  }

  return { totalCiting, competitorCites };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Citation Overlap Analysis - Avago A/V Patents');
  console.log('='.repeat(60));

  if (!apiKey) {
    console.error('PATENTSVIEW_API_KEY not found');
    process.exit(1);
  }

  // Load Avago A/V patents
  const patentFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => f.startsWith('avago-av-patents-'))
    .sort()
    .reverse();

  if (patentFiles.length === 0) {
    console.error('No Avago A/V patent file found. Run extract-av-terms.ts first.');
    process.exit(1);
  }

  const patentPath = path.join(INPUT_DIR, patentFiles[0]);
  console.log(`Loading patents from: ${patentPath}`);

  const patentData = JSON.parse(fs.readFileSync(patentPath, 'utf-8'));
  const allPatents: AvagoPatent[] = patentData.patents;

  // Parse command line args for range
  const args = process.argv.slice(2);
  const start = args[0] ? parseInt(args[0]) : 0;
  const end = args[1] ? parseInt(args[1]) : Math.min(start + 100, allPatents.length);

  const patents = allPatents.slice(start, end);
  console.log(`Processing patents ${start} to ${end} (${patents.length} patents)`);

  const results: OverlapResult[] = [];
  let patentsWithCompetitorCites = 0;

  for (let i = 0; i < patents.length; i++) {
    const patent = patents[i];
    const progress = `[${i + 1}/${patents.length}]`;

    console.log(`${progress} Analyzing ${patent.patent_id}: ${patent.title.substring(0, 50)}...`);

    const { totalCiting, competitorCites } = await findCitingPatents(patent.patent_id);

    if (competitorCites.length > 0) {
      patentsWithCompetitorCites++;

      // Get unique competitors
      const competitorNames = [...new Set(competitorCites.map(c => c.competitor_name!))];

      results.push({
        avago_patent_id: patent.patent_id,
        avago_title: patent.title,
        avago_date: patent.grant_date || 'unknown',
        cpc_codes: patent.cpc_codes,
        forward_citations: totalCiting,
        total_citing_patents: totalCiting,
        competitor_citations: competitorCites.length,
        competitor_cites: competitorCites,
        competitors_citing: competitorNames,
      });

      console.log(`  -> ${competitorCites.length} competitor citations from: ${competitorNames.join(', ')}`);
    } else {
      console.log(`  -> No competitor citations (${totalCiting} total)`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('ANALYSIS SUMMARY');
  console.log('='.repeat(60));
  console.log(`Patents analyzed: ${patents.length}`);
  console.log(`Patents with competitor citations: ${patentsWithCompetitorCites}`);
  console.log(`Total competitor citations: ${results.reduce((sum, r) => sum + r.competitor_citations, 0)}`);

  // Competitor breakdown
  const competitorCounts = new Map<string, number>();
  for (const result of results) {
    for (const comp of result.competitors_citing) {
      competitorCounts.set(comp, (competitorCounts.get(comp) || 0) + 1);
    }
  }

  console.log('\nCompetitor Citations Breakdown:');
  const sorted = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [comp, count] of sorted.slice(0, 15)) {
    console.log(`  ${comp}: ${count} patents`);
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = path.join(OUTPUT_DIR, `avago-av-citation-overlap-${start}-${end}-${timestamp}.json`);

  fs.writeFileSync(outputFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    range: { start, end },
    patents_analyzed: patents.length,
    patents_with_competitor_citations: patentsWithCompetitorCites,
    total_competitor_citations: results.reduce((sum, r) => sum + r.competitor_citations, 0),
    competitor_breakdown: Object.fromEntries(competitorCounts),
    results: results,
  }, null, 2));

  console.log(`\nSaved results to: ${outputFile}`);

  console.log('\n' + '='.repeat(60));
  console.log('Analysis Complete');
  console.log(`Next batch: npx tsx scripts/citation-overlap-avago-av.ts ${end} ${end + 100}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
