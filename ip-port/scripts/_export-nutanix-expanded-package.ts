/**
 * Export Nutanix Expanded V3 Discovery Package
 *
 * Generates the full vendor package for the 189-patent expanded pool:
 *   - Infringement heatmap (markdown + CSVs) for all 189 patents
 *   - Per-patent LLM assessment for NEW patents (102)
 *   - Collective strategy across all 189 patents
 *   - Full comparative exports with NEW/EXISTING flags
 *
 * Usage:
 *   npx tsx scripts/_export-nutanix-expanded-package.ts                   # Full run (LLM + export)
 *   npx tsx scripts/_export-nutanix-expanded-package.ts --heatmap-only    # Just heatmap + CSVs
 *   npx tsx scripts/_export-nutanix-expanded-package.ts --export-only     # Export from cached LLM results
 *   npx tsx scripts/_export-nutanix-expanded-package.ts --skip-llm        # Heatmap + export, no LLM
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { generateLitigationPackageCsv } from '../src/api/services/litigation-export-service.js';

const prisma = new PrismaClient();

const FOCUS_AREA_NAME = 'Nutanix V3 Expanded Discovery';
const V3_SNAPSHOT_ID = 'cmo0og0u400018ct6s6322wuc';

const PRODUCTS = [
  { slug: 'nutanix-ahv', label: 'Nutanix AHV', short: 'AHV' },
  { slug: 'flow-network-security', label: 'Flow Network Security', short: 'FNS' },
  { slug: 'flow-virtual-networking', label: 'Flow Virtual Networking', short: 'FVN' },
  { slug: 'nutanix-cloud-infrastructure-nci', label: 'Nutanix Cloud Infrastructure (NCI)', short: 'NCI' },
  { slug: 'nutanix-prism-central', label: 'Prism Central', short: 'Prism' },
];

const SCORES_DIR = path.resolve('./cache/infringement-scores/nutanix');

const BROADCOM_AFFILIATES = [
  'Broadcom', 'Avago', 'VMware', 'Symantec', 'CA Technologies',
  'Carbon Black', 'Nicira', 'VeloCloud', 'Blue Coat', 'Brocade',
  'LSI', 'Pivotal', 'Heptio', 'Emulex', 'NetLogic', 'PLX Technology',
  'SandForce', 'Lastline', 'Nyansa', 'Avi Networks', 'Agere',
  'CloudHealth', 'Cyoptics', 'AirWatch', 'Foundry Networks',
];
const AFFILIATE_PATTERN = new RegExp(
  BROADCOM_AFFILIATES.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i'
);

const ASSESSMENT_QUESTIONS = [
  {
    fieldName: 'infringement_detectability',
    question: 'How easily can infringement of this patent be detected by analyzing Nutanix products WITHOUT internal product access? Consider: Can you detect use from Nutanix product datasheets, the Nutanix Bible, published specifications, or Nutanix documentation? Score 1=requires internal access, 5=detectable via careful external analysis, 10=obvious from Nutanix product specifications.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_strength',
    question: 'How well do the independent claims map to known Nutanix product implementations (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central)? Consider the claim elements and whether each element can be identified in Nutanix products. Score 1=poor mapping, 5=partial mapping, 10=strong mapping (all elements clearly present in Nutanix products).',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'claim_mapping_summary',
    question: 'Which specific claim elements map to which Nutanix products or product features? Identify the broadest independent claim and map each element to concrete Nutanix implementations. Be specific about which Nutanix products (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central) implement each element.',
    answerType: 'text'
  },
  {
    fieldName: 'standards_alignment',
    question: 'Which specific industry standards does this patent\'s technology map to? Consider relevant standards bodies and specifications. List specific standard references. If not standards-related, state \'Not standards-essential\'.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_products',
    question: 'List specific Nutanix products or product features that likely implement this patented technology. Focus on: Nutanix AHV (KVM/QEMU hypervisor, Open vSwitch, OVN, live migration, memory overcommit), Nutanix Cloud Infrastructure (NCI), Flow Virtual Networking (VPC, Geneve tunneling, BGP routing, virtual routers), Flow Network Security (microsegmentation, OVS/OpenFlow policies), Prism Central (management plane). Be specific about which features or subsystems overlap.',
    answerType: 'text_array'
  },
  {
    fieldName: 'target_companies',
    question: 'Is Nutanix the primary assertion target for this patent? Also list any other companies whose products implement similar technology. IMPORTANT: Do NOT list Broadcom or any Broadcom subsidiary/affiliate (VMware, Symantec, CA Technologies, Carbon Black, Nicira, VeloCloud, Blue Coat, Brocade, LSI, Avago, Pivotal, Heptio, Emulex, NetLogic, PLX Technology, SandForce, Lastline, Nyansa, Avi Networks, Agere, CloudHealth, Cyoptics, AirWatch, Marvell). List Nutanix first, then other companies that may also infringe.',
    answerType: 'text_array'
  },
  {
    fieldName: 'prior_art_risk',
    question: 'How vulnerable is this patent to prior art challenge or IPR? Score 1=highly vulnerable, 5=moderate risk, 10=very defensible. Consider the filing date, breadth of claims, and likelihood of invalidation.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  },
  {
    fieldName: 'prosecution_risk',
    question: 'Are there prosecution history estoppel concerns, claim construction risks, or other prosecution-related vulnerabilities?',
    answerType: 'text'
  },
  {
    fieldName: 'assertion_strategy',
    question: 'What is the recommended assertion approach against Nutanix? Choose: DIRECT (standard infringement suit), SEP_FRAND (standards-essential with FRAND obligations), CROSS_LICENSE (leverage in cross-licensing), DEFENSIVE (hold, not for assertion).',
    answerType: 'enum',
    constraints: { options: ['DIRECT', 'SEP_FRAND', 'CROSS_LICENSE', 'DEFENSIVE'] }
  },
  {
    fieldName: 'overall_litigation_score',
    question: 'Considering all factors — detectability against Nutanix products, claim mapping to AHV/NCI/Flow/Prism, prior art risk, target market size, and assertion strategy — rate the overall litigation potential against Nutanix. Score 1=not recommended, 5=moderate potential, 10=excellent litigation candidate.',
    answerType: 'numeric',
    constraints: { min: 1, max: 10 }
  }
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function escapeCSV(value: string | number | boolean | null | undefined): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(escapeCSV).join(',');
}

async function resilientFetch(url: string, options?: RequestInit, maxRetries = 5): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(5000 * attempt, 30000);
      console.log(`  [Retry ${attempt}/${maxRetries}] fetch failed (${err.code || err.message}), waiting ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

interface InfringementScore {
  patentId: string;
  productSlug: string;
  finalScore: number;
  documentName: string;
  narrative: string | null;
  strongestClaim: string | null;
  keyGaps: string[] | null;
  pass1: any;
  pass2: any;
}

function loadAllInfringementScores(patentIds: Set<string>): InfringementScore[] {
  const entries: InfringementScore[] = [];
  for (const prod of PRODUCTS) {
    const dir = path.join(SCORES_DIR, prod.slug);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      const patentId = file.replace('.json', '');
      if (!patentIds.has(patentId)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        entries.push({
          patentId,
          productSlug: prod.slug,
          finalScore: data.finalScore ?? data.pass1?.compositeScore ?? 0,
          documentName: data.documentName || '',
          narrative: data.narrative || null,
          strongestClaim: data.strongestClaim || null,
          keyGaps: data.keyGaps || null,
          pass1: data.pass1,
          pass2: data.pass2,
        });
      } catch { /* skip */ }
    }
  }
  return entries;
}

