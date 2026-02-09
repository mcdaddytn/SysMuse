/**
 * Check Scoring Coverage
 *
 * Analyzes LLM scoring coverage for top patents by different scoring methods.
 *
 * Usage:
 *   npx tsx scripts/check-scoring-coverage.ts                    # V2 score with defaults
 *   npx tsx scripts/check-scoring-coverage.ts --score=base       # Base score ranking
 *   npx tsx scripts/check-scoring-coverage.ts --score=v2         # V2 score ranking
 *   npx tsx scripts/check-scoring-coverage.ts --citation=60 --years=20 --competitor=20
 *   npx tsx scripts/check-scoring-coverage.ts --tiers=100,500,1000
 *   npx tsx scripts/check-scoring-coverage.ts --show-missing --limit=30
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
  forward_citations: number;
  remaining_years: number;
  score: number; // base score
  primary_sector?: string;
  [key: string]: any;
}

interface CitationClassification {
  patent_id: string;
  total_forward_citations: number;
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
}

interface V2Weights {
  citation: number;
  years: number;
  competitor: number;
}

interface ScoredCandidate extends Candidate {
  v2_score: number;
  competitor_citations: number;
  affiliate_citations: number;
  neutral_citations: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Command line parsing
// ─────────────────────────────────────────────────────────────────────────────

interface Args {
  scoreType: 'base' | 'v2';
  citation: number;
  years: number;
  competitor: number;
  tiers: number[];
  showMissing: boolean;
  limit: number;
}

function parseArgs(): Args {
  const args: Args = {
    scoreType: 'v2',
    citation: 50,
    years: 30,
    competitor: 20,
    tiers: [100, 250, 500, 750, 1000],
    showMissing: false,
    limit: 20
  };

  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--score=')) {
      const val = arg.split('=')[1];
      if (val === 'base' || val === 'v2') args.scoreType = val;
    } else if (arg.startsWith('--citation=')) {
      args.citation = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--years=')) {
      args.years = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--competitor=')) {
      args.competitor = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--tiers=')) {
      args.tiers = arg.split('=')[1].split(',').map(n => parseInt(n.trim()));
    } else if (arg === '--show-missing') {
      args.showMissing = true;
    } else if (arg.startsWith('--limit=')) {
      args.limit = parseInt(arg.split('=')[1]);
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

function loadClassifications(): Map<string, CitationClassification> {
  const cache = new Map<string, CitationClassification>();

  const summaryFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('citation-classification-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (summaryFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, summaryFiles[0]), 'utf-8'));
    for (const result of data.results) {
      cache.set(result.patent_id, result);
    }
    console.log(`Loaded ${cache.size} classification records from ${summaryFiles[0]}`);
  } else {
    console.warn('No classification file found - competitor_citations will be 0');
  }

  return cache;
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 Scoring
// ─────────────────────────────────────────────────────────────────────────────

function calculateV2Score(
  forwardCitations: number,
  remainingYears: number,
  competitorCitations: number,
  weights: V2Weights
): number {
  const totalWeight = weights.citation + weights.years + weights.competitor;
  if (totalWeight === 0) return 0;

  const citationNorm = weights.citation / totalWeight;
  const yearsNorm = weights.years / totalWeight;
  const competitorNorm = weights.competitor / totalWeight;

  // Forward citations: log scale (matches V2ScoringPage.vue formula)
  const citScore = Math.log10((forwardCitations || 0) + 1) * 30 * citationNorm;

  // Remaining years: linear scale capped at 20 years
  const yrsScore = Math.min((remainingYears || 0) / 20, 1) * 100 * yearsNorm;

  // Competitor citations: direct multiplier
  const compScore = (competitorCitations || 0) * 15 * competitorNorm;

  return citScore + yrsScore + compScore;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const prisma = new PrismaClient();

  try {
    console.log('');
    console.log('='.repeat(70));
    console.log(`Scoring Coverage Analysis - ${args.scoreType.toUpperCase()} Score`);
    console.log('='.repeat(70));

    if (args.scoreType === 'v2') {
      console.log(`V2 Weights: citation=${args.citation}, years=${args.years}, competitor=${args.competitor}`);
    }
    console.log('');

    // Load data
    const candidates = loadCandidates();
    const classifications = loadClassifications();

    // Enrich with classification data and calculate V2 scores
    const weights: V2Weights = {
      citation: args.citation,
      years: args.years,
      competitor: args.competitor
    };

    const enriched: ScoredCandidate[] = candidates.map(c => {
      const cls = classifications.get(c.patent_id);
      const compCites = cls?.competitor_citations ?? 0;
      const affCites = cls?.affiliate_citations ?? 0;
      const neutralCites = cls?.neutral_citations ?? 0;

      return {
        ...c,
        competitor_citations: compCites,
        affiliate_citations: affCites,
        neutral_citations: neutralCites,
        v2_score: calculateV2Score(c.forward_citations, c.remaining_years, compCites, weights)
      };
    });

    // Sort by selected score type
    if (args.scoreType === 'v2') {
      enriched.sort((a, b) => b.v2_score - a.v2_score);
    } else {
      enriched.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Get patents with LLM scores (use raw query for distinct)
    const scoredPatents = await prisma.$queryRaw<{ patent_id: string }[]>`
      SELECT DISTINCT patent_id FROM patent_sub_sector_scores
    `;
    const scoredSet = new Set(scoredPatents.map(p => p.patent_id));
    console.log(`Found ${scoredSet.size} patents with LLM sector scores`);
    console.log('');

    // Coverage by tier
    console.log('Coverage by Tier:');
    console.log('-'.repeat(70));
    console.log('Tier     | Scored | Total | Coverage | Missing | Avg Score (scored vs all)');
    console.log('-'.repeat(70));

    for (const tier of args.tiers) {
      const topN = enriched.slice(0, tier);
      const scored = topN.filter(p => scoredSet.has(p.patent_id));
      const missing = tier - scored.length;
      const coverage = (scored.length / tier * 100).toFixed(1);

      // Average scores
      const scoreField = args.scoreType === 'v2' ? 'v2_score' : 'score';
      const avgAll = (topN.reduce((s, p) => s + (p[scoreField] || 0), 0) / tier).toFixed(1);
      const avgScored = scored.length > 0
        ? (scored.reduce((s, p) => s + (p[scoreField] || 0), 0) / scored.length).toFixed(1)
        : 'N/A';

      console.log(
        `Top ${tier.toString().padEnd(4)} | ` +
        `${scored.length.toString().padEnd(6)} | ` +
        `${tier.toString().padEnd(5)} | ` +
        `${coverage.padStart(6)}%  | ` +
        `${missing.toString().padEnd(7)} | ` +
        `${avgScored} vs ${avgAll}`
      );
    }

    // Show missing patents if requested
    if (args.showMissing) {
      const maxTier = Math.max(...args.tiers);
      const topN = enriched.slice(0, maxTier);
      const missing = topN.filter(p => !scoredSet.has(p.patent_id));

      console.log('');
      console.log(`Missing Patents in Top ${maxTier} (showing ${Math.min(missing.length, args.limit)} of ${missing.length}):`);
      console.log('-'.repeat(90));
      console.log('Rank | Patent ID  | V2 Score | Base Score | Comp Cites | Fwd Cites | Yrs | Sector');
      console.log('-'.repeat(90));

      missing.slice(0, args.limit).forEach(p => {
        const rank = topN.indexOf(p) + 1;
        const sector = (p.primary_sector || 'unknown').substring(0, 20);
        console.log(
          `${rank.toString().padStart(4)} | ` +
          `${p.patent_id.padEnd(10)} | ` +
          `${p.v2_score.toFixed(1).padStart(8)} | ` +
          `${(p.score || 0).toFixed(2).padStart(10)} | ` +
          `${p.competitor_citations.toString().padStart(10)} | ` +
          `${(p.forward_citations || 0).toString().padStart(9)} | ` +
          `${(p.remaining_years || 0).toFixed(0).padStart(3)} | ` +
          `${sector}`
        );
      });
    }

    // Top 5 reference
    console.log('');
    console.log(`Top 5 by ${args.scoreType.toUpperCase()} Score (reference):`);
    console.log('-'.repeat(80));
    enriched.slice(0, 5).forEach((p, i) => {
      const status = scoredSet.has(p.patent_id) ? 'SCORED' : 'MISSING';
      console.log(
        `  ${i + 1}. ${p.patent_id}: ` +
        `v2=${p.v2_score.toFixed(1)}, base=${(p.score || 0).toFixed(2)}, ` +
        `comp_cites=${p.competitor_citations} [${status}]`
      );
    });

    console.log('');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
