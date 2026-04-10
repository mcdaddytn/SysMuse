const fs = require('fs');
const path = require('path');

const cutoffArg = process.argv[2]; // optional: "tonight" to filter to recent only

function walk(dir) {
  let files = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) files = files.concat(walk(full));
    else if (f.endsWith('.json')) files.push(full);
  }
  return files;
}

const allFiles = walk('cache/infringement-scores');

// Filter to tonight's batch if requested
const cutoff = cutoffArg === 'tonight' ? new Date('2026-04-09T21:55:00') : null;
const files = cutoff ? allFiles.filter(f => fs.statSync(f).mtime > cutoff) : allFiles;

console.log(`Total files: ${allFiles.length}, Analyzing: ${files.length}${cutoff ? ' (tonight only)' : ' (all)'}`);
console.log();

const pass1Scores = [];
const finalScores = [];
const pass2Triggered = [];
const examples = [];

for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (d.pass1Score != null) pass1Scores.push(d.pass1Score);
    if (d.finalScore != null) finalScores.push(d.finalScore);
    if (d.claimAnalysis != null) {
      // Pass 2 ran
      const p2AvgClaim = d.claimAnalysis.reduce((s, c) => s + (c.claimScore || 0), 0) / d.claimAnalysis.length;
      pass2Triggered.push({
        pass1: d.pass1Score,
        final: d.finalScore,
        p2AvgClaim: p2AvgClaim,
        file: path.basename(f, '.json'),
        company: d.companySlug,
        product: d.productSlug,
      });
    }
    examples.push({ p1: d.pass1Score, final: d.finalScore, file: f });
  } catch {}
}

function showDist(label, scores) {
  const dist = {};
  for (const s of scores) {
    const bucket = (Math.round(s * 20) / 20).toFixed(2);
    dist[bucket] = (dist[bucket] || 0) + 1;
  }
  console.log(`=== ${label} (N=${scores.length}) ===`);
  for (const [k, v] of Object.entries(dist).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))) {
    const pct = (v / scores.length * 100).toFixed(1);
    const bar = '#'.repeat(Math.round(v / scores.length * 100));
    console.log(`  ${k}: ${String(v).padStart(5)} (${pct.padStart(5)}%)  ${bar}`);
  }
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const median = scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  console.log(`  Mean: ${mean.toFixed(3)}, Median: ${median.toFixed(2)}`);
  console.log();
}

showDist('PASS 1 SCORES', pass1Scores);

// Only show final scores where Pass 2 actually ran
const finalWithP2 = pass2Triggered.map(p => p.final);
if (finalWithP2.length > 0) {
  showDist('FINAL SCORES (Pass 2 ran)', finalWithP2);
}

// Show pass1-only finals (score below threshold, no Pass 2)
const pass1OnlyFinals = [];
for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
    if (d.pass1Score != null && d.claimAnalysis == null) {
      pass1OnlyFinals.push(d.pass1Score);
    }
  } catch {}
}
if (pass1OnlyFinals.length > 0) {
  showDist('PASS 1 ONLY (no Pass 2)', pass1OnlyFinals);
}

// Show Pass 2 details
if (pass2Triggered.length > 0) {
  console.log(`=== PASS 2 DETAILS (${pass2Triggered.length} pairs) ===`);
  console.log('  Pass1 → Final (P2ClaimAvg) | Company/Product/Patent');
  for (const p of pass2Triggered.sort((a, b) => b.final - a.final)) {
    console.log(`  ${p.pass1.toFixed(2)} → ${p.final.toFixed(2)} (p2avg: ${p.p2AvgClaim.toFixed(2)}) | ${p.company}/${p.product}/${p.file}`);
  }
}

// Check unique score values
const uniqueP1 = [...new Set(pass1Scores.map(s => s.toFixed(2)))].sort();
console.log();
console.log(`Unique Pass 1 values (${uniqueP1.length}): ${uniqueP1.join(', ')}`);
