/**
 * Estimate Portfolio Citation Impact
 *
 * Samples top-rated patents to estimate how many citations come from
 * portfolio affiliates vs external parties.
 *
 * This helps prioritize the citation categorization fix by showing:
 * 1. What % of citations are self-citations (within portfolio)
 * 2. How this differs between VMware and non-VMware patents
 * 3. Whether high self-citation rates inflate VMware's dominance
 *
 * Usage: npx tsx scripts/estimate-portfolio-citations.ts [--sample-size N]
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const PATENTSVIEW_BASE_URL = 'https://search.patentsview.org/api/v1';
const apiKey = process.env.PATENTSVIEW_API_KEY;

// Rate limiting
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1400; // ~43 requests/min

// =============================================================================
// LOAD CONFIGURATIONS
// =============================================================================

interface AffiliateInfo {
  displayName: string;
  patterns: string[];
}

interface CompetitorMatch {
  company: string;
  category: string;
}

// Load portfolio affiliates
function loadAffiliatePatterns(): Array<{ pattern: RegExp; name: string }> {
  const config = JSON.parse(fs.readFileSync('config/portfolio-affiliates.json', 'utf-8'));
  const patterns: Array<{ pattern: RegExp; name: string }> = [];

  for (const [, info] of Object.entries(config.affiliates) as [string, AffiliateInfo][]) {
    for (const pattern of info.patterns) {
      patterns.push({
        pattern: new RegExp(pattern, 'i'),
        name: info.displayName
      });
    }
  }

  return patterns;
}

// Load competitor patterns
function loadCompetitorPatterns(): Array<{ pattern: RegExp; company: string }> {
  const config = JSON.parse(fs.readFileSync('config/competitors.json', 'utf-8'));
  const patterns: Array<{ pattern: RegExp; company: string }> = [];

  // Competitors are nested under categories
  for (const [, category] of Object.entries(config.categories) as [string, any][]) {
    if (!category.enabled) continue;
    for (const company of category.companies || []) {
      for (const pattern of company.patterns || []) {
        patterns.push({
          pattern: new RegExp(pattern, 'i'),
          company: company.name
        });
      }
    }
  }

  return patterns;
}

const affiliatePatterns = loadAffiliatePatterns();
const competitorPatterns = loadCompetitorPatterns();

function isPortfolioAffiliate(assignee: string): string | null {
  if (!assignee) return null;
  for (const { pattern, name } of affiliatePatterns) {
    if (pattern.test(assignee)) return name;
  }
  return null;
}

function isCompetitor(assignee: string): string | null {
  if (!assignee) return null;
  for (const { pattern, company } of competitorPatterns) {
    if (pattern.test(assignee)) return company;
  }
  return null;
}

// =============================================================================
// API HELPERS
// =============================================================================

async function rateLimitedFetch(endpoint: string, method: 'GET' | 'POST', body?: any): Promise<any> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Key': apiKey!,
    },
  };

  if (method === 'POST' && body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${PATENTSVIEW_BASE_URL}${endpoint}`, options);

  if (!response.ok) {
    throw new Error(`API Error: ${response.status}`);
  }

  return response.json();
}

interface CitingPatent {
  patent_id: string;
  assignee: string;
  category: 'competitor' | 'portfolio' | 'third_party';
  categoryName: string;
}

async function getCitingPatents(patentId: string, maxCitations: number = 100): Promise<CitingPatent[]> {
  const results: CitingPatent[] = [];

  try {
    // Get citing patent IDs
    const citationData = await rateLimitedFetch('/patent/us_patent_citation/', 'POST', {
      q: { citation_patent_id: patentId },
      f: ['patent_id'],
      o: { size: Math.min(500, maxCitations * 2) }
    });

    if (!citationData.us_patent_citations || citationData.us_patent_citations.length === 0) {
      return results;
    }

    const citingIds = [...new Set(citationData.us_patent_citations.map((c: any) => c.patent_id))];

    // Get assignee info for citing patents (batch of up to 100)
    const patentData = await rateLimitedFetch('/patent/', 'POST', {
      q: { _or: citingIds.slice(0, maxCitations).map((id: string) => ({ patent_id: id })) },
      f: ['patent_id', 'assignees'],
      o: { size: maxCitations }
    });

    for (const patent of patentData.patents || []) {
      const assignee = patent.assignees?.[0]?.assignee_organization || '';

      const affiliateName = isPortfolioAffiliate(assignee);
      const competitorName = isCompetitor(assignee);

      let category: 'competitor' | 'portfolio' | 'third_party';
      let categoryName: string;

      if (affiliateName) {
        category = 'portfolio';
        categoryName = affiliateName;
      } else if (competitorName) {
        category = 'competitor';
        categoryName = competitorName;
      } else {
        category = 'third_party';
        categoryName = assignee || 'Unknown';
      }

      results.push({
        patent_id: patent.patent_id,
        assignee,
        category,
        categoryName
      });
    }
  } catch (error: any) {
    console.error(`  Error fetching citations for ${patentId}: ${error.message}`);
  }

  return results;
}

// =============================================================================
// MAIN ANALYSIS
// =============================================================================

interface PatentSample {
  patent_id: string;
  affiliate: string;
  forward_citations: number;
  competitor_citations: number;
  rank: number;
  isVMware: boolean;
}

interface AnalysisResult {
  patent_id: string;
  affiliate: string;
  rank: number;
  isVMware: boolean;
  reported_forward: number;
  reported_competitor: number;
  sampled_total: number;
  portfolio_count: number;
  competitor_count: number;
  third_party_count: number;
  portfolio_ratio: number;
  competitor_ratio: number;
  third_party_ratio: number;
  top_portfolio_citators: string[];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('           PORTFOLIO CITATION IMPACT ESTIMATION');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Parse args
  const sampleSizeArg = process.argv.find(a => a.startsWith('--sample-size='));
  const sampleSize = sampleSizeArg ? parseInt(sampleSizeArg.split('=')[1]) : 30;

  // Load VMware patent IDs
  const vmwareIds = new Set<string>(
    JSON.parse(fs.readFileSync('output/vmware-patent-ids-2026-01-19.json', 'utf-8'))
  );
  console.log(`Loaded ${vmwareIds.size} VMware patent IDs`);

  // Load V3 top-rated patents
  const topRatedCsv = fs.readFileSync('output/TOPRATED-2026-01-21.csv', 'utf-8');
  const lines = topRatedCsv.split('\n');
  const headers = lines[0].split(',');

  const rankIdx = headers.indexOf('rank');
  const patentIdIdx = headers.indexOf('patent_id');
  const affiliateIdx = headers.indexOf('affiliate');
  const fwdCiteIdx = headers.indexOf('forward_citations');
  const compCiteIdx = headers.indexOf('competitor_citations');

  const allPatents: PatentSample[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    // Simple CSV parsing (assumes no commas in fields for these columns)
    const parts = lines[i].split(',');
    const patentId = parts[patentIdIdx]?.replace(/"/g, '');

    allPatents.push({
      patent_id: patentId,
      affiliate: parts[affiliateIdx]?.replace(/"/g, '') || '',
      forward_citations: parseInt(parts[fwdCiteIdx]) || 0,
      competitor_citations: parseInt(parts[compCiteIdx]) || 0,
      rank: parseInt(parts[rankIdx]) || 0,
      isVMware: vmwareIds.has(patentId)
    });
  }

  console.log(`Loaded ${allPatents.length} patents from V3 TopRated\n`);

  // Sample strategy: Take mix of VMware and non-VMware from different rank tiers
  const vmwarePatents = allPatents.filter(p => p.isVMware);
  const nonVmwarePatents = allPatents.filter(p => !p.isVMware);

  console.log(`VMware patents: ${vmwarePatents.length}`);
  console.log(`Non-VMware patents: ${nonVmwarePatents.length}\n`);

  // Sample from different tiers
  const vmwareSample: PatentSample[] = [
    ...vmwarePatents.filter(p => p.rank <= 50).slice(0, Math.ceil(sampleSize * 0.3)),
    ...vmwarePatents.filter(p => p.rank > 50 && p.rank <= 200).slice(0, Math.ceil(sampleSize * 0.2)),
    ...vmwarePatents.filter(p => p.rank > 200).slice(0, Math.ceil(sampleSize * 0.15)),
  ];

  const nonVmwareSample: PatentSample[] = [
    ...nonVmwarePatents.filter(p => p.rank <= 100).slice(0, Math.ceil(sampleSize * 0.2)),
    ...nonVmwarePatents.filter(p => p.rank > 100).slice(0, Math.ceil(sampleSize * 0.15)),
  ];

  const sample = [...vmwareSample, ...nonVmwareSample].slice(0, sampleSize);

  console.log(`Sampling ${sample.length} patents:`);
  console.log(`  VMware: ${sample.filter(p => p.isVMware).length}`);
  console.log(`  Non-VMware: ${sample.filter(p => !p.isVMware).length}\n`);

  // Analyze each patent
  const results: AnalysisResult[] = [];

  console.log('Analyzing citations (this may take a few minutes)...\n');

  for (let i = 0; i < sample.length; i++) {
    const patent = sample[i];
    process.stdout.write(`\r  Processing ${i + 1}/${sample.length}: ${patent.patent_id}...`);

    const citations = await getCitingPatents(patent.patent_id, 100);

    const portfolioCites = citations.filter(c => c.category === 'portfolio');
    const competitorCites = citations.filter(c => c.category === 'competitor');
    const thirdPartyCites = citations.filter(c => c.category === 'third_party');

    // Count portfolio citators by affiliate
    const portfolioCitatorCounts = new Map<string, number>();
    for (const cite of portfolioCites) {
      portfolioCitatorCounts.set(
        cite.categoryName,
        (portfolioCitatorCounts.get(cite.categoryName) || 0) + 1
      );
    }
    const topPortfolio = [...portfolioCitatorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => `${name}(${count})`);

    results.push({
      patent_id: patent.patent_id,
      affiliate: patent.affiliate,
      rank: patent.rank,
      isVMware: patent.isVMware,
      reported_forward: patent.forward_citations,
      reported_competitor: patent.competitor_citations,
      sampled_total: citations.length,
      portfolio_count: portfolioCites.length,
      competitor_count: competitorCites.length,
      third_party_count: thirdPartyCites.length,
      portfolio_ratio: citations.length > 0 ? portfolioCites.length / citations.length : 0,
      competitor_ratio: citations.length > 0 ? competitorCites.length / citations.length : 0,
      third_party_ratio: citations.length > 0 ? thirdPartyCites.length / citations.length : 0,
      top_portfolio_citators: topPortfolio
    });
  }

  console.log('\n\n');

  // ==========================================================================
  // GENERATE REPORT
  // ==========================================================================

  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('                         RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  // Overall stats
  const vmwareResults = results.filter(r => r.isVMware);
  const nonVmwareResults = results.filter(r => !r.isVMware);

  const avgPortfolioRatioVmware = vmwareResults.length > 0
    ? vmwareResults.reduce((sum, r) => sum + r.portfolio_ratio, 0) / vmwareResults.length
    : 0;

  const avgPortfolioRatioNonVmware = nonVmwareResults.length > 0
    ? nonVmwareResults.reduce((sum, r) => sum + r.portfolio_ratio, 0) / nonVmwareResults.length
    : 0;

  const avgCompetitorRatioVmware = vmwareResults.length > 0
    ? vmwareResults.reduce((sum, r) => sum + r.competitor_ratio, 0) / vmwareResults.length
    : 0;

  const avgCompetitorRatioNonVmware = nonVmwareResults.length > 0
    ? nonVmwareResults.reduce((sum, r) => sum + r.competitor_ratio, 0) / nonVmwareResults.length
    : 0;

  console.log('CITATION BREAKDOWN BY CATEGORY:');
  console.log('─────────────────────────────────────────────────────────────────────\n');

  console.log('                      VMware Patents    Non-VMware Patents');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log(`Sample size:          ${vmwareResults.length.toString().padStart(8)}            ${nonVmwareResults.length.toString().padStart(8)}`);
  console.log(`Avg Portfolio %:      ${(avgPortfolioRatioVmware * 100).toFixed(1).padStart(7)}%            ${(avgPortfolioRatioNonVmware * 100).toFixed(1).padStart(7)}%`);
  console.log(`Avg Competitor %:     ${(avgCompetitorRatioVmware * 100).toFixed(1).padStart(7)}%            ${(avgCompetitorRatioNonVmware * 100).toFixed(1).padStart(7)}%`);
  console.log(`Avg Third-Party %:    ${((1 - avgPortfolioRatioVmware - avgCompetitorRatioVmware) * 100).toFixed(1).padStart(7)}%            ${((1 - avgPortfolioRatioNonVmware - avgCompetitorRatioNonVmware) * 100).toFixed(1).padStart(7)}%`);

  console.log('\n');
  console.log('DETAILED RESULTS:');
  console.log('─────────────────────────────────────────────────────────────────────\n');

  console.log('Rank  Patent      Affiliate        Portfolio%  Competitor%  Third-Party%  Top Portfolio Citators');
  console.log('─────────────────────────────────────────────────────────────────────────────────────────────────');

  for (const r of results.sort((a, b) => a.rank - b.rank)) {
    const tag = r.isVMware ? '[VMW]' : '     ';
    console.log(
      `${r.rank.toString().padStart(4)}  ${r.patent_id.padEnd(10)} ${r.affiliate.substring(0, 15).padEnd(15)} ${tag}` +
      `${(r.portfolio_ratio * 100).toFixed(1).padStart(7)}%     ` +
      `${(r.competitor_ratio * 100).toFixed(1).padStart(7)}%      ` +
      `${(r.third_party_ratio * 100).toFixed(1).padStart(7)}%     ` +
      `${r.top_portfolio_citators.join(', ')}`
    );
  }

  // Impact analysis
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('                       IMPACT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const highSelfCiteVmware = vmwareResults.filter(r => r.portfolio_ratio > 0.2);
  const highSelfCiteNonVmware = nonVmwareResults.filter(r => r.portfolio_ratio > 0.2);

  console.log(`Patents with >20% self-citations:`);
  console.log(`  VMware: ${highSelfCiteVmware.length}/${vmwareResults.length} (${(100 * highSelfCiteVmware.length / vmwareResults.length).toFixed(0)}%)`);
  console.log(`  Non-VMware: ${highSelfCiteNonVmware.length}/${nonVmwareResults.length} (${(100 * highSelfCiteNonVmware.length / nonVmwareResults.length).toFixed(0)}%)`);

  const portfolioDiff = avgPortfolioRatioVmware - avgPortfolioRatioNonVmware;
  console.log(`\nSelf-citation rate difference: ${(portfolioDiff * 100).toFixed(1)} percentage points`);

  if (portfolioDiff > 0.05) {
    console.log(`\n⚠️  VMware patents have ${(portfolioDiff * 100).toFixed(1)}% HIGHER self-citation rate`);
    console.log(`   This may be inflating VMware patent scores relative to others.`);
    console.log(`   RECOMMENDATION: Implement citation categorization to adjust scoring.`);
  } else if (portfolioDiff < -0.05) {
    console.log(`\n✓  VMware patents have LOWER self-citation rate than others`);
    console.log(`   Self-citation is not a major factor in VMware dominance.`);
  } else {
    console.log(`\n○  Self-citation rates are similar between VMware and non-VMware`);
    console.log(`   Citation categorization would have uniform impact across portfolio.`);
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputFile = `output/portfolio-citation-estimate-${timestamp}.json`;

  fs.writeFileSync(outputFile, JSON.stringify({
    metadata: {
      generatedDate: new Date().toISOString(),
      sampleSize: sample.length,
      vmwareSampleSize: vmwareResults.length,
      nonVmwareSampleSize: nonVmwareResults.length,
    },
    summary: {
      vmware: {
        avgPortfolioRatio: avgPortfolioRatioVmware,
        avgCompetitorRatio: avgCompetitorRatioVmware,
        avgThirdPartyRatio: 1 - avgPortfolioRatioVmware - avgCompetitorRatioVmware,
        highSelfCiteCount: highSelfCiteVmware.length,
      },
      nonVmware: {
        avgPortfolioRatio: avgPortfolioRatioNonVmware,
        avgCompetitorRatio: avgCompetitorRatioNonVmware,
        avgThirdPartyRatio: 1 - avgPortfolioRatioNonVmware - avgCompetitorRatioNonVmware,
        highSelfCiteCount: highSelfCiteNonVmware.length,
      },
      portfolioDifference: portfolioDiff,
    },
    results
  }, null, 2));

  console.log(`\n\n✓ Results saved to ${outputFile}`);
  console.log('═══════════════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
