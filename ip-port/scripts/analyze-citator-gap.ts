/**
 * Analyze the citator gap - find who is citing patents with high forward cites but low competitor cites
 * This identifies potential competitors we're missing or pattern matching issues
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { createPatentsViewClient } from '../clients/patentsview-client.js';

dotenv.config();

// Load multi-score analysis
const multiScorePath = './output/multi-score-analysis-2026-01-17.json';
const competitorsPath = './config/competitors.json';

interface Patent {
  patent_id: string;
  title: string;
  forward_citations: number;
  competitor_citations: number;
  remaining_years: number;
  competitors: string[];
}

interface CitatorAnalysis {
  patent_id: string;
  title: string;
  forward_citations: number;
  competitor_citations: number;
  remaining_years: number;
  tracked_competitors: string[];
  all_citators: {
    company: string;
    patent_count: number;
    is_tracked: boolean;
  }[];
  missing_citator_count: number;
}

async function main() {
  console.log('Loading data...');

  // Load multi-score analysis
  const multiScore = JSON.parse(fs.readFileSync(multiScorePath, 'utf-8'));
  const patents: Patent[] = multiScore.patents;

  // Load competitors for pattern matching
  const competitors = JSON.parse(fs.readFileSync(competitorsPath, 'utf-8'));
  const allPatterns: string[] = [];
  for (const category of Object.values(competitors.categories) as any[]) {
    for (const company of category.companies) {
      allPatterns.push(...(company.patterns || [company.name]));
    }
  }
  const patternsLower = allPatterns.map(p => p.toLowerCase());

  console.log(`Loaded ${patents.length} patents, ${allPatterns.length} competitor patterns`);

  // Find patents with high forward citations but low competitor citations
  const gapPatents = patents
    .filter(p => p.forward_citations >= 50 && p.competitor_citations <= 5 && p.remaining_years >= 3)
    .sort((a, b) => b.forward_citations - a.forward_citations)
    .slice(0, 15);

  console.log(`\nFound ${gapPatents.length} patents with FC>=50, CC<=5, Years>=3`);
  console.log('='.repeat(80));

  const pvClient = createPatentsViewClient();
  const allCitatorCounts: Map<string, number> = new Map();
  const results: CitatorAnalysis[] = [];

  for (const patent of gapPatents) {
    console.log(`\nAnalyzing ${patent.patent_id}: FC=${patent.forward_citations} CC=${patent.competitor_citations}`);
    console.log(`  Title: ${patent.title.substring(0, 60)}...`);

    try {
      // Get citing patents
      const citingResponse = await pvClient.getPatentCitations(patent.patent_id, 'forward', 500);
      const citingPatents = citingResponse.citations || [];

      // Group by assignee
      const citatorMap: Map<string, number> = new Map();
      for (const cit of citingPatents) {
        const assignee = cit.citing_assignee || 'Unknown';
        citatorMap.set(assignee, (citatorMap.get(assignee) || 0) + 1);
        allCitatorCounts.set(assignee, (allCitatorCounts.get(assignee) || 0) + 1);
      }

      // Check which are tracked competitors
      const citators = Array.from(citatorMap.entries())
        .map(([company, count]) => ({
          company,
          patent_count: count,
          is_tracked: patternsLower.some(p => company.toLowerCase().includes(p.toLowerCase()))
        }))
        .sort((a, b) => b.patent_count - a.patent_count);

      const untrackedCitators = citators.filter(c => !c.is_tracked && c.company !== 'Unknown');

      results.push({
        patent_id: patent.patent_id,
        title: patent.title,
        forward_citations: patent.forward_citations,
        competitor_citations: patent.competitor_citations,
        remaining_years: patent.remaining_years,
        tracked_competitors: patent.competitors || [],
        all_citators: citators.slice(0, 15),
        missing_citator_count: untrackedCitators.reduce((sum, c) => sum + c.patent_count, 0)
      });

      console.log(`  Total citators: ${citators.length}, Untracked: ${untrackedCitators.length}`);
      console.log(`  Top untracked citators:`);
      for (const c of untrackedCitators.slice(0, 5)) {
        console.log(`    - ${c.company}: ${c.patent_count} citations`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500));

    } catch (error) {
      console.error(`  Error fetching citations: ${error}`);
    }
  }

  // Summary: top untracked citators across all analyzed patents
  console.log('\n' + '='.repeat(80));
  console.log('TOP UNTRACKED CITATORS (across all analyzed patents):');
  console.log('='.repeat(80));

  const sortedCitators = Array.from(allCitatorCounts.entries())
    .filter(([company]) => {
      const isTracked = patternsLower.some(p => company.toLowerCase().includes(p.toLowerCase()));
      return !isTracked && company !== 'Unknown';
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  for (const [company, count] of sortedCitators) {
    console.log(`  ${company}: ${count} citations`);
  }

  // Save results
  const outputPath = `./output/citator-gap-analysis-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(outputPath, JSON.stringify({
    generated: new Date().toISOString(),
    summary: {
      patents_analyzed: results.length,
      top_untracked_citators: sortedCitators.slice(0, 20).map(([company, count]) => ({ company, citations: count }))
    },
    patent_analyses: results
  }, null, 2));

  console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(console.error);
