/**
 * Generate Heat Map Vendor Batches
 *
 * Creates batches of patents for submission to heat map vendor based on
 * configurable selection criteria and sector distribution targets.
 *
 * Usage:
 *   npx tsx scripts/generate-heatmap-batches.ts
 *   npx tsx scripts/generate-heatmap-batches.ts --config config/heatmap-batch-config.json
 *   npx tsx scripts/generate-heatmap-batches.ts --dry-run
 *   npx tsx scripts/generate-heatmap-batches.ts --batch-size 30 --total-batches 5
 *
 * Configuration: config/heatmap-batch-config.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// INTERFACES
// ============================================================================

interface InterleavedBatchDef {
  type: 'high_value' | 'sector_diversity' | 'strategic_fill';
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
    claimBreadthWeight: number;
  };
  batchStrategy: {
    mode?: 'sequential' | 'interleaved';
    interleavedPattern?: InterleavedBatchDef[];
    highValueBatches: { count: number; description: string; selectionMethod: string };
    sectorDiversityBatches: { count: number; description: string; selectionMethod: string; patentsPerSectorPerBatch: number };
    strategicFillBatches: { count: number; description: string; selectionMethod: string };
  };
  sectorQuotas: Record<string, { target: number; priority: number }>;
  sectorRotationOrder: string[];
  minorSectorsMapToOther: string[];
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
}

interface Batch {
  batch_number: number;
  batch_name: string;
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

function parseArgs(): { configPath: string; dryRun: boolean; batchSize?: number; totalBatches?: number } {
  const args = process.argv.slice(2);
  let configPath = 'config/heatmap-batch-config.json';
  let dryRun = false;
  let batchSize: number | undefined;
  let totalBatches: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && args[i + 1]) {
      configPath = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--total-batches' && args[i + 1]) {
      totalBatches = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { configPath, dryRun, batchSize, totalBatches };
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

function loadPortfolioFromCsv(): PatentRecord[] {
  const portfolioPath = path.resolve('output/ATTORNEY-PORTFOLIO-LATEST.csv');
  if (!fs.existsSync(portfolioPath)) {
    throw new Error(`Portfolio file not found: ${portfolioPath}`);
  }

  const csvContent = fs.readFileSync(portfolioPath, 'utf-8');
  const lines = csvContent.split('\n');

  // Parse header
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);
  const headerIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    headerIndex[h] = i;
  });

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

function filterEligiblePatents(
  patents: PatentRecord[],
  config: BatchConfig
): PatentRecord[] {
  return patents.filter((p) => {
    if (p.overall_score === null) return false;
    if (p.years_remaining < config.selectionCriteria.minYearsRemaining) return false;
    if (p.overall_score < config.selectionCriteria.minOverallScore) return false;
    return true;
  });
}

function patentToOutput(p: PatentRecord): BatchPatent {
  return {
    patent_id: p.patent_id,
    title: p.title.length > 80 ? p.title.substring(0, 80) + '...' : p.title,
    overall_score: Math.round((p.overall_score || 0) * 10) / 10,
    competitor_citations: p.competitor_citations,
    years_remaining: Math.round(p.years_remaining * 10) / 10,
    super_sector: p.super_sector || 'unassigned',
    sector: p.sector,
    claim_breadth: p.claim_breadth !== null ? String(p.claim_breadth) : '',
  };
}

// ============================================================================
// BATCH GENERATION
// ============================================================================

function generateBatches(
  patents: PatentRecord[],
  config: BatchConfig,
  overrides: { batchSize?: number; totalBatches?: number }
): Batch[] {
  const batchSize = overrides.batchSize || config.batchSettings.batchSize;
  const totalBatches = overrides.totalBatches || config.batchSettings.totalBatches;

  // Filter and sort by overall score
  const eligible = filterEligiblePatents(patents, config);
  eligible.sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));

  // Group by super sector
  const bySector: Record<string, PatentRecord[]> = {};
  for (const p of eligible) {
    const ss = p.super_sector || 'unassigned';
    if (!bySector[ss]) bySector[ss] = [];
    bySector[ss].push(p);
  }

  const batches: Batch[] = [];
  const usedPatents = new Set<string>();

  function addToBatch(
    sourcePatents: PatentRecord[],
    batchNum: number,
    batchName: string
  ): Batch {
    const batch: Batch = {
      batch_number: batchNum,
      batch_name: batchName,
      patents: [],
    };

    for (const p of sourcePatents) {
      if (usedPatents.has(p.patent_id)) continue;
      batch.patents.push(patentToOutput(p));
      usedPatents.add(p.patent_id);
      if (batch.patents.length >= batchSize) break;
    }

    return batch;
  }

  function createHighValueBatch(batchNum: number, typeIndex: number): Batch {
    return addToBatch(eligible, batchNum, `High-Value Discovery ${typeIndex}`);
  }

  function createSectorDiversityBatch(batchNum: number, typeIndex: number): Batch {
    const patentsPerSector = config.batchStrategy.sectorDiversityBatches.patentsPerSectorPerBatch;
    const batchPatents: PatentRecord[] = [];

    // Rotate through sectors
    for (const ss of config.sectorRotationOrder) {
      const available = (bySector[ss] || []).filter((p) => !usedPatents.has(p.patent_id));
      for (let j = 0; j < patentsPerSector && j < available.length; j++) {
        batchPatents.push(available[j]);
      }
    }

    // Fill remaining from SECURITY (usually deepest pool)
    const securityAvailable = (bySector['SECURITY'] || []).filter(
      (p) => !usedPatents.has(p.patent_id)
    );
    batchPatents.push(...securityAvailable);

    // Sort by score and create batch
    batchPatents.sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));
    return addToBatch(batchPatents, batchNum, `Sector Diversity ${typeIndex}`);
  }

  function createStrategicFillBatch(batchNum: number, typeIndex: number): Batch {
    const remaining = eligible.filter((p) => !usedPatents.has(p.patent_id));
    return addToBatch(remaining, batchNum, `Strategic Fill ${typeIndex}`);
  }

  // Check if using interleaved mode
  const mode = config.batchStrategy.mode || 'sequential';

  if (mode === 'interleaved' && config.batchStrategy.interleavedPattern) {
    // Use the interleaved pattern from config
    const pattern = config.batchStrategy.interleavedPattern;
    const typeCounts: Record<string, number> = { high_value: 0, sector_diversity: 0, strategic_fill: 0 };

    for (let i = 0; i < Math.min(pattern.length, totalBatches); i++) {
      const def = pattern[i];
      typeCounts[def.type]++;
      const batchNum = i + 1;

      let batch: Batch;
      if (def.type === 'high_value') {
        batch = createHighValueBatch(batchNum, typeCounts.high_value);
      } else if (def.type === 'sector_diversity') {
        batch = createSectorDiversityBatch(batchNum, typeCounts.sector_diversity);
      } else {
        batch = createStrategicFillBatch(batchNum, typeCounts.strategic_fill);
      }
      batches.push(batch);
    }
  } else {
    // Sequential mode (original behavior)
    const highValueCount = config.batchStrategy.highValueBatches.count;
    const sectorDiversityCount = config.batchStrategy.sectorDiversityBatches.count;
    const strategicFillCount = config.batchStrategy.strategicFillBatches.count;

    let batchNum = 1;

    // High-Value Batches (top by score)
    for (let i = 0; i < highValueCount && batchNum <= totalBatches; i++) {
      batches.push(createHighValueBatch(batchNum, i + 1));
      batchNum++;
    }

    // Sector Diversity Batches
    for (let i = 0; i < sectorDiversityCount && batchNum <= totalBatches; i++) {
      batches.push(createSectorDiversityBatch(batchNum, i + 1));
      batchNum++;
    }

    // Strategic Fill Batches
    for (let i = 0; i < strategicFillCount && batchNum <= totalBatches; i++) {
      batches.push(createStrategicFillBatch(batchNum, i + 1));
      batchNum++;
    }
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
  console.log('='.repeat(80));
  console.log('HEAT MAP VENDOR BATCH GENERATION SUMMARY');
  console.log('='.repeat(80));

  console.log(`\nGenerated: ${output.generated_date}`);
  console.log(`Config: ${output.config_file}`);
  console.log(`Total Batches: ${output.total_batches}`);
  console.log(`Batch Size: ${output.batch_size}`);
  console.log(`Total Patents: ${output.total_patents}`);
  console.log(`Cost per Patent: $${output.cost_per_patent}`);
  console.log(`Total Investment: $${output.total_cost.toLocaleString()}`);

  console.log('\n' + '-'.repeat(80));
  console.log('BATCH DETAILS');
  console.log('-'.repeat(80));
  console.log(
    `${'Batch'.padEnd(8)}${'Name'.padEnd(25)}${'Patents'.padStart(8)}${'Score Range'.padStart(15)}${'Avg Score'.padStart(12)}`
  );
  console.log('-'.repeat(80));

  for (const batch of output.batches) {
    if (batch.patents.length === 0) continue;
    const scores = batch.patents.map((p) => p.overall_score);
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    const avgS = scores.reduce((a, b) => a + b, 0) / scores.length;
    const scoreRange = `${minS.toFixed(1)}-${maxS.toFixed(1)}`;
    console.log(
      `${String(batch.batch_number).padEnd(8)}${batch.batch_name.padEnd(25)}${String(batch.patents.length).padStart(8)}${scoreRange.padStart(15)}${avgS.toFixed(1).padStart(12)}`
    );
  }

  console.log('\n' + '-'.repeat(80));
  console.log('SECTOR DISTRIBUTION');
  console.log('-'.repeat(80));

  const totalPatents = output.total_patents;
  const sorted = Object.entries(output.sector_distribution).sort((a, b) => b[1] - a[1]);
  for (const [sector, count] of sorted) {
    const pct = (count / totalPatents) * 100;
    const bar = '█'.repeat(Math.floor(pct / 2));
    console.log(`${sector.padEnd(20)}${String(count).padStart(4)} (${pct.toFixed(1).padStart(5)}%) ${bar}`);
  }

  console.log('\n' + '-'.repeat(80));
  console.log('BATCH 1 PREVIEW (First 10 Patents)');
  console.log('-'.repeat(80));

  if (output.batches.length > 0 && output.batches[0].patents.length > 0) {
    console.log(
      `${'#'.padEnd(3)}${'Patent'.padEnd(12)}${'Score'.padStart(7)}${'Cites'.padStart(7)}${'Yrs'.padStart(6)}${'Sector'.padEnd(20)}`
    );
    console.log('-'.repeat(80));
    for (let i = 0; i < Math.min(10, output.batches[0].patents.length); i++) {
      const p = output.batches[0].patents[i];
      console.log(
        `${String(i + 1).padEnd(3)}${p.patent_id.padEnd(12)}${p.overall_score.toFixed(1).padStart(7)}${String(p.competitor_citations).padStart(7)}${p.years_remaining.toFixed(1).padStart(6)} ${p.super_sector.padEnd(20)}`
      );
    }
  }
}

function saveBatchesToCsv(batches: Batch[], prefix: string): void {
  const headers = ['patent_id', 'title', 'overall_score', 'competitor_citations', 'years_remaining', 'super_sector', 'sector', 'claim_breadth'];

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

  const eligibleCount = filterEligiblePatents(portfolio, config).length;
  console.log(`  Eligible patents (score >= ${config.selectionCriteria.minOverallScore}, years > ${config.selectionCriteria.minYearsRemaining}): ${eligibleCount}`);

  console.log('Generating batches...');
  const batches = generateBatches(portfolio, config, {
    batchSize: args.batchSize,
    totalBatches: args.totalBatches,
  });

  const totalPatents = batches.reduce((sum, b) => sum + b.patents.length, 0);
  const batchSize = args.batchSize || config.batchSettings.batchSize;

  const output: BatchOutput = {
    generated_date: new Date().toISOString().split('T')[0],
    config_file: args.configPath,
    total_batches: batches.length,
    total_patents: totalPatents,
    batch_size: batchSize,
    cost_per_patent: config.batchSettings.costPerPatent,
    total_cost: totalPatents * config.batchSettings.costPerPatent,
    selection_criteria: {
      min_years_remaining: config.selectionCriteria.minYearsRemaining,
      min_overall_score: config.selectionCriteria.minOverallScore,
      strategy: 'High-value first, then sector diversity, then fill',
    },
    sector_distribution: calculateSectorDistribution(batches),
    batches,
  };

  printSummary(output);

  if (args.dryRun) {
    console.log('\n[DRY RUN] No files written.');
    return;
  }

  // Save JSON output
  const jsonPath = `output/${config.output.jsonFile}`;
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nSaved batch data to: ${jsonPath}`);

  // Save dated copy
  const datedJsonPath = `output/heatmap-batches-${output.generated_date}.json`;
  fs.writeFileSync(datedJsonPath, JSON.stringify(output, null, 2));
  console.log(`Saved dated copy to: ${datedJsonPath}`);

  // Export CSVs
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
