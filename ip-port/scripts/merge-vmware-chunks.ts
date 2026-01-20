/**
 * Merge VMware Citation Chunks
 *
 * Combines all chunk files into a single results file.
 * Run this after citation-overlap-vmware-chunked.ts completes.
 *
 * Usage: npx tsx scripts/merge-vmware-chunks.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';

const CHUNK_DIR = './output/vmware-chunks';

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

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        MERGE VMWARE CITATION CHUNKS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find all chunk files
  const files = await fs.readdir(CHUNK_DIR);
  const chunkFiles = files
    .filter(f => f.startsWith('chunk-') && f.endsWith('.json'))
    .sort();

  console.log(`Found ${chunkFiles.length} chunk files`);

  const allResults: AnalysisResult[] = [];
  let withCompetitorCitations = 0;

  for (const cf of chunkFiles) {
    try {
      const chunkPath = path.join(CHUNK_DIR, cf);
      const chunk = JSON.parse(await fs.readFile(chunkPath, 'utf-8'));

      for (const result of chunk.results) {
        allResults.push(result);
        if (result.competitor_citations > 0) {
          withCompetitorCitations++;
        }
      }

      console.log(`  ${cf}: ${chunk.results.length} patents`);
    } catch (error) {
      console.error(`  Error reading ${cf}:`, error);
    }
  }

  // Sort by competitor citations descending
  allResults.sort((a, b) => b.competitor_citations - a.competitor_citations);

  // Create output
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = `./output/vmware-citation-results-${timestamp}.json`;

  const output = {
    metadata: {
      generatedDate: new Date().toISOString(),
      source: 'vmware-chunks',
      totalAnalyzed: allResults.length,
      withCompetitorCitations,
      chunksProcessed: chunkFiles.length,
    },
    results: allResults,
  };

  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));

  // Also create a summary of high-citation patents
  const highCitation = allResults.filter(r => r.competitor_citations >= 3);
  const summaryFile = `./output/vmware-high-citation-summary-${timestamp}.json`;

  await fs.writeFile(summaryFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      threshold: '3+ competitor citations',
      count: highCitation.length,
    },
    patents: highCitation.map(p => ({
      patent_id: p.patent_id,
      title: p.title,
      assignee: p.assignee,
      competitor_citations: p.competitor_citations,
      competitors: p.competitors,
    })),
  }, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('MERGE COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total patents: ${allResults.length.toLocaleString()}`);
  console.log(`With competitor citations: ${withCompetitorCitations.toLocaleString()}`);
  console.log(`High citation (3+): ${highCitation.length.toLocaleString()}`);
  console.log(`\nOutput: ${outputFile}`);
  console.log(`Summary: ${summaryFile}`);
  console.log('\nNEXT STEP: Merge into multi-score-analysis');
  console.log('  npm run merge:vmware');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
