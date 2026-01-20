/**
 * Merge VMware Data into Multi-Score Analysis
 *
 * Combines the VMware citation results with the existing multi-score-analysis
 * and runs sector assignment on the new patents.
 *
 * Usage: npx tsx scripts/merge-vmware-data.ts
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';

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
  // LLM fields
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  summary?: string;
  // V3 fields
  market_relevance_score?: number;
  evidence_accessibility_score?: number;
  trend_alignment_score?: number;
  // Risk fields
  ipr_risk_score?: number;
  prosecution_quality_score?: number;
}

function calculateYearsRemaining(grantDate: string): number {
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
  console.log('        MERGE VMWARE DATA INTO MULTI-SCORE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find latest files
  const vmwareCitationFile = await findLatestFile('vmware-citation-results');
  const multiScoreFile = await findLatestFile('multi-score-analysis');
  const vmwarePatentsFile = await findLatestFile('vmware-patents');

  if (!vmwareCitationFile) {
    console.error('Error: No vmware-citation-results file found.');
    console.error('Run: npm run analyze:vmware:citations');
    process.exit(1);
  }

  if (!multiScoreFile) {
    console.error('Error: No multi-score-analysis file found.');
    process.exit(1);
  }

  if (!vmwarePatentsFile) {
    console.error('Error: No vmware-patents file found.');
    console.error('Run: npm run download:vmware');
    process.exit(1);
  }

  console.log(`Loading VMware citation results: ${vmwareCitationFile}`);
  const vmwareCitations = JSON.parse(await fs.readFile(`./output/${vmwareCitationFile}`, 'utf-8'));

  console.log(`Loading VMware patent metadata: ${vmwarePatentsFile}`);
  const vmwarePatents = JSON.parse(await fs.readFile(`./output/${vmwarePatentsFile}`, 'utf-8'));

  console.log(`Loading multi-score-analysis: ${multiScoreFile}`);
  const multiScore = JSON.parse(await fs.readFile(`./output/${multiScoreFile}`, 'utf-8'));

  // Build patent metadata lookup
  const patentMetadata = new Map<string, any>();
  for (const p of vmwarePatents.patents) {
    patentMetadata.set(p.patent_id, p);
  }

  // Build existing patent lookup
  const existingPatents = new Map<string, MultiScorePatent>();
  for (const p of multiScore.patents) {
    existingPatents.set(p.patent_id, p);
  }

  console.log(`\nExisting patents in multi-score: ${existingPatents.size.toLocaleString()}`);
  console.log(`VMware patents to add: ${vmwareCitations.results.length.toLocaleString()}`);

  // Convert VMware citation results to multi-score format
  const vmwareConverted: MultiScorePatent[] = [];
  let duplicates = 0;
  let newPatents = 0;
  let withCitations = 0;

  for (const result of vmwareCitations.results) {
    if (existingPatents.has(result.patent_id)) {
      duplicates++;
      continue;
    }

    const metadata = patentMetadata.get(result.patent_id);
    const yearsRemaining = calculateYearsRemaining(result.grant_date);

    // Skip expired patents
    if (yearsRemaining < 3) {
      continue;
    }

    const patent: MultiScorePatent = {
      patent_id: result.patent_id,
      title: result.title,
      assignee: result.assignee,
      grant_date: result.grant_date,
      years_remaining: yearsRemaining,
      forward_citations: result.forward_citations,
      competitor_citations: result.competitor_citations,
      competitor_count: result.competitor_count,
      competitors: result.competitors,
    };

    vmwareConverted.push(patent);
    newPatents++;

    if (result.competitor_citations > 0) {
      withCitations++;
    }
  }

  console.log(`\nProcessing results:`);
  console.log(`  Already in multi-score (skipped): ${duplicates}`);
  console.log(`  Expired (<3 years, skipped): ${vmwareCitations.results.length - duplicates - newPatents}`);
  console.log(`  New patents to add: ${newPatents}`);
  console.log(`  With competitor citations: ${withCitations}`);

  // Merge
  const mergedPatents = [...multiScore.patents, ...vmwareConverted];

  // Sort by competitor citations
  mergedPatents.sort((a, b) => (b.competitor_citations || 0) - (a.competitor_citations || 0));

  // Create output
  const timestamp = new Date().toISOString().split('T')[0];
  const output = {
    metadata: {
      ...multiScore.metadata,
      lastUpdated: new Date().toISOString(),
      vmwareMerge: {
        vmwareCitationFile,
        vmwarePatentsFile,
        originalCount: existingPatents.size,
        addedCount: newPatents,
        mergedTotal: mergedPatents.length,
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

  // Create list of VMware patents needing LLM analysis
  const needsLlm = vmwareConverted
    .filter(p => p.competitor_citations >= 3 && p.years_remaining >= 5)
    .map(p => p.patent_id);

  if (needsLlm.length > 0) {
    await fs.writeFile(
      `./output/vmware-needs-llm-${timestamp}.json`,
      JSON.stringify(needsLlm, null, 2)
    );
    console.log(`\n✓ Created LLM work list: ${needsLlm.length} patents`);
    console.log(`  File: vmware-needs-llm-${timestamp}.json`);
  }

  // Summary stats
  const vmwareInMerged = mergedPatents.filter(p =>
    p.assignee.toLowerCase().includes('vmware') ||
    p.assignee.toLowerCase().includes('nicira') ||
    p.assignee.toLowerCase().includes('avi networks') ||
    p.assignee.toLowerCase().includes('lastline')
  );

  console.log('\n' + '═'.repeat(60));
  console.log('MERGE COMPLETE');
  console.log('═'.repeat(60));
  console.log(`Total patents in merged file: ${mergedPatents.length.toLocaleString()}`);
  console.log(`VMware-related patents: ${vmwareInMerged.length.toLocaleString()}`);
  console.log(`VMware patents needing LLM: ${needsLlm.length}`);
  console.log('\nNEXT STEPS:');
  console.log('  1. Run LLM analysis: npm run llm:batch output/vmware-needs-llm-*.json');
  console.log('  2. Regenerate exports: npm run export:all');
  console.log('═'.repeat(60) + '\n');
}

main().catch(console.error);
