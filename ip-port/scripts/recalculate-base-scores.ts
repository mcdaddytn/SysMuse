/**
 * Recalculate Base Scores
 *
 * Updates the base score (V1) for patents in the portfolio.
 * V1 formula: forward_citations * 1.5 (0 if expired)
 *
 * Usage:
 *   npx tsx scripts/recalculate-base-scores.ts --affiliate "Brocade Communications"
 *   npx tsx scripts/recalculate-base-scores.ts --zero-scores-only
 *   npx tsx scripts/recalculate-base-scores.ts --all
 *   npx tsx scripts/recalculate-base-scores.ts --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

interface Patent {
  patent_id: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  affiliate?: string;
  [key: string]: any;
}

/**
 * Calculate V1 base score
 */
function calculateBaseScore(patent: Patent): number {
  // V1 formula: forward_citations * 1.5, 0 if expired
  if (patent.remaining_years <= 0) {
    return 0;
  }
  return (patent.forward_citations || 0) * 1.5;
}

/**
 * Load portfolio
 */
function loadPortfolio(): { filename: string; data: any } {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No streaming-candidates file found');
  }

  const filename = files[0];
  const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, filename), 'utf-8'));
  return { filename, data };
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const affiliateIdx = args.indexOf('--affiliate');
  const affiliateFilter = affiliateIdx !== -1 ? args[affiliateIdx + 1] : null;

  const zeroOnly = args.includes('--zero-scores-only');
  const all = args.includes('--all');
  const dryRun = args.includes('--dry-run');

  if (!affiliateFilter && !zeroOnly && !all) {
    console.log(`
Recalculate Base Scores - Update V1 scores in portfolio

Usage:
  npx tsx scripts/recalculate-base-scores.ts --affiliate "Brocade Communications"
  npx tsx scripts/recalculate-base-scores.ts --zero-scores-only
  npx tsx scripts/recalculate-base-scores.ts --all
  npx tsx scripts/recalculate-base-scores.ts --dry-run

V1 Formula: forward_citations * 1.5 (0 if expired)
`);
    process.exit(1);
  }

  // Load portfolio
  const { filename, data } = loadPortfolio();
  const patents: Patent[] = data.candidates;

  console.log(`Portfolio: ${patents.length.toLocaleString()} patents`);
  console.log(`File: ${filename}`);

  // Determine which patents to recalculate
  let toProcess: Patent[] = [];

  if (all) {
    toProcess = patents;
    console.log(`\nRecalculating ALL patents`);
  } else {
    toProcess = [...patents];

    if (affiliateFilter) {
      toProcess = toProcess.filter(p =>
        p.affiliate?.toLowerCase() === affiliateFilter.toLowerCase()
      );
      console.log(`\nFiltered to affiliate "${affiliateFilter}": ${toProcess.length} patents`);
    }

    if (zeroOnly) {
      toProcess = toProcess.filter(p => p.score === 0 || p.score === undefined);
      console.log(`Filtered to zero scores: ${toProcess.length} patents`);
    }
  }

  if (toProcess.length === 0) {
    console.log('\nNo patents to process');
    return;
  }

  // Calculate new scores
  let updated = 0;
  let unchanged = 0;
  const changes: Array<{ id: string; oldScore: number; newScore: number; fwd: number }> = [];

  for (const patent of toProcess) {
    const newScore = calculateBaseScore(patent);
    const oldScore = patent.score || 0;

    if (Math.abs(newScore - oldScore) > 0.001) {
      patent.score = newScore;
      updated++;
      changes.push({
        id: patent.patent_id,
        oldScore,
        newScore,
        fwd: patent.forward_citations || 0
      });
    } else {
      unchanged++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);

  if (changes.length > 0) {
    console.log(`\nSample changes (top 10 by new score):`);
    const topChanges = changes.sort((a, b) => b.newScore - a.newScore).slice(0, 10);
    for (const c of topChanges) {
      console.log(`  ${c.id} | ${c.oldScore.toFixed(1)} → ${c.newScore.toFixed(1)} (fwd=${c.fwd})`);
    }
  }

  if (dryRun) {
    console.log('\nDRY RUN - no changes saved');
    return;
  }

  if (updated > 0) {
    // Save updated portfolio
    data.metadata = data.metadata || {};
    data.metadata.lastScoreRecalc = new Date().toISOString();
    data.metadata.scoreRecalcCount = updated;

    const outputPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`\nSaved to: ${filename}`);
    console.log('\nNext: Reload API cache with POST /api/scores/reload');
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
