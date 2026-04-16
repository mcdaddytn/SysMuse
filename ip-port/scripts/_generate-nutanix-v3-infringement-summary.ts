/**
 * Generate Nutanix V3 Infringement Summary
 *
 * Reads infringement scores from cache/infringement-scores/nutanix/ for all 87
 * V3 Discovery patents and generates:
 *   1. nutanix-infringement-summary.md — Full heat map, per-product tables, strategic tiers
 *   2. nutanix-patent-product-matrix.csv — Patent × product cross-reference
 *   3. nutanix-all-scores.csv — All scored pairs
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SCORES_DIR = path.resolve('./cache/infringement-scores/nutanix');
const PRODUCTS = [
  'nutanix-ahv',
  'nutanix-cloud-infrastructure-nci',
  'nutanix-flow-network-security',
  'nutanix-flow-virtual-networking',
  'nutanix-prism-central',
];
const PRODUCT_LABELS: Record<string, string> = {
  'nutanix-ahv': 'Nutanix AHV',
  'nutanix-cloud-infrastructure-nci': 'Nutanix Cloud Infrastructure (NCI)',
  'nutanix-flow-network-security': 'Flow Network Security',
  'nutanix-flow-virtual-networking': 'Flow Virtual Networking',
  'nutanix-prism-central': 'Nutanix Prism Central',
};

interface ScoreEntry {
  patentId: string;
  productSlug: string;
  finalScore: number;
  documentName: string;
  narrative: string | null;
  pass1: any;
  pass2: any;
}

function loadScores(patentIds: Set<string>): ScoreEntry[] {
  const entries: ScoreEntry[] = [];
  for (const product of PRODUCTS) {
    const dir = path.join(SCORES_DIR, product);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const patentId = file.replace('.json', '');
      if (!patentIds.has(patentId)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        entries.push({
          patentId,
          productSlug: product,
          finalScore: data.finalScore ?? data.pass1?.compositeScore ?? 0,
          documentName: data.documentName || '',
          narrative: data.narrative,
          pass1: data.pass1,
          pass2: data.pass2,
        });
      } catch { /* skip */ }
    }
  }
  return entries;
}

