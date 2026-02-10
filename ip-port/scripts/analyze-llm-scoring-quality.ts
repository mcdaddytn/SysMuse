/**
 * Analyze LLM Scoring Quality
 *
 * Analyzes scoring data across the portfolio to identify:
 * - Score distributions by sector/super-sector
 * - Question response patterns
 * - Potential refactoring opportunities
 *
 * Usage:
 *   npx tsx scripts/analyze-llm-scoring-quality.ts
 *   npx tsx scripts/analyze-llm-scoring-quality.ts --sector=computing-runtime
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface ScoreStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  stdDev: number;
  quartiles: { q1: number; median: number; q3: number };
}

interface QuestionStats {
  fieldName: string;
  count: number;
  avg: number;
  stdDev: number;
  nullCount: number;
}

function parseArgs(): { sector?: string } {
  const args: { sector?: string } = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--sector=')) {
      args.sector = arg.split('=')[1];
    }
  });
  return args;
}

function calculateStats(values: number[]): ScoreStats {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, avg: 0, stdDev: 0, quartiles: { q1: 0, median: 0, q3: 0 } };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = values.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const avg = values.reduce((s, v) => s + v, 0) / count;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / count;
  const stdDev = Math.sqrt(variance);

  const q1 = sorted[Math.floor(count * 0.25)];
  const median = sorted[Math.floor(count * 0.5)];
  const q3 = sorted[Math.floor(count * 0.75)];

  return { count, min, max, avg, stdDev, quartiles: { q1, median, q3 } };
}

async function main() {
  const args = parseArgs();

  console.log('');
  console.log('='.repeat(80));
  console.log('LLM SCORING QUALITY ANALYSIS');
  console.log('='.repeat(80));
  console.log('');

  // Get all scores with sector info via raw query for efficiency
  const scores = await prisma.$queryRaw<Array<{
    id: string;
    patent_id: string;
    sub_sector_id: string;
    composite_score: number | null;
    metrics: any;
    sector_name: string;
    super_sector_name: string;
  }>>`
    SELECT
      pss.id,
      pss.patent_id,
      pss.sub_sector_id,
      pss.composite_score,
      pss.metrics,
      s.name as sector_name,
      ss.name as super_sector_name
    FROM patent_sub_sector_scores pss
    LEFT JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
    LEFT JOIN sectors s ON sub.sector_id = s.id
    LEFT JOIN super_sectors ss ON s.super_sector_id = ss.id
  `;

  console.log(`Total LLM score records: ${scores.length}`);

  // Group by super-sector
  const bySuperSector = new Map<string, typeof scores>();
  const bySector = new Map<string, typeof scores>();

  for (const score of scores) {
    const superSectorName = score.super_sector_name || 'unknown';
    const sectorName = score.sector_name || 'unknown';

    if (!bySuperSector.has(superSectorName)) bySuperSector.set(superSectorName, []);
    bySuperSector.get(superSectorName)!.push(score);

    if (!bySector.has(sectorName)) bySector.set(sectorName, []);
    bySector.get(sectorName)!.push(score);
  }

  // 1. SUPER-SECTOR ANALYSIS
  console.log('\n' + '─'.repeat(80));
  console.log('1. COMPOSITE SCORE DISTRIBUTION BY SUPER-SECTOR');
  console.log('─'.repeat(80));
  console.log('Super-Sector            | Count  | Min   | Max   | Avg   | StdDev | Median');
  console.log('─'.repeat(80));

  const superSectorStats: Array<{ name: string; stats: ScoreStats }> = [];

  for (const [name, sectorScores] of bySuperSector) {
    const composites = sectorScores
      .map(s => s.composite_score)
      .filter((c): c is number => c !== null);

    const stats = calculateStats(composites);
    superSectorStats.push({ name, stats });

    console.log(
      `${name.substring(0, 23).padEnd(23)} | ` +
      `${stats.count.toString().padStart(6)} | ` +
      `${stats.min.toFixed(1).padStart(5)} | ` +
      `${stats.max.toFixed(1).padStart(5)} | ` +
      `${stats.avg.toFixed(1).padStart(5)} | ` +
      `${stats.stdDev.toFixed(1).padStart(6)} | ` +
      `${stats.quartiles.median.toFixed(1).padStart(6)}`
    );
  }

  // 2. SECTOR-LEVEL ANALYSIS
  console.log('\n' + '─'.repeat(80));
  console.log('2. COMPOSITE SCORE DISTRIBUTION BY SECTOR (Top 20 by count)');
  console.log('─'.repeat(80));
  console.log('Sector                        | Count  | Avg   | StdDev | Min   | Max   | IQR');
  console.log('─'.repeat(80));

  const sectorStats: Array<{ name: string; stats: ScoreStats }> = [];

  for (const [name, sectorScores] of bySector) {
    const composites = sectorScores
      .map(s => s.composite_score)
      .filter((c): c is number => c !== null);

    const stats = calculateStats(composites);
    sectorStats.push({ name, stats });
  }

  // Sort by count and show top 20
  sectorStats.sort((a, b) => b.stats.count - a.stats.count);

  for (const { name, stats } of sectorStats.slice(0, 20)) {
    const iqr = stats.quartiles.q3 - stats.quartiles.q1;
    console.log(
      `${name.substring(0, 29).padEnd(29)} | ` +
      `${stats.count.toString().padStart(6)} | ` +
      `${stats.avg.toFixed(1).padStart(5)} | ` +
      `${stats.stdDev.toFixed(1).padStart(6)} | ` +
      `${stats.min.toFixed(1).padStart(5)} | ` +
      `${stats.max.toFixed(1).padStart(5)} | ` +
      `${iqr.toFixed(1).padStart(5)}`
    );
  }

  // 3. QUESTION-LEVEL ANALYSIS
  console.log('\n' + '─'.repeat(80));
  console.log('3. INDIVIDUAL QUESTION SCORE ANALYSIS');
  console.log('─'.repeat(80));

  // Get all unique question field names from metrics
  const questionStats = new Map<string, { scores: number[]; nullCount: number }>();

  for (const score of scores) {
    if (score.metrics && typeof score.metrics === 'object') {
      const metrics = score.metrics as Record<string, { score?: number }>;
      for (const [fieldName, metric] of Object.entries(metrics)) {
        if (!questionStats.has(fieldName)) {
          questionStats.set(fieldName, { scores: [], nullCount: 0 });
        }
        const qstat = questionStats.get(fieldName)!;
        if (metric && typeof metric.score === 'number') {
          qstat.scores.push(metric.score);
        } else {
          qstat.nullCount++;
        }
      }
    }
  }

  console.log('Question Field               | Count  | Avg   | StdDev | Min | Max | NullRate');
  console.log('─'.repeat(80));

  const qStatArray: Array<{ name: string; count: number; avg: number; stdDev: number; min: number; max: number; nullRate: number }> = [];

  for (const [name, qstat] of questionStats) {
    const stats = calculateStats(qstat.scores);
    const nullRate = qstat.nullCount / (stats.count + qstat.nullCount);
    qStatArray.push({
      name,
      count: stats.count,
      avg: stats.avg,
      stdDev: stats.stdDev,
      min: stats.min,
      max: stats.max,
      nullRate
    });
  }

  qStatArray.sort((a, b) => b.count - a.count);

  for (const q of qStatArray) {
    console.log(
      `${q.name.substring(0, 28).padEnd(28)} | ` +
      `${q.count.toString().padStart(6)} | ` +
      `${q.avg.toFixed(2).padStart(5)} | ` +
      `${q.stdDev.toFixed(2).padStart(6)} | ` +
      `${q.min.toFixed(0).padStart(3)} | ` +
      `${q.max.toFixed(0).padStart(3)} | ` +
      `${(q.nullRate * 100).toFixed(1).padStart(6)}%`
    );
  }

  // 4. SCORE DISTRIBUTION ANOMALIES
  console.log('\n' + '─'.repeat(80));
  console.log('4. POTENTIAL ISSUES & REFACTORING OPPORTUNITIES');
  console.log('─'.repeat(80));

  // High variance sectors (potential for sub-sector split)
  console.log('\n4a. HIGH VARIANCE SECTORS (stdDev > 15, count > 100) - candidates for sub-sector split:');
  const highVariance = sectorStats.filter(s => s.stats.stdDev > 15 && s.stats.count > 100);
  if (highVariance.length === 0) {
    console.log('    None found');
  } else {
    for (const { name, stats } of highVariance) {
      console.log(`    - ${name}: stdDev=${stats.stdDev.toFixed(1)}, count=${stats.count}, range=${stats.min.toFixed(1)}-${stats.max.toFixed(1)}`);
    }
  }

  // Low count sectors (potential merge candidates)
  console.log('\n4b. LOW COUNT SECTORS (count < 50) - candidates for merge:');
  const lowCount = sectorStats.filter(s => s.stats.count < 50 && s.stats.count > 0);
  if (lowCount.length === 0) {
    console.log('    None found');
  } else {
    for (const { name, stats } of lowCount.sort((a, b) => a.stats.count - b.stats.count)) {
      console.log(`    - ${name}: count=${stats.count}, avg=${stats.avg.toFixed(1)}`);
    }
  }

  // Questions with high null rates
  console.log('\n4c. QUESTIONS WITH HIGH NULL RATE (>20%) - data quality issues:');
  const highNull = qStatArray.filter(q => q.nullRate > 0.2);
  if (highNull.length === 0) {
    console.log('    None found');
  } else {
    for (const q of highNull.sort((a, b) => b.nullRate - a.nullRate)) {
      console.log(`    - ${q.name}: nullRate=${(q.nullRate * 100).toFixed(1)}%, count=${q.count}`);
    }
  }

  // Questions with low variance (not discriminating)
  console.log('\n4d. QUESTIONS WITH LOW VARIANCE (stdDev < 1.0) - may not discriminate well:');
  const lowVarianceQ = qStatArray.filter(q => q.stdDev < 1.0 && q.count > 1000);
  if (lowVarianceQ.length === 0) {
    console.log('    None found');
  } else {
    for (const q of lowVarianceQ) {
      console.log(`    - ${q.name}: stdDev=${q.stdDev.toFixed(2)}, avg=${q.avg.toFixed(2)}, count=${q.count}`);
    }
  }

  // 5. TEMPLATE USAGE SUMMARY
  console.log('\n' + '─'.repeat(80));
  console.log('5. SCORING TEMPLATE COVERAGE');
  console.log('─'.repeat(80));

  // Load template configs
  const configDir = path.join(process.cwd(), 'config', 'scoring-templates');
  let templateCount = { superSector: 0, sector: 0, subSector: 0 };

  if (fs.existsSync(path.join(configDir, 'super-sectors'))) {
    templateCount.superSector = fs.readdirSync(path.join(configDir, 'super-sectors')).filter(f => f.endsWith('.json')).length;
  }
  if (fs.existsSync(path.join(configDir, 'sectors'))) {
    templateCount.sector = fs.readdirSync(path.join(configDir, 'sectors')).filter(f => f.endsWith('.json')).length;
  }
  if (fs.existsSync(path.join(configDir, 'sub-sectors'))) {
    templateCount.subSector = fs.readdirSync(path.join(configDir, 'sub-sectors')).filter(f => f.endsWith('.json')).length;
  }

  console.log(`Templates configured:`);
  console.log(`  - Super-sector templates: ${templateCount.superSector}`);
  console.log(`  - Sector templates: ${templateCount.sector}`);
  console.log(`  - Sub-sector templates: ${templateCount.subSector}`);
  console.log(`\nActual sectors with LLM scores: ${bySector.size}`);
  console.log(`Actual super-sectors with LLM scores: ${bySuperSector.size}`);

  // 6. OVERALL SUMMARY
  console.log('\n' + '─'.repeat(80));
  console.log('6. OVERALL PORTFOLIO SUMMARY');
  console.log('─'.repeat(80));

  const allComposites = scores
    .map(s => s.composite_score)
    .filter((c): c is number => c !== null);

  const overallStats = calculateStats(allComposites);

  console.log(`Total scored patents: ${new Set(scores.map(s => s.patent_id)).size}`);
  console.log(`Total score records: ${scores.length}`);
  console.log(`Composite Score Distribution:`);
  console.log(`  - Range: ${overallStats.min.toFixed(1)} - ${overallStats.max.toFixed(1)}`);
  console.log(`  - Average: ${overallStats.avg.toFixed(1)}`);
  console.log(`  - Std Dev: ${overallStats.stdDev.toFixed(1)}`);
  console.log(`  - Quartiles: Q1=${overallStats.quartiles.q1.toFixed(1)}, Median=${overallStats.quartiles.median.toFixed(1)}, Q3=${overallStats.quartiles.q3.toFixed(1)}`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
