/**
 * Build overlap matrix: Broadcom patents vs target company products.
 *
 * Joins three data sources:
 *   1. Broadcom patent scores from DB (PatentSubSectorScore)
 *   2. Product doc summaries from cache/product-doc-summaries/
 *   3. Heatmap scores from cache/patlytics/
 *
 * Produces a CSV overlap matrix showing which target products overlap
 * with which Broadcom patent sectors, with supporting evidence.
 *
 * Usage:
 *   npx tsx scripts/map-broadcom-target-overlap.ts [options]
 *     --target-company <slug>   Target company (default: nutanix)
 *     --min-heatmap-score <n>   Min heatmap score to include (default: 0.3)
 *     --top-patents <n>         Max patents per product-sector pair (default: 10)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  getAllProductCaches,
  readProductCache,
  getAllPatentCaches,
  type PatentCache,
} from '../src/api/services/patlytics-cache-service.js';

const prisma = new PrismaClient();
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';
const SUMMARIES_DIR = path.resolve('./cache/product-doc-summaries');
const OUTPUT_DIR = path.resolve('./output');

// ── Product-to-Sector Mapping ─────────────────────────────────────────────

// Pre-configured associations: which sectors are relevant to each product
// Only sectors that exist in the DB with scored Broadcom patents are included
const PRODUCT_SECTOR_MAP: Record<string, Record<string, string[]>> = {
  nutanix: {
    'nutanix-ahv': [
      'computing-systems', 'computing-runtime', 'network-switching',
      'network-signal-processing', 'computing-os-security',
    ],
    'nutanix-cloud-infrastructure-nci': [
      'computing-systems', 'computing-runtime', 'network-switching',
      'network-management', 'network-protocols', 'network-signal-processing',
    ],
    'flow-virtual-networking': [
      'network-switching', 'network-protocols', 'network-management',
      'network-signal-processing', 'network-multiplexing',
    ],
    'flow-network-security': [
      'network-threat-protection', 'network-auth-access', 'network-secure-compute',
      'network-switching',
    ],
  },
};

// Product slug aliases: maps a canonical product to its related slugs
// (used to aggregate doc summaries from multiple heatmap-created products)
const PRODUCT_ALIASES: Record<string, Record<string, string[]>> = {
  nutanix: {
    'nutanix-ahv': ['ahv', 'ahv-acropolis-hypervisor'],
    'nutanix-cloud-infrastructure-nci': ['nutanix-prism-central'],
    'flow-virtual-networking': ['flow-virtual-networking-fvn', 'nutanix-flow-virtual-networking'],
    'flow-network-security': ['nutanix-flow-network-security'],
  },
};

// ── Config ────────────────────────────────────────────────────────────────

interface Config {
  targetCompany: string;
  minHeatmapScore: number;
  topPatents: number;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let targetCompany = 'nutanix';
  let minHeatmapScore = 0.3;
  let topPatents = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target-company' && args[i + 1]) targetCompany = args[++i];
    else if (args[i] === '--min-heatmap-score' && args[i + 1]) minHeatmapScore = parseFloat(args[++i]);
    else if (args[i] === '--top-patents' && args[i + 1]) topPatents = parseInt(args[++i], 10);
  }

  return { targetCompany, minHeatmapScore, topPatents };
}

// ── CSV Helpers ───────────────────────────────────────────────────────────

function escapeCSV(value: string | number | null | undefined): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ── Load Doc Summaries ────────────────────────────────────────────────────

interface DocSummaryEntry {
  documentName: string;
  productSlug: string;
  productName: string;
  summary: {
    keyTechnologies: string[];
    sdnNfvFeatures: string[];
    networkSecurityCapabilities: string[];
    virtualSwitchingRouting: string[];
    hypervisorVmManagement: string[];
    otherRelevantFeatures: string[];
    executiveSummary: string;
  };
}

function loadDocSummaries(companySlug: string): DocSummaryEntry[] {
  const companyDir = path.join(SUMMARIES_DIR, companySlug);
  if (!fs.existsSync(companyDir)) return [];

  const summaries: DocSummaryEntry[] = [];
  for (const productDir of fs.readdirSync(companyDir)) {
    const productPath = path.join(companyDir, productDir);
    if (!fs.statSync(productPath).isDirectory()) continue;
    for (const file of fs.readdirSync(productPath)) {
      if (!file.endsWith('.json')) continue;
      try {
        summaries.push(JSON.parse(fs.readFileSync(path.join(productPath, file), 'utf-8')));
      } catch { /* skip */ }
    }
  }
  return summaries;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  console.log('=== Broadcom vs Target Overlap Mapping ===');
  console.log(`Target company: ${config.targetCompany}`);
  console.log(`Min heatmap score: ${config.minHeatmapScore}`);
  console.log(`Top patents per pair: ${config.topPatents}`);

  // 1. Load Broadcom portfolio
  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) { console.error('broadcom-core portfolio not found'); process.exit(1); }

  // 2. Load product-sector map for target
  const sectorMap = PRODUCT_SECTOR_MAP[config.targetCompany];
  if (!sectorMap) {
    console.error(`No product-sector mapping configured for "${config.targetCompany}".`);
    console.log('Available companies:', Object.keys(PRODUCT_SECTOR_MAP).join(', '));
    process.exit(1);
  }

  // Collect all relevant sectors
  const allSectors = [...new Set(Object.values(sectorMap).flat())];
  console.log(`\nMapped sectors: ${allSectors.join(', ')}`);

  // 3. Load Broadcom patent scores for relevant sectors
  console.log('\nLoading Broadcom patent scores...');

  const broadcomPatentIds = await prisma.patent.findMany({
    where: {
      primarySector: { in: allSectors },
      isQuarantined: false,
      portfolios: { some: { portfolioId: portfolio.id } },
    },
    select: { patentId: true, title: true, primarySector: true },
  });
  const patentDetailMap = new Map(broadcomPatentIds.map(p => [p.patentId, p]));
  console.log(`Broadcom patents in mapped sectors: ${broadcomPatentIds.length}`);

  // Get scores
  const scores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: broadcomPatentIds.map(p => p.patentId) } },
    orderBy: { compositeScore: 'desc' },
  });
  const bestScoreByPatent = new Map<string, number>();
  for (const s of scores) {
    if (!bestScoreByPatent.has(s.patentId)) {
      bestScoreByPatent.set(s.patentId, s.compositeScore);
    }
  }
  console.log(`Scored patents: ${bestScoreByPatent.size}`);

  // 4. Load heatmap data
  console.log('\nLoading heatmap data...');
  const heatmapPatents = getAllPatentCaches();
  const heatmapByPatent = new Map<string, PatentCache>();
  for (const hp of heatmapPatents) {
    heatmapByPatent.set(hp.patentId, hp);
  }
  console.log(`Heatmap patents: ${heatmapByPatent.size}`);

  // 5. Load doc summaries
  console.log('\nLoading doc summaries...');
  const docSummaries = loadDocSummaries(config.targetCompany);
  console.log(`Doc summaries: ${docSummaries.length}`);

  // 6. Build overlap matrix
  console.log('\nBuilding overlap matrix...');

  interface OverlapRow {
    product: string;
    productSlug: string;
    sector: string;
    topPatentIds: string[];
    topPatentTitles: string[];
    topCompositeScores: number[];
    heatmapScores: number[];
    evidenceDocs: string[];
    avgCompositeScore: number;
    avgHeatmapScore: number;
  }

  const rows: OverlapRow[] = [];

  for (const [productSlug, sectors] of Object.entries(sectorMap)) {
    // Get product display name from cache
    const productCache = readProductCache(config.targetCompany, productSlug);
    const productName = productCache?.productName || productSlug;

    for (const sector of sectors) {
      // Find Broadcom patents in this sector
      const sectorPatents = broadcomPatentIds
        .filter(p => p.primarySector === sector)
        .map(p => ({
          patentId: p.patentId,
          title: p.title,
          compositeScore: bestScoreByPatent.get(p.patentId) || 0,
          heatmapScore: getHeatmapScore(heatmapByPatent.get(p.patentId), config.targetCompany, productSlug),
        }))
        // Combined ranking: weight composite + heatmap
        .sort((a, b) => {
          const scoreA = a.compositeScore + (a.heatmapScore * 50);
          const scoreB = b.compositeScore + (b.heatmapScore * 50);
          return scoreB - scoreA;
        })
        .slice(0, config.topPatents);

      if (sectorPatents.length === 0) continue;

      // Find relevant evidence docs (include alias product slugs)
      const aliases = PRODUCT_ALIASES[config.targetCompany]?.[productSlug] || [];
      const allSlugs = [productSlug, ...aliases];
      const relevantDocs = docSummaries
        .filter(d => allSlugs.includes(d.productSlug))
        .map(d => d.documentName);

      const avgComposite = sectorPatents.reduce((sum, p) => sum + p.compositeScore, 0) / sectorPatents.length;
      const heatmapScores = sectorPatents.map(p => p.heatmapScore).filter(s => s > 0);
      const avgHeatmap = heatmapScores.length > 0
        ? heatmapScores.reduce((sum, s) => sum + s, 0) / heatmapScores.length
        : 0;

      rows.push({
        product: productName,
        productSlug,
        sector,
        topPatentIds: sectorPatents.map(p => p.patentId),
        topPatentTitles: sectorPatents.map(p => p.title),
        topCompositeScores: sectorPatents.map(p => p.compositeScore),
        heatmapScores: sectorPatents.map(p => p.heatmapScore),
        evidenceDocs: relevantDocs.slice(0, 5),
        avgCompositeScore: avgComposite,
        avgHeatmapScore: avgHeatmap,
      });
    }
  }

  // Sort by combined score
  rows.sort((a, b) => (b.avgCompositeScore + b.avgHeatmapScore * 50) - (a.avgCompositeScore + a.avgHeatmapScore * 50));

  // 7. Output CSV
  const outputDir = path.join(OUTPUT_DIR, `${config.targetCompany}-opportunity-analysis`);
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const csvHeaders = [
    'Product', 'Sector', 'TopPatents', 'PatentCount', 'AvgCompositeScore',
    'AvgHeatmapScore', 'EvidenceDocs', 'TopPatentTitles',
  ];
  const csvRows = [csvHeaders.join(',')];

  for (const row of rows) {
    csvRows.push([
      escapeCSV(row.product),
      escapeCSV(row.sector),
      escapeCSV(row.topPatentIds.join('; ')),
      escapeCSV(row.topPatentIds.length),
      escapeCSV(row.avgCompositeScore.toFixed(1)),
      escapeCSV(row.avgHeatmapScore.toFixed(2)),
      escapeCSV(row.evidenceDocs.join('; ')),
      escapeCSV(row.topPatentTitles.join('; ')),
    ].join(','));
  }

  const csvPath = path.join(outputDir, 'overlap-matrix.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\nOverlap matrix: ${rows.length} rows → ${csvPath}`);

  // 8. Output summary
  const summaryPath = path.join(outputDir, 'overlap-summary.json');
  const summary = {
    targetCompany: config.targetCompany,
    generatedAt: new Date().toISOString(),
    totalRows: rows.length,
    products: [...new Set(rows.map(r => r.product))],
    sectors: [...new Set(rows.map(r => r.sector))],
    totalUniquePatents: [...new Set(rows.flatMap(r => r.topPatentIds))].length,
    topOpportunities: rows.slice(0, 10).map(r => ({
      product: r.product,
      sector: r.sector,
      patentCount: r.topPatentIds.length,
      avgCompositeScore: Math.round(r.avgCompositeScore * 10) / 10,
      avgHeatmapScore: Math.round(r.avgHeatmapScore * 100) / 100,
      topPatent: r.topPatentIds[0],
    })),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`Summary → ${summaryPath}`);

  // Print top opportunities
  console.log('\n=== Top Opportunities ===\n');
  console.log('Product'.padEnd(30) + 'Sector'.padEnd(25) + 'Patents'.padEnd(10) + 'Score'.padEnd(10) + 'Heatmap');
  console.log('-'.repeat(85));
  for (const row of rows.slice(0, 15)) {
    console.log(
      row.product.substring(0, 28).padEnd(30) +
      row.sector.padEnd(25) +
      String(row.topPatentIds.length).padEnd(10) +
      row.avgCompositeScore.toFixed(1).padEnd(10) +
      row.avgHeatmapScore.toFixed(2)
    );
  }

  await prisma.$disconnect();
}

// ── Heatmap Score Lookup ──────────────────────────────────────────────────

function getHeatmapScore(
  patentCache: PatentCache | undefined,
  targetCompanySlug: string,
  productSlug: string
): number {
  if (!patentCache) return 0;

  // Check primary slug and aliases
  const aliases = PRODUCT_ALIASES[targetCompanySlug]?.[productSlug] || [];
  const allSlugs = [productSlug, ...aliases];

  // Look for exact product match in heatmap data
  for (const prod of patentCache.products) {
    if (prod.companySlug === targetCompanySlug && allSlugs.includes(prod.productSlug)) {
      return prod.maxScore;
    }
  }
  // Fallback: check any product from this company
  for (const prod of patentCache.products) {
    if (prod.companySlug === targetCompanySlug) {
      return prod.maxScore;
    }
  }
  return 0;
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
