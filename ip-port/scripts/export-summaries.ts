#!/usr/bin/env npx tsx
/**
 * Export Summary Spreadsheets
 *
 * Generates AffiliateSummary and SectorSummary CSV files for Excel analysis.
 * These are similar to CompetitorSummary but grouped by different dimensions.
 *
 * Output:
 *   - output/AFFILIATE-SUMMARY-{date}.csv
 *   - output/SECTOR-SUMMARY-{date}.csv
 *
 * Usage: npx tsx scripts/export-summaries.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// INTERFACES
// =============================================================================

interface AffiliateConfig {
  displayName: string;
  acquiredYear: number | null;
  patterns: string[];
}

interface Patent {
  patent_id: string;
  title?: string;
  assignee?: string;
  date?: string;
  remaining_years?: number;
  forward_citations?: number;
  competitor_citations?: number;
  competitorCount?: number;
  competitors?: string[];
  sector?: string;
  overallActionableScore?: number;
}

interface AffiliateSummaryRow {
  affiliate: string;
  acquiredYear: string;
  patentCount: number;
  activePatents: number;
  expiredPatents: number;
  avgYearsRemaining: number;
  patentsWithCitations: number;
  totalCompetitorCitations: number;
  avgCompetitorCitations: number;
  topCitedPatent: string;
  topCitedPatentCitations: number;
  topCompetitors: string;
  dominantSectors: string;
}

interface SectorSummaryRow {
  sector: string;
  patentCount: number;
  activePatents: number;
  expiredPatents: number;
  avgYearsRemaining: number;
  patentsWithCitations: number;
  totalCompetitorCitations: number;
  avgCompetitorCitations: number;
  uniqueCompetitors: number;
  topCitedPatent: string;
  topCitedPatentCitations: number;
  topCompetitors: string;
  dominantAffiliates: string;
  damagesTier: string;
}

// =============================================================================
// AFFILIATE NORMALIZATION
// =============================================================================

let affiliatePatterns: Array<{ pattern: RegExp; affiliate: string; acquiredYear: number | null }> = [];

function loadAffiliateConfig(): void {
  const configPath = 'config/portfolio-affiliates.json';
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    for (const [, affConfig] of Object.entries(config.affiliates) as [string, AffiliateConfig][]) {
      for (const pattern of affConfig.patterns) {
        affiliatePatterns.push({
          pattern: new RegExp(pattern, 'i'),
          affiliate: affConfig.displayName,
          acquiredYear: affConfig.acquiredYear
        });
      }
    }
    console.log(`Loaded ${affiliatePatterns.length} affiliate patterns`);
  }
}

function normalizeAffiliate(assignee: string): { affiliate: string; acquiredYear: number | null } {
  if (!assignee) return { affiliate: 'Unknown', acquiredYear: null };
  for (const { pattern, affiliate, acquiredYear } of affiliatePatterns) {
    if (pattern.test(assignee)) return { affiliate, acquiredYear };
  }
  const cleaned = assignee.replace(/,?\s*(Inc\.|LLC|Corporation|Ltd\.|Pte\.).*$/i, '').trim();
  return { affiliate: cleaned || 'Unknown', acquiredYear: null };
}

// =============================================================================
// SECTOR DAMAGES MAPPING
// =============================================================================

function loadSectorDamages(): Map<string, string> {
  const damagesPath = 'config/sector-damages.json';
  const map = new Map<string, string>();

  if (fs.existsSync(damagesPath)) {
    const config = JSON.parse(fs.readFileSync(damagesPath, 'utf-8'));
    for (const [sector, data] of Object.entries(config.sectors || {})) {
      map.set(sector, (data as any).damagesTier || 'Medium');
    }
  }

  return map;
}

// =============================================================================
// DATA LOADING
// =============================================================================

function loadPatentData(): Patent[] {
  // Find most recent multi-score analysis
  const files = fs.readdirSync('output')
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error('No multi-score-analysis file found in output/');
    process.exit(1);
  }

  const msaData = JSON.parse(fs.readFileSync(`output/${files[0]}`, 'utf-8'));
  console.log(`Loaded ${msaData.patents.length} patents from ${files[0]}`);

  // Load sector assignments
  const sectorFiles = fs.readdirSync('output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-v2') && f.endsWith('.json'))
    .sort()
    .reverse();

  const sectorMap = new Map<string, string>();
  if (sectorFiles.length > 0) {
    const sectorData = JSON.parse(fs.readFileSync(`output/sectors/${sectorFiles[0]}`, 'utf-8'));
    for (const assignment of sectorData.assignments || []) {
      sectorMap.set(assignment.patent_id, assignment.sector);
    }
    console.log(`Loaded sector assignments for ${sectorMap.size} patents`);
  }

  // Merge sector data
  return msaData.patents.map((p: any) => ({
    ...p,
    sector: sectorMap.get(p.patent_id) || p.sector || 'unassigned'
  }));
}

// =============================================================================
// AFFILIATE SUMMARY
// =============================================================================

function generateAffiliateSummary(patents: Patent[]): AffiliateSummaryRow[] {
  const affiliateData = new Map<string, {
    acquiredYear: number | null;
    patents: Patent[];
    sectors: Map<string, number>;
    competitors: Map<string, number>;
  }>();

  // Group patents by affiliate
  for (const p of patents) {
    const { affiliate, acquiredYear } = normalizeAffiliate(p.assignee || '');

    if (!affiliateData.has(affiliate)) {
      affiliateData.set(affiliate, {
        acquiredYear,
        patents: [],
        sectors: new Map(),
        competitors: new Map()
      });
    }

    const data = affiliateData.get(affiliate)!;
    data.patents.push(p);

    // Track sectors
    const sector = p.sector || 'unassigned';
    data.sectors.set(sector, (data.sectors.get(sector) || 0) + 1);

    // Track competitors
    for (const comp of p.competitors || []) {
      data.competitors.set(comp, (data.competitors.get(comp) || 0) + 1);
    }
  }

  // Build summary rows
  const rows: AffiliateSummaryRow[] = [];

  for (const [affiliate, data] of affiliateData) {
    const activePatents = data.patents.filter(p => (p.remaining_years || 0) >= 3);
    const expiredPatents = data.patents.filter(p => (p.remaining_years || 0) < 0);
    const patentsWithCitations = data.patents.filter(p => (p.competitor_citations || 0) > 0);
    const totalCites = data.patents.reduce((sum, p) => sum + (p.competitor_citations || 0), 0);
    const avgYears = data.patents.reduce((sum, p) => sum + (p.remaining_years || 0), 0) / data.patents.length;

    // Find top cited patent
    const topCited = data.patents.reduce((best, p) =>
      (p.competitor_citations || 0) > (best?.competitor_citations || 0) ? p : best,
      data.patents[0]
    );

    // Top competitors
    const topComps = [...data.competitors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c, n]) => `${c}(${n})`)
      .join('; ');

    // Dominant sectors
    const topSectors = [...data.sectors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([s, n]) => `${s}(${n})`)
      .join('; ');

    rows.push({
      affiliate,
      acquiredYear: data.acquiredYear ? String(data.acquiredYear) : '-',
      patentCount: data.patents.length,
      activePatents: activePatents.length,
      expiredPatents: expiredPatents.length,
      avgYearsRemaining: Math.round(avgYears * 10) / 10,
      patentsWithCitations: patentsWithCitations.length,
      totalCompetitorCitations: totalCites,
      avgCompetitorCitations: Math.round((totalCites / data.patents.length) * 10) / 10,
      topCitedPatent: topCited?.patent_id || '',
      topCitedPatentCitations: topCited?.competitor_citations || 0,
      topCompetitors: topComps,
      dominantSectors: topSectors
    });
  }

  // Sort by patent count descending
  rows.sort((a, b) => b.patentCount - a.patentCount);

  return rows;
}

// =============================================================================
// SECTOR SUMMARY
// =============================================================================

function generateSectorSummary(patents: Patent[], sectorDamages: Map<string, string>): SectorSummaryRow[] {
  const sectorData = new Map<string, {
    patents: Patent[];
    affiliates: Map<string, number>;
    competitors: Set<string>;
    competitorCounts: Map<string, number>;
  }>();

  // Group patents by sector
  for (const p of patents) {
    const sector = p.sector || 'unassigned';

    if (!sectorData.has(sector)) {
      sectorData.set(sector, {
        patents: [],
        affiliates: new Map(),
        competitors: new Set(),
        competitorCounts: new Map()
      });
    }

    const data = sectorData.get(sector)!;
    data.patents.push(p);

    // Track affiliates
    const { affiliate } = normalizeAffiliate(p.assignee || '');
    data.affiliates.set(affiliate, (data.affiliates.get(affiliate) || 0) + 1);

    // Track competitors
    for (const comp of p.competitors || []) {
      data.competitors.add(comp);
      data.competitorCounts.set(comp, (data.competitorCounts.get(comp) || 0) + 1);
    }
  }

  // Build summary rows
  const rows: SectorSummaryRow[] = [];

  for (const [sector, data] of sectorData) {
    const activePatents = data.patents.filter(p => (p.remaining_years || 0) >= 3);
    const expiredPatents = data.patents.filter(p => (p.remaining_years || 0) < 0);
    const patentsWithCitations = data.patents.filter(p => (p.competitor_citations || 0) > 0);
    const totalCites = data.patents.reduce((sum, p) => sum + (p.competitor_citations || 0), 0);
    const avgYears = data.patents.reduce((sum, p) => sum + (p.remaining_years || 0), 0) / data.patents.length;

    // Find top cited patent
    const topCited = data.patents.reduce((best, p) =>
      (p.competitor_citations || 0) > (best?.competitor_citations || 0) ? p : best,
      data.patents[0]
    );

    // Top competitors
    const topComps = [...data.competitorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c, n]) => `${c}(${n})`)
      .join('; ');

    // Dominant affiliates
    const topAffiliates = [...data.affiliates.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([a, n]) => `${a}(${n})`)
      .join('; ');

    rows.push({
      sector,
      patentCount: data.patents.length,
      activePatents: activePatents.length,
      expiredPatents: expiredPatents.length,
      avgYearsRemaining: Math.round(avgYears * 10) / 10,
      patentsWithCitations: patentsWithCitations.length,
      totalCompetitorCitations: totalCites,
      avgCompetitorCitations: Math.round((totalCites / data.patents.length) * 10) / 10,
      uniqueCompetitors: data.competitors.size,
      topCitedPatent: topCited?.patent_id || '',
      topCitedPatentCitations: topCited?.competitor_citations || 0,
      topCompetitors: topComps,
      dominantAffiliates: topAffiliates,
      damagesTier: sectorDamages.get(sector) || 'Medium'
    });
  }

  // Sort by patent count descending
  rows.sort((a, b) => b.patentCount - a.patentCount);

  return rows;
}

// =============================================================================
// CSV EXPORT
// =============================================================================

function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function exportAffiliateSummaryCSV(rows: AffiliateSummaryRow[], outputPath: string): void {
  const headers = [
    'affiliate',
    'acquired_year',
    'patent_count',
    'active_patents',
    'expired_patents',
    'avg_years_remaining',
    'patents_with_citations',
    'total_competitor_citations',
    'avg_competitor_citations',
    'top_cited_patent',
    'top_cited_patent_citations',
    'top_competitors',
    'dominant_sectors'
  ];

  const csvRows = [headers.join(',')];

  for (const r of rows) {
    csvRows.push([
      escapeCSV(r.affiliate),
      escapeCSV(r.acquiredYear),
      r.patentCount,
      r.activePatents,
      r.expiredPatents,
      r.avgYearsRemaining,
      r.patentsWithCitations,
      r.totalCompetitorCitations,
      r.avgCompetitorCitations,
      escapeCSV(r.topCitedPatent),
      r.topCitedPatentCitations,
      escapeCSV(r.topCompetitors),
      escapeCSV(r.dominantSectors)
    ].join(','));
  }

  fs.writeFileSync(outputPath, csvRows.join('\n'));
}

function exportSectorSummaryCSV(rows: SectorSummaryRow[], outputPath: string): void {
  const headers = [
    'sector',
    'patent_count',
    'active_patents',
    'expired_patents',
    'avg_years_remaining',
    'patents_with_citations',
    'total_competitor_citations',
    'avg_competitor_citations',
    'unique_competitors',
    'top_cited_patent',
    'top_cited_patent_citations',
    'top_competitors',
    'dominant_affiliates',
    'damages_tier'
  ];

  const csvRows = [headers.join(',')];

  for (const r of rows) {
    csvRows.push([
      escapeCSV(r.sector),
      r.patentCount,
      r.activePatents,
      r.expiredPatents,
      r.avgYearsRemaining,
      r.patentsWithCitations,
      r.totalCompetitorCitations,
      r.avgCompetitorCitations,
      r.uniqueCompetitors,
      escapeCSV(r.topCitedPatent),
      r.topCitedPatentCitations,
      escapeCSV(r.topCompetitors),
      escapeCSV(r.dominantAffiliates),
      escapeCSV(r.damagesTier)
    ].join(','));
  }

  fs.writeFileSync(outputPath, csvRows.join('\n'));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const dateStamp = new Date().toISOString().split('T')[0];

  console.log('='.repeat(70));
  console.log('Export Summary Spreadsheets');
  console.log('='.repeat(70));
  console.log('');

  // Load configurations
  loadAffiliateConfig();
  const sectorDamages = loadSectorDamages();

  // Load patent data
  const patents = loadPatentData();

  // Generate Affiliate Summary
  console.log('\nGenerating Affiliate Summary...');
  const affiliateSummary = generateAffiliateSummary(patents);

  const affiliatePath = `output/AFFILIATE-SUMMARY-${dateStamp}.csv`;
  const affiliateLatest = 'output/AFFILIATE-SUMMARY-LATEST.csv';
  exportAffiliateSummaryCSV(affiliateSummary, affiliatePath);
  exportAffiliateSummaryCSV(affiliateSummary, affiliateLatest);

  console.log(`  Exported: ${affiliatePath}`);
  console.log(`  Exported: ${affiliateLatest}`);
  console.log(`  Affiliates: ${affiliateSummary.length}`);

  // Print top affiliates
  console.log('\n  Top 5 Affiliates by Patent Count:');
  for (const row of affiliateSummary.slice(0, 5)) {
    console.log(`    ${row.affiliate}: ${row.patentCount} patents (${row.activePatents} active, ${row.totalCompetitorCitations} competitor cites)`);
  }

  // Generate Sector Summary
  console.log('\nGenerating Sector Summary...');
  const sectorSummary = generateSectorSummary(patents, sectorDamages);

  const sectorPath = `output/SECTOR-SUMMARY-${dateStamp}.csv`;
  const sectorLatest = 'output/SECTOR-SUMMARY-LATEST.csv';
  exportSectorSummaryCSV(sectorSummary, sectorPath);
  exportSectorSummaryCSV(sectorSummary, sectorLatest);

  console.log(`  Exported: ${sectorPath}`);
  console.log(`  Exported: ${sectorLatest}`);
  console.log(`  Sectors: ${sectorSummary.length}`);

  // Print top sectors
  console.log('\n  Top 10 Sectors by Patent Count:');
  for (const row of sectorSummary.slice(0, 10)) {
    console.log(`    ${row.sector}: ${row.patentCount} patents (${row.activePatents} active, ${row.uniqueCompetitors} competitors)`);
  }

  // Also generate a JSON version for programmatic use
  const jsonOutput = {
    generatedAt: new Date().toISOString(),
    affiliateSummary,
    sectorSummary,
    totals: {
      totalPatents: patents.length,
      activePatents: patents.filter(p => (p.remaining_years || 0) >= 3).length,
      patentsWithCitations: patents.filter(p => (p.competitor_citations || 0) > 0).length,
      totalAffiliates: affiliateSummary.length,
      totalSectors: sectorSummary.length
    }
  };

  const jsonPath = `output/SUMMARIES-${dateStamp}.json`;
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOutput, null, 2));
  console.log(`\n  JSON: ${jsonPath}`);

  console.log('\n' + '='.repeat(70));
  console.log('Summary Export Complete');
  console.log('='.repeat(70));
}

main().catch(console.error);
