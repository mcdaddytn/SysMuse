#!/usr/bin/env npx tsx
/**
 * Break Out Video-Image Sector into Sub-Sectors
 *
 * Splits the video-image sector (1,767 patents) into more specific
 * sub-sectors based on CPC code analysis:
 *
 * - video-streaming: Content distribution, DRM, streaming (H04N21)
 * - video-codec: Compression, encoding, MPEG, AVC (H04N19)
 * - image-processing: Computer vision, enhancement, 3D (G06T)
 * - video-capture: Cameras, sensors, acquisition (H04N23, H04N25)
 * - video-display: Television systems, displays (H04N5, H04N7, H04N9)
 * - storage-media: Optical/magnetic recording (G11B)
 *
 * Usage: npx tsx scripts/breakout-video-image.ts
 */

import * as fs from 'fs';

interface SectorAssignment {
  sector: string;
  sectorName: string;
  cpc_codes?: string[];
  source?: string;
}

// Sub-sector mapping for video-image
const VIDEO_IMAGE_SUBSECTORS: Array<{
  prefixes: string[];
  sector: string;
  sectorName: string;
  description: string;
}> = [
  {
    // Video streaming and content distribution
    prefixes: ['H04N21'],
    sector: 'video-streaming',
    sectorName: 'Video Streaming/Distribution',
    description: 'Content distribution, DRM, IPTV, OTT streaming',
  },
  {
    // Video codecs and compression
    prefixes: ['H04N19'],
    sector: 'video-codec',
    sectorName: 'Video Codec/Compression',
    description: 'Video compression, MPEG, H.264/AVC, H.265/HEVC',
  },
  {
    // Image processing and computer vision
    prefixes: ['G06T'],
    sector: 'image-processing',
    sectorName: 'Image Processing/Vision',
    description: 'Image enhancement, analysis, 3D rendering, computer vision',
  },
  {
    // Video capture - cameras, sensors
    prefixes: ['H04N23', 'H04N25'],
    sector: 'video-capture',
    sectorName: 'Video Capture/Cameras',
    description: 'Digital cameras, image sensors, acquisition',
  },
  {
    // Storage media - optical and magnetic
    prefixes: ['G11B'],
    sector: 'storage-media',
    sectorName: 'Storage Media',
    description: 'Optical discs, magnetic recording, media formats',
  },
  {
    // Video display - TV systems
    prefixes: ['H04N5', 'H04N7', 'H04N9', 'H04N13'],
    sector: 'video-display',
    sectorName: 'Video Display/TV Systems',
    description: 'Television systems, color TV, 3D display',
  },
];

