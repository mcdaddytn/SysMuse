/**
 * Citation Overlap Analysis
 *
 * Finds Broadcom patents that are cited BY competitor patents.
 * This is a strong signal that competitor technology was built on Broadcom's foundation.
 *
 * Strategy:
 * 1. Load top Broadcom candidates from Phase 1
 * 2. For each candidate, query the /patent/us_patent_citation/ endpoint
 * 3. Get assignee info for citing patents
 * 4. Check if any citing patents are from target competitors
 * 5. Aggregate and rank by competitor citation count
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

// Target competitors for streaming video
const COMPETITOR_PATTERNS = [
  'Netflix',
  'Google',
  'YouTube',
  'Alphabet',
  'Amazon',
  'Apple',
  'Disney',
  'Hulu',
  'Roku',
  'Comcast',
  'NBCUniversal',
  'Peacock',
  'Microsoft',
  'Warner',
  'HBO',
  'Paramount',
  'ViacomCBS',
  'Sony',
  'Spotify',
  'Meta',
  'Facebook',
  'TikTok',
  'ByteDance',
];

interface BroadcomCandidate {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
}

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

// Rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1400; // 45 req/min = 1333ms, add buffer

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

async function loadBroadcomCandidates(): Promise<BroadcomCandidate[]> {
  console.log('Loading Broadcom candidates from Phase 1...');

  const data = JSON.parse(
    await fs.readFile('./output/streaming-candidates-2026-01-15.json', 'utf-8')
  );

  const candidates = data.candidates || data;
  console.log(`  ✓ Loaded ${candidates.length.toLocaleString()} candidates\n`);

  return candidates;
}

function isCompetitor(assignee: string): boolean {
  if (!assignee) return false;
  const upper = assignee.toUpperCase();
  return COMPETITOR_PATTERNS.some(p => upper.includes(p.toUpperCase()));
}

function getCompetitorName(assignee: string): string {
  if (!assignee) return 'Unknown';
  const upper = assignee.toUpperCase();
  for (const pattern of COMPETITOR_PATTERNS) {
    if (upper.includes(pattern.toUpperCase())) {
      return pattern;
    }
  }
  return assignee;
}

async function findCitingPatents(
  patentId: string
): Promise<{ totalCiting: number; competitorCites: CitingPatent[] }> {
  const competitorCites: CitingPatent[] = [];
  let totalCiting = 0;

  try {
    // Step 1: Query the citation endpoint to find patents that cite this one
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 }
    });

    totalCiting = citationData.total_hits || 0;

    if (!citationData.us_patent_citations || citationData.us_patent_citations.length === 0) {
      return { totalCiting, competitorCites };
    }

    // Get unique citing patent IDs
    const citingIds = [...new Set(citationData.us_patent_citations.map((c: any) => c.patent_id))];

    // Step 2: Get assignee info for citing patents (batch of up to 100)
    const patentData = await rateLimitedFetch('/patent/', 'POST', {
      q: { _or: citingIds.slice(0, 100).map((id: string) => ({ patent_id: id })) },
      f: ['patent_id', 'patent_title', 'patent_date', 'assignees'],
      o: { size: 100 }
    });

    // Step 3: Filter for competitor patents
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
    // Silently handle errors for individual patents
    if (!error.message?.includes('404')) {
      // console.log(`  Warning: Error checking ${patentId}: ${error.message}`);
    }
  }

  return { totalCiting, competitorCites };
}

async function analyzeOverlap(
  candidates: BroadcomCandidate[],
  limit: number = 500
): Promise<OverlapResult[]> {
  console.log(`Analyzing citation overlap for top ${limit} candidates...`);
  console.log('  (Checking which competitors cite each Broadcom patent)\n');

  const results: OverlapResult[] = [];
  const topCandidates = candidates.slice(0, limit);

  let processed = 0;
  let withCompetitorCites = 0;
  let totalCompetitorCites = 0;

  for (const candidate of topCandidates) {
    const { totalCiting, competitorCites } = await findCitingPatents(candidate.patent_id);

    if (competitorCites.length > 0) {
      withCompetitorCites++;
      totalCompetitorCites += competitorCites.length;
    }

    // Calculate enhanced score with competitor signal
    // Competitor citations are a strong signal - weight heavily
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

    // Progress update every 10 patents
    if (processed % 10 === 0 || processed === limit) {
      process.stdout.write(
        `\r  Progress: ${processed}/${limit} | Found ${withCompetitorCites} patents with ${totalCompetitorCites} competitor cites`
      );
    }
  }

  console.log('\n');

  // Sort by enhanced score
  results.sort((a, b) => b.enhanced_score - a.enhanced_score);

  return results;
}

function printResults(results: OverlapResult[]) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     CITATION OVERLAP ANALYSIS RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Summary
  const withCites = results.filter(r => r.competitor_citations > 0);
  const totalCompetitorCites = results.reduce((s, r) => s + r.competitor_citations, 0);

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
    console.log('\nCompetitor Citation Breakdown:');
    const sorted = [...competitorCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) {
      console.log(`  ${name}: ${count} citations of Broadcom patents`);
    }
  }

  // Top patents with competitor citations
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('TOP 30 BROADCOM PATENTS CITED BY COMPETITORS');
  console.log('─────────────────────────────────────────────────────────────\n');

  const topWithCites = results
    .filter(r => r.competitor_citations > 0)
    .slice(0, 30);

  for (const r of topWithCites) {
    console.log(`${r.broadcom_patent_id} (Enhanced Score: ${r.enhanced_score.toFixed(1)})`);
    console.log(`  "${r.broadcom_title.substring(0, 65)}..."`);
    console.log(`  Original: ${r.forward_citations} fwd citations | ${r.remaining_years} yrs left | Score: ${r.original_score.toFixed(1)}`);
    console.log(`  Total citing: ${r.total_citing_patents} | Competitors: ${r.competitor_citations}`);

    // Show which competitors
    const competitors = [...new Set(r.competitor_cites.map(c => getCompetitorName(c.assignee)))];
    console.log(`  Cited by: ${competitors.join(', ')}`);
    console.log('');
  }
}

async function saveResults(results: OverlapResult[]) {
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output';

  // Save full results
  const fullFile = `${outputDir}/citation-overlap-${timestamp}.json`;
  await fs.writeFile(fullFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      totalAnalyzed: results.length,
      competitorsChecked: COMPETITOR_PATTERNS,
      scoringMethod: 'v1: original_score + (competitor_citations * 15)',
    },
    results,
  }, null, 2));

  // Save patents with competitor citations as CSV
  const withCites = results.filter(r => r.competitor_citations > 0);
  const csvFile = `${outputDir}/competitor-cited-patents-${timestamp}.csv`;
  const csvLines = [
    'Rank,Broadcom Patent,Title,Grant Date,Assignee,Fwd Citations,Total Citing,Competitor Cites,Years Left,Enhanced Score,Competitors'
  ];

  withCites.forEach((r, i) => {
    const competitors = [...new Set(r.competitor_cites.map(c => getCompetitorName(c.assignee)))].join('; ');
    csvLines.push(
      `${i + 1},"${r.broadcom_patent_id}","${r.broadcom_title.replace(/"/g, '""')}","${r.broadcom_date}","${r.broadcom_assignee}",${r.forward_citations},${r.total_citing_patents},${r.competitor_citations},${r.remaining_years},${r.enhanced_score.toFixed(1)},"${competitors}"`
    );
  });

  await fs.writeFile(csvFile, csvLines.join('\n'));

  // Save top priority list (competitor-cited + high original score)
  const priorityFile = `${outputDir}/high-priority-patents-${timestamp}.json`;
  const priority = results
    .filter(r => r.competitor_citations > 0 || r.original_score > 60)
    .slice(0, 100);

  await fs.writeFile(priorityFile, JSON.stringify(priority, null, 2));

  console.log('\n✓ Results saved:');
  console.log(`  - ${fullFile} (all ${results.length} analyzed)`);
  console.log(`  - ${csvFile} (${withCites.length} with competitor cites)`);
  console.log(`  - ${priorityFile} (top 100 priority)`);
}

// Main
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     CITATION OVERLAP ANALYSIS');
  console.log('     Finding Broadcom patents cited by competitors');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load candidates
  const candidates = await loadBroadcomCandidates();

  // Analyze top 300 (adjust limit as needed - each patent takes ~3 seconds due to rate limiting)
  // 300 patents * 3 seconds = ~15 minutes
  const results = await analyzeOverlap(candidates, 300);

  // Output
  printResults(results);
  await saveResults(results);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     ANALYSIS COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
