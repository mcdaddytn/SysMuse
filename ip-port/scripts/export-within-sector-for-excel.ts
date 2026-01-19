#!/usr/bin/env npx tsx
/**
 * Export Within-Sector Rankings for Excel
 *
 * Creates a CSV with sector-based patent rankings and
 * user-adjustable weights for within-sector scoring.
 */

import * as fs from 'fs';

interface Patent {
  patent_id: string;
  title?: string;
  competitor_citations?: number;
  competitorCount?: number;
  remaining_years?: number;
  competitors?: string[];
  forward_citations?: number;
  overallActionableScore?: number;
}

interface SectorAssignment {
  patent_id: string;
  sector: string;
  sector_damages: string;
}

async function exportWithinSectorForExcel() {
  console.log('=== EXPORT WITHIN-SECTOR RANKINGS FOR EXCEL ===\n');

  // Load multi-score analysis
  const multiScore = JSON.parse(
    fs.readFileSync('output/multi-score-analysis-2026-01-19.json', 'utf-8')
  );

  const patentMap = new Map<string, Patent>();
  for (const p of multiScore.patents) {
    patentMap.set(p.patent_id, p);
  }

  // Load sector assignments
  const sectorFiles = fs.readdirSync('output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-v2') && f.endsWith('.json'))
    .sort()
    .reverse();

  const sectorData = JSON.parse(
    fs.readFileSync(`output/sectors/${sectorFiles[0]}`, 'utf-8')
  );

  console.log(`Loaded ${patentMap.size} patents`);
  console.log(`Loaded ${sectorData.assignments?.length || 0} sector assignments\n`);

  // Group patents by sector
  const sectorPatents = new Map<string, Array<Patent & { sector: string; sector_damages: string }>>();

  for (const assignment of sectorData.assignments || []) {
    const patent = patentMap.get(assignment.patent_id);
    if (!patent) continue;
    if ((patent.remaining_years || 0) < 3) continue; // Only actionable

    const sector = assignment.sector;
    if (!sectorPatents.has(sector)) {
      sectorPatents.set(sector, []);
    }

    sectorPatents.get(sector)!.push({
      ...patent,
      sector,
      sector_damages: assignment.sector_damages || 'unknown',
    });
  }

  // Sort sectors by patent count with citations
  const sortedSectors = [...sectorPatents.entries()]
    .map(([sector, patents]) => ({
      sector,
      patents,
      withCitations: patents.filter(p => (p.competitor_citations || 0) > 0).length,
    }))
    .sort((a, b) => b.withCitations - a.withCitations);

  // Build CSV with top 15 patents per sector (top 20 sectors)
  const csvLines: string[] = [];

  // Header
  csvLines.push([
    'sector',
    'sector_rank',
    'patent_id',
    'title',
    'years_remaining',
    'competitor_citations',
    'competitor_count',
    'forward_citations',
    'top_competitors',
    'within_sector_score',
    'citation_score',
    'term_score',
    'diversity_score',
  ].join(','));

  for (const { sector, patents } of sortedSectors.slice(0, 25)) {
    // Score and rank within sector
    const scored = patents
      .map(p => {
        const cc = p.competitor_citations || 0;
        const years = p.remaining_years || 0;
        const compCount = p.competitorCount || 0;

        // Component scores (visible for user understanding)
        const citationScore = Math.min(50, cc * 0.5);
        const termScore = Math.min(25, years * 2.5);
        const diversityScore = Math.min(25, compCount * 5);

        return {
          ...p,
          citationScore: Math.round(citationScore * 10) / 10,
          termScore: Math.round(termScore * 10) / 10,
          diversityScore: Math.round(diversityScore * 10) / 10,
          withinSectorScore: Math.round((citationScore + termScore + diversityScore) * 10) / 10,
        };
      })
      .sort((a, b) => b.withinSectorScore - a.withinSectorScore);

    // Top 15 per sector
    for (let i = 0; i < Math.min(15, scored.length); i++) {
      const p = scored[i];
      const title = (p.title || '').replace(/"/g, '""').substring(0, 80);
      const comps = (p.competitors || []).slice(0, 3).join('; ');

      csvLines.push([
        sector,
        i + 1,
        p.patent_id,
        `"${title}"`,
        (p.remaining_years || 0).toFixed(1),
        p.competitor_citations || 0,
        p.competitorCount || 0,
        p.forward_citations || 0,
        `"${comps}"`,
        p.withinSectorScore,
        p.citationScore,
        p.termScore,
        p.diversityScore,
      ].join(','));
    }
  }

  // Write CSV
  const date = new Date().toISOString().split('T')[0];
  const csvPath = `excel/WITHIN-SECTOR-${date}.csv`;
  const latestPath = 'excel/WITHIN-SECTOR-LATEST.csv';

  fs.writeFileSync(csvPath, csvLines.join('\n'));
  fs.writeFileSync(latestPath, csvLines.join('\n'));

  console.log(`Exported: ${csvPath}`);
  console.log(`Exported: ${latestPath}`);

  // Summary
  const totalPatents = csvLines.length - 1;
  const sectorsIncluded = sortedSectors.slice(0, 25).length;

  console.log(`\nSummary:`);
  console.log(`  Sectors: ${sectorsIncluded}`);
  console.log(`  Total patent rows: ${totalPatents}`);
  console.log(`  Top 15 patents per sector (max)`);
}

exportWithinSectorForExcel().catch(console.error);
