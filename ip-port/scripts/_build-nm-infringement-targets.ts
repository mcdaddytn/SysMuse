/**
 * Build infringement scoring targets for network-management patents.
 * 10 products across 8 companies covering SDN, NMS, and network automation.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Cisco - network management platforms
  { company: 'cisco-systems', product: 'cisco-catalyst-center', label: 'Cisco Catalyst Center' },
  { company: 'cisco-systems', product: 'cisco-application-policy-infrastructure-controller-apic', label: 'Cisco APIC' },
  // Arista - CloudVision
  { company: 'arista-networks', product: 'cloudvision', label: 'Arista CloudVision' },
  // Juniper - Apstra + Mist
  { company: 'juniper-networks', product: 'apstra-data-center-director', label: 'Juniper Apstra' },
  { company: 'juniper-networks', product: 'mist-ai', label: 'Juniper Mist AI' },
  // SolarWinds - NPM
  { company: 'solarwinds', product: 'network-performance-monitor-with-aiops', label: 'SolarWinds NPM+AIOps' },
  // Extreme - ExtremeCloud IQ
  { company: 'extreme-networks', product: 'extremecloud-iq', label: 'Extreme ExtremeCloud IQ' },
  // ThousandEyes (Cisco) - monitoring platform
  { company: 'thousandeyes-cisco', product: 'thousandeyes-platform', label: 'ThousandEyes' },
  // Fortinet - FortiManager
  { company: 'fortinet', product: 'fortimanager', label: 'Fortinet FortiManager' },
  // HPE Aruba - Central
  { company: 'hpe-hewlett-packard-enterprise', product: 'hpe-aruba-networking-central', label: 'HPE Aruba Central' },
];

// Read patent list
const patentLines = fs.readFileSync('output/vendor-exports/network-management-2026-04-06/vendor-targets.csv', 'utf-8')
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
    lines.push(`${patId},${target.company},${target.product},network-management`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/network-management-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
