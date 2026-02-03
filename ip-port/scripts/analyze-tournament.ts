#!/usr/bin/env npx tsx
/**
 * Tournament Analysis Script
 *
 * Usage:
 *   npx tsx scripts/analyze-tournament.ts <command> [options]
 *
 * Commands:
 *   list                    - List all tournaments
 *   status <id>             - Check tournament status/error
 *   validate <id>           - Validate patent IDs in all clusters
 *   summary <id>            - Show tournament summary
 *   cluster <id> <round> <num> - Show specific cluster details
 *   finalists <id>          - List finalist patent IDs (newline-delimited)
 *   compare <id>            - Compare input vs output IDs for hallucination check
 */

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'output', 'tournaments');

function listTournaments() {
  const dirs = fs.readdirSync(OUTPUT_DIR).filter(d =>
    fs.statSync(path.join(OUTPUT_DIR, d)).isDirectory()
  ).sort().reverse();

  console.log('=== Tournaments ===');
  for (const dir of dirs.slice(0, 10)) {
    const summaryPath = path.join(OUTPUT_DIR, dir, 'summary.json');
    const errorPath = path.join(OUTPUT_DIR, dir, 'error.json');
    const configPath = path.join(OUTPUT_DIR, dir, 'config.json');

    let status = 'unknown';
    let name = '';

    if (fs.existsSync(summaryPath)) {
      status = 'complete';
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      name = summary.name || '';
    } else if (fs.existsSync(errorPath)) {
      status = 'ERROR';
      const error = JSON.parse(fs.readFileSync(errorPath, 'utf-8'));
      name = error.error?.substring(0, 50) + '...';
    } else if (fs.existsSync(configPath)) {
      status = 'running/incomplete';
    }

    console.log(`${dir}  [${status}]  ${name}`);
  }
}

function showStatus(tournamentId: string) {
  const tournamentDir = path.join(OUTPUT_DIR, tournamentId);

  if (!fs.existsSync(tournamentDir)) {
    console.log(`Tournament not found: ${tournamentId}`);
    return;
  }

  console.log(`=== Tournament: ${tournamentId} ===\n`);

  // Check for error
  const errorPath = path.join(tournamentDir, 'error.json');
  if (fs.existsSync(errorPath)) {
    const error = JSON.parse(fs.readFileSync(errorPath, 'utf-8'));
    console.log('STATUS: ERROR');
    console.log('Error:', error.error);
    console.log('Timestamp:', error.timestamp);
    return;
  }

  // Check for completion
  const summaryPath = path.join(tournamentDir, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    console.log('STATUS: COMPLETE');
    console.log('Name:', summary.name);
    console.log('Input patents:', summary.inputPatentCount);
    console.log('Finalists:', summary.finalistCount || summary.round2AdvancingCount);
    console.log('Tier 1:', summary.tier1Count);
    console.log('Duration:', Math.round(summary.durationMs / 1000), 'seconds');
    return;
  }

  // Check progress
  console.log('STATUS: IN PROGRESS');
  const rounds = fs.readdirSync(tournamentDir).filter(f => f.startsWith('round-'));
  for (const round of rounds.sort()) {
    const roundDir = path.join(tournamentDir, round);
    const clusters = fs.readdirSync(roundDir).filter(f => f.startsWith('cluster-'));
    console.log(`${round}: ${clusters.length} clusters completed`);
  }
}

