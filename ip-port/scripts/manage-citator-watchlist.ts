#!/usr/bin/env npx tsx
/**
 * Manage Citator Watchlist
 *
 * Updates the citator watchlist based on latest citation data:
 * - Identifies new companies meeting watchlist threshold
 * - Identifies companies ready for promotion to competitors.json
 * - Updates citation counts for existing watchlist entries
 *
 * Usage:
 *   npx tsx scripts/manage-citator-watchlist.ts [--update] [--report]
 *
 * Options:
 *   --update    Update watchlist with new citation data
 *   --report    Generate watchlist report without modifying
 *   --promote   List companies ready for promotion
 */

import * as fs from 'fs';
import * as path from 'path';

interface WatchlistCompany {
  name: string;
  added_date: string;
  reason: string;
  citations_at_discovery: number;
  patents_cited: number;
  industry: string;
  sector?: string;
  notes?: string;
  current_citations?: number;
  current_patents_cited?: number;
  last_updated?: string;
}

interface WatchlistConfig {
  version: string;
  description: string;
  last_updated: string;
  promotion_threshold: {
    citations_minimum: number;
    patents_cited_minimum: number;
    description: string;
  };
  watchlist_threshold: {
    citations_minimum: number;
    description: string;
  };
  categories: {
    [key: string]: {
      description: string;
      companies: WatchlistCompany[];
    };
  };
  promotion_history: {
    description: string;
    promotions: any[];
  };
  removal_history: {
    description: string;
    removals: any[];
  };
}

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

