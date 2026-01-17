/**
 * Expand Term-Based Sectors via More-Like-This (MLT)
 *
 * Uses ElasticSearch MLT queries to find patents similar to existing
 * term-based sector seed patents, then assigns those sectors.
 *
 * This provides better sector precision than CPC-only for top patents.
 *
 * Usage:
 *   npx tsx scripts/expand-sectors-mlt.ts [--top N]
 *   npx tsx scripts/expand-sectors-mlt.ts --top 250
 */

import * as fs from 'fs';

const ES_URL = 'http://localhost:9200';
const INDEX = 'patents';
const MIN_SIMILARITY_SCORE = 10.0;  // Minimum MLT score to assign sector

interface SectorSeed {
  sector: string;
  sectorName: string;
  patentIds: string[];
  keyTerms: string[];
}

interface MLTAssignment {
  patent_id: string;
  title: string;
  mlt_sector: string;
  mlt_sector_name: string;
  mlt_score: number;
  seed_patent: string;
  cpc_sector: string | null;
  sector_source: 'mlt' | 'cpc' | 'none';
}

function loadTermBasedSectors(): SectorSeed[] {
  const sectors: SectorSeed[] = [];
  const sectorDir = './output/sectors';

  if (!fs.existsSync(sectorDir)) {
    return sectors;
  }

  const files = fs.readdirSync(sectorDir).filter(f =>
    f.endsWith('.json') && !f.startsWith('all-patents-sectors')
  );

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(`${sectorDir}/${file}`, 'utf-8'));
      if (!data.sector || !data.results) continue;

      sectors.push({
        sector: data.sector,
        sectorName: data.sectorName || data.sector,
        patentIds: data.results.map((r: any) => r.patent_id),
        keyTerms: data.keyTerms || [],
      });
    } catch (e) {
      // Skip invalid files
    }
  }

  console.log(`Loaded ${sectors.length} term-based sectors with ${sectors.reduce((sum, s) => sum + s.patentIds.length, 0)} seed patents`);
  return sectors;
}

function loadTopPatentIds(topN: number): string[] {
  // Try to load from tier-litigation file
  const tierFiles = fs.readdirSync('./output')
    .filter(f => f.startsWith('tier-litigation-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (tierFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/${tierFiles[0]}`, 'utf-8'));
    return data.slice(0, topN).map((p: any) => p.patent_id);
  }

  // Fallback to multi-score analysis
  const multiScoreFiles = fs.readdirSync('./output')
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (multiScoreFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/${multiScoreFiles[0]}`, 'utf-8'));
    return data.patents
      .sort((a: any, b: any) => (b.overallActionableScore || 0) - (a.overallActionableScore || 0))
      .slice(0, topN)
      .map((p: any) => p.patent_id);
  }

  return [];
}

async function findSimilarPatents(sectorSeed: SectorSeed, excludeIds: Set<string>): Promise<Map<string, { score: number; seedPatent: string }>> {
  const results = new Map<string, { score: number; seedPatent: string }>();

  for (const seedPatentId of sectorSeed.patentIds) {
    try {
      const response = await fetch(`${ES_URL}/${INDEX}/_search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size: 50,
          query: {
            more_like_this: {
              fields: ['title', 'abstract'],
              like: [{ _index: INDEX, _id: seedPatentId }],
              min_term_freq: 1,
              min_doc_freq: 2,
              max_query_terms: 25,
              minimum_should_match: '30%',
            }
          },
          _source: ['patent_id', 'title']
        })
      });

      const data = await response.json();

      for (const hit of data.hits?.hits || []) {
        const patentId = hit._source.patent_id;
        const score = hit._score;

        // Skip if already in a sector or excluded
        if (excludeIds.has(patentId)) continue;
        if (score < MIN_SIMILARITY_SCORE) continue;

        // Keep the best score for each patent
        const existing = results.get(patentId);
        if (!existing || score > existing.score) {
          results.set(patentId, { score, seedPatent: seedPatentId });
        }
      }
    } catch (e) {
      console.error(`  Error querying MLT for ${seedPatentId}:`, e);
    }
  }

  return results;
}

