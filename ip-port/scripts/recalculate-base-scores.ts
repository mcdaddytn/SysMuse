/**
 * Recalculate Base Scores
 *
 * Updates the base score for patents in the portfolio using a multi-factor formula.
 *
 * Formula:
 *   base_score = (citation_score + time_score + velocity_score) × sector_multiplier × expired_multiplier
 *
 * Components:
 *   - Citation Score: log10(forward_citations + 1) × 40
 *   - Time Score: clamp(remaining_years / 20, -0.5, 1.0) × 25
 *   - Velocity Score: log10(citations_per_year + 1) × 20
 *   - Sector Multiplier: 0.8 + (damages_rating - 1) × 0.233
 *   - Expired Multiplier: 0.1 for expired patents, 1.0 for active
 *
 * Usage:
 *   npx tsx scripts/recalculate-base-scores.ts --all
 *   npx tsx scripts/recalculate-base-scores.ts --affiliate "Brocade Communications"
 *   npx tsx scripts/recalculate-base-scores.ts --zero-scores-only
 *   npx tsx scripts/recalculate-base-scores.ts --dry-run
 */

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const CONFIG_DIR = path.join(process.cwd(), 'config');

interface Patent {
  patent_id: string;
  patent_date: string;
  forward_citations: number;
  remaining_years: number;
  score: number;
  primary_sector?: string;
  super_sector?: string;
  affiliate?: string;
  [key: string]: any;
}

interface SectorDamages {
  sectors: Record<string, { damages_rating: number }>;
}

// Sector damages lookup (cached)
let sectorDamagesCache: Map<string, number> | null = null;

/**
 * Load sector damages ratings from config
 */
function loadSectorDamages(): Map<string, number> {
  if (sectorDamagesCache) return sectorDamagesCache;

  sectorDamagesCache = new Map();

  try {
    const configPath = path.join(CONFIG_DIR, 'sector-damages.json');
    const config: SectorDamages = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    for (const [sectorKey, data] of Object.entries(config.sectors)) {
      sectorDamagesCache.set(sectorKey, data.damages_rating || 1);
    }

    console.log(`Loaded damages ratings for ${sectorDamagesCache.size} sectors`);
  } catch (e) {
    console.warn('Could not load sector-damages.json, using default multiplier');
  }

  return sectorDamagesCache;
}

/**
 * Get sector multiplier based on damages rating (1-4)
 * Rating 1 (Low) → 0.80x
 * Rating 2 (Medium) → 1.03x
 * Rating 3 (High) → 1.27x
 * Rating 4 (Very High) → 1.50x
 */
function getSectorMultiplier(primarySector: string | undefined): number {
  if (!primarySector) return 1.0; // Default for unknown sector

  const damages = loadSectorDamages();
  const rating = damages.get(primarySector) || 1;

  return 0.8 + (rating - 1) * 0.233;
}

/**
 * Calculate years since patent grant
 */
