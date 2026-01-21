#!/usr/bin/env npx tsx
/**
 * Generate Sector Reference Data for Excel Workbooks
 *
 * Creates supplementary data files for sector-specific analysis:
 * 1. Sector-to-Super-Sector mapping with representation stats
 * 2. CPC code reference with descriptions
 * 3. CPC-to-Sector overlap analysis
 *
 * Usage:
 *   npx tsx scripts/generate-sector-reference-data.ts
 */

import * as fs from 'fs';

// =============================================================================
// INTERFACES
// =============================================================================

interface SuperSectorConfig {
  superSectors: Record<string, {
    displayName: string;
    description: string;
    sectors: string[];
    damagesTier: string;
  }>;
}

interface CPCDescription {
  codes: Record<string, string>;
  superSectorCpcMapping: Record<string, string[]>;
}

interface PatentData {
  patent_id: string;
  competitor_citations?: number;
  remaining_years?: number;
  competitorCount?: number;
  overallActionableScore?: number;
  cpc_codes?: string[];
}

interface SectorAssignment {
  patent_id: string;
  sector: string;
  sector_damages: string;
}

interface SectorStats {
  sector: string;
  superSector: string;
  superSectorDisplay: string;
  totalInSector: number;
  inTop100: number;
  inTop250: number;
  inTop500: number;
  avgCompetitorCitations: number;
  totalCompetitorCitations: number;
  avgRemainingYears: number;
  topPatentId: string;
  topPatentScore: number;
}

interface CPCOverlap {
  cpcCode: string;
  cpcDescription: string;
  broadcomPatentCount: number;
  competitorPatentCount: number;
  topSuperSectors: Array<{ superSector: string; count: number }>;
  topSectors: Array<{ sector: string; count: number }>;
}

// =============================================================================
// MAIN GENERATION
// =============================================================================

