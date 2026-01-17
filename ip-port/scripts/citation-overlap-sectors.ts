/**
 * Citation Overlap Analysis for Specific Sectors (Clusters)
 *
 * Runs citation overlap on targeted patent sets from cluster analysis.
 *
 * Usage:
 *   npx tsx scripts/citation-overlap-sectors.ts video-codec
 *   npx tsx scripts/citation-overlap-sectors.ts security
 *   npx tsx scripts/citation-overlap-sectors.ts all
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

// Sector definitions from cluster analysis
const SECTORS = {
  'video-codec': {
    name: 'Video Codec / Transcoding',
    description: 'Video encoding, decoding, transcoding, and compression patents',
    patentIds: [
      // Cluster 2 patents
      '9743040', '10200706', '8116374', '9635334', '10206084',
      // ByteDance-cited from Avago A/V
      '10165285'
    ],
    targetCompetitors: ['ByteDance', 'Tencent', 'Dolby', 'Apple', 'Google', 'Netflix', 'Amazon'],
    clusterSource: 'hybrid-cluster-2-video-codec'
  },
  'security': {
    name: 'Security / Threat Detection',
    description: 'Cybersecurity, threat detection, and attack prevention patents',
    patentIds: [
      // Cluster 5 patents
      '9692778', '9838405', '10178109', '9548988', '9948663', '9998480'
    ],
    targetCompetitors: ['CrowdStrike', 'SentinelOne', 'Palo Alto Networks', 'Fortinet', 'Symantec', 'McAfee', 'Cybereason', 'Carbon Black'],
    clusterSource: 'hybrid-cluster-5-security'
  },
  'cloud-auth': {
    name: 'Cloud / Authentication',
    description: 'Cloud computing, user authentication, encryption, and access control patents',
    patentIds: [
      // Cluster 1 patents - 43 total, highest priority cluster (349 competitor citations)
      '9590872', '8566578', '9749331', '8762512', '9628471', '9800608', '10042768', '8429630',
      '9578088', '8826443', '8826444', '8950005', '8671080', '9183384', '8312064', '10129257',
      '8782403', '9342705', '8213602', '8954740', '10581819', '9569605', '9888377', '10182048',
      '9780950', '8997195', '10200359', '10206099', '9483627', '9106645', '8677448', '10248797',
      '9106687', '9166993', '9401925', '10116680', '8776168', '8863307', '10887307', '9807094',
      '9356939', '8671455', '9160757'
    ],
    targetCompetitors: ['Apple', 'Amazon', 'Microsoft', 'Google', 'Meta', 'Comcast', 'Sony', 'ByteDance', 'Intel', 'Citrix', 'Sophos', 'EMC'],
    clusterSource: 'hybrid-cluster-1-cloud-auth'
  }
};

interface CitingPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  competitor_name?: string;
  competitor_category?: string;
}

interface CitationResult {
  patentId: string;
  title: string;
  grantDate: string;
  forwardCitations: number;
  competitorCitations: number;
  competitorCites: CitingPatent[];
  competitorsCiting: string[];
}

const matcher = new CompetitorMatcher();
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;

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

async function analyzePatent(patentId: string): Promise<CitationResult | null> {
  try {
    // Get patent details
    const patentResponse = await rateLimitedFetch('/patent/', 'POST', {
      q: { patent_id: patentId },
      f: ['patent_id', 'patent_title', 'patent_date', 'patent_num_times_cited_by_us_patents'],
      o: { size: 1 }
    });

    if (!patentResponse.patents || patentResponse.patents.length === 0) {
      console.log(`  Patent ${patentId}: Not found`);
      return null;
    }

    const patent = patentResponse.patents[0];

    // Find citing patents
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 }
    });

    const totalCiting = citationData.total_hits || 0;
    const competitorCites: CitingPatent[] = [];
    const competitorsCiting = new Set<string>();

    if (citationData.us_patent_citations && citationData.us_patent_citations.length > 0) {
      const citingIds = [...new Set(citationData.us_patent_citations.map((c: any) => c.patent_id))] as string[];

      if (citingIds.length > 0) {
        // Get details of citing patents in batches
        const batchSize = 50;
        for (let i = 0; i < citingIds.length; i += batchSize) {
          const batch = citingIds.slice(i, i + batchSize);

          const citingPatentsData = await rateLimitedFetch('/patent/', 'POST', {
            q: { _or: batch.map(id => ({ patent_id: id })) },
            f: ['patent_id', 'patent_title', 'patent_date', 'assignees.assignee_organization'],
            o: { size: batchSize }
          });

          if (citingPatentsData.patents) {
            for (const citingPatent of citingPatentsData.patents) {
              const assignees = citingPatent.assignees || [];
              for (const assignee of assignees) {
                const org = assignee.assignee_organization;
                if (!org) continue;

                const match = matcher.matchCompetitor(org);
                if (match) {
                  competitorCites.push({
                    patent_id: citingPatent.patent_id,
                    patent_title: citingPatent.patent_title,
                    patent_date: citingPatent.patent_date,
                    assignee: org,
                    competitor_name: match.company,
                    competitor_category: match.category,
                  });
                  competitorsCiting.add(match.company);
                }
              }
            }
          }
        }
      }
    }

    return {
      patentId,
      title: patent.patent_title || '',
      grantDate: patent.patent_date || '',
      forwardCitations: totalCiting,
      competitorCitations: competitorCites.length,
      competitorCites,
      competitorsCiting: Array.from(competitorsCiting)
    };
  } catch (error) {
    console.error(`  Error analyzing ${patentId}:`, error);
    return null;
  }
}

async function analyzeSector(sectorId: string): Promise<void> {
  const sector = SECTORS[sectorId as keyof typeof SECTORS];
  if (!sector) {
    console.error(`Unknown sector: ${sectorId}`);
    return;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Sector: ${sector.name}`);
  console.log(`Description: ${sector.description}`);
  console.log(`Patents to analyze: ${sector.patentIds.length}`);
  console.log(`Target competitors: ${sector.targetCompetitors.join(', ')}`);
  console.log(`${'='.repeat(60)}\n`);

  const results: CitationResult[] = [];
  const competitorCounts: Record<string, number> = {};

  for (let i = 0; i < sector.patentIds.length; i++) {
    const patentId = sector.patentIds[i];
    console.log(`[${i + 1}/${sector.patentIds.length}] Analyzing patent ${patentId}...`);

    const result = await analyzePatent(patentId);
    if (result) {
      results.push(result);

      // Count competitor citations
      for (const cite of result.competitorCites) {
        if (cite.competitor_name) {
          competitorCounts[cite.competitor_name] = (competitorCounts[cite.competitor_name] || 0) + 1;
        }
      }

      console.log(`  Title: ${result.title.substring(0, 60)}...`);
      console.log(`  Forward citations: ${result.forwardCitations}, Competitor: ${result.competitorCitations}`);
      if (result.competitorsCiting.length > 0) {
        console.log(`  Competitors: ${result.competitorsCiting.join(', ')}`);
      }
    }
  }

  // Sort results by competitor citations
  results.sort((a, b) => b.competitorCitations - a.competitorCitations);

  // Summary
  const totalCitations = results.reduce((sum, r) => sum + r.competitorCitations, 0);
  const patentsWithCitations = results.filter(r => r.competitorCitations > 0).length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${sector.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Patents analyzed: ${results.length}`);
  console.log(`Patents with competitor citations: ${patentsWithCitations}`);
  console.log(`Total competitor citations: ${totalCitations}`);
  console.log(`\nTop Competitors:`);

  Object.entries(competitorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([name, count]) => console.log(`  ${name}: ${count}`));

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output/sectors';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    sector: sectorId,
    sectorName: sector.name,
    description: sector.description,
    clusterSource: sector.clusterSource,
    summary: {
      patents_analyzed: results.length,
      patents_with_citations: patentsWithCitations,
      total_competitor_citations: totalCitations,
      hit_rate: results.length > 0 ? `${(patentsWithCitations / results.length * 100).toFixed(1)}%` : '0%'
    },
    competitor_breakdown: Object.fromEntries(
      Object.entries(competitorCounts).sort((a, b) => b[1] - a[1])
    ),
    results: results.map(r => ({
      patent_id: r.patentId,
      title: r.title,
      grant_date: r.grantDate,
      forward_citations: r.forwardCitations,
      competitor_citations: r.competitorCitations,
      competitors_citing: r.competitorsCiting,
      competitor_cites: r.competitorCites
    }))
  };

  const outputPath = path.join(outputDir, `${sectorId}-analysis-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const sectorArg = args[0] || 'all';

  if (!apiKey) {
    console.error('PATENTSVIEW_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Sector Citation Overlap Analysis');
  console.log('='.repeat(60));
  console.log(`\n${matcher.getSummary()}\n`);

  if (sectorArg === 'all') {
    for (const sectorId of Object.keys(SECTORS)) {
      await analyzeSector(sectorId);
    }
  } else if (SECTORS[sectorArg as keyof typeof SECTORS]) {
    await analyzeSector(sectorArg);
  } else {
    console.error(`Unknown sector: ${sectorArg}`);
    console.log(`Available sectors: ${Object.keys(SECTORS).join(', ')}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Analysis Complete');
  console.log('='.repeat(60));
}

main().catch(console.error);
