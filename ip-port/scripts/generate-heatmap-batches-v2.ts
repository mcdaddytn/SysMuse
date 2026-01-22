/**
 * Generate Heat Map Batches - V2 (Revised Strategy)
 *
 * STRATEGY:
 * - Uses V2 rankings as source (not V3)
 * - Draws primarily from Top 250
 * - Preserves batches 001 and 002 as already submitted
 * - Regenerates batches 003-010
 *
 * BATCH TYPES:
 * - Odd batches (3, 5, 7, 9): High-value random sample from top 250 for diversity
 * - Even batches (4, 6, 8, 10): Sector diversity, favoring high-ranked within sector
 *   - Can include patents ranked >250 ONLY if needed for sector representation
 *
 * Usage: npx tsx scripts/generate-heatmap-batches-v2.ts [--dry-run]
 */

import * as fs from 'fs';

const BATCH_SIZE = 25;
const TOP_RANK_CUTOFF = 250;  // Primary pool
const EXTENDED_RANK_CUTOFF = 500;  // For sector diversity only
const MIN_YEARS_REMAINING = 5;

// =============================================================================
// DATA STRUCTURES
// =============================================================================

interface Patent {
  patent_id: string;
  rank: number;
  title: string;
  affiliate: string;
  grant_date: string;
  years_remaining: number;
  forward_citations: number;
  competitor_citations: number;
  super_sector: string;
  sector: string;
  sector_name: string;
  // V2 scores
  score_aggressive: number;
  score_moderate: number;
  score_conservative: number;
  score_unified: number;
}

interface BatchPatent {
  patent_id: string;
  us_patent_id: string;
  title: string;
  v2_rank: number;
  v2_score_unified: number;
  competitor_citations: number;
  years_remaining: number;
  super_sector: string;
  sector: string;
  affiliate: string;
  selection_reason: string;
}

interface Batch {
  batch_number: number;
  batch_name: string;
  batch_type: 'preserved' | 'high_value_sampled' | 'sector_diversity';
  patents: BatchPatent[];
}

// =============================================================================
// LOAD DATA
// =============================================================================

function loadV2Rankings(): Patent[] {
  const csvContent = fs.readFileSync('output/TOPRATED-V2-2026-01-21.csv', 'utf-8');
  const lines = csvContent.split('\n');
  const headers = lines[0].split(',').map(h => h.trim());

  const patents: Patent[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    // Parse CSV line (handle quoted fields)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const getVal = (col: string) => {
      const idx = headers.indexOf(col);
      return idx >= 0 ? values[idx]?.replace(/"/g, '') : '';
    };

    const patent: Patent = {
      patent_id: getVal('patent_id'),
      rank: parseInt(getVal('rank')) || 9999,
      title: getVal('title'),
      affiliate: getVal('affiliate'),
      grant_date: getVal('grant_date'),
      years_remaining: parseFloat(getVal('years_remaining')) || 0,
      forward_citations: parseInt(getVal('forward_citations')) || 0,
      competitor_citations: parseInt(getVal('competitor_citations')) || 0,
      super_sector: getVal('super_sector') || 'Unknown',
      sector: getVal('sector') || '',
      sector_name: getVal('sector_name') || '',
      score_aggressive: parseFloat(getVal('score_aggressive')) || 0,
      score_moderate: parseFloat(getVal('score_moderate')) || 0,
      score_conservative: parseFloat(getVal('score_conservative')) || 0,
      score_unified: parseFloat(getVal('score_unified')) || 0,
    };

    // Filter: must have years remaining
    if (patent.years_remaining >= MIN_YEARS_REMAINING) {
      patents.push(patent);
    }
  }

  return patents.sort((a, b) => a.rank - b.rank);
}

function loadReservedPatents(): Set<string> {
  // Load patents from batches 001 and 002
  const batchData = JSON.parse(fs.readFileSync('output/heatmap-batches-LATEST.json', 'utf-8'));

  const reserved = new Set<string>();
  for (const batch of batchData.batches) {
    if (batch.batch_number <= 2) {
      for (const p of batch.patents) {
        reserved.add(p.patent_id);
      }
    }
  }

  return reserved;
}

