/**
 * Generate Wireless-Infrastructure Infringement Summary
 * Reads scores from cache for the wireless-infrastructure patent set
 * against Ericsson, Nokia, Mavenir, Samsung, Qualcomm, CommScope, Ubiquiti, Parallel Wireless.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SCORES_DIR = path.resolve('./cache/infringement-scores');

const COMPANY_PRODUCTS: Record<string, { label: string; slugProducts: Array<{ slug: string; product: string }> }> = {
  'ericsson': {
    label: 'Ericsson',
    slugProducts: [
      { slug: 'ericsson', product: 'ericsson-cloud-ran' },
      { slug: 'ericsson', product: 'cloud-execution-environment' },
      { slug: 'ericsson', product: 'ericsson-network-manager' },
      { slug: 'ericsson', product: 'baseband-6630' },
    ],
  },
  'nokia': {
    label: 'Nokia',
    slugProducts: [
      { slug: 'nokia', product: 'network-services-platform-nsp' },
      { slug: 'nokia', product: 'altiplano-access-controller' },
      { slug: 'nokia', product: 'airscale-outdoor-baseband' },
      { slug: 'nokia', product: 'cloudband-application-manager' },
    ],
  },
  'mavenir': {
    label: 'Mavenir',
    slugProducts: [
      { slug: 'mavenir', product: 'ran-intelligent-controller-ric-solution-brief' },
      { slug: 'mavenir', product: 'converged-packet-core-solution-brief-2024' },
      { slug: 'mavenir', product: 'intel-mavenir-open-ran-acceleration' },
    ],
  },
  'samsung': {
    label: 'Samsung',
    slugProducts: [
      { slug: 'samsung-electronics', product: 'exynos-modem-5100' },
      { slug: 'samsung-electronics', product: 'exynos-modem-rf' },
      { slug: 'samsung-electronics', product: 'exynos-2200' },
      { slug: 'samsung-electronics', product: 'galaxy-s22-5g' },
    ],
  },
  'qualcomm': {
    label: 'Qualcomm',
    slugProducts: [
      { slug: 'qualcomm', product: 'snapdragon-802' },
      { slug: 'qualcomm', product: 'snapdragon-x60-5g-modem-rf-system' },
      { slug: 'qualcomm', product: 'snapdragon-x65-5g-modem-rf-system' },
    ],
  },
  'commscope': {
    label: 'CommScope',
    slugProducts: [
      { slug: 'commscope', product: 'ruckus-r770-wi-fi-7-access-point-data-sheet' },
      { slug: 'commscope', product: 'ruckus-r670-wi-fi-7-access-point-data-sheet' },
      { slug: 'ruckus-networks', product: 'r750-indoor-wi-fi-6-access-point' },
      { slug: 'ruckus-networks', product: 'smartzone-controller-family' },
    ],
  },
  'ubiquiti': {
    label: 'Ubiquiti',
    slugProducts: [
      { slug: 'ubiquiti', product: 'u7-pro-wifi-7-access-point-tech-specs' },
      { slug: 'ubiquiti', product: 'u6-wifi-6-access-point-datasheet' },
      { slug: 'ubiquiti', product: 'airfiber-af-5xhd-ltu-ptp-datasheet' },
    ],
  },
  'parallel-wireless': {
    label: 'Parallel Wireless',
    slugProducts: [
      { slug: 'parallel-wireless', product: 'openran-101-role-of-ric' },
      { slug: 'parallel-wireless', product: 'open-ran-functional-splits-whitepaper-2021' },
      { slug: 'parallel-wireless', product: '5g-nr-logical-architecture-and-splits' },
    ],
  },
};

const COMPANY_ORDER = ['ericsson', 'nokia', 'mavenir', 'samsung', 'qualcomm', 'commscope', 'ubiquiti', 'parallel-wireless'];

interface ScoreEntry {
  patentId: string;
  company: string;
  finalScore: number;
  documentName: string;
  narrative: string | null;
}

function loadScores(patentIds: Set<string>): ScoreEntry[] {
  const entries: ScoreEntry[] = [];
  for (const [company, config] of Object.entries(COMPANY_PRODUCTS)) {
    for (const { slug, product } of config.slugProducts) {
      const dir = path.join(SCORES_DIR, slug, product);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const patentId = file.replace('.json', '');
        if (!patentIds.has(patentId)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
          const score = data.finalScore ?? data.pass1?.compositeScore ?? 0;
          const existing = entries.find(e => e.patentId === patentId && e.company === company);
          if (!existing || score > existing.finalScore) {
            if (existing) {
              existing.finalScore = score;
              existing.documentName = data.documentName || '';
              existing.narrative = data.narrative;
            } else {
              entries.push({
                patentId,
                company,
                finalScore: score,
                documentName: data.documentName || '',
                narrative: data.narrative,
              });
            }
          }
        } catch { /* skip */ }
      }
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
  const csvContent = fs.readFileSync('output/vendor-exports/wireless-infrastructure-2026-04-16/vendor-targets.csv', 'utf-8');
  const patentLines = csvContent.split('\n').slice(1).filter(l => l.trim());
  const patentIds = new Set(patentLines.map(l => l.split(',')[0].replace(/^US/, '').replace(/B\d+$/, '')));
  console.log(`Patents: ${patentIds.size}`);

  const patentDetails = await prisma.patent.findMany({
    where: { patentId: { in: [...patentIds] } },
    select: { patentId: true, title: true },
  });
  const patentMeta = new Map(patentDetails.map(p => [p.patentId, p]));

  const scores = loadScores(patentIds);
  console.log(`Score entries: ${scores.length}`);

  const matrix = new Map<string, Map<string, ScoreEntry>>();
  for (const s of scores) {
    if (!matrix.has(s.patentId)) matrix.set(s.patentId, new Map());
    matrix.get(s.patentId)!.set(s.company, s);
  }

  interface PatentAgg {
    patentId: string;
    title: string;
    maxScore: number;
    companyScores: Map<string, number>;
    hits: number;
    scoredCount: number;
  }

  const patentAggs: PatentAgg[] = [];
  for (const [patentId, companyMap] of matrix) {
    const meta = patentMeta.get(patentId);
    let maxScore = 0;
    const companyScores = new Map<string, number>();
    let hits = 0;
    for (const [company, entry] of companyMap) {
      companyScores.set(company, entry.finalScore);
      if (entry.finalScore > maxScore) maxScore = entry.finalScore;
      if (entry.finalScore >= 0.50) hits++;
    }
    patentAggs.push({ patentId, title: meta?.title || '', maxScore, companyScores, hits, scoredCount: companyMap.size });
  }
  patentAggs.sort((a, b) => b.maxScore - a.maxScore);

  const unscoredPatents = [...patentIds].filter(pid => !matrix.has(pid));
  const veryHigh = patentAggs.filter(p => p.maxScore >= 0.80).length;
  const highSignal = patentAggs.filter(p => p.maxScore >= 0.65).length;

  const lines: string[] = [];
  lines.push('# Wireless-Infrastructure — Infringement Heat Map');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Patents:** ${patentIds.size} (${patentAggs.length} scored, ${unscoredPatents.length} unscored) | **Companies:** ${COMPANY_ORDER.length} | **Score entries:** ${scores.length}`);
  lines.push(`**Very-high (>=0.80):** ${veryHigh} | **High-signal (>=0.65):** ${highSignal}`);
  lines.push('');

  lines.push('## Scoring Coverage');
  lines.push('');
  lines.push('| Company | Patents Scored | >= 0.50 | >= 0.80 |');
  lines.push('|---------|--------------|---------|---------|');
  for (const c of COMPANY_ORDER) {
    const scored = patentAggs.filter(p => p.companyScores.has(c)).length;
    const gte50 = patentAggs.filter(p => (p.companyScores.get(c) || 0) >= 0.50).length;
    const gte80 = patentAggs.filter(p => (p.companyScores.get(c) || 0) >= 0.80).length;
    lines.push(`| ${COMPANY_PRODUCTS[c].label} | ${scored}/${patentIds.size} | ${gte50} | ${gte80} |`);
  }
  lines.push('');

  lines.push('## Patent × Company Score Matrix');
  lines.push('');
  lines.push('Patents with max score >= 0.50:');
  lines.push('');
  const headers = COMPANY_ORDER.map(c => COMPANY_PRODUCTS[c].label);
  lines.push(`| Patent | ${headers.join(' | ')} | Max | Title |`);
  lines.push(`|--------|${COMPANY_ORDER.map(() => '-----').join('|')}|-----|-------|`);

  const matrixPatents = patentAggs.filter(p => p.maxScore >= 0.50);
  for (const p of matrixPatents) {
    const cells = COMPANY_ORDER.map(c => {
      const score = p.companyScores.get(c);
      if (score === undefined) return '-';
      if (score >= 0.80) return `**${score.toFixed(2)}**`;
      return score.toFixed(2);
    });
    const titleTrunc = p.title.length > 45 ? p.title.slice(0, 45) + '...' : p.title;
    lines.push(`| US${p.patentId} | ${cells.join(' | ')} | ${p.maxScore.toFixed(2)} | ${titleTrunc} |`);
  }
  lines.push('');

  const tier1 = patentAggs.filter(p => p.maxScore >= 0.85);
  const tier2 = patentAggs.filter(p => p.maxScore >= 0.70 && p.maxScore < 0.85);
  const tier3 = patentAggs.filter(p => p.maxScore >= 0.50 && p.maxScore < 0.70);

  lines.push(`## Tier 1: Immediate Priority (>=0.85) — ${tier1.length} patents`);
  lines.push('');
  for (const p of tier1) {
    const prodList = COMPANY_ORDER
      .filter(c => (p.companyScores.get(c) || 0) >= 0.50)
      .map(c => `${COMPANY_PRODUCTS[c].label}: ${p.companyScores.get(c)!.toFixed(2)}`)
      .join(', ');
    lines.push(`- **US${p.patentId}** (${p.maxScore.toFixed(3)}) — ${p.title}`);
    if (prodList) lines.push(`  - ${prodList}`);
  }
  lines.push('');

  lines.push(`## Tier 2: Strong Candidates (0.70-0.85) — ${tier2.length} patents`);
  lines.push('');
  for (const p of tier2) {
    const prodList = COMPANY_ORDER
      .filter(c => (p.companyScores.get(c) || 0) >= 0.50)
      .map(c => `${COMPANY_PRODUCTS[c].label}: ${p.companyScores.get(c)!.toFixed(2)}`)
      .join(', ');
    lines.push(`- **US${p.patentId}** (${p.maxScore.toFixed(3)}) — ${p.title}`);
    if (prodList) lines.push(`  - ${prodList}`);
  }
  lines.push('');

  lines.push(`## Tier 3: Monitoring (0.50-0.70) — ${tier3.length} patents`);
  lines.push('');
  for (const p of tier3) {
    lines.push(`- **US${p.patentId}** (${p.maxScore.toFixed(3)}) — ${p.title}`);
  }
  lines.push('');

  lines.push('## Cross-Company Coverage');
  lines.push('');
  const cross = patentAggs.filter(p => p.hits >= 2).sort((a, b) => b.hits - a.hits || b.maxScore - a.maxScore);
  lines.push('| Patent | Companies >=0.50 | Targets |');
  lines.push('|--------|-----------------|---------|');
  for (const p of cross) {
    const targets = COMPANY_ORDER
      .filter(c => (p.companyScores.get(c) || 0) >= 0.50)
      .sort((a, b) => (p.companyScores.get(b) || 0) - (p.companyScores.get(a) || 0))
      .map(c => `${COMPANY_PRODUCTS[c].label} (${p.companyScores.get(c)!.toFixed(2)})`)
      .join(', ');
    lines.push(`| US${p.patentId} | ${p.hits}/${COMPANY_ORDER.length} | ${targets} |`);
  }
  lines.push('');

  if (unscoredPatents.length > 0) {
    lines.push(`## Unscored Patents (${unscoredPatents.length})`);
    lines.push('');
    for (const pid of unscoredPatents) {
      const meta = patentMeta.get(pid);
      lines.push(`- US${pid} — ${meta?.title || '(unknown)'}`);
    }
    lines.push('');
  }

  const md = lines.join('\n');

  const outputDir = path.resolve('./output/vendor-exports/wireless-infrastructure-2026-04-16');
  fs.writeFileSync(path.join(outputDir, 'wireless-infrastructure-infringement-heatmap.md'), md);
  console.log(`Written: wireless-infrastructure-infringement-heatmap.md (${md.length} chars)`);

  const csvLines = ['Patent,' + COMPANY_ORDER.map(c => COMPANY_PRODUCTS[c].label).join(',') + ',Max,Title'];
  for (const p of patentAggs) {
    const pScores = COMPANY_ORDER.map(c => {
      const s = p.companyScores.get(c);
      return s !== undefined ? s.toFixed(3) : '';
    });
    csvLines.push(`${p.patentId},${pScores.join(',')},${p.maxScore.toFixed(3)},${csvEscape(p.title)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'wireless-infrastructure-patent-company-matrix.csv'), csvLines.join('\n'));
  console.log(`Written: wireless-infrastructure-patent-company-matrix.csv`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
