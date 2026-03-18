/**
 * Discover additional patent candidates based on hot heatmap results.
 *
 * Finds portfolio patents that share CPC clusters / sectors with hot heatmap
 * patents but aren't yet in the heatmap data — candidates for the next
 * Patlytics batch submission.
 *
 * Usage:
 *   npx tsx scripts/discover-patents-from-heatmap.ts [options]
 *     --min-hot-score <n>   (default: 0.80)
 *     --top <n>             Report top N candidates (default: 100)
 *     --output <path>       (default: output/heatmap-discovery-candidates.json)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  getHotPatents,
  type PatentCache,
} from '../src/api/services/patlytics-cache-service.js';

const prisma = new PrismaClient();

// ── Types ──────────────────────────────────────────────────────────────────

interface DiscoverArgs {
  minHotScore: number;
  top: number;
  outputPath: string;
}

interface DiscoveryCandidate {
  patentId: string;
  title: string;
  primarySector: string | null;
  superSector: string | null;
  primarySubSectorName: string | null;
  baseScore: number | null;
  compositeScore: number | null;
  cpcCodes: string[];
  discoveryScore: number;
  discoveryReasons: string[];
  cpcOverlapCount: number;
  sectorOverlapCount: number;
  relatedHotPatents: string[];
}

// ── Arg Parsing ────────────────────────────────────────────────────────────

function parseArgs(): DiscoverArgs {
  const args = process.argv.slice(2);
  let minHotScore = 0.80;
  let top = 100;
  let outputPath = path.join(process.cwd(), 'output', 'heatmap-discovery-candidates.json');

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--min-hot-score' && args[i + 1]) {
      minHotScore = parseFloat(args[++i]);
    } else if (arg === '--top' && args[i + 1]) {
      top = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      outputPath = args[++i];
    }
  }

  return { minHotScore, top, outputPath };
}

// ── Discovery Logic ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('=== Heatmap-Based Patent Discovery ===');
  console.log(`Min hot score: ${config.minHotScore}`);
  console.log(`Top N candidates: ${config.top}`);

  // Step 1: Load hot patents from heatmap cache
  console.log('\nLoading hot heatmap patents...');
  const hotPatents = getHotPatents(config.minHotScore);
  console.log(`  Found ${hotPatents.length} hot patents (≥${config.minHotScore})`);

  if (hotPatents.length === 0) {
    console.log('No hot patents found. Run import-patlytics-heatmaps.ts first.');
    await prisma.$disconnect();
    return;
  }

  const hotPatentIds = new Set(hotPatents.map(p => p.patentId));

  // Step 2: Get CPC codes and sectors for hot patents from DB
  console.log('Loading hot patent metadata from DB...');
  const hotPatentMeta = await prisma.patent.findMany({
    where: { patentId: { in: [...hotPatentIds] } },
    select: {
      patentId: true,
      primarySector: true,
      superSector: true,
      primarySubSectorName: true,
      primaryCpc: true,
      cpcCodes: { select: { cpcCode: true } },
    },
  });

  console.log(`  Found ${hotPatentMeta.length}/${hotPatentIds.size} in DB`);

  // Build CPC and sector profiles from hot patents
  const hotCpcCodes = new Set<string>();
  const hotCpcGroups = new Set<string>(); // First 4 chars (e.g., H03H)
  const hotSectors = new Set<string>();
  const hotSubSectors = new Set<string>();

  for (const p of hotPatentMeta) {
    if (p.primarySector) hotSectors.add(p.primarySector);
    if (p.primarySubSectorName) hotSubSectors.add(p.primarySubSectorName);
    if (p.primaryCpc) {
      hotCpcCodes.add(p.primaryCpc);
      hotCpcGroups.add(p.primaryCpc.substring(0, 4));
    }
    for (const c of p.cpcCodes) {
      hotCpcCodes.add(c.cpcCode);
      hotCpcGroups.add(c.cpcCode.substring(0, 4));
    }
  }

  console.log(`  Hot CPC groups: ${hotCpcGroups.size}`);
  console.log(`  Hot sectors: ${hotSectors.size}`);
  console.log(`  Hot sub-sectors: ${hotSubSectors.size}`);

  // Step 3: Find portfolio patents in the same sectors/CPC clusters that are NOT in heatmap
  console.log('\nSearching for candidate patents...');

  // Query patents in the same sectors
  const sectorCandidates = hotSectors.size > 0
    ? await prisma.patent.findMany({
        where: {
          primarySector: { in: [...hotSectors] },
          patentId: { notIn: [...hotPatentIds] },
          isExpired: false,
        },
        select: {
          patentId: true,
          title: true,
          primarySector: true,
          superSector: true,
          primarySubSectorName: true,
          baseScore: true,
          primaryCpc: true,
          cpcCodes: { select: { cpcCode: true } },
        },
      })
    : [];

  console.log(`  Sector-matched candidates: ${sectorCandidates.length}`);

  // Get composite scores for candidates
  const candidateIds = sectorCandidates.map(c => c.patentId);
  const compositeScores = candidateIds.length > 0
    ? await prisma.patentCompositeScore.findMany({
        where: {
          patentId: { in: candidateIds },
          scoreName: 'v3_consensus',
        },
        select: { patentId: true, value: true },
      })
    : [];

  const compositeMap = new Map(compositeScores.map(s => [s.patentId, s.value]));

  // Step 4: Score candidates by relevance to hot patents
  const candidates: DiscoveryCandidate[] = [];

  for (const patent of sectorCandidates) {
    const patentCpcs = [
      ...(patent.primaryCpc ? [patent.primaryCpc] : []),
      ...patent.cpcCodes.map(c => c.cpcCode),
    ];
    const patentCpcGroups = new Set(patentCpcs.map(c => c.substring(0, 4)));

    // Calculate CPC overlap
    const cpcOverlap = [...patentCpcGroups].filter(g => hotCpcGroups.has(g));
    const cpcOverlapCount = cpcOverlap.length;

    // Calculate sector/sub-sector overlap
    let sectorOverlapCount = 0;
    const reasons: string[] = [];

    if (patent.primarySector && hotSectors.has(patent.primarySector)) {
      sectorOverlapCount++;
      reasons.push(`Same sector: ${patent.primarySector}`);
    }
    if (patent.primarySubSectorName && hotSubSectors.has(patent.primarySubSectorName)) {
      sectorOverlapCount++;
      reasons.push(`Same sub-sector: ${patent.primarySubSectorName}`);
    }
    if (cpcOverlapCount > 0) {
      reasons.push(`${cpcOverlapCount} CPC group overlap(s): ${cpcOverlap.join(', ')}`);
    }

    // Find which hot patents this candidate is related to
    const relatedHot: string[] = [];
    for (const hp of hotPatentMeta) {
      const hpCpcGroups = new Set([
        ...(hp.primaryCpc ? [hp.primaryCpc.substring(0, 4)] : []),
        ...hp.cpcCodes.map(c => c.cpcCode.substring(0, 4)),
      ]);
      const overlap = [...patentCpcGroups].some(g => hpCpcGroups.has(g));
      if (overlap || (patent.primarySector && hp.primarySector === patent.primarySector)) {
        relatedHot.push(hp.patentId);
      }
    }

    // Compute discovery score (higher = more likely to be relevant)
    const compositeScore = compositeMap.get(patent.patentId) ?? null;
    const internalScoreBonus = compositeScore ? compositeScore * 2 : 0;
    const baseScoreBonus = patent.baseScore ? patent.baseScore * 0.5 : 0;
    const discoveryScore =
      cpcOverlapCount * 3 +       // CPC overlap is strong signal
      sectorOverlapCount * 2 +     // Sector match
      internalScoreBonus +         // Internal score matters
      baseScoreBonus +             // Base score as tiebreaker
      (relatedHot.length * 0.5);   // Related to many hot patents

    if (discoveryScore > 0) {
      candidates.push({
        patentId: patent.patentId,
        title: patent.title,
        primarySector: patent.primarySector,
        superSector: patent.superSector,
        primarySubSectorName: patent.primarySubSectorName,
        baseScore: patent.baseScore,
        compositeScore,
        cpcCodes: patentCpcs,
        discoveryScore,
        discoveryReasons: reasons,
        cpcOverlapCount,
        sectorOverlapCount,
        relatedHotPatents: relatedHot.slice(0, 10), // Limit for readability
      });
    }
  }

  // Sort by discovery score and take top N
  candidates.sort((a, b) => b.discoveryScore - a.discoveryScore);
  const topCandidates = candidates.slice(0, config.top);

  console.log(`\nTotal candidates scored: ${candidates.length}`);
  console.log(`Top ${config.top} selected`);

  // Step 5: Output results
  const outputDir = path.dirname(config.outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    config: {
      minHotScore: config.minHotScore,
      topN: config.top,
    },
    hotPatentCount: hotPatents.length,
    hotSectors: [...hotSectors],
    hotSubSectors: [...hotSubSectors],
    hotCpcGroups: [...hotCpcGroups],
    totalCandidatesScored: candidates.length,
    candidates: topCandidates,
  };

  fs.writeFileSync(config.outputPath, JSON.stringify(output, null, 2));
  console.log(`\nOutput: ${config.outputPath}`);

  // Print top candidates
  console.log('\n=== Top Discovery Candidates ===');
  console.log('');
  for (const c of topCandidates.slice(0, 20)) {
    console.log(`  ${c.patentId} (score: ${c.discoveryScore.toFixed(1)}) — ${c.title.substring(0, 60)}`);
    console.log(`    Sector: ${c.primarySector ?? '-'} | Sub: ${c.primarySubSectorName ?? '-'}`);
    console.log(`    CPC overlap: ${c.cpcOverlapCount} | Related hot: ${c.relatedHotPatents.length}`);
    if (c.compositeScore) console.log(`    Internal composite: ${c.compositeScore.toFixed(4)}`);
    console.log('');
  }

  // Summary by sector
  const sectorCounts = new Map<string, number>();
  for (const c of topCandidates) {
    const s = c.primarySector || 'unknown';
    sectorCounts.set(s, (sectorCounts.get(s) || 0) + 1);
  }
  console.log('Candidates by sector:');
  for (const [sector, count] of [...sectorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${sector}: ${count}`);
  }

  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
