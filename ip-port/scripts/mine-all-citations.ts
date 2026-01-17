/**
 * Full Citation Mining Script
 *
 * Queries PatentsView for ALL forward citations on top Broadcom patents
 * to identify ALL companies citing our portfolio - not just current competitors.
 *
 * This helps discover new potential competitors/licensing targets.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { CompetitorMatcher } from '../services/competitor-config.js';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;
const OUTPUT_DIR = './output';

// Rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5 seconds between requests

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();
}

interface CitingPatent {
  patent_id: string;
  patent_title: string;
  patent_date: string;
  assignee: string;
  assignee_normalized?: string;
}

interface CitationResult {
  broadcom_patent_id: string;
  forward_citation_count: number;
  citing_patents: CitingPatent[];
}

interface AssigneeStats {
  assignee: string;
  normalized: string;
  citation_count: number;
  unique_patents: number;
  broadcom_patents_cited: Set<string>;
  is_competitor: boolean;
  competitor_name?: string;
  competitor_category?: string;
}

/**
 * Make a rate-limited POST request to PatentsView
 */
async function rateLimitedPost(endpoint: string, body: any): Promise<any> {
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
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

/**
 * Query forward citations for a patent
 */
async function getCitingPatents(patentId: string): Promise<CitingPatent[]> {
  try {
    // Step 1: Query the citation endpoint to find patents that cite this one
    const citationData = await rateLimitedPost('/patent/us_patent_citation/', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: 500 }
    });

    if (!citationData.us_patent_citations || citationData.us_patent_citations.length === 0) {
      return [];
    }

    // Get unique citing patent IDs
    const citingIds = [...new Set(citationData.us_patent_citations.map((c: any) => c.patent_id))] as string[];

    if (citingIds.length === 0) return [];

    // Step 2: Get assignee info for citing patents (batch of up to 100)
    const patentData = await rateLimitedPost('/patent/', {
      q: { _or: citingIds.slice(0, 100).map((id: string) => ({ patent_id: id })) },
      f: ['patent_id', 'patent_title', 'patent_date', 'assignees'],
      o: { size: 100 }
    });

    // Step 3: Return all citing patents with assignee info
    return (patentData.patents || []).map((p: any) => ({
      patent_id: p.patent_id,
      patent_title: p.patent_title || '',
      patent_date: p.patent_date || '',
      assignee: p.assignees?.[0]?.assignee_organization || p.assignees?.[0]?.assignee_individual || 'Unknown',
    }));
  } catch (error) {
    console.error(`  Error fetching citations for ${patentId}:`, error);
    return [];
  }
}

/**
 * Normalize assignee name for grouping
 */
