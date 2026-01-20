/**
 * Merge Affiliate Data into Multi-Score Analysis
 *
 * Combines citation results from new affiliates (Pivotal, Carbon Black, Nyansa, Blue Coat)
 * with the existing multi-score-analysis.
 *
 * Usage: npx tsx scripts/merge-affiliates-data.ts
 */

import * as fs from 'fs/promises';
import * as dotenv from 'dotenv';

dotenv.config();

interface MultiScorePatent {
  patent_id: string;
  title: string;
  assignee: string;
  grant_date: string;
  years_remaining: number;
  forward_citations: number;
  competitor_citations: number;
  competitor_count: number;
  competitors: string[];
  sector?: string;
  sector_name?: string;
  sector_source?: string;
}

function calculateYearsRemaining(grantDate: string): number {
  if (!grantDate) return 0;
  const grant = new Date(grantDate);
  const expiry = new Date(grant);
  expiry.setFullYear(expiry.getFullYear() + 20);
  const now = new Date();
  const years = (expiry.getTime() - now.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(years * 10) / 10);
}

async function findLatestFile(pattern: string): Promise<string | null> {
  const files = await fs.readdir('./output');
  const matches = files
    .filter(f => f.includes(pattern) && f.endsWith('.json'))
    .sort()
    .reverse();
  return matches[0] || null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        MERGE AFFILIATE DATA INTO MULTI-SCORE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find latest files
  const affiliateCitationFile = await findLatestFile('affiliate-citation-results');
  const multiScoreFile = await findLatestFile('multi-score-analysis');
  const affiliatePatentsFile = await findLatestFile('missing-affiliates-patents');
  const bluecoatPatentsFile = await findLatestFile('bluecoat-patents');

  if (!affiliateCitationFile) {
    console.error('Error: No affiliate-citation-results file found.');
    console.error('Run: npx tsx scripts/citation-overlap-affiliates.ts');
    process.exit(1);
  }

  if (!multiScoreFile) {
    console.error('Error: No multi-score-analysis file found.');
    process.exit(1);
  }

  console.log(`Loading affiliate citation results: ${affiliateCitationFile}`);
  const affiliateCitations = JSON.parse(await fs.readFile(`./output/${affiliateCitationFile}`, 'utf-8'));

  console.log(`Loading multi-score-analysis: ${multiScoreFile}`);
  const multiScore = JSON.parse(await fs.readFile(`./output/${multiScoreFile}`, 'utf-8'));

  // Build patent metadata lookup from both affiliate and bluecoat files
  const patentMetadata = new Map<string, any>();

  if (affiliatePatentsFile) {
    console.log(`Loading affiliate patent metadata: ${affiliatePatentsFile}`);
    const affiliatePatents = JSON.parse(await fs.readFile(`./output/${affiliatePatentsFile}`, 'utf-8'));
    for (const p of affiliatePatents.patents || []) {
      patentMetadata.set(p.patent_id, p);
    }
  }

  if (bluecoatPatentsFile) {
    console.log(`Loading Blue Coat patent metadata: ${bluecoatPatentsFile}`);
    const bluecoatPatents = JSON.parse(await fs.readFile(`./output/${bluecoatPatentsFile}`, 'utf-8'));
    for (const p of bluecoatPatents.patents || []) {
      patentMetadata.set(p.patent_id, p);
    }
  }

  // Build existing patent lookup
  const existingPatents = new Map<string, MultiScorePatent>();
  for (const p of multiScore.patents) {
    existingPatents.set(p.patent_id, p);
  }

  console.log(`\nExisting patents in multi-score: ${existingPatents.size.toLocaleString()}`);
  console.log(`Affiliate patents analyzed: ${affiliateCitations.results.length}`);
  console.log(`Patent metadata available: ${patentMetadata.size}`);

  // Convert affiliate citation results to multi-score format
  const affiliateConverted: MultiScorePatent[] = [];
  let duplicates = 0;
  let newPatents = 0;
  let withCitations = 0;
  let expired = 0;

  for (const result of affiliateCitations.results) {
    if (existingPatents.has(result.patent_id)) {
      duplicates++;
      continue;
    }

    const metadata = patentMetadata.get(result.patent_id);
    const grantDate = result.grant_date || metadata?.patent_date || '';
    const yearsRemaining = calculateYearsRemaining(grantDate);

    // Skip expired patents (less than 3 years remaining)
    if (yearsRemaining < 3) {
      expired++;
      continue;
    }

    const patent: MultiScorePatent = {
      patent_id: result.patent_id,
      title: result.title || metadata?.patent_title || '',
      assignee: result.assignee || metadata?.assignees?.[0]?.assignee_organization || '',
      grant_date: grantDate,
      years_remaining: yearsRemaining,
      forward_citations: result.forward_citations || 0,
      competitor_citations: result.competitor_citations || 0,
      competitor_count: result.competitor_count || 0,
      competitors: result.competitors || [],
    };

    affiliateConverted.push(patent);
    newPatents++;

    if (result.competitor_citations > 0) {
      withCitations++;
    }
  }

  console.log(`\nProcessing results:`);
  console.log(`  Already in multi-score (skipped): ${duplicates}`);
  console.log(`  Expired (<3 years, skipped): ${expired}`);
  console.log(`  New patents to add: ${newPatents}`);
  console.log(`  With competitor citations: ${withCitations}`);

  // Merge
  const mergedPatents = [...multiScore.patents, ...affiliateConverted];

  // Sort by competitor citations
  mergedPatents.sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  // Create output
  const timestamp = new Date().toISOString().split('T')[0];
  const output = {
    metadata: {
      ...multiScore.metadata,
      lastUpdated: new Date().toISOString(),
      affiliateMerge: {
        affiliateCitationFile,
        originalCount: existingPatents.size,
        addedCount: newPatents,
        mergedTotal: mergedPatents.length,
        withCitations,
        sources: ['Pivotal Software', 'Carbon Black', 'Nyansa', 'Blue Coat Systems'],
      },
    },
    patents: mergedPatents,
  };

  // Save merged file
  const outputFile = `./output/multi-score-analysis-${timestamp}.json`;
  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n✓ Saved merged file: ${outputFile}`);

  // Update LATEST symlink
  await fs.writeFile('./output/multi-score-analysis-LATEST.json', JSON.stringify(output, null, 2));
  console.log(`✓ Updated: multi-score-analysis-LATEST.json`);

  // Create list of new patents needing LLM analysis
  const needsLlm = affiliateConverted
    .filter(p => p.competitor_citations >= 3 && p.years_remaining >= 5)
    .map(p => p.patent_id);

  if (needsLlm.length > 0) {
    await fs.writeFile(
      `./output/affiliates-needs-llm-${timestamp}.json`,
      JSON.stringify(needsLlm, null, 2)
    );
    console.log(`\n✓ Created LLM work list: ${needsLlm.length} patents`);
    console.log(`  File: affiliates-needs-llm-${timestamp}.json`);
  }

  // Summary stats by assignee
  const byAssignee = new Map<string, number>();
  for (const p of affiliateConverted) {
    const assignee = p.assignee;
    byAssignee.set(assignee, (byAssignee.get(assignee) || 0) + 1);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('MERGE COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total patents in merged file: ${mergedPatents.length.toLocaleString()}`);
  console.log(`\nNew patents by assignee:`);
  for (const [assignee, count] of Array.from(byAssignee.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${assignee}: ${count}`);
  }
  console.log(`\nPatents needing LLM analysis: ${needsLlm.length}`);
  console.log('\nNEXT STEPS:');
  console.log('  1. Run sector assignment: npx tsx scripts/assign-cpc-sectors.ts');
  console.log('  2. Regenerate exports: npm run export:all');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
