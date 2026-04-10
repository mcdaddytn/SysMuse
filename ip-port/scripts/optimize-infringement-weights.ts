/**
 * Grid Search Weight Optimizer for V3 Infringement Scoring
 *
 * Uses already-computed component scores from the control group (no new LLM calls).
 * Searches over weight space to find weights that maximize Pearson r + minimize MAE
 * against Patlytics scores.
 *
 * Usage:
 *   npx tsx scripts/optimize-infringement-weights.ts [options]
 *     --holdout <n>       Fraction to hold out for validation (default: 0.2)
 *     --iterations <n>    Number of random weight perturbations (default: 10000)
 *     --step <n>          Weight perturbation step size (default: 0.02)
 *     --pass <1|2|blend>  Which pass scores to optimize (default: blend)
 *     --seed <n>          Random seed for reproducibility
 */

import * as fs from 'fs';
import * as path from 'path';

const RESULTS_DIR = path.resolve('./cache/calibration-control/results-v3');
const TEMPLATES_DIR = path.resolve('./config/infringement-templates');

// ── Types ──────────────────────────────────────────────────────────────────

interface ComponentScore {
  score: number;
  normalized: number;
  reasoning: string;
}

interface PassResult {
  compositeScore: number;
  components: Record<string, ComponentScore>;
}

interface ControlResult {
  patentId: string;
  companySlug: string;
  productSlug: string;
  docSlug: string;
  patlyticsScore: number;
  pass1: PassResult;
  pass2: PassResult | null;
  finalScore: number;
}

interface Config {
  holdoutFraction: number;
  iterations: number;
  step: number;
  pass: 'pass1' | 'pass2' | 'blend';
  seed: number;
}

// ── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(): Config {
  const args = process.argv.slice(2);
  return {
    holdoutFraction: (() => { const i = args.indexOf('--holdout'); return i >= 0 ? parseFloat(args[i + 1]) : 0.2; })(),
    iterations: (() => { const i = args.indexOf('--iterations'); return i >= 0 ? parseInt(args[i + 1], 10) : 10000; })(),
    step: (() => { const i = args.indexOf('--step'); return i >= 0 ? parseFloat(args[i + 1]) : 0.02; })(),
    pass: (() => { const i = args.indexOf('--pass'); return i >= 0 ? args[i + 1] as any : 'blend'; })(),
    seed: (() => { const i = args.indexOf('--seed'); return i >= 0 ? parseInt(args[i + 1], 10) : 42; })(),
  };
}

// ── Stats ────────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const d = Math.sqrt(dx2 * dy2);
  return d === 0 ? 0 : num / d;
}

function mae(xs: number[], ys: number[]): number {
  return xs.reduce((s, v, i) => s + Math.abs(v - ys[i]), 0) / xs.length;
}

// ── Seeded RNG (xorshift32) ────────────────────────────────────────────

