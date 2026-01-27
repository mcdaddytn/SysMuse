/**
 * Portfolio Tier Analysis
 *
 * Ranks all patents by pre-screening score, breaks into tiers (5K each),
 * and reports key metrics per tier: years remaining, citations, affiliate
 * breakdown, enrichment coverage, and super-sector distribution.
 *
 * Run periodically to validate enrichment priorities and coverage.
 *
 * Usage:
 *   npx tsx scripts/portfolio-tier-analysis.ts
 *   npx tsx scripts/portfolio-tier-analysis.ts --tier-size 3000
 *   npx tsx scripts/portfolio-tier-analysis.ts --json
 */

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const CACHE_DIR = path.join(process.cwd(), 'cache');

// ─────────────────────────────────────────────────────────────────────────────
// Data Loading
// ─────────────────────────────────────────────────────────────────────────────

function loadLatestFile(prefix: string): any {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) throw new Error(`No ${prefix}* file found in output/`);
  return JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, files[0]), 'utf-8'));
}

function loadCandidates(): any[] {
  return loadLatestFile('streaming-candidates-').candidates;
}

function loadClassifications(): Map<string, any> {
  const data = loadLatestFile('citation-classification-');
  const map = new Map<string, any>();
  for (const r of data.results) map.set(r.patent_id, r);
  return map;
}

function getCacheSet(dir: string): Set<string> {
  const fullPath = path.join(CACHE_DIR, dir);
  if (!fs.existsSync(fullPath)) return new Set();
  return new Set(
    fs.readdirSync(fullPath)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
  );
}

