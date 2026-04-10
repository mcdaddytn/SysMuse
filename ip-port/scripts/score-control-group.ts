/**
 * Score the calibration control group — exact same docs Patlytics scored.
 *
 * Reads the control group manifest, runs Pass 1 + Pass 2 on each pair,
 * and outputs a same-document calibration comparison.
 *
 * Usage:
 *   npx tsx scripts/score-control-group.ts [options]
 *     --concurrency <n>   Parallel LLM calls (default: 5)
 *     --pass1-only        Only run screening pass
 *     --dry-run           Show pairs without scoring
 *     --force             Re-score even if cached
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import {
  extractClaimsText,
  findXmlPath,
  parsePatentClaims,
  type PatentClaim,
} from '../src/api/services/patent-xml-parser-service.js';

const anthropic = new Anthropic();

const CONTROL_DIR = path.resolve('./cache/calibration-control');
const RESULTS_DIR = path.join(CONTROL_DIR, 'results');
const XML_DIR = process.env.USPTO_PATENT_GRANT_XML_DIR || '';
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 2000;
const MAX_DOC_TEXT_LENGTH = 300_000;
const MIN_TEXT_BYTES = 500;

// ── Types ──────────────────────────────────────────────────────────────────

interface ManifestPair {
  patentId: string;
  companySlug: string;
  productSlug: string;
  documentName: string;
  docSlug: string;
  patlyticsScore: number;
  patlyticsNarrative: string | null;
  isPdf: boolean;
  textPath: string;
}

interface ControlResult {
  patentId: string;
  companySlug: string;
  productSlug: string;
  docSlug: string;
  documentName: string;
  patlyticsScore: number;
  pass1Score: number;
  pass1Rationale: string;
  pass2RawScore: number | null;
  finalScore: number | null;
  narrative: string | null;
  strongestClaim: number | null;
  keyGaps: string[] | null;
  textLength: number;
  model: string;
  scoredAt: string;
}

interface Config {
  concurrency: number;
  pass1Only: boolean;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  return {
    concurrency: (() => { const i = args.indexOf('--concurrency'); return i >= 0 ? parseInt(args[i + 1], 10) : 5; })(),
    pass1Only: args.includes('--pass1-only'),
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
  };
}

function ensureDir(d: string) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// ── LLM ────────────────────────────────────────────────────────────────────

async function callLLM(prompt: string, maxTokens: number = 4096): Promise<string> {
  let response: Anthropic.Messages.Message | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });
      break;
    } catch (err: any) {
      const status = err?.status || err?.error?.status;
      if ((status === 429 || status === 529 || err?.message?.includes('overloaded')) && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * RETRY_BASE_DELAY));
        continue;
      }
      throw err;
    }
  }
  if (!response) throw new Error('No response');
  return response.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text').map(b => b.text).join('');
}

function parseJSON(text: string): any {
  // Try direct parse first
  try { return JSON.parse(text); } catch {}
  // Try markdown fenced JSON
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1]); } catch {}
  // Try to find JSON object in text (model sometimes adds reasoning before JSON)
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try { return JSON.parse(text.substring(jsonStart, jsonEnd + 1)); } catch {}
  }
  throw new Error(`JSON parse failed: ${text.substring(0, 200)}`);
}

// ── Patent Loading ─────────────────────────────────────────────────────────

function loadPatentClaims(patentId: string): PatentClaim[] {
  if (!XML_DIR) return [];
  const xmlPath = findXmlPath(patentId, XML_DIR);
  if (!xmlPath) return [];
  return parsePatentClaims(xmlPath).independentClaims;
}

function loadPatentAbstract(patentId: string): string | null {
  try {
    const p = path.join(process.cwd(), 'cache/api/patentsview/patent', `${patentId}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')).patent_abstract || null;
  } catch {}
  return null;
}

function formatClaims(claims: PatentClaim[], max: number = 5): string {
  return claims.slice(0, max).map(c => `Claim ${c.number}: ${c.text}`).join('\n\n');
}

// ── Prompts ────────────────────────────────────────────────────────────────

const PASS1_PROMPT = `You are a patent infringement screening analyst assessing whether a product's described capabilities align with patent claims.

CRITICAL CONTEXT: Patent claims use abstract, functional language (e.g., "network operating system," "flow entries," "managed switching elements"). Product documentation uses concrete implementation language (e.g., "cloud management console," "routing policies," "network devices"). Your job is to see through terminology differences and assess FUNCTIONAL alignment.

A product that manages network state via policies IS functionally equivalent to one that uses "flow tables," even if the term "flow table" never appears. A cloud service that centralizes network control IS a form of "network operating system." Focus on WHAT the system does, not what it's CALLED.

Scoring guidelines — use the FULL range:
- 0.80-1.0: The product clearly implements the core method/system described in the claims. Most claim functions are present even if described differently.
- 0.60-0.79: Strong functional overlap. The product operates in the same technology domain and implements most of the claimed functions, though some specifics differ or aren't fully documented.
- 0.40-0.59: Moderate overlap. The product shares the technology domain and implements some claimed functions, but significant architectural differences or gaps exist.
- 0.20-0.39: Weak overlap. Tangential technology area, few functional parallels.
- 0.00-0.19: No meaningful functional overlap.

Respond as JSON (no markdown fencing):
{
  "score": 0.XX,
  "rationale": "2-3 sentence explanation of functional alignment and key gaps"
}`;

const PASS2_PROMPT = `You are a patent infringement analyst. Determine whether the product described in this documentation practices the claimed invention.

CRITICAL CONTEXT ON TERMINOLOGY:
Patent claims use formal, abstract language. Product documentation uses practical, implementation-specific language. These describe the SAME things differently:
- Patent: "network operating system" → Product: "management platform," "control plane," "orchestrator"
- Patent: "flow entries/flow tables" → Product: "routing rules," "forwarding policies," "ACLs," "route tables"
- Patent: "managed switching elements" → Product: "switches," "routers," "network devices," "nodes"
- Patent: "logical datapath set" → Product: "virtual network," "VRF," "tenant network," "overlay"
This applies across ALL technology domains, not just networking.

ANALYSIS STEPS:
1. First, identify what the patent claims are fundamentally about (the core method/system).
2. Then assess: Does this product implement that core method/system?
3. For each claim element, determine disclosure:
   - DISCLOSED: The document describes this function/component (even with different terminology)
   - PARTIALLY: The product would necessarily include this as part of its described architecture, OR a functional equivalent exists
   - NOT_DISCLOSED: No evidence and no reasonable inference possible

SCORING — HOW TO WEIGHT ELEMENTS:
- DISCLOSED elements count fully toward the score
- PARTIALLY elements count at 60-80% (they represent real functional alignment)
- NOT_DISCLOSED elements count at 0%
- If most elements are PARTIALLY with a few DISCLOSED: score should be 0.60-0.80
- If most elements are PARTIALLY with some NOT_DISCLOSED: score should be 0.40-0.65
- Only score below 0.20 if the product has NO functional relationship to the patent

AFTER element analysis, step back and assess: "Would someone skilled in the art, reading this product documentation, recognize that this product likely practices the claimed invention?" If yes, your score should be at least 0.60 even if specific implementation details aren't documented.

Respond as JSON (no markdown fencing):
{
  "score": 0.XX,
  "claimAnalysis": [
    {
      "claimNumber": 1,
      "elements": [
        { "element": "...", "status": "DISCLOSED|PARTIALLY|NOT_DISCLOSED", "evidence": "..." }
      ],
      "claimScore": 0.XX
    }
  ],
  "narrative": "2-4 sentence summary of functional alignment between the product and patent claims.",
  "strongestClaim": 1,
  "keyGaps": ["List of claim elements with NO functional equivalent in the documentation"]
}`;

// ── Scoring ────────────────────────────────────────────────────────────────

async function scorePair(pair: ManifestPair, config: Config): Promise<ControlResult | null> {
  const textPath = pair.textPath;
  if (!fs.existsSync(textPath)) return null;
  const stat = fs.statSync(textPath);
  if (stat.size < MIN_TEXT_BYTES) return null;

  const claims = loadPatentClaims(pair.patentId);
  if (claims.length === 0) return null;

  const claimsText = formatClaims(claims, 5);
  const abstract = loadPatentAbstract(pair.patentId);
  const docText = fs.readFileSync(textPath, 'utf-8');
  const abstractPart = abstract ? `\nPatent Abstract: ${abstract}\n` : '';

  // Pass 1
  const p1Prompt = `${PASS1_PROMPT}\n\n--- PATENT CLAIMS ---\n${claimsText}\n${abstractPart}\n--- PRODUCT DOCUMENTATION (first 15K chars) ---\n${docText.substring(0, 15000)}\n--- END ---`;
  const p1Response = parseJSON(await callLLM(p1Prompt, 1024));
  const pass1Score = typeof p1Response.score === 'number' ? p1Response.score : 0;
  const pass1Rationale = p1Response.rationale || '';

  const result: ControlResult = {
    patentId: pair.patentId,
    companySlug: pair.companySlug,
    productSlug: pair.productSlug,
    docSlug: pair.docSlug,
    documentName: pair.documentName,
    patlyticsScore: pair.patlyticsScore,
    pass1Score,
    pass1Rationale,
    pass2RawScore: null,
    finalScore: null,
    narrative: null,
    strongestClaim: null,
    keyGaps: null,
    textLength: docText.length,
    model: 'claude-sonnet-4-20250514',
    scoredAt: new Date().toISOString(),
  };

  // Pass 2 if above threshold or if Patlytics scored it high (always do Pass 2 for control group)
  if (!config.pass1Only) {
    const truncDoc = docText.length > MAX_DOC_TEXT_LENGTH
      ? docText.substring(0, MAX_DOC_TEXT_LENGTH) + '\n\n[... truncated ...]'
      : docText;
    const p2Prompt = `${PASS2_PROMPT}\n\n--- PATENT CLAIMS ---\n${formatClaims(claims, 10)}\n${abstractPart}\n--- PRODUCT DOCUMENTATION ---\n${truncDoc}\n--- END ---`;
    const p2Response = parseJSON(await callLLM(p2Prompt, 8192));
    const p2Score = typeof p2Response.score === 'number' ? p2Response.score : pass1Score;
    result.pass2RawScore = p2Score;
    // Use max of Pass 1 and Pass 2 — Pass 2 adds detail but shouldn't penalize
    // when it over-focuses on literal claim element matching
    result.finalScore = Math.max(pass1Score, p2Score);
    result.narrative = p2Response.narrative || '';
    result.strongestClaim = p2Response.strongestClaim || null;
    result.keyGaps = p2Response.keyGaps || [];
  }

  return result;
}

// ── Analysis ───────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const d = Math.sqrt(dx2 * dy2);
  return d === 0 ? 0 : num / d;
}

function printAnalysis(results: ControlResult[]) {
  const ps = results.map(r => r.patlyticsScore);
  const p1s = results.map(r => r.pass1Score);
  const finals = results.map(r => r.finalScore ?? r.pass1Score);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SAME-DOCUMENT CALIBRATION (N=${results.length})`);
  console.log(`${'='.repeat(60)}`);

  console.log(`\nPatlytics mean: ${(ps.reduce((a, b) => a + b, 0) / ps.length).toFixed(3)}`);
  console.log(`Pass 1 mean:    ${(p1s.reduce((a, b) => a + b, 0) / p1s.length).toFixed(3)}`);
  console.log(`Final mean:     ${(finals.reduce((a, b) => a + b, 0) / finals.length).toFixed(3)}`);

  const rP1 = pearson(ps, p1s);
  const rFinal = pearson(ps, finals);
  const maeP1 = p1s.reduce((s, v, i) => s + Math.abs(v - ps[i]), 0) / ps.length;
  const maeFinal = finals.reduce((s, v, i) => s + Math.abs(v - ps[i]), 0) / ps.length;
  const biasP1 = p1s.reduce((s, v, i) => s + (v - ps[i]), 0) / ps.length;
  const biasFinal = finals.reduce((s, v, i) => s + (v - ps[i]), 0) / ps.length;

  console.log(`\n${'Metric'.padEnd(25)} ${'Pass 1'.padStart(10)} ${'Final'.padStart(10)}`);
  console.log(`${'─'.repeat(45)}`);
  console.log(`${'Pearson r'.padEnd(25)} ${rP1.toFixed(4).padStart(10)} ${rFinal.toFixed(4).padStart(10)}`);
  console.log(`${'MAE'.padEnd(25)} ${maeP1.toFixed(4).padStart(10)} ${maeFinal.toFixed(4).padStart(10)}`);
  console.log(`${'Bias (internal-patlytics)'.padEnd(25)} ${(biasP1 >= 0 ? '+' : '') + biasP1.toFixed(4)} ${(biasFinal >= 0 ? '+' : '') + biasFinal.toFixed(4)}`);

  // Count how often max(P1,P2) lifted the score vs just using P2
  const withP2 = results.filter(r => r.pass2RawScore !== null && r.pass2RawScore !== undefined);
  if (withP2.length > 0) {
    const lifted = withP2.filter(r => r.pass1Score > r.pass2RawScore!);
    console.log(`\nPass 2 overcorrection: ${lifted.length}/${withP2.length} (${((lifted.length/withP2.length)*100).toFixed(0)}%) pairs where Pass 1 > Pass 2 raw`);
    console.log(`  (max(P1,P2) strategy lifted these to use Pass 1 score instead)`);
  }

  // Detail table
  console.log(`\n${'Patent'.padEnd(10)} ${'Company'.padEnd(22)} ${'Patlytics'.padStart(9)} ${'Pass1'.padStart(7)} ${'P2raw'.padStart(7)} ${'Final'.padStart(7)} ${'Δ'.padStart(6)} ${'TextKB'.padStart(7)}`);
  console.log('─'.repeat(78));
  const sorted = [...results].sort((a, b) => Math.abs(b.patlyticsScore - (b.finalScore ?? b.pass1Score)) - Math.abs(a.patlyticsScore - (a.finalScore ?? a.pass1Score)));
  for (const r of sorted) {
    const final = r.finalScore ?? r.pass1Score;
    const delta = final - r.patlyticsScore;
    const p2raw = r.pass2RawScore !== null && r.pass2RawScore !== undefined ? r.pass2RawScore.toFixed(2) : 'n/a';
    console.log(`${r.patentId.padEnd(10)} ${r.companySlug.substring(0, 21).padEnd(22)} ${r.patlyticsScore.toFixed(2).padStart(9)} ${r.pass1Score.toFixed(2).padStart(7)} ${p2raw.padStart(7)} ${(r.finalScore !== null ? r.finalScore.toFixed(2) : 'n/a').padStart(7)} ${(delta >= 0 ? '+' : '') + delta.toFixed(2)} ${(r.textLength / 1024).toFixed(0).padStart(6)}K`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  const manifestPath = path.join(CONTROL_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('No control group manifest. Run build-control-group.ts --download first.');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  let pairs: ManifestPair[] = manifest.pairs;

  // Filter to pairs with extracted text
  pairs = pairs.filter(p => fs.existsSync(p.textPath) && fs.statSync(p.textPath).size >= MIN_TEXT_BYTES);

  console.log(`=== Control Group Scoring ===`);
  console.log(`Pairs with text: ${pairs.length}`);
  console.log(`Concurrency: ${config.concurrency}`);
  if (config.pass1Only) console.log('MODE: Pass 1 only');
  if (config.dryRun) console.log('MODE: DRY RUN');

  if (config.dryRun) {
    for (const p of pairs) {
      const size = fs.statSync(p.textPath).size;
      console.log(`  ${p.patentId} × ${p.companySlug}/${p.docSlug.substring(0, 30)}: P=${p.patlyticsScore.toFixed(2)} (${(size / 1024).toFixed(0)}K)`);
    }
    return;
  }

  // Filter cached
  if (!config.force) {
    const before = pairs.length;
    pairs = pairs.filter(p => {
      const rp = path.join(RESULTS_DIR, `${p.companySlug}_${p.docSlug}_${p.patentId}.json`);
      return !fs.existsSync(rp);
    });
    if (before !== pairs.length) console.log(`Filtered to ${pairs.length} unscored (${before - pairs.length} cached)`);
  }

  if (pairs.length === 0) { console.log('All pairs already scored.'); return; }

  ensureDir(RESULTS_DIR);
  const results: ControlResult[] = [];
  let completed = 0, failed = 0;

  for (let i = 0; i < pairs.length; i += config.concurrency) {
    const batch = pairs.slice(i, i + config.concurrency);
    console.log(`\n--- Batch ${Math.floor(i / config.concurrency) + 1}/${Math.ceil(pairs.length / config.concurrency)} ---`);

    const promises = batch.map(async (pair) => {
      try {
        console.log(`  ${pair.patentId} × ${pair.companySlug}/${pair.docSlug.substring(0, 30)} (P=${pair.patlyticsScore.toFixed(2)})`);
        const result = await scorePair(pair, config);
        if (!result) { console.log(`    Skipped`); return; }

        const final = result.finalScore ?? result.pass1Score;
        const delta = final - pair.patlyticsScore;
        console.log(`    P1=${result.pass1Score.toFixed(2)} F=${result.finalScore !== null ? result.finalScore.toFixed(2) : 'n/a'} Δ=${(delta >= 0 ? '+' : '') + delta.toFixed(2)}`);

        // Cache result
        const rp = path.join(RESULTS_DIR, `${pair.companySlug}_${pair.docSlug}_${pair.patentId}.json`);
        fs.writeFileSync(rp, JSON.stringify(result, null, 2));
        results.push(result);
        completed++;
      } catch (err) {
        console.error(`    FAILED: ${err instanceof Error ? err.message : err}`);
        failed++;
      }
    });
    await Promise.all(promises);
  }

  // Load any previously cached results too
  if (fs.existsSync(RESULTS_DIR)) {
    for (const f of fs.readdirSync(RESULTS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8'));
      if (!results.find(x => x.patentId === r.patentId && x.docSlug === r.docSlug)) {
        results.push(r);
      }
    }
  }

  console.log(`\nCompleted: ${completed}, Failed: ${failed}`);
  printAnalysis(results);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
