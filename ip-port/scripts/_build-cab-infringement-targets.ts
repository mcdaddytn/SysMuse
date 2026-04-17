/**
 * Build infringement scoring targets for computing-auth-boot patents.
 * 10 products across 7 companies covering identity management, SSO,
 * secure boot, device management, and access control.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Okta - Workforce Identity + Universal Directory + Governance
  { company: 'okta', product: 'okta-workforce-identity', label: 'Okta Workforce Identity' },
  { company: 'okta', product: 'okta-universal-directory', label: 'Okta Universal Directory' },
  { company: 'okta', product: 'okta-identity-governance', label: 'Okta Identity Governance' },
  // Cisco - Identity Services Engine (ISE)
  { company: 'cisco-systems', product: 'cisco-identity-services-engine-ise', label: 'Cisco ISE' },
  // Ping Identity - PingFederate SSO
  { company: 'ping-identity', product: 'pingfederate-sso', label: 'Ping Identity PingFederate SSO' },
  { company: 'ping-identity', product: 'pingfederate-server-documentation', label: 'Ping Identity PingFederate Server' },
  // Microsoft - Entra ID (Azure AD replacement)
  { company: 'microsoft', product: 'microsoft-entra-id', label: 'Microsoft Entra ID' },
  // Microsoft - Intune (device management, secure boot enforcement)
  { company: 'microsoft', product: 'microsoft-intune', label: 'Microsoft Intune' },
  // Microsoft - Hyper-V (secure boot virtualization)
  { company: 'microsoft', product: 'hyper-v', label: 'Microsoft Hyper-V' },
  // Palo Alto - Cortex XSOAR (security orchestration, auth workflows)
  { company: 'palo-alto-networks', product: 'cortex-xsoar', label: 'Palo Alto Cortex XSOAR' },
];

// Read patent list from V3 vendor package
const vendorDir = fs.readdirSync('output/vendor-exports/').filter(d => d.startsWith('computing-auth-boot-')).sort().pop();
if (!vendorDir) { console.error('No computing-auth-boot vendor export found'); process.exit(1); }
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
    lines.push(`${patId},${target.company},${target.product},computing-auth-boot`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/computing-auth-boot-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
