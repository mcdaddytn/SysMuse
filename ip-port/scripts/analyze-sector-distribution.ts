/**
 * Analyze Sector Distribution for High-Citation Patents
 *
 * This script checks:
 * 1. How many high-citation patents fall into specific sectors vs "general"
 * 2. Which patents with citations are unassigned (need sector classification)
 * 3. Sector effectiveness for the portfolio
 */

import * as fs from 'fs';

interface SectorAssignment {
  patent_id: string;
  title: string;
  final_sector: string;
  final_sector_name?: string;
  sector_source?: string;
}

interface PatentWithCitations {
  patent_id: string;
  title: string;
  competitor_citations: number;
  top_competitors: string;
}

function main() {
  // Load LLM rankings (patents with citations data)
  const llmFile = fs.readdirSync('./output/llm-analysis/combined')
    .filter(f => f.startsWith('combined-rankings-') && f.endsWith('.json'))
    .sort().reverse()[0];

  const llmData = JSON.parse(fs.readFileSync(`./output/llm-analysis/combined/${llmFile}`, 'utf-8'));
  const patentsWithCitations: PatentWithCitations[] = llmData.records;

  // Load sector assignments
  const sectorFile = fs.readdirSync('./output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-') && f.endsWith('.json'))
    .sort().reverse()[0];

  const sectorData = JSON.parse(fs.readFileSync(`./output/sectors/${sectorFile}`, 'utf-8'));
  const sectorLookup = new Map<string, SectorAssignment>();
  for (const a of sectorData.assignments) {
    sectorLookup.set(a.patent_id, a);
  }

  console.log('='.repeat(70));
  console.log('SECTOR DISTRIBUTION ANALYSIS FOR HIGH-CITATION PATENTS');
  console.log('='.repeat(70));

  // Analyze by citation threshold
  const thresholds = [1, 5, 10, 20];

  for (const threshold of thresholds) {
    const highCite = patentsWithCitations.filter(p => p.competitor_citations >= threshold);
    console.log(`\n${'='.repeat(70)}`);
    console.log(`PATENTS WITH ${threshold}+ COMPETITOR CITATIONS: ${highCite.length}`);
    console.log('='.repeat(70));

    const sectorDist: Record<string, number> = {};
    const generalPatents: { id: string; cites: number; title: string; competitors: string }[] = [];
    const patentsBySector: Record<string, { id: string; cites: number; title: string }[]> = {};

    for (const p of highCite) {
      const sectorInfo = sectorLookup.get(p.patent_id);
      const sector = sectorInfo?.final_sector || 'general';
      sectorDist[sector] = (sectorDist[sector] || 0) + 1;

      if (!patentsBySector[sector]) patentsBySector[sector] = [];
      patentsBySector[sector].push({
        id: p.patent_id,
        cites: p.competitor_citations,
        title: p.title?.substring(0, 50) || ''
      });

      if (sector === 'general') {
        generalPatents.push({
          id: p.patent_id,
          cites: p.competitor_citations,
          title: p.title?.substring(0, 50) || '',
          competitors: p.top_competitors || ''
        });
      }
    }

    const sorted = Object.entries(sectorDist).sort((a, b) => b[1] - a[1]);
    const classifiedCount = highCite.length - (sectorDist['general'] || 0);
    const classifiedPct = ((classifiedCount / highCite.length) * 100).toFixed(1);

    console.log(`\nClassification Rate: ${classifiedCount}/${highCite.length} (${classifiedPct}%) in specific sectors`);

    console.log('\nSector Distribution:');
    for (const [sector, count] of sorted) {
      const pct = ((count / highCite.length) * 100).toFixed(1);
      const flag = sector === 'general' ? ' ⚠️' : '';
      console.log(`  ${sector}: ${count} (${pct}%)${flag}`);
    }

    // Show top patents per sector
    if (threshold >= 10) {
      console.log('\nTop Patents by Sector:');
      for (const [sector, patents] of Object.entries(patentsBySector)) {
        if (sector !== 'general' && patents.length > 0) {
          const topPatents = patents.sort((a, b) => b.cites - a.cites).slice(0, 3);
          console.log(`\n  ${sector.toUpperCase()}:`);
          for (const p of topPatents) {
            console.log(`    ${p.id} (${p.cites} cites): ${p.title}...`);
          }
        }
      }
    }

    if (generalPatents.length > 0 && threshold >= 5) {
      console.log(`\n⚠️  Patents in "General" (need sector assignment):`);
      const sortedGeneral = generalPatents.sort((a, b) => b.cites - a.cites);
      for (const p of sortedGeneral.slice(0, 8)) {
        console.log(`  ${p.id} (${p.cites} cites): ${p.title}`);
        console.log(`    Competitors: ${p.competitors}`);
      }
    }
  }

  // Summary recommendations
  console.log(`\n${'='.repeat(70)}`);
  console.log('SECTOR EFFECTIVENESS SUMMARY');
  console.log('='.repeat(70));

  const all = patentsWithCitations.filter(p => p.competitor_citations > 0);
  const generalAll = all.filter(p => {
    const s = sectorLookup.get(p.patent_id);
    return !s || s.final_sector === 'general';
  });

  console.log(`\nTotal patents with any competitor citations: ${all.length}`);
  console.log(`Patents in "General": ${generalAll.length} (${((generalAll.length / all.length) * 100).toFixed(1)}%)`);
  console.log(`Patents in specific sectors: ${all.length - generalAll.length} (${(((all.length - generalAll.length) / all.length) * 100).toFixed(1)}%)`);

  // Overall sector distribution
  console.log('\nOverall Sector Distribution (22,706 patents):');
  const totalDist = sectorData.sector_distribution as Record<string, number>;
  const sortedTotal = Object.entries(totalDist).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [sector, count] of sortedTotal) {
    const pct = ((count / 22706) * 100).toFixed(1);
    console.log(`  ${sector}: ${count} (${pct}%)`);
  }
}

main();
