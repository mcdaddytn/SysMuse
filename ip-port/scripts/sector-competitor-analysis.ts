#!/usr/bin/env npx tsx
/**
 * Sector-Competitor Distribution Analysis
 *
 * Shows which competitors are active in which sectors,
 * helping identify sector-specific licensing opportunities.
 */

import * as fs from 'fs';

interface Patent {
  patent_id: string;
  title?: string;
  competitors?: string[];
  competitor_citations?: number;
  competitorCount?: number;
  remaining_years?: number;
}

interface SectorAssignment {
  patent_id: string;
  sector: string;
  sector_damages: string;
}

async function analyzeSectorCompetitors() {
  console.log('=== SECTOR-COMPETITOR DISTRIBUTION ANALYSIS ===\n');

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

  if (sectorFiles.length === 0) {
    console.log('No sector assignment files found');
    return;
  }

  const sectorData = JSON.parse(
    fs.readFileSync(`output/sectors/${sectorFiles[0]}`, 'utf-8')
  );

  console.log(`Loaded ${patentMap.size} patents from multi-score analysis`);
  console.log(`Loaded ${sectorData.assignments?.length || 0} sector assignments from ${sectorFiles[0]}\n`);

  // Build sector -> patents map
  const sectorPatents = new Map<string, Patent[]>();
  const sectorCompetitors = new Map<string, Map<string, number>>();

  for (const sp of sectorData.assignments || []) {
    const patent = patentMap.get(sp.patent_id);
    if (!patent) continue;

    const sector = sp.sector;
    if (!sectorPatents.has(sector)) {
      sectorPatents.set(sector, []);
      sectorCompetitors.set(sector, new Map());
    }

    sectorPatents.get(sector)!.push(patent);

    // Count competitor occurrences in this sector
    for (const comp of patent.competitors || []) {
      const counts = sectorCompetitors.get(sector)!;
      counts.set(comp, (counts.get(comp) || 0) + 1);
    }
  }

  // Sort sectors by patent count
  const sortedSectors = [...sectorPatents.entries()]
    .sort((a, b) => b[1].length - a[1].length);

  // Summary by sector
  console.log('=== SECTOR SUMMARY (by patent count) ===\n');
  console.log('Sector\t\t\t\tPatents\tWith Cites\tTop Competitors');
  console.log('─'.repeat(100));

  for (const [sector, patents] of sortedSectors.slice(0, 20)) {
    const withCites = patents.filter(p => (p.competitor_citations || 0) > 0).length;
    const compCounts = sectorCompetitors.get(sector)!;
    const topComps = [...compCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, n]) => `${c}(${n})`)
      .join(', ');

    const sectorPadded = sector.padEnd(30);
    console.log(`${sectorPadded}\t${patents.length}\t${withCites}\t\t${topComps}`);
  }

  // Detailed competitor breakdown by top sectors
  console.log('\n\n=== TOP 5 SECTORS - DETAILED COMPETITOR BREAKDOWN ===\n');

  for (const [sector, patents] of sortedSectors.slice(0, 5)) {
    const compCounts = sectorCompetitors.get(sector)!;
    const sortedComps = [...compCounts.entries()]
      .sort((a, b) => b[1] - a[1]);

    console.log(`\n${sector.toUpperCase()} (${patents.length} patents)`);
    console.log('─'.repeat(60));
    console.log('Competitor\t\tPatents Cited\t% of Sector');

    for (const [comp, count] of sortedComps.slice(0, 15)) {
      const pct = ((count / patents.length) * 100).toFixed(1);
      console.log(`${comp.padEnd(24)}\t${count}\t\t${pct}%`);
    }
  }

  // Find emerging/unusual competitor concentrations
  console.log('\n\n=== EMERGING COMPETITORS (High concentration in specific sectors) ===\n');

  const competitorSectors = new Map<string, Map<string, number>>();

  for (const [sector, compCounts] of sectorCompetitors) {
    for (const [comp, count] of compCounts) {
      if (!competitorSectors.has(comp)) {
        competitorSectors.set(comp, new Map());
      }
      competitorSectors.get(comp)!.set(sector, count);
    }
  }

  // Find competitors concentrated in fewer sectors
  const concentrated: Array<{
    competitor: string;
    totalPatents: number;
    topSector: string;
    topSectorCount: number;
    concentration: number;
  }> = [];

  for (const [comp, sectors] of competitorSectors) {
    const total = [...sectors.values()].reduce((a, b) => a + b, 0);
    if (total < 10) continue; // Skip very small

    const [topSector, topCount] = [...sectors.entries()]
      .sort((a, b) => b[1] - a[1])[0];

    const concentration = topCount / total;

    concentrated.push({
      competitor: comp,
      totalPatents: total,
      topSector,
      topSectorCount: topCount,
      concentration,
    });
  }

  // Sort by concentration
  concentrated.sort((a, b) => b.concentration - a.concentration);

  console.log('Competitor\t\t\tTotal\tTop Sector\t\t\tConcentration');
  console.log('─'.repeat(90));

  for (const c of concentrated.slice(0, 20)) {
    const compPad = c.competitor.padEnd(24);
    const sectorPad = c.topSector.padEnd(25);
    console.log(`${compPad}\t${c.totalPatents}\t${sectorPad}\t${(c.concentration * 100).toFixed(0)}%`);
  }

  // Save detailed report
  const report = {
    generated: new Date().toISOString(),
    summary: {
      total_sectors: sectorPatents.size,
      total_patents_with_sectors: [...sectorPatents.values()].flat().length,
      total_unique_competitors: competitorSectors.size,
    },
    sectors: sortedSectors.slice(0, 30).map(([sector, patents]) => ({
      sector,
      patent_count: patents.length,
      patents_with_citations: patents.filter(p => (p.competitor_citations || 0) > 0).length,
      top_competitors: [...(sectorCompetitors.get(sector) || new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([comp, count]) => ({ competitor: comp, count })),
    })),
    concentrated_competitors: concentrated.slice(0, 30),
  };

  const reportPath = `output/sector-competitor-distribution-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n\nReport saved to: ${reportPath}`);
}

analyzeSectorCompetitors().catch(console.error);
