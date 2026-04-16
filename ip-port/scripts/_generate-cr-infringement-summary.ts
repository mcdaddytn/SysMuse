/**
 * Generate Computing-Runtime Infringement Summary
 * Reads scores from cache for the Apr 15 computing-runtime patent set
 * against Microsoft, Citrix, Red Hat, IBM, Oracle + existing Nutanix scores.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SCORES_DIR = path.resolve('./cache/infringement-scores');

// Companies + product groups to include
const COMPANY_PRODUCTS: Record<string, { label: string; products: string[] }> = {
  'microsoft': { label: 'Microsoft Hyper-V', products: ['hyper-v', 'hyper-v-network-virtualization', 'hyper-v-virtual-switch', 'azure-virtual-machines'] },
  'citrix': { label: 'Citrix XenServer', products: ['xenserver'] },
  'red-hat': { label: 'Red Hat Virtualization', products: ['red-hat-openshift-virtualization', 'red-hat-enterprise-virtualization'] },
  'ibm': { label: 'IBM PowerVM', products: ['powervm', 'powervm-enterprise-edition'] },
  'oracle': { label: 'Oracle', products: ['oracle-sdn-controller'] },
  'nutanix': { label: 'Nutanix', products: ['nutanix-ahv', 'nutanix-cloud-infrastructure-nci', 'nutanix-prism-central'] },
};

const COMPANY_ORDER = ['microsoft', 'citrix', 'red-hat', 'ibm', 'oracle', 'nutanix'];

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
    for (const product of config.products) {
      const dir = path.join(SCORES_DIR, company, product);
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
  // Get patent IDs from Apr 15 package
  const csvContent = fs.readFileSync('output/vendor-exports/computing-runtime-2026-04-16/vendor-targets.csv', 'utf-8');
  const patentLines = csvContent.split('\n').slice(1).filter(l => l.trim());
  const patentIds = new Set(patentLines.map(l => l.split(',')[0].replace(/^US/, '').replace(/B\d+$/, '')));
  console.log(`Patents: ${patentIds.size}`);

  // Get patent metadata
  const patentDetails = await prisma.patent.findMany({
    where: { patentId: { in: [...patentIds] } },
    select: { patentId: true, title: true },
  });
  const patentMeta = new Map(patentDetails.map(p => [p.patentId, p]));

  // Load scores
  const scores = loadScores(patentIds);
  console.log(`Score entries: ${scores.length}`);

  // Build matrix: patent → company → best score
  const matrix = new Map<string, Map<string, ScoreEntry>>();
  for (const s of scores) {
    if (!matrix.has(s.patentId)) matrix.set(s.patentId, new Map());
    matrix.get(s.patentId)!.set(s.company, s);
  }

  // Aggregate
  interface PatentAgg {
    patentId: string;
    title: string;
    maxScore: number;
    companyScores: Map<string, number>;
    hits: number;
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
    patentAggs.push({ patentId, title: meta?.title || '', maxScore, companyScores, hits });
  }
  patentAggs.sort((a, b) => b.maxScore - a.maxScore);

  const veryHigh = patentAggs.filter(p => p.maxScore >= 0.80).length;
  const highSignal = patentAggs.filter(p => p.maxScore >= 0.65).length;

  // Generate markdown
  const lines: string[] = [];
  lines.push('# Computing-Runtime — Infringement Heat Map');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Patents:** ${patentIds.size} | **Companies:** ${COMPANY_ORDER.length} | **Score entries:** ${scores.length}`);
  lines.push(`**Very-high (>=0.80):** ${veryHigh} | **High-signal (>=0.65):** ${highSignal}`);
  lines.push('');

  // Matrix
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

  // Tier breakdown
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

  // Cross-company coverage
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

  const md = lines.join('\n');

  // Write outputs
  const outputDir = path.resolve('./output/vendor-exports/computing-runtime-2026-04-16');
  fs.writeFileSync(path.join(outputDir, 'computing-runtime-infringement-heatmap.md'), md);
  console.log(`Written: computing-runtime-infringement-heatmap.md (${md.length} chars)`);

  // CSV matrix
  const csvLines = ['Patent,' + COMPANY_ORDER.map(c => COMPANY_PRODUCTS[c].label).join(',') + ',Max,Title'];
  for (const p of patentAggs) {
    const scores = COMPANY_ORDER.map(c => {
      const s = p.companyScores.get(c);
      return s !== undefined ? s.toFixed(3) : '';
    });
    csvLines.push(`${p.patentId},${scores.join(',')},${p.maxScore.toFixed(3)},${csvEscape(p.title)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'computing-runtime-patent-company-matrix.csv'), csvLines.join('\n'));
  console.log(`Written: computing-runtime-patent-company-matrix.csv`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