// ─── Types ────────────────────────────────────────────────────────────────

interface PatentAgg {
  patentId: string;
  title: string;
  isNew: boolean;
  v3Score: number;
  maxInfScore: number;
  productScores: Map<string, number>;
  productHits: number;
  bestProduct: string;
  bestNarrative: string | null;
  strongestClaim: string | null;
  compositeRank: number;
}

// ─── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const heatmapOnly = args.includes('--heatmap-only');
const exportOnly = args.includes('--export-only');
const skipLlm = args.includes('--skip-llm');

async function main() {
  console.log('\n=== Nutanix Expanded V3 Package Export ===\n');

  // Load pool data
  const pool = JSON.parse(fs.readFileSync('output/nutanix-expanded-pool.json', 'utf-8'));
  const existingIds = new Set<string>(pool.existing_ids);
  const newIds = new Set<string>(pool.new_ids);
  const allIds = new Set<string>([...existingIds, ...newIds]);
  console.log(`Pool: ${existingIds.size} existing + ${newIds.size} new = ${allIds.size} total`);

  // Load V3 scores
  const v3Entries = await prisma.patentScoreEntry.findMany({
    where: { snapshotId: V3_SNAPSHOT_ID, patentId: { in: [...allIds] } },
  });
  const v3Map = new Map(v3Entries.map(e => [e.patentId, e.score]));
  console.log(`V3 scores loaded: ${v3Map.size}`);

  // Load patent metadata
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: [...allIds] } },
    select: {
      patentId: true, title: true, assignee: true, abstract: true,
      primarySector: true, superSector: true, baseScore: true,
      forwardCitations: true, remainingYears: true,
    },
  });
  const patentMeta = new Map(patents.map(p => [p.patentId, p]));

  // Load infringement scores
  const infScores = loadAllInfringementScores(allIds);
  console.log(`Infringement score entries: ${infScores.length}`);

  // Build patent × product matrix (best score per patent-product pair)
  const matrix = new Map<string, Map<string, InfringementScore>>();
  for (const s of infScores) {
    if (!matrix.has(s.patentId)) matrix.set(s.patentId, new Map());
    const existing = matrix.get(s.patentId)!.get(s.productSlug);
    if (!existing || s.finalScore > existing.finalScore) {
      matrix.get(s.patentId)!.set(s.productSlug, s);
    }
  }

  // Build patent aggregates
  const patentAggs: PatentAgg[] = [];
  for (const patentId of allIds) {
    const meta = patentMeta.get(patentId);
    const productMap = matrix.get(patentId) || new Map();
    let maxScore = 0;
    let bestProduct = '';
    let bestNarrative: string | null = null;
    let strongestClaim: string | null = null;
    const productScores = new Map<string, number>();
    let hits = 0;

    for (const [prod, entry] of productMap) {
      productScores.set(prod, entry.finalScore);
      if (entry.finalScore > maxScore) {
        maxScore = entry.finalScore;
        bestProduct = PRODUCTS.find(p => p.slug === prod)?.label || prod;
        bestNarrative = entry.narrative;
        strongestClaim = entry.strongestClaim;
      }
      if (entry.finalScore >= 0.50) hits++;
    }

    patentAggs.push({
      patentId,
      title: meta?.title || '',
      isNew: newIds.has(patentId),
      v3Score: v3Map.get(patentId) || 0,
      maxInfScore: maxScore,
      productScores,
      productHits: hits,
      bestProduct,
      bestNarrative,
      strongestClaim,
      compositeRank: 0,
    });
  }

  // Sort by composite: 60% infringement max + 40% V3 normalized
  const maxV3 = Math.max(...patentAggs.map(p => p.v3Score), 1);
  patentAggs.sort((a, b) => {
    const compA = 0.6 * a.maxInfScore + 0.4 * (a.v3Score / maxV3);
    const compB = 0.6 * b.maxInfScore + 0.4 * (b.v3Score / maxV3);
    return compB - compA;
  });
  patentAggs.forEach((p, i) => p.compositeRank = i + 1);

  // === Output directory ===
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/nutanix-expanded-${date}`);
  fs.mkdirSync(outputDir, { recursive: true });

  // ═══ HEATMAP MARKDOWN ═══
  console.log('\n--- Generating Infringement Heatmap ---');
  const md = generateHeatmapMarkdown(patentAggs, matrix, date);
  fs.writeFileSync(path.join(outputDir, 'nutanix-infringement-heatmap.md'), md);
  console.log(`  nutanix-infringement-heatmap.md (${md.length} chars)`);

  // ═══ PATENT-PRODUCT MATRIX CSV ═══
  const matrixCsv = generateMatrixCsv(patentAggs);
  fs.writeFileSync(path.join(outputDir, 'nutanix-patent-product-matrix.csv'), matrixCsv);
  console.log(`  nutanix-patent-product-matrix.csv (${patentAggs.length} patents)`);

  // ═══ ALL SCORES CSV ═══
  const allScoresCsv = generateAllScoresCsv(infScores, patentAggs);
  fs.writeFileSync(path.join(outputDir, 'nutanix-all-scores.csv'), allScoresCsv);
  console.log(`  nutanix-all-scores.csv (${infScores.length} pairs)`);

  // ═══ COMPARATIVE RANKING CSV ═══
  const rankCsv = generateComparativeRankingCsv(patentAggs);
  fs.writeFileSync(path.join(outputDir, 'nutanix-comparative-ranking.csv'), rankCsv);
  console.log(`  nutanix-comparative-ranking.csv`);

  // ═══ V3 RANKING CSV (copy from existing) ═══
  if (fs.existsSync('output/nutanix-expanded-v3-ranking.csv')) {
    fs.copyFileSync('output/nutanix-expanded-v3-ranking.csv', path.join(outputDir, 'nutanix-v3-ranking.csv'));
    console.log('  nutanix-v3-ranking.csv (copied)');
  }

  if (heatmapOnly) {
    console.log('\n--heatmap-only: Done.');
    await prisma.$disconnect();
    return;
  }

  // ═══ LLM ASSESSMENTS ═══
  const focusArea = await prisma.focusArea.findFirst({ where: { name: FOCUS_AREA_NAME } });
  if (!focusArea) {
    console.error(`Focus area "${FOCUS_AREA_NAME}" not found. Run _create-nutanix-expanded-package.ts first.`);
    await prisma.$disconnect();
    return;
  }
  const focusAreaId = focusArea.id;
  console.log(`\nFocus Area: ${focusArea.name} (${focusAreaId})`);

  if (!skipLlm && !exportOnly) {
    await runLlmAssessments(focusAreaId, allIds, patentAggs);
  }

  // ═══ EXPORT ASSESSMENT RESULTS ═══
  await exportAssessmentResults(focusAreaId, outputDir, patentAggs, v3Map, patentMeta);

  // ═══ LITIGATION PACKAGE ALL-FIELDS EXPORT ═══
  console.log('\n--- Generating Litigation Package All-Fields Export ---');
  try {
    const litResult = await generateLitigationPackageCsv(focusAreaId);
    fs.writeFileSync(path.join(outputDir, 'litigation-package-all-fields-export.csv'), litResult.csv);
    console.log(`  litigation-package-all-fields-export.csv: ${litResult.patentCount} patents, ${litResult.metricKeyCount} metric keys`);
  } catch (err) {
    console.warn('  Warning: Could not generate litigation package CSV:', (err as Error).message);
  }

  // ═══ README ═══
  const readme = generateReadme(patentAggs, date);
  fs.writeFileSync(path.join(outputDir, 'README.md'), readme);
  console.log('  README.md');

  console.log(`\nPackage complete: ${outputDir}`);
  await prisma.$disconnect();
}

// ─── Heatmap Markdown ─────────────────────────────────────────────────────

function generateHeatmapMarkdown(aggs: PatentAgg[], scoreMatrix: Map<string, Map<string, InfringementScore>>, date: string): string {
  const lines: string[] = [];

  // Stats
  const scored = aggs.filter(p => p.maxInfScore > 0);
  const newScored = scored.filter(p => p.isNew);
  const existScored = scored.filter(p => !p.isNew);
  const veryHigh = scored.filter(p => p.maxInfScore >= 0.80);
  const high = scored.filter(p => p.maxInfScore >= 0.65);
  const multiProduct = scored.filter(p => p.productHits >= 3);

  lines.push('# Nutanix Expanded V3 Discovery — Infringement Analysis');
  lines.push('');
  lines.push(`**Generated:** ${date}`);
  lines.push('**Scoring Engine:** internal-v3 (10-component, two-pass)');
  lines.push('**Model:** claude-sonnet-4-20250514');
  lines.push('**V3 Score Preset:** Litigation Discovery (low citation weight)');
  lines.push('');

  lines.push('## Executive Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total patents in pool | ${aggs.length} |`);
  lines.push(`| Existing patents | ${aggs.filter(p => !p.isNew).length} |`);
  lines.push(`| **NEW patents (sector discovery)** | **${aggs.filter(p => p.isNew).length}** |`);
  lines.push(`| Products analyzed | ${PRODUCTS.length} |`);
  lines.push(`| Very-high infringement (>=0.80) | ${veryHigh.length} (${veryHigh.filter(p => p.isNew).length} NEW) |`);
  lines.push(`| High-signal (>=0.65) | ${high.length} (${high.filter(p => p.isNew).length} NEW) |`);
  lines.push(`| Multi-product hits (>=3 at >=0.50) | ${multiProduct.length} (${multiProduct.filter(p => p.isNew).length} NEW) |`);
  lines.push(`| Max infringement score | ${scored[0]?.maxInfScore.toFixed(3) || 'N/A'} |`);
  lines.push('');

  // Top 40 by composite rank
  lines.push('## Top 40 Patents by Composite Score');
  lines.push('');
  lines.push('Composite = 60% infringement max + 40% V3 normalized. **Bold** = NEW patent.');
  lines.push('');
  lines.push(`| Rank | Patent | Status | V3 | ${PRODUCTS.map(p => p.short).join(' | ')} | Max Inf | Best Product |`);
  lines.push(`|------|--------|--------|-----|${PRODUCTS.map(() => '-----').join('|')}|---------|--------------|`);
  for (let i = 0; i < Math.min(40, aggs.length); i++) {
    const p = aggs[i];
    const status = p.isNew ? '**NEW**' : 'exist';
    const cells = PRODUCTS.map(prod => {
      const s = p.productScores.get(prod.slug);
      if (s === undefined) return '-';
      if (s >= 0.80) return `**${s.toFixed(2)}**`;
      return s.toFixed(2);
    });
    const patent = p.isNew ? `**US${p.patentId}**` : `US${p.patentId}`;
    lines.push(`| ${p.compositeRank} | ${patent} | ${status} | ${p.v3Score.toFixed(1)} | ${cells.join(' | ')} | ${p.maxInfScore.toFixed(2)} | ${p.bestProduct} |`);
  }
  lines.push('');

  // NEW patents highlight
  const newHighSignal = aggs.filter(p => p.isNew && p.maxInfScore >= 0.65)
    .sort((a, b) => b.maxInfScore - a.maxInfScore);

  lines.push('## NEW Patent Highlights');
  lines.push('');
  lines.push(`${newHighSignal.length} newly discovered patents with infringement score >= 0.65:`);
  lines.push('');
  if (newHighSignal.length > 0) {
    lines.push(`| Patent | V3 | Max Inf | Products (>=0.50) | Title |`);
    lines.push(`|--------|-----|---------|-------------------|-------|`);
    for (const p of newHighSignal) {
      const prodList = PRODUCTS
        .filter(prod => (p.productScores.get(prod.slug) || 0) >= 0.50)
        .map(prod => `${prod.short}(${p.productScores.get(prod.slug)!.toFixed(2)})`)
        .join(', ');
      const titleTrunc = p.title.length > 55 ? p.title.slice(0, 55) + '...' : p.title;
      lines.push(`| US${p.patentId} | ${p.v3Score.toFixed(1)} | ${p.maxInfScore.toFixed(3)} | ${prodList} | ${titleTrunc} |`);
    }
  }
  lines.push('');

  // Patent × Product Matrix (all >= 0.50)
  lines.push('## Patent × Product Score Matrix');
  lines.push('');
  lines.push('All patents with max infringement score >= 0.50:');
  lines.push('');
  const matrixPatents = aggs.filter(p => p.maxInfScore >= 0.50);
  lines.push(`| Patent | Status | V3 | ${PRODUCTS.map(p => p.short).join(' | ')} | Max |`);
  lines.push(`|--------|--------|-----|${PRODUCTS.map(() => '-----').join('|')}|-----|`);
  for (const p of matrixPatents) {
    const status = p.isNew ? 'NEW' : 'exist';
    const cells = PRODUCTS.map(prod => {
      const s = p.productScores.get(prod.slug);
      if (s === undefined) return '-';
      if (s >= 0.80) return `**${s.toFixed(2)}**`;
      return s.toFixed(2);
    });
    lines.push(`| US${p.patentId} | ${status} | ${p.v3Score.toFixed(1)} | ${cells.join(' | ')} | ${p.maxInfScore.toFixed(2)} |`);
  }
  lines.push('');

  // Per-product breakdown
  for (const prod of PRODUCTS) {
    lines.push(`### ${prod.label}`);
    lines.push('');
    const productScores = aggs
      .filter(p => p.productScores.has(prod.slug))
      .map(p => ({ patentId: p.patentId, isNew: p.isNew, score: p.productScores.get(prod.slug)!, entry: scoreMatrix.get(p.patentId)?.get(prod.slug) }))
      .sort((a, b) => b.score - a.score);

    const highScores = productScores.filter(s => s.score >= 0.50);
    lines.push(`**Scored pairs:** ${productScores.length} | **High-signal (>=0.50):** ${highScores.length}`);
    lines.push('');

    if (highScores.length > 0) {
      lines.push('| Patent | Status | Score | Document | Narrative (excerpt) |');
      lines.push('|--------|--------|-------|----------|---------------------|');
      for (const s of highScores) {
        const status = s.isNew ? '**NEW**' : 'exist';
        const docTrunc = (s.entry?.documentName || '').substring(0, 40);
        const narrTrunc = s.entry?.narrative
          ? (s.entry.narrative.length > 100 ? s.entry.narrative.slice(0, 100) + '...' : s.entry.narrative)
          : '';
        lines.push(`| US${s.patentId} | ${status} | ${s.score.toFixed(3)} | ${docTrunc} | ${narrTrunc} |`);
      }
    } else {
      lines.push('No patents scored >= 0.50 for this product.');
    }
    lines.push('');
  }

  // Strategic tiers
  lines.push('## Strategic Tiers');
  lines.push('');

  const tier1 = aggs.filter(p => p.maxInfScore >= 0.85);
  const tier2 = aggs.filter(p => p.maxInfScore >= 0.70 && p.maxInfScore < 0.85);
  const tier3 = aggs.filter(p => p.maxInfScore >= 0.50 && p.maxInfScore < 0.70);

  lines.push(`### Tier 1: Immediate Priority (>=0.85) — ${tier1.length} patents (${tier1.filter(p => p.isNew).length} NEW)`);
  lines.push('');
  for (const p of tier1) {
    const flag = p.isNew ? ' 🆕' : '';
    const prodList = PRODUCTS
      .filter(prod => (p.productScores.get(prod.slug) || 0) >= 0.50)
      .map(prod => `${prod.short}: ${p.productScores.get(prod.slug)!.toFixed(2)}`)
      .join(', ');
    lines.push(`- **US${p.patentId}** (${p.maxInfScore.toFixed(3)}, V3=${p.v3Score.toFixed(1)})${flag} — ${p.title}`);
    lines.push(`  - Products: ${prodList}`);
    if (p.bestNarrative) {
      lines.push(`  - ${p.bestNarrative.substring(0, 200)}`);
    }
  }
  lines.push('');

  lines.push(`### Tier 2: Strong Candidates (0.70–0.85) — ${tier2.length} patents (${tier2.filter(p => p.isNew).length} NEW)`);
  lines.push('');
  for (const p of tier2) {
    const flag = p.isNew ? ' 🆕' : '';
    lines.push(`- **US${p.patentId}** (${p.maxInfScore.toFixed(3)}, V3=${p.v3Score.toFixed(1)})${flag} — ${p.title}`);
  }
  lines.push('');

  lines.push(`### Tier 3: Monitoring (0.50–0.70) — ${tier3.length} patents (${tier3.filter(p => p.isNew).length} NEW)`);
  lines.push('');
  for (const p of tier3) {
    const flag = p.isNew ? ' 🆕' : '';
    lines.push(`- **US${p.patentId}** (${p.maxInfScore.toFixed(3)}, V3=${p.v3Score.toFixed(1)})${flag} — ${p.title}`);
  }
  lines.push('');

  // Cross-product coverage
  lines.push('### Cross-Product Coverage');
  lines.push('');
  lines.push('Patents with infringement signals across multiple Nutanix products:');
  lines.push('');
  const crossProduct = aggs
    .filter(p => p.productHits >= 2)
    .sort((a, b) => b.productHits - a.productHits || b.maxInfScore - a.maxInfScore);

  lines.push('| Patent | Status | Hit Count | Products |');
  lines.push('|--------|--------|-----------|----------|');
  for (const p of crossProduct) {
    const status = p.isNew ? 'NEW' : 'exist';
    const prodList = PRODUCTS
      .filter(prod => (p.productScores.get(prod.slug) || 0) >= 0.50)
      .sort((a, b) => (p.productScores.get(b.slug) || 0) - (p.productScores.get(a.slug) || 0))
      .map(prod => `${prod.short} (${p.productScores.get(prod.slug)!.toFixed(2)})`)
      .join(', ');
    lines.push(`| US${p.patentId} | ${status} | ${p.productHits}/${PRODUCTS.length} | ${prodList} |`);
  }
  lines.push('');

  // Methodology
  lines.push('## Methodology');
  lines.push('');
  lines.push('### Infringement Scoring Engine (internal-v3)');
  lines.push('');
  lines.push('- **Pass 0 (Summary Screening):** Patent claims vs product summary → quick filter');
  lines.push('- **Pass 1 (Screening):** Patent claims + 15K doc chars → 10 component scores (1-5 scale)');
  lines.push('- **Pass 2 (Deep):** All independent claims + full document → 10 component scores');
  lines.push('- **Final:** 0.3 × Pass 1 + 0.7 × Pass 2');
  lines.push('');
  lines.push('### V3 Litigation Discovery Scoring');
  lines.push('');
  lines.push('Weights emphasize LLM quality signals (~78%) with minimal citation weight (~3%):');
  lines.push('eligibility 18%, validity 15%, enforcement_clarity 15%, design_around_difficulty 13%, claim_breadth 12%, years_remaining 12%, market_relevance 5%, ipr_risk 4%, prosecution_quality 3%, adjusted_forward_citations 2%, competitor_citations 1%');
  lines.push('');

  return lines.join('\n');
}

