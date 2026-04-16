/**
 * Build infringement scoring targets for wireless-infrastructure patents.
 * 11 products across 7 companies covering RAN, RIC, Cloud RAN, Open RAN,
 * wireless modems, and Wi-Fi infrastructure.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Ericsson - Cloud RAN + Network Manager
  { company: 'ericsson', product: 'ericsson-cloud-ran', label: 'Ericsson Cloud RAN' },
  { company: 'ericsson', product: 'cloud-execution-environment', label: 'Ericsson Cloud Execution Env' },
  // Nokia - AirScale + NSP
  { company: 'nokia', product: 'network-services-platform-nsp', label: 'Nokia NSP' },
  { company: 'nokia', product: 'altiplano-access-controller', label: 'Nokia Altiplano' },
  // Mavenir - Open RAN / RIC
  { company: 'mavenir', product: 'ran-intelligent-controller-ric-solution-brief', label: 'Mavenir RIC' },
  { company: 'mavenir', product: 'converged-packet-core-solution-brief-2024', label: 'Mavenir Packet Core' },
  // Samsung - Exynos Modem (5G)
  { company: 'samsung-electronics', product: 'exynos-modem-5100', label: 'Samsung Exynos Modem 5100' },
  // Qualcomm - Snapdragon 802 (Wi-Fi chipset)
  { company: 'qualcomm', product: 'snapdragon-802', label: 'Qualcomm Snapdragon 802' },
  // CommScope/Ruckus - Wi-Fi AP
  { company: 'commscope', product: 'ruckus-r770-wi-fi-7-access-point-data-sheet', label: 'CommScope Ruckus R770' },
  // Ubiquiti - Wi-Fi 7 AP
  { company: 'ubiquiti', product: 'u7-pro-wifi-7-access-point-tech-specs', label: 'Ubiquiti U7 Pro' },
  // Parallel Wireless - Open RAN
  { company: 'parallel-wireless', product: 'openran-101-role-of-ric', label: 'Parallel Wireless OpenRAN' },
];

// Read patent list from latest vendor package
const patentLines = fs.readFileSync('output/vendor-exports/wireless-infrastructure-2026-04-16/vendor-targets.csv', 'utf-8')
  .split('\n').slice(1).filter(l => l.trim());
const patents = patentLines.map(l => l.split(',')[0].replace(/^US/, '').replace(/B\d+$/, ''));

console.log(`Patents: ${patents.length}`);

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
    lines.push(`${patId},${target.company},${target.product},wireless-infrastructure`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/wireless-infrastructure-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