function normalizeAssignee(name: string): string {
  return name.toLowerCase()
    .replace(/,?\s*(inc|llc|ltd|corp|corporation|company|co|technologies|technology|licensing|holdings|group)\.?$/gi, '')
    .replace(/,?\s*(inc|llc|ltd|corp|corporation|company|co|technologies|technology|licensing|holdings|group)\.?$/gi, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Load top patents to analyze
 */
function loadTopPatents(limit: number = 500): string[] {
  // Try to load from multi-score analysis (has best ranking)
  const multiScorePath = path.join(OUTPUT_DIR, 'multi-score-analysis-2026-01-16.json');
  if (fs.existsSync(multiScorePath)) {
    const data = JSON.parse(fs.readFileSync(multiScorePath, 'utf-8'));
    const patents = data.patents || [];
    // Sort by overallActionableScore descending
    patents.sort((a: any, b: any) => (b.overallActionableScore || 0) - (a.overallActionableScore || 0));
    return patents.slice(0, limit).map((p: any) => p.patent_id);
  }

  // Fallback to portfolio with high forward citations
  const portfolioPath = path.join(OUTPUT_DIR, 'broadcom-portfolio-2026-01-15.json');
  if (fs.existsSync(portfolioPath)) {
    const data = JSON.parse(fs.readFileSync(portfolioPath, 'utf-8'));
    const patents = data.patents || [];
    patents.sort((a: any, b: any) => (b.patent_num_times_cited_by_us_patents || 0) - (a.patent_num_times_cited_by_us_patents || 0));
    return patents.slice(0, limit).map((p: any) => p.patent_id);
  }

  throw new Error('No patent data found to analyze');
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args[0]) || 100;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FULL CITATION MINING - All Citing Companies');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load competitor matcher
  const matcher = new CompetitorMatcher();
  console.log(matcher.getSummary());
  console.log();

  // Load top patents
  console.log(`Loading top ${limit} Broadcom patents by score...`);
  const patentIds = loadTopPatents(limit);
  console.log(`Found ${patentIds.length} patents to analyze\n`);

  // Collect all citations
  const assigneeStats = new Map<string, AssigneeStats>();
  let totalCitations = 0;
  let patentsWithCitations = 0;

  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    process.stdout.write(`\r  Processing ${i + 1}/${patentIds.length}: ${patentId}...`);

    const citingPatents = await getCitingPatents(patentId);

    if (citingPatents.length > 0) {
      patentsWithCitations++;
      totalCitations += citingPatents.length;

      for (const cite of citingPatents) {
        const normalized = normalizeAssignee(cite.assignee);

        // Skip if this is Broadcom-related
        if (matcher.isExcluded(cite.assignee)) continue;

        if (!assigneeStats.has(normalized)) {
          const match = matcher.matchCompetitor(cite.assignee);
          assigneeStats.set(normalized, {
            assignee: cite.assignee,
            normalized,
            citation_count: 0,
            unique_patents: 0,
            broadcom_patents_cited: new Set(),
            is_competitor: !!match,
            competitor_name: match?.company,
            competitor_category: match?.category,
          });
        }

        const stats = assigneeStats.get(normalized)!;
        stats.citation_count++;
        stats.broadcom_patents_cited.add(patentId);
      }
    }

    // Progress update every 10 patents
    if ((i + 1) % 10 === 0) {
      process.stdout.write(`\r  Progress: ${i + 1}/${patentIds.length} | Citations: ${totalCitations} | Assignees: ${assigneeStats.size}          `);
    }
  }

  console.log(`\n\nMining complete!`);
  console.log(`  Patents analyzed: ${patentIds.length}`);
  console.log(`  Patents with citations: ${patentsWithCitations}`);
  console.log(`  Total citations found: ${totalCitations}`);
  console.log(`  Unique citing assignees: ${assigneeStats.size}\n`);

  // Convert to array and sort
  const sortedAssignees = Array.from(assigneeStats.values())
    .map(s => ({
      ...s,
      unique_patents: s.broadcom_patents_cited.size,
      broadcom_patents_cited: Array.from(s.broadcom_patents_cited),
    }))
    .sort((a, b) => b.citation_count - a.citation_count);

  // Separate current competitors from potential new ones
  const currentCompetitors = sortedAssignees.filter(a => a.is_competitor);
  const potentialCompetitors = sortedAssignees.filter(a => !a.is_competitor);

  // Display results
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CURRENT COMPETITORS (Already Tracking)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  currentCompetitors.slice(0, 30).forEach((a, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${a.competitor_name} [${a.competitor_category}]`);
    console.log(`      Citations: ${a.citation_count} | Broadcom Patents: ${a.unique_patents}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  POTENTIAL NEW COMPETITORS (Not Currently Tracking)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  potentialCompetitors.slice(0, 50).forEach((a, i) => {
    console.log(`${String(i + 1).padStart(3)}. ${a.assignee}`);
    console.log(`      Citations: ${a.citation_count} | Broadcom Patents: ${a.unique_patents}`);
  });

  // Categorize potential competitors by keywords
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  POTENTIAL COMPETITORS BY SECTOR');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const sectorKeywords: Record<string, string[]> = {
    'Semiconductor': ['semiconductor', 'chip', 'micron', 'texas instruments', 'nxp', 'mediatek', 'realtek', 'silicon'],
    'Telecom/Network': ['telecom', 'huawei', 'zte', 'samsung', 'lg', 'communication'],
    'Enterprise/Cloud': ['ibm', 'red hat', 'citrix', 'nutanix', 'tableau'],
    'Security': ['security', 'mcafee', 'trend micro', 'sophos', 'fireeye'],
    'Consumer Electronics': ['samsung', 'lg electronics', 'panasonic', 'sharp', 'philips', 'honeywell'],
  };

  for (const [sector, keywords] of Object.entries(sectorKeywords)) {
    const matches = potentialCompetitors.filter(a =>
      keywords.some(k => a.normalized.includes(k))
    );
    if (matches.length > 0) {
      console.log(`${sector}:`);
      matches.slice(0, 5).forEach(a => {
        console.log(`  - ${a.assignee} (${a.citation_count} citations, ${a.unique_patents} patents)`);
      });
      console.log();
    }
  }

  // Save results
  const outputPath = path.join(OUTPUT_DIR, `citation-mining-${new Date().toISOString().split('T')[0]}.json`);
  const outputData = {
    metadata: {
      generatedDate: new Date().toISOString(),
      patentsAnalyzed: patentIds.length,
      patentsWithCitations: patentsWithCitations,
      totalCitations: totalCitations,
      uniqueAssignees: assigneeStats.size,
    },
    currentCompetitors: currentCompetitors.slice(0, 100),
    potentialCompetitors: potentialCompetitors.slice(0, 200),
    summary: {
      topCurrentCompetitors: currentCompetitors.slice(0, 10).map(a => ({
        name: a.competitor_name,
        category: a.competitor_category,
        citations: a.citation_count,
        broadcomPatents: a.unique_patents,
      })),
      topPotentialCompetitors: potentialCompetitors.slice(0, 20).map(a => ({
        name: a.assignee,
        citations: a.citation_count,
        broadcomPatents: a.unique_patents,
      })),
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  console.log(`\n✓ Results saved to: ${outputPath}`);
}

main().catch(console.error);