// ─── CSV Generators ───────────────────────────────────────────────────────

function generateMatrixCsv(aggs: PatentAgg[]): string {
  const headers = ['PatentId', 'Status', 'V3_Score', ...PRODUCTS.map(p => p.label), 'Max_Inf', 'Product_Hits', 'Composite_Rank'];
  const rows = [headers.join(',')];
  for (const p of aggs) {
    const scores = PRODUCTS.map(prod => {
      const s = p.productScores.get(prod.slug);
      return s !== undefined ? s.toFixed(3) : '';
    });
    rows.push(csvRow([
      p.patentId, p.isNew ? 'NEW' : 'EXISTING', p.v3Score.toFixed(2),
      ...scores, p.maxInfScore.toFixed(3), p.productHits, p.compositeRank,
    ]));
  }
  return rows.join('\n');
}

function generateAllScoresCsv(scores: InfringementScore[], aggs: PatentAgg[]): string {
  const aggMap = new Map(aggs.map(a => [a.patentId, a]));
  const headers = ['PatentId', 'Status', 'Product', 'FinalScore', 'V3_Score', 'Document', 'StrongestClaim', 'Narrative'];
  const rows = [headers.join(',')];
  const sorted = [...scores].sort((a, b) => b.finalScore - a.finalScore);
  for (const s of sorted) {
    const agg = aggMap.get(s.patentId);
    const prodLabel = PRODUCTS.find(p => p.slug === s.productSlug)?.label || s.productSlug;
    rows.push(csvRow([
      s.patentId, agg?.isNew ? 'NEW' : 'EXISTING', prodLabel,
      s.finalScore.toFixed(3), agg?.v3Score.toFixed(2) || '',
      s.documentName, s.strongestClaim || '', s.narrative?.substring(0, 300) || '',
    ]));
  }
  return rows.join('\n');
}

