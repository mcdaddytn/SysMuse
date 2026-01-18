/**
 * Assign Sectors V2 - Detailed CPC Subgroup Mapping
 *
 * Implements the sector breakouts from SECTOR_BREAKOUT_PROPOSALS_V2.md
 * with ~47 targeted sectors based on CPC subgroups and term matching.
 *
 * Usage:
 *   npx tsx scripts/assign-sectors-v2.ts
 */

import * as fs from 'fs';

const ES_URL = 'http://localhost:9200';
const INDEX = 'patents';

interface SectorConfig {
  name: string;
  description: string;
  damages_tier: string;
  cpc_patterns?: string[];
  terms?: string[];
}

interface SectorBreakoutConfig {
  version: string;
  sectorMappings: Record<string, SectorConfig>;
  termBasedSectors: Record<string, SectorConfig>;
}

interface PatentSectorAssignment {
  patent_id: string;
  title: string;
  primary_cpc: string | null;
  all_cpc_codes: string[];
  sector: string;
  sector_name: string;
  sector_source: 'term' | 'cpc-subgroup' | 'cpc-class' | 'none';
  damages_tier: string;
  matched_pattern?: string;
}

function loadSectorConfig(): SectorBreakoutConfig {
  const configPath = './config/sector-breakout-v2.json';
  if (!fs.existsSync(configPath)) {
    throw new Error('sector-breakout-v2.json not found');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function loadTermBasedAssignments(): Map<string, { sector: string; sectorName: string }> {
  const map = new Map<string, { sector: string; sectorName: string }>();
  const sectorDir = './output/sectors';

  if (!fs.existsSync(sectorDir)) return map;

  const files = fs.readdirSync(sectorDir).filter(f =>
    f.endsWith('-analysis-2026-01-17.json') ||
    f.includes('mlt-expanded')
  );

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(`${sectorDir}/${file}`, 'utf-8'));
      const sector = data.sector;
      const sectorName = data.sectorName;

      for (const result of data.results || []) {
        map.set(result.patent_id, { sector, sectorName });
      }
    } catch (e) {
      // Skip invalid files
    }
  }

  console.log(`Loaded ${map.size} term-based sector assignments`);
  return map;
}

function matchCPCToSector(
  cpcCodes: string[],
  config: SectorBreakoutConfig
): { sector: string; sectorName: string; source: 'cpc-subgroup' | 'cpc-class' | 'none'; matchedPattern: string | null; damagesTier: string } {
  if (!cpcCodes || cpcCodes.length === 0) {
    return { sector: 'general', sectorName: 'General', source: 'none', matchedPattern: null, damagesTier: 'Low' };
  }

  // Build sorted patterns (longer = more specific first)
  const allPatterns: { pattern: string; sectorId: string; sectorConfig: SectorConfig }[] = [];

  for (const [sectorId, sectorConfig] of Object.entries(config.sectorMappings)) {
    for (const pattern of sectorConfig.cpc_patterns || []) {
      allPatterns.push({ pattern, sectorId, sectorConfig });
    }
  }

  // Sort by pattern length descending (more specific first)
  allPatterns.sort((a, b) => b.pattern.length - a.pattern.length);

  // Try to match each CPC code against patterns
  for (const cpc of cpcCodes) {
    for (const { pattern, sectorId, sectorConfig } of allPatterns) {
      if (cpc.startsWith(pattern)) {
        return {
          sector: sectorId,
          sectorName: sectorConfig.name,
          source: 'cpc-subgroup',
          matchedPattern: pattern,
          damagesTier: sectorConfig.damages_tier
        };
      }
    }
  }

  // Fallback to broader class matching
  const classPrefixes: Record<string, { sector: string; name: string; tier: string }> = {
    'H04N': { sector: 'video-image', name: 'Video/Image Processing', tier: 'Medium' },
    'H04L': { sector: 'network-security', name: 'Network/Security', tier: 'High' },
    'H04W': { sector: 'wireless', name: 'Wireless Communications', tier: 'High' },
    'H04B': { sector: 'wireless', name: 'Wireless Communications', tier: 'High' },
    'G06F': { sector: 'computing', name: 'Computing/Data Processing', tier: 'Medium' },
    'G06N': { sector: 'ai-ml', name: 'AI/Machine Learning', tier: 'Medium' },
    'G06T': { sector: 'image-processing', name: 'Image Processing', tier: 'Medium' },
    'G11B': { sector: 'video-storage', name: 'Video Storage', tier: 'Medium' },
    'H01L': { sector: 'semiconductor', name: 'Semiconductor/Hardware', tier: 'High' },
    'H03H': { sector: 'rf-acoustic', name: 'RF/Acoustic Resonators', tier: 'Very High' },
    'G10L': { sector: 'audio', name: 'Audio Processing', tier: 'Medium' },
    'H04R': { sector: 'audio', name: 'Audio Processing', tier: 'Medium' },
    'G02': { sector: 'optics', name: 'Optics/Photonics', tier: 'Medium' },
  };

  for (const cpc of cpcCodes) {
    for (const [prefix, info] of Object.entries(classPrefixes)) {
      if (cpc.startsWith(prefix)) {
        return {
          sector: info.sector,
          sectorName: info.name,
          source: 'cpc-class',
          matchedPattern: prefix,
          damagesTier: info.tier
        };
      }
    }
  }

  return { sector: 'general', sectorName: 'General', source: 'none', matchedPattern: null, damagesTier: 'Low' };
}

