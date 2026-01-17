/**
 * Cluster-Based Competitor Discovery
 *
 * Runs term-extraction competitor discovery for a specific cluster
 * from the hybrid cluster analysis.
 *
 * Usage: npx tsx scripts/cluster-competitor-discovery.ts <cluster_number>
 * Example: npx tsx scripts/cluster-competitor-discovery.ts 1
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;
const INPUT_DIR = './output/clusters';
const OUTPUT_DIR = './output/clusters';

// Rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500;

const competitorMatcher = new CompetitorMatcher();

interface ClusterDefinition {
  id: number;
  name: string;
  patentCount: number;
  patentIds: string[];
  centroidTerms: Array<{ term: string; weight: number }>;
  dominantCPCs: string[];
  totalCompetitorCitations: number;
  uniqueCompetitors: string[];
}

interface AssigneeResult {
  assignee: string;
  patent_count: number;
  cpc_codes: string[];
  sample_titles: string[];
  is_current_competitor: boolean;
  matched_terms: string[];
}

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

/**
 * Make a rate-limited POST request to PatentsView
 */
async function pvRequest(endpoint: string, body: any): Promise<any> {
  await rateLimit();

  const response = await fetch(`${PATENTSVIEW_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': apiKey || '',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`PatentsView API Error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Load cluster definitions
 */
function loadClusters(): ClusterDefinition[] {
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => f.startsWith('cluster-definitions-'))
    .sort()
    .reverse();

  if (files.length === 0) {
    throw new Error('No cluster definition files found. Run hybrid-cluster-analysis.ts first.');
  }

  const filePath = path.join(INPUT_DIR, files[0]);
  console.log(`Loading clusters from: ${filePath}`);

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.clusters;
}

/**
 * Search for patents containing cluster terms
 */
async function searchByTerms(
  terms: string[],
  cpcs: string[]
): Promise<AssigneeResult[]> {
  const assigneeMap = new Map<string, {
    count: number;
    cpcs: Set<string>;
    titles: string[];
    matchedTerms: Set<string>;
  }>();

  // Search each term
  for (const term of terms.slice(0, 8)) {
    console.log(`  Searching term: "${term}"...`);

    try {
      const body = {
        q: {
          _and: [
            { _text_any: { patent_abstract: term } },
            { _gte: { patent_date: '2020-01-01' } }
          ]
        },
        f: ['patent_id', 'patent_title', 'assignees.assignee_organization', 'cpc_current.cpc_subclass'],
        o: { size: 200 },
        s: [{ patent_date: 'desc' }]
      };

      const data = await pvRequest('/patent/', body);

      if (!data.patents) continue;

      for (const patent of data.patents) {
        const assignees = patent.assignees || [];
        const patentCpcs = (patent.cpc_current || []).map((c: any) => c.cpc_subclass);

        for (const assignee of assignees) {
          const org = assignee.assignee_organization;
          if (!org) continue;

          // Skip Broadcom-related
          const lower = org.toLowerCase();
          if (lower.includes('broadcom') || lower.includes('avago') || lower.includes('symantec')) continue;

          if (!assigneeMap.has(org)) {
            assigneeMap.set(org, {
              count: 0,
              cpcs: new Set(),
              titles: [],
              matchedTerms: new Set()
            });
          }

          const entry = assigneeMap.get(org)!;
          entry.count++;
          patentCpcs.forEach((c: string) => entry.cpcs.add(c));
          entry.matchedTerms.add(term);
          if (entry.titles.length < 3) {
            entry.titles.push(patent.patent_title);
          }
        }
      }
    } catch (error) {
      console.log(`    Error searching term "${term}": ${error}`);
    }
  }

  // Also search by CPC codes
  for (const cpc of cpcs.slice(0, 3)) {
    console.log(`  Searching CPC: "${cpc}"...`);

    try {
      const body = {
        q: {
          _and: [
            { _begins: { cpc_current: { cpc_subclass: cpc } } },
            { _gte: { patent_date: '2022-01-01' } }
          ]
        },
        f: ['patent_id', 'patent_title', 'assignees.assignee_organization', 'cpc_current.cpc_subclass'],
        o: { size: 200 },
        s: [{ patent_date: 'desc' }]
      };

      const data = await pvRequest('/patent/', body);

      if (!data.patents) continue;

      for (const patent of data.patents) {
        const assignees = patent.assignees || [];
        const patentCpcs = (patent.cpc_current || []).map((c: any) => c.cpc_subclass);

        for (const assignee of assignees) {
          const org = assignee.assignee_organization;
          if (!org) continue;

          const lower = org.toLowerCase();
          if (lower.includes('broadcom') || lower.includes('avago') || lower.includes('symantec')) continue;

          if (!assigneeMap.has(org)) {
            assigneeMap.set(org, {
              count: 0,
              cpcs: new Set(),
              titles: [],
              matchedTerms: new Set()
            });
          }

          const entry = assigneeMap.get(org)!;
          entry.count++;
          patentCpcs.forEach((c: string) => entry.cpcs.add(c));
          if (entry.titles.length < 3) {
            entry.titles.push(patent.patent_title);
          }
        }
      }
    } catch (error) {
      console.log(`    Error searching CPC "${cpc}": ${error}`);
    }
  }

  // Convert to array
  return Array.from(assigneeMap.entries())
    .map(([assignee, data]) => ({
      assignee,
      patent_count: data.count,
      cpc_codes: [...data.cpcs],
      sample_titles: data.titles,
      is_current_competitor: competitorMatcher.matchCompetitor(assignee) !== null,
      matched_terms: [...data.matchedTerms]
    }))
    .sort((a, b) => b.patent_count - a.patent_count);
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Cluster-Based Competitor Discovery');
  console.log('='.repeat(60));

  if (!apiKey) {
    console.error('PATENTSVIEW_API_KEY not found');
    process.exit(1);
  }

  // Parse cluster number
  const args = process.argv.slice(2);
  const clusterNum = args[0] ? parseInt(args[0]) : 1;

  // Load clusters
  const clusters = loadClusters();
  console.log(`Loaded ${clusters.length} clusters`);

  if (clusterNum < 1 || clusterNum > clusters.length) {
    console.error(`Invalid cluster number. Must be 1-${clusters.length}`);
    process.exit(1);
  }

  const cluster = clusters[clusterNum - 1];
  console.log(`\nTarget Cluster ${clusterNum}: ${cluster.name}`);
  console.log(`  Patents: ${cluster.patentCount}`);
  console.log(`  Competitor Citations: ${cluster.totalCompetitorCitations}`);
  console.log(`  Search Terms: ${cluster.centroidTerms.slice(0, 8).map(t => t.term).join(', ')}`);
  console.log(`  CPCs: ${cluster.dominantCPCs.join(', ')}`);

  // Run competitor discovery
  console.log('\nSearching USPTO for potential competitors...');
  const terms = cluster.centroidTerms.map(t => t.term);
  const results = await searchByTerms(terms, cluster.dominantCPCs);

  // Filter and categorize
  const newCompetitors = results.filter(r => !r.is_current_competitor && r.patent_count >= 5);
  const trackedCompetitors = results.filter(r => r.is_current_competitor);

  // Display results
  console.log('\n' + '='.repeat(60));
  console.log('DISCOVERY RESULTS');
  console.log('='.repeat(60));

  console.log(`\nTotal assignees found: ${results.length}`);
  console.log(`Already tracked: ${trackedCompetitors.length}`);
  console.log(`New potential competitors (5+ patents): ${newCompetitors.length}`);

  console.log('\nTop 20 Assignees:');
  console.log('-'.repeat(60));
  results.slice(0, 20).forEach((r, i) => {
    const flag = r.is_current_competitor ? '[TRACKED]' : '';
    console.log(`${(i + 1).toString().padStart(2)}. ${r.assignee.substring(0, 40).padEnd(40)} ${r.patent_count} patents ${flag}`);
    if (r.matched_terms.length > 0) {
      console.log(`    Terms: ${r.matched_terms.join(', ')}`);
    }
  });

  console.log('\nNew Potential Competitors (10+ patents):');
  console.log('-'.repeat(60));
  newCompetitors
    .filter(r => r.patent_count >= 10)
    .slice(0, 15)
    .forEach(r => {
      console.log(`  ${r.assignee}: ${r.patent_count} patents`);
      console.log(`    Sample: "${r.sample_titles[0]?.substring(0, 60)}..."`);
      console.log(`    Terms: ${r.matched_terms.join(', ')}`);
    });

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = path.join(OUTPUT_DIR, `cluster-${clusterNum}-competitors-${timestamp}.json`);

  // Generate strategy ID for provenance
  const strategyId = `cluster-hybrid-${clusterNum}-${cluster.name.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 30)}`;

  fs.writeFileSync(outputFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    cluster: {
      number: clusterNum,
      name: cluster.name,
      patentCount: cluster.patentCount,
      searchTerms: terms.slice(0, 10),
      cpcs: cluster.dominantCPCs
    },
    strategyId: strategyId,
    results: {
      totalAssignees: results.length,
      trackedCompetitors: trackedCompetitors.length,
      newPotentialCompetitors: newCompetitors.length,
      allAssignees: results,
      recommendations: newCompetitors.filter(r => r.patent_count >= 10).map(r => ({
        name: r.assignee,
        patterns: [r.assignee, r.assignee.split(' ')[0]],
        patentCount: r.patent_count,
        matchedTerms: r.matched_terms,
        discoveredBy: strategyId
      }))
    }
  }, null, 2));

  console.log(`\nSaved results to: ${outputFile}`);

  // Generate strategy definition for competitors.json
  const strategyDef = {
    [strategyId]: {
      name: `Hybrid Cluster - ${cluster.name}`,
      description: `Competitors discovered via term extraction from cluster of ${cluster.patentCount} high-value patents`,
      type: 'term-extraction',
      dateAdded: timestamp,
      parameters: {
        sourceStrategy: 'citation-overlap-broadcom-streaming',
        clusterMethod: 'agglomerative-term-affinity',
        clusterNumber: clusterNum,
        patentCount: cluster.patentCount,
        extractedTerms: terms.slice(0, 10),
        dominantCPCs: cluster.dominantCPCs,
        script: 'scripts/cluster-competitor-discovery.ts'
      }
    }
  };

  console.log('\nStrategy definition for competitors.json:');
  console.log(JSON.stringify(strategyDef, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('Discovery Complete');
  console.log(`Next cluster: npx tsx scripts/cluster-competitor-discovery.ts ${clusterNum + 1}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
