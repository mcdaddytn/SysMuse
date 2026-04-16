/**
 * Build infringement scoring targets for computing-runtime patents.
 * Focuses on top companies with best product doc coverage for computing/virtualization.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

// Top computing-runtime targets with their product doc slugs
// Batch 1: ~$15-18 budget — richest doc targets for computing/virtualization
const TARGETS = [
  { company: 'microsoft', products: ['hyper-v', 'hyper-v-network-virtualization'] },
  { company: 'citrix', products: ['xenserver'] },
  { company: 'red-hat', products: ['red-hat-enterprise-virtualization'] },
  { company: 'ibm', products: ['powervm'] },
  { company: 'oracle', products: ['oracle-sdn-controller'] },
];

// Read patent list
const patentLines = fs.readFileSync('output/vendor-exports/computing-runtime-2026-04-15/vendor-targets.csv', 'utf-8')
  .split('\n').slice(1).filter(l => l.trim());
const patents = patentLines.map(l => {
  const id = l.split(',')[0].replace(/^US/, '').replace(/B\d+$/, '');
  return id;
});

console.log(`Patents: ${patents.length}`);

// Build target pairs, skipping already-scored
const lines = ['PatentId,Target,TargetProduct,Sector'];
let total = 0;
let skipped = 0;

for (const target of TARGETS) {
  for (const product of target.products) {
    // Check which patents already have scores for this company/product
    const scoreDir = path.join(SCORES_DIR, target.company, product);
    const existingScores = new Set<string>();
    if (fs.existsSync(scoreDir)) {
      for (const f of fs.readdirSync(scoreDir)) {
        if (f.endsWith('.json')) existingScores.add(f.replace('.json', ''));
      }
    }

    // Check if product has docs
    const docDir = path.join(GLSSD2_DOCS, target.company, product);
    if (!fs.existsSync(docDir)) {
      console.log(`  SKIP: ${target.company}/${product} — no docs`);
      continue;
    }
    const docCount = fs.readdirSync(docDir).filter(f => f.endsWith('.txt') || f.endsWith('.html')).length;
    if (docCount === 0) {
      console.log(`  SKIP: ${target.company}/${product} — 0 docs`);
      continue;
    }

    for (const patId of patents) {
      if (existingScores.has(patId)) {
        skipped++;
        continue;
      }
      lines.push(`${patId},${target.company},${product},computing-runtime`);
      total++;
    }
    console.log(`  ${target.company}/${product}: ${docCount} docs, ${patents.length - existingScores.size} new pairs`);
  }
}

const csvPath = path.resolve('./output/computing-runtime-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