function generateComparativeRankingCsv(aggs: PatentAgg[]): string {
  const headers = [
    'Composite_Rank', 'PatentId', 'Status', 'V3_Score', 'Max_Inf_Score',
    'Product_Hits', 'Best_Product', 'Title',
    ...PRODUCTS.map(p => `Inf_${p.short}`),
  ];
  const rows = [headers.join(',')];
  for (const p of aggs) {
    const prodScores = PRODUCTS.map(prod => {
      const s = p.productScores.get(prod.slug);
      return s !== undefined ? s.toFixed(3) : '';
    });
    rows.push(csvRow([
      p.compositeRank, p.patentId, p.isNew ? 'NEW' : 'EXISTING',
      p.v3Score.toFixed(2), p.maxInfScore.toFixed(3),
      p.productHits, p.bestProduct, p.title,
      ...prodScores,
    ]));
  }
  return rows.join('\n');
}

// ─── LLM Assessments ─────────────────────────────────────────────────────

async function runLlmAssessments(focusAreaId: string, allIds: Set<string>, aggs: PatentAgg[]) {
  console.log('\n--- Running LLM Assessments ---');

  // Check for existing templates
  let assessTemplate = await prisma.promptTemplate.findFirst({
    where: { focusAreaId, executionMode: 'PER_PATENT' },
  });

  if (!assessTemplate) {
    assessTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: 'Nutanix Expanded — Litigation Assessment',
        description: `Per-patent assessment for ${allIds.size} patents`,
        templateType: 'STRUCTURED',
        executionMode: 'PER_PATENT',
        questions: ASSESSMENT_QUESTIONS,
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: allIds.size,
      },
    });
    console.log(`  Created assessment template: ${assessTemplate.id}`);
  } else {
    console.log(`  Found assessment template: ${assessTemplate.id} (status: ${assessTemplate.status})`);
    if (assessTemplate.status === 'COMPLETE') {
      console.log('  Assessment already complete, skipping execution.');
    }
  }

  let collectiveTemplate = await prisma.promptTemplate.findFirst({
    where: { focusAreaId, executionMode: 'COLLECTIVE' },
  });

  if (!collectiveTemplate) {
    const collectivePrompt = buildCollectivePrompt();
    collectiveTemplate = await prisma.promptTemplate.create({
      data: {
        focusAreaId,
        name: 'Nutanix Expanded — Targeted Assertion Strategy',
        description: `Cross-patent strategy for ${allIds.size} patents`,
        templateType: 'FREE_FORM',
        executionMode: 'COLLECTIVE',
        promptText: collectivePrompt,
        contextFields: ['patent_id', 'title', 'abstract', 'claims', 'grant_date', 'assignee', 'cpc_codes', 'forward_citations', 'competitor_citations', 'competitor_names'],
        llmModel: 'claude-sonnet-4-20250514',
        status: 'DRAFT',
        completedCount: 0,
        totalCount: 1,
      },
    });
    console.log(`  Created collective template: ${collectiveTemplate.id}`);
  } else {
    console.log(`  Found collective template: ${collectiveTemplate.id} (status: ${collectiveTemplate.status})`);
  }

  // Execute assessment if not complete
  if (assessTemplate.status !== 'COMPLETE') {
    // Reset if stuck
    if (assessTemplate.status === 'RUNNING' || assessTemplate.status === 'ERROR') {
      await prisma.promptTemplate.update({
        where: { id: assessTemplate.id },
        data: { status: 'DRAFT' },
      });
    }

    console.log('\n  Executing per-patent assessment...');
    const assessRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${assessTemplate.id}/execute`,
      { method: 'POST' }
    );
    console.log('  Response:', (await assessRes.json() as any).message || 'started');

    // Poll
    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 15000));
      const statusRes = await resilientFetch(
        `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${assessTemplate.id}/status`
      );
      const status = await statusRes.json() as any;
      const pct = status.totalCount > 0 ? ((status.completedCount / status.totalCount) * 100).toFixed(0) : '0';
      process.stdout.write(`\r  Assessment: ${status.completedCount}/${status.totalCount} (${pct}%) - ${status.status}    `);
      if (status.status === 'COMPLETE' || status.status === 'ERROR') {
        done = true;
        console.log('');
        if (status.status === 'ERROR') console.error('  Assessment error:', status.errorMessage);
      }
    }
  }

  // Execute collective if not complete
  if (collectiveTemplate.status !== 'COMPLETE') {
    if (collectiveTemplate.status === 'RUNNING' || collectiveTemplate.status === 'ERROR') {
      await prisma.promptTemplate.update({
        where: { id: collectiveTemplate.id },
        data: { status: 'DRAFT' },
      });
    }

    console.log('\n  Executing collective strategy...');
    const collectRes = await resilientFetch(
      `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/execute`,
      { method: 'POST' }
    );
    console.log('  Response:', (await collectRes.json() as any).message || 'started');

    let done = false;
    while (!done) {
      await new Promise(r => setTimeout(r, 15000));
      const statusRes = await resilientFetch(
        `http://localhost:3001/api/focus-areas/${focusAreaId}/prompt-templates/${collectiveTemplate.id}/status`
      );
      const status = await statusRes.json() as any;
      process.stdout.write(`\r  Collective: ${status.completedCount}/${status.totalCount} - ${status.status}    `);
      if (status.status === 'COMPLETE' || status.status === 'ERROR') {
        done = true;
        console.log('');
        if (status.status === 'ERROR') console.error('  Collective error:', status.errorMessage);
      }
    }
  }
}