async function getPatentInfo(patentId: string): Promise<{ title: string; cpcSector: string | null } | null> {
  try {
    const response = await fetch(`${ES_URL}/${INDEX}/_doc/${patentId}?_source=title,cpc_codes`);
    if (!response.ok) return null;

    const data = await response.json();
    const cpcCodes = data._source?.cpc_codes || [];

    // Simple CPC sector mapping
    let cpcSector: string | null = null;
    for (const cpc of cpcCodes) {
      if (cpc.startsWith('H04N') || cpc.startsWith('G06T')) cpcSector = 'video-image';
      else if (cpc.startsWith('H04L')) cpcSector = 'network-security';
      else if (cpc.startsWith('H04W')) cpcSector = 'wireless';
      else if (cpc.startsWith('G06F')) cpcSector = 'computing';
      if (cpcSector) break;
    }

    return {
      title: data._source?.title || '',
      cpcSector,
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const topIndex = args.indexOf('--top');
  const topN = topIndex !== -1 ? parseInt(args[topIndex + 1] || '250', 10) : 250;

  console.log('='.repeat(60));
  console.log('MLT Sector Expansion');
  console.log('='.repeat(60));
  console.log(`Expanding sectors to top ${topN} patents\n`);

  // Load existing sectors
  const sectors = loadTermBasedSectors();
  if (sectors.length === 0) {
    console.error('No term-based sectors found. Run hybrid-cluster-analysis.ts first.');
    process.exit(1);
  }

  // Get set of patents already in sectors
  const existingSectorPatents = new Set<string>();
  for (const sector of sectors) {
    for (const patentId of sector.patentIds) {
      existingSectorPatents.add(patentId);
    }
  }
  console.log(`Patents already in term-based sectors: ${existingSectorPatents.size}`);

  // Load top patent IDs
  const topPatentIds = loadTopPatentIds(topN);
  console.log(`Top patents to consider: ${topPatentIds.length}`);

  // Filter to patents not already in sectors
  const candidateIds = topPatentIds.filter(id => !existingSectorPatents.has(id));
  console.log(`Candidates for MLT expansion: ${candidateIds.length}\n`);

  if (candidateIds.length === 0) {
    console.log('All top patents already have term-based sectors. No expansion needed.');
    return;
  }

  // Find similar patents for each sector
  const mltAssignments = new Map<string, { sector: SectorSeed; score: number; seedPatent: string }>();

  for (const sector of sectors) {
    console.log(`Finding similar patents for sector: ${sector.sectorName}...`);

    const similar = await findSimilarPatents(sector, existingSectorPatents);

    for (const [patentId, match] of similar) {
      // Only consider candidates in our top list
      if (!candidateIds.includes(patentId)) continue;

      const existing = mltAssignments.get(patentId);
      if (!existing || match.score > existing.score) {
        mltAssignments.set(patentId, {
          sector,
          score: match.score,
          seedPatent: match.seedPatent,
        });
      }
    }

    // Small delay between sectors
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nFound ${mltAssignments.size} MLT sector assignments`);

  // Build final assignments
  const assignments: MLTAssignment[] = [];

  for (const patentId of candidateIds) {
    const mlt = mltAssignments.get(patentId);
    const info = await getPatentInfo(patentId);

    if (mlt) {
      assignments.push({
        patent_id: patentId,
        title: info?.title || '',
        mlt_sector: mlt.sector.sector,
        mlt_sector_name: mlt.sector.sectorName,
        mlt_score: mlt.score,
        seed_patent: mlt.seedPatent,
        cpc_sector: info?.cpcSector || null,
        sector_source: 'mlt',
      });
    } else {
      assignments.push({
        patent_id: patentId,
        title: info?.title || '',
        mlt_sector: info?.cpcSector || 'general',
        mlt_sector_name: info?.cpcSector ? info.cpcSector.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'General',
        mlt_score: 0,
        seed_patent: '',
        cpc_sector: info?.cpcSector || null,
        sector_source: info?.cpcSector ? 'cpc' : 'none',
      });
    }
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output/sectors';

  const output = {
    generated_at: new Date().toISOString(),
    top_n: topN,
    existing_sector_patents: existingSectorPatents.size,
    candidates: candidateIds.length,
    mlt_assignments: assignments.filter(a => a.sector_source === 'mlt').length,
    cpc_fallback: assignments.filter(a => a.sector_source === 'cpc').length,
    no_sector: assignments.filter(a => a.sector_source === 'none').length,
    assignments,
  };

  const outputPath = `${outputDir}/mlt-expanded-sectors-${timestamp}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Summary by sector
  console.log('\n' + '='.repeat(60));
  console.log('MLT EXPANSION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total candidates: ${candidateIds.length}`);
  console.log(`MLT sector assignments: ${output.mlt_assignments}`);
  console.log(`CPC fallback: ${output.cpc_fallback}`);
  console.log(`No sector: ${output.no_sector}`);

  const sectorCounts: Record<string, number> = {};
  for (const a of assignments.filter(a => a.sector_source === 'mlt')) {
    sectorCounts[a.mlt_sector] = (sectorCounts[a.mlt_sector] || 0) + 1;
  }

  console.log('\nMLT Sector Distribution:');
  const sorted = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]);
  for (const [sector, count] of sorted) {
    console.log(`  ${sector}: ${count}`);
  }
}

main().catch(console.error);
