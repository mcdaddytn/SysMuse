#!/usr/bin/env npx tsx
/**
 * Analyze citing companies that are NOT in our official competitor list
 * Identifies "unknown citators" for potential addition to competitor tracking
 */

import * as fs from 'fs';
import * as path from 'path';

interface CitatorData {
  assignee: string;
  citations: number;
  patents_citing: string[];
}

interface CompetitorConfig {
  categories: {
    [key: string]: {
      companies: {
        name: string;
        patterns: string[];
      }[];
    };
  };
}

async function analyzeUnknownCitators() {
  console.log('=== UNKNOWN CITATOR ANALYSIS ===\n');

  // Load competitor patterns
  const competitorConfig: CompetitorConfig = JSON.parse(
    fs.readFileSync('config/competitors.json', 'utf-8')
  );

  // Build pattern set (lowercase for matching)
  const competitorPatterns = new Set<string>();
  const companyToCategory = new Map<string, string>();

  for (const [category, data] of Object.entries(competitorConfig.categories)) {
    for (const company of data.companies) {
      for (const pattern of company.patterns) {
        competitorPatterns.add(pattern.toLowerCase());
        companyToCategory.set(pattern.toLowerCase(), category);
      }
    }
  }

  console.log(`Loaded ${competitorPatterns.size} competitor patterns from ${Object.keys(competitorConfig.categories).length} categories\n`);

  // Extract all citing companies from citation overlap files
  const citatorMap = new Map<string, CitatorData>();

  const outputDir = 'output';
  const files = fs.readdirSync(outputDir)
    .filter(f => f.match(/citation-overlap-.*-2026-01-19\.json$/));

  console.log(`Processing ${files.length} citation overlap files...\n`);

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(outputDir, file), 'utf-8'));

    for (const result of data.results || []) {
      for (const cite of result.competitor_cites || []) {
        const assignee = cite.assignee;
        if (!assignee) continue;

        if (!citatorMap.has(assignee)) {
          citatorMap.set(assignee, {
            assignee,
            citations: 0,
            patents_citing: []
          });
        }

        const entry = citatorMap.get(assignee)!;
        entry.citations++;
        if (!entry.patents_citing.includes(result.broadcom_patent_id)) {
          entry.patents_citing.push(result.broadcom_patent_id);
        }
      }
    }
  }

  // Check which citators are NOT matched
  const unknownCitators: CitatorData[] = [];
  const knownCitators: CitatorData[] = [];

  for (const [assignee, data] of citatorMap) {
    const assigneeLower = assignee.toLowerCase();
    let isKnown = false;

    for (const pattern of competitorPatterns) {
      if (assigneeLower.includes(pattern)) {
        isKnown = true;
        break;
      }
    }

    if (isKnown) {
      knownCitators.push(data);
    } else {
      unknownCitators.push(data);
    }
  }

  // Sort by citations
  unknownCitators.sort((a, b) => b.citations - a.citations);
  knownCitators.sort((a, b) => b.citations - a.citations);

  // Summary
  const totalCitations = [...citatorMap.values()].reduce((sum, c) => sum + c.citations, 0);
  const unknownCitations = unknownCitators.reduce((sum, c) => sum + c.citations, 0);
  const knownCitations = knownCitators.reduce((sum, c) => sum + c.citations, 0);

  console.log('=== SUMMARY ===');
  console.log(`Total unique citing companies: ${citatorMap.size}`);
  console.log(`Known competitors: ${knownCitators.length} (${knownCitations.toLocaleString()} citations - ${(knownCitations/totalCitations*100).toFixed(1)}%)`);
  console.log(`Unknown citators: ${unknownCitators.length} (${unknownCitations.toLocaleString()} citations - ${(unknownCitations/totalCitations*100).toFixed(1)}%)`);
  console.log('');

  console.log('=== TOP 40 UNKNOWN CITATORS (Not in competitor list) ===');
  console.log('Cites\tPatents\tCompany');
  console.log('─'.repeat(70));

  for (const citator of unknownCitators.slice(0, 40)) {
    console.log(`${citator.citations}\t${citator.patents_citing.length}\t${citator.assignee}`);
  }

  console.log('\n=== TOP 20 KNOWN COMPETITORS (Already tracked) ===');
  console.log('Cites\tPatents\tCompany');
  console.log('─'.repeat(70));

  for (const citator of knownCitators.slice(0, 20)) {
    console.log(`${citator.citations}\t${citator.patents_citing.length}\t${citator.assignee}`);
  }

  // Group unknown citators by potential category
  console.log('\n=== RECOMMENDED ADDITIONS BY CATEGORY ===\n');

  const categoryRecommendations: { [key: string]: CitatorData[] } = {
    'telecom': [],
    'privacy-compliance': [],
    'networking': [],
    'storage': [],
    'semiconductor': [],
    'security': [],
    'cloud-services': [],
    'other': []
  };

  for (const citator of unknownCitators.slice(0, 100)) {
    const name = citator.assignee.toLowerCase();

    if (name.includes('at&t') || name.includes('t-mobile') || name.includes('verizon') || name.includes('nokia')) {
      categoryRecommendations['telecom'].push(citator);
    } else if (name.includes('onetrust') || name.includes('knowbe4') || name.includes('privacy')) {
      categoryRecommendations['privacy-compliance'].push(citator);
    } else if (name.includes('juniper') || name.includes('netskope') || name.includes('arista')) {
      categoryRecommendations['networking'].push(citator);
    } else if (name.includes('pure storage') || name.includes('netapp') || name.includes('seagate')) {
      categoryRecommendations['storage'].push(citator);
    } else if (name.includes('amd') || name.includes('arm') || name.includes('micron')) {
      categoryRecommendations['semiconductor'].push(citator);
    } else if (name.includes('fireeye') || name.includes('crowdstrike') || name.includes('sentinel')) {
      categoryRecommendations['security'].push(citator);
    } else {
      categoryRecommendations['other'].push(citator);
    }
  }

  for (const [category, citators] of Object.entries(categoryRecommendations)) {
    if (citators.length === 0) continue;
    console.log(`${category.toUpperCase()} (${citators.length} companies):`);
    for (const c of citators.slice(0, 5)) {
      console.log(`  ${c.citations} cites | ${c.patents_citing.length} patents | ${c.assignee}`);
    }
    console.log('');
  }

  // Save detailed report
  const report = {
    generated: new Date().toISOString(),
    summary: {
      total_citing_companies: citatorMap.size,
      known_competitors: knownCitators.length,
      unknown_citators: unknownCitators.length,
      total_citations: totalCitations,
      known_citations: knownCitations,
      unknown_citations: unknownCitations,
      coverage_percent: (knownCitations / totalCitations * 100).toFixed(1)
    },
    top_unknown_citators: unknownCitators.slice(0, 100).map(c => ({
      company: c.assignee,
      citations: c.citations,
      patents_cited: c.patents_citing.length
    })),
    top_known_competitors: knownCitators.slice(0, 50).map(c => ({
      company: c.assignee,
      citations: c.citations,
      patents_cited: c.patents_citing.length
    }))
  };

  const reportPath = `output/unknown-citators-analysis-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed report saved to: ${reportPath}`);
}

analyzeUnknownCitators().catch(console.error);