async function fetchAllPatentsFromES(): Promise<any[]> {
  console.log('Fetching all patents from ElasticSearch...');
  const patents: any[] = [];
  let scrollId: string | null = null;
  const batchSize = 5000;

  const initialResponse = await fetch(`${ES_URL}/${INDEX}/_search?scroll=2m`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: batchSize,
      _source: ['patent_id', 'title', 'cpc_codes', 'abstract'],
      query: { match_all: {} }
    })
  });

  let data = await initialResponse.json();
  scrollId = data._scroll_id;
  patents.push(...data.hits.hits.map((h: any) => h._source));
  console.log(`  Fetched ${patents.length} patents...`);

  while (data.hits.hits.length > 0) {
    const scrollResponse = await fetch(`${ES_URL}/_search/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scroll: '2m', scroll_id: scrollId })
    });

    data = await scrollResponse.json();
    if (data.hits.hits.length === 0) break;

    patents.push(...data.hits.hits.map((h: any) => h._source));
    console.log(`  Fetched ${patents.length} patents...`);
  }

  if (scrollId) {
    await fetch(`${ES_URL}/_search/scroll`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scroll_id: scrollId })
    });
  }

  return patents;
}

async function main() {
  console.log('='.repeat(60));
  console.log('V2 Sector Assignment - Detailed CPC Subgroup Mapping');
  console.log('='.repeat(60));
  console.log('');

  // Load configurations
  const config = loadSectorConfig();
  console.log(`Loaded ${Object.keys(config.sectorMappings).length} CPC-based sectors`);
  console.log(`Loaded ${Object.keys(config.termBasedSectors).length} term-based sectors`);

  // Load existing term-based assignments (from hybrid clustering)
  const termSectors = loadTermBasedAssignments();

  // Fetch all patents
  const patents = await fetchAllPatentsFromES();
  console.log(`\nTotal patents to process: ${patents.length}`);

  // Process patents
  const assignments: PatentSectorAssignment[] = [];
  const sectorCounts: Record<string, number> = {};
  const sourceStats = { term: 0, 'cpc-subgroup': 0, 'cpc-class': 0, none: 0 };

  for (const patent of patents) {
    const patentId = patent.patent_id;
    const cpcCodes = patent.cpc_codes || [];

    // Check for term-based sector first (highest priority)
    const termInfo = termSectors.get(patentId);
    let sector: string;
    let sectorName: string;
    let source: 'term' | 'cpc-subgroup' | 'cpc-class' | 'none';
    let damagesTier: string;
    let matchedPattern: string | undefined;

    if (termInfo) {
      sector = termInfo.sector;
      sectorName = termInfo.sectorName;
      source = 'term';
      damagesTier = config.termBasedSectors[sector]?.damages_tier || 'Medium';
    } else {
      const cpcMatch = matchCPCToSector(cpcCodes, config);
      sector = cpcMatch.sector;
      sectorName = cpcMatch.sectorName;
      source = cpcMatch.source;
      damagesTier = cpcMatch.damagesTier;
      matchedPattern = cpcMatch.matchedPattern || undefined;
    }

    sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    sourceStats[source]++;

    assignments.push({
      patent_id: patentId,
      title: patent.title || '',
      primary_cpc: cpcCodes[0] || null,
      all_cpc_codes: cpcCodes,
      sector,
      sector_name: sectorName,
      sector_source: source,
      damages_tier: damagesTier,
      matched_pattern: matchedPattern,
    });
  }

  // Sort by patent_id
  assignments.sort((a, b) => a.patent_id.localeCompare(b.patent_id));

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output/sectors';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    config_version: config.version,
    total_patents: assignments.length,
    source_distribution: sourceStats,
    sector_distribution: sectorCounts,
    unique_sectors: Object.keys(sectorCounts).length,
    assignments,
  };

  const outputPath = `${outputDir}/all-patents-sectors-v2-${timestamp}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Save CSV
  const csvPath = `./output/patents-with-sectors-v2-${timestamp}.csv`;
  const csvHeader = 'patent_id,title,sector,sector_name,sector_source,damages_tier,primary_cpc,matched_pattern';
  const csvRows = assignments.map(a =>
    `${a.patent_id},"${a.title.replace(/"/g, '""')}",${a.sector},"${a.sector_name}",${a.sector_source},${a.damages_tier},${a.primary_cpc || ''},${a.matched_pattern || ''}`
  );
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));
  console.log(`CSV saved to: ${csvPath}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('V2 SECTOR ASSIGNMENT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total patents: ${assignments.length}`);
  console.log(`Unique sectors: ${Object.keys(sectorCounts).length}`);
  console.log('\nSector Source Distribution:');
  console.log(`  Term-based (hybrid clustering): ${sourceStats.term}`);
  console.log(`  CPC Subgroup (detailed match): ${sourceStats['cpc-subgroup']}`);
  console.log(`  CPC Class (broad match): ${sourceStats['cpc-class']}`);
  console.log(`  No sector (general): ${sourceStats.none}`);

  console.log('\nTop 20 Sectors by Patent Count:');
  const sortedSectors = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]);
  for (const [sector, count] of sortedSectors.slice(0, 20)) {
    const pct = ((count / assignments.length) * 100).toFixed(1);
    console.log(`  ${sector}: ${count} (${pct}%)`);
  }

  // Damages tier distribution
  const tierCounts: Record<string, number> = {};
  for (const a of assignments) {
    tierCounts[a.damages_tier] = (tierCounts[a.damages_tier] || 0) + 1;
  }
  console.log('\nDamages Tier Distribution:');
  for (const [tier, count] of Object.entries(tierCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / assignments.length) * 100).toFixed(1);
    console.log(`  ${tier}: ${count} (${pct}%)`);
  }
}

main().catch(console.error);