function getSubSector(cpcCodes: string[]): { sector: string; sectorName: string } | null {
  if (!cpcCodes || cpcCodes.length === 0) {
    return null;
  }

  // Count matches for each sub-sector
  const matchCounts = new Map<string, number>();

  for (const cpc of cpcCodes) {
    for (const subsector of VIDEO_IMAGE_SUBSECTORS) {
      for (const prefix of subsector.prefixes) {
        if (cpc.startsWith(prefix)) {
          const key = subsector.sector;
          matchCounts.set(key, (matchCounts.get(key) || 0) + 1);
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
    const subsector = VIDEO_IMAGE_SUBSECTORS.find(s => s.sector === bestSector);
    if (subsector) {
      return { sector: subsector.sector, sectorName: subsector.sectorName };
    }
  }

  return null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        VIDEO-IMAGE SECTOR BREAKOUT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const assignments: Record<string, SectorAssignment> = JSON.parse(
    fs.readFileSync('./output/patent-sector-assignments.json', 'utf-8')
  );

  const totalPatents = Object.keys(assignments).length;

  // Find video-image patents
  const videoImagePatents: Array<[string, SectorAssignment]> = [];
  for (const [patentId, data] of Object.entries(assignments)) {
    if (data.sector === 'video-image') {
      videoImagePatents.push([patentId, data]);
    }
  }

  console.log(`Total patents: ${totalPatents.toLocaleString()}`);
  console.log(`Video-image patents: ${videoImagePatents.length.toLocaleString()}\n`);

  // Show sub-sector definitions
  console.log('SUB-SECTOR DEFINITIONS:');
  console.log('─'.repeat(70));
  for (const subsector of VIDEO_IMAGE_SUBSECTORS) {
    console.log(`  ${subsector.sector.padEnd(18)} ${subsector.prefixes.join(', ').padEnd(25)} ${subsector.description}`);
  }
  console.log('─'.repeat(70) + '\n');

  // Process patents
  const subSectorCounts = new Map<string, number>();
  let reassigned = 0;
  let keptGeneral = 0;

  for (const [patentId, data] of videoImagePatents) {
    const newSubSector = getSubSector(data.cpc_codes || []);

    if (newSubSector) {
      data.sector = newSubSector.sector;
      data.sectorName = newSubSector.sectorName;
      data.source = 'cpc-breakout';
      reassigned++;
      subSectorCounts.set(newSubSector.sector, (subSectorCounts.get(newSubSector.sector) || 0) + 1);
    } else {
      // Keep as video-image (general)
      keptGeneral++;
      subSectorCounts.set('video-image', (subSectorCounts.get('video-image') || 0) + 1);
    }
  }

  // Save
  fs.writeFileSync('./output/patent-sector-assignments.json', JSON.stringify(assignments, null, 2));
  console.log('✓ Saved updated sector assignments\n');

  // Print results
  console.log('═'.repeat(70));
  console.log('BREAKOUT RESULTS');
  console.log('═'.repeat(70));
  console.log(`\nReassigned to sub-sectors: ${reassigned.toLocaleString()}`);
  console.log(`Kept in video-image: ${keptGeneral.toLocaleString()}\n`);

  console.log('NEW SUB-SECTOR DISTRIBUTION:');
  console.log('─'.repeat(70));

  const sortedSubSectors = Array.from(subSectorCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  for (const [sector, count] of sortedSubSectors) {
    const pct = ((count / videoImagePatents.length) * 100).toFixed(1);
    const subsectorDef = VIDEO_IMAGE_SUBSECTORS.find(s => s.sector === sector);
    const name = subsectorDef?.sectorName || 'Video/Image (General)';
    console.log(`  ${sector.padEnd(18)} ${count.toLocaleString().padStart(6)}  (${pct.padStart(5)}%)  ${name}`);
  }

  // Show overall distribution
  console.log('\n' + '═'.repeat(70));
  console.log('UPDATED OVERALL SECTOR DISTRIBUTION');
  console.log('═'.repeat(70));

  const overallCounts = new Map<string, number>();
  for (const data of Object.values(assignments)) {
    const sector = data.sector || 'general';
    overallCounts.set(sector, (overallCounts.get(sector) || 0) + 1);
  }

  const sortedOverall = Array.from(overallCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  console.log('\nTop sectors after breakout:');
  for (const [sector, count] of sortedOverall.slice(0, 25)) {
    const pct = ((count / totalPatents) * 100).toFixed(1);
    const marker = count > 500 ? '🔴' : count >= 50 ? '✅' : '🟡';
    console.log(`  ${marker} ${sector.padEnd(24)} ${count.toLocaleString().padStart(6)}  (${pct}%)`);
  }

  // Summary
  const largeSectors = sortedOverall.filter(([_, c]) => c > 500).length;
  const goodSectors = sortedOverall.filter(([_, c]) => c >= 50 && c <= 500).length;
  const smallSectors = sortedOverall.filter(([_, c]) => c < 50).length;

  console.log(`\nSector size summary:`);
  console.log(`  🔴 Large (>500):  ${largeSectors}`);
  console.log(`  ✅ Good (50-500): ${goodSectors}`);
  console.log(`  🟡 Small (<50):   ${smallSectors}`);

  console.log('\n' + '═'.repeat(70) + '\n');
}

main().catch(console.error);
