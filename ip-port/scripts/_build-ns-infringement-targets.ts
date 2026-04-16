/**
 * Build infringement scoring targets for network-switching patents.
 * Identifies gaps in scoring coverage and generates targets CSV.
 * Handles multiple company slug variants and checks for existing scores.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

// Target configuration: company label → slug + products to score against
// We pick the most relevant networking products per company.
// The scoring engine uses the company slug + product slug to find docs.
const TARGETS = [
  // Cisco ACI is the most relevant product for network-switching patents
  { company: 'cisco-systems', product: 'cisco-application-centric-infrastructure-aci', label: 'Cisco ACI' },
  // Juniper - Apstra is their data center management product
  { company: 'juniper-networks', product: 'apstra-data-center-director', label: 'Juniper Apstra' },
  // Arista - EOS is their core network OS
  { company: 'arista-networks', product: 'arista-eos', label: 'Arista EOS' },
  // Arista CloudVision - management platform
  { company: 'arista-networks', product: 'cloudvision', label: 'Arista CloudVision' },
  // Dell - SmartFabric is their switching platform
  { company: 'dell-technologies', product: 'smartfabric-services', label: 'Dell SmartFabric' },
  // HPE - Aruba switches with VSX (most relevant for switching)
  // Docs are under hpe-hewlett-packard-enterprise slug on GLSSD2
  { company: 'hpe-hewlett-packard-enterprise', product: 'hpe-aruba-networking-virtual-switching-extension-vsx', label: 'HPE Aruba VSX' },
  // HPE - EdgeConnect SD-WAN (relevant for SD-WAN patents)
  { company: 'hpe-hewlett-packard-enterprise', product: 'hpe-aruba-networking-edgeconnect-sd-wan', label: 'HPE EdgeConnect' },
  // Huawei - iMaster NCE-Fabric (network controller)
  { company: 'huawei-technologies', product: 'imaster-nce-fabric', label: 'Huawei NCE-Fabric' },
];

// For checking existing scores, include all slug variants that map to the same company
const EXISTING_SCORE_SLUGS: Record<string, Array<{ slug: string; product: string }>> = {
  'cisco-systems/cisco-application-centric-infrastructure-aci': [
    { slug: 'cisco-systems', product: 'cisco-application-centric-infrastructure-aci' },
    { slug: 'cisco-systems', product: 'cisco-aci-fabric' },
    { slug: 'cisco-systems', product: 'cisco-aci-multi-site' },
    { slug: 'cisco', product: 'cisco-secure-network-analytics' },
  ],
  'juniper-networks/apstra-data-center-director': [
    { slug: 'juniper-networks', product: 'apstra-data-center-director' },
    { slug: 'juniper-networks', product: 'mist-ai' },
    { slug: 'juniper-networks', product: 'mist-ai-sd-wan' },
  ],
  'arista-networks/arista-eos': [
    { slug: 'arista-networks', product: 'arista-eos' },
  ],
  'arista-networks/cloudvision': [
    { slug: 'arista-networks', product: 'cloudvision' },
  ],
  'dell-technologies/smartfabric-services': [
    { slug: 'dell-technologies', product: 'smartfabric-services' },
    { slug: 'dell-emc', product: 'powerswitch-z9432f-on' },
  ],
  'hpe-hewlett-packard-enterprise/hpe-aruba-networking-virtual-switching-extension-vsx': [
    { slug: 'hewlett-packard-enterprise', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
    { slug: 'hpe-hewlett-packard-enterprise', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
    { slug: 'hpe', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
    { slug: 'hpe-aruba', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
  ],
  'hpe-hewlett-packard-enterprise/hpe-aruba-networking-edgeconnect-sd-wan': [
    { slug: 'hewlett-packard-enterprise', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
    { slug: 'hpe-hewlett-packard-enterprise', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
    { slug: 'hpe', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
    { slug: 'hpe-aruba', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
  ],
  'huawei-technologies/imaster-nce-fabric': [
    { slug: 'huawei-technologies', product: 'imaster-nce-fabric' },
    { slug: 'huawei', product: 'imaster-nce-fabric' },
  ],
};

// Read patent list
const patentLines = fs.readFileSync('output/vendor-exports/network-switching-2026-04-15/vendor-targets.csv', 'utf-8')
  .split('\n').slice(1).filter(l => l.trim());
const patents = patentLines.map(l => l.split(',')[0].replace(/^US/, '').replace(/B\d+$/, ''));

console.log(`Patents: ${patents.length}`);

// Build target pairs, skipping already-scored
const lines = ['PatentId,Target,TargetProduct,Sector'];
let total = 0;
let skipped = 0;

for (const target of TARGETS) {
  const key = `${target.company}/${target.product}`;
  const existingVariants = EXISTING_SCORE_SLUGS[key] || [{ slug: target.company, product: target.product }];

  // Collect all existing scores across slug variants
  const existingScores = new Set<string>();
  for (const variant of existingVariants) {
    const scoreDir = path.join(SCORES_DIR, variant.slug, variant.product);
    if (fs.existsSync(scoreDir)) {
      for (const f of fs.readdirSync(scoreDir)) {
        if (f.endsWith('.json')) existingScores.add(f.replace('.json', ''));
      }
    }
  }

  // Check if product has docs
  const docDir = path.join(GLSSD2_DOCS, target.company, target.product);
  if (!fs.existsSync(docDir)) {
    console.log(`  SKIP: ${target.label} (${key}) — no docs on GLSSD2`);
    continue;
  }
  const docFiles = fs.readdirSync(docDir).filter(f => f.endsWith('.txt') || f.endsWith('.html'));
  if (docFiles.length === 0) {
    console.log(`  SKIP: ${target.label} (${key}) — 0 doc files`);
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
    lines.push(`${patId},${target.company},${target.product},network-switching`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/network-switching-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
