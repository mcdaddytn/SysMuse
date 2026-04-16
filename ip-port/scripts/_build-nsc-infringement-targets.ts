/**
 * Build infringement scoring targets for network-secure-compute patents.
 * 9 products across 6 companies covering VPN, ZTNA, micro-segmentation,
 * and secure networking infrastructure.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Zscaler - Zero Trust Exchange + ZIA
  { company: 'zscaler', product: 'zscaler-zero-trust-exchange', label: 'Zscaler ZTX' },
  { company: 'zscaler', product: 'zscaler-internet-access-zia', label: 'Zscaler ZIA' },
  // Palo Alto - Prisma Cloud
  { company: 'palo-alto-networks', product: 'prisma-cloud', label: 'Palo Alto Prisma Cloud' },
  // Cisco - ACI (micro-segmentation) + Tetration (workload protection)
  { company: 'cisco-systems', product: 'cisco-application-centric-infrastructure-aci', label: 'Cisco ACI' },
  { company: 'cisco-systems', product: 'cisco-tetration-analytics', label: 'Cisco Tetration' },
  // Fortinet - FortiGate VM (virtual firewall / SD-WAN)
  { company: 'fortinet', product: 'fortigate-vm', label: 'Fortinet FortiGate VM' },
  // Cloudflare - Gateway (ZTNA / secure web gateway)
  { company: 'cloudflare', product: 'cloudflare-gateway', label: 'Cloudflare Gateway' },
  // Nutanix - Flow Network Security (micro-segmentation) + NCI
  { company: 'nutanix', product: 'flow-network-security', label: 'Nutanix Flow Security' },
  { company: 'nutanix', product: 'nutanix-cloud-infrastructure-nci', label: 'Nutanix NCI' },
];

// Read patent list
const patentLines = fs.readFileSync('output/vendor-exports/network-secure-compute-2026-04-06/vendor-targets.csv', 'utf-8')
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
    lines.push(`${patId},${target.company},${target.product},network-secure-compute`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/network-secure-compute-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