function getYearsSinceGrant(patentDate: string): number {
  if (!patentDate) return 10; // Default assumption

  const grantDate = new Date(patentDate);
  const now = new Date();
  const years = (now.getTime() - grantDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  return Math.max(years, 0.5); // Minimum 0.5 years to avoid division issues
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate base score using multi-factor formula
 */
function calculateBaseScore(patent: Patent): number {
  const forwardCitations = patent.forward_citations || 0;
  const remainingYears = patent.remaining_years || 0;
  const yearsSinceGrant = getYearsSinceGrant(patent.patent_date);

  // Component 1: Citation Score (log-scaled, 0-120 range for 0-1000 citations)
  const citationScore = Math.log10(forwardCitations + 1) * 40;

  // Component 2: Time Score (remaining years factor, -12.5 to +25)
  const timeFactor = clamp(remainingYears / 20, -0.5, 1.0);
  const timeScore = timeFactor * 25;

  // Component 3: Velocity Score (citations per year, rewards newer high-cited patents)
  const citationsPerYear = forwardCitations / yearsSinceGrant;
  const velocityScore = Math.log10(citationsPerYear + 1) * 20;

  // Component 4: Sector Multiplier (0.8x to 1.5x based on damages potential)
  const sectorMultiplier = getSectorMultiplier(patent.primary_sector);

  // Component 5: Expired Multiplier (0.1x for expired, 1.0x for active)
  // Ensures expired patents always rank below active patents
  const expiredMultiplier = remainingYears <= 0 ? 0.1 : 1.0;

  // Combine components
  const rawScore = citationScore + timeScore + velocityScore;
  const finalScore = rawScore * sectorMultiplier * expiredMultiplier;

  // Round to 2 decimal places
  return Math.round(finalScore * 100) / 100;
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
Recalculate Base Scores - Multi-factor scoring formula

Formula:
  base_score = (citation_score + time_score + velocity_score) × sector × expired

Components:
  - Citation Score: log10(forward_citations + 1) × 40
  - Time Score: clamp(remaining_years / 20, -0.5, 1.0) × 25
  - Velocity Score: log10(citations_per_year + 1) × 20
  - Sector Multiplier: 0.8x (Low) to 1.5x (Very High) based on damages potential
  - Expired Multiplier: 0.1x for expired patents, 1.0x for active

Usage:
  npx tsx scripts/recalculate-base-scores.ts --all
  npx tsx scripts/recalculate-base-scores.ts --affiliate "Brocade Communications"
  npx tsx scripts/recalculate-base-scores.ts --zero-scores-only
  npx tsx scripts/recalculate-base-scores.ts --dry-run
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
  const changes: Array<{
    id: string;
    oldScore: number;
    newScore: number;
    fwd: number;
    years: number;
    sector: string;
  }> = [];

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
        fwd: patent.forward_citations || 0,
        years: patent.remaining_years || 0,
        sector: patent.primary_sector || 'unknown'
      });
    } else {
      unchanged++;
    }
  }

  console.log(`\nResults:`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);

  if (changes.length > 0) {
    // Show distribution of score changes
    const increases = changes.filter(c => c.newScore > c.oldScore).length;
    const decreases = changes.filter(c => c.newScore < c.oldScore).length;
    console.log(`\nScore changes: ${increases} increased, ${decreases} decreased`);

    // Show expired patents that now have non-zero scores
    const expiredWithScores = changes.filter(c => c.years <= 0 && c.newScore > 0);
    if (expiredWithScores.length > 0) {
      console.log(`\nExpired patents now with scores: ${expiredWithScores.length}`);
      const topExpired = expiredWithScores.sort((a, b) => b.newScore - a.newScore).slice(0, 5);
      for (const c of topExpired) {
        console.log(`  ${c.id} | score=${c.newScore.toFixed(1)} (fwd=${c.fwd}, years=${c.years.toFixed(1)})`);
      }
    }

    console.log(`\nTop 10 by new score:`);
    const topChanges = changes.sort((a, b) => b.newScore - a.newScore).slice(0, 10);
    for (const c of topChanges) {
      console.log(`  ${c.id} | ${c.oldScore.toFixed(1)} → ${c.newScore.toFixed(1)} (fwd=${c.fwd}, yrs=${c.years.toFixed(1)}, ${c.sector})`);
    }

    console.log(`\nBottom 10 by new score:`);
    const bottomChanges = changes.sort((a, b) => a.newScore - b.newScore).slice(0, 10);
    for (const c of bottomChanges) {
      console.log(`  ${c.id} | ${c.oldScore.toFixed(1)} → ${c.newScore.toFixed(1)} (fwd=${c.fwd}, yrs=${c.years.toFixed(1)}, ${c.sector})`);
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
    data.metadata.scoreFormula = 'v3: (citation + time + velocity) × sector × expired(0.1)';

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
