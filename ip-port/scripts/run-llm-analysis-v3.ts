/**
 * Run V3 LLM Analysis on Sector Patents
 *
 * Analyzes patents using enhanced V3 prompts with cross-sector signals.
 *
 * Usage:
 *   npx tsx scripts/run-llm-analysis-v3.ts --sector cloud-auth
 *   npx tsx scripts/run-llm-analysis-v3.ts --all-sectors
 *   npx tsx scripts/run-llm-analysis-v3.ts --top 50
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env first before any other imports that might use env vars
dotenv.config();

import { LLMPatentAnalyzerV3, PatentAnalysisV3 } from '../services/llm-patent-analysis-v3.js';

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';

function getApiKey(): string {
  const key = process.env.PATENTSVIEW_API_KEY;
  if (!key) {
    console.error('ERROR: PATENTSVIEW_API_KEY not set in environment');
    console.error('Check your .env file or set the environment variable');
    process.exit(1);
  }
  return key;
}

interface PatentDetails {
  patent_id: string;
  title: string;
  abstract?: string;
  grant_date?: string;
  cpc_codes?: string[];
}

async function fetchPatentDetails(patentIds: string[]): Promise<PatentDetails[]> {
  const results: PatentDetails[] = [];
  const apiKey = getApiKey();

  // Fetch one at a time to ensure we get all data - PatentsView can be finicky with batch queries
  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    if (i % 10 === 0 || i === patentIds.length - 1) {
      console.log(`Fetching patent ${i + 1}/${patentIds.length}...`);
    }

    try {
      const requestBody = {
        q: { patent_id: patentId },
        f: ['patent_id', 'patent_title', 'patent_abstract', 'patent_date'],
        o: { size: 1 }
      };

      const response = await fetch(`${PATENTSVIEW_BASE_URL}/patent/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Api-Key': apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  API error ${response.status} for ${patentId}: ${errorText.substring(0, 100)}`);
        continue;
      }

      const data = await response.json();

      if (data.patents && data.patents.length > 0) {
        const patent = data.patents[0];
        results.push({
          patent_id: patent.patent_id,
          title: patent.patent_title || '',
          abstract: patent.patent_abstract || undefined,
          grant_date: patent.patent_date || undefined,
        });
      }

      // Rate limit - 1.5 seconds between requests
      await new Promise(r => setTimeout(r, 1500));
    } catch (error) {
      console.error(`  Error fetching ${patentId}:`, error);
    }
  }

  return results;
}

function loadPatentIds(args: string[]): { patentIds: string[]; source: string } {
  // Check for direct file argument (first non-flag argument)
  const fileArg = args.find(arg => !arg.startsWith('--') && fs.existsSync(arg));
  if (fileArg) {
    const content = fs.readFileSync(fileArg, 'utf-8');
    let patents: string[];

    if (fileArg.endsWith('.json')) {
      const data = JSON.parse(content);
      patents = Array.isArray(data) ? data : (data.patents || data.patent_ids || []);
    } else {
      patents = content.split('\n').filter(line => line.trim());
    }

    return { patentIds: patents, source: `file: ${fileArg}` };
  }

  // Check for --sector flag
  const sectorIndex = args.indexOf('--sector');
  if (sectorIndex !== -1 && args[sectorIndex + 1]) {
    const sectorId = args[sectorIndex + 1];
    const sectorFile = `./output/sectors/${sectorId}-analysis-2026-01-17.json`;

    if (fs.existsSync(sectorFile)) {
      const data = JSON.parse(fs.readFileSync(sectorFile, 'utf-8'));
      const patents = (data.results || []).map((r: any) => r.patent_id);
      return { patentIds: patents, source: `sector: ${sectorId}` };
    } else {
      console.error(`Sector file not found: ${sectorFile}`);
      process.exit(1);
    }
  }

  // Check for --all-sectors flag
  if (args.includes('--all-sectors')) {
    const sectorDir = './output/sectors';
    const patents: string[] = [];

    if (fs.existsSync(sectorDir)) {
      const files = fs.readdirSync(sectorDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        const data = JSON.parse(fs.readFileSync(path.join(sectorDir, file), 'utf-8'));
        for (const result of data.results || []) {
          if (!patents.includes(result.patent_id)) {
            patents.push(result.patent_id);
          }
        }
      }
    }
    return { patentIds: patents, source: 'all sectors' };
  }

  // Check for --top flag
  const topIndex = args.indexOf('--top');
  if (topIndex !== -1) {
    const topN = parseInt(args[topIndex + 1] || '50', 10);

    const tierFiles = fs.readdirSync('./output')
      .filter(f => f.startsWith('tier-litigation-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (tierFiles.length > 0) {
      const data = JSON.parse(fs.readFileSync(`./output/${tierFiles[0]}`, 'utf-8'));
      const patents = data.slice(0, topN).map((p: any) => p.patent_id);
      return { patentIds: patents, source: `top ${topN} litigation candidates` };
    }
  }

  // Default: all sector patents
  return loadPatentIds(['--all-sectors']);
}

async function main() {
  const args = process.argv.slice(2);
  const { patentIds, source } = loadPatentIds(args);

  if (patentIds.length === 0) {
    console.error('No patent IDs found. Usage:');
    console.error('  npx tsx scripts/run-llm-analysis-v3.ts --sector cloud-auth');
    console.error('  npx tsx scripts/run-llm-analysis-v3.ts --all-sectors');
    console.error('  npx tsx scripts/run-llm-analysis-v3.ts --top 50');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('V3 LLM Patent Analysis');
  console.log('='.repeat(60));
  console.log(`Source: ${source}`);
  console.log(`Patents to analyze: ${patentIds.length}`);
  console.log('');

  // Fetch patent details from PatentsView
  console.log('Fetching patent details from PatentsView...\n');
  const patents = await fetchPatentDetails(patentIds);
  console.log(`\nFetched details for ${patents.length} patents\n`);

  if (patents.length === 0) {
    console.error('No patent details could be fetched');
    process.exit(1);
  }

  // Run LLM analysis
  console.log('Starting LLM analysis...\n');
  const analyzer = new LLMPatentAnalyzerV3();

  const results = await analyzer.processBatches(patents, {
    batchSize: 5,
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total} (${Math.round(completed / total * 100)}%)`);
    },
  });

  // Save combined results
  const outputPath = await analyzer.saveResults(results);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total patents analyzed: ${results.length}`);
  console.log(`Output saved to: ${outputPath}`);

  // Show sample of new V3 fields
  if (results.length > 0) {
    console.log('\nSample V3 Analysis (first patent):');
    const sample = results[0];
    console.log(`  Patent: ${sample.patent_id}`);
    console.log(`  Technology: ${sample.technology_category}`);
    console.log(`  Implementation: ${sample.implementation_type}`);
    console.log(`  Standards: ${sample.standards_relevance} (${sample.standards_bodies.join(', ') || 'none'})`);
    console.log(`  Market Segment: ${sample.market_segment}`);
    console.log(`  Complexity: ${sample.implementation_complexity}`);
    console.log(`  Claim Type: ${sample.claim_type_primary}`);
    console.log(`  Scope: ${sample.geographic_scope}`);
    console.log(`  Lifecycle: ${sample.lifecycle_stage}`);
    console.log(`  Confidence: ${sample.confidence}`);
  }

  // Distribution of new fields
  console.log('\nDistributions:');

  const implementationTypes = new Map<string, number>();
  const standardsRelevance = new Map<string, number>();
  const marketSegments = new Map<string, number>();

  for (const r of results) {
    implementationTypes.set(r.implementation_type, (implementationTypes.get(r.implementation_type) || 0) + 1);
    standardsRelevance.set(r.standards_relevance, (standardsRelevance.get(r.standards_relevance) || 0) + 1);
    marketSegments.set(r.market_segment, (marketSegments.get(r.market_segment) || 0) + 1);
  }

  console.log('\n  Implementation Types:');
  for (const [type, count] of [...implementationTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  console.log('\n  Standards Relevance:');
  for (const [type, count] of [...standardsRelevance.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  console.log('\n  Market Segments:');
  for (const [type, count] of [...marketSegments.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }
}

main().catch(console.error);
