#!/usr/bin/env npx tsx
/**
 * Analyze Video-Streaming Sector CPC Code Distribution
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VIDEO-STREAMING CPC DETAILED ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  // Find video-streaming patents
  const streamPatents: Array<{ patentId: string; cpcCodes: string[] }> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'video-streaming') {
      streamPatents.push({ patentId, cpcCodes: data.cpc_codes || [] });
    }
  }

  console.log(`Video-streaming patents: ${streamPatents.length.toLocaleString()}\n`);

  // Count all CPC codes at different prefix levels
  const cpcCounts = new Map<string, number>();
  const h04nCounts = new Map<string, number>();

  for (const { cpcCodes } of streamPatents) {
    const seen = new Set<string>();
    const seenH04n = new Set<string>();

    for (const cpc of cpcCodes) {
      // Count top-level prefixes
      const prefix4 = cpc.substring(0, 4);
      if (!seen.has(prefix4)) {
        cpcCounts.set(prefix4, (cpcCounts.get(prefix4) || 0) + 1);
        seen.add(prefix4);
      }

      // Detailed H04N analysis
      if (cpc.startsWith('H04N')) {
        const match = cpc.match(/H04N(\d+)(\/\d+)?/);
        if (match) {
          const subCode = `H04N${match[1]}${match[2] || ''}`;
          if (!seenH04n.has(subCode)) {
            h04nCounts.set(subCode, (h04nCounts.get(subCode) || 0) + 1);
            seenH04n.add(subCode);
          }
        }
      }
    }
  }

  // Display top-level distribution
  console.log('TOP-LEVEL CPC DISTRIBUTION:');
  console.log('─'.repeat(60));
  const sortedTop = Array.from(cpcCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedTop.slice(0, 15)) {
    const pct = ((count / streamPatents.length) * 100).toFixed(1);
    console.log(`  ${code.padEnd(8)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)`);
  }

  // Display H04N sub-code distribution
  console.log('\n' + '═'.repeat(70));
  console.log('H04N SUB-CODE DISTRIBUTION:');
  console.log('─'.repeat(70));

  const descriptions: Record<string, string> = {
    'H04N21': 'Selective content distribution (IPTV)',
    'H04N21/2': 'Server components',
    'H04N21/20': 'Servers - general',
    'H04N21/21': 'Server components - hardware',
    'H04N21/218': 'Content management',
    'H04N21/222': 'Processing/storage',
    'H04N21/23': 'Processing/delivery',
    'H04N21/231': 'Transcoding',
    'H04N21/2343': 'Scheduling',
    'H04N21/2347': 'Time-shifting',
    'H04N21/24': 'Transmitting/delivering',
    'H04N21/25': 'Streaming protocols',
    'H04N21/254': 'Multicast',
    'H04N21/258': 'Adaptive streaming',
    'H04N21/262': 'Rate control',
    'H04N21/2662': 'Bandwidth management',
    'H04N21/4': 'Client components',
    'H04N21/41': 'Client structure',
    'H04N21/414': 'Client specialized features',
    'H04N21/4147': 'PVR/DVR',
    'H04N21/418': 'External card or devices',
    'H04N21/43': 'Processing of content/data',
    'H04N21/433': 'Extraction/indexing',
    'H04N21/44': 'Stream management',
    'H04N21/442': 'Buffering',
    'H04N21/4425': 'Jitter buffers',
    'H04N21/45': 'Management operations',
    'H04N21/458': 'Error recovery',
    'H04N21/462': 'QoE monitoring',
    'H04N21/472': 'End-user interface',
    'H04N21/475': 'EPG',
    'H04N21/478': 'Search/recommendation',
    'H04N21/6': 'Information exchange',
    'H04N21/61': 'Conditional access',
    'H04N21/63': 'Control/billing',
    'H04N21/633': 'DRM',
    'H04N21/647': 'Copy protection',
    'H04N21/8': 'End-user metadata',
    'H04N21/81': 'User preferences',
    'H04N21/845': 'Personalization',
    'H04N7': 'Television systems',
    'H04N7/14': 'Two-way video conferencing',
    'H04N7/15': 'Video conferencing systems',
    'H04N7/16': 'Analogue distribution',
    'H04N7/173': 'Interactive TV',
  };

  const sortedH04n = Array.from(h04nCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [code, count] of sortedH04n.slice(0, 30)) {
    const pct = ((count / streamPatents.length) * 100).toFixed(1);
    const desc = descriptions[code] || '';
    console.log(`  ${code.padEnd(14)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${desc}`);
  }

  // Groupings analysis
  console.log('\n' + '═'.repeat(70));
  console.log('POTENTIAL SUB-SECTOR GROUPINGS');
  console.log('═'.repeat(70));

  // Server-side streaming (H04N21/2)
  let serverTotal = 0;
  for (const [code, count] of sortedH04n) {
    if (code.match(/H04N21\/2\d/)) {
      serverTotal += count;
    }
  }
  console.log(`\n• Server-side/Delivery (H04N21/2x): ${serverTotal} patents`);

  // Client-side (H04N21/4)
  let clientTotal = 0;
  for (const [code, count] of sortedH04n) {
    if (code.match(/H04N21\/4\d/)) {
      clientTotal += count;
    }
  }
  console.log(`• Client-side/Player (H04N21/4x): ${clientTotal} patents`);

  // Control/DRM (H04N21/6)
  let drmTotal = 0;
  for (const [code, count] of sortedH04n) {
    if (code.match(/H04N21\/6\d/)) {
      drmTotal += count;
    }
  }
  console.log(`• Control/DRM (H04N21/6x): ${drmTotal} patents`);

  // User/metadata (H04N21/8)
  let userTotal = 0;
  for (const [code, count] of sortedH04n) {
    if (code.match(/H04N21\/8\d/)) {
      userTotal += count;
    }
  }
  console.log(`• User/Personalization (H04N21/8x): ${userTotal} patents`);

  // Video conferencing (H04N7/14-15)
  let confTotal = 0;
  for (const [code, count] of sortedH04n) {
    if (code.match(/H04N7\/14/) || code.match(/H04N7\/15/)) {
      confTotal += count;
    }
  }
  console.log(`• Video Conferencing (H04N7/14-15): ${confTotal} patents`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