function buildCollectivePrompt(): string {
  return `You are a patent litigation strategist analyzing Broadcom's patent portfolio for targeted assertion against Nutanix across their full product line (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central).

Focus Area: <<focusArea.name>>
Description: <<focusArea.description>>
Patent Count: <<focusArea.patentCount>>

CRITICAL INSTRUCTION: You MUST reference ONLY the patents listed below by their exact patent_id. Do NOT invent, fabricate, or hallucinate patent numbers.

Patent data for all <<focusArea.patentCount>> patents in this focus area:
<<focusArea.patentData>>

Produce a comprehensive Nutanix-targeted assertion strategy with:

## 1. Technology Clusters (grouped by Nutanix product overlap)
Group patents by the Nutanix products/features they target. Identify which technology areas have the strongest patent coverage.

## 2. Claim Chain Strategy (5-8 assertion packages of 3-6 patents each)
Design multi-patent packages that create overlapping coverage. Each package should target specific Nutanix products/features.

## 3. Nutanix Product Vulnerability Matrix
For each product (AHV, NCI, Flow Virtual Networking, Flow Network Security, Prism Central), summarize:
- Number of patents with strong infringement signals
- Key technology areas covered
- Strongest individual patents

## 4. Top 25 Patents Ranked by Nutanix Litigation Potential
Rank by combining: claim mapping strength, detectability, defensibility, and product coverage breadth.

## 5. NEW Discovery Highlights
Specifically call out patents discovered in the latest sector analysis that were NOT in the original Nutanix package. Highlight the strongest new additions and what they add.

## 6. Recommended Assertion Strategy (multi-pronged)
## 7. Risk Assessment

Be specific. Reference patents by exact patent_id.`;
}

