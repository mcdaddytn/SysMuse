/**
 * Sector-Specific LLM Analysis Runner
 *
 * Runs sector-specific analysis with model selection.
 *
 * Usage:
 *   npx tsx scripts/run-sector-analysis.ts <sector> [options]
 *
 * Options:
 *   --model <opus|sonnet>  Model to use (default: opus for sector analysis)
 *   --limit <N>            Max patents to analyze
 *   --patent <id>          Analyze specific patent
 *   --list                 List available sectors
 *
 * Examples:
 *   npx tsx scripts/run-sector-analysis.ts video-codec --model opus --limit 5
 *   npx tsx scripts/run-sector-analysis.ts cloud-auth --limit 10
 *   npx tsx scripts/run-sector-analysis.ts --list
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SectorLLMAnalyzer,
  getAvailableSectors,
  getSectorConfig,
  ModelName,
  MODELS
} from '../services/llm-sector-analysis.js';

// Load patents for a sector
function loadSectorPatents(sector: string, limit: number): any[] {
  // Find most recent unified top 250 file
  const outputFiles = fs.readdirSync('./output')
    .filter(f => f.startsWith('unified-top250') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (outputFiles.length === 0) {
    console.log('No unified-top250 files found');
    return [];
  }

  const top250Path = `./output/${outputFiles[0]}`;
  console.log(`Using: ${top250Path}`);

  const data = JSON.parse(fs.readFileSync(top250Path, 'utf-8'));
  const sectorPatents = data.patents.filter((p: any) =>
    p.sector === sector ||
    p.sector?.startsWith(sector) ||
    sector.startsWith(p.sector || '') ||
    p.sector_name?.toLowerCase().includes(sector.replace(/-/g, ' '))
  );

  if (sectorPatents.length > 0) {
    console.log(`Found ${sectorPatents.length} patents in unified-top250 for sector: ${sector}`);
    return sectorPatents.slice(0, limit);
  }

  // Try detailed sector assignment files (v2 has granular sectors)
  const sectorFiles = fs.readdirSync('./output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-v2') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (sectorFiles.length > 0) {
    const sectorAssignPath = `./output/sectors/${sectorFiles[0]}`;
    console.log(`Looking up sector in: ${sectorAssignPath}`);

    const sectorData = JSON.parse(fs.readFileSync(sectorAssignPath, 'utf-8'));

    // Get patent IDs for this sector (data is in 'assignments' not 'patents')
    const assignments = sectorData.assignments || sectorData.patents || [];
    const patentIds = assignments
      .filter((p: any) => p.sector === sector)
      .map((p: any) => p.patent_id);

    if (patentIds.length > 0) {
      console.log(`Found ${patentIds.length} patent IDs in sector assignment for: ${sector}`);

      // Enrich with data from multi-score analysis or raw metrics
      const multiScoreFiles = fs.readdirSync('./output')
        .filter(f => f.startsWith('multi-score-analysis') && f.endsWith('.json'))
        .sort()
        .reverse();

      let enrichedPatents: any[] = [];

      if (multiScoreFiles.length > 0) {
        const multiScorePath = `./output/${multiScoreFiles[0]}`;
        console.log(`Enriching from: ${multiScorePath}`);
        const multiData = JSON.parse(fs.readFileSync(multiScorePath, 'utf-8'));
        const patentMap = new Map(multiData.patents.map((p: any) => [p.patent_id, p]));

        enrichedPatents = patentIds
          .map((id: string) => patentMap.get(id))
          .filter((p: any) => p !== undefined)
          .sort((a: any, b: any) => (b.competitor_citations || 0) - (a.competitor_citations || 0));
      }

      if (enrichedPatents.length > 0) {
        console.log(`Found ${enrichedPatents.length} enriched patents for sector: ${sector}`);
        return enrichedPatents.slice(0, limit);
      }

      // If no enrichment source, return basic patent objects
      return patentIds.slice(0, limit).map((id: string) => ({ patent_id: id, sector }));
    }
  }

  // Fallback: Try CPC-based filtering on multi-score analysis
  const multiScoreFiles = fs.readdirSync('./output')
    .filter(f => f.startsWith('multi-score-analysis') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (multiScoreFiles.length > 0) {
    const multiScorePath = `./output/${multiScoreFiles[0]}`;
    const multiData = JSON.parse(fs.readFileSync(multiScorePath, 'utf-8'));

    // Filter by CPC codes relevant to sector
    const sectorCPCPrefixes: Record<string, string[]> = {
      'video-codec': ['H04N19', 'H04N21', 'G06T9'],
      'cloud-auth': ['H04L63', 'H04L9', 'G06F21'],
      'rf-acoustic': ['H03H9', 'H03H3', 'H04B1'],
      'network-threat-protection': ['H04L63', 'G06F21', 'H04L12'],
      'network-switching': ['H04L45', 'H04L49', 'H04L12/46'],
      'network-management': ['H04L41', 'H04L43', 'H04L12/24']
    };

    const prefixes = sectorCPCPrefixes[sector] || [];
    const cpcPatents = multiData.patents
      .filter((p: any) => {
        if (p.sector === sector) return true;
        if (!p.cpc_codes || p.cpc_codes.length === 0) return false;
        return p.cpc_codes.some((cpc: string) =>
          prefixes.some(prefix => cpc.startsWith(prefix))
        );
      })
      .sort((a: any, b: any) => (b.competitor_citations || 0) - (a.competitor_citations || 0))
      .slice(0, limit);

    console.log(`Found ${cpcPatents.length} patents via CPC filtering for sector: ${sector}`);
    return cpcPatents;
  }

  return [];
}

// Load patent abstracts from ElasticSearch export or other source
function enrichPatentAbstracts(patents: any[]): any[] {
  // Try to load from ES index export
  const esExportPath = './output/es-patents-export.json';
  if (fs.existsSync(esExportPath)) {
    const esData = JSON.parse(fs.readFileSync(esExportPath, 'utf-8'));
    const abstractMap = new Map(esData.map((p: any) => [p.patent_id, p.abstract]));

    return patents.map(p => ({
      ...p,
      abstract: p.abstract || abstractMap.get(p.patent_id) || ''
    }));
  }

  return patents;
}

async function main() {
  const args = process.argv.slice(2);

  // Handle --list flag
  if (args.includes('--list')) {
    console.log('Available sectors for analysis:\n');
    const sectors = getAvailableSectors();
    for (const sector of sectors) {
      const config = getSectorConfig(sector);
      console.log(`  ${sector}`);
      console.log(`    Display Name: ${config?.display_name}`);
      console.log(`    Key Products: ${config?.key_products.slice(0, 3).join(', ')}`);
      console.log(`    Key Companies: ${config?.key_companies.slice(0, 4).join(', ')}`);
      console.log();
    }
    console.log('Available models:');
    Object.entries(MODELS).forEach(([name, id]) => {
      console.log(`  ${name}: ${id}`);
    });
    return;
  }

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/run-sector-analysis.ts <sector> [options]');
    console.log('\nOptions:');
    console.log('  --model <opus|sonnet>  Model to use (default: opus)');
    console.log('  --limit <N>            Max patents to analyze');
    console.log('  --patent <id>          Analyze specific patent');
    console.log('  --list                 List available sectors');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/run-sector-analysis.ts video-codec --model opus --limit 5');
    console.log('  npx tsx scripts/run-sector-analysis.ts cloud-auth --limit 10');
    process.exit(1);
  }

  const sector = args[0];

  // Parse options
  const modelIndex = args.indexOf('--model');
  const model: ModelName = modelIndex !== -1 ? (args[modelIndex + 1] as ModelName) : 'opus';

  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : 10;

  const patentIndex = args.indexOf('--patent');
  const specificPatent = patentIndex !== -1 ? args[patentIndex + 1] : null;

  // Validate sector
  const availableSectors = getAvailableSectors();
  if (!availableSectors.includes(sector)) {
    console.error(`Error: Sector "${sector}" not found.`);
    console.error(`Available sectors: ${availableSectors.join(', ')}`);
    process.exit(1);
  }

  const sectorConfig = getSectorConfig(sector);

  console.log('============================================================');
  console.log(`SECTOR-SPECIFIC ANALYSIS: ${sectorConfig?.display_name}`);
  console.log('============================================================');
  console.log(`Model: ${model} (${MODELS[model]})`);
  console.log(`Limit: ${limit} patents`);
  console.log();

  // Load patents
  let patents: any[];
  if (specificPatent) {
    // Load specific patent from any source
    const top250Path = './output/unified-top250-v2-2026-01-18.json';
    const data = JSON.parse(fs.readFileSync(top250Path, 'utf-8'));
    patents = data.patents.filter((p: any) => p.patent_id === specificPatent);
    if (patents.length === 0) {
      console.error(`Patent ${specificPatent} not found in top 250`);
      process.exit(1);
    }
  } else {
    patents = loadSectorPatents(sector, limit);
  }

  if (patents.length === 0) {
    console.error(`No patents found for sector: ${sector}`);
    process.exit(1);
  }

  // Enrich with abstracts
  patents = enrichPatentAbstracts(patents);

  console.log(`Loaded ${patents.length} patents for analysis`);
  console.log();

  // Initialize analyzer
  const analyzer = new SectorLLMAnalyzer(sector, { model });

  // Run analysis
  console.log('Starting analysis...\n');
  const startTime = Date.now();

  const results = await analyzer.analyzeBatch(patents, {
    saveProgress: true,
    rateLimitMs: model === 'opus' ? 3000 : 2000 // Slower for Opus
  });

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Save results
  const outputPath = analyzer.saveResults(results);

  // Print summary
  console.log('\n============================================================');
  console.log('ANALYSIS COMPLETE');
  console.log('============================================================');
  console.log(`Sector: ${sectorConfig?.display_name}`);
  console.log(`Model: ${model}`);
  console.log(`Patents analyzed: ${results.length}/${patents.length}`);
  console.log(`Duration: ${duration} minutes`);
  console.log();

  // Product summary
  const allProducts = results.flatMap(r => r.specific_products);
  const productsByCompany = new Map<string, number>();
  for (const p of allProducts) {
    productsByCompany.set(p.company, (productsByCompany.get(p.company) || 0) + 1);
  }

  console.log('Products identified:');
  console.log(`  Total products: ${allProducts.length}`);
  console.log(`  Unique companies: ${productsByCompany.size}`);
  console.log('\n  Top companies by product count:');
  Array.from(productsByCompany.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([company, count], i) => {
      console.log(`    ${i + 1}. ${company}: ${count} products`);
    });

  // Score distribution
  const avgEligibility = results.reduce((sum, r) => sum + r.eligibility_score, 0) / results.length;
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

  console.log('\nScore averages:');
  console.log(`  Eligibility: ${avgEligibility.toFixed(1)}`);
  console.log(`  Confidence: ${avgConfidence.toFixed(1)}`);

  console.log(`\nResults saved to: ${outputPath}`);
}

main().catch(console.error);
