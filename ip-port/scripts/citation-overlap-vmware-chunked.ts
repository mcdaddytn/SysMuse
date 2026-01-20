/**
 * Citation Overlap Analysis - VMware Patents (CHUNKED VERSION)
 *
 * More robust version that saves results in small chunk files.
 * If a crash occurs, you only lose the current chunk (~100 patents max).
 *
 * Output structure:
 *   output/vmware-chunks/
 *     chunk-0001.json  (patents 0-99)
 *     chunk-0002.json  (patents 100-199)
 *     ...
 *     processed-ids.txt  (append-only list of processed IDs)
 *     status.txt         (safe to read anytime for monitoring)
 *
 * Usage: npx tsx scripts/citation-overlap-vmware-chunked.ts
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

const CHUNK_SIZE = 100; // Patents per chunk file
const CHUNK_DIR = './output/vmware-chunks';

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

    const totalCiting = citationData.total_hits || 0;

    if (totalCiting === 0) {
      return { totalCiting: 0, competitorCites: [] };
    }

    const citingIds = citationData.us_patent_citations?.map((c: any) => c.patent_id) || [];

    if (citingIds.length === 0) {
      return { totalCiting, competitorCites: [] };
    }

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

async function loadProcessedIds(): Promise<Set<string>> {
  const idFile = path.join(CHUNK_DIR, 'processed-ids.txt');
  const ids = new Set<string>();

  if (fsSync.existsSync(idFile)) {
    const content = await fs.readFile(idFile, 'utf-8');
    for (const line of content.split('\n')) {
      const id = line.trim();
      if (id) ids.add(id);
    }
  }

  return ids;
}

async function appendProcessedId(patentId: string): Promise<void> {
  const idFile = path.join(CHUNK_DIR, 'processed-ids.txt');
  await fs.appendFile(idFile, patentId + '\n');
}

async function saveChunk(chunkNumber: number, results: AnalysisResult[]): Promise<void> {
  const chunkFile = path.join(CHUNK_DIR, `chunk-${String(chunkNumber).padStart(4, '0')}.json`);
  await fs.writeFile(chunkFile, JSON.stringify({
    chunkNumber,
    savedAt: new Date().toISOString(),
    count: results.length,
    results,
  }, null, 2));
}

async function updateStatus(
  total: number,
  processed: number,
  withCitations: number,
  startTime: number,
  currentPatent: string
): Promise<void> {
  const statusFile = path.join(CHUNK_DIR, 'status.txt');
  const elapsed = (Date.now() - startTime) / 1000 / 60;
  const rate = processed > 0 ? processed / elapsed : 0;
  const eta = rate > 0 ? (total - processed) / rate : 0;

  const status = [
    `VMware Citation Analysis Status`,
    `================================`,
    `Last Updated: ${new Date().toISOString()}`,
    ``,
    `Progress: ${processed} / ${total} (${((processed / total) * 100).toFixed(1)}%)`,
    `With Competitor Citations: ${withCitations}`,
    ``,
    `Elapsed: ${elapsed.toFixed(1)} min`,
    `Rate: ${rate.toFixed(1)} patents/min`,
    `ETA: ${Math.round(eta)} min (${(eta / 60).toFixed(1)} hours)`,
    ``,
    `Current Patent: ${currentPatent}`,
    ``,
    `Chunk Size: ${CHUNK_SIZE} patents per file`,
    `Chunks Saved: ${Math.floor(processed / CHUNK_SIZE)}`,
  ].join('\n');

  await fs.writeFile(statusFile, status);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VMWARE CITATION OVERLAP ANALYSIS (CHUNKED)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Ensure chunk directory exists
  await fs.mkdir(CHUNK_DIR, { recursive: true });

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

  // Load already-processed IDs (for resume)
  const processedIds = await loadProcessedIds();
  console.log(`Already processed: ${processedIds.size.toLocaleString()}`);

  const remaining = patents.length - processedIds.size;
  const estimatedMinutes = (remaining * 2.5) / 42;
  console.log(`\nEstimated time: ${Math.round(estimatedMinutes / 60 * 10) / 10} hours for ${remaining.toLocaleString()} patents\n`);
  console.log(`${competitorMatcher.getSummary()}\n`);
  console.log(`\nMonitor progress: cat output/vmware-chunks/status.txt\n`);

  const startTime = Date.now();
  let processedCount = processedIds.size;
  let withCompetitorCites = 0;

  // Count existing competitor citations from chunks
  const chunkFiles = (await fs.readdir(CHUNK_DIR)).filter(f => f.startsWith('chunk-'));
  for (const cf of chunkFiles) {
    try {
      const chunk = JSON.parse(await fs.readFile(path.join(CHUNK_DIR, cf), 'utf-8'));
      withCompetitorCites += chunk.results.filter((r: AnalysisResult) => r.competitor_citations > 0).length;
    } catch (e) {
      // Skip corrupted chunks
    }
  }

  let chunkBuffer: AnalysisResult[] = [];
  let currentChunkNumber = Math.floor(processedIds.size / CHUNK_SIZE) + 1;

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

    chunkBuffer.push(result);
    processedCount++;

    if (result.competitor_citations > 0) {
      withCompetitorCites++;
    }

    // Append to processed IDs immediately (most critical - append is safe)
    await appendProcessedId(patent.patent_id);

    // Save chunk when buffer is full
    if (chunkBuffer.length >= CHUNK_SIZE) {
      await saveChunk(currentChunkNumber, chunkBuffer);
      console.log(
        `Saved chunk ${currentChunkNumber} | ` +
        `Progress: ${processedCount}/${patents.length} (${((processedCount / patents.length) * 100).toFixed(1)}%) | ` +
        `With cites: ${withCompetitorCites}`
      );
      chunkBuffer = [];
      currentChunkNumber++;
    }

    // Update status file every 10 patents (safe to read anytime)
    if (processedCount % 10 === 0) {
      await updateStatus(patents.length, processedCount, withCompetitorCites, startTime, patent.patent_id);
    }
  }

  // Save final partial chunk
  if (chunkBuffer.length > 0) {
    await saveChunk(currentChunkNumber, chunkBuffer);
    console.log(`Saved final chunk ${currentChunkNumber} with ${chunkBuffer.length} patents`);
  }

  // Final status
  await updateStatus(patents.length, processedCount, withCompetitorCites, startTime, 'COMPLETE');

  console.log('\n' + '═'.repeat(60));
  console.log('ANALYSIS COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total analyzed: ${processedCount.toLocaleString()}`);
  console.log(`With competitor citations: ${withCompetitorCites.toLocaleString()}`);
  console.log(`Chunks saved in: ${CHUNK_DIR}/`);
  console.log('\nNEXT STEP: Merge chunks and integrate with multi-score-analysis');
  console.log('  npx tsx scripts/merge-vmware-chunks.ts');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
