#!/usr/bin/env npx tsx
/**
 * Within-Sector Scoring
 *
 * Ranks patents within each sector to identify the best patents
 * for sector-specific licensing campaigns.
 */

import * as fs from 'fs';

interface ScoredPatent {
  patent_id: string;
  title?: string;
  competitor_citations?: number;
  competitorCount?: number;
  remaining_years?: number;
  competitors?: string[];
  overallActionableScore?: number;
  licensingScore?: number;
  litigationScore?: number;
}

interface SectorAssignment {
  patent_id: string;
  sector: string;
  sector_damages: string;
}

interface SectorRanking {
  sector: string;
  damages_tier: string;
  total_patents: number;
  patents_with_citations: number;
  top_patents: Array<{
    rank: number;
    patent_id: string;
    title: string;
    score: number;
    competitor_citations: number;
    years_remaining: number;
    top_competitors: string[];
  }>;
  sector_score: number;
}

async function calculateWithinSectorScores() {
  console.log('=== WITHIN-SECTOR SCORING ===\n');

  // Load multi-score analysis
  const multiScore = JSON.parse(
    fs.readFileSync('output/multi-score-analysis-2026-01-19.json', 'utf-8')
  );

  const patentMap = new Map<string, ScoredPatent>();
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
  const sectorPatents = new Map<string, Array<ScoredPatent & { sector_damages: string }>>();

  for (const assignment of sectorData.assignments || []) {
    const patent = patentMap.get(assignment.patent_id);
    if (!patent) continue;

    const sector = assignment.sector;
    if (!sectorPatents.has(sector)) {
      sectorPatents.set(sector, []);
    }

    sectorPatents.get(sector)!.push({
      ...patent,
      sector_damages: assignment.sector_damages,
    });
  }

  // Calculate within-sector scores and rankings
  const sectorRankings: SectorRanking[] = [];

  for (const [sector, patents] of sectorPatents) {
    // Sort by a composite within-sector score
    const scoredPatents = patents
      .filter(p => (p.remaining_years || 0) >= 3) // Only actionable patents
      .map(p => ({
        ...p,
        within_sector_score: calculateWithinSectorScore(p),
      }))
      .sort((a, b) => b.within_sector_score - a.within_sector_score);

    const withCitations = scoredPatents.filter(p => (p.competitor_citations || 0) > 0);

    // Calculate aggregate sector score
    const sectorScore = scoredPatents.length > 0
      ? scoredPatents.slice(0, 10).reduce((sum, p) => sum + p.within_sector_score, 0) / Math.min(10, scoredPatents.length)
      : 0;

    sectorRankings.push({
      sector,
      damages_tier: patents[0]?.sector_damages || 'unknown',
      total_patents: patents.length,
      patents_with_citations: withCitations.length,
      sector_score: Math.round(sectorScore * 10) / 10,
      top_patents: scoredPatents.slice(0, 10).map((p, i) => ({
        rank: i + 1,
        patent_id: p.patent_id,
        title: (p.title || '').substring(0, 60) + ((p.title?.length || 0) > 60 ? '...' : ''),
        score: Math.round(p.within_sector_score * 10) / 10,
        competitor_citations: p.competitor_citations || 0,
        years_remaining: Math.round((p.remaining_years || 0) * 10) / 10,
        top_competitors: (p.competitors || []).slice(0, 3),
      })),
    });
  }

  // Sort sectors by aggregate score
  sectorRankings.sort((a, b) => b.sector_score - a.sector_score);

  // Display top sectors
  console.log('=== TOP 15 SECTORS (by aggregate quality score) ===\n');
  console.log('Sector\t\t\t\t\tDamages\t\tPatents\tWith Cites\tScore');
  console.log('─'.repeat(90));

  for (const sr of sectorRankings.slice(0, 15)) {
    const sectorPad = sr.sector.padEnd(32);
    const damagesPad = sr.damages_tier.padEnd(12);
    console.log(`${sectorPad}\t${damagesPad}\t${sr.total_patents}\t${sr.patents_with_citations}\t\t${sr.sector_score}`);
  }

  // Display top patents in top sectors
  console.log('\n\n=== TOP 5 PATENTS IN TOP 5 SECTORS ===\n');

  for (const sr of sectorRankings.slice(0, 5)) {
    console.log(`\n${sr.sector.toUpperCase()} (${sr.damages_tier} damages, ${sr.patents_with_citations} patents with citations)`);
    console.log('─'.repeat(80));
    console.log('Rank\tScore\tCC\tYrs\tPatent ID\tTop Competitors');

    for (const p of sr.top_patents.slice(0, 5)) {
      const comps = p.top_competitors.join(', ') || 'None';
      console.log(`${p.rank}\t${p.score}\t${p.competitor_citations}\t${p.years_remaining}\t${p.patent_id}\t${comps}`);
    }
  }

  // Export sector rankings
  const exportData = {
    generated: new Date().toISOString(),
    summary: {
      total_sectors: sectorRankings.length,
      sectors_with_high_score: sectorRankings.filter(s => s.sector_score > 50).length,
      total_actionable_patents: sectorRankings.reduce((sum, s) => sum + s.patents_with_citations, 0),
    },
    rankings: sectorRankings,
  };

  const outputPath = `output/within-sector-rankings-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(`\n\nExported: ${outputPath}`);

  // Export CSV for easy viewing
  const csvLines = ['sector,damages_tier,total_patents,with_citations,sector_score,top_patent_1,top_patent_2,top_patent_3'];
  for (const sr of sectorRankings) {
    const top3 = sr.top_patents.slice(0, 3).map(p => p.patent_id).join(' | ');
    csvLines.push(`${sr.sector},${sr.damages_tier},${sr.total_patents},${sr.patents_with_citations},${sr.sector_score},"${top3}"`);
  }

  const csvPath = `output/within-sector-rankings-${new Date().toISOString().split('T')[0]}.csv`;
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  console.log(`Exported: ${csvPath}`);
}

function calculateWithinSectorScore(patent: ScoredPatent): number {
  const cc = patent.competitor_citations || 0;
  const years = patent.remaining_years || 0;
  const compCount = patent.competitorCount || 0;
  const actionable = patent.overallActionableScore || 0;

  // Within-sector score emphasizes:
  // 1. Competitor evidence (citations from competitors)
  // 2. Remaining term (runway for licensing/litigation)
  // 3. Competitor diversity (multiple potential targets)
  // 4. Overall actionable score (quality indicator)

  const citationScore = Math.min(50, cc * 0.5); // Up to 50 points for citations
  const termScore = Math.min(20, years * 2);     // Up to 20 points for term
  const diversityScore = Math.min(15, compCount * 3); // Up to 15 points for diversity
  const qualityScore = Math.min(15, actionable * 0.15); // Up to 15 points from overall

  return citationScore + termScore + diversityScore + qualityScore;
}

calculateWithinSectorScores().catch(console.error);