function loadExistingBatches001And002(): Batch[] {
  const batchData = JSON.parse(fs.readFileSync('output/heatmap-batches-LATEST.json', 'utf-8'));

  const preserved: Batch[] = [];
  for (const batch of batchData.batches) {
    if (batch.batch_number <= 2) {
      preserved.push({
        batch_number: batch.batch_number,
        batch_name: batch.batch_name + ' (preserved)',
        batch_type: 'preserved',
        patents: batch.patents.map((p: any) => ({
          patent_id: p.patent_id,
          us_patent_id: p.us_patent_id,
          title: p.title,
          v2_rank: p.pool_rank || 0,  // May not have V2 rank
          v2_score_unified: p.overall_score || 0,
          competitor_citations: p.competitor_citations,
          years_remaining: p.years_remaining,
          super_sector: p.super_sector,
          sector: p.sector,
          affiliate: p.affiliate,
          selection_reason: 'preserved from original submission'
        }))
      });
    }
  }

  return preserved;
}

// =============================================================================
// BATCH GENERATION
// =============================================================================

function selectHighValueSampled(
  patents: Patent[],
  allocated: Set<string>,
  count: number,
  batchNum: number
): BatchPatent[] {
  // Filter to top 250, not already allocated
  const pool = patents
    .filter(p => p.rank <= TOP_RANK_CUTOFF && !allocated.has(p.patent_id));

  // Random sampling with sector spread
  // Group by super_sector to ensure diversity
  const bySector = new Map<string, Patent[]>();
  for (const p of pool) {
    const sector = p.super_sector || 'Unknown';
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push(p);
  }

  const selected: BatchPatent[] = [];
  const sectors = [...bySector.keys()];

  // Round-robin through sectors, taking best available from each
  let sectorIdx = 0;
  while (selected.length < count && sectors.length > 0) {
    const sector = sectors[sectorIdx % sectors.length];
    const sectorPatents = bySector.get(sector)!;

    if (sectorPatents.length > 0) {
      // Take the highest-ranked patent from this sector
      const patent = sectorPatents.shift()!;
      selected.push({
        patent_id: patent.patent_id,
        us_patent_id: `US${patent.patent_id}`,
        title: patent.title.substring(0, 80),
        v2_rank: patent.rank,
        v2_score_unified: patent.score_unified,
        competitor_citations: patent.competitor_citations,
        years_remaining: Math.round(patent.years_remaining * 10) / 10,
        super_sector: patent.super_sector,
        sector: patent.sector,
        affiliate: patent.affiliate,
        selection_reason: `top250_rank_${patent.rank}_sector_diversity`
      });
      allocated.add(patent.patent_id);
    }

    // Remove empty sectors
    if (sectorPatents.length === 0) {
      sectors.splice(sectorIdx % sectors.length, 1);
      if (sectors.length > 0) sectorIdx = sectorIdx % sectors.length;
    } else {
      sectorIdx++;
    }
  }

  return selected;
}

