/**
 * Multi-Score Patent Analysis
 *
 * Creates multiple scoring dimensions for different strategic uses:
 *
 * 1. LICENSING SCORE - For active licensing campaigns
 *    - Requires remaining term (can't license expired patents)
 *    - Weights competitor citations heavily
 *    - Penalizes IPR-challenged patents
 *
 * 2. LITIGATION SCORE - For infringement lawsuits
 *    - Requires substantial remaining term (5+ years ideal)
 *    - High competitor citations = evidence of copying
 *    - Forward citations = patent quality indicator
 *
 * 3. STRATEGIC VALUE SCORE - For portfolio positioning
 *    - Includes expired foundational patents
 *    - Emphasizes citation network centrality
 *    - Shows technology leadership
 *
 * 4. ACQUISITION DEFENSE SCORE - For M&A due diligence
 *    - Competitor citation patterns
 *    - Technology coverage breadth
 *    - IPR survival history
 *
 * Output: Tiered lists with top patents for each strategic purpose
 */

import * as fs from 'fs/promises';
import { CompetitorMatcher } from '../services/competitor-config.js';

// Global competitor matcher instance
let competitorMatcher: CompetitorMatcher;

// ============================================================================
// INTERFACES
// ============================================================================

interface RawPatent {
  patent_id: string;
  title?: string;
  date?: string;
  assignee?: string;
  forward_citations?: number;
  remaining_years?: number;
  competitor_citations?: number;
  competitors?: string[];
  original_score?: number;
  enhanced_score?: number;
}

interface ScoredPatent extends RawPatent {
  // Multi-dimensional scores
  licensingScore: number;
  litigationScore: number;
  strategicScore: number;
  acquisitionScore: number;

  // Composite
  overallActionableScore: number;

  // Flags
  isExpired: boolean;
  isActionable: boolean;  // Has term + competitor signal
  hasIPRRisk: boolean;

  // Competitor details
  competitorCount: number;
  topCompetitors: string[];
}

interface ScoreExplanation {
  name: string;
  description: string;
  formula: string;
  useCase: string;
  topPatents: ScoredPatent[];
}

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * LICENSING SCORE
 * Purpose: Identify patents suitable for licensing demands
 * Requirements: Must have remaining term, competitor relevance
 */
function calculateLicensingScore(p: RawPatent): number {
  const years = p.remaining_years || 0;
  const competitorCites = p.competitor_citations || 0;
  const fwdCites = p.forward_citations || 0;

  // Can't license expired patents
  if (years <= 0) return 0;

  // Components:
  // - Term value: exponential decay, 10+ years = full value
  const termMultiplier = Math.min(1, years / 10);

  // - Competitor signal: strong indicator of relevance (0-100 scale)
  const competitorValue = Math.min(100, competitorCites * 5);

  // - Citation quality: moderate weight (0-30 scale)
  const citationValue = Math.min(30, Math.sqrt(fwdCites) * 3);

  // Combined: weighted sum with term as gatekeeper
  return (competitorValue * 0.6 + citationValue * 0.4) * termMultiplier;
}

/**
 * LITIGATION SCORE
 * Purpose: Identify patents for infringement lawsuits
 * Requirements: Substantial term (damages runway), evidence of copying
 */
function calculateLitigationScore(p: RawPatent): number {
  const years = p.remaining_years || 0;
  const competitorCites = p.competitor_citations || 0;
  const fwdCites = p.forward_citations || 0;
  const competitors = p.competitors || [];

  // Need at least 3 years for meaningful litigation
  if (years < 3) return 0;

  // Components:
  // - Term runway: 5+ years ideal for litigation timeline
  const termValue = Math.min(40, years * 4);

  // - Competitor evidence: each competitor citing = potential defendant
  const competitorEvidence = Math.min(40, competitorCites * 2);

  // - Multiple competitors = broader exposure
  const competitorDiversity = Math.min(20, competitors.length * 5);

  // - Citation quality (patent strength indicator)
  const qualityIndicator = Math.min(20, Math.sqrt(fwdCites) * 2);

  return termValue + competitorEvidence + competitorDiversity + qualityIndicator;
}