function validatePatentIds(tournamentId: string) {
  const tournamentDir = path.join(OUTPUT_DIR, tournamentId);

  if (!fs.existsSync(tournamentDir)) {
    console.log(`Tournament not found: ${tournamentId}`);
    return;
  }

  console.log(`=== Validating Patent IDs: ${tournamentId} ===\n`);

  let totalClusters = 0;
  let validClusters = 0;
  let invalidIds: string[] = [];

  const rounds = fs.readdirSync(tournamentDir).filter(f => f.startsWith('round-')).sort();

  for (const round of rounds) {
    const roundDir = path.join(tournamentDir, round);
    const clusterFiles = fs.readdirSync(roundDir).filter(f => f.startsWith('cluster-') && f.endsWith('.json'));

    for (const file of clusterFiles) {
      totalClusters++;
      const cluster = JSON.parse(fs.readFileSync(path.join(roundDir, file), 'utf-8'));
      const inputIds = new Set(cluster.patentIds);
      const ranking = cluster.clusterRanking || cluster.llmResponse?.cluster_ranking || [];

      const invalid = ranking.filter((id: string) => !inputIds.has(id));

      if (invalid.length === 0) {
        validClusters++;
      } else {
        console.log(`${round}/${file}: ${invalid.length} invalid IDs`);
        console.log(`  Invalid: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '...' : ''}`);
        console.log(`  Valid should be: ${cluster.patentIds.slice(0, 3).join(', ')}`);
        invalidIds.push(...invalid);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Clusters: ${validClusters}/${totalClusters} valid`);
  console.log(`Invalid IDs found: ${invalidIds.length}`);

  if (invalidIds.length > 0) {
    console.log(`\nHALLUCINATION DETECTED - Tournament has invalid patent IDs`);
  } else {
    console.log(`\nALL VALID - No hallucinations detected`);
  }
}

function showSummary(tournamentId: string) {
  const summaryPath = path.join(OUTPUT_DIR, tournamentId, 'summary.json');

  if (!fs.existsSync(summaryPath)) {
    console.log(`Summary not found for: ${tournamentId}`);
    return;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  console.log(JSON.stringify(summary, null, 2));
}

function showCluster(tournamentId: string, round: string, clusterNum: string) {
  const clusterPath = path.join(OUTPUT_DIR, tournamentId, `round-${round}`, `cluster-${clusterNum.padStart(3, '0')}.json`);

  if (!fs.existsSync(clusterPath)) {
    console.log(`Cluster not found: ${clusterPath}`);
    return;
  }

  const cluster = JSON.parse(fs.readFileSync(clusterPath, 'utf-8'));

  console.log(`=== Round ${round}, Cluster ${clusterNum} ===\n`);
  console.log('Input Patent IDs:');
  console.log(cluster.patentIds.join(', '));
  console.log('\nLLM Cluster Ranking:');
  console.log((cluster.clusterRanking || cluster.llmResponse?.cluster_ranking || []).join(', '));
  console.log('\nAdvancing Patents:');
  console.log((cluster.advancingPatents || []).join(', '));
  console.log('\nDark Horse:', cluster.darkHorse || cluster.llmResponse?.top_dark_horse || 'none');
}

function showFinalists(tournamentId: string) {
  const finalPath = path.join(OUTPUT_DIR, tournamentId, 'final-synthesis.json');

  if (!fs.existsSync(finalPath)) {
    // Try to get from last round summary
    const summaryPath = path.join(OUTPUT_DIR, tournamentId, 'summary.json');
    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      const allPatents = [
        ...(summary.summary?.tier1Patents || []),
        ...(summary.summary?.tier2Patents || []),
        ...(summary.summary?.tier3Patents || []),
      ];
      console.log(allPatents.join('\n'));
      return;
    }
    console.log(`Final synthesis not found for: ${tournamentId}`);
    return;
  }

  const final = JSON.parse(fs.readFileSync(finalPath, 'utf-8'));
  const uniqueIds = [...new Set(final.finalistIds || [])];
  console.log(uniqueIds.join('\n'));
}

function compareIds(tournamentId: string) {
  const tournamentDir = path.join(OUTPUT_DIR, tournamentId);

  console.log(`=== Compare Input vs Output IDs: ${tournamentId} ===\n`);

  const rounds = fs.readdirSync(tournamentDir).filter(f => f.startsWith('round-')).sort();

  for (const round of rounds) {
    const roundDir = path.join(tournamentDir, round);
    const clusterFile = path.join(roundDir, 'cluster-000.json');

    if (fs.existsSync(clusterFile)) {
      const cluster = JSON.parse(fs.readFileSync(clusterFile, 'utf-8'));
      const inputIds = cluster.patentIds;
      const outputIds = cluster.clusterRanking || cluster.llmResponse?.cluster_ranking || [];

      console.log(`=== ${round} Cluster 0 ===`);
      console.log('INPUT  (first 5):', inputIds.slice(0, 5).join(', '));
      console.log('OUTPUT (first 5):', outputIds.slice(0, 5).join(', '));

      const inputSet = new Set(inputIds);
      const matchCount = outputIds.filter((id: string) => inputSet.has(id)).length;
      console.log(`Match: ${matchCount}/${outputIds.length} (${Math.round(100*matchCount/outputIds.length)}%)\n`);
    }
  }
}

// Main
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];
const arg3 = process.argv[5];

switch (command) {
  case 'list':
    listTournaments();
    break;
  case 'status':
    showStatus(arg1);
    break;
  case 'validate':
    validatePatentIds(arg1);
    break;
  case 'summary':
    showSummary(arg1);
    break;
  case 'cluster':
    showCluster(arg1, arg2, arg3);
    break;
  case 'finalists':
    showFinalists(arg1);
    break;
  case 'compare':
    compareIds(arg1);
    break;
  default:
    console.log(`
Tournament Analysis Script

Usage:
  npx tsx scripts/analyze-tournament.ts <command> [options]

Commands:
  list                         - List all tournaments
  status <id>                  - Check tournament status/error
  validate <id>                - Validate patent IDs in all clusters
  summary <id>                 - Show tournament summary
  cluster <id> <round> <num>   - Show specific cluster details
  finalists <id>               - List finalist patent IDs
  compare <id>                 - Compare input vs output IDs
    `);
}
