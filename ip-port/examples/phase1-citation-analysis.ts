/**
 * Phase 1: Citation Analysis for Streaming Video Patents
 *
 * 1. Load streaming video patents (10K)
 * 2. Get forward citation counts via PatentsView
 * 3. Calculate remaining patent term
 * 4. Cross-reference with PTAB data (exclude challenged)
 * 5. Rank and output top candidates
 */

import { createPatentsViewClient } from '../clients/patentsview-client.js';
import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';
dotenv.config();

const client = createPatentsViewClient();

interface PatentCandidate {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  filing_date?: string;
  assignee: string;
  cpc_group: string;
  forward_citations: number;
  remaining_years: number;
  has_ipr_challenge: boolean;
  score: number;
}

async function loadStreamingPatents(): Promise<any[]> {
  console.log('Loading streaming video patents...');

  const patents: any[] = [];
  const dir = './output/streaming-video';
  const files = await fs.readdir(dir);

  for (const file of files) {
    if (file.endsWith('.json') && file.startsWith('patents-batch')) {
      const data = JSON.parse(await fs.readFile(`${dir}/${file}`, 'utf-8'));
      patents.push(...data);
    }
  }

  console.log(`  ✓ Loaded ${patents.length.toLocaleString()} patents\n`);
  return patents;
}

async function loadIPRChallengedPatents(): Promise<Set<string>> {
  console.log('Loading IPR-challenged patents...');

  const challenged = new Set<string>();

  try {
    const data = JSON.parse(
      await fs.readFile('./output/broadcom-ptab-trials-2026-01-15.json', 'utf-8')
    );

    for (const trial of data.trials) {
      if (trial.patentNumber) {
        challenged.add(trial.patentNumber);
      }
    }

    console.log(`  ✓ Found ${challenged.size} patents with IPR challenges\n`);
  } catch (error) {
    console.log('  ! Could not load IPR data, continuing without filter\n');
  }

  return challenged;
}

async function getCitationCounts(patentIds: string[]): Promise<Map<string, number>> {
  console.log(`Getting citation counts for ${patentIds.length.toLocaleString()} patents...`);
  console.log('  (This may take several minutes)\n');

  const citationMap = new Map<string, number>();
  const batchSize = 100;
  let processed = 0;

  // Process in batches
  for (let i = 0; i < patentIds.length; i += batchSize) {
    const batch = patentIds.slice(i, i + batchSize);

    try {
      // Query for citation counts
      const response = await client.searchPatents({
        query: {
          _or: batch.map(id => ({ patent_id: id }))
        },
        fields: [
          'patent_id',
          'patent_num_times_cited_by_us_patents',
        ],
        options: { size: batchSize }
      });

      for (const patent of response.patents) {
        citationMap.set(
          patent.patent_id,
          patent.patent_num_times_cited_by_us_patents || 0
        );
      }

      processed += batch.length;
      process.stdout.write(`\r  Progress: ${processed.toLocaleString()}/${patentIds.length.toLocaleString()} patents...`);

      // Small delay for rate limiting
      await new Promise(r => setTimeout(r, 100));

    } catch (error: any) {
      console.log(`\n  Warning: Error fetching batch: ${error.message}`);
    }
  }

  console.log(`\n  ✓ Got citation counts for ${citationMap.size.toLocaleString()} patents\n`);
  return citationMap;
}

