const fs = require('fs');
const path = require('path');
const dir = 'cache/calibration-control/results';
const cutoff = new Date('2026-04-10T02:04:00Z');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
const recent = files.filter(f => fs.statSync(path.join(dir, f)).mtime > cutoff);

console.log('V3 computed-score results (' + recent.length + ' pairs):');
console.log('');
console.log('Patent     Company              Patlytics  P1comp  P2comp  Final     D');
console.log('-'.repeat(75));

let totalMAE = 0;
let totalBias = 0;
let count = 0;
const p1Values = [];

for (const f of recent.sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  const final = d.finalScore != null ? d.finalScore : d.pass1Score;
  const delta = final - d.patlyticsScore;
  totalMAE += Math.abs(delta);
  totalBias += delta;
  count++;
  p1Values.push(d.pass1Score);

  const p2str = d.pass2RawScore != null ? d.pass2RawScore.toFixed(2) : ' N/A';
  const sign = delta >= 0 ? '+' : '';
  console.log(
    d.patentId.padEnd(11) +
    d.companySlug.substring(0, 20).padEnd(21) +
    d.patlyticsScore.toFixed(2).padStart(6) + '  ' +
    d.pass1Score.toFixed(2).padStart(6) + '  ' +
    p2str.padStart(6) + '  ' +
    final.toFixed(2).padStart(5) + '  ' +
    sign + delta.toFixed(2)
  );
}

console.log('');
console.log('V3 subset MAE: ' + (totalMAE / count).toFixed(3));
console.log('V3 subset Bias: ' + (totalBias / count).toFixed(3));
console.log('V3 unique P1 values: ' + [...new Set(p1Values.map(v => v.toFixed(2)))].sort().join(', '));
console.log('');

// Compare: how many are within 0.15 of Patlytics?
let within15 = 0;
let within25 = 0;
for (const f of recent) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
  const final = d.finalScore != null ? d.finalScore : d.pass1Score;
  if (Math.abs(final - d.patlyticsScore) <= 0.15) within15++;
  if (Math.abs(final - d.patlyticsScore) <= 0.25) within25++;
}
console.log('Within 0.15 of Patlytics: ' + within15 + '/' + count + ' (' + (within15/count*100).toFixed(0) + '%)');
console.log('Within 0.25 of Patlytics: ' + within25 + '/' + count + ' (' + (within25/count*100).toFixed(0) + '%)');
