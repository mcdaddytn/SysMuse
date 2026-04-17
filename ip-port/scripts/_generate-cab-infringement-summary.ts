/**
 * Generate Computing-Auth-Boot Infringement Summary
 * Reads scores from cache for the computing-auth-boot patent set
 * against Okta, Cisco, Ping Identity, Microsoft, Palo Alto.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SCORES_DIR = path.resolve('./cache/infringement-scores');

const COMPANY_PRODUCTS: Record<string, { label: string; slugProducts: Array<{ slug: string; product: string }> }> = {
  'okta': {
    label: 'Okta',
    slugProducts: [
      { slug: 'okta', product: 'okta-workforce-identity' },
      { slug: 'okta', product: 'okta-universal-directory' },
      { slug: 'okta', product: 'okta-identity-governance' },
    ],
  },
  'cisco': {
    label: 'Cisco',
    slugProducts: [
      { slug: 'cisco-systems', product: 'cisco-identity-services-engine-ise' },
      { slug: 'cisco', product: 'cisco-identity-services-engine-ise' },
    ],
  },
  'ping-identity': {
    label: 'Ping Identity',
    slugProducts: [
      { slug: 'ping-identity', product: 'pingfederate-sso' },
      { slug: 'ping-identity', product: 'pingfederate-server-documentation' },
      { slug: 'ping-identity', product: 'identity-for-ai' },
    ],
  },
  'microsoft': {
    label: 'Microsoft',
    slugProducts: [
      { slug: 'microsoft', product: 'microsoft-entra-id' },
      { slug: 'microsoft', product: 'microsoft-intune' },
      { slug: 'microsoft', product: 'hyper-v' },
    ],
  },
  'palo-alto': {
    label: 'Palo Alto',
    slugProducts: [
      { slug: 'palo-alto-networks', product: 'cortex-xsoar' },
      { slug: 'palo-alto-networks', product: 'panorama' },
    ],
  },
};

const COMPANY_ORDER = ['okta', 'cisco', 'ping-identity', 'microsoft', 'palo-alto'];

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
  const vendorDir = fs.readdirSync('output/vendor-exports/').filter(d => d.startsWith('computing-auth-boot-')).sort().pop();
  if (!vendorDir) { console.error('No computing-auth-boot vendor export found'); process.exit(1); }
  const csvContent = fs.readFileSync(`output/vendor-exports/${vendorDir}/vendor-targets.csv`, 'utf-8');
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
  lines.push('# Computing-Auth-Boot — Infringement Heat Map');
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

  const outputDir = path.resolve(`./output/vendor-exports/${vendorDir}`);
  fs.writeFileSync(path.join(outputDir, 'computing-auth-boot-infringement-heatmap.md'), md);
  console.log(`Written: computing-auth-boot-infringement-heatmap.md (${md.length} chars)`);

  const csvLines = ['Patent,' + COMPANY_ORDER.map(c => COMPANY_PRODUCTS[c].label).join(',') + ',Max,Title'];
  for (const p of patentAggs) {
    const pScores = COMPANY_ORDER.map(c => {
      const s = p.companyScores.get(c);
      return s !== undefined ? s.toFixed(3) : '';
    });
    csvLines.push(`${p.patentId},${pScores.join(',')},${p.maxScore.toFixed(3)},${csvEscape(p.title)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'computing-auth-boot-patent-company-matrix.csv'), csvLines.join('\n'));
  console.log(`Written: computing-auth-boot-patent-company-matrix.csv`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
