/**
 * Analyze heatmap coverage across super-sectors and sectors.
 * Identifies what's covered, what's missing, and surfaces discovery candidates.
 *
 * Usage:
 *   npx tsx scripts/analyze-heatmap-coverage.ts [options]
 *     --min-hot <n>         Hot threshold (default: 0.80)
 *     --min-medium <n>      Medium threshold (default: 0.60)
 *     --discovery-top <n>   Top N discovery candidates per sector (default: 20)
 *     --output <dir>        Output directory (default: output/heatmap-coverage/)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  getAllPatentCaches,
  getAllProductCaches,
  readManifest,
  readCompaniesIndex,
  type PatentCache,
  type ProductCache,
} from '../src/api/services/patlytics-cache-service.js';

const prisma = new PrismaClient();

// ── Types ──────────────────────────────────────────────────────────────────

interface AnalysisArgs {
  minHot: number;
  minMedium: number;
  discoveryTop: number;
  outputDir: string;
}

interface HeatmapTopic {
  sourceSlug: string;
  fileName: string;
  patentCount: number;
  productCount: number;
  documentCount: number;
  mappedSuperSectors: Set<string>;
  mappedSectors: Set<string>;
  patentIds: string[];
  hotPatentIds: string[];
}

interface SectorCoverage {
  sector: string;
  superSector: string;
  totalPortfolioPatents: number;
  heatmapPatents: number;
  hotHeatmapPatents: number;
  mediumHeatmapPatents: number;
  pctCovered: number;
  heatmapTopics: string[];
  topHeatmapPatents: Array<{
    patentId: string;
    maxHeatmapScore: number;
    internalScore: number | null;
    internalRank: number | null;
    hotProducts: number;
    title: string;
  }>;
}

interface DiscoveryCandidate {
  patentId: string;
  title: string;
  sector: string;
  superSector: string;
  subSector: string | null;
  internalScore: number | null;
  internalRank: number | null;
  subSectorScore: number | null;
  baseScore: number | null;
  cpcCodes: string[];
  relatedHotPatentCount: number;
  cpcOverlapWithHot: number;
  discoveryScore: number;
  reason: string;
}

// ── Arg Parsing ────────────────────────────────────────────────────────────

function parseArgs(): AnalysisArgs {
  const args = process.argv.slice(2);
  let minHot = 0.80;
  let minMedium = 0.60;
  let discoveryTop = 20;
  let outputDir = path.join(process.cwd(), 'output', 'heatmap-coverage');

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--min-hot' && args[i + 1]) minHot = parseFloat(args[++i]);
    else if (arg === '--min-medium' && args[i + 1]) minMedium = parseFloat(args[++i]);
    else if (arg === '--discovery-top' && args[i + 1]) discoveryTop = parseInt(args[++i], 10);
    else if (arg === '--output' && args[i + 1]) outputDir = args[++i];
  }

  return { minHot, minMedium, discoveryTop, outputDir };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('=== Heatmap Coverage Analysis ===\n');

  // ── 1. Load heatmap data ──

  const allPatents = getAllPatentCaches();
  const allProducts = getAllProductCaches();
  const manifest = readManifest();
  const companies = readCompaniesIndex();

  console.log(`Heatmap patents: ${allPatents.length}`);
  console.log(`Heatmap products: ${allProducts.length}`);
  console.log(`Source files: ${manifest.sources.length}`);

  const heatmapPatentIds = new Set(allPatents.map(p => p.patentId));

  // ── 2. Get sector/super-sector mappings for heatmap patents from DB ──

  const patentMeta = await prisma.patent.findMany({
    where: { patentId: { in: [...heatmapPatentIds] } },
    select: {
      patentId: true,
      title: true,
      primarySector: true,
      superSector: true,
      primarySubSectorName: true,
      primaryCpc: true,
      baseScore: true,
      cpcCodes: { select: { cpcCode: true } },
    },
  });

  const patentMetaMap = new Map(patentMeta.map(p => [p.patentId, p]));

  // Get internal scores
  const internalScores = await prisma.patentCompositeScore.findMany({
    where: { patentId: { in: [...heatmapPatentIds] }, scoreName: 'v3_score' },
    select: { patentId: true, value: true, rank: true },
  });
  const scoreMap = new Map(internalScores.map(s => [s.patentId, s]));

  // ── 3. Map source files to super-sectors/sectors ──

  const topics: HeatmapTopic[] = [];
  for (const src of manifest.sources) {
    const topic: HeatmapTopic = {
      sourceSlug: src.sourceSlug,
      fileName: src.fileName,
      patentCount: src.patentCount,
      productCount: src.productCount,
      documentCount: src.documentCount,
      mappedSuperSectors: new Set(),
      mappedSectors: new Set(),
      patentIds: [],
      hotPatentIds: [],
    };

    // Find patents from this source
    for (const patent of allPatents) {
      if (patent.sourceFiles.includes(src.sourceSlug)) {
        topic.patentIds.push(patent.patentId);
        if (patent.maxScoreOverall >= config.minHot) {
          topic.hotPatentIds.push(patent.patentId);
        }
        const meta = patentMetaMap.get(patent.patentId);
        if (meta) {
          if (meta.superSector) topic.mappedSuperSectors.add(meta.superSector);
          if (meta.primarySector) topic.mappedSectors.add(meta.primarySector);
        }
      }
    }
    topics.push(topic);
  }

  // ── 4. Build super-sector coverage matrix ──

  // Load super-sector config
  const rawSuperSectors = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config', 'super-sectors.json'), 'utf-8')
  );
  const superSectorConfig = rawSuperSectors.superSectors || rawSuperSectors;

  // Count total portfolio patents per sector/super-sector
  const sectorCounts = await prisma.patent.groupBy({
    by: ['primarySector'],
    _count: { patentId: true },
    where: { isExpired: false, primarySector: { not: null } },
  });
  const sectorCountMap = new Map(
    sectorCounts.map(s => [s.primarySector!, s._count.patentId])
  );

  const superSectorCounts = await prisma.patent.groupBy({
    by: ['superSector'],
    _count: { patentId: true },
    where: { isExpired: false, superSector: { not: null } },
  });
  const superSectorCountMap = new Map(
    superSectorCounts.map(s => [s.superSector!, s._count.patentId])
  );

  // Build per-sector coverage
  const sectorCoverages: SectorCoverage[] = [];
  const allSectors = new Set<string>();

  for (const [superSector, ssData] of Object.entries(superSectorConfig)) {
    const sectors: string[] = (ssData as { sectors?: string[] }).sectors || [];

    for (const sector of sectors) {
      allSectors.add(sector);
      const totalPatents = sectorCountMap.get(sector) || 0;

      // Find heatmap patents in this sector
      const heatmapInSector = allPatents.filter(p => {
        const meta = patentMetaMap.get(p.patentId);
        return meta?.primarySector === sector;
      });

      const hotInSector = heatmapInSector.filter(p => p.maxScoreOverall >= config.minHot);
      const mediumInSector = heatmapInSector.filter(
        p => p.maxScoreOverall >= config.minMedium && p.maxScoreOverall < config.minHot
      );

      // Which topics cover this sector
      const coveredByTopics = topics
        .filter(t => t.mappedSectors.has(sector))
        .map(t => t.sourceSlug);

      const topPatents = heatmapInSector
        .sort((a, b) => b.maxScoreOverall - a.maxScoreOverall)
        .slice(0, 5)
        .map(p => {
          const score = scoreMap.get(p.patentId);
          return {
            patentId: p.patentId,
            maxHeatmapScore: p.maxScoreOverall,
            internalScore: score?.value ?? null,
            internalRank: score?.rank ?? null,
            hotProducts: p.hotProductCount,
            title: patentMetaMap.get(p.patentId)?.title ?? p.title,
          };
        });

      sectorCoverages.push({
        sector,
        superSector,
        totalPortfolioPatents: totalPatents,
        heatmapPatents: heatmapInSector.length,
        hotHeatmapPatents: hotInSector.length,
        mediumHeatmapPatents: mediumInSector.length,
        pctCovered: totalPatents > 0 ? (heatmapInSector.length / totalPatents) * 100 : 0,
        heatmapTopics: coveredByTopics,
        topHeatmapPatents: topPatents,
      });
    }
  }

  // Also check for heatmap patents in sectors not in super-sector config
  for (const patent of allPatents) {
    const meta = patentMetaMap.get(patent.patentId);
    if (meta?.primarySector && !allSectors.has(meta.primarySector)) {
      // Sector exists but isn't in super-sectors config
      const existing = sectorCoverages.find(c => c.sector === meta.primarySector);
      if (!existing) {
        sectorCoverages.push({
          sector: meta.primarySector!,
          superSector: meta.superSector || 'UNKNOWN',
          totalPortfolioPatents: sectorCountMap.get(meta.primarySector!) || 0,
          heatmapPatents: 1,
          hotHeatmapPatents: patent.maxScoreOverall >= config.minHot ? 1 : 0,
          mediumHeatmapPatents: patent.maxScoreOverall >= config.minMedium && patent.maxScoreOverall < config.minHot ? 1 : 0,
          pctCovered: 0,
          heatmapTopics: patent.sourceFiles,
          topHeatmapPatents: [{
            patentId: patent.patentId,
            maxHeatmapScore: patent.maxScoreOverall,
            internalScore: scoreMap.get(patent.patentId)?.value ?? null,
            internalRank: scoreMap.get(patent.patentId)?.rank ?? null,
            hotProducts: patent.hotProductCount,
            title: meta.title,
          }],
        });
      }
    }
  }

  // ── 5. Discovery: find candidate patents in covered sectors ──

  const coveredSectors = sectorCoverages.filter(c => c.heatmapPatents > 0);
  const coveredSectorNames = coveredSectors.map(c => c.sector);

  // Get CPC profile of hot patents
  const hotPatentMetas = patentMeta.filter(p => {
    const heatmap = allPatents.find(h => h.patentId === p.patentId);
    return heatmap && heatmap.maxScoreOverall >= config.minHot;
  });

  const hotCpcGroups = new Set<string>();
  const hotCpcFull = new Set<string>();
  for (const p of hotPatentMetas) {
    if (p.primaryCpc) {
      hotCpcGroups.add(p.primaryCpc.substring(0, 4));
      hotCpcFull.add(p.primaryCpc);
    }
    for (const c of p.cpcCodes) {
      hotCpcGroups.add(c.cpcCode.substring(0, 4));
      hotCpcFull.add(c.cpcCode);
    }
  }

  // Find candidates: same sectors, not in heatmap, good internal scores
  console.log('\nSearching for discovery candidates in covered sectors...');

  const candidates = await prisma.patent.findMany({
    where: {
      primarySector: { in: coveredSectorNames },
      patentId: { notIn: [...heatmapPatentIds] },
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
  });

  const candidateIds = candidates.map(c => c.patentId);

  // Batch queries to avoid exceeding bind variable limit (32767)
  const BATCH_SIZE = 10000;
  const candidateScoreMap = new Map<string, { patentId: string; value: number; rank: number | null }>();
  for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
    const batch = candidateIds.slice(i, i + BATCH_SIZE);
    const scores = await prisma.patentCompositeScore.findMany({
      where: { patentId: { in: batch }, scoreName: 'v3_score' },
      select: { patentId: true, value: true, rank: true },
    });
    for (const s of scores) candidateScoreMap.set(s.patentId, s);
  }

  // Also get sub-sector scores (batched)
  const candidateSubScoreMap = new Map<string, number>();
  for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
    const batch = candidateIds.slice(i, i + BATCH_SIZE);
    const subScores = await prisma.patentSubSectorScore.findMany({
      where: { patentId: { in: batch } },
      select: { patentId: true, compositeScore: true },
      orderBy: { compositeScore: 'desc' },
      distinct: ['patentId'],
    });
    for (const s of subScores) {
      if (!candidateSubScoreMap.has(s.patentId) || s.compositeScore > candidateSubScoreMap.get(s.patentId)!) {
        candidateSubScoreMap.set(s.patentId, s.compositeScore);
      }
    }
  }

  // Score candidates
  const discoveryResults: DiscoveryCandidate[] = [];

  for (const patent of candidates) {
    const patentCpcs = [
      ...(patent.primaryCpc ? [patent.primaryCpc] : []),
      ...patent.cpcCodes.map(c => c.cpcCode),
    ];
    const patentCpcGroups = new Set(patentCpcs.map(c => c.substring(0, 4)));

    const cpcOverlap = [...patentCpcGroups].filter(g => hotCpcGroups.has(g)).length;
    const exactCpcOverlap = patentCpcs.filter(c => hotCpcFull.has(c)).length;

    // Count related hot patents (same sub-sector or CPC group)
    let relatedHotCount = 0;
    for (const hp of hotPatentMetas) {
      if (hp.primarySector === patent.primarySector) {
        relatedHotCount++;
      }
    }

    const internalScore = candidateScoreMap.get(patent.patentId);
    const subSectorScore = candidateSubScoreMap.get(patent.patentId) ?? null;
    const baseScore = patent.baseScore;

    // Composite discovery score
    const discoveryScore =
      (exactCpcOverlap * 5) +
      (cpcOverlap * 3) +
      (relatedHotCount * 2) +
      ((internalScore?.value ?? 0) * 0.5) +
      ((subSectorScore ?? 0) * 0.3) +
      ((baseScore ?? 0) * 0.1);

    let reason = '';
    if (exactCpcOverlap > 0) reason += `${exactCpcOverlap} exact CPC matches; `;
    if (cpcOverlap > 0) reason += `${cpcOverlap} CPC group overlaps; `;
    if (relatedHotCount > 0) reason += `${relatedHotCount} hot patents in same sector; `;
    if (internalScore && internalScore.rank && internalScore.rank <= 100) reason += `Top-100 internal rank (#${internalScore.rank}); `;
    if (subSectorScore && subSectorScore >= 70) reason += `High sub-sector score (${subSectorScore.toFixed(1)}); `;

    if (discoveryScore > 5) {
      discoveryResults.push({
        patentId: patent.patentId,
        title: patent.title,
        sector: patent.primarySector!,
        superSector: patent.superSector || 'UNKNOWN',
        subSector: patent.primarySubSectorName,
        internalScore: internalScore?.value ?? null,
        internalRank: internalScore?.rank ?? null,
        subSectorScore,
        baseScore,
        cpcCodes: patentCpcs.slice(0, 5),
        relatedHotPatentCount: relatedHotCount,
        cpcOverlapWithHot: cpcOverlap,
        discoveryScore,
        reason: reason.replace(/;\s*$/, ''),
      });
    }
  }

  discoveryResults.sort((a, b) => b.discoveryScore - a.discoveryScore);

  // ── 6. Output ──

  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  // ── Console output ──

  console.log('\n' + '='.repeat(70));
  console.log('SUPER-SECTOR COVERAGE MATRIX');
  console.log('='.repeat(70));

  // Group by super-sector
  const superSectorGroups = new Map<string, SectorCoverage[]>();
  for (const sc of sectorCoverages) {
    if (!superSectorGroups.has(sc.superSector)) superSectorGroups.set(sc.superSector, []);
    superSectorGroups.get(sc.superSector)!.push(sc);
  }

  for (const [ss, sectors] of [...superSectorGroups.entries()].sort()) {
    const totalHeatmap = sectors.reduce((a, s) => a + s.heatmapPatents, 0);
    const totalHot = sectors.reduce((a, s) => a + s.hotHeatmapPatents, 0);
    const totalPortfolio = superSectorCountMap.get(ss) || 0;
    const coveredSectorsInSS = sectors.filter(s => s.heatmapPatents > 0);

    const status = totalHeatmap > 0
      ? (totalHot > 0 ? '🔥 HAS HOT RESULTS' : '📊 HAS RESULTS')
      : '⬜ NO COVERAGE';

    console.log(`\n${ss} (${totalPortfolio} portfolio patents) — ${status}`);
    console.log(`  Sectors: ${sectors.length} total, ${coveredSectorsInSS.length} with heatmap data`);

    if (totalHeatmap > 0) {
      console.log(`  Heatmap patents: ${totalHeatmap} (${totalHot} hot ≥${config.minHot})`);
    }

    for (const sc of sectors.sort((a, b) => b.heatmapPatents - a.heatmapPatents)) {
      if (sc.heatmapPatents > 0) {
        console.log(`    ✅ ${sc.sector}: ${sc.heatmapPatents} heatmap / ${sc.totalPortfolioPatents} portfolio` +
          ` (${sc.hotHeatmapPatents} hot, ${sc.mediumHeatmapPatents} medium)`);
        for (const tp of sc.topHeatmapPatents.slice(0, 3)) {
          const rankStr = tp.internalRank ? `rank #${tp.internalRank}` : 'unranked';
          console.log(`      ${tp.patentId}: heatmap ${tp.maxHeatmapScore.toFixed(2)} | internal ${tp.internalScore?.toFixed(1) ?? '-'} (${rankStr}) | ${tp.hotProducts} hot prods`);
        }
      } else if (sc.totalPortfolioPatents > 0) {
        console.log(`    ⬜ ${sc.sector}: 0 heatmap / ${sc.totalPortfolioPatents} portfolio — NEEDS COVERAGE`);
      }
    }
  }

  // ── Missing coverage summary ──

  console.log('\n' + '='.repeat(70));
  console.log('MISSING COVERAGE — SECTORS NEEDING HEATMAP BATCHES');
  console.log('='.repeat(70));

  const missingSectors = sectorCoverages
    .filter(s => s.heatmapPatents === 0 && s.totalPortfolioPatents > 0)
    .sort((a, b) => b.totalPortfolioPatents - a.totalPortfolioPatents);

  for (const sc of missingSectors) {
    console.log(`  ${sc.superSector} / ${sc.sector}: ${sc.totalPortfolioPatents} patents — no heatmap data`);
  }

  // ── Discovery candidates summary ──

  console.log('\n' + '='.repeat(70));
  console.log('TOP DISCOVERY CANDIDATES (patents to add to future heatmap batches)');
  console.log('='.repeat(70));

  // Group by sector
  const discoverySectorMap = new Map<string, DiscoveryCandidate[]>();
  for (const c of discoveryResults) {
    if (!discoverySectorMap.has(c.sector)) discoverySectorMap.set(c.sector, []);
    discoverySectorMap.get(c.sector)!.push(c);
  }

  for (const [sector, candidates] of [...discoverySectorMap.entries()].sort()) {
    const top = candidates.slice(0, config.discoveryTop);
    const coverage = sectorCoverages.find(c => c.sector === sector);
    console.log(`\n${sector} (${coverage?.superSector || '?'}) — ${candidates.length} candidates`);

    for (const c of top.slice(0, 10)) {
      console.log(`  ${c.patentId} (disc: ${c.discoveryScore.toFixed(1)}) — ${c.title.substring(0, 55)}`);
      console.log(`    internal: ${c.internalScore?.toFixed(1) ?? '-'} (rank ${c.internalRank ?? '-'}) | sub-sector: ${c.subSectorScore?.toFixed(1) ?? '-'} | CPC overlap: ${c.cpcOverlapWithHot}`);
      if (c.reason) console.log(`    reason: ${c.reason}`);
    }
    if (candidates.length > 10) console.log(`  ... +${candidates.length - 10} more`);
  }

  // ── Write files ──

  // Full JSON report
  const jsonReport = {
    generatedAt: new Date().toISOString(),
    config,
    summary: {
      totalHeatmapPatents: allPatents.length,
      totalHeatmapProducts: allProducts.length,
      totalSourceFiles: manifest.sources.length,
      coveredSectors: sectorCoverages.filter(s => s.heatmapPatents > 0).length,
      missingSectors: missingSectors.length,
      totalDiscoveryCandidates: discoveryResults.length,
    },
    superSectorCoverage: Object.fromEntries(
      [...superSectorGroups.entries()].map(([ss, sectors]) => [
        ss,
        {
          totalPortfolio: superSectorCountMap.get(ss) || 0,
          heatmapPatents: sectors.reduce((a, s) => a + s.heatmapPatents, 0),
          hotPatents: sectors.reduce((a, s) => a + s.hotHeatmapPatents, 0),
          coveredSectors: sectors.filter(s => s.heatmapPatents > 0).map(s => s.sector),
          missingSectors: sectors.filter(s => s.heatmapPatents === 0 && s.totalPortfolioPatents > 0).map(s => s.sector),
        },
      ])
    ),
    sectorCoverages,
    missingSectors: missingSectors.map(s => ({
      sector: s.sector,
      superSector: s.superSector,
      portfolioPatents: s.totalPortfolioPatents,
    })),
    topDiscoveryCandidates: Object.fromEntries(
      [...discoverySectorMap.entries()].map(([sector, cands]) => [
        sector,
        cands.slice(0, config.discoveryTop),
      ])
    ),
    heatmapTopics: topics.map(t => ({
      sourceSlug: t.sourceSlug,
      fileName: t.fileName,
      patentCount: t.patentCount,
      productCount: t.productCount,
      documentCount: t.documentCount,
      mappedSuperSectors: [...t.mappedSuperSectors],
      mappedSectors: [...t.mappedSectors],
      hotPatentIds: t.hotPatentIds,
    })),
  };

  const jsonPath = path.join(config.outputDir, 'coverage-analysis.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`\nFull report: ${jsonPath}`);

  // Discovery candidates CSV
  const csvLines = [
    'patentId,title,sector,superSector,subSector,internalScore,internalRank,subSectorScore,baseScore,cpcOverlap,relatedHot,discoveryScore,reason',
  ];
  for (const c of discoveryResults.slice(0, 500)) {
    csvLines.push([
      c.patentId,
      `"${c.title.replace(/"/g, '""')}"`,
      c.sector,
      c.superSector,
      c.subSector || '',
      c.internalScore?.toFixed(2) ?? '',
      c.internalRank ?? '',
      c.subSectorScore?.toFixed(2) ?? '',
      c.baseScore?.toFixed(2) ?? '',
      c.cpcOverlapWithHot,
      c.relatedHotPatentCount,
      c.discoveryScore.toFixed(2),
      `"${c.reason.replace(/"/g, '""')}"`,
    ].join(','));
  }
  const csvPath = path.join(config.outputDir, 'discovery-candidates.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`Discovery CSV: ${csvPath}`);

  console.log('\nDone.');
  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
