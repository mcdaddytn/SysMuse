/**
 * Quick analysis: same-document calibration pairs only.
 * Compares internal scores to Patlytics scores on the SAME document.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  getAllProductCaches,
  readProductCache,
  slugify,
} from '../src/api/services/patlytics-cache-service.js';

const SCORES_DIR = './cache/infringement-scores';

interface Pair {
  patentId: string;
  company: string;
  product: string;
  docSlug: string;
  docName: string;
  patlytics: number;
  internal: number;
  pass1: number;
  final: number | null;
  delta: number;
  signed: number;
}

const sameDocPairs: Pair[] = [];
const crossDocPairs: Pair[] = [];

const companies = fs.readdirSync(SCORES_DIR).filter(f => {
  try { return fs.statSync(path.join(SCORES_DIR, f)).isDirectory(); } catch { return false; }
});

for (const company of companies) {
  const compDir = path.join(SCORES_DIR, company);
  const products = fs.readdirSync(compDir).filter(f => {
    try { return fs.statSync(path.join(compDir, f)).isDirectory(); } catch { return false; }
  });

  for (const product of products) {
    const prodDir = path.join(compDir, product);
    const files = fs.readdirSync(prodDir).filter(f => f.endsWith('.json'));
    const pc = readProductCache(company, product);
    if (!pc) continue;

    for (const file of files) {
      const score = JSON.parse(fs.readFileSync(path.join(prodDir, file), 'utf-8'));
      const patentId = score.patentId;
      const internalDocSlug = score.documentSlug;
      const internalScore = score.finalScore ?? score.pass1Score;

      for (const doc of pc.documents) {
        if (!doc.patentScores?.[patentId]) continue;
        const ps = doc.patentScores[patentId];
        if ((ps as any).sourceFile === 'internal-v1') continue;

        const docBase = doc.localPath ? path.basename(doc.localPath, path.extname(doc.localPath)) : '';
        const docSlug = slugify(doc.documentName || docBase);

        const pair: Pair = {
          patentId,
          company,
          product,
          docSlug,
          docName: doc.documentName,
          patlytics: ps.score,
          internal: internalScore,
          pass1: score.pass1Score,
          final: score.finalScore,
          delta: Math.abs(ps.score - internalScore),
          signed: internalScore - ps.score,
        };

        if (docSlug === internalDocSlug) {
          sameDocPairs.push(pair);
        } else {
          crossDocPairs.push(pair);
        }
      }
    }
  }
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const d = Math.sqrt(dx2 * dy2);
  return d === 0 ? 0 : num / d;
}

function analyze(label: string, pairs: Pair[]) {
  if (pairs.length === 0) { console.log(`\n${label}: 0 pairs`); return; }

  const pScores = pairs.map(p => p.patlytics);
  const iScores = pairs.map(p => p.internal);
  const p1Scores = pairs.map(p => p.pass1);
  const n = pScores.length;

  const r = pearson(pScores, iScores);
  const rPass1 = pearson(pScores, p1Scores);
  const mae = pairs.reduce((s, p) => s + p.delta, 0) / n;
  const maePass1 = pairs.reduce((s, p) => s + Math.abs(p.pass1 - p.patlytics), 0) / n;
  const bias = pairs.reduce((s, p) => s + p.signed, 0) / n;
  const biasPass1 = pairs.reduce((s, p) => s + (p.pass1 - p.patlytics), 0) / n;
  const pMean = pScores.reduce((a, b) => a + b, 0) / n;
  const iMean = iScores.reduce((a, b) => a + b, 0) / n;
  const p1Mean = p1Scores.reduce((a, b) => a + b, 0) / n;

  console.log(`\n=== ${label} (N=${n}) ===`);
  console.log(`Patlytics mean: ${pMean.toFixed(3)}`);
  console.log(`Internal mean:  ${iMean.toFixed(3)} (Pass1 mean: ${p1Mean.toFixed(3)})`);
  console.log(`\nFinal Score vs Patlytics:`);
  console.log(`  Pearson r: ${r.toFixed(4)}`);
  console.log(`  MAE:       ${mae.toFixed(4)}`);
  console.log(`  Bias:      ${bias >= 0 ? '+' : ''}${bias.toFixed(4)}`);
  console.log(`\nPass 1 Score vs Patlytics:`);
  console.log(`  Pearson r: ${rPass1.toFixed(4)}`);
  console.log(`  MAE:       ${maePass1.toFixed(4)}`);
  console.log(`  Bias:      ${biasPass1 >= 0 ? '+' : ''}${biasPass1.toFixed(4)}`);

  // Distribution
  const bins = ['0.00-0.19', '0.20-0.39', '0.40-0.59', '0.60-0.79', '0.80-1.00'];
  const binFn = (s: number) => s < 0.2 ? 0 : s < 0.4 ? 1 : s < 0.6 ? 2 : s < 0.8 ? 3 : 4;
  const pDist = [0, 0, 0, 0, 0], iDist = [0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) { pDist[binFn(pScores[i])]++; iDist[binFn(iScores[i])]++; }
  console.log('\nScore Distribution:');
  console.log('  Range       Patlytics  Internal');
  for (let i = 0; i < 5; i++) {
    console.log(`  ${bins[i]}   ${String(pDist[i]).padStart(5)} (${((pDist[i]/n)*100).toFixed(0).padStart(2)}%)   ${String(iDist[i]).padStart(5)} (${((iDist[i]/n)*100).toFixed(0).padStart(2)}%)`);
  }

  // Disagreements
  const sorted = [...pairs].sort((a, b) => b.delta - a.delta);
  console.log('\nTop 15 disagreements:');
  for (const p of sorted.slice(0, 15)) {
    console.log(`  ${p.patentId} ${p.company.substring(0,20).padEnd(20)} P:${p.patlytics.toFixed(2)} P1:${p.pass1.toFixed(2)} F:${p.final !== null ? p.final.toFixed(2) : 'n/a '} Δ:${p.delta.toFixed(2)}`);
  }

  console.log('\nTop 15 closest agreements:');
  sorted.sort((a, b) => a.delta - b.delta);
  for (const p of sorted.slice(0, 15)) {
    console.log(`  ${p.patentId} ${p.company.substring(0,20).padEnd(20)} P:${p.patlytics.toFixed(2)} P1:${p.pass1.toFixed(2)} F:${p.final !== null ? p.final.toFixed(2) : 'n/a '} Δ:${p.delta.toFixed(2)}`);
  }

  // Per-company (5+ pairs)
  const byCompany = new Map<string, Pair[]>();
  for (const p of pairs) {
    if (!byCompany.has(p.company)) byCompany.set(p.company, []);
    byCompany.get(p.company)!.push(p);
  }
  console.log('\nPer-company (5+ pairs):');
  console.log('  Company'.padEnd(30) + 'N'.padStart(5) + '   r'.padStart(8) + '  MAE'.padStart(8) + '  Bias'.padStart(8));
  for (const [company, cPairs] of [...byCompany.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (cPairs.length < 5) continue;
    const cr = pearson(cPairs.map(p => p.patlytics), cPairs.map(p => p.internal));
    const cmae = cPairs.reduce((s, p) => s + p.delta, 0) / cPairs.length;
    const cbias = cPairs.reduce((s, p) => s + p.signed, 0) / cPairs.length;
    console.log(`  ${company.padEnd(30)}${String(cPairs.length).padStart(5)}   ${cr.toFixed(3).padStart(7)}  ${cmae.toFixed(3).padStart(7)}  ${(cbias >= 0 ? '+' : '') + cbias.toFixed(3)}`.padStart(7));
  }

  // Pass 2 impact
  const withPass2 = pairs.filter(p => p.final !== null);
  if (withPass2.length > 0) {
    let raised = 0, lowered = 0, same = 0;
    for (const p of withPass2) {
      if (p.final! > p.pass1 + 0.02) raised++;
      else if (p.final! < p.pass1 - 0.02) lowered++;
      else same++;
    }
    console.log(`\nPass 2 impact (${withPass2.length} pairs):`);
    console.log(`  Raised:    ${raised} (${((raised/withPass2.length)*100).toFixed(0)}%)`);
    console.log(`  Lowered:   ${lowered} (${((lowered/withPass2.length)*100).toFixed(0)}%)`);
    console.log(`  Unchanged: ${same} (${((same/withPass2.length)*100).toFixed(0)}%)`);
    console.log(`  Avg Pass1 entering:  ${(withPass2.reduce((s, p) => s + p.pass1, 0) / withPass2.length).toFixed(3)}`);
    console.log(`  Avg Final after:     ${(withPass2.reduce((s, p) => s + p.final!, 0) / withPass2.length).toFixed(3)}`);

    // Does Pass2 improve or worsen alignment?
    const p2mae = withPass2.reduce((s, p) => s + Math.abs(p.final! - p.patlytics), 0) / withPass2.length;
    const p1mae = withPass2.reduce((s, p) => s + Math.abs(p.pass1 - p.patlytics), 0) / withPass2.length;
    console.log(`  Pass1 MAE vs Patlytics: ${p1mae.toFixed(4)}`);
    console.log(`  Final MAE vs Patlytics: ${p2mae.toFixed(4)} (${p2mae < p1mae ? 'IMPROVED' : 'WORSE'})`);
  }
}

console.log('Total internal score files:', companies.reduce((s, c) => {
  const cd = path.join(SCORES_DIR, c);
  return s + fs.readdirSync(cd).filter(f => {
    try { return fs.statSync(path.join(cd, f)).isDirectory(); } catch { return false; }
  }).reduce((s2, p) => s2 + fs.readdirSync(path.join(cd, p)).filter(f => f.endsWith('.json')).length, 0);
}, 0));
console.log('Same-document matches:', sameDocPairs.length);
console.log('Cross-document matches:', crossDocPairs.length);

analyze('SAME-DOCUMENT Comparison (apples-to-apples)', sameDocPairs);
analyze('CROSS-DOCUMENT Comparison (different evidence)', crossDocPairs);
