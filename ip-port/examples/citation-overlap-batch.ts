/**
 * Citation Overlap Analysis - Batch Mode
 *
 * Runs citation overlap analysis on a specific range of candidates.
 * Usage: npx tsx examples/citation-overlap-batch.ts <start> <end>
 * Example: npx tsx examples/citation-overlap-batch.ts 300 600
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

// Load competitor config
const competitorMatcher = new CompetitorMatcher();
console.log(`\n${competitorMatcher.getSummary()}\n`);

interface CitingPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
}

interface OverlapResult {
  broadcom_patent_id: string;
  broadcom_title: string;
  broadcom_assignee: string;
  broadcom_date: string;
  original_score: number;
  forward_citations: number;
  remaining_years: number;
  total_citing_patents: number;
  competitor_citations: number;
  competitor_cites: CitingPatent[];
  enhanced_score: number;
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1400;

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

function isCompetitor(assignee: string): boolean {
  if (!assignee) return false;
  return competitorMatcher.matchCompetitor(assignee) !== null;
}

function getCompetitorName(assignee: string): string {
  if (!assignee) return 'Unknown';
  const match = competitorMatcher.matchCompetitor(assignee);
  return match?.company || assignee;
}

async function findCitingPatents(
  patentId: string
): Promise<{ totalCiting: number; competitorCites: CitingPatent[] }> {
  const competitorCites: CitingPatent[] = [];
  let totalCiting = 0;

  try {
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 }
    });

    totalCiting = citationData.total_hits || 0;

    if (!citationData.us_patent_citations || citationData.us_patent_citations.length === 0) {
      return { totalCiting, competitorCites };
    }

    const citingIds = [...new Set(citationData.us_patent_citations.map((c: any) => c.patent_id))];

    const patentData = await rateLimitedFetch('/patent/', 'POST', {
      q: { _or: citingIds.slice(0, 100).map((id: string) => ({ patent_id: id })) },
      f: ['patent_id', 'patent_title', 'patent_date', 'assignees'],
      o: { size: 100 }
    });

    for (const patent of patentData.patents || []) {
      const assignee = patent.assignees?.[0]?.assignee_organization || '';
      if (isCompetitor(assignee)) {
        competitorCites.push({
          patent_id: patent.patent_id,
          patent_title: patent.patent_title || '',
          patent_date: patent.patent_date || '',
          assignee,
        });
      }
    }
  } catch (error: any) {
    // Silent error handling
  }

  return { totalCiting, competitorCites };
}

async function main() {
  const args = process.argv.slice(2);
  const start = parseInt(args[0]) || 0;
  const end = parseInt(args[1]) || 300;

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`     CITATION OVERLAP ANALYSIS - BATCH ${start}-${end}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Load candidates
  const data = JSON.parse(
    await fs.readFile('./output/streaming-candidates-2026-01-15.json', 'utf-8')
  );
  const allCandidates = data.candidates || data;
  const candidates = allCandidates.slice(start, end);

  console.log(`Analyzing patents ${start} to ${end} (${candidates.length} patents)...\n`);

  const results: OverlapResult[] = [];
  let processed = 0;
  let withCompetitorCites = 0;
  let totalCompetitorCites = 0;

  for (const candidate of candidates) {
    const { totalCiting, competitorCites } = await findCitingPatents(candidate.patent_id);

    if (competitorCites.length > 0) {
      withCompetitorCites++;
      totalCompetitorCites += competitorCites.length;
    }

    const competitorBonus = competitorCites.length * 15;
    const enhancedScore = candidate.score + competitorBonus;

    results.push({
      broadcom_patent_id: candidate.patent_id,
      broadcom_title: candidate.patent_title,
      broadcom_assignee: candidate.assignee,
      broadcom_date: candidate.patent_date,
      original_score: candidate.score,
      forward_citations: candidate.forward_citations,
      remaining_years: candidate.remaining_years,
      total_citing_patents: totalCiting,
      competitor_citations: competitorCites.length,
      competitor_cites: competitorCites,
      enhanced_score: enhancedScore,
    });

    processed++;

    if (processed % 10 === 0 || processed === candidates.length) {
      process.stdout.write(
        `\r  Progress: ${processed}/${candidates.length} | Found ${withCompetitorCites} patents with ${totalCompetitorCites} competitor cites`
      );
    }
  }

  console.log('\n');

  // Sort by enhanced score
  results.sort((a, b) => b.enhanced_score - a.enhanced_score);

  // Summary
  const withCites = results.filter(r => r.competitor_citations > 0);
  console.log('Summary:');
  console.log(`  Patents analyzed: ${results.length}`);
  console.log(`  Patents cited by competitors: ${withCites.length} (${(withCites.length/results.length*100).toFixed(1)}%)`);
  console.log(`  Total competitor citations: ${totalCompetitorCites}`);

  // Competitor breakdown
  const competitorCounts: Map<string, number> = new Map();
  for (const result of results) {
    for (const cite of result.competitor_cites) {
      const name = getCompetitorName(cite.assignee);
      competitorCounts.set(name, (competitorCounts.get(name) || 0) + 1);
    }
  }

  if (competitorCounts.size > 0) {
    console.log('\nCompetitor Breakdown:');
    const sorted = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted.slice(0, 10)) {
      console.log(`  ${name}: ${count}`);
    }
  }

  // Top 10
  console.log('\nTop 10 in this batch:');
  for (const r of withCites.slice(0, 10)) {
    const competitors = [...new Set(r.competitor_cites.map(c => getCompetitorName(c.assignee)))];
    console.log(`  ${r.broadcom_patent_id}: ${r.competitor_citations} competitor cites (${competitors.join(', ')})`);
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = `./output/citation-overlap-${start}-${end}-${timestamp}.json`;
  await fs.writeFile(outputFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      range: { start, end },
      totalAnalyzed: results.length,
    },
    results,
  }, null, 2));

  console.log(`\n✓ Results saved to ${outputFile}`);
}

main().catch(console.error);
