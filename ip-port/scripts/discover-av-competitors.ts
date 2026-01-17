/**
 * Avago A/V Niche Competitor Discovery Script
 *
 * Phase 3 of the Avago A/V Analysis Approach:
 * - Queries PatentsView API for companies in A/V CPC codes
 * - Uses extracted terms to find relevant patent assignees
 * - Identifies niche professional A/V companies
 * - Cross-references against current competitor list
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;
const OUTPUT_DIR = './output/avago-av';
const CONFIG_DIR = './config';

// Rate limiter
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1500; // 1.5 seconds

// Target A/V CPC codes (class level)
const AV_CPC_CLASSES = [
  'H04N',  // Video coding/transmission
  'H04R',  // Audio/acoustics
  'G10L',  // Speech/audio processing
  'G06T',  // Image processing
  'G11B',  // Information storage
  'H04S',  // Stereophonic systems
  'G09G',  // Display control
];

// Known niche A/V companies to look for
const KNOWN_AV_COMPANIES = [
  'Avid Technology',
  'Blackmagic Design',
  'Dolby Laboratories',
  'DTS',
  'Harmonic',
  'Grass Valley',
  'Ross Video',
  'AJA Video',
  'Matrox',
  'Xilinx',
  'Lattice Semiconductor',
  'Cirrus Logic',
  'Texas Instruments',
  'Analog Devices',
  'NXP',
  'Qualcomm',
  'MediaTek',
  'Realtek',
  'NVIDIA',
  'Intel',
  'AMD',
  'Synaptics',
  'ams AG',
  'STMicroelectronics',
  'ON Semiconductor',
  'Knowles',
  'InvenSense',
  'Akustica',
  'Goertek',
  'AAC Technologies',
  'Bose',
  'Harman',
  'Bang & Olufsen',
  'Sonos',
  'JBL',
  'Sennheiser',
  'Shure',
  'Audio-Technica',
  'Rode',
  'Zoom',
  'Focusrite',
  'PreSonus',
  'Universal Audio',
  'Waves Audio',
  'iZotope',
  'Native Instruments',
  'Ableton',
  'Steinberg',
  'Avid Pro Tools'
];

interface AssigneeResult {
  assignee: string;
  patent_count: number;
  cpc_codes: string[];
  sample_titles: string[];
  is_known_av_company: boolean;
  is_current_competitor: boolean;
}

interface CompetitorConfig {
  version: string;
  categories: Record<string, {
    description: string;
    enabled: boolean;
    companies: Array<{
      name: string;
      patterns: string[];
    }>;
  }>;
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
 * Load current competitor configuration
 */
function loadCurrentCompetitors(): Set<string> {
  const configPath = path.join(CONFIG_DIR, 'competitors.json');
  if (!fs.existsSync(configPath)) {
    return new Set();
  }

  const config: CompetitorConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const patterns = new Set<string>();

  for (const [_, category] of Object.entries(config.categories)) {
    if (!category.enabled) continue;
    for (const company of category.companies) {
      patterns.add(company.name.toLowerCase());
      for (const pattern of company.patterns) {
        patterns.add(pattern.toLowerCase());
      }
    }
  }

  return patterns;
}

/**
 * Check if assignee matches current competitor list
 */
