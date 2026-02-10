/**
 * Analyze Sector for Sub-Sector Split
 *
 * Analyzes a high-variance sector to identify natural sub-groupings
 * based on LLM response patterns, question scores, and patent characteristics.
 *
 * Usage:
 *   npx tsx scripts/analyze-sector-for-split.ts --sector=video-server-cdn
 *   npx tsx scripts/analyze-sector-for-split.ts --sector=video-server-cdn --clusters=4
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

interface PatentAnalysis {
  patentId: string;
  compositeScore: number;
  metrics: Record<string, MetricScore>;
  questionScores: Record<string, number>;
  cluster?: number;
}

function parseArgs(): {
  sector: string;
  clusters: number;
} {
  const args = {
    sector: 'video-server-cdn',
    clusters: 3
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--sector=')) args.sector = arg.split('=')[1];
    if (arg.startsWith('--clusters=')) args.clusters = parseInt(arg.split('=')[1]);
  });

  return args;
}

// Simple k-means-like clustering based on question scores
function clusterPatents(patents: PatentAnalysis[], k: number, questionKeys: string[]): PatentAnalysis[] {
  if (patents.length < k) return patents;

  // Initialize centroids using k-means++ style (spread out initial picks)
  const centroids: number[][] = [];
  const usedIndices = new Set<number>();

  // First centroid: random
  let idx = Math.floor(Math.random() * patents.length);
  usedIndices.add(idx);
  centroids.push(questionKeys.map(q => patents[idx].questionScores[q] || 0));

  // Remaining centroids: pick furthest from existing
  for (let c = 1; c < k; c++) {
    let maxDist = -1;
    let bestIdx = 0;

    for (let i = 0; i < patents.length; i++) {
      if (usedIndices.has(i)) continue;

      const vec = questionKeys.map(q => patents[i].questionScores[q] || 0);
      const minDistToCentroid = Math.min(...centroids.map(cent => euclideanDist(vec, cent)));

      if (minDistToCentroid > maxDist) {
        maxDist = minDistToCentroid;
        bestIdx = i;
      }
    }

    usedIndices.add(bestIdx);
    centroids.push(questionKeys.map(q => patents[bestIdx].questionScores[q] || 0));
  }

  // Iterate k-means
  for (let iter = 0; iter < 20; iter++) {
    // Assign to nearest centroid
    for (const patent of patents) {
      const vec = questionKeys.map(q => patent.questionScores[q] || 0);
      let minDist = Infinity;
      let bestCluster = 0;

      for (let c = 0; c < k; c++) {
        const dist = euclideanDist(vec, centroids[c]);
        if (dist < minDist) {
          minDist = dist;
          bestCluster = c;
        }
      }

      patent.cluster = bestCluster;
    }

    // Update centroids
    for (let c = 0; c < k; c++) {
      const members = patents.filter(p => p.cluster === c);
      if (members.length === 0) continue;

      for (let q = 0; q < questionKeys.length; q++) {
        const qKey = questionKeys[q];
        centroids[c][q] = members.reduce((s, p) => s + (p.questionScores[qKey] || 0), 0) / members.length;
      }
    }
  }

  return patents;
}

function euclideanDist(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.pow((a[i] || 0) - (b[i] || 0), 2);
  }
  return Math.sqrt(sum);
}

async function main() {
  const args = parseArgs();

  console.log('');
  console.log('='.repeat(80));
  console.log(`SECTOR SPLIT ANALYSIS: ${args.sector}`);
  console.log('='.repeat(80));
  console.log('');

  // Get sector's sub-sector IDs
  const subSectors = await prisma.subSector.findMany({
    where: {
      sector: { name: args.sector }
    },
    select: { id: true, name: true }
  });

  if (subSectors.length === 0) {
    console.log(`No sub-sectors found for sector: ${args.sector}`);
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${subSectors.length} sub-sectors in ${args.sector}`);

  // Fetch all scores for this sector
  const scores = await prisma.patentSubSectorScore.findMany({
    where: {
      subSectorId: { in: subSectors.map(s => s.id) }
    }
  });

  console.log(`Found ${scores.length} patent scores`);
  console.log('');

  // Build patent analysis objects
  const patents: PatentAnalysis[] = scores.map(s => {
    const metrics = s.metrics as Record<string, MetricScore>;
    const questionScores: Record<string, number> = {};

    for (const [key, metric] of Object.entries(metrics)) {
      if (metric && typeof metric.score === 'number') {
        questionScores[key] = metric.score;
      }
    }

    return {
      patentId: s.patentId,
      compositeScore: s.compositeScore || 0,
      metrics,
      questionScores
    };
  });

  // Find common questions (present in >50% of patents)
  const questionCounts = new Map<string, number>();
  for (const p of patents) {
    for (const q of Object.keys(p.questionScores)) {
      questionCounts.set(q, (questionCounts.get(q) || 0) + 1);
    }
  }

  const commonQuestions = Array.from(questionCounts.entries())
    .filter(([_, count]) => count > patents.length * 0.5)
    .map(([q, _]) => q)
    .sort();

  console.log(`Common questions (>50% coverage): ${commonQuestions.length}`);

  // 1. SCORE DISTRIBUTION ANALYSIS
  console.log('\n' + '─'.repeat(80));
  console.log('1. SCORE DISTRIBUTION');
  console.log('─'.repeat(80));

  const composites = patents.map(p => p.compositeScore);
  composites.sort((a, b) => a - b);

  const min = composites[0];
  const max = composites[composites.length - 1];
  const avg = composites.reduce((s, c) => s + c, 0) / composites.length;
  const median = composites[Math.floor(composites.length / 2)];
  const stdDev = Math.sqrt(composites.reduce((s, c) => s + Math.pow(c - avg, 2), 0) / composites.length);

  console.log(`Count: ${patents.length}`);
  console.log(`Range: ${min.toFixed(1)} - ${max.toFixed(1)}`);
  console.log(`Average: ${avg.toFixed(1)}`);
  console.log(`Median: ${median.toFixed(1)}`);
  console.log(`Std Dev: ${stdDev.toFixed(1)}`);

  // Score buckets
  const buckets = [
    { label: '0-20', count: composites.filter(c => c < 20).length },
    { label: '20-40', count: composites.filter(c => c >= 20 && c < 40).length },
    { label: '40-60', count: composites.filter(c => c >= 40 && c < 60).length },
    { label: '60-80', count: composites.filter(c => c >= 60 && c < 80).length },
    { label: '80-100', count: composites.filter(c => c >= 80).length }
  ];

  console.log('\nScore Distribution:');
  for (const b of buckets) {
    const pct = (b.count / patents.length * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(b.count / patents.length * 40));
    console.log(`  ${b.label.padEnd(6)}: ${b.count.toString().padStart(4)} (${pct.padStart(5)}%) ${bar}`);
  }

  // 2. QUESTION-LEVEL VARIANCE ANALYSIS
  console.log('\n' + '─'.repeat(80));
  console.log('2. QUESTION VARIANCE (highest variance = best for splitting)');
  console.log('─'.repeat(80));

  const questionVariance: Array<{ question: string; avg: number; stdDev: number; range: string }> = [];

  for (const q of commonQuestions) {
    const values = patents.map(p => p.questionScores[q]).filter(v => v !== undefined);
    if (values.length < patents.length * 0.3) continue;

    const qAvg = values.reduce((s, v) => s + v, 0) / values.length;
    const qVar = values.reduce((s, v) => s + Math.pow(v - qAvg, 2), 0) / values.length;
    const qStdDev = Math.sqrt(qVar);
    const qMin = Math.min(...values);
    const qMax = Math.max(...values);

    questionVariance.push({
      question: q,
      avg: qAvg,
      stdDev: qStdDev,
      range: `${qMin.toFixed(0)}-${qMax.toFixed(0)}`
    });
  }

  questionVariance.sort((a, b) => b.stdDev - a.stdDev);

  console.log('Question                      | Avg   | StdDev | Range');
  console.log('─'.repeat(60));
  for (const qv of questionVariance.slice(0, 15)) {
    console.log(
      `${qv.question.substring(0, 29).padEnd(29)} | ` +
      `${qv.avg.toFixed(1).padStart(5)} | ` +
      `${qv.stdDev.toFixed(2).padStart(6)} | ` +
      `${qv.range}`
    );
  }

  // 3. CLUSTERING ANALYSIS
  console.log('\n' + '─'.repeat(80));
  console.log(`3. CLUSTER ANALYSIS (k=${args.clusters})`);
  console.log('─'.repeat(80));

  // Use top variance questions for clustering
  const clusterQuestions = questionVariance.slice(0, 8).map(qv => qv.question);
  console.log(`Clustering on: ${clusterQuestions.join(', ')}`);
  console.log('');

  const clusteredPatents = clusterPatents(patents, args.clusters, clusterQuestions);

  // Analyze each cluster
  for (let c = 0; c < args.clusters; c++) {
    const members = clusteredPatents.filter(p => p.cluster === c);
    if (members.length === 0) continue;

    const clusterComposites = members.map(m => m.compositeScore);
    const clusterAvg = clusterComposites.reduce((s, v) => s + v, 0) / members.length;
    const clusterMin = Math.min(...clusterComposites);
    const clusterMax = Math.max(...clusterComposites);

    console.log(`\nCLUSTER ${c + 1}: ${members.length} patents (${(members.length / patents.length * 100).toFixed(1)}%)`);
    console.log(`  Composite Score: avg=${clusterAvg.toFixed(1)}, range=${clusterMin.toFixed(1)}-${clusterMax.toFixed(1)}`);

    // Show distinguishing question scores
    console.log('  Distinguishing question averages:');
    for (const q of clusterQuestions.slice(0, 5)) {
      const qValues = members.map(m => m.questionScores[q]).filter(v => v !== undefined);
      if (qValues.length === 0) continue;
      const qAvg = qValues.reduce((s, v) => s + v, 0) / qValues.length;
      const overallAvg = questionVariance.find(qv => qv.question === q)?.avg || 0;
      const diff = qAvg - overallAvg;
      const diffStr = diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
      console.log(`    ${q.substring(0, 25).padEnd(25)}: ${qAvg.toFixed(1)} (${diffStr} vs avg)`);
    }

    // Sample patents
    console.log('  Sample patents:');
    const samples = members.slice(0, 3);
    for (const s of samples) {
      console.log(`    - ${s.patentId}: score=${s.compositeScore.toFixed(1)}`);
    }
  }

  // 4. SUGGESTED SUB-SECTOR SPLIT
  console.log('\n' + '─'.repeat(80));
  console.log('4. SUGGESTED SUB-SECTOR SPLIT');
  console.log('─'.repeat(80));

  // Analyze cluster characteristics to suggest names
  for (let c = 0; c < args.clusters; c++) {
    const members = clusteredPatents.filter(p => p.cluster === c);
    if (members.length === 0) continue;

    // Find most distinctive questions for this cluster
    const distinctiveScores: Array<{ question: string; diff: number }> = [];
    for (const q of clusterQuestions) {
      const qValues = members.map(m => m.questionScores[q]).filter(v => v !== undefined);
      if (qValues.length === 0) continue;
      const qAvg = qValues.reduce((s, v) => s + v, 0) / qValues.length;
      const overallAvg = questionVariance.find(qv => qv.question === q)?.avg || 0;
      distinctiveScores.push({ question: q, diff: qAvg - overallAvg });
    }

    distinctiveScores.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const highScoreQ = distinctiveScores.filter(d => d.diff > 0.5).map(d => d.question);
    const lowScoreQ = distinctiveScores.filter(d => d.diff < -0.5).map(d => d.question);

    console.log(`\nSub-Sector ${c + 1} Characteristics:`);
    console.log(`  Count: ${members.length} patents`);
    if (highScoreQ.length > 0) {
      console.log(`  High scores on: ${highScoreQ.slice(0, 3).join(', ')}`);
    }
    if (lowScoreQ.length > 0) {
      console.log(`  Low scores on: ${lowScoreQ.slice(0, 3).join(', ')}`);
    }

    // Suggest name based on characteristics
    const topDistinctive = distinctiveScores[0]?.question || 'general';
    console.log(`  Suggested focus: ${topDistinctive.replace(/_/g, ' ')}`);
  }

  // 5. REASONING ANALYSIS (sample)
  console.log('\n' + '─'.repeat(80));
  console.log('5. SAMPLE REASONING ANALYSIS');
  console.log('─'.repeat(80));

  // Get samples from each cluster to show reasoning patterns
  for (let c = 0; c < Math.min(args.clusters, 2); c++) {
    const members = clusteredPatents.filter(p => p.cluster === c);
    if (members.length === 0) continue;

    console.log(`\nCluster ${c + 1} Sample Reasoning:`);

    const sample = members[0];
    const topQ = clusterQuestions[0];

    if (sample.metrics[topQ]?.reasoning) {
      console.log(`  Patent ${sample.patentId} - ${topQ}:`);
      const reasoning = sample.metrics[topQ].reasoning || '';
      // Truncate to first 200 chars
      const truncated = reasoning.length > 200 ? reasoning.substring(0, 200) + '...' : reasoning;
      console.log(`    "${truncated}"`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