function calculateRemainingTerm(patentDate: string): number {
  // Patent term is generally 20 years from filing date
  // But we often only have grant date, so estimate conservatively
  // Average prosecution time is ~2-3 years, so ~17-18 years from grant

  const grantDate = new Date(patentDate);
  const expirationEstimate = new Date(grantDate);
  expirationEstimate.setFullYear(grantDate.getFullYear() + 17); // Conservative estimate

  const now = new Date();
  const yearsRemaining = (expirationEstimate.getTime() - now.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  return Math.max(0, yearsRemaining);
}

function calculateScore(
  forwardCitations: number,
  remainingYears: number,
  hasIPR: boolean
): number {
  // Scoring formula:
  // - Forward citations (normalized, max ~50 points)
  // - Remaining term (max ~30 points for 15+ years)
  // - IPR penalty (-20 points if challenged)

  const citationScore = Math.min(50, forwardCitations * 0.5);
  const termScore = Math.min(30, remainingYears * 2);
  const iprPenalty = hasIPR ? -20 : 0;

  return citationScore + termScore + iprPenalty;
}

async function analyzePatents(
  patents: any[],
  citationMap: Map<string, number>,
  challengedPatents: Set<string>
): Promise<PatentCandidate[]> {
  console.log('Analyzing patents and calculating scores...\n');

  const candidates: PatentCandidate[] = [];

  for (const patent of patents) {
    const forwardCitations = citationMap.get(patent.patent_id) || 0;
    const remainingYears = calculateRemainingTerm(patent.patent_date);
    const hasIPR = challengedPatents.has(patent.patent_id);

    // Get CPC group
    const cpcGroup = patent.cpc_current?.[0]?.cpc_group_id ||
                     patent.cpc?.[0]?.cpc_group_id ||
                     'Unknown';

    // Get assignee
    const assignee = patent.assignees?.[0]?.assignee_organization || 'Unknown';

    candidates.push({
      patent_id: patent.patent_id,
      patent_title: patent.patent_title || '',
      patent_date: patent.patent_date || '',
      assignee,
      cpc_group: cpcGroup,
      forward_citations: forwardCitations,
      remaining_years: Math.round(remainingYears * 10) / 10,
      has_ipr_challenge: hasIPR,
      score: calculateScore(forwardCitations, remainingYears, hasIPR),
    });
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

function printAnalysis(candidates: PatentCandidate[]) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     PHASE 1 ANALYSIS RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Summary stats
  const totalCitations = candidates.reduce((sum, c) => sum + c.forward_citations, 0);
  const avgCitations = totalCitations / candidates.length;
  const withCitations = candidates.filter(c => c.forward_citations > 0).length;
  const withIPR = candidates.filter(c => c.has_ipr_challenge).length;
  const expiringSoon = candidates.filter(c => c.remaining_years < 5).length;

  console.log('Summary Statistics:');
  console.log(`  Total patents analyzed: ${candidates.length.toLocaleString()}`);
  console.log(`  Patents with citations: ${withCitations.toLocaleString()} (${(withCitations/candidates.length*100).toFixed(1)}%)`);
  console.log(`  Total forward citations: ${totalCitations.toLocaleString()}`);
  console.log(`  Average citations: ${avgCitations.toFixed(1)}`);
  console.log(`  Patents with IPR challenges: ${withIPR}`);
  console.log(`  Patents expiring < 5 years: ${expiringSoon.toLocaleString()}`);

  // Citation distribution
  console.log('\nCitation Distribution:');
  const brackets = [
    { min: 100, label: '100+ citations' },
    { min: 50, label: '50-99 citations' },
    { min: 20, label: '20-49 citations' },
    { min: 10, label: '10-19 citations' },
    { min: 1, label: '1-9 citations' },
    { min: 0, label: '0 citations' },
  ];

  for (const bracket of brackets) {
    const count = candidates.filter(c =>
      c.forward_citations >= bracket.min &&
      (bracket.min === 100 || c.forward_citations < brackets[brackets.indexOf(bracket) - 1]?.min || bracket.min === 0)
    ).length;
    if (count > 0 || bracket.min <= 10) {
      console.log(`  ${bracket.label}: ${count.toLocaleString()}`);
    }
  }

  // Top 20 patents
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('TOP 20 PATENT CANDIDATES');
  console.log('─────────────────────────────────────────────────────────────\n');

  candidates.slice(0, 20).forEach((c, i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${c.patent_id} (Score: ${c.score.toFixed(1)})`);
    console.log(`    Title: ${c.patent_title.substring(0, 70)}...`);
    console.log(`    Citations: ${c.forward_citations} | Years Left: ${c.remaining_years} | IPR: ${c.has_ipr_challenge ? 'YES' : 'No'}`);
    console.log(`    Assignee: ${c.assignee}`);
    console.log('');
  });

  // Top by CPC
  console.log('─────────────────────────────────────────────────────────────');
  console.log('TOP PATENTS BY TECHNOLOGY AREA');
  console.log('─────────────────────────────────────────────────────────────\n');

  const cpcGroups = ['H04L', 'H04N', 'H04W', 'G06F', 'G11B'];
  for (const cpc of cpcGroups) {
    const cpcPatents = candidates.filter(c => c.cpc_group.startsWith(cpc));
    if (cpcPatents.length > 0) {
      const top = cpcPatents[0];
      console.log(`${cpc} (${cpcPatents.length} patents):`);
      console.log(`  Best: ${top.patent_id} - ${top.forward_citations} citations, ${top.remaining_years} years`);
      console.log(`  "${top.patent_title.substring(0, 60)}..."\n`);
    }
  }
}

async function saveResults(candidates: PatentCandidate[]) {
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output';

  // Save full results
  const fullFile = `${outputDir}/streaming-candidates-${timestamp}.json`;
  await fs.writeFile(fullFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      totalAnalyzed: candidates.length,
      scoringMethod: 'v1: citations(50) + term(30) - ipr(20)',
    },
    candidates,
  }, null, 2));

  // Save top 500 as CSV for easy review
  const top500 = candidates.slice(0, 500);
  const csvFile = `${outputDir}/streaming-top500-${timestamp}.csv`;
  const csvLines = ['Rank,Patent ID,Title,Grant Date,Assignee,CPC,Forward Citations,Years Remaining,Has IPR,Score'];
  top500.forEach((c, i) => {
    csvLines.push(
      `${i + 1},"${c.patent_id}","${c.patent_title.replace(/"/g, '""')}","${c.patent_date}","${c.assignee}","${c.cpc_group}",${c.forward_citations},${c.remaining_years},${c.has_ipr_challenge ? 'Yes' : 'No'},${c.score.toFixed(1)}`
    );
  });
  await fs.writeFile(csvFile, csvLines.join('\n'));

  // Save tier lists
  const tier1 = candidates.slice(0, 100);
  const tier1File = `${outputDir}/streaming-tier1-${timestamp}.json`;
  await fs.writeFile(tier1File, JSON.stringify(tier1, null, 2));

  console.log('\n✓ Results saved:');
  console.log(`  - ${fullFile} (all ${candidates.length} patents)`);
  console.log(`  - ${csvFile} (top 500)`);
  console.log(`  - ${tier1File} (top 100 - Tier 1)`);
}

// Main
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     PHASE 1: STREAMING VIDEO PATENT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load data
  const patents = await loadStreamingPatents();
  const challengedPatents = await loadIPRChallengedPatents();

  // Get citation counts
  const patentIds = patents.map(p => p.patent_id);
  const citationMap = await getCitationCounts(patentIds);

  // Analyze and score
  const candidates = await analyzePatents(patents, citationMap, challengedPatents);

  // Output results
  printAnalysis(candidates);
  await saveResults(candidates);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     PHASE 1 COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
