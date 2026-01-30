const fs = require('fs');

const sectorType = process.argv[2] || 'super-sector';  // 'super-sector' or 'sector'
const sectorName = process.argv[3] || 'Video & Streaming';

const candidatesFile = fs.readdirSync('output')
  .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
  .sort().pop();
const data = JSON.parse(fs.readFileSync('output/' + candidatesFile, 'utf-8'));

// Filter by sector
let patents;
if (sectorType === 'super-sector') {
  patents = data.candidates.filter(p => p.super_sector === sectorName);
} else {
  patents = data.candidates.filter(p => p.primary_sector === sectorName);
}
patents = patents.sort((a, b) => b.score - a.score);

function getCacheSet(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')));
}

const llmSet = getCacheSet('cache/llm-scores');
const prosSet = getCacheSet('cache/prosecution-scores');
const iprSet = getCacheSet('cache/ipr-scores');
const familySet = getCacheSet('cache/patent-families/parents');

const needLlm = patents.filter(p => !llmSet.has(p.patent_id));
const needPros = patents.filter(p => !prosSet.has(p.patent_id));
const needIpr = patents.filter(p => !iprSet.has(p.patent_id));
const needFamily = patents.filter(p => !familySet.has(p.patent_id));

console.log('=== ' + sectorType.toUpperCase() + ': ' + sectorName + ' ===');
console.log('Total patents: ' + patents.length);
console.log('');
console.log('Current enrichment:');
console.log('  LLM:         ' + (patents.length - needLlm.length) + '/' + patents.length + ' (' + ((patents.length - needLlm.length) / patents.length * 100).toFixed(1) + '%)');
console.log('  Prosecution: ' + (patents.length - needPros.length) + '/' + patents.length + ' (' + ((patents.length - needPros.length) / patents.length * 100).toFixed(1) + '%)');
console.log('  IPR:         ' + (patents.length - needIpr.length) + '/' + patents.length + ' (' + ((patents.length - needIpr.length) / patents.length * 100).toFixed(1) + '%)');
console.log('  Family:      ' + (patents.length - needFamily.length) + '/' + patents.length + ' (' + ((patents.length - needFamily.length) / patents.length * 100).toFixed(1) + '%)');
console.log('');
console.log('Gaps to fill:');
console.log('  LLM:         ' + needLlm.length);
console.log('  Prosecution: ' + needPros.length);
console.log('  IPR:         ' + needIpr.length);
console.log('  Family:      ' + needFamily.length);
console.log('');

// Rate assumptions
const LLM_RATE = 500;  // per hour
const OTHER_RATE = 500; // per hour (prosecution, IPR, family run in parallel)

const llmHours = needLlm.length / LLM_RATE;
const otherHours = Math.max(needPros.length, needIpr.length, needFamily.length) / OTHER_RATE;
const totalHours = Math.max(llmHours, otherHours);

console.log('Time estimates at 500/hr rate:');
console.log('  LLM:           ' + llmHours.toFixed(2) + ' hours (' + (llmHours * 60).toFixed(0) + ' min)');
console.log('  Other (max):   ' + otherHours.toFixed(2) + ' hours (' + (otherHours * 60).toFixed(0) + ' min)');
console.log('  Total (parallel): ' + totalHours.toFixed(2) + ' hours (' + (totalHours * 60).toFixed(0) + ' min)');

// Output JSON for machine parsing
const summary = {
  sectorType,
  sectorName,
  totalPatents: patents.length,
  gaps: {
    llm: needLlm.length,
    prosecution: needPros.length,
    ipr: needIpr.length,
    family: needFamily.length
  },
  estimates: {
    llmHours: parseFloat(llmHours.toFixed(2)),
    otherHours: parseFloat(otherHours.toFixed(2)),
    totalHours: parseFloat(totalHours.toFixed(2)),
    ratePerHour: 500
  }
};

// Write estimate to tracking file
const now = new Date();
const trackingEntry = {
  timestamp: now.toISOString(),
  ...summary,
  expectedCompletion: new Date(now.getTime() + totalHours * 3600000).toISOString()
};

const trackingFile = 'logs/enrichment-estimates.jsonl';
fs.appendFileSync(trackingFile, JSON.stringify(trackingEntry) + '\n');
console.log('');
console.log('Estimate logged to: ' + trackingFile);
