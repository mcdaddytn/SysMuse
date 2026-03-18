/**
 * Compare internal patent scores against Patlytics heatmap results.
 *
 * Usage:
 *   npx tsx scripts/compare-patlytics-scores.ts [options]
 *     --hot-threshold <n>   (default: 0.80)
 *     --medium-threshold <n> (default: 0.60)
 *     --top <n>             Compare against our top N patents (default: 500)
 *     --sector <name>       Filter to sector
 *     --output <dir>        (default: output/patlytics-comparison/)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  getAllPatentCaches,
  type PatentCache,
} from '../src/api/services/patlytics-cache-service.js';

const prisma = new PrismaClient();

// ── Types ──────────────────────────────────────────────────────────────────

interface CompareArgs {
  hotThreshold: number;
  mediumThreshold: number;
  top: number;
  sector: string | null;
  outputDir: string;
  scoreName: string;
}

type Quadrant = 'both-high' | 'internal-only' | 'heatmap-only' | 'both-low';

interface PatentComparison {
  patentId: string;
  title: string;
  primarySector: string | null;
  superSector: string | null;
  internalScore: number | null;
  internalRank: number | null;
  heatmapMaxScore: number;
  heatmapHotProducts: number;
  quadrant: Quadrant;
  topProducts: Array<{ product: string; company: string; score: number }>;
}

interface SectorBreakdown {
  sector: string;
  total: number;
  bothHigh: number;
  internalOnly: number;
  heatmapOnly: number;
  bothLow: number;
}

interface CompanyBreakdown {
  company: string;
  totalHotPairs: number;
  patents: string[];
  avgHeatmapScore: number;
}

// ── Arg Parsing ────────────────────────────────────────────────────────────

function parseArgs(): CompareArgs {
  const args = process.argv.slice(2);
  let hotThreshold = 0.80;
  let mediumThreshold = 0.60;
  let top = 500;
  let sector: string | null = null;
  let outputDir = path.join(process.cwd(), 'output', 'patlytics-comparison');
  let scoreName = 'v3_score';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--hot-threshold' && args[i + 1]) {
      hotThreshold = parseFloat(args[++i]);
    } else if (arg === '--medium-threshold' && args[i + 1]) {
      mediumThreshold = parseFloat(args[++i]);
    } else if (arg === '--top' && args[i + 1]) {
      top = parseInt(args[++i], 10);
    } else if (arg === '--sector' && args[i + 1]) {
      sector = args[++i];
    } else if (arg === '--output' && args[i + 1]) {
      outputDir = args[++i];
    } else if (arg === '--score-name' && args[i + 1]) {
      scoreName = args[++i];
    } else if (arg === '--v2') {
      scoreName = 'v2_score';
    }
  }

  return { hotThreshold, mediumThreshold, top, sector, outputDir, scoreName };
}

// ── DB Queries ─────────────────────────────────────────────────────────────

interface InternalPatentScore {
  patentId: string;
  title: string;
  primarySector: string | null;
  superSector: string | null;
  compositeScore: number;
  rank: number;
}

async function loadInternalScores(
  topN: number,
  sector: string | null,
  scoreName: string = 'v3_score'
): Promise<Map<string, InternalPatentScore>> {
  // Get composite scores from PatentCompositeScore
  const where: Record<string, unknown> = { scoreName };

  const compositeScores = await prisma.patentCompositeScore.findMany({
    where,
    orderBy: { value: 'desc' },
    take: topN * 2, // Grab extra in case we filter by sector
    select: {
      patentId: true,
      value: true,
      rank: true,
    },
  });

  // Get patent metadata
  const patentIds = compositeScores.map(s => s.patentId);
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: {
      patentId: true,
      title: true,
      primarySector: true,
      superSector: true,
    },
  });

  const patentMap = new Map(patents.map(p => [p.patentId, p]));
  const result = new Map<string, InternalPatentScore>();
  let rank = 0;

  for (const score of compositeScores) {
    const patent = patentMap.get(score.patentId);
    if (!patent) continue;
    if (sector && patent.primarySector !== sector) continue;

    rank++;
    if (rank > topN) break;

    result.set(score.patentId, {
      patentId: score.patentId,
      title: patent.title,
      primarySector: patent.primarySector,
      superSector: patent.superSector,
      compositeScore: score.value,
      rank,
    });
  }

  return result;
}

// ── Comparison Logic ───────────────────────────────────────────────────────

function classifyQuadrant(
  isTopInternal: boolean,
  heatmapScore: number,
  hotThreshold: number
): Quadrant {
  const isHeatmapHot = heatmapScore >= hotThreshold;

  if (isTopInternal && isHeatmapHot) return 'both-high';
  if (isTopInternal && !isHeatmapHot) return 'internal-only';
  if (!isTopInternal && isHeatmapHot) return 'heatmap-only';
  return 'both-low';
}

function buildComparisons(
  internalScores: Map<string, InternalPatentScore>,
  heatmapPatents: PatentCache[],
  hotThreshold: number
): PatentComparison[] {
  const comparisons: PatentComparison[] = [];
  const allPatentIds = new Set([
    ...internalScores.keys(),
    ...heatmapPatents.map(p => p.patentId),
  ]);

  const heatmapMap = new Map(heatmapPatents.map(p => [p.patentId, p]));

  for (const patentId of allPatentIds) {
    const internal = internalScores.get(patentId);
    const heatmap = heatmapMap.get(patentId);

    const isTopInternal = !!internal;
    const heatmapMaxScore = heatmap?.maxScoreOverall ?? 0;
    const quadrant = classifyQuadrant(isTopInternal, heatmapMaxScore, hotThreshold);

    const topProducts = (heatmap?.products ?? [])
      .filter(p => p.maxScore > 0)
      .sort((a, b) => b.maxScore - a.maxScore)
      .slice(0, 5)
      .map(p => ({ product: p.productName, company: p.companyName, score: p.maxScore }));

    comparisons.push({
      patentId,
      title: internal?.title ?? heatmap?.title ?? '',
      primarySector: internal?.primarySector ?? null,
      superSector: internal?.superSector ?? null,
      internalScore: internal?.compositeScore ?? null,
      internalRank: internal?.rank ?? null,
      heatmapMaxScore,
      heatmapHotProducts: heatmap?.hotProductCount ?? 0,
      quadrant,
      topProducts,
    });
  }

  return comparisons.sort((a, b) => {
    // Sort: both-high first, then heatmap-only, then internal-only, then both-low
    const order: Record<Quadrant, number> = {
      'both-high': 0, 'heatmap-only': 1, 'internal-only': 2, 'both-low': 3,
    };
    const orderDiff = order[a.quadrant] - order[b.quadrant];
    if (orderDiff !== 0) return orderDiff;
    return b.heatmapMaxScore - a.heatmapMaxScore;
  });
}

function buildSectorBreakdowns(comparisons: PatentComparison[]): SectorBreakdown[] {
  const sectorMap = new Map<string, PatentComparison[]>();

  for (const c of comparisons) {
    const sector = c.primarySector || 'unknown';
    if (!sectorMap.has(sector)) sectorMap.set(sector, []);
    sectorMap.get(sector)!.push(c);
  }

  return [...sectorMap.entries()].map(([sector, patents]) => ({
    sector,
    total: patents.length,
    bothHigh: patents.filter(p => p.quadrant === 'both-high').length,
    internalOnly: patents.filter(p => p.quadrant === 'internal-only').length,
    heatmapOnly: patents.filter(p => p.quadrant === 'heatmap-only').length,
    bothLow: patents.filter(p => p.quadrant === 'both-low').length,
  })).sort((a, b) => b.bothHigh - a.bothHigh || b.heatmapOnly - a.heatmapOnly);
}

function buildCompanyBreakdowns(heatmapPatents: PatentCache[], hotThreshold: number): CompanyBreakdown[] {
  const companyMap = new Map<string, { patents: Set<string>; scores: number[] }>();

  for (const patent of heatmapPatents) {
    for (const product of patent.products) {
      if (product.maxScore < hotThreshold) continue;
      const key = product.companyName;
      if (!companyMap.has(key)) companyMap.set(key, { patents: new Set(), scores: [] });
      companyMap.get(key)!.patents.add(patent.patentId);
      companyMap.get(key)!.scores.push(product.maxScore);
    }
  }

  return [...companyMap.entries()].map(([company, data]) => ({
    company,
    totalHotPairs: data.scores.length,
    patents: [...data.patents],
    avgHeatmapScore: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
  })).sort((a, b) => b.totalHotPairs - a.totalHotPairs);
}

// ── Report Generation ──────────────────────────────────────────────────────

function generateMarkdownReport(
  comparisons: PatentComparison[],
  sectorBreakdowns: SectorBreakdown[],
  companyBreakdowns: CompanyBreakdown[],
  config: CompareArgs,
  mediumComparisons: PatentComparison[]
): string {
  const bothHigh = comparisons.filter(c => c.quadrant === 'both-high');
  const internalOnly = comparisons.filter(c => c.quadrant === 'internal-only');
  const heatmapOnly = comparisons.filter(c => c.quadrant === 'heatmap-only');

  const lines: string[] = [];
  lines.push('# Patlytics Heatmap vs Internal Score Comparison');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Hot threshold: ${config.hotThreshold} | Medium threshold: ${config.mediumThreshold}`);
  lines.push(`Internal top N: ${config.top}${config.sector ? ` (sector: ${config.sector})` : ''}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Quadrant | Count | Description |`);
  lines.push(`|----------|-------|-------------|`);
  lines.push(`| Both High | ${bothHigh.length} | Our top patent AND heatmap hot — confirms scoring |`);
  lines.push(`| Internal Only | ${internalOnly.length} | Our top patent but heatmap cold — potential overfit |`);
  lines.push(`| Heatmap Only | ${heatmapOnly.length} | Heatmap hot but we ranked low — blind spots |`);
  lines.push(`| Both Low | ${comparisons.length - bothHigh.length - internalOnly.length - heatmapOnly.length} | Neither ranks high |`);
  lines.push('');

  // Both-high: validated patents
  if (bothHigh.length > 0) {
    lines.push('## Validated Patents (Both High)');
    lines.push('');
    lines.push('These patents score well both internally AND show strong infringement reads.');
    lines.push('');
    lines.push('| Patent | Internal Score | Rank | Heatmap Max | Hot Products | Sector | Top Product |');
    lines.push('|--------|---------------|------|-------------|-------------|--------|-------------|');
    for (const c of bothHigh) {
      const topProd = c.topProducts[0];
      const prodStr = topProd ? `${topProd.product} (${topProd.company}) ${topProd.score.toFixed(2)}` : '-';
      lines.push(`| ${c.patentId} | ${c.internalScore?.toFixed(2) ?? '-'} | ${c.internalRank ?? '-'} | ${c.heatmapMaxScore.toFixed(2)} | ${c.heatmapHotProducts} | ${c.primarySector ?? '-'} | ${prodStr} |`);
    }
    lines.push('');
  }

  // Heatmap-only: blind spots
  if (heatmapOnly.length > 0) {
    lines.push('## Scoring Blind Spots (Heatmap Only)');
    lines.push('');
    lines.push('These patents show strong infringement reads but our internal scoring ranks them low.');
    lines.push('');
    lines.push('| Patent | Heatmap Max | Hot Products | Sector | Top Product |');
    lines.push('|--------|-------------|-------------|--------|-------------|');
    for (const c of heatmapOnly.slice(0, 50)) {
      const topProd = c.topProducts[0];
      const prodStr = topProd ? `${topProd.product} (${topProd.company}) ${topProd.score.toFixed(2)}` : '-';
      lines.push(`| ${c.patentId} | ${c.heatmapMaxScore.toFixed(2)} | ${c.heatmapHotProducts} | ${c.primarySector ?? '-'} | ${prodStr} |`);
    }
    lines.push('');
  }

  // Sector breakdowns
  if (sectorBreakdowns.length > 0) {
    lines.push('## Per-Sector Breakdown');
    lines.push('');
    lines.push('| Sector | Total | Both High | Internal Only | Heatmap Only | Both Low |');
    lines.push('|--------|-------|-----------|---------------|-------------|----------|');
    for (const s of sectorBreakdowns) {
      lines.push(`| ${s.sector} | ${s.total} | ${s.bothHigh} | ${s.internalOnly} | ${s.heatmapOnly} | ${s.bothLow} |`);
    }
    lines.push('');
  }

  // Company breakdowns
  if (companyBreakdowns.length > 0) {
    lines.push('## Per-Company Hot Patent Counts');
    lines.push('');
    lines.push('| Company | Hot Patent-Product Pairs | Unique Patents | Avg Heatmap Score |');
    lines.push('|---------|------------------------|----------------|-------------------|');
    for (const c of companyBreakdowns.slice(0, 20)) {
      lines.push(`| ${c.company} | ${c.totalHotPairs} | ${c.patents.length} | ${c.avgHeatmapScore.toFixed(2)} |`);
    }
    lines.push('');
  }

  // Medium tier analysis
  const mediumBothHigh = mediumComparisons.filter(c => c.quadrant === 'both-high');
  const mediumHeatmapOnly = mediumComparisons.filter(c => c.quadrant === 'heatmap-only');
  lines.push('## Medium Tier Analysis (≥' + config.mediumThreshold + ')');
  lines.push('');
  lines.push(`Medium-tier patents with both-high: ${mediumBothHigh.length}`);
  lines.push(`Medium-tier heatmap-only: ${mediumHeatmapOnly.length}`);
  lines.push('');

  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseArgs();

  console.log('=== Patlytics Score Comparison ===');
  console.log(`Hot threshold:    ${config.hotThreshold}`);
  console.log(`Medium threshold: ${config.mediumThreshold}`);
  console.log(`Top N patents:    ${config.top}`);
  if (config.sector) console.log(`Sector filter:    ${config.sector}`);

  // Load data
  console.log(`Score name:       ${config.scoreName}`);

  console.log('\nLoading internal scores...');
  const internalScores = await loadInternalScores(config.top, config.sector, config.scoreName);
  console.log(`  Loaded ${internalScores.size} internal scores`);

  console.log('Loading heatmap data...');
  const heatmapPatents = getAllPatentCaches();
  console.log(`  Loaded ${heatmapPatents.length} heatmap patents`);

  // Build comparisons for hot threshold
  console.log('\nBuilding comparisons...');
  const comparisons = buildComparisons(internalScores, heatmapPatents, config.hotThreshold);

  // Build comparisons for medium threshold
  const mediumComparisons = buildComparisons(internalScores, heatmapPatents, config.mediumThreshold);

  // Build breakdowns
  const sectorBreakdowns = buildSectorBreakdowns(comparisons);
  const companyBreakdowns = buildCompanyBreakdowns(heatmapPatents, config.hotThreshold);

  // Log summary
  const bothHigh = comparisons.filter(c => c.quadrant === 'both-high');
  const internalOnly = comparisons.filter(c => c.quadrant === 'internal-only');
  const heatmapOnly = comparisons.filter(c => c.quadrant === 'heatmap-only');

  console.log(`\nQuadrant results (hot ≥${config.hotThreshold}):`);
  console.log(`  Both high:     ${bothHigh.length} (validates our scoring)`);
  console.log(`  Internal only: ${internalOnly.length} (potential overfit)`);
  console.log(`  Heatmap only:  ${heatmapOnly.length} (blind spots)`);
  console.log(`  Both low:      ${comparisons.length - bothHigh.length - internalOnly.length - heatmapOnly.length}`);

  // Write outputs
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  // Markdown report
  const report = generateMarkdownReport(
    comparisons, sectorBreakdowns, companyBreakdowns, config, mediumComparisons
  );
  const reportPath = path.join(config.outputDir, 'comparison-report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\nReport: ${reportPath}`);

  // JSON data
  const jsonData = {
    generatedAt: new Date().toISOString(),
    config: {
      hotThreshold: config.hotThreshold,
      mediumThreshold: config.mediumThreshold,
      topN: config.top,
      sector: config.sector,
    },
    summary: {
      totalCompared: comparisons.length,
      bothHigh: bothHigh.length,
      internalOnly: internalOnly.length,
      heatmapOnly: heatmapOnly.length,
      bothLow: comparisons.length - bothHigh.length - internalOnly.length - heatmapOnly.length,
    },
    comparisons,
    sectorBreakdowns,
    companyBreakdowns,
  };
  const jsonPath = path.join(config.outputDir, 'comparison-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
  console.log(`JSON:   ${jsonPath}`);

  // CSV for easy spreadsheet analysis
  const csvLines = [
    'patentId,title,primarySector,superSector,internalScore,internalRank,heatmapMaxScore,heatmapHotProducts,quadrant,topProduct,topProductCompany,topProductScore',
  ];
  for (const c of comparisons) {
    const topProd = c.topProducts[0];
    csvLines.push([
      c.patentId,
      `"${(c.title || '').replace(/"/g, '""')}"`,
      c.primarySector || '',
      c.superSector || '',
      c.internalScore?.toFixed(4) ?? '',
      c.internalRank ?? '',
      c.heatmapMaxScore.toFixed(4),
      c.heatmapHotProducts,
      c.quadrant,
      `"${(topProd?.product || '').replace(/"/g, '""')}"`,
      `"${(topProd?.company || '').replace(/"/g, '""')}"`,
      topProd?.score.toFixed(4) ?? '',
    ].join(','));
  }
  const csvPath = path.join(config.outputDir, 'comparison-data.csv');
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`CSV:    ${csvPath}`);

  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
