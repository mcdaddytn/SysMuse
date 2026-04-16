/**
 * Build infringement scoring targets for network-protocols patents.
 * 10 products across 7 companies covering routers, switches, SD-WAN,
 * network orchestration, and protocol implementation.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Cisco - ASR routers + Catalyst 9000 + Crosswork NSO
  { company: 'cisco-systems', product: 'cisco-asr-1000-series-routers', label: 'Cisco ASR 1000' },
  { company: 'cisco-systems', product: 'cisco-catalyst-9000-series', label: 'Cisco Catalyst 9000' },
  { company: 'cisco-systems', product: 'cisco-crosswork-network-services-orchestrator-nso', label: 'Cisco Crosswork NSO' },
  // Juniper - VMX virtual router + Contrail + SD-WAN
  { company: 'juniper-networks', product: 'vmx-virtual-router', label: 'Juniper vMX' },
  { company: 'juniper-networks', product: 'cloud-native-contrail-networking', label: 'Juniper Contrail' },
  // Arista - EOS + CloudVision
  { company: 'arista-networks', product: 'arista-eos', label: 'Arista EOS' },
  { company: 'arista-networks', product: 'cloudvision', label: 'Arista CloudVision' },
  // Nokia - 7250 IXR + vSR
  { company: 'nokia', product: '7250-ixr', label: 'Nokia 7250 IXR' },
  { company: 'nokia', product: 'virtualized-service-router-vsr', label: 'Nokia vSR' },
  // Huawei - iMaster NCE
  { company: 'huawei', product: 'imaster-nce-autonomous-network-management-and-control-system', label: 'Huawei iMaster NCE' },
];

// Read patent list from latest vendor package
const patentLines = fs.readFileSync('output/vendor-exports/network-protocols-2026-04-16/vendor-targets.csv', 'utf-8')
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
    lines.push(`${patId},${target.company},${target.product},network-protocols`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/network-protocols-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
