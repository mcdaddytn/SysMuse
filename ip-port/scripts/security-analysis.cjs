const data = require('../output/streaming-candidates-2026-01-25.json');

const security = data.candidates.filter(p => 
  p.super_sector === 'SECURITY' && p.remaining_years > 0
);

// Group by sector
const bySector = {};
for (const p of security) {
  const sec = p.sector || 'unknown';
  if (!bySector[sec]) bySector[sec] = [];
  bySector[sec].push(p);
}

const sectors = [
  'network-auth-access',
  'network-threat-protection',
  'computing-os-security',
  'network-secure-compute',
  'computing-auth-boot',
  'computing-data-protection',
  'network-crypto',
  'wireless-security'
];

for (const sec of sectors) {
  const patents = bySector[sec] || [];
  if (patents.length === 0) continue;
  
  // Sort by score
  patents.sort((a,b) => (b.score || 0) - (a.score || 0));
  
  console.log('\n' + '='.repeat(80));
  console.log(sec.toUpperCase() + ' (' + patents.length + ' patents)');
  console.log('='.repeat(80));
  
  // Show top 6 patents
  console.log('\nTop patents:');
  for (const p of patents.slice(0, 6)) {
    console.log('  ' + p.patent_id + ' (score: ' + (p.score || 0).toFixed(1).padStart(6) + ', cites: ' + 
      (p.forward_citations || 0).toString().padStart(3) + ')');
    console.log('    ' + p.patent_title.slice(0, 75));
  }
  
  // Extract themes from titles
  const allTitles = patents.map(p => p.patent_title.toLowerCase()).join(' ');
  const keywords = {};
  const terms = [
    'authentication', 'authorization', 'access control', 'identity',
    'password', 'biometric', 'token', 'credential', 'sso', 'oauth',
    'malware', 'virus', 'threat', 'attack', 'intrusion', 'anomaly',
    'firewall', 'encryption', 'decryption', 'cryptographic', 'key',
    'secure boot', 'trusted', 'tpm', 'enclave', 'sandbox',
    'certificate', 'signature', 'hash', 'blockchain',
    'network', 'packet', 'traffic', 'session'
  ];
  
  for (const term of terms) {
    const count = (allTitles.match(new RegExp(term, 'gi')) || []).length;
    if (count > 0) keywords[term] = count;
  }
  
  if (Object.keys(keywords).length > 0) {
    console.log('\nCommon themes:');
    const sorted = Object.entries(keywords).sort((a,b) => b[1] - a[1]).slice(0, 10);
    console.log('  ' + sorted.map(([k,v]) => k + ':' + v).join(', '));
  }
}
