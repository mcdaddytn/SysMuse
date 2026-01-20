/**
 * Citation Overlap Analysis - VMware Patents
 *
 * Analyzes VMware patents for competitor citations.
 * This is the time-consuming step (~3-6 hours for 6,500 patents).
 *
 * Run in background or overnight.
 *
 * Usage: npx tsx scripts/citation-overlap-vmware.ts [--resume]
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

if (!apiKey) {
  console.error('Error: PATENTSVIEW_API_KEY not set in .env');
  process.exit(1);
}

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
    // Get patents that cite this one
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 },
    });

    const totalCiting = citationData.total_hits || 0;

    if (totalCiting === 0) {
      return { totalCiting: 0, competitorCites: [] };
    }

    // Get the citing patent IDs
    const citingIds = citationData.us_patent_citations?.map((c: any) => c.patent_id) || [];

    if (citingIds.length === 0) {
      return { totalCiting, competitorCites: [] };
    }

    // Fetch assignee info for citing patents (batch)
    const patentData = await rateLimitedFetch('/patent/', {
      q: { _or: citingIds.slice(0, 100).map((id: string) => ({ patent_id: id })) },
      f: ['patent_id', 'assignees'],
      o: { size: 100 },
    });

    for (const patent of patentData.patents || []) {
      const assignee = patent.assignees?.[0]?.assignee_organization || '';
      const match = competitorMatcher.matchCompetitor(assignee);

      if (match) {
        competitorCites.push({
          patent_id: patent.patent_id,
          assignee,
          company: match.company,
        });
      }
    }

    return { totalCiting, competitorCites };

  } catch (error) {
    console.error(`  Error analyzing ${patentId}:`, error);
    return { totalCiting: 0, competitorCites: [] };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const resume = args.includes('--resume');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VMWARE CITATION OVERLAP ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find the most recent vmware-patents file
  const files = await fs.readdir('./output');
  const vmwareFile = files
    .filter(f => f.startsWith('vmware-patents-') && f.endsWith('.json'))
    .sort()
    .pop();

  if (!vmwareFile) {
    console.error('Error: No vmware-patents-*.json file found. Run download first:');
    console.error('  npm run download:vmware');
    process.exit(1);
  }

  console.log(`Loading: ${vmwareFile}`);
  const vmwareData = JSON.parse(await fs.readFile(`./output/${vmwareFile}`, 'utf-8'));
  const patents = vmwareData.patents;
  console.log(`Total patents to analyze: ${patents.length.toLocaleString()}`);

  const timestamp = new Date().toISOString().split('T')[0];
  const progressFile = `./output/vmware-citation-progress-${timestamp}.json`;
  const outputFile = `./output/vmware-citation-results-${timestamp}.json`;

  // Load progress if resuming
  let processedIds = new Set<string>();
  let results: AnalysisResult[] = [];

  if (resume && fsSync.existsSync(progressFile)) {
    const progress = JSON.parse(await fs.readFile(progressFile, 'utf-8'));
    processedIds = new Set(progress.processedIds);
    results = progress.results;
    console.log(`Resuming from ${processedIds.size} already processed patents`);
  }

  const startTime = Date.now();
  let processedCount = processedIds.size;
  let withCompetitorCites = results.filter(r => r.competitor_citations > 0).length;

  // Estimate time
  const remaining = patents.length - processedIds.size;
  const estimatedMinutes = (remaining * 2.5) / 42; // ~2.5 requests per patent at 42 req/min
  console.log(`\nEstimated time: ${Math.round(estimatedMinutes / 60 * 10) / 10} hours for ${remaining.toLocaleString()} patents\n`);

  console.log(`${competitorMatcher.getSummary()}\n`);

  // Process patents
  for (let i = 0; i < patents.length; i++) {
    const patent = patents[i];

    if (processedIds.has(patent.patent_id)) {
      continue;
    }

    const { totalCiting, competitorCites } = await findCompetitorCitations(patent.patent_id);

    const uniqueCompetitors = [...new Set(competitorCites.map(c => c.company))];

    const result: AnalysisResult = {
      patent_id: patent.patent_id,
      title: patent.patent_title || '',
      assignee: patent.assignees?.[0]?.assignee_organization || '',
      grant_date: patent.patent_date || '',
      forward_citations: totalCiting,
      competitor_citations: competitorCites.length,
      competitor_count: uniqueCompetitors.length,
      competitors: uniqueCompetitors,
      competitor_cites: competitorCites,
    };

    results.push(result);
    processedIds.add(patent.patent_id);
    processedCount++;

    if (result.competitor_citations > 0) {
      withCompetitorCites++;
    }

    // Progress update
    if (processedCount % 50 === 0) {
      const elapsed = (Date.now() - startTime) / 1000 / 60;
      const rate = (processedCount - (processedIds.size - remaining)) / elapsed;
      const eta = (patents.length - processedCount) / rate;

      console.log(
        `Progress: ${processedCount}/${patents.length} (${((processedCount / patents.length) * 100).toFixed(1)}%) | ` +
        `With competitor cites: ${withCompetitorCites} | ` +
        `ETA: ${Math.round(eta)} min`
      );

      // Save progress
      await fs.writeFile(progressFile, JSON.stringify({
        processedIds: Array.from(processedIds),
        results,
        lastUpdated: new Date().toISOString(),
      }, null, 2));
    }
  }

  // Final save
  const output = {
    metadata: {
      generatedDate: new Date().toISOString(),
      sourceFile: vmwareFile,
      totalAnalyzed: results.length,
      withCompetitorCitations: withCompetitorCites,
      processingTimeMinutes: Math.round((Date.now() - startTime) / 1000 / 60),
    },
    results: results.sort((a, b) => b.competitor_citations - a.competitor_citations),
  };

  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total analyzed: ${results.length.toLocaleString()}`);
  console.log(`With competitor citations: ${withCompetitorCites.toLocaleString()}`);
  console.log(`Saved to: ${outputFile}`);
  console.log('\nNEXT STEP: Merge into multi-score-analysis');
  console.log('  npm run merge:vmware');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
