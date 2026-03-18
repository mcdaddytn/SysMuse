/**
 * Export Vendor Package (any super-sector)
 *
 * Produces a self-contained directory of files for litigation vendor handoff:
 *   1. broadcom-{ss}-ranked.csv       — All broadcom-core patents ranked by composite score
 *   2. competitor-landscape.csv        — Cross-portfolio comparison by sector
 *   3. top-200-detailed.json           — Top 200 patents with full metric reasoning
 *   4. sector-summary.csv              — Per-sector summary
 *   5. README.md                       — Package manifest
 *
 * Optional: --include-assessments to append Tier 1 assessment data
 *
 * Usage: npx tsx scripts/export-vendor-package.ts <SUPER_SECTOR> [--include-assessments]
 * Example: npx tsx scripts/export-vendor-package.ts SEMICONDUCTOR
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const BROADCOM_PORTFOLIO_NAME = 'broadcom-core';
const TOP_N = 200;

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

// ─── Parse Collective Strategy for Patent Mappings ───────────────────────────

interface PatentMappings {
  techCluster: Map<string, string>;   // patentId -> "A", "B", "C", etc.
  claimChain: Map<string, string>;    // patentId -> "1", "2", "3", etc.
}

function parseCollectiveStrategy(mdContent: string): PatentMappings {
  const techCluster = new Map<string, string>();
  const claimChain = new Map<string, string>();

  // Parse Technology Clusters (### Cluster A:, ### Cluster B:, etc.)
  const clusterRegex = /###\s+Cluster\s+([A-Z]):[^\n]*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
  let match;
  while ((match = clusterRegex.exec(mdContent)) !== null) {
    const clusterLetter = match[1];
    const patentsStr = match[2];
    // Extract patent numbers (7-8 digit numbers)
    const patentNums = patentsStr.match(/\d{7,8}/g) || [];
    for (const num of patentNums) {
      techCluster.set(num, clusterLetter);
    }
  }

  // Parse Claim Chain Packages (### Package 1:, ### Package 2:, etc.)
  const packageRegex = /###\s+Package\s+(\d+):[^\n]*\n\*\*Patents:\*\*\s*([^\n]+)/gi;
  while ((match = packageRegex.exec(mdContent)) !== null) {
    const packageNum = match[1];
    const patentsStr = match[2];
    // Extract patent numbers (7-8 digit numbers)
    const patentNums = patentsStr.match(/\d{7,8}/g) || [];
    for (const num of patentNums) {
      // A patent can belong to multiple packages, comma-separate them
      const existing = claimChain.get(num);
      if (existing) {
        claimChain.set(num, `${existing},${packageNum}`);
      } else {
        claimChain.set(num, packageNum);
      }
    }
  }

  return { techCluster, claimChain };
}

// ─── Company Website Lookup ──────────────────────────────────────────────────

async function buildCompanyWebsiteMap(): Promise<Map<string, string>> {
  const companies = await prisma.company.findMany({
    where: { website: { not: null } },
    select: { name: true, displayName: true, website: true },
  });

  const websiteMap = new Map<string, string>();
  for (const c of companies) {
    if (c.website) {
      // Map both slug and display name (lowercase) to website
      websiteMap.set(c.name.toLowerCase(), c.website);
      websiteMap.set(c.displayName.toLowerCase(), c.website);
    }
  }
  return websiteMap;
}

function findCompanyWebsite(companyName: string, websiteMap: Map<string, string>): string {
  // Try exact lowercase match
  const lower = companyName.toLowerCase();
  if (websiteMap.has(lower)) return websiteMap.get(lower)!;

  // Try partial match (e.g., "Skyworks Solutions" -> "skyworks")
  for (const [key, url] of websiteMap) {
    if (lower.includes(key) || key.includes(lower)) {
      return url;
    }
  }

  return '';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

async function main() {
  const superSector = process.argv[2];
  if (!superSector || superSector.startsWith('--')) {
    console.error('Usage: npx tsx scripts/export-vendor-package.ts <SUPER_SECTOR> [--include-assessments]');
    process.exit(1);
  }

  const includeAssessments = process.argv.includes('--include-assessments');
  const ssLower = superSector.toLowerCase().replace(/_/g, '-');
  const date = new Date().toISOString().split('T')[0];
  const outputDir = path.resolve(`./output/vendor-exports/${superSector}-${date}`);

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`\nSuper-sector: ${superSector}`);
  console.log(`Output: ${outputDir}\n`);

  // ── Resolve sectors from DB ──
  const dbSectors = await prisma.sector.findMany({
    where: { superSector: { name: superSector } },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
  const sectorNames = dbSectors.map(s => s.name);
  console.log(`Sectors (${sectorNames.length}): ${sectorNames.join(', ')}`);

  // ── Resolve broadcom-core portfolio ──
  const portfolio = await prisma.portfolio.findUnique({ where: { name: BROADCOM_PORTFOLIO_NAME } });
  if (!portfolio) throw new Error(`Portfolio "${BROADCOM_PORTFOLIO_NAME}" not found`);

  // ── Get broadcom patent IDs in this super-sector ──
  const ppRows = await prisma.portfolioPatent.findMany({
    where: {
      portfolioId: portfolio.id,
      patent: { superSector: superSector, isQuarantined: false },
    },
    select: { patentId: true },
  });
  const broadcomPatentIds = ppRows.map(r => r.patentId);
  console.log(`Broadcom ${superSector} patents: ${broadcomPatentIds.length}`);

  // ── Fetch all scores, deduplicate to best per patent ──
  const allScores = await prisma.patentSubSectorScore.findMany({
    where: { patentId: { in: broadcomPatentIds } },
    orderBy: { compositeScore: 'desc' },
  });
  console.log(`Total scores fetched: ${allScores.length}`);

  const bestByPatent = new Map<string, (typeof allScores)[0]>();
  for (const s of allScores) {
    if (!bestByPatent.has(s.patentId)) {
      bestByPatent.set(s.patentId, s);
    }
  }
  const scores = [...bestByPatent.values()];
  console.log(`Unique patents with scores: ${scores.length}`);

  // ── Fetch patent data ──
  const scoredPatentIds = scores.map(s => s.patentId);
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
  const ranked = scores.map((s, i) => ({
    ...s,
    patent: patentMap.get(s.patentId),
    rank: i + 1,
  }));

  // ── Discover competitor portfolios that have patents in this super-sector ──
  const competitorPfs = await prisma.portfolio.findMany({
    where: {
      patents: { some: { patent: { superSector: superSector, isQuarantined: false } } },
    },
    select: { id: true, name: true },
  });
  // Put broadcom first, then sort rest alphabetically
  const orderedPfs = [
    competitorPfs.find(p => p.name === BROADCOM_PORTFOLIO_NAME)!,
    ...competitorPfs.filter(p => p.name !== BROADCOM_PORTFOLIO_NAME).sort((a, b) => a.name.localeCompare(b.name)),
  ].filter(Boolean);
  const pfNames = orderedPfs.map(p => p.name);

  // ── Write files ──
  console.log(`\nWriting broadcom-${ssLower}-ranked.csv...`);
  writeRankedCSV(ranked, ssLower, outputDir);

  console.log('Writing competitor-landscape.csv...');
  await writeCompetitorLandscape(orderedPfs, sectorNames, superSector, outputDir);

  console.log('Writing top-200-detailed.json...');
  writeTopDetailed(ranked.slice(0, TOP_N), outputDir);

  console.log('Writing sector-summary.csv...');
  writeSectorSummary(ranked, sectorNames, outputDir);

  console.log('Writing README.md...');
  writeReadme(ranked, sectorNames, pfNames, superSector, date, outputDir, ssLower);

  if (includeAssessments) {
    console.log('\nWriting assessment exports...');
    await writeAssessmentExports(superSector, outputDir);
  }

  const fileCount = fs.readdirSync(outputDir).filter(f => !f.startsWith('.')).length;
  console.log(`\nDone. ${fileCount} files written to ${outputDir}`);
  await prisma.$disconnect();
}

// ─── File 1: Ranked CSV ──────────────────────────────────────────────────────

function writeRankedCSV(ranked: any[], ssLower: string, outputDir: string) {
  // Discover all metric field names from the data
  const metricFields = new Set<string>();
  for (const r of ranked.slice(0, 100)) {
    const metrics = (r.metrics || {}) as Record<string, any>;
    for (const key of Object.keys(metrics)) {
      metricFields.add(key);
    }
  }

  // Separate numeric metrics from text metrics
  const numericMetrics: string[] = [];
  const textMetrics: string[] = [];
  for (const field of metricFields) {
    const sample = ranked.find(r => r.metrics?.[field]);
    const val = sample?.metrics?.[field];
    if (val && typeof val.score === 'number') {
      numericMetrics.push(field);
    } else {
      textMetrics.push(field);
    }
  }
  numericMetrics.sort();
  textMetrics.sort();

  const headers = [
    'rank', 'patent_id', 'title', 'assignee', 'grant_date', 'remaining_years',
    'sector', 'sub_sector_id', 'composite_score', 'with_claims',
    ...numericMetrics,
    ...textMetrics,
    'competitor_citations', 'competitor_count', 'competitor_names',
    'forward_citations', 'cpc_codes',
  ];

  const rows = [headers.join(',')];

  for (const r of ranked) {
    const metrics = (r.metrics || {}) as Record<string, any>;
    const patent = r.patent;
    const citations = patent?.citations;

    const numericValues = numericMetrics.map(f => metrics[f]?.score ?? '');
    const textValues = textMetrics.map(f => metrics[f]?.reasoning ?? '');

    rows.push(csvRow([
      r.rank,
      r.patentId,
      patent?.title || '',
      patent?.assignee || '',
      patent?.grantDate || '',
      patent?.remainingYears != null ? Number(patent.remainingYears).toFixed(1) : '',
      patent?.primarySector || r.templateConfigId || '',
      r.subSectorId || '',
      Number(r.compositeScore).toFixed(2),
      r.withClaims,
      ...numericValues,
      ...textValues,
      citations?.competitorCitations ?? '',
      citations?.competitorNames?.length ?? 0,
      citations?.competitorNames?.join('; ') ?? '',
      patent?.forwardCitations ?? '',
      patent?.cpcCodes?.map((c: any) => c.cpcCode).join('; ') ?? '',
    ]));
  }

  fs.writeFileSync(path.join(outputDir, `broadcom-${ssLower}-ranked.csv`), rows.join('\n'));
  console.log(`  → ${ranked.length} rows, ${numericMetrics.length} numeric + ${textMetrics.length} text metrics`);
}

// ─── File 2: Competitor Landscape ────────────────────────────────────────────

async function writeCompetitorLandscape(
  portfolios: Array<{ id: string; name: string }>,
  sectorNames: string[],
  superSector: string,
  outputDir: string
) {
  const landscape: Record<string, Record<string, { count: number; avgScore: number; topScore: number }>> = {};
  for (const sector of sectorNames) {
    landscape[sector] = {};
  }

  for (const pf of portfolios) {
    const ppRows = await prisma.portfolioPatent.findMany({
      where: {
        portfolioId: pf.id,
        patent: { superSector: superSector, isQuarantined: false },
      },
      select: { patentId: true, patent: { select: { primarySector: true } } },
    });
    if (ppRows.length === 0) continue;

    const patentIds = ppRows.map(r => r.patentId);
    const patentSectorMap = new Map(ppRows.map(r => [r.patentId, r.patent.primarySector || 'unknown']));

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

  const pfNames = portfolios.map(p => p.name);
  const headerParts = ['sector'];
  for (const name of pfNames) {
    headerParts.push(`${name}_patents`, `${name}_avg_score`, `${name}_top_score`);
  }
  const rows = [headerParts.join(',')];

  for (const sector of sectorNames) {
    const rowParts: (string | number)[] = [sector];
    for (const name of pfNames) {
      const data = landscape[sector]?.[name];
      rowParts.push(data?.count ?? 0, data?.avgScore ?? '', data?.topScore ?? '');
    }
    rows.push(csvRow(rowParts));
  }

  fs.writeFileSync(path.join(outputDir, 'competitor-landscape.csv'), rows.join('\n'));
  console.log(`  → ${sectorNames.length} sectors × ${pfNames.length} portfolios`);
}

// ─── File 3: Top 200 Detailed JSON ──────────────────────────────────────────

function writeTopDetailed(top: any[], outputDir: string) {
  const detailed = top.map((r: any) => {
    const metrics = (r.metrics || {}) as Record<string, any>;
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
      sector: patent?.primarySector || r.templateConfigId || '',
      sub_sector_id: r.subSectorId || '',
      with_claims: r.withClaims,
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]: [string, any]) => [k, {
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

function writeSectorSummary(ranked: any[], sectorNames: string[], outputDir: string) {
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

  for (const sector of sectorNames) {
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
  console.log(`  → ${sectorNames.length} sectors`);
}

// ─── File 5: README ─────────────────────────────────────────────────────────

function writeReadme(ranked: any[], sectorNames: string[], pfNames: string[], superSector: string, date: string, outputDir: string, ssLower: string) {
  const totalPatents = ranked.length;
  const withClaims = ranked.filter((r: any) => r.withClaims).length;
  const avgScore = ranked.reduce((s: number, r: any) => s + r.compositeScore, 0) / (totalPatents || 1);

  const content = `# ${superSector} Vendor Export Package

**Generated:** ${date}
**Portfolio:** Broadcom Core (broadcom-core)
**Super-Sector:** ${superSector}

## Coverage

| Metric | Value |
|---|---|
| Total Patents | ${totalPatents} |
| Scored with Claims | ${withClaims} |
| Average Composite Score | ${avgScore.toFixed(2)} |
| Sectors Covered | ${sectorNames.length} |
| Competitor Portfolios | ${pfNames.length} |

## Files

| File | Description |
|---|---|
| \`broadcom-${ssLower}-ranked.csv\` | All ${totalPatents} broadcom-core patents ranked by composite score |
| \`competitor-landscape.csv\` | Cross-portfolio comparison (${pfNames.length} portfolios × ${sectorNames.length} sectors) |
| \`top-200-detailed.json\` | Top ${Math.min(TOP_N, totalPatents)} patents with full metric reasoning from LLM |
| \`sector-summary.csv\` | Per-sector aggregates |
| \`README.md\` | This file |

## Sectors

${sectorNames.map(s => `- \`${s}\``).join('\n')}

## Competitor Portfolios

${pfNames.map(s => `- \`${s}\``).join('\n')}
`;

  fs.writeFileSync(path.join(outputDir, 'README.md'), content);
}

// ─── Optional: Assessment Exports ────────────────────────────────────────────

async function writeAssessmentExports(superSector: string, outputDir: string) {
  const tier1FA = await prisma.focusArea.findFirst({
    where: {
      superSector: superSector,
      name: { contains: 'Crown' },
      parentId: { not: null },
    },
    include: { promptTemplates: true },
  });

  if (!tier1FA) {
    console.log('  ⚠ No Tier 1 focus area found — skipping assessment exports');
    return;
  }

  const cacheBase = path.resolve('./cache/focus-area-prompts', tier1FA.id);

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

  // Load collective strategy for tech cluster and claim chain mappings
  const collectiveTemplate = tier1FA.promptTemplates.find(
    (t: any) => t.executionMode === 'COLLECTIVE'
  );
  let patentMappings: PatentMappings = { techCluster: new Map(), claimChain: new Map() };
  if (collectiveTemplate) {
    const collectivePath = path.join(cacheBase, collectiveTemplate.id, '_collective.json');
    if (fs.existsSync(collectivePath)) {
      const result = JSON.parse(fs.readFileSync(collectivePath, 'utf-8'));
      const mdContent = result.rawText || result.response || '';
      patentMappings = parseCollectiveStrategy(mdContent);
      console.log(`  → Parsed collective strategy: ${patentMappings.techCluster.size} cluster mappings, ${patentMappings.claimChain.size} chain mappings`);
    }
  }

  // Load company websites for target URL lookup
  const websiteMap = await buildCompanyWebsiteMap();
  console.log(`  → Loaded ${websiteMap.size / 2} company websites`);

  // Write vendor-friendly targets CSV (PatentId with US prefix + B2 suffix, target columns, notes)
  // Now includes TechCluster and ClaimChain columns
  if (perPatentTemplate) {
    const resultDir = path.join(cacheBase, perPatentTemplate.id);
    if (fs.existsSync(resultDir)) {
      const files = fs.readdirSync(resultDir).filter(f => f.endsWith('.json') && f !== '_collective.json');

      // Extended entry type with cluster/chain info and per-target products
      type TargetEntry = {
        patentId: string;
        title: string;
        litScore: string;
        strategy: string;
        techCluster: string;
        claimChain: string;
        targets: string[];
        targetProducts: Map<string, string>;  // target -> product string
        notes: string;
      };
      const entries: TargetEntry[] = [];
      let maxTargets = 0;

      // Fetch patent titles
      const patentIds = files.map(f => f.replace('.json', ''));
      const patentRows = await prisma.patent.findMany({
        where: { patentId: { in: patentIds } },
        select: { patentId: true, title: true },
      });
      const titleMap = new Map(patentRows.map(p => [p.patentId, p.title || '']));

      for (const file of files) {
        const result = JSON.parse(fs.readFileSync(path.join(resultDir, file), 'utf-8'));
        const data = result.response || result.fields || {};
        const patentId = result.patentId || file.replace('.json', '');

        // Parse target companies — split on commas, clean up, exclude portfolio owner
        const ownerPatterns = /\b(broadcom|avago)\b/i;
        const targetStr = (data.target_companies || '') as string;
        const rawTargets = targetStr
          .split(/,\s*/)
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0 && !ownerPatterns.test(t));
        // Clean target names: strip parenthetical notes, secondary/tertiary targets, trailing context
        const targets = rawTargets
          .map((t: string) => t
            .replace(/\s*\(.*$/, '')           // Strip from first parenthesis onward
            .replace(/\).*$/, '')              // Strip trailing close-paren fragments
            .replace(/\.\s*.*$/, '')           // Strip from first period onward
            .replace(/\s*[-–—].*$/, '')        // Strip from dash/em-dash context
            .replace(/^(Primary|Secondary|Tertiary)\s+targets?:\s*/i, '') // Strip "Primary targets:" prefix
            .trim())
          .filter((t: string) => t.length > 0 && t.length < 50 && !/^(and|or|as|the|with|other|various)\b/i.test(t));
        if (targets.length > maxTargets) maxTargets = targets.length;

        // Build notes and target-specific products
        const productStr = (data.target_products || '') as string;
        const notesParts: string[] = [];
        const targetProducts = new Map<string, string>();

        // Parse products and try to associate with targets
        for (const target of targets) {
          const companyProducts = productStr
            .split(/,\s*(?=[A-Z])/)
            .filter((p: string) => p.toLowerCase().includes(target.toLowerCase()) && !ownerPatterns.test(p))
            .map((p: string) => p.trim());
          if (companyProducts.length > 0) {
            notesParts.push(`${target}: ${companyProducts.join(', ')}`);
            targetProducts.set(target, companyProducts.join(', '));
          }
        }

        if (notesParts.length === 0 && productStr.trim()) {
          notesParts.push(productStr.trim());
        }

        entries.push({
          patentId,
          title: titleMap.get(patentId) || '',
          litScore: data.overall_litigation_score ?? '',
          strategy: data.assertion_strategy ?? '',
          techCluster: patentMappings.techCluster.get(patentId) || '',
          claimChain: patentMappings.claimChain.get(patentId) || '',
          targets,
          targetProducts,
          notes: notesParts.join('; '),
        });
      }

      // Ensure at least 5 target columns
      maxTargets = Math.max(maxTargets, 5);

      // Build vendor-targets.csv (wide format with TechCluster and ClaimChain)
      const targetHeaders = Array.from({ length: maxTargets }, (_, i) => `Target${i + 1}`);
      const headers = ['PatentId', 'Title', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', ...targetHeaders, 'Notes'];
      const rows = [headers.join(',')];

      // Sort by litigation score descending
      entries.sort((a, b) => Number(b.litScore || 0) - Number(a.litScore || 0));

      for (const e of entries) {
        const targetCells = Array.from({ length: maxTargets }, (_, i) => e.targets[i] || '');
        rows.push(csvRow([
          `US${e.patentId}B2`,
          e.title,
          e.litScore,
          e.strategy,
          e.techCluster,
          e.claimChain,
          ...targetCells,
          e.notes,
        ]));
      }

      fs.writeFileSync(path.join(outputDir, 'vendor-targets.csv'), rows.join('\n'));
      console.log(`  → vendor-targets.csv: ${entries.length} patents, ${maxTargets} target columns (with TechCluster, ClaimChain)`);

      // Build vendor-targets-pivot.csv (long format: one row per patent-target)
      const pivotHeaders = ['PatentId', 'LitScore', 'Strategy', 'TechCluster', 'ClaimChain', 'Target', 'TargetProduct', 'TargetUrl'];
      const pivotRows = [pivotHeaders.join(',')];

      for (const e of entries) {
        for (const target of e.targets) {
          const targetProduct = e.targetProducts.get(target) || '';
          const targetUrl = findCompanyWebsite(target, websiteMap);
          pivotRows.push(csvRow([
            `US${e.patentId}B2`,
            e.litScore,
            e.strategy,
            e.techCluster,
            e.claimChain,
            target,
            targetProduct,
            targetUrl,
          ]));
        }
      }

      fs.writeFileSync(path.join(outputDir, 'vendor-targets-pivot.csv'), pivotRows.join('\n'));
      const pivotCount = pivotRows.length - 1;
      console.log(`  → vendor-targets-pivot.csv: ${pivotCount} rows (patent-target pairs)`);
    }
  }

  // Write collective strategy markdown (collectiveTemplate already loaded above)
  if (collectiveTemplate) {
    const collectivePathMd = path.join(cacheBase, collectiveTemplate.id, '_collective.json');
    if (fs.existsSync(collectivePathMd)) {
      const result = JSON.parse(fs.readFileSync(collectivePathMd, 'utf-8'));
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