function loadAffiliateConfig(): { name: string; patterns: string[] }[] {
  const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'config/portfolio-affiliates.json'), 'utf-8')
  );
  return Object.entries(config.affiliates).map(([key, val]: [string, any]) => ({
    name: key,
    patterns: (val.patterns || []).map((p: string) => p.toLowerCase()),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring (same as enrichment scripts)
// ─────────────────────────────────────────────────────────────────────────────

function simpleScore(candidate: any, classification: any): number {
  const cc = classification?.competitor_citations ?? 0;
  const fc = candidate.forward_citations ?? 0;
  const years = candidate.remaining_years ?? 0;
  const count = classification?.competitor_count ?? 0;

  const ccNorm = Math.min(1, cc / 20);
  const fcNorm = Math.min(1, Math.sqrt(fc) / 30);
  const yearsNorm = Math.min(1, years / 15);
  const countNorm = Math.min(1, count / 5);

  const score = ccNorm * 0.40 + fcNorm * 0.20 + yearsNorm * 0.27 + countNorm * 0.13;
  const yearMult = 0.3 + 0.7 * Math.pow(Math.min(1, Math.max(0, years) / 15), 0.8);
  return score * yearMult * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Affiliate Resolution
// ─────────────────────────────────────────────────────────────────────────────

function resolveAffiliate(assignee: string, affiliates: { name: string; patterns: string[] }[]): string {
  const lower = (assignee || '').toLowerCase();
  for (const aff of affiliates) {
    for (const pat of aff.patterns) {
      if (lower.includes(pat)) return aff.name;
    }
  }
  return 'Unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface TierStats {
  tierLabel: string;
  count: number;
  scoreRange: string;
  expired: number;
  active3yr: number;
  yearsRemaining: { avg: number; min: number; max: number; median: number };
  forwardCitations: { avg: number; min: number; max: number; median: number; total: number };
  competitorCitations: { avg: number; min: number; max: number; total: number };
  affiliateCitations: { avg: number; total: number };
  neutralCitations: { avg: number; total: number };
  competitorCount: { avg: number; max: number };
  enrichment: {
    llm: number; llmPct: string;
    prosecution: number; prosecutionPct: string;
    ipr: number; iprPct: string;
    family: number; familyPct: string;
  };
  affiliateBreakdown: { name: string; count: number; pct: string }[];
  superSectorBreakdown: { name: string; count: number; pct: string }[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeTierStats(
  tierLabel: string,
  patents: any[],
  classifications: Map<string, any>,
  affiliates: { name: string; patterns: string[] }[],
  llmSet: Set<string>,
  prosSet: Set<string>,
  iprSet: Set<string>,
  familySet: Set<string>,
): TierStats {
  const years = patents.map(p => p.remaining_years ?? 0);
  const fc = patents.map(p => p.forward_citations ?? 0);
  const cc = patents.map(p => classifications.get(p.patent_id)?.competitor_citations ?? 0);
  const ac = patents.map(p => classifications.get(p.patent_id)?.affiliate_citations ?? 0);
  const nc = patents.map(p => classifications.get(p.patent_id)?.neutral_citations ?? 0);
  const ccCount = patents.map(p => classifications.get(p.patent_id)?.competitor_count ?? 0);

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
  const avg = (arr: number[]) => arr.length ? sum(arr) / arr.length : 0;

  const expired = patents.filter(p => (p.remaining_years ?? 0) <= 0).length;
  const active3yr = patents.filter(p => (p.remaining_years ?? 0) >= 3).length;

  // Enrichment coverage
  const ids = patents.map(p => p.patent_id);
  const llm = ids.filter(id => llmSet.has(id)).length;
  const pros = ids.filter(id => prosSet.has(id)).length;
  const ipr = ids.filter(id => iprSet.has(id)).length;
  const family = ids.filter(id => familySet.has(id)).length;

  // Affiliate breakdown
  const affCounts = new Map<string, number>();
  for (const p of patents) {
    const aff = resolveAffiliate(p.assignee, affiliates);
    affCounts.set(aff, (affCounts.get(aff) || 0) + 1);
  }
  const affiliateBreakdown = [...affCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: (count / patents.length * 100).toFixed(1) + '%' }));

  // Super-sector breakdown
  const ssCounts = new Map<string, number>();
  for (const p of patents) {
    const ss = p.super_sector || 'Unknown';
    ssCounts.set(ss, (ssCounts.get(ss) || 0) + 1);
  }
  const superSectorBreakdown = [...ssCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, pct: (count / patents.length * 100).toFixed(1) + '%' }));

  const scores = patents.map(p => p._score ?? 0);

  return {
    tierLabel,
    count: patents.length,
    scoreRange: `${scores[scores.length - 1]?.toFixed(1) ?? '?'} – ${scores[0]?.toFixed(1) ?? '?'}`,
    expired,
    active3yr,
    yearsRemaining: { avg: +avg(years).toFixed(1), min: +Math.min(...years).toFixed(1), max: +Math.max(...years).toFixed(1), median: +median(years).toFixed(1) },
    forwardCitations: { avg: +avg(fc).toFixed(1), min: Math.min(...fc), max: Math.max(...fc), median: +median(fc).toFixed(0), total: sum(fc) },
    competitorCitations: { avg: +avg(cc).toFixed(1), min: Math.min(...cc), max: Math.max(...cc), total: sum(cc) },
    affiliateCitations: { avg: +avg(ac).toFixed(1), total: sum(ac) },
    neutralCitations: { avg: +avg(nc).toFixed(1), total: sum(nc) },
    competitorCount: { avg: +avg(ccCount).toFixed(1), max: Math.max(...ccCount) },
    enrichment: {
      llm, llmPct: (llm / patents.length * 100).toFixed(1) + '%',
      prosecution: pros, prosecutionPct: (pros / patents.length * 100).toFixed(1) + '%',
      ipr, iprPct: (ipr / patents.length * 100).toFixed(1) + '%',
      family, familyPct: (family / patents.length * 100).toFixed(1) + '%',
    },
    affiliateBreakdown,
    superSectorBreakdown,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output Formatting
// ─────────────────────────────────────────────────────────────────────────────

function padR(s: string, n: number): string { return s + ' '.repeat(Math.max(0, n - s.length)); }
function padL(s: string, n: number): string { return ' '.repeat(Math.max(0, n - s.length)) + s; }

function printTierTable(tiers: TierStats[]) {
  const cols = ['Metric', ...tiers.map(t => t.tierLabel)];
  const W = [30, ...tiers.map(() => 16)];

  function row(label: string, values: string[]) {
    const cells = [padR(label, W[0]), ...values.map((v, i) => padL(v, W[i + 1]))];
    console.log('  ' + cells.join(' │ '));
  }

  function sep() {
    console.log('  ' + W.map(w => '─'.repeat(w)).join('─┼─'));
  }

  console.log('');
  row('', cols.slice(1));
  sep();
  row('Patents', tiers.map(t => t.count.toLocaleString()));
  row('Score Range', tiers.map(t => t.scoreRange));
  sep();
  row('Expired (≤0 yr)', tiers.map(t => `${t.expired} (${(t.expired / t.count * 100).toFixed(0)}%)`));
  row('Active 3yr+', tiers.map(t => `${t.active3yr} (${(t.active3yr / t.count * 100).toFixed(0)}%)`));
  row('Avg Years Left', tiers.map(t => t.yearsRemaining.avg.toString()));
  row('Median Years Left', tiers.map(t => t.yearsRemaining.median.toString()));
  sep();
  row('Avg Forward Cites', tiers.map(t => t.forwardCitations.avg.toString()));
  row('Median Forward Cites', tiers.map(t => t.forwardCitations.median.toString()));
  row('Max Forward Cites', tiers.map(t => t.forwardCitations.max.toLocaleString()));
  row('Avg Competitor Cites', tiers.map(t => t.competitorCitations.avg.toString()));
  row('Avg Affiliate Cites', tiers.map(t => t.affiliateCitations.avg.toString()));
  row('Avg Neutral Cites', tiers.map(t => t.neutralCitations.avg.toString()));
  row('Avg Competitor Cos.', tiers.map(t => t.competitorCount.avg.toString()));
  sep();
  row('LLM Coverage', tiers.map(t => `${t.enrichment.llm} (${t.enrichment.llmPct})`));
  row('Prosecution Coverage', tiers.map(t => `${t.enrichment.prosecution} (${t.enrichment.prosecutionPct})`));
  row('IPR Coverage', tiers.map(t => `${t.enrichment.ipr} (${t.enrichment.iprPct})`));
  row('Family Coverage', tiers.map(t => `${t.enrichment.family} (${t.enrichment.familyPct})`));

  // Affiliate breakdown
  console.log('\n  AFFILIATE BREAKDOWN');
  sep();
  const allAffNames = [...new Set(tiers.flatMap(t => t.affiliateBreakdown.map(a => a.name)))];
  // Sort by total count across tiers
  allAffNames.sort((a, b) => {
    const totalA = tiers.reduce((s, t) => s + (t.affiliateBreakdown.find(x => x.name === a)?.count || 0), 0);
    const totalB = tiers.reduce((s, t) => s + (t.affiliateBreakdown.find(x => x.name === b)?.count || 0), 0);
    return totalB - totalA;
  });
  for (const name of allAffNames) {
    row(name, tiers.map(t => {
      const entry = t.affiliateBreakdown.find(a => a.name === name);
      return entry ? `${entry.count} (${entry.pct})` : '0';
    }));
  }

  // Super-sector breakdown (top 10)
  console.log('\n  SUPER-SECTOR BREAKDOWN');
  sep();
  const allSSNames = [...new Set(tiers.flatMap(t => t.superSectorBreakdown.map(a => a.name)))];
  allSSNames.sort((a, b) => {
    const totalA = tiers.reduce((s, t) => s + (t.superSectorBreakdown.find(x => x.name === a)?.count || 0), 0);
    const totalB = tiers.reduce((s, t) => s + (t.superSectorBreakdown.find(x => x.name === b)?.count || 0), 0);
    return totalB - totalA;
  });
  for (const name of allSSNames) {
    row(name, tiers.map(t => {
      const entry = t.superSectorBreakdown.find(a => a.name === name);
      return entry ? `${entry.count} (${entry.pct})` : '0';
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const tierSizeIdx = args.indexOf('--tier-size');
  const tierSize = tierSizeIdx !== -1 ? parseInt(args[tierSizeIdx + 1] || '5000') : 5000;
  const jsonOutput = args.includes('--json');

  console.log('═'.repeat(70));
  console.log('  PORTFOLIO TIER ANALYSIS');
  console.log('═'.repeat(70));
  console.log(`  Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`  Tier Size: ${tierSize.toLocaleString()}`);

  // Load data
  console.log('\n  Loading data...');
  const candidates = loadCandidates();
  const classifications = loadClassifications();
  const affiliates = loadAffiliateConfig();

  // Load enrichment cache sets
  const llmSet = getCacheSet('llm-scores');
  const prosSet = getCacheSet('prosecution-scores');
  const iprSet = getCacheSet('ipr-scores');
  const familySet = getCacheSet('patent-families/parents');

  console.log(`  ${candidates.length.toLocaleString()} patents loaded`);
  console.log(`  ${classifications.size.toLocaleString()} citation classifications`);
  console.log(`  Enrichment: LLM=${llmSet.size} | Prosecution=${prosSet.size} | IPR=${iprSet.size} | Family=${familySet.size}`);

  // Score and sort all patents
  const scored = candidates
    .map(c => ({
      ...c,
      _score: simpleScore(c, classifications.get(c.patent_id)),
    }))
    .sort((a, b) => b._score - a._score);

  // Break into tiers
  const tiers: TierStats[] = [];
  for (let i = 0; i < scored.length; i += tierSize) {
    const tierPatents = scored.slice(i, i + tierSize);
    const tierNum = Math.floor(i / tierSize) + 1;
    const start = i + 1;
    const end = Math.min(i + tierSize, scored.length);
    const label = `Tier ${tierNum} (${start.toLocaleString()}–${end.toLocaleString()})`;

    tiers.push(computeTierStats(label, tierPatents, classifications, affiliates, llmSet, prosSet, iprSet, familySet));
  }

  if (jsonOutput) {
    const outPath = path.join(OUTPUT_DIR, `tier-analysis-${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(outPath, JSON.stringify({ date: new Date().toISOString(), tierSize, tiers }, null, 2));
    console.log(`\n  JSON saved to: ${outPath}`);
  } else {
    printTierTable(tiers);
  }

  // Summary line
  console.log('\n' + '═'.repeat(70));
  const totalExpired = tiers.reduce((s, t) => s + t.expired, 0);
  const totalActive3yr = tiers.reduce((s, t) => s + t.active3yr, 0);
  console.log(`  Total: ${scored.length.toLocaleString()} patents | ${totalExpired.toLocaleString()} expired | ${totalActive3yr.toLocaleString()} active 3yr+`);
  console.log(`  Enrichment totals: LLM=${llmSet.size} | Prosecution=${prosSet.size} | IPR=${iprSet.size} | Family=${familySet.size}`);
  console.log('═'.repeat(70));
}

main();