function selectSectorDiversity(
  patents: Patent[],
  allocated: Set<string>,
  count: number,
  batchNum: number
): BatchPatent[] {
  const selected: BatchPatent[] = [];

  // Group all patents by super_sector (up to rank 500)
  const bySector = new Map<string, Patent[]>();
  for (const p of patents) {
    if (allocated.has(p.patent_id)) continue;
    if (p.rank > EXTENDED_RANK_CUTOFF) continue;

    const sector = p.super_sector || 'Unknown';
    if (!bySector.has(sector)) bySector.set(sector, []);
    bySector.get(sector)!.push(p);
  }

  // Sort each sector's patents by V2 rank (best first)
  for (const [, sectorPatents] of bySector) {
    sectorPatents.sort((a, b) => a.rank - b.rank);
  }

  // Calculate quotas - favor underrepresented sectors
  const sectors = [...bySector.keys()].filter(s => s && s !== 'Unknown' && s !== '');
  const baseQuota = Math.floor(count / sectors.length);
  const quotas = new Map<string, number>();

  // Give each sector a base quota, with extras for sectors with fewer allocated
  for (const sector of sectors) {
    quotas.set(sector, baseQuota);
  }

  // Distribute remaining slots
  let remaining = count - (baseQuota * sectors.length);
  for (const sector of sectors) {
    if (remaining <= 0) break;
    quotas.set(sector, quotas.get(sector)! + 1);
    remaining--;
  }

  // Select from each sector, preferring top 250, but allowing top 500
  for (const sector of sectors) {
    const quota = quotas.get(sector) || 0;
    const sectorPatents = bySector.get(sector) || [];

    let taken = 0;
    for (const patent of sectorPatents) {
      if (taken >= quota) break;
      if (allocated.has(patent.patent_id)) continue;

      const inTop250 = patent.rank <= TOP_RANK_CUTOFF;
      selected.push({
        patent_id: patent.patent_id,
        us_patent_id: `US${patent.patent_id}`,
        title: patent.title.substring(0, 80),
        v2_rank: patent.rank,
        v2_score_unified: patent.score_unified,
        competitor_citations: patent.competitor_citations,
        years_remaining: Math.round(patent.years_remaining * 10) / 10,
        super_sector: patent.super_sector,
        sector: patent.sector,
        affiliate: patent.affiliate,
        selection_reason: inTop250
          ? `sector_${sector}_top250_rank_${patent.rank}`
          : `sector_${sector}_extended_rank_${patent.rank}`
      });
      allocated.add(patent.patent_id);
      taken++;
    }
  }

  // If we didn't fill the batch, take more from available pool
  if (selected.length < count) {
    const remaining = patents
      .filter(p => !allocated.has(p.patent_id) && p.rank <= EXTENDED_RANK_CUTOFF)
      .sort((a, b) => a.rank - b.rank);

    for (const patent of remaining) {
      if (selected.length >= count) break;
      selected.push({
        patent_id: patent.patent_id,
        us_patent_id: `US${patent.patent_id}`,
        title: patent.title.substring(0, 80),
        v2_rank: patent.rank,
        v2_score_unified: patent.score_unified,
        competitor_citations: patent.competitor_citations,
        years_remaining: Math.round(patent.years_remaining * 10) / 10,
        super_sector: patent.super_sector,
        sector: patent.sector,
        affiliate: patent.affiliate,
        selection_reason: `fill_rank_${patent.rank}`
      });
      allocated.add(patent.patent_id);
    }
  }

  return selected;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('         HEAT MAP BATCH GENERATION - V2 REVISED STRATEGY');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  if (dryRun) {
    console.log('  *** DRY RUN MODE - No files will be written ***\n');
  }

  // Load data
  const patents = loadV2Rankings();
  console.log(`Loaded ${patents.length} patents from V2 rankings (min ${MIN_YEARS_REMAINING} years)`);

  const reserved = loadReservedPatents();
  console.log(`Reserved patents (batches 001-002): ${reserved.size}`);

  // Load preserved batches
  const batches = loadExistingBatches001And002();
  console.log(`Preserved batches: ${batches.length}\n`);

  // Track allocated patents
  const allocated = new Set(reserved);

  // Generate new batches 003-010
  for (let batchNum = 3; batchNum <= 10; batchNum++) {
    const isOdd = batchNum % 2 === 1;

    let batchPatents: BatchPatent[];
    let batchType: 'high_value_sampled' | 'sector_diversity';
    let batchName: string;

    if (isOdd) {
      // Odd batches: High-value sampled from top 250
      batchType = 'high_value_sampled';
      batchName = `High-Value Sampled ${Math.ceil((batchNum - 1) / 2)}`;
      batchPatents = selectHighValueSampled(patents, allocated, BATCH_SIZE, batchNum);
    } else {
      // Even batches: Sector diversity
      batchType = 'sector_diversity';
      batchName = `Sector Diversity ${batchNum / 2}`;
      batchPatents = selectSectorDiversity(patents, allocated, BATCH_SIZE, batchNum);
    }

    batches.push({
      batch_number: batchNum,
      batch_name: batchName,
      batch_type: batchType,
      patents: batchPatents
    });

    console.log(`Batch ${String(batchNum).padStart(3, '0')}: ${batchName}`);
    console.log(`  Type: ${batchType}`);
    console.log(`  Patents: ${batchPatents.length}`);

    // Show rank distribution
    const ranks = batchPatents.map(p => p.v2_rank);
    const inTop250 = ranks.filter(r => r <= 250).length;
    const avgRank = Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length);
    console.log(`  In top 250: ${inTop250}/${batchPatents.length}`);
    console.log(`  Avg V2 rank: ${avgRank}`);

    // Show sector distribution
    const sectors = new Map<string, number>();
    for (const p of batchPatents) {
      sectors.set(p.super_sector, (sectors.get(p.super_sector) || 0) + 1);
    }
    const sectorStr = [...sectors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s, c]) => `${s}(${c})`)
      .join(', ');
    console.log(`  Sectors: ${sectorStr}`);
    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const totalPatents = batches.reduce((sum, b) => sum + b.patents.length, 0);
  console.log(`Total batches: ${batches.length}`);
  console.log(`Total patents: ${totalPatents}`);
  console.log(`Preserved (001-002): ${reserved.size}`);
  console.log(`New (003-010): ${totalPatents - reserved.size}`);

  // Overall sector distribution
  const allSectors = new Map<string, number>();
  for (const batch of batches) {
    for (const p of batch.patents) {
      allSectors.set(p.super_sector, (allSectors.get(p.super_sector) || 0) + 1);
    }
  }
  console.log('\nOverall sector distribution:');
  for (const [s, c] of [...allSectors.entries()].sort((a, b) => b[1] - a[1])) {
    const pct = ((c / totalPatents) * 100).toFixed(1);
    console.log(`  ${s.padEnd(20)} ${String(c).padStart(4)} (${pct}%)`);
  }

  // Rank distribution for new batches
  const newBatchPatents = batches.filter(b => b.batch_number >= 3).flatMap(b => b.patents);
  const newInTop250 = newBatchPatents.filter(p => p.v2_rank <= 250).length;
  const newInTop100 = newBatchPatents.filter(p => p.v2_rank <= 100).length;
  console.log(`\nNew batches rank distribution:`);
  console.log(`  In top 100: ${newInTop100}/${newBatchPatents.length}`);
  console.log(`  In top 250: ${newInTop250}/${newBatchPatents.length}`);
  console.log(`  Extended (251-500): ${newBatchPatents.length - newInTop250}/${newBatchPatents.length}`);

  if (!dryRun) {
    // Save outputs
    const timestamp = new Date().toISOString().split('T')[0];

    // 1. Full JSON with all batches
    const outputJson = {
      generated_date: timestamp,
      version: '2.0',
      strategy: 'V2 rankings, top 250 primary pool, sector diversity with extended pool',
      total_batches: batches.length,
      total_patents: totalPatents,
      preserved_batches: [1, 2],
      new_batches: [3, 4, 5, 6, 7, 8, 9, 10],
      batch_size: BATCH_SIZE,
      selection_criteria: {
        ranking_source: 'V2',
        primary_pool: 'Top 250',
        extended_pool: 'Top 500 (sector diversity only)',
        min_years_remaining: MIN_YEARS_REMAINING,
        odd_batches: 'High-value sampled with sector spread',
        even_batches: 'Sector diversity, favor high-ranked within sector'
      },
      sector_distribution: Object.fromEntries(allSectors),
      batches
    };

    fs.writeFileSync(`output/heatmap-batches-v2-${timestamp}.json`, JSON.stringify(outputJson, null, 2));
    fs.writeFileSync('output/heatmap-batches-v2-LATEST.json', JSON.stringify(outputJson, null, 2));

    // 2. Individual CSV files for each NEW batch (003-010)
    for (const batch of batches) {
      if (batch.batch_number <= 2) continue;  // Skip preserved

      const csvLines = [
        'patent_id,us_patent_id,title,v2_rank,v2_score,competitor_citations,years_remaining,super_sector,sector,affiliate,selection_reason'
      ];

      for (const p of batch.patents) {
        const title = p.title.replace(/"/g, '""');
        csvLines.push(
          `${p.patent_id},${p.us_patent_id},"${title}",${p.v2_rank},${p.v2_score_unified},${p.competitor_citations},${p.years_remaining},${p.super_sector},${p.sector},${p.affiliate},"${p.selection_reason}"`
        );
      }

      const batchNumStr = String(batch.batch_number).padStart(3, '0');
      fs.writeFileSync(`output/HEATMAP-BATCH-${batchNumStr}-v2.csv`, csvLines.join('\n'));
    }

    // 3. Save allocated patents list (for future batch generation)
    const allocatedList = {
      description: 'All patents allocated to batches 001-010',
      generated_date: timestamp,
      count: allocated.size,
      patent_ids: [...allocated].sort()
    };
    fs.writeFileSync('output/allocated-batch-patents.json', JSON.stringify(allocatedList, null, 2));

    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('                         FILES SAVED');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`  output/heatmap-batches-v2-${timestamp}.json`);
    console.log('  output/heatmap-batches-v2-LATEST.json');
    console.log('  output/HEATMAP-BATCH-003-v2.csv through 010-v2.csv');
    console.log('  output/allocated-batch-patents.json');
  }

  console.log('\n✓ Batch generation complete\n');
}

main().catch(console.error);
