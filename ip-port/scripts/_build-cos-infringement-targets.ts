/**
 * Build infringement scoring targets for computing-os-security patents.
 * 11 products across 8 companies covering endpoint security, EDR, XDR,
 * and OS-level threat protection.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // CrowdStrike - Falcon Platform + Falcon Insight (kernel-level EDR)
  { company: 'crowdstrike', product: 'falcon-platform', label: 'CrowdStrike Falcon Platform' },
  { company: 'crowdstrike', product: 'falcon-insight', label: 'CrowdStrike Falcon Insight' },
  // Palo Alto - Cortex XDR (extended detection, OS-level)
  { company: 'palo-alto-networks', product: 'cortex-xdr', label: 'Palo Alto Cortex XDR' },
  // Microsoft - Defender for Endpoint (OS-level protection)
  { company: 'microsoft', product: 'microsoft-defender-for-endpoint', label: 'Microsoft Defender for Endpoint' },
  // SentinelOne - Singularity Platform + Endpoint
  { company: 'sentinelone', product: 'singularity-platform', label: 'SentinelOne Singularity Platform' },
  { company: 'sentinelone', product: 'singularity-endpoint', label: 'SentinelOne Singularity Endpoint' },
  // Cisco - XDR
  { company: 'cisco-systems', product: 'cisco-xdr', label: 'Cisco XDR' },
  // Trend Micro - Vision One
  { company: 'trend-micro', product: 'trend-vision-one', label: 'Trend Micro Vision One' },
  // Symantec - Endpoint Security
  { company: 'symantec', product: 'symantec-endpoint-security', label: 'Symantec Endpoint Security' },
  // Check Point - Harmony Endpoint
  { company: 'check-point-software', product: 'harmony-endpoint', label: 'Check Point Harmony Endpoint' },
  // McAfee - MVISION Endpoint
  { company: 'mcafee', product: 'mvision-endpoint', label: 'McAfee MVISION Endpoint' },
];

// Read patent list from V3 vendor package
const vendorDir = fs.readdirSync('output/vendor-exports/').filter(d => d.startsWith('computing-os-security-')).sort().pop();
if (!vendorDir) { console.error('No computing-os-security vendor export found'); process.exit(1); }
const patentLines = fs.readFileSync(`output/vendor-exports/${vendorDir}/vendor-targets.csv`, 'utf-8')
  .split('\n').slice(1).filter(l => l.trim());
const patents = patentLines.map(l => l.split(',')[0].replace(/^US/, '').replace(/B\d+$/, ''));

console.log(`Patents: ${patents.length} (from ${vendorDir})`);

const lines = ['PatentId,Target,TargetProduct,Sector'];
let total = 0;
let skipped = 0;

for (const target of TARGETS) {
  const scoreDir = path.join(SCORES_DIR, target.company, target.product);
  const existingScores = new Set<string>();
  if (fs.existsSync(scoreDir)) {
    for (const f of fs.readdirSync(scoreDir)) {
      if (f.endsWith('.json')) existingScores.add(f.replace('.json', ''));
    }
  }

  const docDir = path.join(GLSSD2_DOCS, target.company, target.product);
  if (!fs.existsSync(docDir)) {
    console.log(`  SKIP: ${target.label} — no docs on GLSSD2`);
    continue;
  }
  const docFiles = fs.readdirSync(docDir).filter(f => f.endsWith('.txt') || f.endsWith('.html'));
  if (docFiles.length === 0) {
    console.log(`  SKIP: ${target.label} — 0 doc files`);
    continue;
  }
  const totalSize = docFiles.reduce((sum, f) => {
    try { return sum + fs.statSync(path.join(docDir, f)).size; } catch { return sum; }
  }, 0);

  let targetNew = 0;
  for (const patId of patents) {
    if (existingScores.has(patId)) {
      skipped++;
      continue;
    }
    lines.push(`${patId},${target.company},${target.product},computing-os-security`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/computing-os-security-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
