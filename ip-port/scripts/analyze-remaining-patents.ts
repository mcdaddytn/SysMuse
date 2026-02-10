/**
 * Analyze Remaining Patents
 *
 * Breaks down unscored patents by type, year, and score to estimate actual work needed.
 *
 * Usage:
 *   npx tsx scripts/analyze-remaining-patents.ts
 *   npx tsx scripts/analyze-remaining-patents.ts --sector=computing-runtime
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

interface Candidate {
  patent_id: string;
  patent_date: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  primary_sector?: string;
  [key: string]: any;
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

function loadCandidates(): Candidate[] {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort().reverse();
  const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, files[0]), 'utf-8'));
  return data.candidates;
}

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    const candidates = loadCandidates();
    console.log(`Loaded ${candidates.length} candidates`);

    // Get scored patents
    const scored = await prisma.$queryRaw<{ patent_id: string }[]>`
      SELECT DISTINCT patent_id FROM patent_sub_sector_scores
    `;
    const scoredSet = new Set(scored.map(p => p.patent_id));

    // Filter to unscored
    let unscored = candidates.filter(c => !scoredSet.has(c.patent_id));

    if (args.sector) {
      unscored = unscored.filter(c => c.primary_sector === args.sector);
      console.log(`Filtered to sector: ${args.sector}`);
    }

    console.log(`Total unscored: ${unscored.length}`);
    console.log('');

    // Categorize
    const designPatents = unscored.filter(p => p.patent_id.startsWith('D'));
    const pre2005 = unscored.filter(p => {
      if (p.patent_id.startsWith('D')) return false;
      const year = new Date(p.patent_date).getFullYear();
      return year < 2005;
    });
    const lowScore = unscored.filter(p => {
      if (p.patent_id.startsWith('D')) return false;
      const year = new Date(p.patent_date).getFullYear();
      if (year < 2005) return false;
      return (p.score || 0) < 3;
    });
    const expired = unscored.filter(p => {
      if (p.patent_id.startsWith('D')) return false;
      return (p.remaining_years || 0) <= 0;
    });

    // Scorable = not design, not pre-2005, score >= 3
    const scorable = unscored.filter(p => {
      if (p.patent_id.startsWith('D')) return false;
      const year = new Date(p.patent_date).getFullYear();
      if (year < 2005) return false;
      if ((p.score || 0) < 3) return false;
      return true;
    });

    console.log('='.repeat(70));
    console.log('Breakdown of Unscored Patents:');
    console.log('='.repeat(70));
    console.log(`Design patents (D-prefix):        ${designPatents.length.toString().padStart(6)}`);
    console.log(`Pre-2005 utility patents:         ${pre2005.length.toString().padStart(6)}`);
    console.log(`Low score (<3) post-2005:         ${lowScore.length.toString().padStart(6)}`);
    console.log(`Expired (0 years remaining):      ${expired.length.toString().padStart(6)}`);
    console.log('-'.repeat(70));
    console.log(`SCORABLE (post-2005, score>=3):   ${scorable.length.toString().padStart(6)}`);
    console.log('');

    // Break down scorable by sector
    const bySector = new Map<string, Candidate[]>();
    for (const p of scorable) {
      const sector = p.primary_sector || 'unknown';
      if (!bySector.has(sector)) bySector.set(sector, []);
      bySector.get(sector)!.push(p);
    }

    // Sort by count
    const sectorCounts = Array.from(bySector.entries())
      .map(([sector, patents]) => ({ sector, count: patents.length }))
      .sort((a, b) => b.count - a.count);

    console.log('Scorable Patents by Sector:');
    console.log('-'.repeat(70));
    console.log('Sector                          | Count  | Est. Time | Est. Cost');
    console.log('-'.repeat(70));

    let totalCount = 0;
    const PATENTS_PER_HOUR = 120; // ~2 per minute with concurrency
    const COST_PER_PATENT = 0.015; // ~$0.015 per patent (14 questions, ~1500 tokens)

    for (const { sector, count } of sectorCounts) {
      if (count === 0) continue;
      totalCount += count;
      const hours = count / PATENTS_PER_HOUR;
      const cost = count * COST_PER_PATENT;

      const sectorPad = sector.substring(0, 31).padEnd(31);
      const countPad = count.toString().padStart(6);
      const timePad = hours < 1 ? `${Math.round(hours * 60)}min`.padStart(9) : `${hours.toFixed(1)}hr`.padStart(9);
      const costPad = `$${cost.toFixed(2)}`.padStart(9);

      console.log(`${sectorPad} | ${countPad} | ${timePad} | ${costPad}`);
    }

    console.log('-'.repeat(70));
    const totalHours = totalCount / PATENTS_PER_HOUR;
    const totalCost = totalCount * COST_PER_PATENT;
    console.log(`TOTAL                           | ${totalCount.toString().padStart(6)} | ${totalHours.toFixed(1).padStart(8)}hr | $${totalCost.toFixed(2).padStart(8)}`);
    console.log('');
    console.log('Estimates assume: ~120 patents/hour, ~$0.015/patent');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
