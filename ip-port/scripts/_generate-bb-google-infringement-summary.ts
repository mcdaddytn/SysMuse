/**
 * Generate Blackberry 44 × Google Infringement Summary
 * Reads scores from cache for BB44 patents against Google products.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SCORES_DIR = path.resolve('./cache/infringement-scores');

// Google products grouped by category
const PRODUCT_GROUPS: Record<string, { label: string; products: string[] }> = {
  'cloud-networking': {
    label: 'Cloud Networking',
    products: [
      'cloud-armor', 'cloud-ngfw', 'cloud-load-balancing', 'cloud-router',
      'virtual-private-cloud-vpc', 'vpc-firewall-rules', 'vpc-network-peering',
      'shared-vpc', 'network-connectivity-center', 'network-intelligence-center',
      'andromeda',
    ],
  },
  'cloud-compute': {
    label: 'Cloud Compute & IAM',
    products: ['compute-engine', 'gke', 'identity-and-access-management-iam', 'context-aware-access'],
  },
  'security': {
    label: 'Security',
    products: ['chronicle'],
  },
  'consumer': {
    label: 'Consumer Devices & Android',
    products: ['android', 'chromecast-with-google-tv-4k', 'google-tv-streamer-4k', 'pixel-10'],
  },
  'media-codecs': {
    label: 'Media & Codecs',
    products: ['av1'],
  },
};

// All products flat
const ALL_PRODUCTS = Object.values(PRODUCT_GROUPS).flatMap(g => g.products);

interface ScoreEntry {
  patentId: string;
  product: string;
  productGroup: string;
  finalScore: number;
  pass1Score: number;
  documentName: string;
  narrative: string | null;
  pass1Rationale: string | null;
}

function loadScores(patentIds: Set<string>): ScoreEntry[] {
  const entries: ScoreEntry[] = [];
  const companyDir = path.join(SCORES_DIR, 'google');
  if (!fs.existsSync(companyDir)) return entries;

  for (const product of ALL_PRODUCTS) {
    const dir = path.join(companyDir, product);
    if (!fs.existsSync(dir)) continue;

    // Find which group this product belongs to
    const group = Object.entries(PRODUCT_GROUPS).find(([, g]) =>
      g.products.includes(product)
    )?.[0] || 'unknown';

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const patentId = file.replace('.json', '');
      if (!patentIds.has(patentId)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const finalScore = data.finalScore ?? data.pass1?.compositeScore ?? 0;
        const pass1Score = data.pass1?.compositeScore ?? 0;
        entries.push({
          patentId,
          product,
          productGroup: group,
          finalScore,
          pass1Score,
          documentName: data.documentName || '',
          narrative: data.narrative || null,
          pass1Rationale: data.pass1Rationale || null,
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
  // Get BB44 patent IDs from focus area
  const fa = await prisma.focusArea.findFirst({ where: { name: 'Blackberry 44' } });
  if (!fa) { console.error('Focus area "Blackberry 44" not found'); process.exit(1); }

  const faPatents = await prisma.focusAreaPatent.findMany({
    where: { focusAreaId: fa.id },
    select: { patentId: true },
  });
  const patentIds = new Set(faPatents.map(f => f.patentId));
  console.log(`Patents: ${patentIds.size}`);

  // Get patent metadata + V3 scores
  const patentDetails = await prisma.patent.findMany({
    where: { patentId: { in: [...patentIds] } },
    select: { patentId: true, title: true, superSector: true, primarySector: true },
  });
  const patentMeta = new Map(patentDetails.map(p => [p.patentId, p]));

  // Load V3 snapshot scores
  const v3Snapshot = await prisma.scoreSnapshot.findFirst({
    where: { scoreType: 'V3', isActive: true, portfolio: { name: 'blackberry' } },
    include: { scores: { where: { patentId: { in: [...patentIds] } } } },
  });
  const v3Scores = new Map(v3Snapshot?.scores.map(s => [s.patentId, s.score]) || []);

  // Load infringement scores
  const scores = loadScores(patentIds);
  console.log(`Score entries: ${scores.length}`);
  console.log(`Products covered: ${new Set(scores.map(s => s.product)).size}`);

  // Build matrix: patent → product → best score
  const matrix = new Map<string, Map<string, ScoreEntry>>();
  for (const s of scores) {
    if (!matrix.has(s.patentId)) matrix.set(s.patentId, new Map());
    const existing = matrix.get(s.patentId)!.get(s.product);
    if (!existing || s.finalScore > existing.finalScore) {
      matrix.get(s.patentId)!.set(s.product, s);
    }
  }

  // Aggregate per patent
  interface PatentAgg {
    patentId: string;
    title: string;
    superSector: string;
    v3Score: number;
    maxScore: number;
    productScores: Map<string, number>;
    bestProduct: string;
    hits: number; // products with score >= 0.50
  }

  const patentAggs: PatentAgg[] = [];
  for (const [patentId, productMap] of matrix) {
    const meta = patentMeta.get(patentId);
    let maxScore = 0;
    let bestProduct = '';
    const productScores = new Map<string, number>();
    let hits = 0;
    for (const [product, entry] of productMap) {
      productScores.set(product, entry.finalScore);
      if (entry.finalScore > maxScore) {
        maxScore = entry.finalScore;
        bestProduct = product;
      }
      if (entry.finalScore >= 0.50) hits++;
    }
    patentAggs.push({
      patentId,
      title: meta?.title || '',
      superSector: meta?.superSector || '',
      v3Score: v3Scores.get(patentId) || 0,
      maxScore,
      productScores,
      bestProduct,
      hits,
    });
  }
  patentAggs.sort((a, b) => b.maxScore - a.maxScore);

  // Statistics
  const tier1 = patentAggs.filter(p => p.maxScore >= 0.80);
  const tier2 = patentAggs.filter(p => p.maxScore >= 0.65 && p.maxScore < 0.80);
  const tier3 = patentAggs.filter(p => p.maxScore >= 0.50 && p.maxScore < 0.65);

  // Generate markdown
  const lines: string[] = [];
  lines.push('# Blackberry 44 × Google — Infringement Heat Map');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Patents:** ${patentIds.size} | **Google Products:** ${ALL_PRODUCTS.length} | **Score entries:** ${scores.length}`);
  lines.push(`**Tier 1 (>=0.80):** ${tier1.length} | **Tier 2 (>=0.65):** ${tier2.length} | **Tier 3 (>=0.50):** ${tier3.length}`);
  lines.push('');

  // Executive summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`Of ${patentIds.size} Blackberry patents scored against ${ALL_PRODUCTS.length} Google products:`);
  if (tier1.length > 0) {
    lines.push(`- **${tier1.length} patents** scored >=0.80 (Tier 1: Immediate priority)`);
    for (const p of tier1) {
      lines.push(`  - US${p.patentId}: ${p.maxScore.toFixed(2)} vs ${p.bestProduct} — ${p.title.substring(0, 70)}`);
    }
  }
  if (tier2.length > 0) {
    lines.push(`- **${tier2.length} patents** scored 0.65-0.80 (Tier 2: Strong candidates)`);
    for (const p of tier2) {
      lines.push(`  - US${p.patentId}: ${p.maxScore.toFixed(2)} vs ${p.bestProduct} — ${p.title.substring(0, 70)}`);
    }
  }
  if (tier3.length > 0) {
    lines.push(`- **${tier3.length} patents** scored 0.50-0.65 (Tier 3: Monitoring)`);
    for (const p of tier3) {
      lines.push(`  - US${p.patentId}: ${p.maxScore.toFixed(2)} vs ${p.bestProduct} — ${p.title.substring(0, 70)}`);
    }
  }
  lines.push('');

  // Top 30 patent × product matrix (showing products with any >0.20 score)
  lines.push('## Patent × Product Score Matrix');
  lines.push('');
  lines.push('Top patents by max infringement score (showing products with score > 0.20):');
  lines.push('');

  // Determine which products actually have scores
  const activeProducts = ALL_PRODUCTS.filter(p =>
    patentAggs.some(pa => (pa.productScores.get(p) || 0) > 0.20)
  );

  const matrixPatents = patentAggs.filter(p => p.maxScore >= 0.20).slice(0, 30);
  if (activeProducts.length > 0 && matrixPatents.length > 0) {
    const shortNames = activeProducts.map(p => p.replace(/google-/g, '').substring(0, 15));
    lines.push(`| Patent | V3 | ${shortNames.join(' | ')} | Max | Sector |`);
    lines.push(`|--------|-----|${activeProducts.map(() => '-----').join('|')}|-----|--------|`);

    for (const p of matrixPatents) {
      const cells = activeProducts.map(prod => {
        const score = p.productScores.get(prod);
        if (score === undefined || score < 0.05) return '-';
        if (score >= 0.80) return `**${score.toFixed(2)}**`;
        if (score >= 0.65) return `*${score.toFixed(2)}*`;
        return score.toFixed(2);
      });
      lines.push(`| US${p.patentId} | ${p.v3Score.toFixed(0)} | ${cells.join(' | ')} | ${p.maxScore.toFixed(2)} | ${p.superSector} |`);
    }
  }
  lines.push('');

  // Per-product breakdown
  lines.push('## Per-Product Breakdown');
  lines.push('');
  for (const [groupId, group] of Object.entries(PRODUCT_GROUPS)) {
    const groupScores = scores.filter(s => s.productGroup === groupId);
    if (groupScores.length === 0) continue;

    const maxGroupScore = Math.max(...groupScores.map(s => s.finalScore));
    const above50 = groupScores.filter(s => s.finalScore >= 0.50).length;

    lines.push(`### ${group.label} (max: ${maxGroupScore.toFixed(2)}, pairs >= 0.50: ${above50})`);
    lines.push('');

    for (const product of group.products) {
      const productScores = groupScores
        .filter(s => s.product === product)
        .sort((a, b) => b.finalScore - a.finalScore);
      if (productScores.length === 0) continue;

      const top = productScores[0];
      const above25 = productScores.filter(s => s.finalScore >= 0.25).length;
      lines.push(`**${product}** — top: ${top.finalScore.toFixed(2)} (US${top.patentId}), ${above25} pairs >= 0.25`);

      // Show top 5
      for (const s of productScores.slice(0, 5)) {
        if (s.finalScore < 0.10) break;
        const meta = patentMeta.get(s.patentId);
        lines.push(`  - US${s.patentId} (${s.finalScore.toFixed(2)}) — ${meta?.title?.substring(0, 60) || ''}`);
      }
      lines.push('');
    }
  }

  // Narratives for top pairs
  const topPairs = scores
    .filter(s => s.finalScore >= 0.40)
    .sort((a, b) => b.finalScore - a.finalScore);

  if (topPairs.length > 0) {
    lines.push('## Detailed Analysis — Top Scoring Pairs');
    lines.push('');
    for (const s of topPairs) {
      const meta = patentMeta.get(s.patentId);
      lines.push(`### US${s.patentId} × ${s.product} — Score: ${s.finalScore.toFixed(2)}`);
      lines.push(`**Patent:** ${meta?.title || 'Unknown'}`);
      lines.push(`**Sector:** ${meta?.superSector || '?'} | **V3 Score:** ${(v3Scores.get(s.patentId) || 0).toFixed(1)}`);
      lines.push(`**Document:** ${s.documentName}`);
      lines.push('');
      if (s.narrative) {
        lines.push('**Analysis:**');
        lines.push(s.narrative);
        lines.push('');
      } else if (s.pass1Rationale) {
        lines.push('**Pass 1 Rationale:**');
        lines.push(s.pass1Rationale);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }
  }

  const md = lines.join('\n');

  // Write outputs
  const outputDir = path.resolve('./output/vendor-exports/bb-google-2026-04-17');
  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, 'bb-google-infringement-heatmap.md'), md);
  console.log(`Written: bb-google-infringement-heatmap.md (${md.length} chars)`);

  // CSV: all scores
  const csvLines = ['patent_id,product,product_group,final_score,pass1_score,v3_score,super_sector,title,document,narrative'];
  for (const s of scores.sort((a, b) => b.finalScore - a.finalScore)) {
    const meta = patentMeta.get(s.patentId);
    csvLines.push([
      s.patentId,
      s.product,
      s.productGroup,
      s.finalScore.toFixed(4),
      s.pass1Score.toFixed(4),
      (v3Scores.get(s.patentId) || 0).toFixed(2),
      meta?.superSector || '',
      csvEscape(meta?.title || ''),
      csvEscape(s.documentName),
      csvEscape(s.narrative || s.pass1Rationale || ''),
    ].join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'bb-google-all-scores.csv'), csvLines.join('\n'));
  console.log(`Written: bb-google-all-scores.csv (${csvLines.length - 1} rows)`);

  // CSV: patent × product matrix
  const matrixCsvLines = ['patent_id,v3_score,super_sector,' + ALL_PRODUCTS.join(',') + ',max_score,title'];
  for (const p of patentAggs) {
    const prodScores = ALL_PRODUCTS.map(prod => {
      const s = p.productScores.get(prod);
      return s !== undefined ? s.toFixed(4) : '';
    });
    matrixCsvLines.push([
      p.patentId,
      p.v3Score.toFixed(2),
      p.superSector,
      ...prodScores,
      p.maxScore.toFixed(4),
      csvEscape(p.title),
    ].join(','));
  }
  fs.writeFileSync(path.join(outputDir, 'bb-google-patent-product-matrix.csv'), matrixCsvLines.join('\n'));
  console.log(`Written: bb-google-patent-product-matrix.csv (${matrixCsvLines.length - 1} rows)`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
