/**
 * Build infringement scoring targets for network-threat-protection patents.
 * 10 products across 8 companies covering firewalls, EDR, SIEM, and NDR.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCORES_DIR = path.resolve('./cache/infringement-scores');
const GLSSD2_DOCS = '/Volumes/GLSSD2/data/products/docs';

const TARGETS = [
  // Palo Alto - Cortex XDR + NGFW
  { company: 'palo-alto-networks', product: 'cortex-xdr', label: 'Palo Alto Cortex XDR' },
  { company: 'palo-alto-networks', product: 'next-generation-firewalls', label: 'Palo Alto NGFW' },
  // CrowdStrike - Falcon
  { company: 'crowdstrike', product: 'falcon-platform', label: 'CrowdStrike Falcon' },
  // Fortinet - FortiGate NGFW
  { company: 'fortinet', product: 'fortigate-next-generation-firewalls', label: 'Fortinet FortiGate NGFW' },
  // Check Point - Infinity Threat Prevention
  { company: 'check-point-software', product: 'infinity-threat-prevention', label: 'Check Point Infinity' },
  // Cisco - Secure Firewall + Network Analytics
  { company: 'cisco-systems', product: 'cisco-secure-firewall', label: 'Cisco Secure Firewall' },
  { company: 'cisco-systems', product: 'cisco-secure-network-analytics', label: 'Cisco Secure Network Analytics' },
  // Splunk - Enterprise Security (SIEM)
  { company: 'splunk', product: 'splunk-enterprise-security', label: 'Splunk Enterprise Security' },
  // Darktrace - AI threat detection
  { company: 'darktrace', product: 'darktrace-detect', label: 'Darktrace Detect' },
  // SentinelOne - Singularity
  { company: 'sentinelone', product: 'singularity-platform', label: 'SentinelOne Singularity' },
];

// Read patent list
const patentLines = fs.readFileSync('output/vendor-exports/network-threat-protection-2026-04-06/vendor-targets.csv', 'utf-8')
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
    lines.push(`${patId},${target.company},${target.product},network-threat-protection`);
    total++;
    targetNew++;
  }
  console.log(`  ${target.label}: ${docFiles.length} docs (${(totalSize / 1024).toFixed(0)}K), ${targetNew} new pairs (${existingScores.size} already scored)`);
}

const csvPath = path.resolve('./output/network-threat-protection-infringement-targets.csv');
fs.writeFileSync(csvPath, lines.join('\n'));
console.log(`\nTotal new pairs: ${total} (${skipped} already scored)`);
console.log(`Written: ${csvPath}`);
console.log(`\nEstimated cost: Pass1 ${total} × $0.01 = $${(total * 0.01).toFixed(2)}, Pass2 ~${Math.round(total * 0.3)} × $0.05 = $${(total * 0.3 * 0.05).toFixed(2)}`);
console.log(`Total estimate: ~$${(total * 0.01 + total * 0.3 * 0.05).toFixed(2)}`);
