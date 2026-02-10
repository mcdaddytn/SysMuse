/**
 * Check Sector Remaining Patents
 *
 * Shows which sectors still have patents that need LLM scoring.
 *
 * Usage:
 *   npx tsx scripts/check-sector-remaining.ts                # All sectors with remaining
 *   npx tsx scripts/check-sector-remaining.ts --all          # Show all sectors including complete
 *   npx tsx scripts/check-sector-remaining.ts --min=100      # Only sectors with 100+ remaining
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const OUTPUT_DIR = path.join(process.cwd(), 'output');

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Candidate {
  patent_id: string;
  primary_sector?: string;
  [key: string]: any;
}

interface SectorStats {
  sector: string;
  total: number;
  scored: number;
  remaining: number;
  coverage: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command line parsing
// ─────────────────────────────────────────────────────────────────────────────

interface Args {
  showAll: boolean;
  minRemaining: number;
}

function parseArgs(): Args {
  const args: Args = {
    showAll: false,
    minRemaining: 0
  };

  process.argv.slice(2).forEach(arg => {
    if (arg === '--all') {
      args.showAll = true;
    } else if (arg.startsWith('--min=')) {
      args.minRemaining = parseInt(arg.split('=')[1]);
    }
  });

  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

function loadCandidates(): Candidate[] {
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No candidates file found in output/');
  }

  const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, files[0]), 'utf-8'));
  console.log(`Loaded ${data.candidates.length} candidates from ${files[0]}`);
  return data.candidates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    console.log('');

    // Load candidates
    const candidates = loadCandidates();

    // Group by sector
    const bySector = new Map<string, string[]>();
    for (const c of candidates) {
      const sector = c.primary_sector || 'unknown';
      if (!bySector.has(sector)) bySector.set(sector, []);
      bySector.get(sector)!.push(c.patent_id);
    }

    // Get scored patents
    const scored = await prisma.$queryRaw<{ patent_id: string }[]>`
      SELECT DISTINCT patent_id FROM patent_sub_sector_scores
    `;
    const scoredSet = new Set(scored.map(p => p.patent_id));
    console.log(`Found ${scoredSet.size} patents with LLM sector scores`);
    console.log('');

    // Calculate stats per sector
    const results: SectorStats[] = [];
    for (const [sector, patents] of bySector) {
      const total = patents.length;
      const scoredCount = patents.filter(p => scoredSet.has(p)).length;
      const remaining = total - scoredCount;
      const coverage = (scoredCount / total) * 100;
      results.push({ sector, total, scored: scoredCount, remaining, coverage });
    }

    // Sort by remaining descending
    results.sort((a, b) => b.remaining - a.remaining);

    // Filter based on args
    const filtered = results.filter(r => {
      if (!args.showAll && r.remaining === 0) return false;
      if (r.remaining < args.minRemaining) return false;
      return true;
    });

    // Display
    console.log('Sectors with Remaining Patents to Score:');
    console.log('='.repeat(75));
    console.log('Sector                          | Total  | Scored | Remaining | Coverage');
    console.log('-'.repeat(75));

    let totalRemaining = 0;
    let totalPatents = 0;
    let totalScored = 0;

    for (const r of filtered) {
      totalRemaining += r.remaining;
      totalPatents += r.total;
      totalScored += r.scored;

      const sectorPad = r.sector.substring(0, 31).padEnd(31);
      const totalPad = r.total.toString().padStart(6);
      const scoredPad = r.scored.toString().padStart(6);
      const remainPad = r.remaining.toString().padStart(9);
      const pctPad = r.coverage.toFixed(1).padStart(6);

      console.log(`${sectorPad} | ${totalPad} | ${scoredPad} | ${remainPad} | ${pctPad}%`);
    }

    console.log('-'.repeat(75));

    // Summary
    const overallCoverage = ((scoredSet.size / candidates.length) * 100).toFixed(1);
    console.log('');
    console.log('Summary:');
    console.log(`  Total sectors: ${bySector.size}`);
    console.log(`  Sectors shown: ${filtered.length}`);
    console.log(`  Total patents: ${candidates.length}`);
    console.log(`  Total scored:  ${scoredSet.size} (${overallCoverage}%)`);
    console.log(`  Total remaining: ${candidates.length - scoredSet.size}`);

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
