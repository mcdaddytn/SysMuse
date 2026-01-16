/**
 * Analyze new patents that don't have LLM analysis yet
 */

import * as fs from 'fs';
import * as path from 'path';
import { LLMPatentAnalyzer } from './llm-patent-analysis.js';

const OUTPUT_DIR = './output';
const LLM_BATCHES_DIR = './output/llm-analysis/batches';

interface PatentInput {
  patent_id: string;
  title: string;
  abstract?: string;
  grant_date?: string;
}

// Get patent IDs that already have LLM analysis
function getAnalyzedPatentIds(): Set<string> {
  const analyzed = new Set<string>();

  if (!fs.existsSync(LLM_BATCHES_DIR)) return analyzed;

  const files = fs.readdirSync(LLM_BATCHES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(LLM_BATCHES_DIR, file), 'utf-8'));
    for (const analysis of data.analyses || []) {
      analyzed.add(analysis.patent_id);
    }
  }

  return analyzed;
}

// Get current top-250 patent IDs
function getTop250PatentIds(): string[] {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('top-250-actionable-') && f.endsWith('.csv'))
    .sort()
    .reverse();

  if (files.length === 0) throw new Error('No top-250 file found');

  const csvPath = path.join(OUTPUT_DIR, files[0]);
  console.log(`Using: ${csvPath}`);

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1);

  return lines.map(line => {
    const match = line.match(/^\d+,\"?(\d+)\"?/);
    return match ? match[1] : '';
  }).filter(Boolean);
}

// Load patent data from portfolio
function loadPatentData(): Map<string, PatentInput> {
  const patents = new Map<string, PatentInput>();

  // Load from portfolio
  const portfolioPath = path.join(OUTPUT_DIR, 'broadcom-portfolio-2026-01-15.json');
  if (fs.existsSync(portfolioPath)) {
    const data = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
    for (const p of data.patents || []) {
      patents.set(p.patent_id, {
        patent_id: p.patent_id,
        title: p.patent_title,
        abstract: p.patent_abstract,
        grant_date: p.patent_date,
      });
    }
  }

  // Load from streaming batches
  const batchFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('patents-batch-'));
  for (const file of batchFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
    for (const p of data.patents || []) {
      if (!patents.has(p.patent_id) || !patents.get(p.patent_id)?.abstract) {
        patents.set(p.patent_id, {
          patent_id: p.patent_id,
          title: p.patent_title,
          abstract: p.patent_abstract,
          grant_date: p.patent_date,
        });
      }
    }
  }

  return patents;
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  ANALYZE NEW PATENTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get already analyzed patents
  const analyzed = getAnalyzedPatentIds();
  console.log(`Already analyzed: ${analyzed.size} patents`);

  // Get current top-250
  const top250 = getTop250PatentIds();
  console.log(`Current top-250: ${top250.length} patents`);

  // Find patents needing analysis
  const needsAnalysis = top250.filter(id => !analyzed.has(id));
  console.log(`Need LLM analysis: ${needsAnalysis.length} patents\n`);

  if (needsAnalysis.length === 0) {
    console.log('All top-250 patents already have LLM analysis!');
    return;
  }

  // Load patent data
  const patentData = loadPatentData();

  // Get patents with data
  const patentsToAnalyze = needsAnalysis
    .map(id => patentData.get(id))
    .filter((p): p is PatentInput => p !== undefined && !!p.abstract);

  console.log(`Found data for: ${patentsToAnalyze.length} patents`);

  if (patentsToAnalyze.length === 0) {
    console.log('No patents with data to analyze');
    return;
  }

  // Run analysis
  const analyzer = new LLMPatentAnalyzer();
  const startBatch = 51; // Continue from where we left off

  const results = await analyzer.processBatches(patentsToAnalyze, {
    startIndex: startBatch,
    onProgress: (completed, total) => {
      console.log(`  Progress: ${completed}/${total}`);
    },
  });

  console.log(`\n✓ Completed ${results.length} analyses`);
}

main().catch(console.error);
