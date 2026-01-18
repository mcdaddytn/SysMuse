/**
 * Sector Product Discovery Script
 *
 * Uses web search to discover products implementing patented technology.
 * Feeds into recalibration pipeline and vendor handoff.
 *
 * Usage:
 *   npx tsx scripts/discover-sector-products.ts <sector> [--limit N]
 *   npx tsx scripts/discover-sector-products.ts video-codec --limit 10
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

dotenv.config();

const OUTPUT_DIR = './output/product-discovery';

interface SectorFacets {
  display_name: string;
  damages_tier: string;
  market_size_estimate: string;
  growth_rate: string;
  key_products: string[];
  key_companies: string[];
  notes: string;
}

interface PatentData {
  patent_id: string;
  title: string;
  abstract?: string;
  sector?: string;
  product_types?: string[];
  likely_implementers?: string[];
  competitor_citations?: number;
  competitors_citing?: string[];
}

interface ProductDiscovery {
  patent_id: string;
  title: string;
  sector: string;
  search_queries_used: string[];
  products: Product[];
  market_context: MarketContext;
  recommendations: string[];
  confidence: number;
}

interface Product {
  name: string;
  company: string;
  category: string;
  description: string;
  price_range?: string;
  relevance_to_patent: string;
  evidence_type: string;
  source_url?: string;
}

interface MarketContext {
  market_size: string;
  growth_rate: string;
  key_players: string[];
  technology_trends: string[];
}

// Load sector facets configuration
function loadSectorFacets(): Record<string, SectorFacets> {
  const facetsPath = './config/sector-facets.json';
  if (!fs.existsSync(facetsPath)) {
    console.error('Sector facets config not found:', facetsPath);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(facetsPath, 'utf-8'));
  return config.sectors;
}

// Load patents for a sector from unified top 250
function loadSectorPatents(sector: string, limit: number): PatentData[] {
  const top250Path = './output/unified-top250-v2-2026-01-18.json';
  if (!fs.existsSync(top250Path)) {
    console.error('Top 250 file not found:', top250Path);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(top250Path, 'utf-8'));
  const sectorPatents = data.patents
    .filter((p: any) => p.sector === sector || p.sector_name?.toLowerCase().includes(sector.toLowerCase()))
    .slice(0, limit)
    .map((p: any) => ({
      patent_id: p.patent_id,
      title: p.title,
      sector: p.sector,
      product_types: p.product_types || [],
      likely_implementers: p.likely_implementers || [],
      competitor_citations: p.competitor_citations || 0,
      competitors_citing: p.competitors_citing?.split('; ') || []
    }));

  return sectorPatents;
}

// Load V3 LLM analysis for additional context
function loadV3Analysis(): Map<string, any> {
  const map = new Map<string, any>();
  const llmDir = './output/llm-analysis-v3';

  if (!fs.existsSync(llmDir)) return map;

  const files = fs.readdirSync(llmDir)
    .filter(f => f.startsWith('combined-v3-') && f.endsWith('.json'))
    .sort();

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(llmDir, file), 'utf-8'));
    for (const analysis of data.analyses || []) {
      map.set(analysis.patent_id, analysis);
    }
  }

  return map;
}

// Generate search queries for a patent
function generateSearchQueries(patent: PatentData, v3Analysis: any, sectorFacets: SectorFacets): string[] {
  const queries: string[] = [];

  // Technology-based query
  const techCategory = v3Analysis?.technology_category || sectorFacets.display_name;
  queries.push(`${techCategory} products 2025 2026 market`);

  // Product types query
  if (v3Analysis?.product_types?.length > 0) {
    queries.push(`${v3Analysis.product_types.slice(0, 3).join(' ')} products companies`);
  }

  // Implementers query
  if (v3Analysis?.likely_implementers?.length > 0) {
    queries.push(`${v3Analysis.likely_implementers[0]} ${techCategory} products`);
  }

  // Competitor-based query
  if (patent.competitors_citing?.length > 0) {
    const topCompetitor = patent.competitors_citing[0];
    queries.push(`${topCompetitor} ${sectorFacets.key_products[0] || techCategory} products`);
  }

  // Market leaders query
  queries.push(`${sectorFacets.display_name} market leaders companies 2025`);

  return queries.slice(0, 5); // Max 5 queries per patent
}

// Simulate web search (in production, this would call actual WebSearch tool)
// For now, we'll use LLM with general knowledge
async function synthesizeProductDiscovery(
  patent: PatentData,
  v3Analysis: any,
  sectorFacets: SectorFacets,
  searchQueries: string[]
): Promise<ProductDiscovery> {

  const model = new ChatAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-20250514',
    temperature: 0.3,
    maxTokens: 4000,
  });

  const systemPrompt = `You are a market research expert specializing in technology products and patent infringement analysis. Your task is to identify specific commercial products that likely implement the patented technology.

Focus on:
1. Naming SPECIFIC products (not generic categories)
2. Companies that are market leaders
3. Products that match the patent's technical claims
4. Publicly available evidence of implementation

Be thorough but realistic - only suggest products where there's a reasonable belief of implementation.`;

  const userPrompt = `Analyze this patent and identify specific products that likely implement its technology:

PATENT:
- ID: ${patent.patent_id}
- Title: ${patent.title}
- Sector: ${sectorFacets.display_name}
- Technology Category: ${v3Analysis?.technology_category || 'Unknown'}
- Product Types from Analysis: ${v3Analysis?.product_types?.join(', ') || 'Unknown'}
- Likely Implementers: ${v3Analysis?.likely_implementers?.join(', ') || 'Unknown'}
- Companies Already Citing This Patent: ${patent.competitors_citing?.join(', ') || 'None'}

SECTOR CONTEXT:
- Market Size: ${sectorFacets.market_size_estimate}
- Growth Rate: ${sectorFacets.growth_rate}
- Key Products in Sector: ${sectorFacets.key_products.join(', ')}
- Key Companies in Sector: ${sectorFacets.key_companies.join(', ')}

Return a JSON response with:
{
  "products": [
    {
      "name": "Specific product name (e.g., 'AWS Elemental MediaConvert')",
      "company": "Company name",
      "category": "Product category",
      "description": "Brief description of the product",
      "price_range": "Enterprise/Consumer pricing estimate if known",
      "relevance_to_patent": "Why this product likely implements the patent",
      "evidence_type": "public_documentation|product_features|technical_specs|industry_knowledge"
    }
  ],
  "market_context": {
    "market_size": "Current market size estimate",
    "growth_rate": "Growth rate",
    "key_players": ["Top 5 companies"],
    "technology_trends": ["Current trends"]
  },
  "recommendations": ["Recommendations for further investigation"],
  "confidence": 1-5
}

List 5-10 specific products. Be specific with product names, not generic descriptions.`;

  try {
    const response = await model.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt)
    ]);

    const content = response.content as string;
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        patent_id: patent.patent_id,
        title: patent.title,
        sector: sectorFacets.display_name,
        search_queries_used: searchQueries,
        products: parsed.products || [],
        market_context: parsed.market_context || {
          market_size: sectorFacets.market_size_estimate,
          growth_rate: sectorFacets.growth_rate,
          key_players: sectorFacets.key_companies,
          technology_trends: []
        },
        recommendations: parsed.recommendations || [],
        confidence: parsed.confidence || 3
      };
    }
  } catch (error) {
    console.error(`Error analyzing patent ${patent.patent_id}:`, error);
  }

  // Return minimal response on error
  return {
    patent_id: patent.patent_id,
    title: patent.title,
    sector: sectorFacets.display_name,
    search_queries_used: searchQueries,
    products: [],
    market_context: {
      market_size: sectorFacets.market_size_estimate,
      growth_rate: sectorFacets.growth_rate,
      key_players: sectorFacets.key_companies,
      technology_trends: []
    },
    recommendations: ['Manual review needed'],
    confidence: 1
  };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/discover-sector-products.ts <sector> [--limit N]');
    console.log('Example: npx tsx scripts/discover-sector-products.ts video-codec --limit 10');
    console.log('\nAvailable sectors:');
    const facets = loadSectorFacets();
    Object.keys(facets).forEach(s => console.log(`  - ${s}`));
    process.exit(1);
  }

  const sector = args[0];
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : 20;

  console.log('============================================================');
  console.log(`Product Discovery: ${sector}`);
  console.log('============================================================\n');

  // Load configurations
  const sectorFacets = loadSectorFacets();
  if (!sectorFacets[sector]) {
    console.error(`Sector "${sector}" not found in config/sector-facets.json`);
    console.log('Available sectors:', Object.keys(sectorFacets).join(', '));
    process.exit(1);
  }

  const facets = sectorFacets[sector];
  console.log(`Sector: ${facets.display_name}`);
  console.log(`Market Size: ${facets.market_size_estimate}`);
  console.log(`Growth Rate: ${facets.growth_rate}`);
  console.log(`Key Products: ${facets.key_products.join(', ')}`);
  console.log();

  // Load patents
  const patents = loadSectorPatents(sector, limit);
  console.log(`Found ${patents.length} patents in sector\n`);

  if (patents.length === 0) {
    console.log('No patents found for this sector. Check sector name matches unified-top250 data.');
    process.exit(1);
  }

  // Load V3 analysis
  const v3Analysis = loadV3Analysis();
  console.log(`Loaded V3 analysis for ${v3Analysis.size} patents\n`);

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Process each patent
  const results: ProductDiscovery[] = [];
  const allProducts = new Map<string, Product[]>(); // Company -> Products

  for (let i = 0; i < patents.length; i++) {
    const patent = patents[i];
    const v3 = v3Analysis.get(patent.patent_id);

    console.log(`[${i + 1}/${patents.length}] ${patent.patent_id}: ${patent.title.substring(0, 60)}...`);

    // Generate search queries
    const queries = generateSearchQueries(patent, v3, facets);

    // Discover products
    const discovery = await synthesizeProductDiscovery(patent, v3, facets, queries);
    results.push(discovery);

    // Aggregate products by company
    for (const product of discovery.products) {
      if (!allProducts.has(product.company)) {
        allProducts.set(product.company, []);
      }
      allProducts.get(product.company)!.push(product);
    }

    console.log(`   Found ${discovery.products.length} products (confidence: ${discovery.confidence})`);

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Generate summary
  const summary = {
    sector: facets.display_name,
    patents_analyzed: patents.length,
    total_products_found: results.reduce((sum, r) => sum + r.products.length, 0),
    unique_companies: allProducts.size,
    companies_by_product_count: Array.from(allProducts.entries())
      .map(([company, products]) => ({ company, product_count: products.length }))
      .sort((a, b) => b.product_count - a.product_count),
    market_context: {
      market_size: facets.market_size_estimate,
      growth_rate: facets.growth_rate
    },
    generated_at: new Date().toISOString()
  };

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputPath = path.join(OUTPUT_DIR, `${sector}-products-${timestamp}.json`);
  const summaryPath = path.join(OUTPUT_DIR, `${sector}-summary-${timestamp}.json`);

  fs.writeFileSync(outputPath, JSON.stringify({ results, summary }, null, 2));
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log('\n============================================================');
  console.log('DISCOVERY COMPLETE');
  console.log('============================================================');
  console.log(`Patents analyzed: ${patents.length}`);
  console.log(`Total products found: ${summary.total_products_found}`);
  console.log(`Unique companies: ${summary.unique_companies}`);
  console.log('\nTop companies by product count:');
  summary.companies_by_product_count.slice(0, 10).forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.company}: ${c.product_count} products`);
  });
  console.log(`\nResults saved to: ${outputPath}`);
  console.log(`Summary saved to: ${summaryPath}`);
}

main().catch(console.error);
