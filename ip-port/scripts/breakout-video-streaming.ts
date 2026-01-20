#!/usr/bin/env npx tsx
/**
 * Break Out Video-Streaming Sector into Sub-Sectors
 *
 * Splits the video-streaming sector (616 patents) into more specific
 * sub-sectors based on H04N21 sub-code analysis:
 *
 * - stream-server: Server-side streaming, transcoding, delivery (H04N21/2)
 * - stream-client: Client player, buffering, UI, EPG (H04N21/4)
 * - stream-drm: DRM, conditional access, copy protection (H04N21/6)
 * - stream-user: User preferences, personalization (H04N21/8)
 * - stream-interactive: Interactive TV, cable systems (H04N7/17)
 *
 * Usage: npx tsx scripts/breakout-video-streaming.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for video-streaming - order matters (more specific first)
const STREAM_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // DRM, conditional access, copy protection - check first (more specific)
    prefixes: ['H04N21/6', 'H04N21/63', 'H04N21/64'],
    sector: 'stream-drm',
    sectorName: 'Streaming DRM/CA',
    description: 'DRM, conditional access, copy protection, billing',
  },
  {
    // User preferences, personalization
    prefixes: ['H04N21/8', 'H04N21/81', 'H04N21/84'],
    sector: 'stream-user',
    sectorName: 'Streaming Personalization',
    description: 'User preferences, personalization, recommendations',
  },
  {
    // Interactive TV, cable systems
    prefixes: ['H04N7/17', 'H04N7/16'],
    sector: 'stream-interactive',
    sectorName: 'Streaming Interactive/Cable',
    description: 'Interactive TV, cable systems, VOD',
  },
  {
    // Server-side streaming, transcoding, delivery
    prefixes: ['H04N21/2', 'H04N21/23', 'H04N21/24', 'H04N21/25'],
    sector: 'stream-server',
    sectorName: 'Streaming Server/Delivery',
    description: 'Server-side, transcoding, delivery, adaptive streaming',
  },
  {
    // Client player, buffering, UI, EPG
    prefixes: ['H04N21/4', 'H04N21/41', 'H04N21/43', 'H04N21/44', 'H04N21/47'],
    sector: 'stream-client',
    sectorName: 'Streaming Client/Player',
    description: 'Client player, buffering, UI, EPG, stream management',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of STREAM_SUBSECTORS) {
      for (const prefix of subsector.prefixes) {
        if (cpc.startsWith(prefix)) {
          matchCounts.set(subsector.sector, (matchCounts.get(subsector.sector) || 0) + 1);
          break;
        }
      }
    }
  }

  // Find the sub-sector with most matches
  let bestSector: string | null = null;
  let bestCount = 0;

  for (const [sector, count] of matchCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestSector = sector;
    }
  }

  if (bestSector) {
    const subsector = STREAM_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VIDEO-STREAMING SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find video-streaming patents
  const streamPatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'video-streaming') {
      streamPatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Video-streaming patents: ${streamPatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(85));
  for (const subsector of STREAM_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(20)} ${subsector.prefixes.slice(0, 3).join(', ').padEnd(28)} ${subsector.description}`);
  }
  console.log('─'.repeat(85) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of streamPatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as video-streaming (general)
      keptGeneral++;
      subSectorCounts.set('video-streaming', (subSectorCounts.get('video-streaming') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(85));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(85));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in video-streaming: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(85));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / streamPatents.length) * 100).toFixed(1);
    const subsectorDef = STREAM_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Video Streaming (General)';
    console.log(`  ${sector.padEnd(22)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(85));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(85));

  const overallCounts = new Map<string, number>();
  for (const data of Object.values(assignments)) {
    const sector = data.sector || 'general';
    overallCounts.set(sector, (overallCounts.get(sector) || 0) + 1);
  }

  const sortedOverall = Array.from(overallCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  console.log('\nTop sectors after breakout:');
  for (const [sector, count] of sortedOverall.slice(0, 30)) {
    const pct = ((count / totalPatents) * 100).toFixed(1);
    const marker = count > 500 ? '🔴' : count >= 50 ? '✅' : '🟡';
    console.log(`  ${marker} ${sector.padEnd(26)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Summary
  const largeSectors = sortedOverall.filter(([_, c]) => c > 500).length;
  const goodSectors = sortedOverall.filter(([_, c]) => c >= 50 && c <= 500).length;
  const smallSectors = sortedOverall.filter(([_, c]) => c < 50).length;

  console.log(`\nSector size summary:`);
  console.log(`  🔴 Large (>500):  ${largeSectors}`);
  console.log(`  ✅ Good (50-500): ${goodSectors}`);
  console.log(`  🟡 Small (<50):   ${smallSectors}`);

  console.log('\n' + '═'.repeat(85) + '\n');
}

main().catch(console.error);
