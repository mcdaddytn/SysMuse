/**
 * Build infringement scoring targets for computing-systems patents.
 * Focuses on server/infrastructure companies with best product doc coverage.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Intel - Xeon processors (CXL, server infrastructure)
  { company: 'intel', product: '5th-gen-intel-xeon-scalable-processors', label: 'Intel Xeon 5th Gen' },
  { company: 'intel', product: 'intel-xeon-6-processor-family', label: 'Intel Xeon 6' },
  { company: 'intel', product: 'intel-ethernet-800-series', label: 'Intel Ethernet 800' },
  // AMD - EPYC server processors
  { company: 'amd', product: 'amd-epyc-9004-series', label: 'AMD EPYC 9004' },
  // NVIDIA - GPU/DPU infrastructure
  { company: 'nvidia', product: 'grace-hopper-superchip', label: 'NVIDIA Grace Hopper' },
  { company: 'nvidia', product: 'h100-tensor-core-gpu', label: 'NVIDIA H100' },
  // Dell - PowerEdge servers
  { company: 'dell-emc', product: 'poweredge-r7525-server-technical-guide', label: 'Dell PowerEdge R7525' },
  // HPE - ProLiant servers
  { company: 'hpe', product: 'hpe-proliant-dl380-gen11-quickspecs', label: 'HPE ProLiant DL380' },
];

// Read patent list
const patentLines = fs.readFileSync('output/vendor-exports/computing-systems-2026-04-15/vendor-targets.csv', 'utf-8')
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
    lines.push(`${patId},${target.company},${target.product},computing-systems`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/computing-systems-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
