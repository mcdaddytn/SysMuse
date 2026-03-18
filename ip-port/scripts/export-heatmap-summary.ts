#!/usr/bin/env npx tsx
/**
 * Export Patlytics Heatmap Summary Package
 *
 * Produces three CSVs from the heatmap cache:
 *   1. patent-summary.csv — One row per patent with aggregated metrics, sorted best-first
 *   2. patent-product-pivot.csv — One row per patent×product pair for pivot tables
 *   3. document-evidence.csv — One row per patent×product×document, with URLs and narratives
 *
 * Usage:
 *   npx tsx scripts/export-heatmap-summary.ts [--output-dir <path>] [--min-score <n>] [--doc-min-score <n>]
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PatentCache, Manifest, CompaniesIndex, ProductCache } from '../src/api/services/patlytics-cache-service';

// ── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const OUTPUT_DIR = getArg('output-dir', 'output/heatmap-summary');
const MIN_SCORE = parseFloat(getArg('min-score', '0'));
const DOC_MIN_SCORE = parseFloat(getArg('doc-min-score', '0.50'));
const CACHE_BASE = path.join(process.cwd(), 'cache', 'patlytics');
const PATENTS_DIR = path.join(CACHE_BASE, 'patents');
const PRODUCTS_DIR = path.join(CACHE_BASE, 'products');

// ── Helpers ─────────────────────────────────────────────────────────────────

function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(csvEscape).join(',');
}

/** Derive a human-readable batch topic from source file slug */
function sourceToBatchTopic(sourceSlug: string): string {
  // Strip common prefix and date suffix
  let name = sourceSlug
    .replace(/^patlytics-portfolioheatmapinfringement-/, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '');
  // Remove leading letter prefixes like "a-", "b-", "c-", "d-", "a1-", "b2-"
  name = name.replace(/^[a-d]\d?-/, '');
  // Convert hyphens to spaces and title case
  return name
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Extract the date from a source file slug */
function sourceToDate(sourceSlug: string): string {
  const match = sourceSlug.match(/(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1] : '';
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== Patlytics Heatmap Summary Export ===\n');

  // Read manifest
  const manifestPath = path.join(CACHE_BASE, 'manifest.json');
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  // Read companies index for competitor matching
  const companiesPath = path.join(CACHE_BASE, 'companies.json');
  const companiesIndex: CompaniesIndex = JSON.parse(fs.readFileSync(companiesPath, 'utf-8'));
  const companySlugToCategory = new Map<string, string>();
  const companySlugToCompetitor = new Map<string, string>();
  for (const c of companiesIndex.companies) {
    companySlugToCategory.set(c.companySlug, c.competitorCategory || '');
    companySlugToCompetitor.set(c.companySlug, c.competitorMatch || c.companyName);
  }

  // Load all patent cache files
  const patentFiles = fs.readdirSync(PATENTS_DIR).filter(f => f.endsWith('.json'));
  const patents: PatentCache[] = [];

  for (const file of patentFiles) {
    const data: PatentCache = JSON.parse(fs.readFileSync(path.join(PATENTS_DIR, file), 'utf-8'));
    if (data.maxScoreOverall >= MIN_SCORE) {
      patents.push(data);
    }
  }

  console.log(`Loaded ${patents.length} patents from cache`);
  console.log(`Source spreadsheets: ${manifest.sources.length}`);
  console.log(`Min score filter: ${MIN_SCORE}\n`);

  // Sort patents: best first (max score desc, then hot product count desc, then patent ID)
  patents.sort((a, b) => {
    if (b.maxScoreOverall !== a.maxScoreOverall) return b.maxScoreOverall - a.maxScoreOverall;
    if (b.hotProductCount !== a.hotProductCount) return b.hotProductCount - a.hotProductCount;
    return a.patentId.localeCompare(b.patentId);
  });

  // ── CSV 1: Patent Summary ───────────────────────────────────────────────

  const summaryHeaders = [
    'Rank',
    'PatentId',
    'FullPatentId',
    'Title',
    'Inventors',
    'MaxScore',
    'HotProductCount',
    'TotalProductCount',
    'AvgScore',
    'MedianScore',
    'HotTier',           // VERY_HOT (>=0.90), HOT (>=0.80), WARM (>=0.60), COOL (<0.60)
    'TopCompany1',
    'TopProduct1',
    'TopScore1',
    'TopCompany2',
    'TopProduct2',
    'TopScore2',
    'TopCompany3',
    'TopProduct3',
    'TopScore3',
    'HotCompanies',      // comma-separated companies with hot products
    'HotProducts',       // comma-separated hot product names
    'CompetitorCategories', // unique categories of hot companies
    'BatchTopics',       // source batch topic areas
    'BatchDates',        // source batch dates
    'SourceFileCount',
  ];

  const summaryRows: string[] = [csvRow(summaryHeaders)];

  for (let i = 0; i < patents.length; i++) {
    const p = patents[i];

    // Sort products by score descending
    const sortedProducts = [...p.products].sort((a, b) => b.maxScore - a.maxScore);

    // Compute avg and median scores
    const allScores = sortedProducts.map(pr => pr.maxScore);
    const avgScore = allScores.length > 0
      ? (allScores.reduce((s, v) => s + v, 0) / allScores.length)
      : 0;
    const sortedScores = [...allScores].sort((a, b) => a - b);
    const medianScore = sortedScores.length > 0
      ? (sortedScores.length % 2 === 0
        ? (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2
        : sortedScores[Math.floor(sortedScores.length / 2)])
      : 0;

    // Hot tier
    let hotTier = 'COOL';
    if (p.maxScoreOverall >= 0.95) hotTier = 'VERY_HOT';
    else if (p.maxScoreOverall >= 0.80) hotTier = 'HOT';
    else if (p.maxScoreOverall >= 0.60) hotTier = 'WARM';

    // Top 3 products
    const top3 = sortedProducts.slice(0, 3);

    // Hot companies and products
    const hotProducts = sortedProducts.filter(pr => pr.isHot);
    const hotCompanyNames = [...new Set(hotProducts.map(pr => pr.companyName))];
    const hotProductNames = hotProducts.map(pr => `${pr.companyName}: ${pr.productName}`);

    // Competitor categories for hot companies
    const hotCategories = [...new Set(
      hotProducts
        .map(pr => companySlugToCategory.get(pr.companySlug))
        .filter(Boolean)
    )];

    // Batch topics and dates
    const batchTopics = [...new Set(p.sourceFiles.map(sourceToBatchTopic))];
    const batchDates = [...new Set(p.sourceFiles.map(sourceToDate))].sort();

    summaryRows.push(csvRow([
      i + 1,
      p.patentId,
      p.fullPatentId,
      p.title,
      p.inventors,
      p.maxScoreOverall.toFixed(2),
      p.hotProductCount,
      p.products.length,
      avgScore.toFixed(3),
      medianScore.toFixed(3),
      hotTier,
      top3[0]?.companyName || '',
      top3[0]?.productName || '',
      top3[0]?.maxScore?.toFixed(2) || '',
      top3[1]?.companyName || '',
      top3[1]?.productName || '',
      top3[1]?.maxScore?.toFixed(2) || '',
      top3[2]?.companyName || '',
      top3[2]?.productName || '',
      top3[2]?.maxScore?.toFixed(2) || '',
      hotCompanyNames.join('; '),
      hotProductNames.join('; '),
      hotCategories.join('; '),
      batchTopics.join('; '),
      batchDates.join('; '),
      p.sourceFiles.length,
    ]));
  }

  // ── CSV 2: Patent × Product Pivot ─────────────────────────────────────────

  const pivotHeaders = [
    'PatentId',
    'FullPatentId',
    'PatentTitle',
    'PatentMaxScore',
    'PatentHotTier',
    'PatentHotProductCount',
    'CompanyName',
    'CompanySlug',
    'CompetitorMatch',
    'CompetitorCategory',
    'ProductName',
    'ProductSlug',
    'Score',
    'IsHot',
    'ScoreCount',       // how many times scored (from different source files)
    'DocCount',         // number of supporting documents for this patent×product
    'TopDocName',       // highest-scoring document name
    'TopDocUrl',        // direct URL to that document
    'TopDocScore',      // score of the top document for this patent
    'BatchTopic',
    'BatchDate',
  ];

  // ── Load product caches for document lookup ──────────────────────────────
  // Build a map: companySlug/productSlug -> ProductCache
  const productCacheMap = new Map<string, ProductCache>();
  if (fs.existsSync(PRODUCTS_DIR)) {
    for (const company of fs.readdirSync(PRODUCTS_DIR)) {
      const compDir = path.join(PRODUCTS_DIR, company);
      try { if (!fs.statSync(compDir).isDirectory()) continue; } catch { continue; }
      for (const file of fs.readdirSync(compDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const pc: ProductCache = JSON.parse(fs.readFileSync(path.join(compDir, file), 'utf-8'));
          productCacheMap.set(`${pc.companySlug}/${pc.productSlug}`, pc);
        } catch { /* skip corrupt */ }
      }
    }
  }
  console.log(`Loaded ${productCacheMap.size} product caches for document lookup`);

  /** Find documents for a patent×product pair, sorted by score desc */
  function getDocsForPatentProduct(patentId: string, companySlug: string, productSlug: string) {
    const pc = productCacheMap.get(`${companySlug}/${productSlug}`);
    if (!pc) return [];
    return pc.documents
      .filter(d => d.patentScores && d.patentScores[patentId])
      .map(d => ({
        documentName: d.documentName,
        documentUrl: d.documentUrl,
        patlyticsStoredUrl: d.patlyticsStoredUrl,
        score: d.patentScores[patentId].score,
        narrative: d.patentScores[patentId].narrative,
      }))
      .sort((a, b) => b.score - a.score);
  }

  const pivotRows: string[] = [csvRow(pivotHeaders)];
  let pivotCount = 0;

  for (const p of patents) {
    let hotTier = 'COOL';
    if (p.maxScoreOverall >= 0.95) hotTier = 'VERY_HOT';
    else if (p.maxScoreOverall >= 0.80) hotTier = 'HOT';
    else if (p.maxScoreOverall >= 0.60) hotTier = 'WARM';

    // Sort products by score desc for each patent
    const sortedProducts = [...p.products].sort((a, b) => b.maxScore - a.maxScore);

    for (const prod of sortedProducts) {
      // Use the first score's source for batch topic/date (most are single-source)
      const firstSource = prod.scores[0]?.sourceFile || '';
      const batchTopic = firstSource ? sourceToBatchTopic(firstSource) : '';
      const batchDate = firstSource ? sourceToDate(firstSource) : '';

      // Look up supporting documents
      const docs = getDocsForPatentProduct(p.patentId, prod.companySlug, prod.productSlug);
      const topDoc = docs[0] || null;

      pivotRows.push(csvRow([
        p.patentId,
        p.fullPatentId,
        p.title,
        p.maxScoreOverall.toFixed(2),
        hotTier,
        p.hotProductCount,
        prod.companyName,
        prod.companySlug,
        companySlugToCompetitor.get(prod.companySlug) || '',
        companySlugToCategory.get(prod.companySlug) || '',
        prod.productName,
        prod.productSlug,
        prod.maxScore.toFixed(2),
        prod.isHot ? 'Y' : 'N',
        prod.scores.length,
        docs.length,
        topDoc?.documentName || '',
        topDoc?.documentUrl || '',
        topDoc?.score?.toFixed(2) || '',
        batchTopic,
        batchDate,
        ]));
      pivotCount++;
    }
  }

  // ── CSV 3: Document Evidence ──────────────────────────────────────────────
  // One row per patent×product×document — filtered by DOC_MIN_SCORE

  const docHeaders = [
    'PatentId',
    'FullPatentId',
    'PatentTitle',
    'PatentHotTier',
    'CompanyName',
    'CompetitorMatch',
    'CompetitorCategory',
    'ProductName',
    'DocScore',
    'DocScoreTier',
    'DocumentName',
    'DocumentUrl',
    'PatlyticsStoredUrl',
    'Narrative',
  ];

  const docRows: string[] = [csvRow(docHeaders)];
  let docCount = 0;

  for (const p of patents) {
    let hotTier = 'COOL';
    if (p.maxScoreOverall >= 0.95) hotTier = 'VERY_HOT';
    else if (p.maxScoreOverall >= 0.80) hotTier = 'HOT';
    else if (p.maxScoreOverall >= 0.60) hotTier = 'WARM';

    for (const prod of p.products) {
      const docs = getDocsForPatentProduct(p.patentId, prod.companySlug, prod.productSlug);
      for (const doc of docs) {
        if (doc.score < DOC_MIN_SCORE) continue;

        let docTier = 'COOL';
        if (doc.score >= 0.95) docTier = 'VERY_HOT';
        else if (doc.score >= 0.80) docTier = 'HOT';
        else if (doc.score >= 0.60) docTier = 'WARM';
        else docTier = 'COOL';

        docRows.push(csvRow([
          p.patentId,
          p.fullPatentId,
          p.title,
          hotTier,
          prod.companyName,
          companySlugToCompetitor.get(prod.companySlug) || '',
          companySlugToCategory.get(prod.companySlug) || '',
          prod.productName,
          doc.score.toFixed(2),
          docTier,
          doc.documentName,
          doc.documentUrl || '',
          doc.patlyticsStoredUrl || '',
          doc.narrative || '',
            ]));
        docCount++;
      }
    }
  }

  // ── Write output ──────────────────────────────────────────────────────────

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const summaryPath = path.join(OUTPUT_DIR, 'patent-summary.csv');
  const pivotPath = path.join(OUTPUT_DIR, 'patent-product-pivot.csv');
  const docPath = path.join(OUTPUT_DIR, 'document-evidence.csv');

  fs.writeFileSync(summaryPath, summaryRows.join('\n'));
  fs.writeFileSync(pivotPath, pivotRows.join('\n'));
  fs.writeFileSync(docPath, docRows.join('\n'));

  // ── Stats ─────────────────────────────────────────────────────────────────

  const hotPatents = patents.filter(p => p.maxScoreOverall >= 0.80);
  const veryHotPatents = patents.filter(p => p.maxScoreOverall >= 0.95);
  const warmPatents = patents.filter(p => p.maxScoreOverall >= 0.60 && p.maxScoreOverall < 0.80);

  // Company frequency among hot patents
  const companyHotCounts = new Map<string, number>();
  for (const p of hotPatents) {
    const hotCompanies = new Set(
      p.products.filter(pr => pr.isHot).map(pr => pr.companyName)
    );
    for (const c of hotCompanies) {
      companyHotCounts.set(c, (companyHotCounts.get(c) || 0) + 1);
    }
  }
  const topCompanies = [...companyHotCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // Batch topic distribution
  const topicCounts = new Map<string, { total: number; hot: number }>();
  for (const p of patents) {
    const topics = [...new Set(p.sourceFiles.map(sourceToBatchTopic))];
    for (const t of topics) {
      const entry = topicCounts.get(t) || { total: 0, hot: 0 };
      entry.total++;
      if (p.maxScoreOverall >= 0.80) entry.hot++;
      topicCounts.set(t, entry);
    }
  }
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1].hot - a[1].hot)
    .slice(0, 20);

  console.log('=== Output ===');
  console.log(`  ${summaryPath} — ${patents.length} patents`);
  console.log(`  ${pivotPath} — ${pivotCount} patent×product rows`);
  console.log(`  ${docPath} — ${docCount} document evidence rows (score >= ${DOC_MIN_SCORE})`);

  console.log('\n=== Statistics ===');
  console.log(`  Total patents:     ${patents.length}`);
  console.log(`  VERY_HOT (≥0.95):  ${veryHotPatents.length}`);
  console.log(`  HOT (≥0.80):       ${hotPatents.length}`);
  console.log(`  WARM (≥0.60):      ${warmPatents.length}`);
  console.log(`  COOL (<0.60):      ${patents.length - hotPatents.length - warmPatents.length}`);

  console.log('\n  Top Companies (by # of hot patent reads):');
  for (const [company, count] of topCompanies) {
    const cat = [...companySlugToCategory.entries()]
      .find(([, v]) => v && companiesIndex.companies.find(c => c.companyName === company)?.companySlug)
      ?.[1] || '';
    console.log(`    ${count.toString().padStart(3)} hot reads — ${company}`);
  }

  console.log('\n  Top Batch Topics (by # hot patents):');
  for (const [topic, { total, hot }] of topTopics) {
    console.log(`    ${hot.toString().padStart(3)} hot / ${total.toString().padStart(3)} total — ${topic}`);
  }

  // Write a README
  const readme = `# Patlytics Heatmap Summary Package

**Generated:** ${new Date().toISOString().slice(0, 10)}
**Source:** ${manifest.sources.length} Patlytics spreadsheets

## Files

| File | Description |
|---|---|
| \`patent-summary.csv\` | One row per patent with aggregated metrics, sorted by max score descending. Columns include top 3 products, hot company lists, batch topics, and tier classification. |
| \`patent-product-pivot.csv\` | One row per patent×product combination with top document URL. Use for pivot tables, filtering by company, score threshold, batch topic, etc. |
| \`document-evidence.csv\` | One row per patent×product×document. Includes direct URLs, Patlytics CDN URLs, and AI-generated infringement narratives. Filtered to doc score >= ${DOC_MIN_SCORE}. |
| \`README.md\` | This file |

## Statistics

- **Total Patents:** ${patents.length}
- **VERY_HOT (≥0.95):** ${veryHotPatents.length}
- **HOT (≥0.80):** ${hotPatents.length}
- **WARM (≥0.60):** ${warmPatents.length}
- **COOL (<0.60):** ${patents.length - hotPatents.length - warmPatents.length}
- **Total Patent×Product Pairs:** ${pivotCount}
- **Document Evidence Rows:** ${docCount} (score >= ${DOC_MIN_SCORE})

## Column Definitions

### patent-summary.csv
- **Rank** — Overall rank by max score (1 = best)
- **HotTier** — VERY_HOT (≥0.95), HOT (≥0.80), WARM (≥0.60), COOL (<0.60)
- **HotProductCount** — Number of products scoring ≥0.80 for this patent
- **AvgScore / MedianScore** — Across all products tested
- **TopCompany1-3 / TopProduct1-3 / TopScore1-3** — Best 3 patent×product matches
- **HotCompanies** — All companies with a hot product read
- **CompetitorCategories** — Industry categories (semiconductor, networking, bigTech, etc.)
- **BatchTopics** — Which Patlytics analysis batches included this patent

### patent-product-pivot.csv
- **Score** — Patlytics infringement heatmap score (0.0–1.0)
- **IsHot** — Y if score ≥0.80
- **CompetitorMatch** — Normalized company name from our competitor database
- **CompetitorCategory** — Industry category
- **ScoreCount** — How many source files scored this pair (>1 means cross-validated)
- **DocCount** — Number of supporting documents for this patent×product pair
- **TopDocName / TopDocUrl / TopDocScore** — Highest-scoring document with direct link
- **BatchTopic / BatchDate** — Which analysis batch produced this score

### document-evidence.csv
- **DocScore** — Per-document infringement score for a specific patent (0.0–1.0)
- **DocScoreTier** — VERY_HOT/HOT/WARM/COOL based on doc score
- **DocumentName** — Name/title of the product document
- **DocumentUrl** — Direct URL to the product document (PDF, HTML, etc.)
- **PatlyticsStoredUrl** — Patlytics CDN cached copy of the document
- **Narrative** — AI-generated infringement analysis narrative for this patent×document pair
`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'README.md'), readme);
  console.log(`\n  README written to ${OUTPUT_DIR}/README.md`);
  console.log('\nDone!');
}

main();
