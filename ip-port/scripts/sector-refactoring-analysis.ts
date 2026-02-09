/**
 * Sector Refactoring Analysis
 *
 * Comprehensive analysis of all sectors to recommend:
 * - Sectors to split (high variance, large count)
 * - Sectors to merge (low count, similar characteristics)
 * - Sectors with scoring anomalies
 *
 * Usage:
 *   npx tsx scripts/sector-refactoring-analysis.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SectorStats {
  name: string;
  superSector: string;
  count: number;
  avg: number;
  stdDev: number;
  min: number;
  max: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
}

function calculateStats(values: number[]): {
  avg: number;
  stdDev: number;
  min: number;
  max: number;
  median: number;
  q1: number;
  q3: number;
} {
  if (values.length === 0) {
    return { avg: 0, stdDev: 0, min: 0, max: 0, median: 0, q1: 0, q3: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = values.length;
  const avg = values.reduce((s, v) => s + v, 0) / count;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / count;

  return {
    avg,
    stdDev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[count - 1],
    median: sorted[Math.floor(count / 2)],
    q1: sorted[Math.floor(count * 0.25)],
    q3: sorted[Math.floor(count * 0.75)]
  };
}

async function main() {
  console.log('');
  console.log('='.repeat(90));
  console.log('SECTOR REFACTORING ANALYSIS');
  console.log('='.repeat(90));
  console.log('');

  // Get all scores with sector info
  const scores = await prisma.$queryRaw<Array<{
    patent_id: string;
    composite_score: number;
    sector_name: string;
    super_sector_name: string;
  }>>`
    SELECT
      pss.patent_id,
      pss.composite_score,
      s.name as sector_name,
      ss.name as super_sector_name
    FROM patent_sub_sector_scores pss
    LEFT JOIN sub_sectors sub ON pss.sub_sector_id = sub.id
    LEFT JOIN sectors s ON sub.sector_id = s.id
    LEFT JOIN super_sectors ss ON s.super_sector_id = ss.id
  `;

  console.log(`Total score records: ${scores.length}`);

  // Group by sector
  const bySector = new Map<string, { superSector: string; scores: number[] }>();

  for (const score of scores) {
    const sectorName = score.sector_name || 'unknown';
    const superSector = score.super_sector_name || 'unknown';

    if (!bySector.has(sectorName)) {
      bySector.set(sectorName, { superSector, scores: [] });
    }
    if (score.composite_score !== null) {
      bySector.get(sectorName)!.scores.push(Number(score.composite_score));
    }
  }

  // Calculate stats for each sector
  const sectorStats: SectorStats[] = [];

  for (const [name, data] of bySector) {
    if (data.scores.length === 0) continue;

    const stats = calculateStats(data.scores);
    sectorStats.push({
      name,
      superSector: data.superSector,
      count: data.scores.length,
      ...stats,
      iqr: stats.q3 - stats.q1
    });
  }

  // Sort by count
  sectorStats.sort((a, b) => b.count - a.count);

  // Portfolio-wide stats
  const allScores = scores.map(s => Number(s.composite_score)).filter(s => !isNaN(s));
  const portfolioStats = calculateStats(allScores);

  console.log(`\nPortfolio baseline: avg=${portfolioStats.avg.toFixed(1)}, stdDev=${portfolioStats.stdDev.toFixed(1)}`);

  // 1. SPLIT CANDIDATES (high variance OR large count)
  console.log('\n' + '─'.repeat(90));
  console.log('1. SPLIT CANDIDATES (stdDev > 12 OR count > 1000)');
  console.log('─'.repeat(90));
  console.log('Sector                        | Super-Sector    | Count  | Avg   | StdDev | Range       | Recommendation');
  console.log('─'.repeat(90));

  const splitCandidates = sectorStats.filter(s => s.stdDev > 12 || s.count > 1000);

  for (const s of splitCandidates) {
    const range = `${s.min.toFixed(0)}-${s.max.toFixed(0)}`;
    let recommendation = '';

    if (s.stdDev > 15) recommendation = 'HIGH PRIORITY SPLIT';
    else if (s.stdDev > 12 && s.count > 500) recommendation = 'Consider split';
    else if (s.count > 2000) recommendation = 'Large - evaluate sub-groups';
    else recommendation = 'Monitor';

    console.log(
      `${s.name.substring(0, 29).padEnd(29)} | ` +
      `${s.superSector.substring(0, 15).padEnd(15)} | ` +
      `${s.count.toString().padStart(6)} | ` +
      `${s.avg.toFixed(1).padStart(5)} | ` +
      `${s.stdDev.toFixed(1).padStart(6)} | ` +
      `${range.padStart(11)} | ` +
      `${recommendation}`
    );
  }

  // 2. MERGE CANDIDATES (low count)
  console.log('\n' + '─'.repeat(90));
  console.log('2. MERGE CANDIDATES (count < 50)');
  console.log('─'.repeat(90));
  console.log('Sector                        | Super-Sector    | Count  | Avg   | StdDev | Merge Target Suggestion');
  console.log('─'.repeat(90));

  const mergeCandidates = sectorStats.filter(s => s.count < 50 && s.count > 0);
  mergeCandidates.sort((a, b) => a.count - b.count);

  for (const s of mergeCandidates) {
    // Suggest merge target based on super-sector and score similarity
    const sameSuperSector = sectorStats.filter(
      other => other.superSector === s.superSector &&
               other.name !== s.name &&
               other.count >= 50 &&
               Math.abs(other.avg - s.avg) < 10
    );

    let suggestion = '';
    if (sameSuperSector.length > 0) {
      const closest = sameSuperSector.sort((a, b) => Math.abs(a.avg - s.avg) - Math.abs(b.avg - s.avg))[0];
      suggestion = `→ ${closest.name.substring(0, 25)}`;
    } else {
      suggestion = `→ ${s.superSector} (super-sector)`;
    }

    console.log(
      `${s.name.substring(0, 29).padEnd(29)} | ` +
      `${s.superSector.substring(0, 15).padEnd(15)} | ` +
      `${s.count.toString().padStart(6)} | ` +
      `${s.avg.toFixed(1).padStart(5)} | ` +
      `${s.stdDev.toFixed(1).padStart(6)} | ` +
      `${suggestion}`
    );
  }

  // 3. SCORE ANOMALIES (avg significantly different from portfolio)
  console.log('\n' + '─'.repeat(90));
  console.log('3. SCORE ANOMALIES (avg differs from portfolio by >10 points)');
  console.log('─'.repeat(90));
  console.log('Sector                        | Super-Sector    | Count  | Avg   | Diff  | Issue');
  console.log('─'.repeat(90));

  const anomalies = sectorStats.filter(s => Math.abs(s.avg - portfolioStats.avg) > 10 && s.count >= 20);
  anomalies.sort((a, b) => Math.abs(b.avg - portfolioStats.avg) - Math.abs(a.avg - portfolioStats.avg));

  for (const s of anomalies) {
    const diff = s.avg - portfolioStats.avg;
    const diffStr = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
    const issue = diff < -10 ? 'LOW - review template' : 'HIGH - may be inflated';

    console.log(
      `${s.name.substring(0, 29).padEnd(29)} | ` +
      `${s.superSector.substring(0, 15).padEnd(15)} | ` +
      `${s.count.toString().padStart(6)} | ` +
      `${s.avg.toFixed(1).padStart(5)} | ` +
      `${diffStr.padStart(5)} | ` +
      `${issue}`
    );
  }

  // 4. SUPER-SECTOR SUMMARY
  console.log('\n' + '─'.repeat(90));
  console.log('4. SUPER-SECTOR SUMMARY');
  console.log('─'.repeat(90));

  const bySuperSector = new Map<string, SectorStats[]>();
  for (const s of sectorStats) {
    if (!bySuperSector.has(s.superSector)) bySuperSector.set(s.superSector, []);
    bySuperSector.get(s.superSector)!.push(s);
  }

  console.log('Super-Sector     | Sectors | Patents | Avg Score | Recommendations');
  console.log('─'.repeat(90));

  for (const [superSector, sectors] of bySuperSector) {
    const totalPatents = sectors.reduce((s, sec) => s + sec.count, 0);
    const avgScore = sectors.reduce((s, sec) => s + sec.avg * sec.count, 0) / totalPatents;

    const splitCount = sectors.filter(s => s.stdDev > 12).length;
    const mergeCount = sectors.filter(s => s.count < 50).length;

    let recs: string[] = [];
    if (splitCount > 0) recs.push(`${splitCount} split candidates`);
    if (mergeCount > 0) recs.push(`${mergeCount} merge candidates`);
    if (recs.length === 0) recs.push('OK');

    console.log(
      `${superSector.substring(0, 16).padEnd(16)} | ` +
      `${sectors.length.toString().padStart(7)} | ` +
      `${totalPatents.toString().padStart(7)} | ` +
      `${avgScore.toFixed(1).padStart(9)} | ` +
      `${recs.join(', ')}`
    );
  }

  // 5. RECOMMENDED ACTIONS
  console.log('\n' + '─'.repeat(90));
  console.log('5. PRIORITIZED RECOMMENDATIONS');
  console.log('─'.repeat(90));

  const highPrioritySplits = sectorStats.filter(s => s.stdDev > 14 && s.count > 100);
  const highPriorityMerges = sectorStats.filter(s => s.count < 20);
  const templateReviews = anomalies.filter(a => a.avg < portfolioStats.avg - 15);

  console.log('\nHIGH PRIORITY SPLITS (run analyze-sector-for-split.ts):');
  if (highPrioritySplits.length === 0) {
    console.log('  None');
  } else {
    for (const s of highPrioritySplits.slice(0, 5)) {
      console.log(`  - ${s.name}: stdDev=${s.stdDev.toFixed(1)}, count=${s.count}`);
    }
  }

  console.log('\nHIGH PRIORITY MERGES (< 20 patents):');
  if (highPriorityMerges.length === 0) {
    console.log('  None');
  } else {
    for (const s of highPriorityMerges) {
      console.log(`  - ${s.name}: count=${s.count}, superSector=${s.superSector}`);
    }
  }

  console.log('\nTEMPLATE REVIEWS NEEDED (avg < 36):');
  if (templateReviews.length === 0) {
    console.log('  None');
  } else {
    for (const s of templateReviews) {
      console.log(`  - ${s.name}: avg=${s.avg.toFixed(1)}, count=${s.count}`);
    }
  }

  console.log('\n' + '='.repeat(90));

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