async function loadCitationData(): Promise<Map<string, CitatorData>> {
  const citatorMap = new Map<string, CitatorData>();
  const outputDir = 'output';

  // Find most recent citation overlap files
  const files = fs.readdirSync(outputDir)
    .filter(f => f.match(/citation-overlap-.*\.json$/))
    .sort()
    .reverse()
    .slice(0, 40); // Most recent batch

  if (files.length === 0) {
    console.log('No citation overlap files found.');
    return citatorMap;
  }

  // Get date from most recent file
  const dateMatch = files[0].match(/citation-overlap-\d+-(\d{4}-\d{2}-\d{2})\.json/);
  const latestDate = dateMatch ? dateMatch[1] : 'unknown';

  // Only process files from the latest date
  const latestFiles = files.filter(f => f.includes(latestDate));
  console.log(`Loading ${latestFiles.length} citation overlap files from ${latestDate}...`);

  for (const file of latestFiles) {
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

  return citatorMap;
}

function loadCompetitorPatterns(): Set<string> {
  const competitorConfig: CompetitorConfig = JSON.parse(
    fs.readFileSync('config/competitors.json', 'utf-8')
  );

  const patterns = new Set<string>();
  for (const category of Object.values(competitorConfig.categories)) {
    for (const company of category.companies) {
      for (const pattern of company.patterns) {
        patterns.add(pattern.toLowerCase());
      }
    }
  }
  return patterns;
}

function loadWatchlistNames(watchlist: WatchlistConfig): Set<string> {
  const names = new Set<string>();
  for (const category of Object.values(watchlist.categories)) {
    for (const company of category.companies) {
      names.add(company.name.toLowerCase());
    }
  }
  return names;
}

function isKnownCompetitor(assignee: string, competitorPatterns: Set<string>): boolean {
  const assigneeLower = assignee.toLowerCase();
  for (const pattern of competitorPatterns) {
    if (assigneeLower.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function isOnWatchlist(assignee: string, watchlistNames: Set<string>): boolean {
  const assigneeLower = assignee.toLowerCase();
  for (const name of watchlistNames) {
    if (assigneeLower.includes(name) || name.includes(assigneeLower.substring(0, 10))) {
      return true;
    }
  }
  return false;
}

async function generateReport(watchlist: WatchlistConfig, citationData: Map<string, CitatorData>) {
  console.log('\n' + '='.repeat(70));
  console.log('CITATOR WATCHLIST REPORT');
  console.log('='.repeat(70));

  // Count totals
  let totalCompanies = 0;
  for (const category of Object.values(watchlist.categories)) {
    totalCompanies += category.companies.length;
  }

  console.log(`\nWatchlist Summary:`);
  console.log(`  Total companies on watchlist: ${totalCompanies}`);
  console.log(`  Promotion threshold: ${watchlist.promotion_threshold.citations_minimum} citations, ${watchlist.promotion_threshold.patents_cited_minimum} patents`);
  console.log(`  Watchlist threshold: ${watchlist.watchlist_threshold.citations_minimum} citations`);

  // Report by category
  console.log('\n' + '-'.repeat(70));
  console.log('WATCHLIST BY CATEGORY');
  console.log('-'.repeat(70));

  for (const [categoryName, category] of Object.entries(watchlist.categories)) {
    console.log(`\n${categoryName.toUpperCase()} (${category.companies.length} companies)`);
    console.log(`  ${category.description}`);
    console.log('');

    for (const company of category.companies) {
      // Look up current citation data
      let currentCites = 0;
      let currentPatents = 0;
      for (const [assignee, data] of citationData) {
        if (assignee.toLowerCase().includes(company.name.toLowerCase().substring(0, 10))) {
          currentCites = data.citations;
          currentPatents = data.patents_citing.length;
          break;
        }
      }

      const promotionReady = currentCites >= watchlist.promotion_threshold.citations_minimum &&
        currentPatents >= watchlist.promotion_threshold.patents_cited_minimum;

      const indicator = promotionReady ? '[PROMOTE]' : '';
      console.log(`  ${company.name} ${indicator}`);
      console.log(`    Added: ${company.added_date} | Industry: ${company.industry}`);
      console.log(`    Original: ${company.citations_at_discovery} cites / ${company.patents_cited} patents`);
      if (currentCites > 0) {
        console.log(`    Current: ${currentCites} cites / ${currentPatents} patents`);
      }
    }
  }

  // Find promotion candidates
  console.log('\n' + '-'.repeat(70));
  console.log('PROMOTION CANDIDATES');
  console.log('-'.repeat(70));

  const promotionCandidates: { company: WatchlistCompany; currentCites: number; currentPatents: number }[] = [];

  for (const category of Object.values(watchlist.categories)) {
    for (const company of category.companies) {
      for (const [assignee, data] of citationData) {
        if (assignee.toLowerCase().includes(company.name.toLowerCase().substring(0, 10))) {
          if (data.citations >= watchlist.promotion_threshold.citations_minimum &&
              data.patents_citing.length >= watchlist.promotion_threshold.patents_cited_minimum) {
            promotionCandidates.push({
              company,
              currentCites: data.citations,
              currentPatents: data.patents_citing.length
            });
          }
          break;
        }
      }
    }
  }

  if (promotionCandidates.length > 0) {
    console.log(`\n${promotionCandidates.length} companies ready for promotion to competitors.json:\n`);
    for (const candidate of promotionCandidates.sort((a, b) => b.currentCites - a.currentCites)) {
      console.log(`  ${candidate.company.name}`);
      console.log(`    ${candidate.currentCites} citations, ${candidate.currentPatents} patents cited`);
      console.log(`    Industry: ${candidate.company.industry}`);
      console.log(`    Suggested patterns: ["${candidate.company.name.toLowerCase().split(' ')[0]}"]`);
    }
  } else {
    console.log('\nNo companies currently meet promotion thresholds.');
  }
}

async function findNewCandidates(
  citationData: Map<string, CitatorData>,
  competitorPatterns: Set<string>,
  watchlistNames: Set<string>,
  minCitations: number
): Promise<CitatorData[]> {
  const candidates: CitatorData[] = [];

  for (const [assignee, data] of citationData) {
    if (data.citations < minCitations) continue;
    if (isKnownCompetitor(assignee, competitorPatterns)) continue;
    if (isOnWatchlist(assignee, watchlistNames)) continue;

    candidates.push(data);
  }

  return candidates.sort((a, b) => b.citations - a.citations);
}

async function updateWatchlist(watchlist: WatchlistConfig, citationData: Map<string, CitatorData>) {
  const competitorPatterns = loadCompetitorPatterns();
  const watchlistNames = loadWatchlistNames(watchlist);

  // Update citation counts for existing entries
  let updated = 0;
  for (const category of Object.values(watchlist.categories)) {
    for (const company of category.companies) {
      for (const [assignee, data] of citationData) {
        if (assignee.toLowerCase().includes(company.name.toLowerCase().substring(0, 8))) {
          if (data.citations !== company.current_citations) {
            company.current_citations = data.citations;
            company.current_patents_cited = data.patents_citing.length;
            company.last_updated = new Date().toISOString().split('T')[0];
            updated++;
          }
          break;
        }
      }
    }
  }

  // Find new candidates
  const newCandidates = await findNewCandidates(
    citationData,
    competitorPatterns,
    watchlistNames,
    watchlist.watchlist_threshold.citations_minimum
  );

  console.log(`\nUpdated ${updated} existing entries.`);
  console.log(`Found ${newCandidates.length} new candidates meeting threshold of ${watchlist.watchlist_threshold.citations_minimum} citations.`);

  if (newCandidates.length > 0) {
    console.log('\nNew candidates for watchlist:');
    console.log('Cites\tPatents\tCompany');
    console.log('-'.repeat(60));
    for (const candidate of newCandidates.slice(0, 20)) {
      console.log(`${candidate.citations}\t${candidate.patents_citing.length}\t${candidate.assignee}`);
    }
  }

  // Update last_updated
  watchlist.last_updated = new Date().toISOString().split('T')[0];

  // Save updated watchlist
  fs.writeFileSync('config/citator-watchlist.json', JSON.stringify(watchlist, null, 2));
  console.log('\nWatchlist saved to config/citator-watchlist.json');

  return newCandidates;
}

async function main() {
  const doUpdate = process.argv.includes('--update');
  const doPromote = process.argv.includes('--promote');
  const doReport = process.argv.includes('--report') || (!doUpdate && !doPromote);

  console.log('='.repeat(70));
  console.log('CITATOR WATCHLIST MANAGER');
  console.log('='.repeat(70));

  // Load watchlist
  let watchlist: WatchlistConfig;
  try {
    watchlist = JSON.parse(fs.readFileSync('config/citator-watchlist.json', 'utf-8'));
    console.log(`Loaded watchlist v${watchlist.version}, last updated: ${watchlist.last_updated}`);
  } catch (e) {
    console.error('Could not load config/citator-watchlist.json');
    process.exit(1);
  }

  // Load citation data
  const citationData = await loadCitationData();
  console.log(`Loaded citation data for ${citationData.size} citing companies`);

  if (doUpdate) {
    await updateWatchlist(watchlist, citationData);
  }

  if (doReport || doPromote) {
    await generateReport(watchlist, citationData);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Usage:');
  console.log('  --update    Update watchlist with current citation data');
  console.log('  --report    Generate detailed watchlist report');
  console.log('  --promote   Show companies ready for promotion');
  console.log('='.repeat(70));
}

main().catch(console.error);
