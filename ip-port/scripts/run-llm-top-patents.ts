/**
 * Run LLM Analysis on Top-Ranked Patents
 *
 * Scores all patents, takes the top N that lack LLM scores,
 * runs V3 LLM analysis, and saves results to cache/llm-scores/.
 *
 * Uses patent data from the local cache (no API calls for patent details).
 *
 * Usage:
 *   npx tsx scripts/run-llm-top-patents.ts --count 100
 *   npx tsx scripts/run-llm-top-patents.ts --count 500 --profile executive
 *   npx tsx scripts/run-llm-top-patents.ts --count 50 --batch-size 3 --dry-run
 *   npx tsx scripts/run-llm-top-patents.ts --sector cloud-computing --count 50
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

import { LLMPatentAnalyzerV3, PatentAnalysisV3 } from '../services/llm-patent-analysis-v3.js';

const PATENT_CACHE_DIR = path.join(process.cwd(), 'cache/api/patentsview/patent');
const LLM_SCORES_DIR = path.join(process.cwd(), 'cache/llm-scores');
const CANDIDATES_DIR = path.join(process.cwd(), 'output');

interface PatentInput {
  patent_id: string;
  title: string;
  abstract?: string;
  grant_date?: string;
  cpc_codes?: string[];
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadCandidates(): any[] {
  const files = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found in output/');
  }

  const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, files[0]), 'utf-8'));
  return data.candidates;
}

function loadClassifications(): Map<string, any> {
  const classDir = path.join(process.cwd(), 'cache/citation-classification');
  const summaryFiles = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('citation-classification-') && f.endsWith('.json'))
    .sort()
    .reverse();

  const map = new Map<string, any>();

  if (summaryFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, summaryFiles[0]), 'utf-8'));
    for (const result of data.results) {
      map.set(result.patent_id, result);
    }
  }

  return map;
}

function getExistingLlmPatentIds(): Set<string> {
  if (!fs.existsSync(LLM_SCORES_DIR)) return new Set();
  return new Set(
    fs.readdirSync(LLM_SCORES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  );
}

function simpleScore(candidate: any, classification: any): number {
  // Quick scoring for ranking — uses the same normalization as scoring-service
  const cc = classification?.competitor_citations ?? 0;
  const fc = candidate.forward_citations ?? 0;
  const years = candidate.remaining_years ?? 0;
  const count = classification?.competitor_count ?? 0;

  const ccNorm = Math.min(1, cc / 20);
  const fcNorm = Math.min(1, Math.sqrt(fc) / 30);
  const yearsNorm = Math.min(1, years / 15);
  const countNorm = Math.min(1, count / 5);

  // Executive profile weights (quantitative only, renormalized)
  const score = ccNorm * 0.40 + fcNorm * 0.20 + yearsNorm * 0.27 + countNorm * 0.13;
  const yearMult = 0.3 + 0.7 * Math.pow(Math.min(1, Math.max(0, years) / 15), 0.8);

  return score * yearMult * 100;
}

function loadPatentFromCache(patentId: string): PatentInput | null {
  const filepath = path.join(PATENT_CACHE_DIR, `${patentId}.json`);
  if (!fs.existsSync(filepath)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const patent = data.patents?.[0] || data;
    return {
      patent_id: patentId,
      title: patent.patent_title || '',
      abstract: patent.patent_abstract || undefined,
      grant_date: patent.patent_date || undefined,
      cpc_codes: patent.cpcs?.map((c: any) => c.cpc_group) || [],
    };
  } catch {
    return null;
  }
}

function saveLlmScore(analysis: PatentAnalysisV3): void {
  // Preserve ALL V3 fields — spread the full analysis and add metadata
  const record = {
    ...analysis,
    source: 'llm-top-patents',
    imported_at: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(LLM_SCORES_DIR, `${analysis.patent_id}.json`),
    JSON.stringify(record, null, 2)
  );
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const countIdx = args.indexOf('--count');
  const count = countIdx !== -1 ? parseInt(args[countIdx + 1] || '100') : 100;

  const sectorIdx = args.indexOf('--sector');
  const sectorFilter = sectorIdx !== -1 ? args[sectorIdx + 1] : null;

  const batchSizeIdx = args.indexOf('--batch-size');
  const batchSize = batchSizeIdx !== -1 ? parseInt(args[batchSizeIdx + 1] || '5') : 5;

  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  ensureDir(LLM_SCORES_DIR);

  console.log('='.repeat(60));
  console.log('LLM Analysis — Top Ranked Patents');
  console.log('='.repeat(60));
  console.log(`Target count:  ${count}`);
  console.log(`Batch size:    ${batchSize}`);
  if (sectorFilter) console.log(`Sector filter: ${sectorFilter}`);
  if (dryRun) console.log('DRY RUN — no LLM calls will be made');
  if (force) console.log('FORCE — will re-analyze patents with existing scores');
  console.log('');

  // 1. Load and score all patents
  console.log('Loading candidates and scoring...');
  const candidates = loadCandidates();
  const classifications = loadClassifications();
  const existingLlm = force ? new Set<string>() : getExistingLlmPatentIds();

  console.log(`  ${candidates.length} candidates, ${classifications.size} with citations, ${existingLlm.size} with LLM scores`);

  // 2. Score and rank, filter to those without LLM scores
  let scored = candidates
    .map(c => ({
      candidate: c,
      score: simpleScore(c, classifications.get(c.patent_id)),
    }))
    .sort((a, b) => b.score - a.score);

  // Apply sector filter
  if (sectorFilter) {
    scored = scored.filter(s => s.candidate.primary_sector === sectorFilter);
    console.log(`  ${scored.length} patents in sector "${sectorFilter}"`);
  }

  // Filter to those without LLM scores
  const needsLlm = scored.filter(s => !existingLlm.has(s.candidate.patent_id));
  console.log(`  ${needsLlm.length} patents need LLM analysis`);

  // Take top N
  const toAnalyze = needsLlm.slice(0, count);
  console.log(`  Will analyze top ${toAnalyze.length} patents`);

  if (toAnalyze.length === 0) {
    console.log('\nNo patents need LLM analysis. Use --force to re-analyze.');
    return;
  }

  // 3. Load patent details from cache
  console.log('\nLoading patent details from cache...');
  const patentInputs: PatentInput[] = [];

  for (const item of toAnalyze) {
    const patent = loadPatentFromCache(item.candidate.patent_id);
    if (patent) {
      patentInputs.push(patent);
    } else {
      console.warn(`  WARNING: No cached data for ${item.candidate.patent_id}`);
    }
  }

  console.log(`  Loaded ${patentInputs.length} patent details from cache`);

  if (dryRun) {
    console.log('\nDRY RUN — would analyze these patents:');
    for (let i = 0; i < Math.min(20, patentInputs.length); i++) {
      const p = patentInputs[i];
      const s = toAnalyze[i];
      console.log(`  ${i + 1}. ${p.patent_id} — score=${s.score.toFixed(1)} — ${p.title.substring(0, 60)}`);
    }
    if (patentInputs.length > 20) {
      console.log(`  ... and ${patentInputs.length - 20} more`);
    }
    console.log(`\nEstimated batches: ${Math.ceil(patentInputs.length / batchSize)}`);
    return;
  }

  // 4. Run LLM analysis
  console.log('\nStarting LLM analysis...');
  const analyzer = new LLMPatentAnalyzerV3();
  let totalAnalyzed = 0;
  let totalFailed = 0;

  const results = await analyzer.processBatches(patentInputs, {
    batchSize,
    onProgress: (completed, total) => {
      console.log(`  Progress: ${completed}/${total} (${Math.round(completed / total * 100)}%)`);
    },
  });

  // 5. Save results to cache
  console.log('\nSaving LLM scores to cache...');
  for (const analysis of results) {
    try {
      saveLlmScore(analysis);
      totalAnalyzed++;
    } catch (e) {
      console.error(`  Failed to save ${analysis.patent_id}:`, e);
      totalFailed++;
    }
  }

  // Also save combined output
  await analyzer.saveResults(results);

  // 6. Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`Patents analyzed:     ${totalAnalyzed}`);
  console.log(`Failed:               ${totalFailed}`);
  console.log(`Scores saved to:      ${LLM_SCORES_DIR}`);
  console.log(`Combined output:      output/llm-analysis-v3/`);
  console.log('');
  console.log('To use in V3 scoring:');
  console.log('  1. Restart the API server, or');
  console.log('  2. Call POST /api/scores/reload');

  // Show score distribution
  if (results.length > 0) {
    const avgElig = results.reduce((s, r) => s + r.eligibility_score, 0) / results.length;
    const avgValid = results.reduce((s, r) => s + r.validity_score, 0) / results.length;
    const avgBreadth = results.reduce((s, r) => s + r.claim_breadth, 0) / results.length;
    const avgEnforce = results.reduce((s, r) => s + r.enforcement_clarity, 0) / results.length;
    const avgDesign = results.reduce((s, r) => s + r.design_around_difficulty, 0) / results.length;

    console.log('\nAverage LLM Scores:');
    console.log(`  Eligibility:      ${avgElig.toFixed(2)}`);
    console.log(`  Validity:         ${avgValid.toFixed(2)}`);
    console.log(`  Claim Breadth:    ${avgBreadth.toFixed(2)}`);
    console.log(`  Enforcement:      ${avgEnforce.toFixed(2)}`);
    console.log(`  Design-Around:    ${avgDesign.toFixed(2)}`);
  }
}

main().catch(console.error);
