/**
 * Analyze Patent Breadth - Fetch claims metadata from PatentsView API
 *
 * This script fetches claims data for patents to analyze:
 * - Number of total claims
 * - Number of independent claims
 * - Total claims text length
 * - Average claim length
 *
 * Usage:
 *   npx tsx scripts/analyze-patent-breadth.ts [--sample 10] [--patents 9569605,10200706]
 */

import 'dotenv/config';
import { createPatentsViewClient, Patent, Claim } from '../clients/patentsview-client.js';
import * as fs from 'fs';

interface PatentBreadthMetrics {
  patent_id: string;
  title?: string;
  total_claims: number;
  independent_claims: number;
  dependent_claims: number;
  total_claims_text_length: number;
  avg_claim_length: number;
  abstract_length: number;
  first_independent_claim_length: number;
}

async function fetchPatentClaims(client: ReturnType<typeof createPatentsViewClient>, patentIds: string[]): Promise<PatentBreadthMetrics[]> {
  const results: PatentBreadthMetrics[] = [];

  // Process one at a time due to complex query structure for claims
  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    console.log(`Fetching patent ${i + 1}/${patentIds.length}: ${patentId}...`);

    try {
      const response = await client.searchPatents({
        query: { patent_id: patentId },
        fields: [
          'patent_id',
          'patent_title',
          'patent_abstract',
          'claims.claim_text',
          'claims.claim_number',
          'claims.claim_dependent',
          'claims.claim_sequence',
        ],
        options: {
          size: 1,
        }
      });

      if (response.patents.length > 0) {
        const patent = response.patents[0];
        const claims = patent.claims || [];
        const independentClaims = claims.filter(c => !c.claim_dependent);
        const dependentClaims = claims.filter(c => c.claim_dependent);

        const totalClaimsTextLength = claims.reduce((sum, c) => sum + (c.claim_text?.length || 0), 0);
        const firstIndependentClaim = claims.find(c => !c.claim_dependent && c.claim_sequence === 1);

        results.push({
          patent_id: patent.patent_id,
          title: patent.patent_title,
          total_claims: claims.length,
          independent_claims: independentClaims.length,
          dependent_claims: dependentClaims.length,
          total_claims_text_length: totalClaimsTextLength,
          avg_claim_length: claims.length > 0 ? Math.round(totalClaimsTextLength / claims.length) : 0,
          abstract_length: patent.patent_abstract?.length || 0,
          first_independent_claim_length: firstIndependentClaim?.claim_text?.length || 0,
        });
      }
    } catch (error) {
      console.error(`Error fetching patent ${patentId}: ${error}`);
    }

    // Rate limit: 45 requests/minute
    if (i < patentIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  return results;
}

async function main() {
  const args = process.argv.slice(2);
  let sampleSize = 10;
  let specificPatents: string[] = [];

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample' && args[i + 1]) {
      sampleSize = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--patents' && args[i + 1]) {
      specificPatents = args[i + 1].split(',');
      i++;
    }
  }

  const client = createPatentsViewClient();

  let patentIds: string[];

  if (specificPatents.length > 0) {
    patentIds = specificPatents;
    console.log(`Fetching claims data for ${patentIds.length} specified patents...`);
  } else {
    // Load top patents from unified top 250
    const unifiedPath = 'output/unified-top250-v2-2026-01-17.json';
    if (fs.existsSync(unifiedPath)) {
      const unified = JSON.parse(fs.readFileSync(unifiedPath, 'utf-8'));
      patentIds = unified.patents.slice(0, sampleSize).map((p: any) => p.patent_id);
      console.log(`Fetching claims data for top ${sampleSize} patents from unified rankings...`);
    } else {
      // Fallback to multi-score
      const multiScorePath = 'output/multi-score-analysis-2026-01-17.json';
      const multiScore = JSON.parse(fs.readFileSync(multiScorePath, 'utf-8'));
      patentIds = multiScore.patents.slice(0, sampleSize).map((p: any) => p.patent_id);
      console.log(`Fetching claims data for top ${sampleSize} patents from multi-score...`);
    }
  }

  const results = await fetchPatentClaims(client, patentIds);

  // Display results
  console.log('\n--- Patent Breadth Analysis ---\n');
  console.log('Patent ID | Claims | Indep | Dep | Total Text | Avg Claim | Abstract | 1st Ind Claim');
  console.log('-'.repeat(90));

  for (const r of results) {
    console.log(
      `${r.patent_id.padEnd(10)} | ` +
      `${String(r.total_claims).padStart(6)} | ` +
      `${String(r.independent_claims).padStart(5)} | ` +
      `${String(r.dependent_claims).padStart(3)} | ` +
      `${String(r.total_claims_text_length).padStart(10)} | ` +
      `${String(r.avg_claim_length).padStart(9)} | ` +
      `${String(r.abstract_length).padStart(8)} | ` +
      `${String(r.first_independent_claim_length).padStart(13)}`
    );
  }

  // Summary statistics
  if (results.length > 0) {
    const avgClaims = results.reduce((sum, r) => sum + r.total_claims, 0) / results.length;
    const avgIndep = results.reduce((sum, r) => sum + r.independent_claims, 0) / results.length;
    const avgTextLen = results.reduce((sum, r) => sum + r.total_claims_text_length, 0) / results.length;
    const maxClaims = Math.max(...results.map(r => r.total_claims));
    const maxTextLen = Math.max(...results.map(r => r.total_claims_text_length));

    console.log('\n--- Summary ---');
    console.log(`Total patents analyzed: ${results.length}`);
    console.log(`Average claims per patent: ${avgClaims.toFixed(1)}`);
    console.log(`Average independent claims: ${avgIndep.toFixed(1)}`);
    console.log(`Average claims text length: ${avgTextLen.toFixed(0)} chars`);
    console.log(`Max claims: ${maxClaims}`);
    console.log(`Max claims text length: ${maxTextLen} chars`);
  }

  // Save results
  const outputPath = 'output/patent-breadth-analysis.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    generatedDate: new Date().toISOString(),
    patentCount: results.length,
    results,
    summary: results.length > 0 ? {
      avgClaims: results.reduce((sum, r) => sum + r.total_claims, 0) / results.length,
      avgIndependentClaims: results.reduce((sum, r) => sum + r.independent_claims, 0) / results.length,
      avgClaimsTextLength: results.reduce((sum, r) => sum + r.total_claims_text_length, 0) / results.length,
      maxClaims: Math.max(...results.map(r => r.total_claims)),
      maxClaimsTextLength: Math.max(...results.map(r => r.total_claims_text_length)),
    } : null
  }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(console.error);
