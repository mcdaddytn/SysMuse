/**
 * Build infringement scoring targets for computing-data-protection patents.
 * 10 products across 7 companies covering data loss prevention, backup,
 * encryption, cloud data security, and data governance.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Varonis - Data Security Platform (DLP, classification, governance)
  { company: 'varonis', product: 'data-security-platform', label: 'Varonis Data Security Platform' },
  // Palo Alto - Prisma Cloud (cloud data protection)
  { company: 'palo-alto-networks', product: 'prisma-cloud', label: 'Palo Alto Prisma Cloud' },
  // Microsoft - Defender for Cloud (cloud workload protection)
  { company: 'microsoft', product: 'microsoft-defender-for-cloud', label: 'Microsoft Defender for Cloud' },
  // Microsoft - Defender for Cloud Apps (CASB / data protection)
  { company: 'microsoft', product: 'microsoft-defender-for-cloud-apps', label: 'Microsoft Defender for Cloud Apps' },
  // Dell - PowerProtect Data Manager
  { company: 'dell-emc', product: 'powerprotect-data-manager', label: 'Dell PowerProtect Data Manager' },
  // Dell - PowerProtect DD Series (dedup backup)
  { company: 'dell-emc', product: 'powerprotect-dd-series-appliances', label: 'Dell PowerProtect DD' },
  // IBM - QRadar SIEM (data monitoring / DLP)
  { company: 'ibm-security', product: 'qradar-siem', label: 'IBM QRadar SIEM' },
  // McAfee - Total Protection for DLP
  { company: 'mcafee', product: 'total-protection-for-dlp', label: 'McAfee Total Protection DLP' },
  // McAfee - MVISION Cloud CASB
  { company: 'mcafee', product: 'mvision-cloud-casb', label: 'McAfee MVISION Cloud CASB' },
  // Fortinet - FortiEDR (endpoint data protection)
  { company: 'fortinet', product: 'fortiedr', label: 'Fortinet FortiEDR' },
];

// Read patent list from V3 vendor package
const vendorDir = fs.readdirSync('output/vendor-exports/').filter(d => d.startsWith('computing-data-protection-')).sort().pop();
if (!vendorDir) { console.error('No computing-data-protection vendor export found'); process.exit(1); }
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
    lines.push(`${patId},${target.company},${target.product},computing-data-protection`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/computing-data-protection-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
