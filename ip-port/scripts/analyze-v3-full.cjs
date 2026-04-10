const fs = require('fs');
const path = require('path');
const dir = 'cache/calibration-control/results';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

console.log('V3 Full Control Group Results (' + files.length + ' pairs):');
console.log('');

const data = files.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));

// Pass 1 distribution
const p1Values = data.map(d => d.pass1Score);
const p1Dist = {};
for (const s of p1Values) {
  const bucket = s.toFixed(2);
  p1Dist[bucket] = (p1Dist[bucket] || 0) + 1;
}
console.log('=== PASS 1 DISTRIBUTION ===');
for (const [k, v] of Object.entries(p1Dist).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
  const bar = '#'.repeat(Math.round(v / data.length * 100));
  console.log('  ' + k + ': ' + String(v).padStart(3) + ' (' + (v/data.length*100).toFixed(0).padStart(2) + '%)  ' + bar);
}
console.log('  Unique values: ' + [...new Set(p1Values.map(v => v.toFixed(2)))].sort().length);

// Final score distribution
const fValues = data.filter(d => d.finalScore != null).map(d => d.finalScore);
const fDist = {};
for (const s of fValues) {
  const bucket = (Math.round(s * 10) / 10).toFixed(1);
  fDist[bucket] = (fDist[bucket] || 0) + 1;
}
console.log('\n=== FINAL SCORE DISTRIBUTION (0.1 buckets) ===');
for (const [k, v] of Object.entries(fDist).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
  const bar = '#'.repeat(Math.round(v / data.length * 100));
  console.log('  ' + k + ': ' + String(v).padStart(3) + ' (' + (v/data.length*100).toFixed(0).padStart(2) + '%)  ' + bar);
}

// Correlation with Patlytics
const withFinal = data.filter(d => d.finalScore != null);
const xs = withFinal.map(d => d.patlyticsScore);
const ys = withFinal.map(d => d.finalScore);

// Pearson r
const n = xs.length;
const mx = xs.reduce((a, b) => a + b, 0) / n;
const my = ys.reduce((a, b) => a + b, 0) / n;
let num = 0, dx2 = 0, dy2 = 0;
for (let i = 0; i < n; i++) {
  const dx = xs[i] - mx, dy = ys[i] - my;
  num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
}
const r = Math.sqrt(dx2 * dy2) === 0 ? 0 : num / Math.sqrt(dx2 * dy2);

// MAE, bias
let totalMAE = 0, totalBias = 0;
for (let i = 0; i < n; i++) {
  totalMAE += Math.abs(ys[i] - xs[i]);
  totalBias += ys[i] - xs[i];
}

console.log('\n=== CALIBRATION (N=' + n + ') ===');
console.log('  Patlytics mean: ' + mx.toFixed(3));
console.log('  Our mean:       ' + my.toFixed(3));
console.log('  Pearson r:      ' + r.toFixed(4));
console.log('  MAE:            ' + (totalMAE/n).toFixed(4));
console.log('  Bias:           ' + (totalBias/n).toFixed(4));

// Within thresholds
let w10 = 0, w15 = 0, w20 = 0, w25 = 0;
for (let i = 0; i < n; i++) {
  const d = Math.abs(ys[i] - xs[i]);
  if (d <= 0.10) w10++;
  if (d <= 0.15) w15++;
  if (d <= 0.20) w20++;
  if (d <= 0.25) w25++;
}
console.log('  Within 0.10: ' + w10 + '/' + n + ' (' + (w10/n*100).toFixed(0) + '%)');
console.log('  Within 0.15: ' + w15 + '/' + n + ' (' + (w15/n*100).toFixed(0) + '%)');
console.log('  Within 0.20: ' + w20 + '/' + n + ' (' + (w20/n*100).toFixed(0) + '%)');
console.log('  Within 0.25: ' + w25 + '/' + n + ' (' + (w25/n*100).toFixed(0) + '%)');

// Show worst misses
console.log('\n=== LARGEST GAPS (|delta| > 0.30) ===');
const sorted = withFinal.map((d, i) => ({
  patent: d.patentId,
  company: d.companySlug.substring(0, 25),
  patlytics: d.patlyticsScore,
  pass1: d.pass1Score,
  final: d.finalScore,
  delta: d.finalScore - d.patlyticsScore,
  textLen: d.textLength
})).filter(d => Math.abs(d.delta) > 0.30).sort((a, b) => a.delta - b.delta);

for (const d of sorted) {
  const sign = d.delta >= 0 ? '+' : '';
  console.log('  ' + d.patent.padEnd(10) + d.company.padEnd(26) +
    'P=' + d.patlytics.toFixed(2) + '  P1=' + d.pass1.toFixed(2) +
    '  F=' + d.final.toFixed(2) + '  ' + sign + d.delta.toFixed(2) +
    '  ' + Math.round(d.textLen/1024) + 'K');
}