function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  // Get V3 patent IDs
  const faPatents = await prisma.focusAreaPatent.findMany({
    where: { focusArea: { name: 'Nutanix V3 Discovery — Combined' } },
    select: { patentId: true },
  });
  const patentIds = new Set(faPatents.map(p => p.patentId));
  console.log(`V3 patents: ${patentIds.size}`);

  // Get patent metadata
  const patentDetails = await prisma.patent.findMany({
    where: { patentId: { in: [...patentIds] } },
    select: { patentId: true, title: true, primarySector: true, superSector: true },
  });
  const patentMeta = new Map(patentDetails.map(p => [p.patentId, p]));

  // Load scores
  const scores = loadScores(patentIds);
  console.log(`Score entries loaded: ${scores.length}`);

  // Build patent × product matrix
  const matrix = new Map<string, Map<string, ScoreEntry>>();
  for (const s of scores) {
    if (!matrix.has(s.patentId)) matrix.set(s.patentId, new Map());
    const existing = matrix.get(s.patentId)!.get(s.productSlug);
    if (!existing || s.finalScore > existing.finalScore) {
      matrix.get(s.patentId)!.set(s.productSlug, s);
    }
  }

  // Compute per-patent aggregates
  interface PatentAgg {
    patentId: string;
    title: string;
    maxScore: number;
    productScores: Map<string, number>;
    productHits: number; // products >= 0.50
    bestProduct: string;
    bestDoc: string;
    bestNarrative: string | null;
  }

  const patentAggs: PatentAgg[] = [];
  for (const [patentId, productMap] of matrix) {
    const meta = patentMeta.get(patentId);
    let maxScore = 0;
    let bestProduct = '';
    let bestDoc = '';
    let bestNarrative: string | null = null;
    const productScores = new Map<string, number>();
    let hits = 0;

    for (const [prod, entry] of productMap) {
      productScores.set(prod, entry.finalScore);
      if (entry.finalScore > maxScore) {
        maxScore = entry.finalScore;
        bestProduct = PRODUCT_LABELS[prod] || prod;
        bestDoc = entry.documentName;
        bestNarrative = entry.narrative;
      }
      if (entry.finalScore >= 0.50) hits++;
    }

    patentAggs.push({
      patentId,
      title: meta?.title || '',
      maxScore,
      productScores,
      productHits: hits,
      bestProduct,
      bestDoc,
      bestNarrative,
    });
  }

  patentAggs.sort((a, b) => b.maxScore - a.maxScore);

  // Stats
  const totalPairs = scores.length;
  const uniquePatents = matrix.size;
  const highSignal = patentAggs.filter(p => p.maxScore >= 0.65).length;
  const veryHigh = patentAggs.filter(p => p.maxScore >= 0.80).length;
  const maxOverall = patentAggs[0]?.maxScore || 0;
  const multiProduct = patentAggs.filter(p => p.productHits >= 3).length;

  // ── Generate Markdown ────────────────────────────────────────────────────
  const lines: string[] = [];

  lines.push('# Nutanix V3 Discovery — Infringement Analysis');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push('**Scoring Engine:** internal-v3 (10-component, two-pass)');
  lines.push('**Model:** claude-sonnet-4-20250514');
  lines.push('');

  // Executive Summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total scored pairs (deduplicated) | ${totalPairs} |`);
  lines.push(`| Unique patents scored | ${uniquePatents} |`);
  lines.push(`| Products analyzed | ${PRODUCTS.length} |`);
  lines.push(`| High-signal patents (>=0.65) | ${highSignal} |`);
  lines.push(`| Very-high patents (>=0.80) | ${veryHigh} |`);
  lines.push(`| Max score | ${maxOverall.toFixed(3)} |`);
  lines.push(`| Multi-product patents (>=3 products >=0.50) | ${multiProduct} |`);
  lines.push('');

  // Top 30 Patents by Max Score
  lines.push('## Top 30 Patents by Max Score');
  lines.push('');
  lines.push('| Rank | Patent | Title | Max Score | Products (>=0.50) | Best Product |');
  lines.push('|------|--------|-------|-----------|-------------------|---------------|');
  for (let i = 0; i < Math.min(30, patentAggs.length); i++) {
    const p = patentAggs[i];
    const titleTrunc = p.title.length > 50 ? p.title.slice(0, 50) : p.title;
    lines.push(`| ${i + 1} | US${p.patentId} | ${titleTrunc} | ${p.maxScore.toFixed(3)} | ${p.productHits}/${PRODUCTS.length} | ${p.bestProduct} |`);
  }
  lines.push('');

  // Patent × Product Score Matrix
  lines.push('## Patent × Product Score Matrix');
  lines.push('');
  lines.push('Showing all patents with max score >= 0.50:');
  lines.push('');
  const matrixPatents = patentAggs.filter(p => p.maxScore >= 0.50);
  const prodHeaders = PRODUCTS.map(p => PRODUCT_LABELS[p]);
  lines.push(`| Patent | ${prodHeaders.join(' | ')} | Max |`);
  lines.push(`|--------|${PRODUCTS.map(() => '-----').join('|')}|-----|`);
  for (const p of matrixPatents) {
    const cells = PRODUCTS.map(prod => {
      const score = p.productScores.get(prod);
      if (score === undefined) return '-';
      if (score >= 0.80) return `**${score.toFixed(2)}**`;
      return score.toFixed(2);
    });
    lines.push(`| US${p.patentId} | ${cells.join(' | ')} | ${p.maxScore.toFixed(2)} |`);
  }
  lines.push('');

  // Per-Product Breakdown
  for (const product of PRODUCTS) {
    const label = PRODUCT_LABELS[product];
    lines.push(`### ${label}`);
    lines.push('');

    const productScores = patentAggs
      .filter(p => p.productScores.has(product))
      .map(p => ({
        patentId: p.patentId,
        score: p.productScores.get(product)!,
        entry: matrix.get(p.patentId)!.get(product)!,
      }))
      .sort((a, b) => b.score - a.score);

    const highScores = productScores.filter(s => s.score >= 0.50);
    lines.push(`**Scored pairs:** ${productScores.length}`);
    lines.push('');

    if (highScores.length > 0) {
      lines.push('| Patent | Score | Document | Narrative (excerpt) |');
      lines.push('|--------|-------|----------|---------------------|');
      for (const s of highScores) {
        const docTrunc = s.entry.documentName.length > 40 ? s.entry.documentName.slice(0, 40) : s.entry.documentName;
        const narrTrunc = s.entry.narrative
          ? (s.entry.narrative.length > 100 ? s.entry.narrative.slice(0, 100) + '...' : s.entry.narrative)
          : '';
        lines.push(`| US${s.patentId} | ${s.score.toFixed(3)} | ${docTrunc} | ${narrTrunc} |`);
      }
    } else {
      lines.push('No patents scored >= 0.50 for this product.');
    }
    lines.push('');
  }

  // Strategic Tiers
  lines.push('## Strategic Recommendations');
  lines.push('');

  const tier1 = patentAggs.filter(p => p.maxScore >= 0.85);
  const tier2 = patentAggs.filter(p => p.maxScore >= 0.70 && p.maxScore < 0.85);
  const tier3 = patentAggs.filter(p => p.maxScore >= 0.50 && p.maxScore < 0.70);

  lines.push(`### Tier 1: Immediate Priority (score >= 0.85) — ${tier1.length} patents`);
  lines.push('');
  for (const p of tier1) {
    const prodList = PRODUCTS
      .filter(prod => (p.productScores.get(prod) || 0) >= 0.50)
      .map(prod => `${PRODUCT_LABELS[prod]}: ${p.productScores.get(prod)!.toFixed(2)}`)
      .join(', ');
    lines.push(`- **US${p.patentId}** (${p.maxScore.toFixed(3)}) — ${p.title}`);
    lines.push(`  - Products: ${prodList}`);
  }
  lines.push('');

  lines.push(`### Tier 2: Strong Candidates (0.70 <= score < 0.85) — ${tier2.length} patents`);
  lines.push('');
  for (const p of tier2) {
    lines.push(`- **US${p.patentId}** (${p.maxScore.toFixed(3)}) — ${p.title}`);
  }
  lines.push('');

  lines.push(`### Tier 3: Monitoring (0.50 <= score < 0.70) — ${tier3.length} patents`);
  lines.push('');
  for (const p of tier3) {
    lines.push(`- **US${p.patentId}** (${p.maxScore.toFixed(3)}) — ${p.title}`);
  }
  lines.push('');

  // Cross-Product Coverage
  lines.push('### Cross-Product Coverage');
  lines.push('');
  lines.push('Patents with broad infringement signals across multiple Nutanix products:');
  lines.push('');
  const crossProduct = patentAggs
    .filter(p => p.productHits >= 2)
    .sort((a, b) => b.productHits - a.productHits || b.maxScore - a.maxScore);

  lines.push('| Patent | Hit Count | Products |');
  lines.push('|--------|-----------|----------|');
  for (const p of crossProduct) {
    const prodList = PRODUCTS
      .filter(prod => (p.productScores.get(prod) || 0) >= 0.50)
      .sort((a, b) => (p.productScores.get(b) || 0) - (p.productScores.get(a) || 0))
      .map(prod => `${PRODUCT_LABELS[prod]} (${p.productScores.get(prod)!.toFixed(2)})`)
      .join(', ');
    lines.push(`| US${p.patentId} | ${p.productHits}/${PRODUCTS.length} | ${prodList} |`);
  }
  lines.push('');

  // Methodology
  lines.push('## Methodology');
  lines.push('');
  lines.push('### Scoring Engine (internal-v3)');
  lines.push('');
  lines.push('Two-pass scoring with 10 evaluation components:');
  lines.push('');
  lines.push('1. **Pass 1 (Screening):** Patent claims + 15K doc chars → 10 component scores (1-5 scale)');
  lines.push('2. **Pass 2 (Deep):** All independent claims + full doc → 10 component scores');
  lines.push('3. **Final:** 0.3 × Pass 1 + 0.7 × Pass 2');
  lines.push('');
  lines.push('Components: functional alignment, claim element coverage, necessary implication, architectural similarity, terminology mapping, document quality, standards alignment, implementation detectability, scope of infringement, overall infringement likelihood.');
  lines.push('');

  const md = lines.join('\n');

  // ── Write outputs ──────────────────────────────────────────────────────
  const outputDir = path.resolve('./output/vendor-exports/nutanix-v3-discovery-2026-04-16');
  fs.mkdirSync(outputDir, { recursive: true });

  // 1. Markdown summary
  fs.writeFileSync(path.join(outputDir, 'nutanix-infringement-summary.md'), md);
  console.log(`Written: nutanix-infringement-summary.md (${md.length} chars)`);

  // 2. Patent × Product matrix CSV
  const csvLines = ['Patent,' + PRODUCTS.map(p => PRODUCT_LABELS[p]).join(',') + ',Max'];
  for (const p of patentAggs) {
    const scores = PRODUCTS.map(prod => {
      const s = p.productScores.get(prod);
      return s !== undefined ? s.toFixed(3) : '';
    });
    csvLines.push(`${p.patentId},${scores.join(',')},${p.maxScore.toFixed(3)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'nutanix-patent-product-matrix.csv'), csvLines.join('\n'));
  console.log(`Written: nutanix-patent-product-matrix.csv (${patentAggs.length} patents)`);

  // 3. All scores CSV
  const allCsvLines = ['PatentId,Product,Score,Document,Narrative'];
  for (const s of scores.sort((a, b) => b.finalScore - a.finalScore)) {
    allCsvLines.push([
      s.patentId,
      csvEscape(PRODUCT_LABELS[s.productSlug] || s.productSlug),
      s.finalScore.toFixed(3),
      csvEscape(s.documentName),
      csvEscape(s.narrative?.slice(0, 200) || ''),
    ].join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'nutanix-all-scores.csv'), allCsvLines.join('\n'));
  console.log(`Written: nutanix-all-scores.csv (${scores.length} pairs)`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
