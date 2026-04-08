/**
 * Score Niche Sectors with Niche Finder Profile (Phase 2.2)
 *
 * Scores patents in niche sectors using the Niche Finder profile and
 * compares rankings against the Aggressive Litigator profile to find
 * "hidden gem" patents — strong quality but not boosted by known-competitor citations.
 *
 * Output:
 *   - output/niche-scoring-comparison.csv
 *
 * Usage:
 *   npx tsx scripts/score-niche-sectors.ts [--sectors=rf-acoustic,optics,...] [--top=50]
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getProfile,
  scorePatent,
  loadAllClassifications,
  loadAllIprScores,
  loadAllProsecutionScores,
  type PatentMetrics,
  type ScoringProfile,
  CITATION_WEIGHTS,
} from '../src/api/services/scoring-service.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '50');
const sectorArg = args.find(a => a.startsWith('--sectors='))?.split('=')[1];

const DEFAULT_NICHE_SECTORS = [
  'rf-acoustic', 'optics', 'analog-circuits', 'memory-storage',
  'network-multiplexing', 'wireless-transmission', 'wireless-power-mgmt',
  'wireless-infrastructure',
];

const sectors = sectorArg ? sectorArg.split(',') : DEFAULT_NICHE_SECTORS;

// ─── Load LLM Scores (file-based) ────────────────────────────────────────────

function loadAllLlmScoresFromFiles(): Map<string, any> {
  const cache = new Map<string, any>();

  // Combined output files
  for (const subdir of ['llm-analysis-v3', 'llm-analysis-v2', 'llm-analysis']) {
    const dir = path.join(process.cwd(), 'output', subdir);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('combined-') && f.endsWith('.json'))
      .sort().reverse();
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        for (const a of data.analyses || []) {
          if (!cache.has(a.patent_id)) cache.set(a.patent_id, a);
        }
      } catch { /* skip */ }
    }
  }

  // Per-patent cache
  const llmDir = path.join(process.cwd(), 'cache/llm-scores');
  if (fs.existsSync(llmDir)) {
    for (const file of fs.readdirSync(llmDir).filter(f => f.endsWith('.json'))) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(llmDir, file), 'utf-8'));
        cache.set(data.patent_id, data);
      } catch { /* skip */ }
    }
  }

  return cache;
}

// ─── Build metrics ────────────────────────────────────────────────────────────

