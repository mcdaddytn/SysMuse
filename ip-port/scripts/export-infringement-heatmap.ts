#!/usr/bin/env npx tsx
/**
 * Export Internal Infringement Heatmap Results
 *
 * Reads scored results from cache/infringement-scores/ and produces three CSVs:
 *   1. patent-summary.csv — One row per patent, aggregated max scores across products
 *   2. patent-product-pivot.csv — Patent × Product pairs with scores
 *   3. document-evidence.csv — Patent × Document with narratives
 *
 * Usage:
 *   npx tsx scripts/export-infringement-heatmap.ts [options]
 *     --output-dir <path>    Output directory (default: output/infringement-heatmap)
 *     --min-score <n>        Minimum score for patent-summary inclusion (default: 0)
 *     --doc-min-score <n>    Minimum score for document-evidence rows (default: 0.30)
 *     --pass2-only           Only include pairs that completed Pass 2
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  readProductCache,
  getAllProductCaches,
  slugify,
} from '../src/api/services/patlytics-cache-service.js';

// ── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const OUTPUT_DIR = getArg('output-dir', 'output/infringement-heatmap');
const MIN_SCORE = parseFloat(getArg('min-score', '0'));
const DOC_MIN_SCORE = parseFloat(getArg('doc-min-score', '0.30'));
const PASS2_ONLY = args.includes('--pass2-only');
const SCORES_DIR = path.resolve('./cache/infringement-scores');

// ── Types ──────────────────────────────────────────────────────────────────

interface InfringementScore {
  patentId: string;
  companySlug: string;
  productSlug: string;
  documentSlug: string;
  documentName: string;
  pass1Score: number;
  pass1Rationale: string;
  finalScore: number | null;
  claimAnalysis: any[] | null;
  narrative: string | null;
  strongestClaim: number | null;
  keyGaps: string[] | null;
  model: string;
  sourceVersion: string;
  scoredAt: string;
}

interface PatentAgg {
  patentId: string;
  maxScore: number;
  products: Map<string, ProductAgg>;
}

interface ProductAgg {
  companySlug: string;
  companyName: string;
  productSlug: string;
  productName: string;
  maxScore: number;
  documents: DocAgg[];
}

interface DocAgg {
  documentName: string;
  documentSlug: string;
  score: number;
  pass1Score: number;
  finalScore: number | null;
  narrative: string | null;
  pass1Rationale: string;
  strongestClaim: number | null;
  keyGaps: string[] | null;
  scoredAt: string;
}

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

function scoreTier(score: number): string {
  if (score >= 0.80) return 'HIGH';
  if (score >= 0.60) return 'MODERATE';
  if (score >= 0.40) return 'WEAK';
  if (score >= 0.20) return 'MINIMAL';
  return 'NONE';
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ── Load Scores ─────────────────────────────────────────────────────────────

function loadAllScores(): InfringementScore[] {
  const scores: InfringementScore[] = [];
  if (!fs.existsSync(SCORES_DIR)) return scores;

  for (const company of fs.readdirSync(SCORES_DIR)) {
    const compDir = path.join(SCORES_DIR, company);
    try { if (!fs.statSync(compDir).isDirectory()) continue; } catch { continue; }

    for (const product of fs.readdirSync(compDir)) {
      const prodDir = path.join(compDir, product);
      try { if (!fs.statSync(prodDir).isDirectory()) continue; } catch { continue; }

      for (const file of fs.readdirSync(prodDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const data: InfringementScore = JSON.parse(fs.readFileSync(path.join(prodDir, file), 'utf-8'));
          if (PASS2_ONLY && data.finalScore === null) continue;
          scores.push(data);
        } catch { /* skip corrupt */ }
      }
    }
  }

  return scores;
}

// ── Build company name lookup from product caches ──────────────────────────

function buildCompanyNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  const products = getAllProductCaches();
  for (const p of products) {
    map.set(p.companySlug, p.companyName);
  }
  return map;
}

function buildProductNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  const products = getAllProductCaches();
  for (const p of products) {
    map.set(`${p.companySlug}/${p.productSlug}`, p.productName);
  }
  return map;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== Internal Infringement Heatmap Export ===\n');

  const allScores = loadAllScores();
  console.log(`Loaded ${allScores.length} scored pairs`);

  if (allScores.length === 0) {
    console.log('No scores found in cache/infringement-scores/. Run score-infringement.ts first.');
    return;
  }

  const companyNames = buildCompanyNameMap();
  const productNames = buildProductNameMap();

  // Aggregate by patent
  const patentMap = new Map<string, PatentAgg>();

  for (const s of allScores) {
    const effectiveScore = s.finalScore ?? s.pass1Score;

    if (!patentMap.has(s.patentId)) {
      patentMap.set(s.patentId, {
        patentId: s.patentId,
        maxScore: effectiveScore,
        products: new Map(),
      });
    }

    const patent = patentMap.get(s.patentId)!;
    patent.maxScore = Math.max(patent.maxScore, effectiveScore);

    const productKey = `${s.companySlug}/${s.productSlug}`;
    if (!patent.products.has(productKey)) {
      patent.products.set(productKey, {
        companySlug: s.companySlug,
        companyName: companyNames.get(s.companySlug) || s.companySlug,
        productSlug: s.productSlug,
        productName: productNames.get(productKey) || s.productSlug,
        maxScore: effectiveScore,
        documents: [],
      });
    }

    const product = patent.products.get(productKey)!;
    product.maxScore = Math.max(product.maxScore, effectiveScore);
    product.documents.push({
      documentName: s.documentName,
      documentSlug: s.documentSlug,
      score: effectiveScore,
      pass1Score: s.pass1Score,
      finalScore: s.finalScore,
      narrative: s.narrative,
      pass1Rationale: s.pass1Rationale,
      strongestClaim: s.strongestClaim,
      keyGaps: s.keyGaps,
      scoredAt: s.scoredAt,
    });
  }

  // Filter patents by min score
  const patents = [...patentMap.values()]
    .filter(p => p.maxScore >= MIN_SCORE)
    .sort((a, b) => b.maxScore - a.maxScore);

  console.log(`Patents after filtering (>= ${MIN_SCORE}): ${patents.length}`);

  // ── CSV 1: Patent Summary ───────────────────────────────────────────────

  const summaryHeaders = [
    'Rank',
    'PatentId',
    'MaxScore',
    'ScoreTier',
    'ProductCount',
    'DocumentCount',
    'Pass2Count',
    'TopCompany1',
    'TopProduct1',
    'TopScore1',
    'TopCompany2',
    'TopProduct2',
    'TopScore2',
    'TopCompany3',
    'TopProduct3',
    'TopScore3',
  ];

  const summaryRows: string[] = [csvRow(summaryHeaders)];

  for (let i = 0; i < patents.length; i++) {
    const p = patents[i];
    const products = [...p.products.values()].sort((a, b) => b.maxScore - a.maxScore);
    const totalDocs = products.reduce((sum, pr) => sum + pr.documents.length, 0);
    const pass2Docs = products.reduce((sum, pr) =>
      sum + pr.documents.filter(d => d.finalScore !== null).length, 0);

    const top3 = products.slice(0, 3);

    summaryRows.push(csvRow([
      i + 1,
      p.patentId,
      p.maxScore.toFixed(2),
      scoreTier(p.maxScore),
      products.length,
      totalDocs,
      pass2Docs,
      top3[0]?.companyName || '',
      top3[0]?.productName || '',
      top3[0]?.maxScore?.toFixed(2) || '',
      top3[1]?.companyName || '',
      top3[1]?.productName || '',
      top3[1]?.maxScore?.toFixed(2) || '',
      top3[2]?.companyName || '',
      top3[2]?.productName || '',
      top3[2]?.maxScore?.toFixed(2) || '',
    ]));
  }

  // ── CSV 2: Patent × Product Pivot ─────────────────────────────────────────

  const pivotHeaders = [
    'PatentId',
    'CompanyName',
    'CompanySlug',
    'ProductName',
    'ProductSlug',
    'MaxScore',
    'ScoreTier',
    'DocCount',
    'Pass2Count',
    'TopDocName',
    'TopDocScore',
    'StrongestClaim',
    'KeyGaps',
  ];

  const pivotRows: string[] = [csvRow(pivotHeaders)];
  let pivotCount = 0;

  for (const p of patents) {
    const products = [...p.products.values()].sort((a, b) => b.maxScore - a.maxScore);
    for (const prod of products) {
      const sortedDocs = [...prod.documents].sort((a, b) => b.score - a.score);
      const topDoc = sortedDocs[0];
      const pass2Docs = sortedDocs.filter(d => d.finalScore !== null);

      pivotRows.push(csvRow([
        p.patentId,
        prod.companyName,
        prod.companySlug,
        prod.productName,
        prod.productSlug,
        prod.maxScore.toFixed(2),
        scoreTier(prod.maxScore),
        sortedDocs.length,
        pass2Docs.length,
        topDoc?.documentName || '',
        topDoc?.score?.toFixed(2) || '',
        topDoc?.strongestClaim || '',
        topDoc?.keyGaps?.join('; ') || '',
      ]));
      pivotCount++;
    }
  }

  // ── CSV 3: Document Evidence ──────────────────────────────────────────────

  const docHeaders = [
    'PatentId',
    'CompanyName',
    'ProductName',
    'DocumentName',
    'Pass1Score',
    'FinalScore',
    'EffectiveScore',
    'ScoreTier',
    'StrongestClaim',
    'KeyGaps',
    'Narrative',
    'Pass1Rationale',
    'ScoredAt',
  ];

  const docRows: string[] = [csvRow(docHeaders)];
  let docCount = 0;

  for (const p of patents) {
    for (const prod of p.products.values()) {
      for (const doc of prod.documents) {
        if (doc.score < DOC_MIN_SCORE) continue;

        docRows.push(csvRow([
          p.patentId,
          prod.companyName,
          prod.productName,
          doc.documentName,
          doc.pass1Score != null ? doc.pass1Score.toFixed(2) : '',
          doc.finalScore !== null ? doc.finalScore.toFixed(2) : '',
          doc.score.toFixed(2),
          scoreTier(doc.score),
          doc.strongestClaim || '',
          doc.keyGaps?.join('; ') || '',
          doc.narrative || doc.pass1Rationale,
          doc.pass1Rationale,
          doc.scoredAt,
        ]));
        docCount++;
      }
    }
  }

  // ── Write Output ──────────────────────────────────────────────────────────

  ensureDir(OUTPUT_DIR);

  const summaryPath = path.join(OUTPUT_DIR, 'patent-summary.csv');
  const pivotPath = path.join(OUTPUT_DIR, 'patent-product-pivot.csv');
  const docPath = path.join(OUTPUT_DIR, 'document-evidence.csv');

  fs.writeFileSync(summaryPath, summaryRows.join('\n'));
  fs.writeFileSync(pivotPath, pivotRows.join('\n'));
  fs.writeFileSync(docPath, docRows.join('\n'));

  // ── Stats ─────────────────────────────────────────────────────────────────

  const scoreDist = { high: 0, moderate: 0, weak: 0, minimal: 0, none: 0 };
  for (const p of patents) {
    if (p.maxScore >= 0.80) scoreDist.high++;
    else if (p.maxScore >= 0.60) scoreDist.moderate++;
    else if (p.maxScore >= 0.40) scoreDist.weak++;
    else if (p.maxScore >= 0.20) scoreDist.minimal++;
    else scoreDist.none++;
  }

  console.log('\n=== Output ===');
  console.log(`  ${summaryPath} — ${patents.length} patents`);
  console.log(`  ${pivotPath} — ${pivotCount} patent×product rows`);
  console.log(`  ${docPath} — ${docCount} document evidence rows (score >= ${DOC_MIN_SCORE})`);

  console.log('\n=== Score Distribution ===');
  console.log(`  HIGH (>= 0.80):     ${scoreDist.high}`);
  console.log(`  MODERATE (>= 0.60): ${scoreDist.moderate}`);
  console.log(`  WEAK (>= 0.40):     ${scoreDist.weak}`);
  console.log(`  MINIMAL (>= 0.20):  ${scoreDist.minimal}`);
  console.log(`  NONE (< 0.20):      ${scoreDist.none}`);

  // Top companies
  const companyScores = new Map<string, { maxScore: number; count: number }>();
  for (const p of patents) {
    for (const prod of p.products.values()) {
      const entry = companyScores.get(prod.companyName) || { maxScore: 0, count: 0 };
      entry.maxScore = Math.max(entry.maxScore, prod.maxScore);
      entry.count++;
      companyScores.set(prod.companyName, entry);
    }
  }

  const topCompanies = [...companyScores.entries()]
    .sort((a, b) => b[1].maxScore - a[1].maxScore)
    .slice(0, 10);

  console.log('\n  Top Companies by Max Score:');
  for (const [company, { maxScore, count }] of topCompanies) {
    console.log(`    ${maxScore.toFixed(2)} — ${company} (${count} pairs)`);
  }

  console.log('\nDone!');
}

main();
