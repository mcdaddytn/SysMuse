/**
 * Generate Heat Map Vendor Batches (v2)
 *
 * Creates batches of patents for submission to heat map vendor with two goals:
 * 1. Evaluate vendor quality and product matching accuracy
 * 2. Validate our scoring methodology by testing across different tiers
 *
 * Batch Strategies:
 * - high_value_sampled: Sample across top 100 with sector diversity (not sequential)
 * - sector_diversity_no_security: Top from each non-SECURITY super-sector
 * - strategic_fill: Fill remaining from score-sorted pool
 *
 * Usage:
 *   npx tsx scripts/generate-heatmap-batches.ts
 *   npx tsx scripts/generate-heatmap-batches.ts --dry-run
 *   npx tsx scripts/generate-heatmap-batches.ts --config config/alt-config.json
 *
 * Configuration: config/heatmap-batch-config.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// INTERFACES
// ============================================================================

interface InterleavedBatchDef {
  type: 'high_value_sampled' | 'sector_diversity_no_security' | 'strategic_fill';
  name: string;
}

interface BatchConfig {
  batchSettings: {
    batchSize: number;
    totalBatches: number;
    costPerPatent: number;
  };
  selectionCriteria: {
    minYearsRemaining: number;
    minOverallScore: number;
    preferBroadClaims: boolean;
  };
  batchStrategy: {
    mode: 'interleaved';
    interleavedPattern: InterleavedBatchDef[];
    highValueSampled: {
      poolSize: number;
      batchCount: number;
      sectorSpread: boolean;
    };
    sectorDiversityNoSecurity: {
      poolSize: number;
      excludeSuperSectors: string[];
      targetPatentsPerSuperSector: Record<string, number>;
    };
    strategicFill: {
      selectionMethod: string;
    };
  };
  sectorRotationOrder: string[];
  output: {
    jsonFile: string;
    csvPrefix: string;
    exportAllBatchesToCsv: boolean;
  };
}

interface PatentRecord {
  patent_id: string;
  title: string;
  years_remaining: number;
  competitor_citations: number;
  sector: string;
  super_sector: string;
  claim_breadth: number | null;
  overall_score: number | null;
}

interface BatchPatent {
  patent_id: string;
  title: string;
  overall_score: number;
  competitor_citations: number;
  years_remaining: number;
  super_sector: string;
  sector: string;
  claim_breadth: string;
  pool_rank: number;
}

interface Batch {
  batch_number: number;
  batch_name: string;
  batch_type: string;
  patents: BatchPatent[];
}

interface BatchOutput {
  generated_date: string;
  config_file: string;
  total_batches: number;
  total_patents: number;
  batch_size: number;
  cost_per_patent: number;
  total_cost: number;
  selection_criteria: {
    min_years_remaining: number;
    min_overall_score: number;
    strategy: string;
  };
  sector_distribution: Record<string, number>;
  batches: Batch[];
}

// ============================================================================
// HELPERS
// ============================================================================

function parseArgs(): { configPath: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let configPath = 'config/heatmap-batch-config.json';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { configPath, dryRun };
}

function loadConfig(configPath: string): BatchConfig {
  const fullPath = path.resolve(configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Config file not found: ${fullPath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
}

function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return val;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

function loadPortfolioFromCsv(): PatentRecord[] {
  const portfolioPath = path.resolve('output/ATTORNEY-PORTFOLIO-LATEST.csv');
  if (!fs.existsSync(portfolioPath)) {
    throw new Error(`Portfolio file not found: ${portfolioPath}`);
  }

  const csvContent = fs.readFileSync(portfolioPath, 'utf-8');
  const lines = csvContent.split('\n');
  const headers = parseCSVLine(lines[0]);
  const headerIndex: Record<string, number> = {};
  headers.forEach((h, i) => { headerIndex[h] = i; });

  const records: PatentRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const getVal = (col: string): string => {
      const idx = headerIndex[col];
      return idx !== undefined ? values[idx] || '' : '';
    };

    records.push({
      patent_id: getVal('patent_id'),
      title: getVal('title'),
      years_remaining: parseFloat(getVal('years_remaining')) || 0,
      competitor_citations: parseInt(getVal('competitor_citations')) || 0,
      sector: getVal('sector'),
      super_sector: getVal('super_sector') || 'unassigned',
      claim_breadth: getVal('claim_breadth') ? parseFloat(getVal('claim_breadth')) : null,
      overall_score: getVal('overall_score') ? parseFloat(getVal('overall_score')) : null,
    });
  }
  return records;
}

function filterEligiblePatents(patents: PatentRecord[], config: BatchConfig): PatentRecord[] {
  return patents.filter((p) => {
    if (p.overall_score === null) return false;
    if (p.years_remaining < config.selectionCriteria.minYearsRemaining) return false;
    if (p.overall_score < config.selectionCriteria.minOverallScore) return false;
    return true;
  });
}

function patentToOutput(p: PatentRecord, poolRank: number): BatchPatent {
  return {
    patent_id: p.patent_id,
    title: p.title.length > 80 ? p.title.substring(0, 80) + '...' : p.title,
    overall_score: Math.round((p.overall_score || 0) * 10) / 10,
    competitor_citations: p.competitor_citations,
    years_remaining: Math.round(p.years_remaining * 10) / 10,
    super_sector: p.super_sector || 'unassigned',
    sector: p.sector,
    claim_breadth: p.claim_breadth !== null ? String(p.claim_breadth) : '',
    pool_rank: poolRank,
  };
}

// ============================================================================
// BATCH GENERATION STRATEGIES
// ============================================================================

function generateHighValueSampledBatches(
  eligible: PatentRecord[],
  config: BatchConfig,
  usedPatents: Set<string>,
  batchCount: number,
  batchSize: number
): Batch[] {
  const batches: Batch[] = [];
  const poolSize = config.batchStrategy.highValueSampled.poolSize;

  // Get top N patents (pool)
  const pool = eligible.slice(0, poolSize).filter(p => !usedPatents.has(p.patent_id));

  // Group pool by super-sector
  const bySector: Record<string, { patent: PatentRecord; rank: number }[]> = {};
  pool.forEach((p, idx) => {
    const ss = p.super_sector || 'unassigned';
    if (!bySector[ss]) bySector[ss] = [];
    bySector[ss].push({ patent: p, rank: idx + 1 });
  });

  // Sort sectors by count (largest first for round-robin)
  const sectorOrder = Object.keys(bySector).sort((a, b) => bySector[b].length - bySector[a].length);

  // Distribute patents across batches using round-robin by sector
  // This ensures each batch has varied sectors
  const batchAssignments: { patent: PatentRecord; rank: number }[][] = [];
  for (let i = 0; i < batchCount; i++) {
    batchAssignments.push([]);
  }

  let batchIdx = 0;
  let anyAdded = true;

  while (anyAdded) {
    anyAdded = false;
    for (const ss of sectorOrder) {
      if (bySector[ss].length > 0) {
        const item = bySector[ss].shift()!;
        if (batchAssignments[batchIdx].length < batchSize) {
          batchAssignments[batchIdx].push(item);
          anyAdded = true;
        }
        batchIdx = (batchIdx + 1) % batchCount;
      }
    }
  }

  // Create batch objects
  for (let i = 0; i < batchCount; i++) {
    const patents = batchAssignments[i]
      .sort((a, b) => a.rank - b.rank) // Sort by original rank within batch
      .slice(0, batchSize);

    const batch: Batch = {
      batch_number: 0, // Will be set later
      batch_name: `High-Value Sampled ${i + 1}`,
      batch_type: 'high_value_sampled',
      patents: patents.map(item => {
        usedPatents.add(item.patent.patent_id);
        return patentToOutput(item.patent, item.rank);
      }),
    };
    batches.push(batch);
  }

  return batches;
}

function generateSectorDiversityBatches(
  eligible: PatentRecord[],
  config: BatchConfig,
  usedPatents: Set<string>,
  batchCount: number,
  batchSize: number
): Batch[] {
  const batches: Batch[] = [];
  const poolSize = config.batchStrategy.sectorDiversityNoSecurity.poolSize;
  const excludeSectors = config.batchStrategy.sectorDiversityNoSecurity.excludeSuperSectors;
  const targets = config.batchStrategy.sectorDiversityNoSecurity.targetPatentsPerSuperSector;

  // Get pool excluding SECURITY and used patents
  const pool = eligible.slice(0, poolSize).filter(p =>
    !usedPatents.has(p.patent_id) &&
    !excludeSectors.includes(p.super_sector)
  );

  // Group by super-sector with ranks
  const bySector: Record<string, { patent: PatentRecord; rank: number }[]> = {};
  pool.forEach((p, idx) => {
    const ss = p.super_sector || 'unassigned';
    if (!bySector[ss]) bySector[ss] = [];
    // Find actual rank in full eligible list
    const fullRank = eligible.findIndex(e => e.patent_id === p.patent_id) + 1;
    bySector[ss].push({ patent: p, rank: fullRank });
  });

  // Collect patents from each sector up to target
  const selectedPatents: { patent: PatentRecord; rank: number }[] = [];
  for (const ss of config.sectorRotationOrder) {
    const target = targets[ss] || 0;
    const available = bySector[ss] || [];
    const toTake = available.slice(0, target);
    selectedPatents.push(...toTake);
  }

  // Distribute across batches - round robin by sector for diversity
  const batchAssignments: { patent: PatentRecord; rank: number }[][] = [];
  for (let i = 0; i < batchCount; i++) {
    batchAssignments.push([]);
  }

  // Group selected by sector for round-robin distribution
  const selectedBySector: Record<string, { patent: PatentRecord; rank: number }[]> = {};
  for (const item of selectedPatents) {
    const ss = item.patent.super_sector;
    if (!selectedBySector[ss]) selectedBySector[ss] = [];
    selectedBySector[ss].push(item);
  }

  let batchIdx = 0;
  let anyAdded = true;

  while (anyAdded) {
    anyAdded = false;
    for (const ss of config.sectorRotationOrder) {
      if (selectedBySector[ss] && selectedBySector[ss].length > 0) {
        const item = selectedBySector[ss].shift()!;
        if (batchAssignments[batchIdx].length < batchSize) {
          batchAssignments[batchIdx].push(item);
          anyAdded = true;
        }
        batchIdx = (batchIdx + 1) % batchCount;
      }
    }
  }

  // Create batch objects
  for (let i = 0; i < batchCount; i++) {
    const patents = batchAssignments[i].slice(0, batchSize);

    const batch: Batch = {
      batch_number: 0,
      batch_name: `Sector Diversity ${i + 1}`,
      batch_type: 'sector_diversity_no_security',
      patents: patents.map(item => {
        usedPatents.add(item.patent.patent_id);
        return patentToOutput(item.patent, item.rank);
      }),
    };
    batches.push(batch);
  }

  return batches;
}

function generateStrategicFillBatch(
  eligible: PatentRecord[],
  usedPatents: Set<string>,
  batchSize: number,
  batchIndex: number
): Batch {
  const available = eligible.filter(p => !usedPatents.has(p.patent_id));
  const patents: BatchPatent[] = [];

  for (let i = 0; i < Math.min(batchSize, available.length); i++) {
    const p = available[i];
    const rank = eligible.findIndex(e => e.patent_id === p.patent_id) + 1;
    usedPatents.add(p.patent_id);
    patents.push(patentToOutput(p, rank));
  }

  return {
    batch_number: 0,
    batch_name: `Strategic Fill ${batchIndex}`,
    batch_type: 'strategic_fill',
    patents,
  };
}

// ============================================================================
// MAIN BATCH GENERATION
// ============================================================================

function generateBatches(patents: PatentRecord[], config: BatchConfig): Batch[] {
  const batchSize = config.batchSettings.batchSize;
  const totalBatches = config.batchSettings.totalBatches;

  // Filter and sort by overall score
  const eligible = filterEligiblePatents(patents, config);
  eligible.sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));

  const usedPatents = new Set<string>();
  const pattern = config.batchStrategy.interleavedPattern;

  // Count how many of each type we need
  const typeCounts = { high_value_sampled: 0, sector_diversity_no_security: 0, strategic_fill: 0 };
  for (const def of pattern.slice(0, totalBatches)) {
    typeCounts[def.type]++;
  }

  // Pre-generate batches for each type
  const highValueBatches = generateHighValueSampledBatches(
    eligible, config, usedPatents, typeCounts.high_value_sampled, batchSize
  );

  const sectorDiversityBatches = generateSectorDiversityBatches(
    eligible, config, usedPatents, typeCounts.sector_diversity_no_security, batchSize
  );

  // Now assemble final batch list following interleaved pattern
  const batches: Batch[] = [];
  const typeIndexes = { high_value_sampled: 0, sector_diversity_no_security: 0, strategic_fill: 0 };

  for (let i = 0; i < Math.min(pattern.length, totalBatches); i++) {
    const def = pattern[i];
    let batch: Batch;

    if (def.type === 'high_value_sampled') {
      batch = highValueBatches[typeIndexes.high_value_sampled++];
    } else if (def.type === 'sector_diversity_no_security') {
      batch = sectorDiversityBatches[typeIndexes.sector_diversity_no_security++];
    } else {
      typeIndexes.strategic_fill++;
      batch = generateStrategicFillBatch(eligible, usedPatents, batchSize, typeIndexes.strategic_fill);
    }

    batch.batch_number = i + 1;
    batches.push(batch);
  }

  return batches;
}

// ============================================================================
// OUTPUT
// ============================================================================

function calculateSectorDistribution(batches: Batch[]): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const batch of batches) {
    for (const p of batch.patents) {
      distribution[p.super_sector] = (distribution[p.super_sector] || 0) + 1;
    }
  }
  return distribution;
}

function printSummary(output: BatchOutput): void {
  console.log('='.repeat(90));
  console.log('HEAT MAP VENDOR BATCH GENERATION SUMMARY (v2)');
  console.log('='.repeat(90));

  console.log(`\nGenerated: ${output.generated_date}`);
  console.log(`Total Batches: ${output.total_batches} | Total Patents: ${output.total_patents}`);
  console.log(`Investment: $${output.total_cost.toLocaleString()} ($${output.cost_per_patent}/patent)`);

  console.log('\n' + '-'.repeat(90));
  console.log('BATCH SCHEDULE (Interleaved: High-Value + Sector Diversity)');
  console.log('-'.repeat(90));
  console.log(
    `${'Day'.padEnd(5)}${'Batch'.padEnd(7)}${'Type'.padEnd(28)}${'Patents'.padStart(8)}${'Score Range'.padStart(14)}${'Sectors'.padStart(8)}`
  );
  console.log('-'.repeat(90));

  let day = 1;
  for (let i = 0; i < output.batches.length; i++) {
    const batch = output.batches[i];
    if (batch.patents.length === 0) continue;

    const scores = batch.patents.map(p => p.overall_score);
    const scoreRange = `${Math.min(...scores).toFixed(0)}-${Math.max(...scores).toFixed(0)}`;
    const sectors = new Set(batch.patents.map(p => p.super_sector)).size;

    console.log(
      `${day.toString().padEnd(5)}${batch.batch_number.toString().padEnd(7)}${batch.batch_name.padEnd(28)}${batch.patents.length.toString().padStart(8)}${scoreRange.padStart(14)}${sectors.toString().padStart(8)}`
    );

    if (i % 2 === 1) day++;
  }

  console.log('\n' + '-'.repeat(90));
  console.log('SECTOR DISTRIBUTION ACROSS ALL BATCHES');
  console.log('-'.repeat(90));

  const totalPatents = output.total_patents;
  const sorted = Object.entries(output.sector_distribution).sort((a, b) => b[1] - a[1]);
  for (const [sector, count] of sorted) {
    const pct = (count / totalPatents) * 100;
    const bar = '█'.repeat(Math.floor(pct / 2));
    console.log(`${sector.padEnd(20)}${count.toString().padStart(4)} (${pct.toFixed(1).padStart(5)}%) ${bar}`);
  }

  // Show per-batch sector breakdown
  console.log('\n' + '-'.repeat(90));
  console.log('PER-BATCH SECTOR BREAKDOWN');
  console.log('-'.repeat(90));

  for (const batch of output.batches) {
    const sectorCounts: Record<string, number> = {};
    for (const p of batch.patents) {
      sectorCounts[p.super_sector] = (sectorCounts[p.super_sector] || 0) + 1;
    }
    const sectorStr = Object.entries(sectorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([s, c]) => `${s}:${c}`)
      .join(', ');
    console.log(`Batch ${batch.batch_number} (${batch.batch_type}): ${sectorStr}`);
  }

  console.log('\n' + '-'.repeat(90));
  console.log('BATCH 1 PREVIEW (High-Value Sampled)');
  console.log('-'.repeat(90));

  if (output.batches.length > 0 && output.batches[0].patents.length > 0) {
    console.log(
      `${'#'.padEnd(3)}${'Rank'.padEnd(5)}${'Patent'.padEnd(12)}${'Score'.padStart(7)}${'Cites'.padStart(6)}${'SuperSector'.padEnd(18)}${'Sector'.padEnd(20)}`
    );
    console.log('-'.repeat(90));
    for (let i = 0; i < Math.min(15, output.batches[0].patents.length); i++) {
      const p = output.batches[0].patents[i];
      console.log(
        `${(i + 1).toString().padEnd(3)}${p.pool_rank.toString().padEnd(5)}${p.patent_id.padEnd(12)}${p.overall_score.toFixed(1).padStart(7)}${p.competitor_citations.toString().padStart(6)} ${p.super_sector.padEnd(18)}${p.sector.padEnd(20)}`
      );
    }
  }
}

function saveBatchesToCsv(batches: Batch[], prefix: string): void {
  const headers = ['patent_id', 'title', 'overall_score', 'competitor_citations', 'years_remaining', 'super_sector', 'sector', 'claim_breadth', 'pool_rank'];

  for (const batch of batches) {
    const batchNum = String(batch.batch_number).padStart(3, '0');
    const filename = `output/${prefix}${batchNum}.csv`;

    const rows = [headers.join(',')];
    for (const p of batch.patents) {
      const row = [
        p.patent_id,
        csvEscape(p.title),
        String(p.overall_score),
        String(p.competitor_citations),
        String(p.years_remaining),
        p.super_sector,
        p.sector,
        p.claim_breadth,
        String(p.pool_rank),
      ];
      rows.push(row.join(','));
    }

    fs.writeFileSync(filename, rows.join('\n'));
    console.log(`  Saved: ${filename}`);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  console.log('Loading configuration...');
  const config = loadConfig(args.configPath);

  console.log('Loading portfolio...');
  const portfolio = loadPortfolioFromCsv();
  console.log(`  Total patents in portfolio: ${portfolio.length}`);

  const eligible = filterEligiblePatents(portfolio, config);
  console.log(`  Eligible patents: ${eligible.length}`);

  console.log('Generating batches (v2 strategy)...');
  const batches = generateBatches(portfolio, config);

  const totalPatents = batches.reduce((sum, b) => sum + b.patents.length, 0);

  const output: BatchOutput = {
    generated_date: new Date().toISOString().split('T')[0],
    config_file: args.configPath,
    total_batches: batches.length,
    total_patents: totalPatents,
    batch_size: config.batchSettings.batchSize,
    cost_per_patent: config.batchSettings.costPerPatent,
    total_cost: totalPatents * config.batchSettings.costPerPatent,
    selection_criteria: {
      min_years_remaining: config.selectionCriteria.minYearsRemaining,
      min_overall_score: config.selectionCriteria.minOverallScore,
      strategy: 'High-value sampled from top 100 + Sector diversity excluding SECURITY',
    },
    sector_distribution: calculateSectorDistribution(batches),
    batches,
  };

  printSummary(output);

  if (args.dryRun) {
    console.log('\n[DRY RUN] No files written.');
    return;
  }

  // Save outputs
  const jsonPath = `output/${config.output.jsonFile}`;
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved batch data to: ${jsonPath}`);

  const datedJsonPath = `output/heatmap-batches-${output.generated_date}.json`;
  fs.writeFileSync(datedJsonPath, JSON.stringify(output, null, 2));
  console.log(`Saved dated copy to: ${datedJsonPath}`);

  if (config.output.exportAllBatchesToCsv) {
    console.log('\nExporting batch CSVs...');
    saveBatchesToCsv(batches, config.output.csvPrefix);
  }

  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
