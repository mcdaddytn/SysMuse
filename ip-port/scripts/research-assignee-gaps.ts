/**
 * Research Assignee Gaps
 *
 * Investigates potential missing patents by comparing PatentsView results
 * against the current portfolio for given assignee search terms.
 *
 * Usage:
 *   npx tsx scripts/research-assignee-gaps.ts --search "Brocade"
 *   npx tsx scripts/research-assignee-gaps.ts --search "Avago Technologies International Sales"
 *   npx tsx scripts/research-assignee-gaps.ts --search "Brocade" --limit 500 --output gaps-brocade.json
 *   npx tsx scripts/research-assignee-gaps.ts --patent 9450893
 *
 * Outputs:
 *   - Assignee variants found in PatentsView
 *   - Count of patents per variant
 *   - Comparison with current portfolio
 *   - List of potentially missing patent IDs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createPatentsViewClient, Patent, PatentsViewClient } from '../clients/patentsview-client.js';

dotenv.config();

const OUTPUT_DIR = path.join(process.cwd(), 'output');
const CANDIDATES_DIR = path.join(process.cwd(), 'output');

interface AssigneeVariant {
  name: string;
  count: number;
  samplePatentIds: string[];
}

interface GapAnalysisResult {
  searchTerm: string;
  timestamp: string;
  patentsViewTotal: number;
  portfolioTotal: number;
  potentiallyMissing: number;
  assigneeVariants: AssigneeVariant[];
  missingPatentIds: string[];
  inPortfolioPatentIds: string[];
  recommendations: string[];
}

interface PatentLookupResult {
  patentId: string;
  title: string;
  grantDate: string;
  assignees: string[];
  inPortfolio: boolean;
  portfolioAffiliate?: string;
  portfolioAssignee?: string;
}

/**
 * Load current portfolio patent IDs
 */
function loadPortfolioPatentIds(): Set<string> {
  const files = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.warn('Warning: No streaming-candidates file found');
    return new Set();
  }

  const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, files[0]), 'utf-8'));
  return new Set(data.candidates.map((c: any) => c.patent_id));
}

/**
 * Load portfolio with full details for affiliate lookup
 */
function loadPortfolioDetails(): Map<string, any> {
  const files = fs.readdirSync(CANDIDATES_DIR)
    .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return new Map();

  const data = JSON.parse(fs.readFileSync(path.join(CANDIDATES_DIR, files[0]), 'utf-8'));
  return new Map(data.candidates.map((c: any) => [c.patent_id, c]));
}

/**
 * Search for patents by assignee name (contains search) with pagination
 */
async function searchByAssignee(
  client: PatentsViewClient,
  searchTerm: string,
  limit: number = 500
): Promise<{ patents: Patent[]; total: number }> {
  const allPatents: Patent[] = [];
  let total = 0;
  const pageSize = 100;

  console.log(`Searching PatentsView for assignee containing "${searchTerm}"...`);

  try {
    // Initial query to get total count
    const firstResponse = await client.searchPatents({
      query: { _contains: { 'assignees.assignee_organization': searchTerm } },
      fields: ['patent_id', 'patent_title', 'patent_date', 'assignees'],
      options: { size: pageSize }
    });

    total = firstResponse.total_hits;
    allPatents.push(...firstResponse.patents);
    console.log(`  Page 1: fetched ${firstResponse.patents.length} patents (${allPatents.length}/${Math.min(limit, total)})`);

    // Paginate if needed
    if (total > pageSize && allPatents.length < limit) {
      const paginator = client.searchPaginated({
        query: { _contains: { 'assignees.assignee_organization': searchTerm } },
        fields: ['patent_id', 'patent_title', 'patent_date', 'assignees'],
        sort: [{ patent_id: 'asc' }]
      }, pageSize);

      let pageNum = 1;
      // Skip first page since we already have it
      await paginator.next();

      for await (const page of paginator) {
        if (allPatents.length >= limit) break;
        pageNum++;
        allPatents.push(...page);
        console.log(`  Page ${pageNum}: fetched ${page.length} patents (${allPatents.length}/${Math.min(limit, total)})`);
      }
    }
  } catch (err) {
    console.error('Error searching PatentsView:', err);
  }

  return { patents: allPatents.slice(0, limit), total };
}

