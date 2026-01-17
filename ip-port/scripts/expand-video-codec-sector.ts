/**
 * Video Codec Sector Expansion
 *
 * Expands the video codec sector from 6 patents to ~200 using ElasticSearch.
 * Then runs citation overlap analysis on the expanded set.
 *
 * Usage: npx tsx scripts/expand-video-codec-sector.ts [--dry-run]
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const ES_URL = 'http://localhost:9200';
const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

// Initialize competitor matcher at module level
const competitorMatcher = new CompetitorMatcher();
console.log(`\n${competitorMatcher.getSummary()}\n`);

const OUTPUT_DIR = './output/sectors/video-codec-expanded';

interface PatentHit {
  patent_id: string;
  title: string;
  forward_citations: number;
}

async function searchVideoCodecPatents(): Promise<PatentHit[]> {
  const query = {
    size: 200,
    _source: ['patent_id', 'title', 'forward_citations'],
    query: {
      bool: {
        must: [
          {
            bool: {
              should: [
                { match_phrase: { abstract: 'video codec' } },
                { match_phrase: { abstract: 'video encoding' } },
                { match_phrase: { abstract: 'video decoding' } },
                { match_phrase: { abstract: 'video stream' } },
                { match_phrase: { abstract: 'video frame' } },
                { match_phrase: { abstract: 'video compression' } },
                { match: { abstract: 'transcoding' } },
                { match: { abstract: 'macroblock' } },
                { match_phrase: { abstract: 'HEVC' } },
                { match_phrase: { abstract: 'H.264' } },
                { match_phrase: { abstract: 'bitrate adaptation' } },
                { match: { abstract: 'motion vector' } }
              ],
              minimum_should_match: 1
            }
          }
        ],
        filter: [
          {
            bool: {
              should: [
                { prefix: { cpc_codes: 'H04N' } },
                { prefix: { cpc_codes: 'G06T' } }
              ]
            }
          }
        ]
      }
    },
    sort: [{ forward_citations: 'desc' }]
  };

  const response = await fetch(`${ES_URL}/patents/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  });

  const data = await response.json();
  return data.hits.hits.map((hit: any) => ({
    patent_id: hit._source.patent_id,
    title: hit._source.title,
    forward_citations: hit._source.forward_citations || 0
  }));
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;

async function rateLimitedFetch(endpoint: string, body: any): Promise<any> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  const response = await fetch(`${PATENTSVIEW_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': apiKey || ''
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

async function getCitingPatentIds(patentId: string): Promise<string[]> {
  try {
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 }
    });

    return (citationData.us_patent_citations || []).map((c: any) => c.patent_id);
  } catch (error) {
    console.error(`Error fetching citations for ${patentId}:`, error);
    return [];
  }
}

async function getPatentAssignees(patentIds: string[]): Promise<Map<string, string[]>> {
  const assigneeMap = new Map<string, string[]>();

  if (patentIds.length === 0) return assigneeMap;

  // Batch lookup assignees
  const batchSize = 100;
  for (let i = 0; i < patentIds.length; i += batchSize) {
    const batch = patentIds.slice(i, i + batchSize);
    try {
      const response = await rateLimitedFetch('/patent/', {
        q: { patent_id: batch },
        f: ['patent_id', 'assignees'],
        o: { size: batch.length }
      });

      for (const patent of response.patents || []) {
        const orgs = (patent.assignees || [])
          .map((a: any) => a.assignee_organization)
          .filter((o: string) => o);
        assigneeMap.set(patent.patent_id, orgs);
      }
    } catch (error) {
      console.error(`Error fetching assignees:`, error);
    }
  }

  return assigneeMap;
}

async function analyzePatent(patentId: string, title: string): Promise<any> {
  // Get citing patent IDs
  const citingPatentIds = await getCitingPatentIds(patentId);

  if (citingPatentIds.length === 0) {
    return {
      patent_id: patentId,
      title,
      total_citing: 0,
      competitor_citations: 0,
      competitor_count: 0,
      competitors_citing: [],
      competitor_breakdown: {},
      competitor_patents: {}
    };
  }

  // Get assignees for citing patents
  const assigneeMap = await getPatentAssignees(citingPatentIds);

  const competitorCitations: { [key: string]: number } = {};
  const competitorPatents: { [key: string]: string[] } = {};

  for (const [citingId, orgs] of assigneeMap) {
    for (const orgName of orgs) {
      const match = competitorMatcher.matchCompetitor(orgName);
      if (match) {
        competitorCitations[match.company] = (competitorCitations[match.company] || 0) + 1;
        if (!competitorPatents[match.company]) {
          competitorPatents[match.company] = [];
        }
        competitorPatents[match.company].push(citingId);
      }
    }
  }

  const totalCompetitorCitations = Object.values(competitorCitations).reduce((a, b) => a + b, 0);
  const competitors = Object.keys(competitorCitations);

  return {
    patent_id: patentId,
    title,
    total_citing: citingPatentIds.length,
    competitor_citations: totalCompetitorCitations,
    competitor_count: competitors.length,
    competitors_citing: competitors,
    competitor_breakdown: competitorCitations,
    competitor_patents: competitorPatents
  };
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('=== Video Codec Sector Expansion ===\n');

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Step 1: Get video codec patents from ES
  console.log('Step 1: Searching ElasticSearch for video codec patents...');
  const patents = await searchVideoCodecPatents();
  console.log(`  Found ${patents.length} patents\n`);

  // Save patent list
  const patentListFile = path.join(OUTPUT_DIR, `video-codec-patents-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(patentListFile, JSON.stringify({
    count: patents.length,
    patents,
    searchTerms: ['video codec', 'video encoding', 'video decoding', 'transcoding', 'macroblock', 'HEVC', 'H.264', 'video compression']
  }, null, 2));
  console.log(`  Saved patent list to ${patentListFile}\n`);

  if (isDryRun) {
    console.log('Dry run - skipping citation analysis.');
    console.log('\nTop 10 patents by forward citations:');
    patents.slice(0, 10).forEach((p, i) => {
      console.log(`  ${i+1}. ${p.patent_id}: ${p.title} (${p.forward_citations} citations)`);
    });
    return;
  }

  // Step 2: Run citation overlap analysis
  console.log('Step 2: Running citation overlap analysis...');

  const results: any[] = [];
  const batchSize = 10;
  const totalBatches = Math.ceil(patents.length / batchSize);

  for (let i = 0; i < patents.length; i += batchSize) {
    const batch = patents.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    console.log(`\n  Batch ${batchNum}/${totalBatches} (patents ${i+1}-${Math.min(i+batchSize, patents.length)})...`);

    for (const patent of batch) {
      try {
        const result = await analyzePatent(patent.patent_id, patent.title);
        results.push(result);

        if (result.competitor_citations > 0) {
          console.log(`    ${patent.patent_id}: ${result.competitor_citations} competitor citations (${result.competitors_citing.join(', ')})`);
        }
      } catch (error) {
        console.error(`    Error analyzing ${patent.patent_id}:`, error);
      }
    }

    // Save progress after each batch
    const progressFile = path.join(OUTPUT_DIR, `video-codec-progress-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(progressFile, JSON.stringify({
      progress: `${i + batch.length}/${patents.length}`,
      results
    }, null, 2));
  }

  // Step 3: Generate summary
  const withCitations = results.filter(r => r.competitor_citations > 0);
  const competitorTotals: { [key: string]: number } = {};

  for (const result of results) {
    for (const [comp, count] of Object.entries(result.competitor_breakdown || {})) {
      competitorTotals[comp] = (competitorTotals[comp] || 0) + (count as number);
    }
  }

  const sortedCompetitors = Object.entries(competitorTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, citations: count }));

  const summary = {
    generated_at: new Date().toISOString(),
    sector: 'video-codec-expanded',
    sectorName: 'Video Codec / Transcoding (Expanded)',
    description: 'Expanded video codec sector using ElasticSearch term matching',
    totalPatents: patents.length,
    patentsWithCitations: withCitations.length,
    hitRate: `${((withCitations.length / patents.length) * 100).toFixed(1)}%`,
    totalCompetitorCitations: Object.values(competitorTotals).reduce((a, b) => a + b, 0),
    topCompetitors: sortedCompetitors.slice(0, 15),
    results: results.sort((a, b) => b.competitor_citations - a.competitor_citations)
  };

  const summaryFile = path.join(OUTPUT_DIR, `video-codec-analysis-${new Date().toISOString().split('T')[0]}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  console.log('\n=== Analysis Complete ===');
  console.log(`Total patents analyzed: ${patents.length}`);
  console.log(`Patents with competitor citations: ${withCitations.length} (${summary.hitRate})`);
  console.log(`Total competitor citations: ${summary.totalCompetitorCitations}`);
  console.log(`\nTop competitors:`);
  sortedCompetitors.slice(0, 10).forEach((c, i) => {
    console.log(`  ${i+1}. ${c.name}: ${c.citations} citations`);
  });
  console.log(`\nResults saved to ${summaryFile}`);
}

main().catch(console.error);