function createRng(seed: number) {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

// ── Score Computation with Custom Weights ──────────────────────────────

function computeScore(
  components: Record<string, ComponentScore>,
  weights: Record<string, number>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [field, weight] of Object.entries(weights)) {
    const comp = components[field];
    if (!comp || comp.score === 0) continue;
    weightedSum += comp.normalized * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function computeBlendedScore(
  result: ControlResult,
  weights: Record<string, number>,
  blendWeights: [number, number] = [0.3, 0.7],
): number {
  const p1 = computeScore(result.pass1.components, weights);
  if (!result.pass2) return p1;
  const p2 = computeScore(result.pass2.components, weights);
  return p1 * blendWeights[0] + p2 * blendWeights[1];
}

// ── Evaluation ─────────────────────────────────────────────────────────

function evaluate(
  results: ControlResult[],
  weights: Record<string, number>,
  passMode: string,
  blendWeights: [number, number] = [0.3, 0.7],
): { r: number; maeVal: number; scores: number[] } {
  const predicted = results.map(r => {
    if (passMode === 'pass1') {
      return computeScore(r.pass1.components, weights);
    } else if (passMode === 'pass2' && r.pass2) {
      return computeScore(r.pass2.components, weights);
    } else {
      return computeBlendedScore(r, weights, blendWeights);
    }
  });
  const actual = results.map(r => r.patlyticsScore);

  return {
    r: pearson(actual, predicted),
    maeVal: mae(actual, predicted),
    scores: predicted,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const config = parseArgs();

  // Load results
  if (!fs.existsSync(RESULTS_DIR)) {
    console.error(`No V3 results found at ${RESULTS_DIR}. Run score-control-group.ts first.`);
    process.exit(1);
  }

  const allResults: ControlResult[] = [];
  for (const f of fs.readdirSync(RESULTS_DIR)) {
    if (!f.endsWith('.json')) continue;
    allResults.push(JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf-8')));
  }

  if (allResults.length === 0) {
    console.error('No results files found.');
    process.exit(1);
  }

  // Filter to results with pass2 (if optimizing blend/pass2)
  const withPass2 = allResults.filter(r => r.pass2 !== null);
  const results = config.pass === 'pass1' ? allResults : withPass2;

  console.log(`=== V3 Infringement Weight Optimizer ===`);
  console.log(`Total results: ${allResults.length} (${withPass2.length} with Pass 2)`);
  console.log(`Optimizing: ${config.pass} scores`);
  console.log(`Holdout fraction: ${config.holdoutFraction}`);
  console.log(`Iterations: ${config.iterations}`);
  console.log(`Step size: ${config.step}`);
  console.log(`Seed: ${config.seed}`);

  // Load default weights from template
  const defaultTemplate = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, 'default.json'), 'utf-8'));
  const fieldNames: string[] = defaultTemplate.questions.map((q: any) => q.fieldName);
  const defaultWeights: Record<string, number> = {};
  for (const q of defaultTemplate.questions) {
    defaultWeights[q.fieldName] = q.weight;
  }

  // Split train/validation
  const rng = createRng(config.seed);
  const shuffled = [...results].sort(() => rng() - 0.5);
  const holdoutCount = Math.max(1, Math.round(results.length * config.holdoutFraction));
  const validation = shuffled.slice(0, holdoutCount);
  const training = shuffled.slice(holdoutCount);

  console.log(`\nTraining: ${training.length} pairs, Validation: ${validation.length} pairs`);

  // Evaluate default weights
  const defaultEval = evaluate(training, defaultWeights, config.pass);
  const defaultValEval = evaluate(validation, defaultWeights, config.pass);
  console.log(`\nDefault weights: train r=${defaultEval.r.toFixed(4)} MAE=${defaultEval.maeVal.toFixed(4)} | val r=${defaultValEval.r.toFixed(4)} MAE=${defaultValEval.maeVal.toFixed(4)}`);

  // Grid search: random perturbations
  let bestWeights = { ...defaultWeights };
  let bestObjective = defaultEval.r - defaultEval.maeVal; // maximize r, minimize MAE
  let bestR = defaultEval.r;
  let bestMAE = defaultEval.maeVal;
  let improvements = 0;

  // Also try optimizing blend weights
  let bestBlend: [number, number] = [0.3, 0.7];

  for (let iter = 0; iter < config.iterations; iter++) {
    // Perturb one or two weights
    const candidate = { ...bestWeights };
    const numPerturb = rng() < 0.3 ? 2 : 1;

    for (let p = 0; p < numPerturb; p++) {
      const field = fieldNames[Math.floor(rng() * fieldNames.length)];
      const delta = (rng() - 0.5) * 2 * config.step;
      candidate[field] = Math.max(0, candidate[field] + delta);
    }

    // Normalize
    const total = Object.values(candidate).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    for (const field of fieldNames) {
      candidate[field] = candidate[field] / total;
    }

    // Occasionally try different blend weights
    let candidateBlend: [number, number] = bestBlend;
    if (rng() < 0.1 && config.pass === 'blend') {
      const p1w = Math.max(0.1, Math.min(0.5, bestBlend[0] + (rng() - 0.5) * 0.1));
      candidateBlend = [p1w, 1 - p1w];
    }

    const eval_ = evaluate(training, candidate, config.pass, candidateBlend);
    const objective = eval_.r - eval_.maeVal;

    if (objective > bestObjective) {
      bestWeights = candidate;
      bestObjective = objective;
      bestR = eval_.r;
      bestMAE = eval_.maeVal;
      bestBlend = candidateBlend;
      improvements++;
    }
  }

  console.log(`\nOptimization complete: ${improvements} improvements found`);

  // Evaluate best on training and validation
  const trainEval = evaluate(training, bestWeights, config.pass, bestBlend);
  const valEval = evaluate(validation, bestWeights, config.pass, bestBlend);

  console.log(`\n${'─'.repeat(60)}`);
  console.log('RESULTS');
  console.log(`${'─'.repeat(60)}`);

  console.log(`\n${''.padEnd(20)} ${'Training'.padStart(20)} ${'Validation'.padStart(20)}`);
  console.log(`${'Default r'.padEnd(20)} ${defaultEval.r.toFixed(4).padStart(20)} ${defaultValEval.r.toFixed(4).padStart(20)}`);
  console.log(`${'Default MAE'.padEnd(20)} ${defaultEval.maeVal.toFixed(4).padStart(20)} ${defaultValEval.maeVal.toFixed(4).padStart(20)}`);
  console.log(`${'Optimized r'.padEnd(20)} ${trainEval.r.toFixed(4).padStart(20)} ${valEval.r.toFixed(4).padStart(20)}`);
  console.log(`${'Optimized MAE'.padEnd(20)} ${trainEval.maeVal.toFixed(4).padStart(20)} ${valEval.maeVal.toFixed(4).padStart(20)}`);

  if (config.pass === 'blend') {
    console.log(`\nBlend weights: Pass1=${bestBlend[0].toFixed(2)}, Pass2=${bestBlend[1].toFixed(2)}`);
  }

  // Show optimized weights
  console.log(`\n${'Component'.padEnd(35)} ${'Default'.padStart(8)} ${'Optimized'.padStart(10)} ${'Δ'.padStart(8)}`);
  console.log('─'.repeat(65));
  for (const field of fieldNames) {
    const def = defaultWeights[field];
    const opt = bestWeights[field];
    const delta = opt - def;
    console.log(
      `${field.padEnd(35)} ${def.toFixed(3).padStart(8)} ${opt.toFixed(3).padStart(10)} ${(delta >= 0 ? '+' : '') + delta.toFixed(3).padStart(7)}`
    );
  }

  // Check for overfitting
  const rDiff = Math.abs(trainEval.r - valEval.r);
  const maeDiff = Math.abs(trainEval.maeVal - valEval.maeVal);
  console.log(`\nOverfitting check:`);
  console.log(`  r gap (train-val): ${rDiff.toFixed(4)} ${rDiff > 0.15 ? '⚠️  POSSIBLE OVERFIT' : '✓ OK'}`);
  console.log(`  MAE gap (train-val): ${maeDiff.toFixed(4)} ${maeDiff > 0.05 ? '⚠️  POSSIBLE OVERFIT' : '✓ OK'}`);

  // Output optimized template snippet
  console.log(`\n${'─'.repeat(60)}`);
  console.log('OPTIMIZED WEIGHTS (copy to default.json):');
  console.log(`${'─'.repeat(60)}`);
  for (const field of fieldNames) {
    console.log(`  "${field}": ${bestWeights[field].toFixed(3)}`);
  }

  // Per-component analysis on full dataset
  console.log(`\n${'─'.repeat(60)}`);
  console.log('PER-COMPONENT CORRELATION (full dataset, default weights)');
  console.log(`${'─'.repeat(60)}`);

  const allPatlytics = allResults.map(r => r.patlyticsScore);
  console.log(`\n${'Component'.padEnd(35)} ${'r (P1)'.padStart(8)} ${'r (P2)'.padStart(8)} ${'r (Blend)'.padStart(10)}`);
  console.log('─'.repeat(65));

  for (const field of fieldNames) {
    const p1Scores = allResults.map(r => r.pass1.components[field]?.normalized || 0);
    const rP1 = pearson(allPatlytics, p1Scores);

    const p2Results = allResults.filter(r => r.pass2);
    const p2Patlytics = p2Results.map(r => r.patlyticsScore);
    const p2Scores = p2Results.map(r => r.pass2!.components[field]?.normalized || 0);
    const rP2 = p2Results.length >= 3 ? pearson(p2Patlytics, p2Scores) : 0;

    const blendScores = allResults.map(r => {
      const p1 = r.pass1.components[field]?.normalized || 0;
      const p2 = r.pass2?.components[field]?.normalized || p1;
      return p1 * 0.3 + p2 * 0.7;
    });
    const rBlend = pearson(allPatlytics, blendScores);

    console.log(
      `${field.padEnd(35)} ${rP1.toFixed(4).padStart(8)} ${rP2.toFixed(4).padStart(8)} ${rBlend.toFixed(4).padStart(10)}`
    );
  }
}

main();