function isCurrentCompetitor(assignee: string, currentCompetitors: Set<string>): boolean {
  const lower = assignee.toLowerCase();
  for (const pattern of currentCompetitors) {
    if (lower.includes(pattern) || pattern.includes(lower)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if assignee is a known A/V company
 */
function isKnownAVCompany(assignee: string): boolean {
  const lower = assignee.toLowerCase();
  return KNOWN_AV_COMPANIES.some(company =>
    lower.includes(company.toLowerCase()) ||
    company.toLowerCase().includes(lower.split(' ')[0])
  );
}

/**
 * Query PatentsView for top assignees in A/V CPC codes
 */
async function findAVAssignees(cpcClass: string, limit: number = 100): Promise<AssigneeResult[]> {
  console.log(`  Querying CPC class ${cpcClass}...`);

  // Use specific subclasses instead of broad class for better API performance
  const subclassMap: Record<string, string[]> = {
    'H04N': ['H04N19', 'H04N21', 'H04N5', 'H04N7'],  // Video
    'H04R': ['H04R1', 'H04R3', 'H04R5'],              // Audio transducers
    'G10L': ['G10L13', 'G10L15', 'G10L19', 'G10L21'], // Speech
    'G06T': ['G06T7', 'G06T9', 'G06T5'],              // Image processing
    'G11B': ['G11B20', 'G11B27', 'G11B5'],            // Storage
    'H04S': ['H04S1', 'H04S3', 'H04S7'],              // Stereophonic
    'G09G': ['G09G3', 'G09G5'],                       // Display control
  };

  const subclasses = subclassMap[cpcClass] || [cpcClass];
  const assigneeMap = new Map<string, {
    count: number;
    cpcs: Set<string>;
    titles: string[];
  }>();

  for (const subclass of subclasses) {
    try {
      console.log(`    Subclass ${subclass}...`);

      const body = {
        q: {
          _and: [
            { _begins: { cpc_current: { cpc_subclass: subclass } } },
            { _gte: { patent_date: '2022-01-01' } }
          ]
        },
        f: ['patent_id', 'patent_title', 'assignees.assignee_organization', 'cpc_current.cpc_subclass'],
        o: { size: 300 },
        s: [{ patent_date: 'desc' }]
      };

      const data = await pvRequest('/patent/', body);

      if (!data.patents) continue;

      for (const patent of data.patents) {
        const assignees = patent.assignees || [];
        const cpcs = (patent.cpc_current || []).map((c: any) => c.cpc_subclass);

        for (const assignee of assignees) {
          const org = assignee.assignee_organization;
          if (!org) continue;

          // Skip Broadcom/Avago
          const lower = org.toLowerCase();
          if (lower.includes('broadcom') || lower.includes('avago')) continue;

          if (!assigneeMap.has(org)) {
            assigneeMap.set(org, { count: 0, cpcs: new Set(), titles: [] });
          }

          const entry = assigneeMap.get(org)!;
          entry.count++;
          cpcs.forEach((c: string) => entry.cpcs.add(c));
          if (entry.titles.length < 3) {
            entry.titles.push(patent.patent_title);
          }
        }
      }
    } catch (error) {
      console.log(`    Error querying ${subclass}: ${error}`);
    }
  }

  // Convert to array and sort by count
  return Array.from(assigneeMap.entries())
    .map(([assignee, data]) => ({
      assignee,
      patent_count: data.count,
      cpc_codes: [...data.cpcs],
      sample_titles: data.titles,
      is_known_av_company: false,
      is_current_competitor: false
    }))
    .sort((a, b) => b.patent_count - a.patent_count)
    .slice(0, limit);
}

/**
 * Search for patents with specific A/V terms
 */
async function searchAVTerms(terms: string[]): Promise<AssigneeResult[]> {
  console.log(`\nSearching for patents with A/V terminology...`);

  const assigneeMap = new Map<string, {
    count: number;
    cpcs: Set<string>;
    titles: string[];
  }>();

  // Search each term
  for (const term of terms.slice(0, 10)) {
    console.log(`  Searching term: "${term}"...`);

    try {
      const body = {
        q: {
          _and: [
            { _text_any: { patent_title: term } },
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
        const cpcs = (patent.cpc_current || []).map((c: any) => c.cpc_subclass);

        for (const assignee of assignees) {
          const org = assignee.assignee_organization;
          if (!org) continue;

          const lower = org.toLowerCase();
          if (lower.includes('broadcom') || lower.includes('avago')) continue;

          if (!assigneeMap.has(org)) {
            assigneeMap.set(org, { count: 0, cpcs: new Set(), titles: [] });
          }

          const entry = assigneeMap.get(org)!;
          entry.count++;
          cpcs.forEach((c: string) => entry.cpcs.add(c));
          if (entry.titles.length < 3) {
            entry.titles.push(patent.patent_title);
          }
        }
      }
    } catch (error) {
      console.log(`    Error searching term "${term}": ${error}`);
    }
  }

  return Array.from(assigneeMap.entries())
    .map(([assignee, data]) => ({
      assignee,
      patent_count: data.count,
      cpc_codes: [...data.cpcs],
      sample_titles: data.titles,
      is_known_av_company: false,
      is_current_competitor: false
    }))
    .sort((a, b) => b.patent_count - a.patent_count);
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Avago A/V Niche Competitor Discovery');
  console.log('Phase 3: USPTO API Assignee Analysis');
  console.log('='.repeat(60));

  if (!apiKey) {
    console.error('PATENTSVIEW_API_KEY not found in environment');
    process.exit(1);
  }

  // Load current competitor list
  const currentCompetitors = loadCurrentCompetitors();
  console.log(`Loaded ${currentCompetitors.size} current competitor patterns`);

  // Load terms from Phase 1
  const termsFiles = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.startsWith('avago-av-key-terms-'))
    .sort()
    .reverse();

  let extractedTerms: string[] = [];
  if (termsFiles.length > 0) {
    const termsPath = path.join(OUTPUT_DIR, termsFiles[0]);
    const termsData = JSON.parse(fs.readFileSync(termsPath, 'utf-8'));
    extractedTerms = termsData.significant_terms
      .filter((t: any) => t.score > 0.3)
      .map((t: any) => t.term)
      .slice(0, 20);
    console.log(`Loaded ${extractedTerms.length} extracted terms`);
  }

  // Query each A/V CPC class
  console.log('\nQuerying PatentsView for A/V assignees by CPC class...');
  const allAssignees = new Map<string, AssigneeResult>();

  for (const cpcClass of AV_CPC_CLASSES) {
    const results = await findAVAssignees(cpcClass, 50);

    for (const result of results) {
      if (allAssignees.has(result.assignee)) {
        const existing = allAssignees.get(result.assignee)!;
        existing.patent_count += result.patent_count;
        existing.cpc_codes = [...new Set([...existing.cpc_codes, ...result.cpc_codes])];
        if (existing.sample_titles.length < 5) {
          existing.sample_titles.push(...result.sample_titles.slice(0, 2));
        }
      } else {
        allAssignees.set(result.assignee, result);
      }
    }
  }

  // Also search by extracted terms
  if (extractedTerms.length > 0) {
    const termResults = await searchAVTerms(extractedTerms);
    for (const result of termResults) {
      if (allAssignees.has(result.assignee)) {
        const existing = allAssignees.get(result.assignee)!;
        existing.patent_count += result.patent_count;
      } else {
        allAssignees.set(result.assignee, result);
      }
    }
  }

  // Enrich with knowledge
  for (const [_, result] of allAssignees) {
    result.is_known_av_company = isKnownAVCompany(result.assignee);
    result.is_current_competitor = isCurrentCompetitor(result.assignee, currentCompetitors);
  }

  // Sort and categorize
  const sortedAssignees = [...allAssignees.values()]
    .sort((a, b) => b.patent_count - a.patent_count);

  const newPotentialCompetitors = sortedAssignees.filter(a =>
    !a.is_current_competitor && a.patent_count >= 5
  );

  const knownAVNotTracked = sortedAssignees.filter(a =>
    a.is_known_av_company && !a.is_current_competitor
  );

  // Display results
  console.log('\n' + '='.repeat(60));
  console.log('DISCOVERY RESULTS');
  console.log('='.repeat(60));

  console.log(`\nTotal unique assignees found: ${sortedAssignees.length}`);
  console.log(`Already tracked as competitors: ${sortedAssignees.filter(a => a.is_current_competitor).length}`);
  console.log(`Known A/V companies not tracked: ${knownAVNotTracked.length}`);
  console.log(`New potential competitors (5+ patents): ${newPotentialCompetitors.length}`);

  console.log('\nTop 30 Assignees in A/V Space:');
  console.log('-'.repeat(60));
  sortedAssignees.slice(0, 30).forEach((a, i) => {
    const flags = [];
    if (a.is_current_competitor) flags.push('[TRACKED]');
    if (a.is_known_av_company) flags.push('[KNOWN A/V]');
    console.log(`${(i + 1).toString().padStart(2)}. ${a.assignee.substring(0, 40).padEnd(40)} ${a.patent_count} patents ${flags.join(' ')}`);
  });

  console.log('\nKnown A/V Companies NOT Currently Tracked:');
  console.log('-'.repeat(60));
  knownAVNotTracked.forEach(a => {
    console.log(`  ${a.assignee}: ${a.patent_count} patents`);
    console.log(`    CPCs: ${a.cpc_codes.slice(0, 5).join(', ')}`);
  });

  console.log('\nNew Potential Competitors (Not Tracked, 10+ Patents):');
  console.log('-'.repeat(60));
  newPotentialCompetitors
    .filter(a => a.patent_count >= 10)
    .slice(0, 25)
    .forEach(a => {
      console.log(`  ${a.assignee}: ${a.patent_count} patents`);
      console.log(`    Sample: "${a.sample_titles[0]?.substring(0, 60)}..."`);
    });

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];

  // Save all discovered assignees
  const assigneesFile = path.join(OUTPUT_DIR, `av-competitor-candidates-${timestamp}.json`);
  fs.writeFileSync(assigneesFile, JSON.stringify({
    discovered_at: new Date().toISOString(),
    total_assignees: sortedAssignees.length,
    already_tracked: sortedAssignees.filter(a => a.is_current_competitor).length,
    known_av_not_tracked: knownAVNotTracked.length,
    new_potential_competitors: newPotentialCompetitors.length,
    all_assignees: sortedAssignees,
    recommendations: {
      known_av_to_add: knownAVNotTracked.map(a => ({
        name: a.assignee,
        patent_count: a.patent_count,
        cpc_codes: a.cpc_codes
      })),
      new_high_volume: newPotentialCompetitors
        .filter(a => a.patent_count >= 20)
        .map(a => ({
          name: a.assignee,
          patent_count: a.patent_count,
          sample_titles: a.sample_titles
        }))
    }
  }, null, 2));
  console.log(`\nSaved candidates to: ${assigneesFile}`);

  // Save recommended additions for competitors.json
  const recommendationsFile = path.join(OUTPUT_DIR, `av-competitor-recommendations-${timestamp}.json`);
  const recommendations = [
    ...knownAVNotTracked,
    ...newPotentialCompetitors.filter(a => a.patent_count >= 20)
  ].slice(0, 20).map(a => ({
    name: a.assignee.split(' ')[0], // Normalized short name
    full_name: a.assignee,
    patterns: [a.assignee.toLowerCase(), a.assignee.split(' ')[0].toLowerCase()],
    patent_count: a.patent_count,
    category: 'Audio/Video Equipment'
  }));

  fs.writeFileSync(recommendationsFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    recommendations: recommendations
  }, null, 2));
  console.log(`Saved recommendations to: ${recommendationsFile}`);

  console.log('\n' + '='.repeat(60));
  console.log('Phase 3 Complete');
  console.log('Next: Add recommended competitors to config/competitors.json');
  console.log('Then: Run citation overlap on Avago A/V patents');
  console.log('='.repeat(60));
}

main().catch(console.error);
