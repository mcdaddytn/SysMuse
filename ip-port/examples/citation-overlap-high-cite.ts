/**
 * Citation Overlap Analysis - High Citation Patents (regardless of term)
 *
 * Analyzes patents sorted purely by forward citations, ignoring remaining term.
 * This captures foundational patents that competitors built on.
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

// Load competitor config from config/competitors.json
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
  forward_citations: number;
  remaining_years: number;
  total_citing_patents: number;
  competitor_citations: number;
  competitor_cites: CitingPatent[];
  citation_overlap_ratio: number; // competitor_cites / total_citing
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
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
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

async function findCitingPatents(patentId: string): Promise<{ totalCiting: number; competitorCites: CitingPatent[] }> {
  const competitorCites: CitingPatent[] = [];
  let totalCiting = 0;

  try {
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 }
    });

    totalCiting = citationData.total_hits || 0;

    if (!citationData.us_patent_citations?.length) return { totalCiting, competitorCites };

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
  } catch (error) {
    // Silent
  }

  return { totalCiting, competitorCites };
}

async function main() {
  const limit = parseInt(process.argv[2]) || 200;

  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`     HIGH-CITATION PATENT ANALYSIS (Top ${limit} by citations)`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Load candidates and sort by forward citations only
  const data = JSON.parse(
    await fs.readFile('./output/streaming-candidates-2026-01-15.json', 'utf-8')
  );
  const allCandidates = data.candidates || data;

  // Sort by forward citations (descending)
  const sortedByCitations = [...allCandidates].sort(
    (a, b) => (b.forward_citations || 0) - (a.forward_citations || 0)
  );

  const candidates = sortedByCitations.slice(0, limit);

  console.log(`Top ${limit} patents by forward citations (ignoring term):`);
  console.log(`  Highest: ${candidates[0]?.forward_citations} citations`);
  console.log(`  Lowest in set: ${candidates[limit-1]?.forward_citations} citations`);

  // Show how many are expired
  const expired = candidates.filter(c => c.remaining_years < 1).length;
  console.log(`  Expired/expiring: ${expired} (${(expired/limit*100).toFixed(0)}%)\n`);

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

    results.push({
      broadcom_patent_id: candidate.patent_id,
      broadcom_title: candidate.patent_title,
      broadcom_assignee: candidate.assignee,
      broadcom_date: candidate.patent_date,
      forward_citations: candidate.forward_citations,
      remaining_years: candidate.remaining_years,
      total_citing_patents: totalCiting,
      competitor_citations: competitorCites.length,
      competitor_cites: competitorCites,
      citation_overlap_ratio: totalCiting > 0 ? competitorCites.length / totalCiting : 0,
    });

    processed++;

    if (processed % 10 === 0 || processed === candidates.length) {
      process.stdout.write(
        `\r  Progress: ${processed}/${limit} | Found ${withCompetitorCites} patents with ${totalCompetitorCites} competitor cites`
      );
    }
  }

  console.log('\n\n');

  // Sort by competitor citations
  results.sort((a, b) => b.competitor_citations - a.competitor_citations);

  // Summary
  const withCites = results.filter(r => r.competitor_citations > 0);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

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
    for (const [name, count] of sorted) {
      console.log(`  ${name}: ${count}`);
    }
  }

  // Top 20 by competitor citations
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('TOP 20 HIGH-CITATION PATENTS BY COMPETITOR OVERLAP');
  console.log('─────────────────────────────────────────────────────────────\n');

  for (const r of withCites.slice(0, 20)) {
    const competitors = [...new Set(r.competitor_cites.map(c => getCompetitorName(c.assignee)))];
    console.log(`${r.broadcom_patent_id} - ${r.competitor_citations} competitor cites`);
    console.log(`  "${r.broadcom_title.substring(0, 60)}..."`);
    console.log(`  Fwd citations: ${r.forward_citations} | Years left: ${r.remaining_years}`);
    console.log(`  Cited by: ${competitors.join(', ')}`);
    console.log('');
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = `./output/high-cite-overlap-${timestamp}.json`;
  await fs.writeFile(outputFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      sortedBy: 'forward_citations',
      totalAnalyzed: results.length,
    },
    results,
  }, null, 2));

  // CSV for easy review
  const csvFile = `./output/high-cite-overlap-${timestamp}.csv`;
  const csvLines = ['Rank,Patent,Title,Date,Fwd Citations,Years Left,Competitor Cites,Competitors'];
  withCites.forEach((r, i) => {
    const competitors = [...new Set(r.competitor_cites.map(c => getCompetitorName(c.assignee)))].join('; ');
    csvLines.push(
      `${i+1},"${r.broadcom_patent_id}","${r.broadcom_title.replace(/"/g, '""')}","${r.broadcom_date}",${r.forward_citations},${r.remaining_years},${r.competitor_citations},"${competitors}"`
    );
  });
  await fs.writeFile(csvFile, csvLines.join('\n'));

  console.log(`\n✓ Results saved:`);
  console.log(`  - ${outputFile}`);
  console.log(`  - ${csvFile}`);
}

main().catch(console.error);
