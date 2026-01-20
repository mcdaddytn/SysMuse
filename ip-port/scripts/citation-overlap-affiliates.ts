/**
 * Citation Overlap Analysis - Missing Affiliates (Pivotal, Carbon Black, Nyansa, Blue Coat)
 *
 * Analyzes citation overlap for the newly downloaded affiliate patents.
 *
 * Usage: npx tsx scripts/citation-overlap-affiliates.ts
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

if (!apiKey) {
  console.error('Error: PATENTSVIEW_API_KEY not set in .env');
  process.exit(1);
}

const OUTPUT_DIR = './output/affiliate-chunks';

const competitorMatcher = new CompetitorMatcher();

interface CitingPatent {
  patent_id: string;
  assignee: string;
  company: string;
}

interface AnalysisResult {
  patent_id: string;
  title: string;
  assignee: string;
  grant_date: string;
  forward_citations: number;
  competitor_citations: number;
  competitor_count: number;
  competitors: string[];
  competitor_cites: CitingPatent[];
}

let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1400;

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
      'X-Api-Key': apiKey!,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    if (response.status === 429) {
      console.log('  Rate limited, waiting 60s...');
      await new Promise(r => setTimeout(r, 60000));
      return rateLimitedFetch(endpoint, body);
    }
    throw new Error(`API Error ${response.status}`);
  }

  return response.json();
}

async function findCompetitorCitations(patentId: string): Promise<{
  totalCiting: number;
  competitorCites: CitingPatent[];
}> {
  const competitorCites: CitingPatent[] = [];

  try {
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 },
    });

    const citingPatentIds = citationData.us_patent_citations?.map((c: any) => c.patent_id) || [];
    const totalCiting = citingPatentIds.length;

    if (totalCiting === 0) {
      return { totalCiting: 0, competitorCites: [] };
    }

    // Batch fetch assignee info
    const assigneeData = await rateLimitedFetch('/patent/', {
      q: { patent_id: citingPatentIds },
      f: ['patent_id', 'assignees.assignee_organization'],
      o: { size: 500 },
    });

    for (const patent of assigneeData.patents || []) {
      const assignee = patent.assignees?.[0]?.assignee_organization || 'Unknown';
      const company = competitorMatcher.matchCompetitor(assignee)?.company;

      if (company) {
        competitorCites.push({
          patent_id: patent.patent_id,
          assignee,
          company,
        });
      }
    }

    return { totalCiting, competitorCites };
  } catch (error) {
    console.error(`  Error for ${patentId}:`, error);
    return { totalCiting: 0, competitorCites: [] };
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     CITATION OVERLAP ANALYSIS - MISSING AFFILIATES');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Create output directory
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // Load patents from both sources
  const patents: any[] = [];

  // Load missing affiliates (Pivotal, Carbon Black, Nyansa)
  try {
    const affiliatesFile = await fs.readFile('./output/missing-affiliates-patents-2026-01-20.json', 'utf-8');
    const affiliatesData = JSON.parse(affiliatesFile);
    patents.push(...affiliatesData.patents);
    console.log(`Loaded ${affiliatesData.patents.length} patents from missing-affiliates`);
  } catch (e) {
    console.log('No missing-affiliates file found');
  }

  // Load Blue Coat
  try {
    const bluecoatFile = await fs.readFile('./output/bluecoat-patents-2026-01-20.json', 'utf-8');
    const bluecoatData = JSON.parse(bluecoatFile);
    patents.push(...bluecoatData.patents);
    console.log(`Loaded ${bluecoatData.patents.length} patents from Blue Coat`);
  } catch (e) {
    console.log('No bluecoat file found');
  }

  console.log(`\nTotal patents to analyze: ${patents.length}`);

  // Check for already processed
  const processedFile = path.join(OUTPUT_DIR, 'processed-ids.txt');
  let processedIds = new Set<string>();
  try {
    const processed = await fs.readFile(processedFile, 'utf-8');
    processedIds = new Set(processed.trim().split('\n').filter(Boolean));
    console.log(`Already processed: ${processedIds.size}`);
  } catch {
    // File doesn't exist yet
  }

  const results: AnalysisResult[] = [];
  let withCompetitorCites = 0;
  const timestamp = new Date().toISOString().split('T')[0];

  // Process patents
  for (let i = 0; i < patents.length; i++) {
    const patent = patents[i];
    const patentId = patent.patent_id;

    if (processedIds.has(patentId)) {
      continue;
    }

    console.log(`[${i + 1}/${patents.length}] Analyzing ${patentId}...`);

    const { totalCiting, competitorCites } = await findCompetitorCitations(patentId);

    const uniqueCompetitors = [...new Set(competitorCites.map(c => c.company))];

    const result: AnalysisResult = {
      patent_id: patentId,
      title: patent.patent_title || patent.title || '',
      assignee: patent.assignees?.[0]?.assignee_organization || patent.assignee || '',
      grant_date: patent.patent_date || patent.grant_date || '',
      forward_citations: totalCiting,
      competitor_citations: competitorCites.length,
      competitor_count: uniqueCompetitors.length,
      competitors: uniqueCompetitors,
      competitor_cites: competitorCites,
    };

    results.push(result);

    if (competitorCites.length > 0) {
      withCompetitorCites++;
      console.log(`  → ${competitorCites.length} competitor cites (${uniqueCompetitors.join(', ')})`);
    }

    // Mark as processed
    await fs.appendFile(processedFile, patentId + '\n');

    // Save checkpoint every 50 patents
    if (results.length % 50 === 0) {
      const chunkFile = path.join(OUTPUT_DIR, `checkpoint-${timestamp}.json`);
      await fs.writeFile(chunkFile, JSON.stringify({
        metadata: {
          generatedDate: new Date().toISOString(),
          totalProcessed: results.length,
          withCompetitorCitations: withCompetitorCites,
        },
        results,
      }, null, 2));
      console.log(`  [Checkpoint saved: ${results.length} patents]`);
    }
  }

  // Final output
  const output = {
    metadata: {
      generatedDate: new Date().toISOString(),
      source: 'missing-affiliates',
      totalAnalyzed: results.length,
      withCompetitorCitations: withCompetitorCites,
    },
    results: results.sort((a, b) => b.competitor_citations - a.competitor_citations),
  };

  const outputFile = `./output/affiliate-citation-results-${timestamp}.json`;
  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total patents analyzed: ${results.length}`);
  console.log(`With competitor citations: ${withCompetitorCites}`);
  console.log(`Output: ${outputFile}`);
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