/**
 * STRATEGIC VALUE SCORE
 * Purpose: Portfolio positioning, technology leadership claims
 * Includes: Expired foundational patents (historical importance)
 */
function calculateStrategicScore(p: RawPatent): number {
  const years = p.remaining_years || 0;
  const competitorCites = p.competitor_citations || 0;
  const fwdCites = p.forward_citations || 0;
  const competitors = p.competitors || [];

  // Components:
  // - Citation influence (foundational technology indicator)
  const influenceScore = Math.min(50, Math.sqrt(fwdCites) * 5);

  // - Competitor adoption (technology was used by industry)
  const adoptionScore = Math.min(30, competitorCites * 1.5);

  // - Industry breadth (multiple competitors = standard tech)
  const breadthScore = Math.min(20, competitors.length * 4);

  // - Active bonus (still enforceable adds value)
  const activeBonus = years > 0 ? Math.min(20, years * 2) : 0;

  return influenceScore + adoptionScore + breadthScore + activeBonus;
}

/**
 * ACQUISITION DEFENSE SCORE
 * Purpose: Value in M&A, defensive positioning
 * Focus: Coverage breadth, competitor exposure
 */
function calculateAcquisitionScore(p: RawPatent): number {
  const years = p.remaining_years || 0;
  const competitorCites = p.competitor_citations || 0;
  const fwdCites = p.forward_citations || 0;
  const competitors = p.competitors || [];

  // Components:
  // - Remaining term (future option value)
  const termValue = Math.min(30, years * 3);

  // - Competitor leverage (negotiating power)
  const leverageValue = Math.min(40, competitorCites * 2);

  // - Target diversity (more targets = more value)
  const targetValue = Math.min(30, competitors.length * 6);

  // - Citation foundation
  const foundationValue = Math.min(20, Math.sqrt(fwdCites) * 2);

  return termValue + leverageValue + targetValue + foundationValue;
}

/**
 * OVERALL ACTIONABLE SCORE
 * Purpose: Combined score for patents worth immediate attention
 * Requirements: Active + competitor signal
 */
function calculateOverallActionable(p: RawPatent): number {
  const years = p.remaining_years || 0;
  const competitorCites = p.competitor_citations || 0;

  // Must be actionable
  if (years <= 0 || competitorCites === 0) return 0;

  // Weighted combination favoring licensing/litigation potential
  const licensing = calculateLicensingScore(p);
  const litigation = calculateLitigationScore(p);
  const strategic = calculateStrategicScore(p);

  return licensing * 0.4 + litigation * 0.4 + strategic * 0.2;
}

// ============================================================================
// ANALYSIS
// ============================================================================

/**
 * Normalize competitor name using the CompetitorMatcher service.
 * This uses the comprehensive competitors.json config (131+ companies)
 * instead of a hardcoded list.
 */
function normalizeCompetitor(assignee: string): string {
  if (!competitorMatcher) {
    competitorMatcher = new CompetitorMatcher();
  }

  const match = competitorMatcher.matchCompetitor(assignee);
  if (match) {
    return match.company;
  }

  // Return uppercase for unmatched (will be filtered out)
  return assignee.toUpperCase();
}

async function loadExistingData(): Promise<RawPatent[]> {
  console.log('Loading existing analysis data...\n');

  const masterMap = new Map<string, RawPatent>();

  // Load all batch files - dynamically find all citation-overlap files
  const fsSync = await import('fs');
  const allFiles = fsSync.readdirSync('./output').filter(f =>
    f.startsWith('citation-overlap-') && f.endsWith('.json')
  );
  const batches = allFiles.map(f => `./output/${f}`);

  // Also include high-cite overlap if exists
  if (fsSync.existsSync('./output/high-cite-overlap-2026-01-15.json')) {
    batches.push('./output/high-cite-overlap-2026-01-15.json');
  }

  console.log(`  Found ${batches.length} citation overlap files to load`);

  for (const file of batches) {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf-8'));
      for (const r of (data.results || [])) {
        const id = r.broadcom_patent_id;
        const existing = masterMap.get(id) || { patent_id: id, competitors: [] };

        const newCompetitors = (r.competitor_cites || [])
          .map((c: any) => normalizeCompetitor(c.assignee))
          .filter((c: string) => c !== c.toUpperCase()); // Filter out non-normalized

        masterMap.set(id, {
          patent_id: id,
          title: existing.title || r.broadcom_title,
          date: existing.date || r.broadcom_date,
          assignee: existing.assignee || r.broadcom_assignee,
          forward_citations: Math.max(existing.forward_citations || 0, r.forward_citations || 0),
          remaining_years: r.remaining_years ?? existing.remaining_years,
          competitor_citations: Math.max(existing.competitor_citations || 0, r.competitor_citations || 0),
          competitors: [...new Set([...(existing.competitors || []), ...newCompetitors])],
          original_score: existing.original_score || r.original_score,
          enhanced_score: Math.max(existing.enhanced_score || 0, r.enhanced_score || 0),
        });
      }
      console.log(`  ✓ Loaded ${file}`);
    } catch (e: any) {
      console.log(`  - Skipped ${file}: ${e.message || e}`);
    }
  }

  console.log(`\n  Total unique patents: ${masterMap.size}\n`);
  return [...masterMap.values()];
}

