/**
 * Avago A/V Portfolio Clustering Script
 *
 * Phase 2 of the Avago A/V Analysis Approach:
 * - Uses More-Like-This (MLT) queries to find similar patents
 * - Identifies cross-portfolio connections (Avago, Broadcom, Symantec)
 * - Clusters patents by technology similarity
 * - Highlights patents with highest citation overlap potential
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const ES_URL = process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
const INDEX_NAME = 'patents';
const INPUT_DIR = './output/avago-av';
const OUTPUT_DIR = './output/avago-av';

interface PatentSummary {
  patent_id: string;
  title: string;
  abstract_snippet: string;
  cpc_codes: string[];
  grant_date?: string;
  forward_citations?: number;
}

interface SimilarPatent {
  patent_id: string;
  title: string;
  assignee: string;
  assignee_normalized?: string;
  similarity_score: number;
  cpc_codes: string[];
  forward_citations?: number;
  competitor_citations?: number;
  tier?: number;
}

interface ClusterResult {
  seed_patent_id: string;
  seed_title: string;
  seed_category: string;
  similar_patents: SimilarPatent[];
  cross_portfolio_count: number;
  high_citation_count: number;
}

interface ESSearchResponse {
  hits: {
    total: { value: number };
    hits: Array<{
      _id: string;
      _score: number;
      _source: {
        patent_id: string;
        title: string;
        abstract?: string;
        assignee?: string;
        assignee_normalized?: string;
        cpc_codes?: string[];
        forward_citations?: number;
        competitor_citations?: number;
        tier?: number;
      };
    }>;
  };
}

/**
 * Make a request to ElasticSearch
 */