// ─── Export Assessment Results ─────────────────────────────────────────────

async function exportAssessmentResults(
  focusAreaId: string, outputDir: string,
  aggs: PatentAgg[], v3Map: Map<string, number>,
  patentMeta: Map<string, any>
) {
  console.log('\n--- Exporting Assessment Results ---');

  const templates = await prisma.promptTemplate.findMany({
    where: { focusAreaId },
  });

  const perPatentTemplate = templates.find(t => t.executionMode === 'PER_PATENT');
  const collectiveTemplate = templates.find(t => t.executionMode === 'COLLECTIVE');

  // Export per-patent assessments
  if (perPatentTemplate) {
    const resultDir = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${perPatentTemplate.id}`);
    if (fs.existsSync(resultDir)) {
      const files = fs.readdirSync(resultDir).filter(f => f.endsWith('.json') && f !== '_collective.json');
      console.log(`  Found ${files.length} per-patent assessment results`);

      const assessHeaders = [
        'patent_id', 'status', 'title', 'sector', 'base_score', 'v3_score',
        'max_inf_score', 'composite_rank', 'fwd_citations', 'remaining_years',
        'infringement_detectability', 'claim_mapping_strength',
        'prior_art_risk', 'assertion_strategy', 'overall_litigation_score',
        'target_companies', 'target_products', 'standards_alignment', 'claim_mapping_summary',
      ];
      const assessRows = [assessHeaders.join(',')];

      // Vendor targets
      type TargetEntry = { patentId: string; isNew: boolean; title: string; litScore: string; strategy: string; targets: string[]; notes: string };
      const entries: TargetEntry[] = [];
      let maxTargets = 0;

      const aggMap = new Map(aggs.map(a => [a.patentId, a]));

      for (const file of files) {
        const result = JSON.parse(fs.readFileSync(path.join(resultDir, file), 'utf-8'));
        const data = result.response || result.fields || {};
        const patentId = result.patentId || file.replace('.json', '');
        const meta = patentMeta.get(patentId);
        const agg = aggMap.get(patentId);

        assessRows.push(csvRow([
          patentId, agg?.isNew ? 'NEW' : 'EXISTING',
          meta?.title ?? '', meta?.primarySector ?? '',
          meta?.baseScore ?? '', v3Map.get(patentId)?.toFixed(2) ?? '',
          agg?.maxInfScore.toFixed(3) ?? '', agg?.compositeRank ?? '',
          meta?.forwardCitations ?? '', meta?.remainingYears ?? '',
          data.infringement_detectability ?? '', data.claim_mapping_strength ?? '',
          data.prior_art_risk ?? '', data.assertion_strategy ?? '', data.overall_litigation_score ?? '',
          data.target_companies ?? '', data.target_products ?? '', data.standards_alignment ?? '',
          data.claim_mapping_summary ?? '',
        ]));

        // Parse targets
        const targetStr = (data.target_companies || '') as string;
        const targets = targetStr.split(/,\s*/).map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && !AFFILIATE_PATTERN.test(t))
          .map((t: string) => t.replace(/\s*\(.*$/, '').replace(/\).*$/, '')
            .replace(/\.\s*.*$/, '').replace(/\s*[-–—].*$/, '')
            .replace(/^(Primary|Secondary|Tertiary)\s+targets?:\s*/i, '').trim())
          .filter((t: string) => t.length > 0 && t.length < 50 && !/^(and|or|as|the|with|other|various)\b/i.test(t));
        if (targets.length > maxTargets) maxTargets = targets.length;

        entries.push({
          patentId,
          isNew: agg?.isNew ?? false,
          title: meta?.title ?? '',
          litScore: data.overall_litigation_score ?? '',
          strategy: data.assertion_strategy ?? '',
          targets,
          notes: ((data.target_products || '') as string).substring(0, 200),
        });
      }

      entries.sort((a, b) => Number(b.litScore || 0) - Number(a.litScore || 0));

      // Write assessment CSV
      fs.writeFileSync(path.join(outputDir, 'nutanix-assessment-results.csv'), assessRows.join('\n'));
      console.log(`  nutanix-assessment-results.csv (${files.length} patents)`);

      // Write vendor-targets.csv
      maxTargets = Math.max(maxTargets, 5);
      const targetHeaders = Array.from({ length: maxTargets }, (_, i) => `Target${i + 1}`);
      const vtHeaders = ['PatentId', 'Status', 'Title', 'LitScore', 'Strategy', ...targetHeaders, 'Notes'];
      const vtRows = [vtHeaders.join(',')];
      for (const e of entries) {
        const targetCells = Array.from({ length: maxTargets }, (_, i) => e.targets[i] || '');
        vtRows.push(csvRow([`US${e.patentId}`, e.isNew ? 'NEW' : 'EXISTING', e.title, e.litScore, e.strategy, ...targetCells, e.notes]));
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets.csv'), vtRows.join('\n'));
      console.log(`  vendor-targets.csv (${entries.length} patents)`);

      // Write pivot CSV
      const pivotHeaders = ['PatentId', 'Status', 'LitScore', 'Strategy', 'Target', 'TargetProducts'];
      const pivotRows = [pivotHeaders.join(',')];
      for (const e of entries) {
        for (const target of e.targets) {
          pivotRows.push(csvRow([`US${e.patentId}`, e.isNew ? 'NEW' : 'EXISTING', e.litScore, e.strategy, target, e.notes]));
        }
      }
      fs.writeFileSync(path.join(outputDir, 'vendor-targets-pivot.csv'), pivotRows.join('\n'));
      console.log(`  vendor-targets-pivot.csv (${pivotRows.length - 1} pairs)`);
    } else {
      console.log('  No assessment results found. Run without --export-only to generate.');
    }
  }

  // Write collective strategy
  if (collectiveTemplate) {
    const collectivePath = path.resolve(`./cache/focus-area-prompts/${focusAreaId}/${collectiveTemplate.id}/_collective.json`);
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const content = result.rawText || (typeof result.response === 'string' ? result.response : JSON.stringify(result.response || result, null, 2));
      fs.writeFileSync(path.join(outputDir, 'nutanix-collective-strategy.md'), content);
      console.log('  nutanix-collective-strategy.md');
    } else {
      console.log('  No collective strategy found. Run without --export-only to generate.');
    }
  }
}

// ─── README ───────────────────────────────────────────────────────────────

function generateReadme(aggs: PatentAgg[], date: string): string {
  const newCount = aggs.filter(p => p.isNew).length;
  const existCount = aggs.filter(p => !p.isNew).length;
  const veryHigh = aggs.filter(p => p.maxInfScore >= 0.80);
  const high = aggs.filter(p => p.maxInfScore >= 0.65);

  return `# Nutanix Expanded V3 Discovery Package

**Generated:** ${date}
**Total Patents:** ${aggs.length} (${existCount} existing + ${newCount} newly discovered)

## Package Contents

| File | Description |
|------|-------------|
| litigation-package-all-fields-export.csv | **Full data extract** — all patent metadata, EAV scores, V3 scores, sub-sector metrics with LLM reasoning |
| nutanix-collective-strategy.md | Cross-patent Nutanix-targeted assertion strategy narrative |
| nutanix-assessment-results.csv | Per-patent LLM assessment (detectability, claim mapping, litigation score) |
| vendor-targets.csv | Per-patent litigation targets with companies and products |
| vendor-targets-pivot.csv | One row per patent-target pair with TargetProduct |
| nutanix-infringement-heatmap.md | Full infringement analysis with heat maps, per-product breakdown, strategic tiers |
| nutanix-patent-product-matrix.csv | Patent × Product infringement score matrix |
| nutanix-all-scores.csv | All patent-product-document infringement scores with narratives |
| nutanix-comparative-ranking.csv | Composite ranking (60% infringement + 40% V3) with NEW/EXISTING flags |
| nutanix-v3-ranking.csv | V3 Litigation Discovery score ranking |
| README.md | This file |

## Key Metrics

- Very-high infringement (>=0.80): ${veryHigh.length} patents (${veryHigh.filter(p => p.isNew).length} NEW)
- High-signal (>=0.65): ${high.length} patents (${high.filter(p => p.isNew).length} NEW)
- Products analyzed: ${PRODUCTS.length} (${PRODUCTS.map(p => p.label).join(', ')})

## Scoring Methodology

### V3 Litigation Discovery
Optimized for assertion value with minimal citation weight (~3%). Emphasizes:
- Eligibility (18%), Validity (15%), Enforcement Clarity (15%)
- Design-around Difficulty (13%), Claim Breadth (12%), Years Remaining (12%)

### Infringement Scoring (internal-v3)
Two-pass LLM analysis: Pass 1 screening + Pass 2 deep analysis.
Final = 0.3 × P1 + 0.7 × P2.
10 components including functional alignment, claim element coverage, necessary implication.

### Composite Ranking
60% max infringement score + 40% V3 score (normalized), combining patent quality with infringement signal.
`;
}

// ─── Run ──────────────────────────────────────────────────────────────────

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
