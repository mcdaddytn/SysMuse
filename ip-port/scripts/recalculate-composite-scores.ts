/**
 * Recalculate Composite Scores
 *
 * Re-calculates composite scores using existing LLM metric responses with new weights.
 * Does NOT re-run any LLM calls - just re-applies weighting formulas.
 *
 * Usage:
 *   npx tsx scripts/recalculate-composite-scores.ts --dry-run              # Preview changes
 *   npx tsx scripts/recalculate-composite-scores.ts --sector=rf-acoustic   # Single sector
 *   npx tsx scripts/recalculate-composite-scores.ts --weights-file=custom-weights.json
 *   npx tsx scripts/recalculate-composite-scores.ts --apply                # Apply changes to DB
 *
 * Weight file format:
 * {
 *   "technical_novelty": 0.15,
 *   "claim_breadth": 0.10,
 *   ...
 * }
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface MetricScore {
  score: number;
  reasoning?: string;
  confidence?: number;
}

interface WeightConfig {
  [fieldName: string]: number;
}

interface RecalculationResult {
  patentId: string;
  sectorName: string;
  oldScore: number;
  newScore: number;
  delta: number;
  metricsUsed: string[];
}

function parseArgs(): {
  dryRun: boolean;
  apply: boolean;
  sector?: string;
  weightsFile?: string;
  showDetails: boolean;
} {
  const args = {
    dryRun: true,
    apply: false,
    sector: undefined as string | undefined,
    weightsFile: undefined as string | undefined,
    showDetails: false
  };

  process.argv.slice(2).forEach(arg => {
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--apply') {
      args.apply = true;
      args.dryRun = false;
    }
    if (arg === '--details') args.showDetails = true;
    if (arg.startsWith('--sector=')) args.sector = arg.split('=')[1];
    if (arg.startsWith('--weights-file=')) args.weightsFile = arg.split('=')[1];
  });

  return args;
}

// Default weights (from portfolio-default template)
const DEFAULT_WEIGHTS: WeightConfig = {
  technical_novelty: 0.20,
  claim_breadth: 0.15,
  design_around_difficulty: 0.20,
  market_relevance: 0.15,
  implementation_clarity: 0.15,
  standards_relevance: 0.15,
  unique_value: 0.10
};

// Question scales (min-max for normalization)
const QUESTION_SCALES: { [key: string]: { min: number; max: number } } = {
  // Default 1-10 scale for most questions
  default: { min: 1, max: 10 }
};

function normalizeScore(rawScore: number, fieldName: string): number {
  const scale = QUESTION_SCALES[fieldName] || QUESTION_SCALES.default;
  return (rawScore - scale.min) / (scale.max - scale.min);
}

function calculateCompositeScore(
  metrics: Record<string, MetricScore>,
  weights: WeightConfig
): { score: number; metricsUsed: string[] } {
  let weightedSum = 0;
  let totalWeight = 0;
  const metricsUsed: string[] = [];

  for (const [fieldName, weight] of Object.entries(weights)) {
    const metric = metrics[fieldName];
    if (metric && typeof metric.score === 'number' && weight > 0) {
      const normalizedScore = normalizeScore(metric.score, fieldName);
      weightedSum += normalizedScore * weight;
      totalWeight += weight;
      metricsUsed.push(fieldName);
    }
  }

  if (totalWeight === 0) return { score: 0, metricsUsed: [] };

  // Return score on 0-100 scale, rounded to 2 decimal places
  const score = Math.round((weightedSum / totalWeight) * 100 * 100) / 100;
  return { score, metricsUsed };
}

function loadWeightsFromFile(filePath: string): WeightConfig {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content);
}

async function main() {
  const args = parseArgs();

  console.log('');
  console.log('='.repeat(80));
  console.log('COMPOSITE SCORE RECALCULATION TOOL');
  console.log('='.repeat(80));
  console.log(`Mode: ${args.apply ? 'APPLY CHANGES' : 'DRY RUN (preview only)'}`);

  // Load weights
  let weights = DEFAULT_WEIGHTS;
  if (args.weightsFile) {
    weights = loadWeightsFromFile(args.weightsFile);
    console.log(`Using custom weights from: ${args.weightsFile}`);
  } else {
    console.log('Using default portfolio weights');
  }

  console.log('\nWeights being applied:');
  for (const [field, weight] of Object.entries(weights)) {
    console.log(`  ${field}: ${weight}`);
  }
  console.log('');

  // Build query
  const whereClause: any = {};
  if (args.sector) {
    // Get sector's sub-sector IDs
    const subSectors = await prisma.subSector.findMany({
      where: {
        sector: { name: args.sector }
      },
      select: { id: true }
    });
    whereClause.subSectorId = { in: subSectors.map(s => s.id) };
    console.log(`Filtering to sector: ${args.sector} (${subSectors.length} sub-sectors)`);
  }

  // Fetch all scores with sector info via raw query
  let query = `
    SELECT
      pss.id,
      pss.patent_id as "patentId",
      pss.sub_sector_id as "subSectorId",
      pss.composite_score as "compositeScore",
      pss.metrics,
      s.name as "sectorName"
    FROM patent_sub_sector_scores pss
    LEFT JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
    LEFT JOIN sectors s ON sub.sector_id = s.id
  `;

  if (whereClause.subSectorId) {
    query += ` WHERE pss.sub_sector_id IN (${whereClause.subSectorId.in.map((id: string) => `'${id}'`).join(',')})`;
  }

  const scores = await prisma.$queryRawUnsafe<Array<{
    id: string;
    patentId: string;
    subSectorId: string;
    compositeScore: number | null;
    metrics: any;
    sectorName: string;
  }>>(query);

  console.log(`Processing ${scores.length} score records...`);
  console.log('');

  const results: RecalculationResult[] = [];
  let totalDeltaSum = 0;
  let significantChanges = 0;

  for (const score of scores) {
    const metrics = (typeof score.metrics === 'string' ? JSON.parse(score.metrics) : score.metrics) as Record<string, MetricScore>;
    const oldScore = Number(score.compositeScore) || 0;

    const { score: newScore, metricsUsed } = calculateCompositeScore(metrics, weights);
    const delta = newScore - oldScore;

    results.push({
      patentId: score.patentId,
      sectorName: score.sectorName || 'unknown',
      oldScore,
      newScore,
      delta,
      metricsUsed
    });

    totalDeltaSum += Math.abs(delta);
    if (Math.abs(delta) > 5) significantChanges++;
  }

  // Statistics
  const deltas = results.map(r => r.delta);
  const avgDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const avgAbsDelta = totalDeltaSum / results.length;
  const maxIncrease = Math.max(...deltas);
  const maxDecrease = Math.min(...deltas);

  console.log('─'.repeat(80));
  console.log('RECALCULATION SUMMARY');
  console.log('─'.repeat(80));
  console.log(`Total records processed: ${results.length}`);
  console.log(`Average delta: ${avgDelta.toFixed(2)}`);
  console.log(`Average absolute delta: ${avgAbsDelta.toFixed(2)}`);
  console.log(`Max increase: +${maxIncrease.toFixed(2)}`);
  console.log(`Max decrease: ${maxDecrease.toFixed(2)}`);
  console.log(`Significant changes (|delta| > 5): ${significantChanges}`);

  // Distribution of changes
  const buckets = {
    noChange: results.filter(r => Math.abs(r.delta) < 0.5).length,
    small: results.filter(r => Math.abs(r.delta) >= 0.5 && Math.abs(r.delta) < 2).length,
    medium: results.filter(r => Math.abs(r.delta) >= 2 && Math.abs(r.delta) < 5).length,
    large: results.filter(r => Math.abs(r.delta) >= 5 && Math.abs(r.delta) < 10).length,
    veryLarge: results.filter(r => Math.abs(r.delta) >= 10).length
  };

  console.log('\nChange Distribution:');
  console.log(`  No change (<0.5):     ${buckets.noChange} (${(buckets.noChange/results.length*100).toFixed(1)}%)`);
  console.log(`  Small (0.5-2):        ${buckets.small} (${(buckets.small/results.length*100).toFixed(1)}%)`);
  console.log(`  Medium (2-5):         ${buckets.medium} (${(buckets.medium/results.length*100).toFixed(1)}%)`);
  console.log(`  Large (5-10):         ${buckets.large} (${(buckets.large/results.length*100).toFixed(1)}%)`);
  console.log(`  Very Large (>10):     ${buckets.veryLarge} (${(buckets.veryLarge/results.length*100).toFixed(1)}%)`);

  // Show details if requested
  if (args.showDetails) {
    console.log('\n' + '─'.repeat(80));
    console.log('TOP 20 LARGEST CHANGES');
    console.log('─'.repeat(80));
    console.log('Patent ID  | Sector                | Old   | New   | Delta  | Metrics Used');
    console.log('─'.repeat(80));

    const sortedByDelta = [...results].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    for (const r of sortedByDelta.slice(0, 20)) {
      const deltaStr = r.delta >= 0 ? `+${r.delta.toFixed(1)}` : r.delta.toFixed(1);
      console.log(
        `${r.patentId.padEnd(10)} | ` +
        `${r.sectorName.substring(0, 21).padEnd(21)} | ` +
        `${r.oldScore.toFixed(1).padStart(5)} | ` +
        `${r.newScore.toFixed(1).padStart(5)} | ` +
        `${deltaStr.padStart(6)} | ` +
        `${r.metricsUsed.length} questions`
      );
    }
  }

  // Apply changes if requested
  if (args.apply) {
    console.log('\n' + '─'.repeat(80));
    console.log('APPLYING CHANGES TO DATABASE...');
    console.log('─'.repeat(80));

    let updated = 0;
    for (const result of results) {
      if (Math.abs(result.delta) >= 0.01) {
        await prisma.patentSubSectorScore.updateMany({
          where: {
            patentId: result.patentId
          },
          data: {
            compositeScore: result.newScore
          }
        });
        updated++;
      }
    }

    console.log(`Updated ${updated} records.`);
  } else {
    console.log('\n' + '─'.repeat(80));
    console.log('DRY RUN - No changes applied.');
    console.log('Run with --apply to apply changes to the database.');
    console.log('Run with --details to see individual patent changes.');
    console.log('─'.repeat(80));
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