async function esRequest<T>(path: string, method: string = 'GET', body?: any): Promise<T> {
  const url = `${ES_URL}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ES request failed: ${response.status} - ${error}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Normalize assignee name to determine portfolio origin
 */
function normalizeAssignee(assignee: string): string {
  const lower = assignee.toLowerCase();
  if (lower.includes('avago')) return 'Avago';
  if (lower.includes('broadcom')) return 'Broadcom';
  if (lower.includes('symantec')) return 'Symantec';
  if (lower.includes('ca, inc')) return 'CA Technologies';
  if (lower.includes('brocade')) return 'Brocade';
  if (lower.includes('lsi')) return 'LSI';
  return 'Other';
}

/**
 * Find patents similar to a given seed patent using MLT
 */
async function findSimilarPatents(patentId: string, size: number = 30): Promise<SimilarPatent[]> {
  const body = {
    query: {
      more_like_this: {
        fields: ['title', 'abstract'],
        like: [{ _index: INDEX_NAME, _id: patentId }],
        min_term_freq: 1,
        min_doc_freq: 2,
        max_query_terms: 25,
        minimum_should_match: '30%'
      }
    },
    size,
    _source: ['patent_id', 'title', 'assignee', 'assignee_normalized', 'cpc_codes', 'forward_citations', 'competitor_citations', 'tier']
  };

  const response = await esRequest<ESSearchResponse>(`/${INDEX_NAME}/_search`, 'POST', body);

  return response.hits.hits.map(hit => ({
    patent_id: hit._source.patent_id,
    title: hit._source.title,
    assignee: hit._source.assignee || 'Unknown',
    assignee_normalized: hit._source.assignee_normalized,
    similarity_score: hit._score,
    cpc_codes: hit._source.cpc_codes || [],
    forward_citations: hit._source.forward_citations,
    competitor_citations: hit._source.competitor_citations,
    tier: hit._source.tier
  }));
}

/**
 * Cluster patents by running MLT on selected seed patents
 */
async function clusterPatents(categories: Record<string, PatentSummary[]>): Promise<ClusterResult[]> {
  const clusters: ClusterResult[] = [];

  // For each category, select top patents by citations as seeds
  for (const [category, patents] of Object.entries(categories)) {
    if (category === 'Other A/V Technologies') continue; // Skip uncategorized

    // Sort by forward citations and select top 5 as seeds
    const sortedPatents = [...patents]
      .sort((a, b) => (b.forward_citations || 0) - (a.forward_citations || 0))
      .slice(0, 5);

    console.log(`\nProcessing category: ${category}`);
    console.log(`  Selected ${sortedPatents.length} seed patents`);

    for (const seed of sortedPatents) {
      const similar = await findSimilarPatents(seed.patent_id, 30);

      // Analyze cross-portfolio connections
      const portfolioBreakdown = new Map<string, number>();
      let highCitationCount = 0;

      for (const patent of similar) {
        const portfolio = normalizeAssignee(patent.assignee);
        portfolioBreakdown.set(portfolio, (portfolioBreakdown.get(portfolio) || 0) + 1);

        if ((patent.competitor_citations || 0) > 0 || patent.tier === 1 || patent.tier === 2) {
          highCitationCount++;
        }
      }

      // Count non-Avago patents
      const crossPortfolioCount = similar.filter(p =>
        normalizeAssignee(p.assignee) !== 'Avago'
      ).length;

      clusters.push({
        seed_patent_id: seed.patent_id,
        seed_title: seed.title,
        seed_category: category,
        similar_patents: similar,
        cross_portfolio_count: crossPortfolioCount,
        high_citation_count: highCitationCount
      });

      console.log(`    Seed ${seed.patent_id}: ${similar.length} similar, ${crossPortfolioCount} cross-portfolio, ${highCitationCount} high-citation`);
    }
  }

  return clusters;
}

/**
 * Analyze clustering results for insights
 */
function analyzeClusters(clusters: ClusterResult[]): {
  topCrossPortfolio: ClusterResult[];
  topHighCitation: ClusterResult[];
  portfolioOverlap: Map<string, number>;
  uniqueHighValuePatents: Set<string>;
} {
  // Sort by cross-portfolio connections
  const topCrossPortfolio = [...clusters]
    .sort((a, b) => b.cross_portfolio_count - a.cross_portfolio_count)
    .slice(0, 10);

  // Sort by high-citation connections
  const topHighCitation = [...clusters]
    .sort((a, b) => b.high_citation_count - a.high_citation_count)
    .slice(0, 10);

  // Count portfolio overlap
  const portfolioOverlap = new Map<string, number>();
  const uniqueHighValuePatents = new Set<string>();

  for (const cluster of clusters) {
    for (const patent of cluster.similar_patents) {
      const portfolio = normalizeAssignee(patent.assignee);
      portfolioOverlap.set(portfolio, (portfolioOverlap.get(portfolio) || 0) + 1);

      // Track high-value patents (tier 1/2 or has competitor citations)
      if (patent.tier === 1 || patent.tier === 2 || (patent.competitor_citations || 0) > 0) {
        uniqueHighValuePatents.add(patent.patent_id);
      }
    }
  }

  return {
    topCrossPortfolio,
    topHighCitation,
    portfolioOverlap,
    uniqueHighValuePatents
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(60));
  console.log('Avago A/V Portfolio Clustering');
  console.log('Phase 2: More-Like-This Analysis');
  console.log('='.repeat(60));

  // Load categorized patents from Phase 1
  const categoriesFiles = fs.readdirSync(INPUT_DIR)
    .filter(f => f.startsWith('avago-av-categories-'))
    .sort()
    .reverse();

  if (categoriesFiles.length === 0) {
    console.error('No categories file found. Run extract-av-terms.ts first.');
    process.exit(1);
  }

  const categoriesPath = path.join(INPUT_DIR, categoriesFiles[0]);
  console.log(`Loading categories from: ${categoriesPath}`);

  const categoriesData = JSON.parse(fs.readFileSync(categoriesPath, 'utf-8'));
  const categories: Record<string, PatentSummary[]> = categoriesData.categories;

  const totalPatents = Object.values(categories).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`Loaded ${totalPatents} patents in ${Object.keys(categories).length} categories`);

  // Run clustering
  console.log('\nRunning MLT clustering...');
  const clusters = await clusterPatents(categories);

  // Analyze results
  console.log('\nAnalyzing clusters...');
  const analysis = analyzeClusters(clusters);

  // Display results
  console.log('\n' + '='.repeat(60));
  console.log('CLUSTERING RESULTS');
  console.log('='.repeat(60));

  console.log('\nPortfolio Overlap Distribution:');
  console.log('-'.repeat(40));
  const sortedPortfolios = [...analysis.portfolioOverlap.entries()]
    .sort((a, b) => b[1] - a[1]);
  for (const [portfolio, count] of sortedPortfolios) {
    console.log(`  ${portfolio.padEnd(20)} ${count} patents`);
  }

  console.log('\nTop 10 Seeds by Cross-Portfolio Connections:');
  console.log('-'.repeat(40));
  for (const cluster of analysis.topCrossPortfolio) {
    console.log(`  ${cluster.seed_patent_id}: ${cluster.cross_portfolio_count} non-Avago similar`);
    console.log(`    "${cluster.seed_title.substring(0, 60)}..."`);
    console.log(`    Category: ${cluster.seed_category}`);
  }

  console.log('\nTop 10 Seeds Connected to High-Value Patents:');
  console.log('-'.repeat(40));
  for (const cluster of analysis.topHighCitation) {
    console.log(`  ${cluster.seed_patent_id}: ${cluster.high_citation_count} high-value connections`);
    console.log(`    "${cluster.seed_title.substring(0, 60)}..."`);
  }

  console.log(`\nUnique High-Value Patents Discovered: ${analysis.uniqueHighValuePatents.size}`);

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];

  // Save full clusters
  const clustersFile = path.join(OUTPUT_DIR, `av-patent-clusters-${timestamp}.json`);
  fs.writeFileSync(clustersFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    total_clusters: clusters.length,
    clusters: clusters
  }, null, 2));
  console.log(`\nSaved clusters to: ${clustersFile}`);

  // Save analysis summary
  const analysisFile = path.join(OUTPUT_DIR, `av-cluster-analysis-${timestamp}.json`);
  fs.writeFileSync(analysisFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    portfolio_overlap: Object.fromEntries(analysis.portfolioOverlap),
    top_cross_portfolio_seeds: analysis.topCrossPortfolio.map(c => ({
      seed_id: c.seed_patent_id,
      seed_title: c.seed_title,
      category: c.seed_category,
      cross_portfolio_count: c.cross_portfolio_count,
      high_citation_count: c.high_citation_count
    })),
    unique_high_value_patents: [...analysis.uniqueHighValuePatents]
  }, null, 2));
  console.log(`Saved analysis to: ${analysisFile}`);

  // Save high-value patent list for further investigation
  const highValueFile = path.join(OUTPUT_DIR, `av-high-value-patents-${timestamp}.json`);
  const highValuePatents: SimilarPatent[] = [];
  for (const cluster of clusters) {
    for (const patent of cluster.similar_patents) {
      if (patent.tier === 1 || patent.tier === 2 || (patent.competitor_citations || 0) > 0) {
        if (!highValuePatents.find(p => p.patent_id === patent.patent_id)) {
          highValuePatents.push(patent);
        }
      }
    }
  }
  fs.writeFileSync(highValueFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    count: highValuePatents.length,
    patents: highValuePatents.sort((a, b) =>
      (b.competitor_citations || 0) - (a.competitor_citations || 0)
    )
  }, null, 2));
  console.log(`Saved high-value patents to: ${highValueFile}`);

  console.log('\n' + '='.repeat(60));
  console.log('Phase 2 Complete');
  console.log('Next: Run niche competitor discovery (scripts/discover-av-competitors.ts)');
  console.log('='.repeat(60));
}

main().catch(console.error);
