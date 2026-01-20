#!/usr/bin/env npx tsx
/**
 * Analyze Remaining Patents in a Sector
 *
 * Examines CPC distribution of remaining patents in a sector after breakout
 * to identify further sub-sector opportunities.
 *
 * Usage: npx tsx scripts/analyze-remaining-sector.ts <sector-name>
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

const CPC_DESCRIPTIONS: Record<string, string> = {
  'H04L1': 'Error detection/correction',
  'H04L5': 'Multiplexing (OFDM, time division)',
  'H04L7': 'Synchronization (clock recovery)',
  'H04L9': 'Cryptography',
  'H04L12': 'Data switching networks (LANs)',
  'H04L20': 'Signaling transmission',
  'H04L25': 'Baseband systems',
  'H04L27': 'Modulation systems',
  'H04L41': 'Network management',
  'H04L43': 'Network monitoring',
  'H04L45': 'Packet routing',
  'H04L47': 'Traffic control (QoS)',
  'H04L49': 'Packet switching',
  'H04L61': 'Network addressing',
  'H04L63': 'Network security',
  'H04L65': 'Network services',
  'H04L67': 'Network protocols',
  'H04L69': 'Protocol layers',
  'G06F9': 'Computing/scheduling',
  'G06F11': 'Fault tolerance',
  'G06F16': 'Database/search',
  'G06F21': 'Security',
  'H04W': 'Wireless',
  'H04B': 'Transmission',
  'H04N': 'Video',
};

async function main() {
  const sectorName = process.argv[2] || 'network-security';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`        ANALYZE REMAINING: ${sectorName.toUpperCase()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find patents in this sector
  const sectorPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === sectorName) {
      sectorPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`Patents in ${sectorName}: ${sectorPatents.length.toLocaleString()}\n`);

  if (sectorPatents.length === 0) {
    console.log('No patents found in this sector.');
    return;
  }

  // Count CPC prefixes
  const cpcCounts = new Map<string, number>();

  for (const { cpcCodes } of sectorPatents) {
    const seen = new Set<string>();
    for (const cpc of cpcCodes) {
      // Try different prefix lengths
      for (const len of [6, 5, 4]) {
        const prefix = cpc.substring(0, len).replace(/[/\\]$/, '');
        if (!seen.has(prefix)) {
          cpcCounts.set(prefix, (cpcCounts.get(prefix) || 0) + 1);
          seen.add(prefix);
        }
      }
    }
  }

  // Sort by count
  const sorted = Array.from(cpcCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  // Show 6-char prefixes (most specific)
  console.log('DETAILED CPC DISTRIBUTION (6-char prefixes):');
  console.log('─'.repeat(70));

  const sixChar = sorted.filter(([p]) => p.length >= 5).slice(0, 25);
  for (const [prefix, count] of sixChar) {
    const pct = ((count / sectorPatents.length) * 100).toFixed(1);
    const desc = CPC_DESCRIPTIONS[prefix] || CPC_DESCRIPTIONS[prefix.substring(0, 5)] || '';
    console.log(`  ${prefix.padEnd(10)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Show 4-char prefixes (broader categories)
  console.log('\nBROAD CPC CATEGORIES (4-char prefixes):');
  console.log('─'.repeat(70));

  const fourChar = sorted.filter(([p]) => p.length === 4).slice(0, 15);
  for (const [prefix, count] of fourChar) {
    const pct = ((count / sectorPatents.length) * 100).toFixed(1);
    console.log(`  ${prefix.padEnd(6)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Identify potential groupings
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL FURTHER BREAKOUTS');
  console.log('═'.repeat(70));

  const MIN_SIZE = 100;
  const potential = sixChar.filter(([_, count]) => count >= MIN_SIZE);

  if (potential.length > 0) {
    console.log(`\nCPC prefixes with >${MIN_SIZE} patents:`);
    for (const [prefix, count] of potential) {
      const desc = CPC_DESCRIPTIONS[prefix] || CPC_DESCRIPTIONS[prefix.substring(0, 5)] || 'Unknown';
      console.log(`  • ${prefix}: ${count} patents - ${desc}`);
    }
  } else {
    console.log(`\nNo single CPC prefix has >${MIN_SIZE} patents.`);
    console.log('The remaining patents are distributed across many CPC codes.');
    console.log('Further breakout may not yield meaningful sub-sectors.');
  }

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