async function generateSectorReferenceData() {
  console.log('=== GENERATE SECTOR REFERENCE DATA ===\n');

  // Load configurations
  const superSectorConfig: SuperSectorConfig = JSON.parse(
    fs.readFileSync('config/super-sectors.json', 'utf-8')
  );

  const cpcDescriptions: CPCDescription = JSON.parse(
    fs.readFileSync('config/cpc-descriptions.json', 'utf-8')
  );

  // Load patent data from multi-score analysis
  const multiScoreFiles = fs.readdirSync('output')
    .filter(f => f.startsWith('multi-score-analysis') && f.endsWith('.json'))
    .sort()
    .reverse();

  const multiScore = JSON.parse(
    fs.readFileSync(`output/${multiScoreFiles[0]}`, 'utf-8')
  );

  const patents: PatentData[] = multiScore.patents;
  console.log(`Loaded ${patents.length} patents from multi-score analysis`);

  // Load broadcom portfolio for CPC codes
  const broadcomPortfolio = JSON.parse(
    fs.readFileSync('output/broadcom-portfolio-2026-01-15.json', 'utf-8')
  );

  // Build CPC lookup map from broadcom portfolio
  const patentCpcMap = new Map<string, string[]>();
  for (const p of broadcomPortfolio.patents) {
    const cpcCodes: string[] = [];
    if (p.cpc_current && Array.isArray(p.cpc_current)) {
      for (const cpc of p.cpc_current) {
        if (cpc.cpc_group_id) {
          cpcCodes.push(cpc.cpc_group_id);
        } else if (cpc.cpc_subclass_id) {
          cpcCodes.push(cpc.cpc_subclass_id);
        }
      }
    }
    patentCpcMap.set(p.patent_id, cpcCodes);
  }
  console.log(`Loaded CPC codes for ${patentCpcMap.size} patents from broadcom portfolio`);

  // Load sector assignments
  const sectorFiles = fs.readdirSync('output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-v2') && f.endsWith('.json'))
    .sort()
    .reverse();

  const sectorData = JSON.parse(
    fs.readFileSync(`output/sectors/${sectorFiles[0]}`, 'utf-8')
  );

  const sectorAssignments: SectorAssignment[] = sectorData.assignments || [];
  console.log(`Loaded ${sectorAssignments.length} sector assignments\n`);

  // Build patent lookup map
  const patentMap = new Map<string, PatentData>();
  for (const p of patents) {
    patentMap.set(p.patent_id, p);
  }

  // Build sector assignment lookup
  const patentSectorMap = new Map<string, string>();
  for (const a of sectorAssignments) {
    patentSectorMap.set(a.patent_id, a.sector);
  }

  // Build reverse mapping: sector -> super-sector
  const sectorToSuperSector = new Map<string, string>();
  const sectorToSuperSectorDisplay = new Map<string, string>();

  for (const [ssKey, ssConfig] of Object.entries(superSectorConfig.superSectors)) {
    for (const sector of ssConfig.sectors) {
      sectorToSuperSector.set(sector, ssKey);
      sectorToSuperSectorDisplay.set(sector, ssConfig.displayName);
    }
  }

  // ==========================================================================
  // 1. SECTOR TO SUPER-SECTOR MAPPING WITH STATS
  // ==========================================================================
  console.log('Generating sector-to-super-sector mapping...');

  // Sort patents by overall score
  const sortedPatents = patents
    .filter(p => (p.remaining_years || 0) >= 3)
    .sort((a, b) => (b.overallActionableScore || 0) - (a.overallActionableScore || 0));

  const top100Patents = new Set(sortedPatents.slice(0, 100).map(p => p.patent_id));
  const top250Patents = new Set(sortedPatents.slice(0, 250).map(p => p.patent_id));
  const top500Patents = new Set(sortedPatents.slice(0, 500).map(p => p.patent_id));

  // Calculate stats per sector
  const sectorStatsMap = new Map<string, {
    patents: PatentData[];
    inTop100: number;
    inTop250: number;
    inTop500: number;
  }>();

  for (const assignment of sectorAssignments) {
    const patent = patentMap.get(assignment.patent_id);
    if (!patent) continue;

    if (!sectorStatsMap.has(assignment.sector)) {
      sectorStatsMap.set(assignment.sector, {
        patents: [],
        inTop100: 0,
        inTop250: 0,
        inTop500: 0,
      });
    }

    const stats = sectorStatsMap.get(assignment.sector)!;
    stats.patents.push(patent);

    if (top100Patents.has(patent.patent_id)) stats.inTop100++;
    if (top250Patents.has(patent.patent_id)) stats.inTop250++;
    if (top500Patents.has(patent.patent_id)) stats.inTop500++;
  }

  // Build sector stats array
  const sectorStats: SectorStats[] = [];

  // Include ALL sectors from super-sector config, even if no patents
  const allSectors = new Set<string>();
  for (const ssConfig of Object.values(superSectorConfig.superSectors)) {
    for (const sector of ssConfig.sectors) {
      allSectors.add(sector);
    }
  }

  for (const sector of allSectors) {
    const superSector = sectorToSuperSector.get(sector) || 'OTHER';
    const superSectorDisplay = sectorToSuperSectorDisplay.get(sector) || 'Other';

    const statsData = sectorStatsMap.get(sector);
    const patents = statsData?.patents || [];

    const totalCitations = patents.reduce((sum, p) => sum + (p.competitor_citations || 0), 0);
    const totalYears = patents.reduce((sum, p) => sum + (p.remaining_years || 0), 0);

    // Find top patent by score
    let topPatentId = '';
    let topPatentScore = 0;
    for (const p of patents) {
      if ((p.overallActionableScore || 0) > topPatentScore) {
        topPatentScore = p.overallActionableScore || 0;
        topPatentId = p.patent_id;
      }
    }

    sectorStats.push({
      sector,
      superSector,
      superSectorDisplay,
      totalInSector: patents.length,
      inTop100: statsData?.inTop100 || 0,
      inTop250: statsData?.inTop250 || 0,
      inTop500: statsData?.inTop500 || 0,
      avgCompetitorCitations: patents.length > 0 ? Math.round(totalCitations / patents.length * 10) / 10 : 0,
      totalCompetitorCitations: totalCitations,
      avgRemainingYears: patents.length > 0 ? Math.round(totalYears / patents.length * 10) / 10 : 0,
      topPatentId,
      topPatentScore: Math.round(topPatentScore * 10) / 10,
    });
  }

  // Sort by super-sector, then by totalInSector
  sectorStats.sort((a, b) => {
    if (a.superSector !== b.superSector) {
      return a.superSector.localeCompare(b.superSector);
    }
    return b.totalInSector - a.totalInSector;
  });

  // Write sector mapping CSV
  const sectorMappingCSV = [
    'sector,super_sector,super_sector_display,total_patents,in_top_100,in_top_250,in_top_500,avg_competitor_citations,total_competitor_citations,avg_years_remaining,top_patent_id,top_patent_score'
  ];

  for (const s of sectorStats) {
    sectorMappingCSV.push([
      s.sector,
      s.superSector,
      `"${s.superSectorDisplay}"`,
      s.totalInSector,
      s.inTop100,
      s.inTop250,
      s.inTop500,
      s.avgCompetitorCitations,
      s.totalCompetitorCitations,
      s.avgRemainingYears,
      s.topPatentId,
      s.topPatentScore,
    ].join(','));
  }

  // ==========================================================================
  // 2. SUPER-SECTOR SUMMARY
  // ==========================================================================
  console.log('Generating super-sector summary...');

  const superSectorSummary: Array<{
    superSector: string;
    displayName: string;
    description: string;
    damagesTier: string;
    sectorCount: number;
    totalPatents: number;
    inTop100: number;
    inTop250: number;
    inTop500: number;
    avgCompetitorCitations: number;
    totalCompetitorCitations: number;
    pctOfTop100: number;
    pctOfTop250: number;
  }> = [];

  for (const [ssKey, ssConfig] of Object.entries(superSectorConfig.superSectors)) {
    const ssStats = sectorStats.filter(s => s.superSector === ssKey);

    const totalPatents = ssStats.reduce((sum, s) => sum + s.totalInSector, 0);
    const totalCitations = ssStats.reduce((sum, s) => sum + s.totalCompetitorCitations, 0);
    const inTop100 = ssStats.reduce((sum, s) => sum + s.inTop100, 0);
    const inTop250 = ssStats.reduce((sum, s) => sum + s.inTop250, 0);
    const inTop500 = ssStats.reduce((sum, s) => sum + s.inTop500, 0);

    superSectorSummary.push({
      superSector: ssKey,
      displayName: ssConfig.displayName,
      description: ssConfig.description,
      damagesTier: ssConfig.damagesTier,
      sectorCount: ssConfig.sectors.length,
      totalPatents,
      inTop100,
      inTop250,
      inTop500,
      avgCompetitorCitations: totalPatents > 0 ? Math.round(totalCitations / totalPatents * 10) / 10 : 0,
      totalCompetitorCitations: totalCitations,
      pctOfTop100: Math.round(inTop100 / 100 * 1000) / 10,
      pctOfTop250: Math.round(inTop250 / 250 * 1000) / 10,
    });
  }

  superSectorSummary.sort((a, b) => b.inTop100 - a.inTop100);

  const superSectorCSV = [
    'super_sector,display_name,description,damages_tier,sector_count,total_patents,in_top_100,pct_of_top_100,in_top_250,pct_of_top_250,in_top_500,avg_competitor_citations,total_competitor_citations'
  ];

  for (const ss of superSectorSummary) {
    superSectorCSV.push([
      ss.superSector,
      `"${ss.displayName}"`,
      `"${ss.description}"`,
      ss.damagesTier,
      ss.sectorCount,
      ss.totalPatents,
      ss.inTop100,
      ss.pctOfTop100,
      ss.inTop250,
      ss.pctOfTop250,
      ss.inTop500,
      ss.avgCompetitorCitations,
      ss.totalCompetitorCitations,
    ].join(','));
  }

  // ==========================================================================
  // 3. CPC REFERENCE DATA
  // ==========================================================================
  console.log('Generating CPC reference data...');

  const cpcReferenceCSV = [
    'cpc_code,description,primary_super_sector'
  ];

  // Add super-sector mapping to each code
  const cpcToSuperSector = new Map<string, string>();
  for (const [ss, codes] of Object.entries(cpcDescriptions.superSectorCpcMapping)) {
    for (const code of codes) {
      cpcToSuperSector.set(code, ss);
    }
  }

  for (const [code, desc] of Object.entries(cpcDescriptions.codes)) {
    // Find best super-sector match
    let primarySS = '';
    for (const [ssCode, ss] of cpcToSuperSector) {
      if (code.startsWith(ssCode) || ssCode.startsWith(code)) {
        primarySS = ss;
        break;
      }
    }

    cpcReferenceCSV.push([
      code,
      `"${desc}"`,
      primarySS,
    ].join(','));
  }

  // ==========================================================================
  // 4. CPC-TO-SECTOR OVERLAP ANALYSIS
  // ==========================================================================
  console.log('Generating CPC-to-sector overlap analysis...');

  // Count CPC codes per sector and super-sector
  const cpcSectorCounts = new Map<string, Map<string, number>>();
  const cpcSuperSectorCounts = new Map<string, Map<string, number>>();
  const cpcPatentCounts = new Map<string, number>();

  for (const assignment of sectorAssignments) {
    const patent = patentMap.get(assignment.patent_id);
    if (!patent) continue;

    // Get CPC codes from the broadcom portfolio lookup
    const cpcCodes = patentCpcMap.get(assignment.patent_id) || [];
    if (cpcCodes.length === 0) continue;

    const sector = assignment.sector;
    const superSector = sectorToSuperSector.get(sector) || 'OTHER';

    for (const cpc of cpcCodes) {
      // Get CPC prefix (subclass level, e.g., H04L63)
      const prefix = cpc.replace(/[^A-Z0-9]/g, '').substring(0, 6);

      if (!cpcSectorCounts.has(prefix)) {
        cpcSectorCounts.set(prefix, new Map());
        cpcSuperSectorCounts.set(prefix, new Map());
        cpcPatentCounts.set(prefix, 0);
      }

      cpcPatentCounts.set(prefix, (cpcPatentCounts.get(prefix) || 0) + 1);

      const sectorMap = cpcSectorCounts.get(prefix)!;
      sectorMap.set(sector, (sectorMap.get(sector) || 0) + 1);

      const ssMap = cpcSuperSectorCounts.get(prefix)!;
      ssMap.set(superSector, (ssMap.get(superSector) || 0) + 1);
    }
  }

  // Build CPC overlap summary
  const cpcOverlapCSV = [
    'cpc_code,cpc_description,patent_count,top_super_sector_1,ss1_count,top_super_sector_2,ss2_count,top_super_sector_3,ss3_count,top_sector_1,s1_count,top_sector_2,s2_count,top_sector_3,s3_count'
  ];

  const cpcEntries = Array.from(cpcPatentCounts.entries())
    .filter(([_, count]) => count >= 10)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100);

  for (const [cpc, count] of cpcEntries) {
    const desc = cpcDescriptions.codes[cpc] || cpcDescriptions.codes[cpc.substring(0, 4)] || '';

    // Get top super-sectors
    const ssMap = cpcSuperSectorCounts.get(cpc) || new Map();
    const ssSorted = Array.from(ssMap.entries()).sort((a, b) => b[1] - a[1]);

    // Get top sectors
    const sectorMap = cpcSectorCounts.get(cpc) || new Map();
    const sectorSorted = Array.from(sectorMap.entries()).sort((a, b) => b[1] - a[1]);

    cpcOverlapCSV.push([
      cpc,
      `"${desc}"`,
      count,
      ssSorted[0]?.[0] || '',
      ssSorted[0]?.[1] || 0,
      ssSorted[1]?.[0] || '',
      ssSorted[1]?.[1] || 0,
      ssSorted[2]?.[0] || '',
      ssSorted[2]?.[1] || 0,
      sectorSorted[0]?.[0] || '',
      sectorSorted[0]?.[1] || 0,
      sectorSorted[1]?.[0] || '',
      sectorSorted[1]?.[1] || 0,
      sectorSorted[2]?.[0] || '',
      sectorSorted[2]?.[1] || 0,
    ].join(','));
  }

  // ==========================================================================
  // 5. TOP 15 SECTOR COMPARISON (for specific sector vs overall)
  // ==========================================================================
  console.log('Generating top-15 sector comparison...');

  const top15ComparisonCSV = [
    'sector,super_sector,rank_in_sector,patent_id,within_sector_score,overall_rank,overall_score,competitor_citations,years_remaining,in_top_100,in_top_250,in_top_500'
  ];

  // Get overall ranking
  const overallRankMap = new Map<string, number>();
  sortedPatents.forEach((p, idx) => {
    overallRankMap.set(p.patent_id, idx + 1);
  });

  // For each sector with patents, get top 15
  const sectorsWithPatents = Array.from(sectorStatsMap.keys()).sort();

  for (const sector of sectorsWithPatents) {
    const stats = sectorStatsMap.get(sector)!;
    const superSector = sectorToSuperSector.get(sector) || 'OTHER';

    // Sort by score within sector
    const sorted = stats.patents
      .filter(p => (p.remaining_years || 0) >= 3)
      .sort((a, b) => (b.overallActionableScore || 0) - (a.overallActionableScore || 0))
      .slice(0, 15);

    sorted.forEach((p, idx) => {
      const overallRank = overallRankMap.get(p.patent_id) || 9999;

      top15ComparisonCSV.push([
        sector,
        superSector,
        idx + 1,
        p.patent_id,
        Math.round((p.overallActionableScore || 0) * 10) / 10,
        overallRank,
        Math.round((p.overallActionableScore || 0) * 10) / 10,
        p.competitor_citations || 0,
        (p.remaining_years || 0).toFixed(1),
        top100Patents.has(p.patent_id) ? 'Y' : 'N',
        top250Patents.has(p.patent_id) ? 'Y' : 'N',
        top500Patents.has(p.patent_id) ? 'Y' : 'N',
      ].join(','));
    });
  }

  // ==========================================================================
  // WRITE OUTPUT FILES
  // ==========================================================================
  const date = new Date().toISOString().split('T')[0];

  fs.writeFileSync(`output/SECTOR-MAPPING-${date}.csv`, sectorMappingCSV.join('\n'));
  fs.writeFileSync('output/SECTOR-MAPPING-LATEST.csv', sectorMappingCSV.join('\n'));
  console.log(`  Written: output/SECTOR-MAPPING-${date}.csv`);

  fs.writeFileSync(`output/SUPER-SECTOR-SUMMARY-${date}.csv`, superSectorCSV.join('\n'));
  fs.writeFileSync('output/SUPER-SECTOR-SUMMARY-LATEST.csv', superSectorCSV.join('\n'));
  console.log(`  Written: output/SUPER-SECTOR-SUMMARY-${date}.csv`);

  fs.writeFileSync(`output/CPC-REFERENCE-${date}.csv`, cpcReferenceCSV.join('\n'));
  fs.writeFileSync('output/CPC-REFERENCE-LATEST.csv', cpcReferenceCSV.join('\n'));
  console.log(`  Written: output/CPC-REFERENCE-${date}.csv`);

  fs.writeFileSync(`output/CPC-SECTOR-OVERLAP-${date}.csv`, cpcOverlapCSV.join('\n'));
  fs.writeFileSync('output/CPC-SECTOR-OVERLAP-LATEST.csv', cpcOverlapCSV.join('\n'));
  console.log(`  Written: output/CPC-SECTOR-OVERLAP-${date}.csv`);

  fs.writeFileSync(`output/TOP15-SECTOR-COMPARISON-${date}.csv`, top15ComparisonCSV.join('\n'));
  fs.writeFileSync('output/TOP15-SECTOR-COMPARISON-LATEST.csv', top15ComparisonCSV.join('\n'));
  console.log(`  Written: output/TOP15-SECTOR-COMPARISON-${date}.csv`);

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n=== SUMMARY ===');
  console.log(`  Sectors mapped: ${sectorStats.length}`);
  console.log(`  Super-sectors: ${superSectorSummary.length}`);
  console.log(`  CPC codes with descriptions: ${Object.keys(cpcDescriptions.codes).length}`);
  console.log(`  CPC overlap entries: ${cpcEntries.length}`);
  console.log(`  Sectors with top-15 comparison: ${sectorsWithPatents.length}`);

  console.log('\nFiles generated:');
  console.log('  - SECTOR-MAPPING-LATEST.csv        (sector to super-sector with stats)');
  console.log('  - SUPER-SECTOR-SUMMARY-LATEST.csv  (super-sector overview)');
  console.log('  - CPC-REFERENCE-LATEST.csv         (CPC code descriptions)');
  console.log('  - CPC-SECTOR-OVERLAP-LATEST.csv    (CPC to sector/super-sector mapping)');
  console.log('  - TOP15-SECTOR-COMPARISON-LATEST.csv (top 15 per sector vs overall)');
}

generateSectorReferenceData().catch(console.error);
