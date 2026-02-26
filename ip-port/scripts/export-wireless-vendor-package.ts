/**
 * Export WIRELESS Vendor Package
 *
 * Produces a self-contained directory of files for litigation vendor handoff:
 *   1. broadcom-wireless-ranked.csv    — All broadcom-core WIRELESS patents ranked by composite score
 *   2. competitor-landscape.csv        — Cross-portfolio comparison by sector
 *   3. top-200-detailed.json           — Top 200 patents with full metric reasoning
 *   4. sector-summary.csv              — 10-row sector summary
 *   5. README.md                       — Package manifest
 *
 * Optional: --include-assessments to append Tier 1 assessment data (Phase 6)
 *
 * Usage: npx tsx scripts/export-wireless-vendor-package.ts [--include-assessments]
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const SUPER_SECTOR = 'WIRELESS';
const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';
const TOP_N = 200;

const WIRELESS_SECTORS = [
  'wireless-transmission',
  'wireless-scheduling',
  'wireless-infrastructure',
  'wireless-power-mgmt',
  'wireless-mobility',
  'wireless-mimo-antenna',
  'rf-acoustic',
  'antennas',
  'radar-sensing',
  'wireless-services',
];

// Competitor portfolios to include in landscape
const COMPETITOR_PORTFOLIOS = [
  'broadcom-core',
  'ericsson',
  'qualcomm',
  'mediatek',
  'marvell',
  'apple',
  'intel',
];

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

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

// ─── Main Export ──────────────────────────────────────────────────────────────

async function main() {
  const includeAssessments = process.argv.includes('--include-assessments');
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/WIRELESS-${date}`);

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`\nOutput directory: ${outputDir}\n`);

  // ── Resolve broadcom-core portfolio ──
  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) throw new Error(`Portfolio "${BROADCOM_PORTFOLIO_NAME}" not found`);

  // ── Get broadcom patent IDs in WIRELESS ──
  const ppRows = await prisma.portfolioPatent.findMany({
    where: {
      portfolioId: portfolio.id,
      patent: { superSector: SUPER_SECTOR, isQuarantined: false },
    },
    select: { patentId: true },
  });
  const broadcomPatentIds = ppRows.map(r => r.patentId);
  console.log(`Broadcom WIRELESS patents: ${broadcomPatentIds.length}`);

  // ── Fetch all scores for these patents (sector + sub-sector templateConfigIds) ──
  const allScores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: broadcomPatentIds } },
    orderBy: { compositeScore: 'desc' },
  });
  console.log(`Total scores fetched: ${allScores.length}`);

  // Deduplicate: keep highest composite score per patent
  const bestByPatent = new Map<string, (typeof allScores)[0]>();
  for (const s of allScores) {
    const existing = bestByPatent.get(s.patentId);
    if (!existing || s.compositeScore > existing.compositeScore) {
      bestByPatent.set(s.patentId, s);
    }
  }
  const scores = [...bestByPatent.values()].sort((a, b) => b.compositeScore - a.compositeScore);
  console.log(`Unique patents with scores: ${scores.length}`);

  // ── Fetch patent data ──
  const scoredPatentIds = [...new Set(scores.map(s => s.patentId))];
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: scoredPatentIds } },
    include: {
      citations: true,
      cpcCodes: { select: { cpcCode: true } },
    },
  });
  const patentMap = new Map(patents.map(p => [p.patentId, p]));
  console.log(`Patents enriched: ${patents.length}`);

  // ── Build ranked list ──
  type RankedPatent = (typeof scores)[0] & {
    patent: (typeof patents)[0] | undefined;
    rank: number;
  };

  const ranked: RankedPatent[] = scores.map((s, i) => ({
    ...s,
    patent: patentMap.get(s.patentId),
    rank: i + 1,
  }));

  // ── File 1: broadcom-wireless-ranked.csv ──
  console.log('\nWriting broadcom-wireless-ranked.csv...');
  await writeRankedCSV(ranked, outputDir);

  // ── File 2: competitor-landscape.csv ──
  console.log('Writing competitor-landscape.csv...');
  await writeCompetitorLandscape(outputDir);

  // ── File 3: top-200-detailed.json ──
  console.log('Writing top-200-detailed.json...');
  writeTopDetailed(ranked.slice(0, TOP_N), outputDir);

  // ── File 4: sector-summary.csv ──
  console.log('Writing sector-summary.csv...');
  writeSectorSummary(ranked, outputDir);

  // ── File 5: README.md ──
  console.log('Writing README.md...');
  writeReadme(ranked, date, outputDir);

  // ── Optional: Assessment exports ──
  if (includeAssessments) {
    console.log('\nWriting assessment exports...');
    await writeAssessmentExports(outputDir);
  }

  console.log(`\nDone. ${includeAssessments ? 7 : 5} files written to ${outputDir}`);
  await prisma.$disconnect();
}

// ─── File 1: Ranked CSV ──────────────────────────────────────────────────────

async function writeRankedCSV(ranked: any[], outputDir: string) {
  const headers = [
    'rank', 'patent_id', 'title', 'assignee', 'grant_date', 'remaining_years',
    'sector', 'sub_sector_id',
    'composite_score', 'with_claims',
    // Core litigation metrics
    'claim_breadth', 'design_around_difficulty', 'implementation_clarity',
    'standards_relevance', 'market_relevance', 'technical_novelty', 'unique_value',
    // Wireless-specific metrics
    'component_vs_system', 'deployment_target', 'wireless_generation', 'standards_essentiality',
    // Text fields
    'patent_summary', 'prior_art_problem', 'technical_solution',
    // Competitor data
    'competitor_citations', 'competitor_count', 'competitor_names',
    // Additional
    'forward_citations', 'cpc_codes',
  ];

  const rows = [headers.join(',')];

  for (const r of ranked) {
    const metrics = (r.metrics || {}) as Record<string, { score?: number; reasoning?: string }>;
    const patent = r.patent;
    const citations = patent?.citations;

    const getScore = (field: string) => metrics[field]?.score ?? '';
    const getText = (field: string) => metrics[field]?.reasoning ?? '';

    rows.push(csvRow([
      r.rank,
      r.patentId,
      patent?.title || '',
      patent?.assignee || '',
      patent?.grantDate || '',
      patent?.remainingYears != null ? Number(patent.remainingYears).toFixed(1) : '',
      r.templateConfigId || '',
      r.subSectorId || '',
      Number(r.compositeScore).toFixed(2),
      r.withClaims,
      // Core metrics
      getScore('claim_breadth'),
      getScore('design_around_difficulty'),
      getScore('implementation_clarity'),
      getScore('standards_relevance'),
      getScore('market_relevance'),
      getScore('technical_novelty'),
      getScore('unique_value'),
      // Wireless metrics
      getScore('component_vs_system'),
      getScore('deployment_target'),
      getScore('wireless_generation'),
      getScore('standards_essentiality'),
      // Text fields (from metrics reasoning for text-type questions)
      getText('patent_summary'),
      getText('prior_art_problem'),
      getText('technical_solution'),
      // Competitor data
      citations?.competitorCitations ?? '',
      citations?.competitorNames?.length ?? 0,
      citations?.competitorNames?.join('; ') ?? '',
      // Additional
      patent?.forwardCitations ?? '',
      patent?.cpcCodes?.map((c: any) => c.cpcCode).join('; ') ?? '',
    ]));
  }

  fs.writeFileSync(path.join(outputDir, 'broadcom-wireless-ranked.csv'), rows.join('\n'));
  console.log(`  → ${ranked.length} rows`);
}

// ─── File 2: Competitor Landscape ────────────────────────────────────────────

async function writeCompetitorLandscape(outputDir: string) {
  // Get all portfolios
  const portfolios = await prisma.portfolio.findMany({
    where: { name: { in: COMPETITOR_PORTFOLIOS } },
  });
  const portfolioMap = new Map(portfolios.map(p => [p.id, p.name]));

  // For each portfolio, get patent IDs per sector
  const landscape: Record<string, Record<string, { count: number; avgScore: number; topScore: number }>> = {};

  for (const sector of WIRELESS_SECTORS) {
    landscape[sector] = {};
  }

  for (const pf of portfolios) {
    // Get this portfolio's WIRELESS patents with their primary sector
    const ppRows = await prisma.portfolioPatent.findMany({
      where: {
        portfolioId: pf.id,
        patent: { superSector: SUPER_SECTOR, isQuarantined: false },
      },
      select: { patentId: true, patent: { select: { primarySector: true } } },
    });
    if (ppRows.length === 0) continue;

    const patentIds = ppRows.map(r => r.patentId);
    const patentSectorMap = new Map(ppRows.map(r => [r.patentId, r.patent.primarySector || 'unknown']));

    // Get best score per patent (deduplicate multi-sub-sector scores)
    const allScores = await prisma.patentSubSectorScore.findMany({
      where: { patentId: { in: patentIds } },
      select: { patentId: true, compositeScore: true },
    });

    const bestByPatent = new Map<string, number>();
    for (const s of allScores) {
      const existing = bestByPatent.get(s.patentId);
      if (existing === undefined || s.compositeScore > existing) {
        bestByPatent.set(s.patentId, s.compositeScore);
      }
    }

    // Aggregate per sector using patent's primarySector
    const bySector: Record<string, number[]> = {};
    for (const [patentId, score] of bestByPatent) {
      const sector = patentSectorMap.get(patentId) || 'unknown';
      if (!bySector[sector]) bySector[sector] = [];
      bySector[sector].push(score);
    }

    for (const [sector, sectorScores] of Object.entries(bySector)) {
      if (!landscape[sector]) continue;
      const avg = sectorScores.reduce((a, b) => a + b, 0) / sectorScores.length;
      const top = Math.max(...sectorScores);
      landscape[sector][pf.name] = {
        count: sectorScores.length,
        avgScore: Number(avg.toFixed(2)),
        topScore: Number(top.toFixed(2)),
      };
    }
  }

  // Build CSV
  const pfNames = COMPETITOR_PORTFOLIOS;
  const headerParts = ['sector'];
  for (const name of pfNames) {
    headerParts.push(`${name}_patents`, `${name}_avg_score`, `${name}_top_score`);
  }
  const rows = [headerParts.join(',')];

  for (const sector of WIRELESS_SECTORS) {
    const rowParts: (string | number)[] = [sector];
    for (const name of pfNames) {
      const data = landscape[sector]?.[name];
      rowParts.push(data?.count ?? 0, data?.avgScore ?? '', data?.topScore ?? '');
    }
    rows.push(csvRow(rowParts));
  }

  fs.writeFileSync(path.join(outputDir, 'competitor-landscape.csv'), rows.join('\n'));
  console.log(`  → ${WIRELESS_SECTORS.length} sectors × ${pfNames.length} portfolios`);
}

// ─── File 3: Top 200 Detailed JSON ──────────────────────────────────────────

function writeTopDetailed(top: any[], outputDir: string) {
  const detailed = top.map((r: any) => {
    const metrics = (r.metrics || {}) as Record<string, { score?: number; reasoning?: string; confidence?: number }>;
    const patent = r.patent;
    const citations = patent?.citations;

    return {
      rank: r.rank,
      patent_id: r.patentId,
      title: patent?.title || '',
      assignee: patent?.assignee || '',
      grant_date: patent?.grantDate || '',
      remaining_years: patent?.remainingYears ?? null,
      composite_score: Number(r.compositeScore.toFixed(2)),
      sector: r.templateConfigId || '',
      sub_sector_id: r.subSectorId || '',
      with_claims: r.withClaims,
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [k, {
          score: v.score ?? null,
          reasoning: v.reasoning ?? '',
          confidence: v.confidence ?? null,
        }])
      ),
      competitor_data: {
        citations: citations?.competitorCitations ?? 0,
        companies: citations?.competitorNames ?? [],
        density: citations?.competitorDensity ?? null,
      },
      patent_summary: metrics['patent_summary']?.reasoning ?? '',
      technical_solution: metrics['technical_solution']?.reasoning ?? '',
      prior_art_problem: metrics['prior_art_problem']?.reasoning ?? '',
      forward_citations: patent?.forwardCitations ?? 0,
      cpc_codes: patent?.cpcCodes?.map((c: any) => c.cpcCode) ?? [],
    };
  });

  fs.writeFileSync(
    path.join(outputDir, 'top-200-detailed.json'),
    JSON.stringify(detailed, null, 2)
  );
  console.log(`  → ${detailed.length} patents with full reasoning`);
}

// ─── File 4: Sector Summary ─────────────────────────────────────────────────

function writeSectorSummary(ranked: any[], outputDir: string) {
  // Group by patent's primarySector (not templateConfigId, which may be a sub-sector)
  const bySector: Record<string, any[]> = {};
  for (const r of ranked) {
    const sector = r.patent?.primarySector || r.templateConfigId || 'unknown';
    if (!bySector[sector]) bySector[sector] = [];
    bySector[sector].push(r);
  }

  const headers = [
    'sector', 'patent_count', 'avg_composite', 'max_composite',
    'scored_with_claims', 'top_patent_id',
  ];
  const rows = [headers.join(',')];

  for (const sector of WIRELESS_SECTORS) {
    const patents = bySector[sector] || [];
    if (patents.length === 0) {
      rows.push(csvRow([sector, 0, '', '', 0, '']));
      continue;
    }

    const avg = patents.reduce((s: number, p: any) => s + p.compositeScore, 0) / patents.length;
    const max = Math.max(...patents.map((p: any) => p.compositeScore));
    const withClaims = patents.filter((p: any) => p.withClaims).length;
    const topPatent = patents.reduce((best: any, p: any) =>
      p.compositeScore > best.compositeScore ? p : best, patents[0]);

    rows.push(csvRow([
      sector,
      patents.length,
      avg.toFixed(2),
      max.toFixed(2),
      withClaims,
      topPatent.patentId,
    ]));
  }

  fs.writeFileSync(path.join(outputDir, 'sector-summary.csv'), rows.join('\n'));
  console.log(`  → ${WIRELESS_SECTORS.length} sectors`);
}

// ─── File 5: README ─────────────────────────────────────────────────────────

function writeReadme(ranked: any[], date: string, outputDir: string) {
  const totalPatents = ranked.length;
  const withClaims = ranked.filter((r: any) => r.withClaims).length;
  const avgScore = ranked.reduce((s: number, r: any) => s + r.compositeScore, 0) / (totalPatents || 1);
  const sectors = [...new Set(ranked.map((r: any) => r.patent?.primarySector || r.templateConfigId))].sort();

  const content = `# WIRELESS Vendor Export Package

**Generated:** ${date}
**Portfolio:** Broadcom Core (broadcom-core)
**Super-Sector:** WIRELESS

## Coverage

| Metric | Value |
|---|---|
| Total Patents | ${totalPatents} |
| Scored with Claims | ${withClaims} |
| Average Composite Score | ${avgScore.toFixed(2)} |
| Sectors Covered | ${sectors.length} |

## Files

| File | Description |
|---|---|
| \`broadcom-wireless-ranked.csv\` | All ${totalPatents} broadcom-core WIRELESS patents ranked by composite score |
| \`competitor-landscape.csv\` | Cross-portfolio comparison (${COMPETITOR_PORTFOLIOS.length} portfolios × ${sectors.length} sectors) |
| \`top-200-detailed.json\` | Top ${TOP_N} patents with full metric reasoning from LLM |
| \`sector-summary.csv\` | Per-sector aggregates |
| \`README.md\` | This file |

## Methodology

Patents scored via Claude Sonnet 4 with actual patent claims included in context. Each patent evaluated on 11+ metrics:

**Core litigation metrics (from portfolio-default template):**
- \`claim_breadth\` — Breadth of independent + dependent claims
- \`design_around_difficulty\` — Difficulty for competitors to avoid infringement
- \`implementation_clarity\` — Detectability of infringement in products
- \`standards_relevance\` — IEEE/3GPP/IETF essentiality
- \`market_relevance\` — Current market applicability
- \`technical_novelty\` — Departure from prior art
- \`unique_value\` — Hidden/dark-horse value

**Wireless-specific metrics (from super-sector template):**
- \`component_vs_system\` — Component-level vs system/protocol innovation
- \`deployment_target\` — Mobile device vs infrastructure targeting
- \`wireless_generation\` — 4G/5G/WiFi 6/7 alignment
- \`standards_essentiality\` — 3GPP/IEEE/Bluetooth SIG essentiality

**Text fields (weight=0, informational only):**
- \`patent_summary\` — 2-3 sentence plain-English summary
- \`prior_art_problem\` — Problem this patent solves
- \`technical_solution\` — How the solution works

## Column Definitions (broadcom-wireless-ranked.csv)

| Column | Description |
|---|---|
| \`rank\` | Global rank by composite score (1 = highest) |
| \`patent_id\` | USPTO patent number |
| \`title\` | Patent title |
| \`assignee\` | Current assignee |
| \`grant_date\` | Grant date (YYYY-MM-DD) |
| \`remaining_years\` | Estimated years until expiration (20-year term) |
| \`sector\` | WIRELESS sector classification |
| \`sub_sector_id\` | Sub-sector ID (if sub-sector scoring template was used) |
| \`composite_score\` | Weighted composite of all numeric metrics (0-100 scale) |
| \`with_claims\` | Whether patent claims were included in LLM context |
| \`competitor_citations\` | Number of forward citations from competitor patents |
| \`competitor_count\` | Number of distinct competitor companies citing this patent |
| \`competitor_names\` | Semicolon-separated competitor company names |
| \`forward_citations\` | Total forward citation count |
| \`cpc_codes\` | CPC classification codes |

## Sectors

${sectors.map(s => `- \`${s}\``).join('\n')}
`;

  fs.writeFileSync(path.join(outputDir, 'README.md'), content);
}

// ─── Optional: Assessment Exports (Phase 6) ─────────────────────────────────

async function writeAssessmentExports(outputDir: string) {
  // Find Tier 1 focus area for WIRELESS
  const tier1FA = await prisma.focusArea.findFirst({
    where: {
      AND: [
        { name: { contains: 'WIRELESS' } },
        { name: { contains: 'Crown' } },
      ],
      parentId: { not: null },
    },
    include: { promptTemplates: true },
  });

  if (!tier1FA) {
    console.log('  ⚠ No Tier 1 focus area found — skipping assessment exports');
    return;
  }

  const cacheBase = path.resolve('./cache/focus-area-prompts', tier1FA.id);

  // Per-patent assessment results → CSV
  const perPatentTemplate = tier1FA.promptTemplates.find(
    (t: any) => t.executionMode === 'PER_PATENT'
  );
  if (perPatentTemplate) {
    const resultDir = path.join(cacheBase, perPatentTemplate.id);
    if (fs.existsSync(resultDir)) {
      const files = fs.readdirSync(resultDir).filter(f => f.endsWith('.json') && f !== '_collective.json');

      const headers = [
        'patent_id', 'infringement_detectability', 'claim_mapping_strength',
        'prior_art_risk', 'assertion_strategy', 'overall_litigation_score',
        'target_companies', 'target_products', 'standards_alignment', 'claim_mapping_summary',
      ];
      const rows = [headers.join(',')];

      for (const file of files) {
        const result = JSON.parse(fs.readFileSync(path.join(resultDir, file), 'utf-8'));
        const data = result.response || result.fields || {};
        const patentId = result.patentId || file.replace('.json', '');

        rows.push(csvRow([
          patentId,
          data.infringement_detectability ?? '',
          data.claim_mapping_strength ?? '',
          data.prior_art_risk ?? '',
          data.assertion_strategy ?? '',
          data.overall_litigation_score ?? '',
          data.target_companies ?? '',
          data.target_products ?? '',
          data.standards_alignment ?? '',
          data.claim_mapping_summary ?? '',
        ]));
      }

      fs.writeFileSync(path.join(outputDir, 'tier1-assessment-results.csv'), rows.join('\n'));
      console.log(`  → tier1-assessment-results.csv: ${files.length} patents`);
    }
  }

  // Collective strategy → markdown
  const collectiveTemplate = tier1FA.promptTemplates.find(
    (t: any) => t.executionMode === 'COLLECTIVE'
  );
  if (collectiveTemplate) {
    const collectivePath = path.join(cacheBase, collectiveTemplate.id, '_collective.json');
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const content = result.rawText || result.response || JSON.stringify(result, null, 2);
      fs.writeFileSync(path.join(outputDir, 'collective-strategy.md'), content);
      console.log('  → collective-strategy.md');
    }
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
