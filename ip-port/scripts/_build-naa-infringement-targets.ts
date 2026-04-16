/**
 * Build infringement scoring targets for network-auth-access patents.
 * Focuses on security/identity companies with best product doc coverage.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Palo Alto Networks - Cortex XDR (endpoint detection) + VM-Series (virtual firewall)
  { company: 'palo-alto-networks', product: 'cortex-xdr', label: 'Palo Alto Cortex XDR' },
  { company: 'palo-alto-networks', product: 'vm-series-virtual-next-generation-firewall', label: 'Palo Alto VM-Series' },
  // Fortinet - FortiGate (core firewall) + FortiEDR (endpoint)
  { company: 'fortinet', product: 'fortigate', label: 'Fortinet FortiGate' },
  { company: 'fortinet', product: 'fortiedr', label: 'Fortinet FortiEDR' },
  // CrowdStrike - Falcon platform (endpoint security)
  { company: 'crowdstrike', product: 'falcon-enterprise', label: 'CrowdStrike Falcon' },
  // Okta - Identity governance + Universal Directory
  { company: 'okta', product: 'okta-universal-directory', label: 'Okta Universal Directory' },
  // Zscaler - Zero Trust Exchange (cloud security)
  { company: 'zscaler', product: 'zscaler-zero-trust-exchange', label: 'Zscaler ZTX' },
  // Cisco ISE - Identity Services Engine (network access control)
  { company: 'cisco-systems', product: 'cisco-identity-services-engine-ise', label: 'Cisco ISE' },
];

// Read patent list
const patentLines = fs.readFileSync('output/vendor-exports/network-auth-access-2026-04-06/vendor-targets.csv', 'utf-8')
  .split('\n').slice(1).filter(l => l.trim());
const patents = patentLines.map(l => l.split(',')[0].replace(/^US/, '').replace(/B\d+$/, ''));

console.log(`Patents: ${patents.length}`);

// Build target pairs, skipping already-scored
const lines = ['PatentId,Target,TargetProduct,Sector'];
let total = 0;
let skipped = 0;

for (const target of TARGETS) {
  // Check existing scores
  const scoreDir = path.join(SCORES_DIR, target.company, target.product);
  const existingScores = new Set<string>();
  if (fs.existsSync(scoreDir)) {
    for (const f of fs.readdirSync(scoreDir)) {
      if (f.endsWith('.json')) existingScores.add(f.replace('.json', ''));
    }
  }

  // Check docs
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
    lines.push(`${patId},${target.company},${target.product},network-auth-access`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/network-auth-access-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