function buildMetrics(candidate: any, classification: any, llm: any, ipr: any, pros: any): PatentMetrics {
  const cc = classification?.competitor_citations ?? 0;
  const ac = classification?.affiliate_citations ?? 0;
  const nc = classification?.neutral_citations ?? 0;
  const fc = candidate.forward_citations ?? classification?.total_forward_citations ?? 0;
  const adjustedForward = cc * CITATION_WEIGHTS.competitor + nc * CITATION_WEIGHTS.neutral + ac * CITATION_WEIGHTS.affiliate;
  const ext = cc + nc;

  return {
    patent_id: candidate.patent_id,
    competitor_citations: cc,
    forward_citations: fc,
    adjusted_forward_citations: adjustedForward,
    years_remaining: candidate.remaining_years ?? 0,
    competitor_count: classification?.competitor_count ?? 0,
    competitor_density: ext > 0 ? cc / ext : 0,
    affiliate_citations: ac,
    neutral_citations: nc,
    total_forward_citations: classification?.total_forward_citations ?? fc,
    has_citation_data: classification?.has_citation_data ?? false,
    eligibility_score: llm?.eligibility_score,
    validity_score: llm?.validity_score,
    claim_breadth: llm?.claim_breadth,
    enforcement_clarity: llm?.enforcement_clarity,
    design_around_difficulty: llm?.design_around_difficulty,
    market_relevance_score: llm?.market_relevance_score,
    ipr_risk_score: ipr?.ipr_risk_score,
    prosecution_quality_score: pros?.prosecution_quality_score,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     NICHE SECTOR SCORING COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const nicheProfile = getProfile('niche_finder');
  const aggressiveProfile = getProfile('aggressive');

  if (!nicheProfile || !aggressiveProfile) {
    console.error('Missing required scoring profiles (niche_finder or aggressive)');
    process.exit(1);
  }

  console.log(`Sectors: ${sectors.join(', ')}`);
  console.log(`Top N: ${topN}`);

  // Load data
  const outputDir = path.join(process.cwd(), 'output');
  const candidateFiles = fs.readdirSync(outputDir)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort().reverse();
  if (candidateFiles.length === 0) throw new Error('No streaming-candidates file found');

  const data = JSON.parse(fs.readFileSync(path.join(outputDir, candidateFiles[0]), 'utf-8'));
  const allCandidates: any[] = data.candidates || [];

  const classifications = loadAllClassifications();
  const llmScores = loadAllLlmScoresFromFiles();
  const iprScores = loadAllIprScores();
  const prosScores = loadAllProsecutionScores();

  console.log(`Loaded: ${allCandidates.length} candidates, ${classifications.size} classifications, ${llmScores.size} LLM scores\n`);

  // CSV output
  const csvHeaders = [
    'Sector', 'PatentId', 'Title', 'NicheScore', 'NicheRank',
    'AggressiveScore', 'AggressiveRank', 'RankDelta',
    'CompCitations', 'NeutralCitations', 'AdjForwardCitations',
    'ValidityScore', 'ClaimBreadth', 'EnforcementClarity',
    'CompetitorNames',
  ];
  const csvRows = [csvHeaders.join(',')];

  let totalHiddenGems = 0;

  for (const sector of sectors) {
    const sectorCandidates = allCandidates.filter(c => c.primary_sector === sector);
    if (sectorCandidates.length === 0) {
      console.log(`${sector}: no patents found`);
      continue;
    }

    // Score with both profiles
    const nicheScored = sectorCandidates.map(c => {
      const cls = classifications.get(c.patent_id) ?? null;
      const llm = llmScores.get(c.patent_id) ?? null;
      const ipr = iprScores.get(c.patent_id) ?? null;
      const pros = prosScores.get(c.patent_id) ?? null;
      const metrics = buildMetrics(c, cls, llm, ipr, pros);
      return { candidate: c, metrics, scored: scorePatent(metrics, nicheProfile) };
    }).sort((a, b) => b.scored.score - a.scored.score);

    const aggressiveScored = sectorCandidates.map(c => {
      const cls = classifications.get(c.patent_id) ?? null;
      const llm = llmScores.get(c.patent_id) ?? null;
      const ipr = iprScores.get(c.patent_id) ?? null;
      const pros = prosScores.get(c.patent_id) ?? null;
      const metrics = buildMetrics(c, cls, llm, ipr, pros);
      return { candidate: c, scored: scorePatent(metrics, aggressiveProfile) };
    }).sort((a, b) => b.scored.score - a.scored.score);

    // Build rank maps
    const nicheRankMap = new Map<string, number>();
    nicheScored.forEach((s, i) => nicheRankMap.set(s.candidate.patent_id, i + 1));

    const aggressiveRankMap = new Map<string, number>();
    aggressiveScored.forEach((s, i) => aggressiveRankMap.set(s.candidate.patent_id, i + 1));

    // Find hidden gems: in niche top-N but NOT in aggressive top-N
    const nicheTopSet = new Set(nicheScored.slice(0, topN).map(s => s.candidate.patent_id));
    const aggressiveTopSet = new Set(aggressiveScored.slice(0, topN).map(s => s.candidate.patent_id));
    const hiddenGems = [...nicheTopSet].filter(id => !aggressiveTopSet.has(id));
    totalHiddenGems += hiddenGems.length;

    console.log(`${sector}: ${sectorCandidates.length} patents | Niche top-${topN}: ${nicheTopSet.size} | Hidden gems: ${hiddenGems.length}`);

    // Output top-N niche-scored patents for this sector
    for (const entry of nicheScored.slice(0, topN)) {
      const pid = entry.candidate.patent_id;
      const cls = classifications.get(pid);
      const aggressiveRank = aggressiveRankMap.get(pid) || 0;
      const nicheRank = nicheRankMap.get(pid) || 0;
      const rankDelta = aggressiveRank - nicheRank; // positive = improved by niche

      csvRows.push([
        escapeCSV(sector),
        pid,
        escapeCSV((entry.candidate.patent_title || '').substring(0, 80)),
        entry.scored.score.toFixed(2),
        nicheRank,
        aggressiveScored.find(s => s.candidate.patent_id === pid)?.scored.score.toFixed(2) || '0',
        aggressiveRank,
        rankDelta,
        cls?.competitor_citations ?? 0,
        cls?.neutral_citations ?? 0,
        entry.metrics.adjusted_forward_citations.toFixed(1),
        entry.metrics.validity_score ?? '',
        entry.metrics.claim_breadth ?? '',
        entry.metrics.enforcement_clarity ?? '',
        escapeCSV((cls?.competitor_names || []).join('; ')),
      ].join(','));
    }
  }

  // Write CSV
  const csvPath = path.join(outputDir, 'niche-scoring-comparison.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`\nOutput: ${csvPath} (${csvRows.length - 1} rows)`);
  console.log(`Total hidden gems across all sectors: ${totalHiddenGems}`);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SCORING COMPARISON COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

function escapeCSV(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

main();
