const fs = require('fs');
const path = require('path');

// Find the most recent streaming-candidates file
const outputDir = './output';
const files = fs.readdirSync(outputDir)
  .filter(f => f.startsWith('streaming-candidates') && f.endsWith('.json'))
  .sort()
  .reverse();

if (files.length === 0) {
  console.log('No streaming-candidates files found');
  process.exit(1);
}

const file = path.join(outputDir, files[0]);
console.log('Using: ' + file + '\n');

const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
const patents = data.candidates || data.patents || data;

// Normalize field names (handle both camelCase and snake_case)
const normalize = (p) => ({
  patentNumber: p.patentNumber || p.patent_id,
  superSector: p.superSector || p.super_sector || 'Unknown',
  primarySector: p.primarySector || p.primary_sector,
  baseScoreV1: p.baseScoreV1 || p.score || 0,
});

// Group by super sector
const sectors = {};
patents.forEach(p => {
  const np = normalize(p);
  const ss = np.superSector || 'Unknown';
  if (!sectors[ss]) sectors[ss] = [];
  sectors[ss].push(np);
});

console.log('=== Super-Sector Enrichment Summary (Top 500 per sector) ===\n');
console.log('Sector                       | Total | LLM      | Pros     | IPR');
console.log('─────────────────────────────┼───────┼──────────┼──────────┼──────────');

// Sort by count
const sorted = Object.entries(sectors).sort((a, b) => b[1].length - a[1].length);

for (const [name, pats] of sorted) {
  const total = pats.length;
  // Sort by baseScoreV1 and take top 500
  const top500 = pats
    .sort((a, b) => (b.baseScoreV1 || 0) - (a.baseScoreV1 || 0))
    .slice(0, 500);

  const checked = top500.length;
  let llm = 0, pros = 0, ipr = 0;

  for (const p of top500) {
    const pn = p.patentNumber;
    if (fs.existsSync('cache/llm-scores/' + pn + '.json')) llm++;
    if (fs.existsSync('cache/prosecution-scores/' + pn + '.json')) pros++;
    if (fs.existsSync('cache/ipr-scores/' + pn + '.json')) ipr++;
  }

  const pct = (n) => (n/checked*100).toFixed(0);
  console.log(
    name.padEnd(28) + ' | ' +
    String(total).padStart(5) + ' | ' +
    (llm + ' (' + pct(llm) + '%)').padStart(8) + ' | ' +
    (pros + ' (' + pct(pros) + '%)').padStart(8) + ' | ' +
    (ipr + ' (' + pct(ipr) + '%)').padStart(8)
  );
}

// Video & Streaming deep dive
console.log('\n=== Video & Streaming Deep Dive ===\n');
const video = sectors['Video & Streaming'] || [];
console.log('Total Video & Streaming patents: ' + video.length);

// Get top 50 by score
const topVideo = video
  .sort((a, b) => (b.baseScoreV1 || 0) - (a.baseScoreV1 || 0))
  .slice(0, 50);

console.log('\nTop 50 Video & Streaming patents enrichment status:');
console.log('Patent    | Score | LLM | Pros | IPR | Sector');
console.log('──────────┼───────┼─────┼──────┼─────┼────────────────────');
for (const p of topVideo) {
  const pn = p.patentNumber;
  const llm = fs.existsSync('cache/llm-scores/' + pn + '.json') ? '✓' : ' ';
  const pros = fs.existsSync('cache/prosecution-scores/' + pn + '.json') ? '✓' : ' ';
  const ipr = fs.existsSync('cache/ipr-scores/' + pn + '.json') ? '✓' : ' ';

  console.log(
    pn.toString().padEnd(9) + ' | ' +
    (p.baseScoreV1 || 0).toFixed(1).padStart(5) + ' | ' +
    llm.padStart(3) + ' | ' +
    pros.padStart(4) + ' | ' +
    ipr.padStart(3) + ' | ' +
    (p.primarySector || 'Unknown').substring(0, 20)
  );
}
