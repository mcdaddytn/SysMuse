/**
 * Calibration: compare internal infringement scores against Patlytics ground truth.
 *
 * Finds all patent-product-document triples that have BOTH a Patlytics score
 * and an internal score, then computes correlation metrics and flags disagreements.
 *
 * Usage:
 *   npx tsx scripts/calibrate-infringement.ts [options]
 *     --output <dir>   Output directory (default: output/calibration-report)
 *     --threshold <n>  Flag disagreements above this delta (default: 0.25)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getAllProductCaches,
  readProductCache,
  slugify,
  type DocumentPatentScore,
} from '../src/api/services/patlytics-cache-service.js';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const SOURCE_VERSION = 'internal-v1';

// ── Types ──────────────────────────────────────────────────────────────────

interface CalibrationPair {
  patentId: string;
  companySlug: string;
  companyName: string;
  productSlug: string;
  productName: string;
  documentName: string;
  docSlug: string;
  patlyticsScore: number;
  patlyticsNarrative: string | null;
  internalPass1Score: number | null;
  internalFinalScore: number | null;
  internalNarrative: string | null;
  delta: number; // |patlytics - internal|
}

interface Config {
  outputDir: string;
  threshold: number;
}

// ── CLI Parsing ────────────────────────────────────────────────────────────

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let outputDir = 'output/calibration-report';
  let threshold = 0.25;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' && args[i + 1]) outputDir = args[++i];
    else if (arg === '--threshold' && args[i + 1]) threshold = parseFloat(args[++i]);
  }

  return { outputDir, threshold };
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ── Data Loading ───────────────────────────────────────────────────────────

interface InternalScore {
  pass1Score: number;
  finalScore: number | null;
  narrative: string | null;
}

function loadInternalScore(companySlug: string, productSlug: string, patentId: string): InternalScore | null {
  const filePath = path.join(SCORES_DIR, companySlug, productSlug, `${patentId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return {
      pass1Score: data.pass1Score,
      finalScore: data.finalScore,
      narrative: data.narrative,
    };
  } catch {
    return null;
  }
}

function findCalibrationPairs(): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  const products = getAllProductCaches();

  for (const productMeta of products) {
    const product = readProductCache(productMeta.companySlug, productMeta.productSlug);
    if (!product) continue;

    for (const doc of product.documents) {
      if (!doc.patentScores || Object.keys(doc.patentScores).length === 0) continue;

      const docBase = doc.localPath ? path.basename(doc.localPath, path.extname(doc.localPath)) : '';
      const docSlug = slugify(doc.documentName || docBase);

      for (const [patentId, score] of Object.entries(doc.patentScores)) {
        // Only Patlytics scores (no sourceFile or not internal-v1)
        if ((score as any).sourceFile === SOURCE_VERSION) continue;

        // Check for matching internal score
        const internal = loadInternalScore(product.companySlug, product.productSlug, patentId);
        if (!internal) continue;

        const internalScore = internal.finalScore ?? internal.pass1Score;
        const delta = Math.abs(score.score - internalScore);

        pairs.push({
          patentId,
          companySlug: product.companySlug,
          companyName: product.companyName,
          productSlug: product.productSlug,
          productName: product.productName,
          documentName: doc.documentName,
          docSlug,
          patlyticsScore: score.score,
          patlyticsNarrative: score.narrative,
          internalPass1Score: internal.pass1Score,
          internalFinalScore: internal.finalScore,
          internalNarrative: internal.narrative,
          delta,
        });
      }
    }
  }

  return pairs;
}

// ── Statistics ──────────────────────────────────────────────────────────────

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0, denomX = 0, denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  return denom === 0 ? 0 : num / denom;
}

function meanAbsoluteError(xs: number[], ys: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += Math.abs(xs[i] - ys[i]);
  }
  return sum / xs.length;
}

function rootMeanSquaredError(xs: number[], ys: number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += Math.pow(xs[i] - ys[i], 2);
  }
  return Math.sqrt(sum / xs.length);
}

function scoreDistribution(scores: number[]): Record<string, number> {
  const bins: Record<string, number> = {
    '0.00-0.19': 0,
    '0.20-0.39': 0,
    '0.40-0.59': 0,
    '0.60-0.79': 0,
    '0.80-1.00': 0,
  };

  for (const s of scores) {
    if (s < 0.20) bins['0.00-0.19']++;
    else if (s < 0.40) bins['0.20-0.39']++;
    else if (s < 0.60) bins['0.40-0.59']++;
    else if (s < 0.80) bins['0.60-0.79']++;
    else bins['0.80-1.00']++;
  }

  return bins;
}

// ── Report Generation ──────────────────────────────────────────────────────

function generateReport(pairs: CalibrationPair[], config: Config): string {
  const patlyticsScores = pairs.map(p => p.patlyticsScore);
  const internalScores = pairs.map(p => p.internalFinalScore ?? p.internalPass1Score!);

  const r = pearsonCorrelation(patlyticsScores, internalScores);
  const mae = meanAbsoluteError(patlyticsScores, internalScores);
  const rmse = rootMeanSquaredError(patlyticsScores, internalScores);

  const patlyticsAvg = patlyticsScores.reduce((a, b) => a + b, 0) / patlyticsScores.length;
  const internalAvg = internalScores.reduce((a, b) => a + b, 0) / internalScores.length;
  const bias = internalAvg - patlyticsAvg;

  const patlyticsDist = scoreDistribution(patlyticsScores);
  const internalDist = scoreDistribution(internalScores);

  const disagreements = pairs.filter(p => p.delta >= config.threshold)
    .sort((a, b) => b.delta - a.delta);

  const pairsWithPass2 = pairs.filter(p => p.internalFinalScore !== null);

  let report = `# Infringement Score Calibration Report

Generated: ${new Date().toISOString()}
Calibration pairs: ${pairs.length}
Pairs with Pass 2 (deep analysis): ${pairsWithPass2.length}

## Correlation Metrics

| Metric | Value |
|--------|-------|
| Pearson r | ${r.toFixed(4)} |
| Mean Absolute Error (MAE) | ${mae.toFixed(4)} |
| Root Mean Squared Error (RMSE) | ${rmse.toFixed(4)} |
| Bias (internal - patlytics) | ${bias >= 0 ? '+' : ''}${bias.toFixed(4)} |
| Patlytics mean score | ${patlyticsAvg.toFixed(3)} |
| Internal mean score | ${internalAvg.toFixed(3)} |

## Interpretation

`;

  if (r >= 0.8) report += `**Strong correlation** (r=${r.toFixed(2)}). Internal scores align well with Patlytics.\n`;
  else if (r >= 0.6) report += `**Moderate correlation** (r=${r.toFixed(2)}). Reasonable alignment; consider prompt tuning.\n`;
  else if (r >= 0.4) report += `**Weak correlation** (r=${r.toFixed(2)}). Significant divergence from Patlytics. Review scoring prompts.\n`;
  else report += `**Poor correlation** (r=${r.toFixed(2)}). Internal scoring needs significant recalibration.\n`;

  if (Math.abs(bias) > 0.10) {
    report += `\n**Systematic bias detected**: Internal scores are ${bias > 0 ? 'higher' : 'lower'} than Patlytics by ${Math.abs(bias).toFixed(2)} on average.`;
    if (bias > 0) report += ` Consider adding calibration to reduce scores by ~${Math.abs(bias).toFixed(2)}.\n`;
    else report += ` Consider making scoring prompts more sensitive to partial disclosures.\n`;
  }

  report += `
## Score Distribution

| Range | Patlytics | Internal |
|-------|-----------|----------|
`;
  for (const range of Object.keys(patlyticsDist)) {
    report += `| ${range} | ${patlyticsDist[range]} (${((patlyticsDist[range] / pairs.length) * 100).toFixed(0)}%) | ${internalDist[range]} (${((internalDist[range] / pairs.length) * 100).toFixed(0)}%) |\n`;
  }

  report += `
## Large Disagreements (delta >= ${config.threshold})

Found ${disagreements.length} pairs with score difference >= ${config.threshold}:

`;

  if (disagreements.length === 0) {
    report += `No large disagreements found.\n`;
  } else {
    report += `| Patent | Company | Product | Document | Patlytics | Internal | Delta |\n`;
    report += `|--------|---------|---------|----------|-----------|----------|-------|\n`;
    for (const d of disagreements.slice(0, 50)) {
      const internalScore = d.internalFinalScore ?? d.internalPass1Score!;
      report += `| ${d.patentId} | ${d.companyName} | ${d.productName} | ${d.documentName.substring(0, 40)} | ${d.patlyticsScore.toFixed(2)} | ${internalScore.toFixed(2)} | ${d.delta.toFixed(2)} |\n`;
    }
    if (disagreements.length > 50) {
      report += `\n(Showing top 50 of ${disagreements.length} disagreements)\n`;
    }
  }

  report += `
## All Calibration Pairs

| Patent | Company | Product | Patlytics | Pass1 | Final | Delta |
|--------|---------|---------|-----------|-------|-------|-------|
`;
  for (const p of pairs.sort((a, b) => b.delta - a.delta)) {
    const finalStr = p.internalFinalScore !== null ? p.internalFinalScore.toFixed(2) : 'n/a';
    const pass1Str = p.internalPass1Score !== null ? p.internalPass1Score.toFixed(2) : 'n/a';
    report += `| ${p.patentId} | ${p.companyName} | ${p.productName} | ${p.patlyticsScore.toFixed(2)} | ${pass1Str} | ${finalStr} | ${p.delta.toFixed(2)} |\n`;
  }

  return report;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  console.log('=== Infringement Score Calibration ===');
  console.log(`Output: ${config.outputDir}`);
  console.log(`Disagreement threshold: ${config.threshold}`);

  const pairs = findCalibrationPairs();
  console.log(`\nCalibration pairs found: ${pairs.length}`);

  if (pairs.length === 0) {
    console.log('No calibration pairs found. Run score-infringement.ts --calibrate first.');
    return;
  }

  // Group by company for summary
  const byCompany = new Map<string, number>();
  for (const p of pairs) {
    byCompany.set(p.companyName, (byCompany.get(p.companyName) || 0) + 1);
  }
  console.log('\nPairs by company:');
  for (const [company, count] of [...byCompany.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${company}: ${count}`);
  }

  // Generate report
  const report = generateReport(pairs, config);

  ensureDir(config.outputDir);
  const reportPath = path.join(config.outputDir, 'calibration-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport saved: ${reportPath}`);

  // Also save raw data as JSON for further analysis
  const dataPath = path.join(config.outputDir, 'calibration-data.json');
  fs.writeFileSync(dataPath, JSON.stringify(pairs, null, 2));
  console.log(`Raw data saved: ${dataPath}`);

  // Print summary metrics
  const patlyticsScores = pairs.map(p => p.patlyticsScore);
  const internalScores = pairs.map(p => p.internalFinalScore ?? p.internalPass1Score!);
  const r = pearsonCorrelation(patlyticsScores, internalScores);
  const mae = meanAbsoluteError(patlyticsScores, internalScores);

  console.log(`\n=== Results ===`);
  console.log(`Pearson r:   ${r.toFixed(4)}`);
  console.log(`MAE:         ${mae.toFixed(4)}`);
  console.log(`Disagreements (>= ${config.threshold}): ${pairs.filter(p => p.delta >= config.threshold).length}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