function scoreAllPatents(patents: RawPatent[]): ScoredPatent[] {
  console.log('Calculating multi-dimensional scores...\n');

  return patents.map(p => {
    const competitors = (p.competitors || []).filter(c => c && c !== 'Unknown');

    return {
      ...p,
      licensingScore: Math.round(calculateLicensingScore(p) * 10) / 10,
      litigationScore: Math.round(calculateLitigationScore(p) * 10) / 10,
      strategicScore: Math.round(calculateStrategicScore(p) * 10) / 10,
      acquisitionScore: Math.round(calculateAcquisitionScore(p) * 10) / 10,
      overallActionableScore: Math.round(calculateOverallActionable(p) * 10) / 10,
      isExpired: (p.remaining_years || 0) <= 0,
      isActionable: (p.remaining_years || 0) > 0 && (p.competitor_citations || 0) > 0,
      hasIPRRisk: false, // Would need PTAB data to populate
      competitorCount: competitors.length,
      topCompetitors: competitors.slice(0, 5),
    };
  });
}

// ============================================================================
// REPORTING
// ============================================================================

function generateReport(patents: ScoredPatent[]): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('              MULTI-SCORE PATENT ANALYSIS REPORT');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total Patents Analyzed: ${patents.length}`);
  lines.push('');

  // Summary stats
  const actionable = patents.filter(p => p.isActionable);
  const expired = patents.filter(p => p.isExpired);
  const withCompetitors = patents.filter(p => p.competitor_citations && p.competitor_citations > 0);

  lines.push('─────────────────────────────────────────────────────────────────────────────');
  lines.push('PORTFOLIO SUMMARY');
  lines.push('─────────────────────────────────────────────────────────────────────────────');
  lines.push(`  Total with competitor citations: ${withCompetitors.length}`);
  lines.push(`  Actionable (active + competitor signal): ${actionable.length}`);
  lines.push(`  Expired (historical value only): ${expired.length}`);
  lines.push('');

  // Score explanations and top patents
  const scoreTypes: Array<{
    name: string;
    key: keyof ScoredPatent;
    description: string;
    formula: string;
    useCase: string;
    filter?: (p: ScoredPatent) => boolean;
  }> = [
    {
      name: 'LICENSING SCORE',
      key: 'licensingScore',
      description: 'Patents suitable for licensing demands to competitors',
      formula: '(CompetitorCites×5 [max 100] × 60%) + (√FwdCites×3 [max 30] × 40%) × TermMultiplier',
      useCase: 'Send licensing demand letters, negotiate royalty agreements',
      filter: p => !p.isExpired,
    },
    {
      name: 'LITIGATION SCORE',
      key: 'litigationScore',
      description: 'Patents with strong infringement lawsuit potential',
      formula: 'TermValue(40) + CompetitorEvidence(40) + CompetitorDiversity(20) + Quality(20)',
      useCase: 'File infringement suits, ITC complaints, seek injunctions',
      filter: p => (p.remaining_years || 0) >= 3,
    },
    {
      name: 'STRATEGIC VALUE SCORE',
      key: 'strategicScore',
      description: 'Patents demonstrating technology leadership (includes expired)',
      formula: 'Influence(50) + Adoption(30) + Breadth(20) + ActiveBonus(20)',
      useCase: 'Technology positioning, PR, M&A narratives, standards claims',
    },
    {
      name: 'ACQUISITION DEFENSE SCORE',
      key: 'acquisitionScore',
      description: 'Patents valuable for M&A and defensive positioning',
      formula: 'TermValue(30) + Leverage(40) + TargetDiversity(30) + Foundation(20)',
      useCase: 'M&A valuation, cross-licensing negotiations, defensive portfolios',
    },
    {
      name: 'OVERALL ACTIONABLE SCORE',
      key: 'overallActionableScore',
      description: 'Combined score for patents deserving immediate attention',
      formula: '(Licensing × 40%) + (Litigation × 40%) + (Strategic × 20%)',
      useCase: 'Prioritize claim chart development, attorney review queue',
      filter: p => p.isActionable,
    },
  ];

  for (const scoreType of scoreTypes) {
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push(`  ${scoreType.name}`);
    lines.push('═══════════════════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`  Description: ${scoreType.description}`);
    lines.push(`  Formula: ${scoreType.formula}`);
    lines.push(`  Use Case: ${scoreType.useCase}`);
    lines.push('');

    // Get top patents for this score
    let candidates = scoreType.filter ? patents.filter(scoreType.filter) : patents;
    candidates = candidates
      .filter(p => (p[scoreType.key] as number) > 0)
      .sort((a, b) => (b[scoreType.key] as number) - (a[scoreType.key] as number));

    lines.push(`  Qualifying Patents: ${candidates.length}`);
    lines.push('');
    lines.push('  TOP 15 PATENTS:');
    lines.push('  ─────────────────────────────────────────────────────────────────────────');

    for (const p of candidates.slice(0, 15)) {
      const score = p[scoreType.key] as number;
      const years = (p.remaining_years || 0).toFixed(1);
      const compCites = p.competitor_citations || 0;
      const comps = p.topCompetitors.slice(0, 3).join(', ') || 'N/A';

      lines.push(`  ${p.patent_id.padEnd(10)} Score: ${score.toFixed(1).padStart(5)} | Years: ${years.padStart(4)} | CompCites: ${String(compCites).padStart(3)} | ${comps}`);
      lines.push(`             "${(p.title || '').substring(0, 65)}..."`);
    }
  }

  // Competitor exposure summary
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('  COMPETITOR EXPOSURE ANALYSIS');
  lines.push('═══════════════════════════════════════════════════════════════════════════════');
  lines.push('');

  const competitorStats = new Map<string, { total: number; actionable: number; avgScore: number }>();
  for (const p of patents) {
    for (const comp of (p.topCompetitors || [])) {
      const stats = competitorStats.get(comp) || { total: 0, actionable: 0, avgScore: 0 };
      stats.total++;
      if (p.isActionable) {
        stats.actionable++;
        stats.avgScore += p.overallActionableScore;
      }
      competitorStats.set(comp, stats);
    }
  }

  // Calculate averages
  for (const [comp, stats] of competitorStats) {
    if (stats.actionable > 0) {
      stats.avgScore = stats.avgScore / stats.actionable;
    }
  }

  const sortedComps = [...competitorStats.entries()]
    .sort((a, b) => b[1].actionable - a[1].actionable);

  lines.push('  Competitor         Total Citations    Actionable Patents    Avg Actionable Score');
  lines.push('  ─────────────────────────────────────────────────────────────────────────────');

  for (const [comp, stats] of sortedComps.slice(0, 12)) {
    lines.push(`  ${comp.padEnd(18)} ${String(stats.total).padStart(8)}           ${String(stats.actionable).padStart(8)}              ${stats.avgScore.toFixed(1).padStart(6)}`);
  }

  return lines.join('\n');
}

// ============================================================================
// OUTPUT
// ============================================================================

async function saveResults(patents: ScoredPatent[]) {
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output';

  // 1. Full scored data as JSON
  const fullFile = `${outputDir}/multi-score-analysis-${timestamp}.json`;
  await fs.writeFile(fullFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      totalPatents: patents.length,
      scoringVersion: 'v2-multiscore',
      scoreDescriptions: {
        licensingScore: 'Patents suitable for licensing (requires active term)',
        litigationScore: 'Patents for infringement lawsuits (requires 3+ years)',
        strategicScore: 'Technology leadership value (includes expired)',
        acquisitionScore: 'M&A and defensive value',
        overallActionableScore: 'Combined priority for immediate action',
      },
    },
    patents: patents.sort((a, b) => b.overallActionableScore - a.overallActionableScore),
  }, null, 2));

  // 2. TOP 250 ACTIONABLE - The main deliverable
  const top250 = patents
    .filter(p => p.isActionable)
    .sort((a, b) => b.overallActionableScore - a.overallActionableScore)
    .slice(0, 250);

  const top250File = `${outputDir}/top-250-actionable-${timestamp}.json`;
  await fs.writeFile(top250File, JSON.stringify(top250, null, 2));

  // 3. TOP 250 as CSV for easy review
  const csvFile = `${outputDir}/top-250-actionable-${timestamp}.csv`;
  const csvLines = [
    'Rank,Patent ID,Title,Grant Date,Assignee,Years Left,Fwd Citations,Competitor Cites,Top Competitors,Licensing Score,Litigation Score,Strategic Score,Overall Score'
  ];

  top250.forEach((p, i) => {
    const title = (p.title || '').replace(/"/g, '""');
    const comps = (p.topCompetitors || []).join('; ');
    csvLines.push(
      `${i + 1},"${p.patent_id}","${title}","${p.date || ''}","${p.assignee || ''}",${(p.remaining_years || 0).toFixed(1)},${p.forward_citations || 0},${p.competitor_citations || 0},"${comps}",${p.licensingScore},${p.litigationScore},${p.strategicScore},${p.overallActionableScore}`
    );
  });
  await fs.writeFile(csvFile, csvLines.join('\n'));

  // 4. Licensing-focused tier (active term, sorted by licensing score)
  const licensingTier = patents
    .filter(p => !p.isExpired && p.licensingScore > 0)
    .sort((a, b) => b.licensingScore - a.licensingScore)
    .slice(0, 100);

  const licensingFile = `${outputDir}/tier-licensing-${timestamp}.json`;
  await fs.writeFile(licensingFile, JSON.stringify(licensingTier, null, 2));

  // 5. Litigation-focused tier (3+ years, sorted by litigation score)
  const litigationTier = patents
    .filter(p => (p.remaining_years || 0) >= 3 && p.litigationScore > 0)
    .sort((a, b) => b.litigationScore - a.litigationScore)
    .slice(0, 100);

  const litigationFile = `${outputDir}/tier-litigation-${timestamp}.json`;
  await fs.writeFile(litigationFile, JSON.stringify(litigationTier, null, 2));

  // 6. Strategic tier (includes expired, sorted by strategic score)
  const strategicTier = patents
    .filter(p => p.strategicScore > 0)
    .sort((a, b) => b.strategicScore - a.strategicScore)
    .slice(0, 100);

  const strategicFile = `${outputDir}/tier-strategic-${timestamp}.json`;
  await fs.writeFile(strategicFile, JSON.stringify(strategicTier, null, 2));

  // 7. Text report
  const report = generateReport(patents);
  const reportFile = `${outputDir}/multi-score-report-${timestamp}.txt`;
  await fs.writeFile(reportFile, report);

  // Also print report to console
  console.log(report);

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  FILES SAVED');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`  ${fullFile}`);
  console.log(`  ${top250File} (${top250.length} patents)`);
  console.log(`  ${csvFile}`);
  console.log(`  ${licensingFile} (${licensingTier.length} patents)`);
  console.log(`  ${litigationFile} (${litigationTier.length} patents)`);
  console.log(`  ${strategicFile} (${strategicTier.length} patents)`);
  console.log(`  ${reportFile}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              MULTI-SCORE PATENT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Load existing data
  const rawPatents = await loadExistingData();

  if (rawPatents.length === 0) {
    console.error('No patent data found. Run citation-overlap analysis first.');
    process.exit(1);
  }

  // Score all patents
  const scoredPatents = scoreAllPatents(rawPatents);

  // Generate outputs
  await saveResults(scoredPatents);

  console.log('\n✓ Analysis complete\n');
}

main().catch(console.error);