/**
 * Look up a specific patent by ID
 */
async function lookupPatent(
  client: PatentsViewClient,
  patentId: string
): Promise<PatentLookupResult | null> {
  // Remove 'US' prefix if present, and any letter suffix
  const cleanId = patentId.replace(/^US/i, '').replace(/[A-Z]\d*$/i, '');

  console.log(`Looking up patent ${cleanId} in PatentsView...`);

  try {
    const patent = await client.getPatent(cleanId, [
      'patent_id',
      'patent_title',
      'patent_date',
      'assignees'
    ]);

    if (!patent) {
      return null;
    }

    const portfolio = loadPortfolioDetails();
    const portfolioEntry = portfolio.get(patent.patent_id);

    return {
      patentId: patent.patent_id,
      title: patent.patent_title || '',
      grantDate: patent.patent_date || '',
      assignees: patent.assignees?.map(a => a.assignee_organization || 'Unknown') || [],
      inPortfolio: !!portfolioEntry,
      portfolioAffiliate: portfolioEntry?.affiliate,
      portfolioAssignee: portfolioEntry?.assignee
    };
  } catch (err) {
    console.error('Error looking up patent:', err);
    return null;
  }
}

/**
 * Analyze assignee variants and identify gaps
 */
function analyzeGaps(
  searchTerm: string,
  pvPatents: Patent[],
  pvTotal: number,
  portfolioIds: Set<string>
): GapAnalysisResult {
  // Group by assignee variant
  const variantMap = new Map<string, string[]>();

  for (const patent of pvPatents) {
    for (const assignee of patent.assignees || []) {
      const org = assignee.assignee_organization;
      if (org && org.toLowerCase().includes(searchTerm.toLowerCase())) {
        if (!variantMap.has(org)) {
          variantMap.set(org, []);
        }
        variantMap.get(org)!.push(patent.patent_id);
      }
    }
  }

  // Build variant summary
  const variants: AssigneeVariant[] = Array.from(variantMap.entries())
    .map(([name, ids]) => ({
      name,
      count: ids.length,
      samplePatentIds: ids.slice(0, 5)
    }))
    .sort((a, b) => b.count - a.count);

  // Find missing patents
  const missingIds: string[] = [];
  const inPortfolioIds: string[] = [];

  for (const patent of pvPatents) {
    if (portfolioIds.has(patent.patent_id)) {
      inPortfolioIds.push(patent.patent_id);
    } else {
      missingIds.push(patent.patent_id);
    }
  }

  // Generate recommendations
  const recommendations: string[] = [];

  for (const variant of variants) {
    const missingForVariant = variant.samplePatentIds.filter(id => !portfolioIds.has(id));
    if (missingForVariant.length > 0) {
      recommendations.push(
        `Add variant "${variant.name}" to portfolio-affiliates.json (${variant.count} patents, ${missingForVariant.length}/${variant.samplePatentIds.length} missing in sample)`
      );
    }
  }

  if (missingIds.length > 0) {
    recommendations.push(
      `Re-run portfolio collection with updated assignee variants to capture ${missingIds.length} potentially missing patents`
    );
  }

  return {
    searchTerm,
    timestamp: new Date().toISOString(),
    patentsViewTotal: pvTotal,
    portfolioTotal: inPortfolioIds.length,
    potentiallyMissing: missingIds.length,
    assigneeVariants: variants,
    missingPatentIds: missingIds,
    inPortfolioPatentIds: inPortfolioIds,
    recommendations
  };
}

/**
 * Format results for console output
 */
