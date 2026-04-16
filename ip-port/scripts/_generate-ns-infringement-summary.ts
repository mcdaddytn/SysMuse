/**
 * Generate Network-Switching Infringement Summary
 * Reads scores from cache for the Apr 15 network-switching patent set
 * against Cisco, Juniper, Arista, Dell, HPE, Huawei.
 * Handles multiple company slug variants (cisco vs cisco-systems, etc.)
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const SCORES_DIR = path.resolve('./cache/infringement-scores');

// Company slug → label mapping with all slug/product variants
// For each company, we search ALL slug variants and take the best score per patent.
const COMPANY_PRODUCTS: Record<string, { label: string; slugProducts: Array<{ slug: string; product: string }> }> = {
  'cisco': {
    label: 'Cisco',
    slugProducts: [
      { slug: 'cisco', product: 'cisco-secure-network-analytics' },
      { slug: 'cisco-systems', product: 'cisco-application-centric-infrastructure-aci' },
      { slug: 'cisco-systems', product: 'cisco-aci-fabric' },
      { slug: 'cisco-systems', product: 'cisco-aci-multi-site' },
    ],
  },
  'juniper': {
    label: 'Juniper',
    slugProducts: [
      { slug: 'juniper-networks', product: 'apstra-data-center-director' },
      { slug: 'juniper-networks', product: 'mist-ai' },
      { slug: 'juniper-networks', product: 'mist-ai-sd-wan' },
    ],
  },
  'arista': {
    label: 'Arista',
    slugProducts: [
      { slug: 'arista-networks', product: 'arista-eos' },
      { slug: 'arista-networks', product: 'cloudvision' },
    ],
  },
  'dell': {
    label: 'Dell',
    slugProducts: [
      { slug: 'dell-emc', product: 'powerswitch-z9432f-on' },
      { slug: 'dell-technologies', product: 'smartfabric-services' },
      { slug: 'dell-technologies', product: 'dell-powermax-2500' },
      { slug: 'dell-technologies', product: 'dell-powermax-8500' },
    ],
  },
  'hpe': {
    label: 'HPE/Aruba',
    slugProducts: [
      { slug: 'hewlett-packard-enterprise', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
      { slug: 'hewlett-packard-enterprise', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
      { slug: 'hewlett-packard-enterprise', product: 'hpe-aruba-3810m-5400r-management-guide' },
      { slug: 'hewlett-packard-enterprise', product: 'hpe-van-sdn-controller' },
      { slug: 'hewlett-packard-enterprise', product: 'aruba-networking-central' },
      { slug: 'hpe-hewlett-packard-enterprise', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
      { slug: 'hpe-hewlett-packard-enterprise', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
      { slug: 'hpe', product: 'hpe-aruba-3810m-5400r-management-guide' },
      { slug: 'hpe', product: 'hpe-aruba-netconductor-architecture-guide' },
      { slug: 'hpe', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
      { slug: 'hpe', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
      { slug: 'hpe', product: 'hpe-flexnetwork-5520-hi-quickspecs' },
      { slug: 'hpe-aruba', product: 'hpe-aruba-3810m-5400r-management-guide' },
      { slug: 'hpe-aruba', product: 'hpe-aruba-networking-edgeconnect-sd-wan' },
      { slug: 'hpe-aruba', product: 'hpe-aruba-networking-virtual-switching-extension-vsx' },
    ],
  },
  'huawei': {
    label: 'Huawei',
    slugProducts: [
      { slug: 'huawei', product: 'imaster-nce-fabric' },
      { slug: 'huawei', product: 'datacenter-virtualization-solution-dcs' },
      { slug: 'huawei-technologies', product: 'imaster-nce-fabric' },
      { slug: 'huawei-technologies', product: 'datacenter-virtualization-solution-dcs' },
    ],
  },
};

const COMPANY_ORDER = ['cisco', 'juniper', 'arista', 'dell', 'hpe', 'huawei'];

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
  // Get patent IDs from Apr 15 package
  const csvContent = fs.readFileSync('output/vendor-exports/network-switching-2026-04-16/vendor-targets.csv', 'utf-8');
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
    patentAggs.push({
      patentId,
      title: meta?.title || '',
      maxScore,
      companyScores,
      hits,
      scoredCount: companyMap.size,
    });
  }
  patentAggs.sort((a, b) => b.maxScore - a.maxScore);

  // Also track patents with NO scores at all
  const unscoredPatents = [...patentIds].filter(pid => !matrix.has(pid));

  const veryHigh = patentAggs.filter(p => p.maxScore >= 0.80).length;
  const highSignal = patentAggs.filter(p => p.maxScore >= 0.65).length;
  const totalScored = patentAggs.length;

  // Generate markdown
  const lines: string[] = [];
  lines.push('# Network-Switching — Infringement Heat Map');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`**Patents:** ${patentIds.size} (${totalScored} scored, ${unscoredPatents.length} unscored) | **Companies:** ${COMPANY_ORDER.length} | **Score entries:** ${scores.length}`);
  lines.push(`**Very-high (>=0.80):** ${veryHigh} | **High-signal (>=0.65):** ${highSignal}`);
  lines.push('');

  if (unscoredPatents.length > 0) {
    lines.push(`> **Note:** ${unscoredPatents.length} patents have no infringement scores yet. Run scoring to fill gaps.`);
    lines.push('');
  }

  // Coverage summary per company
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

  // Unscored patents
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

  // Write outputs
  const outputDir = path.resolve('./output/vendor-exports/network-switching-2026-04-16');
  fs.writeFileSync(path.join(outputDir, 'network-switching-infringement-heatmap.md'), md);
  console.log(`Written: network-switching-infringement-heatmap.md (${md.length} chars)`);

  // CSV matrix
  const csvLines = ['Patent,' + COMPANY_ORDER.map(c => COMPANY_PRODUCTS[c].label).join(',') + ',Max,Title'];
  for (const p of patentAggs) {
    const scores = COMPANY_ORDER.map(c => {
      const s = p.companyScores.get(c);
      return s !== undefined ? s.toFixed(3) : '';
    });
    csvLines.push(`${p.patentId},${scores.join(',')},${p.maxScore.toFixed(3)},${csvEscape(p.title)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'network-switching-patent-company-matrix.csv'), csvLines.join('\n'));
  console.log(`Written: network-switching-patent-company-matrix.csv`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