function printResults(result: GapAnalysisResult): void {
  console.log('\n' + '='.repeat(70));
  console.log(`ASSIGNEE GAP ANALYSIS: "${result.searchTerm}"`);
  console.log('='.repeat(70));

  console.log(`\nSummary:`);
  console.log(`  PatentsView total:    ${result.patentsViewTotal.toLocaleString()}`);
  console.log(`  In portfolio:         ${result.portfolioTotal.toLocaleString()}`);
  console.log(`  Potentially missing:  ${result.potentiallyMissing.toLocaleString()}`);

  console.log(`\nAssignee Variants Found (${result.assigneeVariants.length}):`);
  for (const v of result.assigneeVariants) {
    const inPortfolio = v.samplePatentIds.filter(id =>
      result.inPortfolioPatentIds.includes(id)
    ).length;
    console.log(`  ${v.count.toString().padStart(5)}  ${v.name}`);
    console.log(`         Sample: ${v.samplePatentIds.slice(0, 3).join(', ')} (${inPortfolio}/${v.samplePatentIds.length} in portfolio)`);
  }

  if (result.recommendations.length > 0) {
    console.log(`\nRecommendations:`);
    for (const rec of result.recommendations) {
      console.log(`  • ${rec}`);
    }
  }

  if (result.missingPatentIds.length > 0) {
    console.log(`\nSample Missing Patent IDs (first 20):`);
    console.log(`  ${result.missingPatentIds.slice(0, 20).join(', ')}`);
  }
}

/**
 * Print patent lookup result
 */
function printPatentLookup(result: PatentLookupResult): void {
  console.log('\n' + '='.repeat(70));
  console.log(`PATENT LOOKUP: US${result.patentId}`);
  console.log('='.repeat(70));
  console.log(`Title:        ${result.title}`);
  console.log(`Grant Date:   ${result.grantDate}`);
  console.log(`Assignees:    ${result.assignees.join(', ')}`);
  console.log(`In Portfolio: ${result.inPortfolio ? 'YES' : 'NO'}`);
  if (result.portfolioAffiliate) {
    console.log(`  Affiliate:  ${result.portfolioAffiliate}`);
    console.log(`  Assignee:   ${result.portfolioAssignee}`);
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  const searchIdx = args.indexOf('--search');
  const searchTerm = searchIdx !== -1 ? args[searchIdx + 1] : null;

  const patentIdx = args.indexOf('--patent');
  const patentId = patentIdx !== -1 ? args[patentIdx + 1] : null;

  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 500;

  const outputIdx = args.indexOf('--output');
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;

  // Validate
  if (!searchTerm && !patentId) {
    console.log(`
Research Assignee Gaps - Investigate missing patents in portfolio

Usage:
  npx tsx scripts/research-assignee-gaps.ts --search "Brocade"
  npx tsx scripts/research-assignee-gaps.ts --search "Avago Technologies International Sales"
  npx tsx scripts/research-assignee-gaps.ts --patent 9450893

Options:
  --search <term>   Search for assignees containing this term
  --patent <id>     Look up a specific patent by ID
  --limit <n>       Max patents to fetch from PatentsView (default: 500)
  --output <file>   Save results to JSON file in output/
`);
    process.exit(1);
  }

  // Create client
  let client: PatentsViewClient;
  try {
    client = createPatentsViewClient();
  } catch (err) {
    console.error('Error: PATENTSVIEW_API_KEY environment variable not set');
    process.exit(1);
  }

  // Patent lookup mode
  if (patentId) {
    const result = await lookupPatent(client, patentId);
    if (result) {
      printPatentLookup(result);
    } else {
      console.log(`Patent ${patentId} not found in PatentsView`);
    }
    return;
  }

  // Assignee search mode
  if (searchTerm) {
    const portfolioIds = loadPortfolioPatentIds();
    console.log(`Loaded ${portfolioIds.size.toLocaleString()} patents from current portfolio\n`);

    const { patents, total } = await searchByAssignee(client, searchTerm, limit);
    const result = analyzeGaps(searchTerm, patents, total, portfolioIds);

    printResults(result);

    // Save to file if requested
    if (outputFile) {
      const outputPath = path.join(OUTPUT_DIR, outputFile);
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`\nResults saved to: ${outputPath}`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
