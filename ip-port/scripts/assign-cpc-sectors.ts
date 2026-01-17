/**
 * Assign CPC-based sectors to all patents
 *
 * Creates a sector assignment based on primary CPC codes.
 * This provides fallback sector coverage for patents without term-based sectors.
 *
 * Usage:
 *   npx tsx scripts/assign-cpc-sectors.ts
 */

import * as fs from 'fs';

const ES_URL = 'http://localhost:9200';
const INDEX = 'patents';

// CPC code prefix to sector mapping
const CPC_SECTOR_MAP: Record<string, { sector: string; sectorName: string }> = {
  // Video/Image processing
  'H04N': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'G06T': { sector: 'video-image', sectorName: 'Video/Image Processing' },
  'G11B': { sector: 'video-image', sectorName: 'Video/Image Processing' },

  // Networking & Security
  'H04L': { sector: 'network-security', sectorName: 'Network/Security' },

  // Wireless communications
  'H04W': { sector: 'wireless', sectorName: 'Wireless Communications' },
  'H04B': { sector: 'wireless', sectorName: 'Wireless Communications' },

  // Computing & Data processing
  'G06F': { sector: 'computing', sectorName: 'Computing/Data Processing' },
  'G06N': { sector: 'ai-ml', sectorName: 'AI/Machine Learning' },
  'G06Q': { sector: 'computing', sectorName: 'Computing/Data Processing' },

  // Semiconductors & Hardware
  'H01L': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },
  'H03': { sector: 'semiconductor', sectorName: 'Semiconductor/Hardware' },

  // Audio
  'G10L': { sector: 'audio', sectorName: 'Audio Processing' },
  'H04R': { sector: 'audio', sectorName: 'Audio Processing' },
  'H04S': { sector: 'audio', sectorName: 'Audio Processing' },

  // RF/Acoustic (Avago specialty)
  'H03H': { sector: 'rf-acoustic', sectorName: 'RF/Acoustic Resonators' },

  // Cryptography
  'H04K': { sector: 'security-crypto', sectorName: 'Security/Cryptography' },

  // Optics
  'G02': { sector: 'optics', sectorName: 'Optics/Photonics' },
  'H04J': { sector: 'optics', sectorName: 'Optics/Photonics' },
};

// Priority order for CPC prefixes (longer matches first)
const CPC_PREFIXES = Object.keys(CPC_SECTOR_MAP).sort((a, b) => b.length - a.length);

interface PatentSectorAssignment {
  patent_id: string;
  title: string;
  primary_cpc: string | null;
  cpc_sector: string;
  cpc_sector_name: string;
  all_cpc_codes: string[];
  term_sector: string | null;  // Will be filled from existing sector analysis
  term_sector_name: string | null;
  final_sector: string;
  final_sector_name: string;
  sector_source: 'term' | 'cpc' | 'none';
}

function getCPCSector(cpcCodes: string[]): { sector: string; sectorName: string; primaryCpc: string | null } {
  if (!cpcCodes || cpcCodes.length === 0) {
    return { sector: 'general', sectorName: 'General', primaryCpc: null };
  }

  // Find the first matching CPC prefix
  for (const cpc of cpcCodes) {
    for (const prefix of CPC_PREFIXES) {
      if (cpc.startsWith(prefix)) {
        return {
          ...CPC_SECTOR_MAP[prefix],
          primaryCpc: cpc
        };
      }
    }
  }

  return { sector: 'general', sectorName: 'General', primaryCpc: cpcCodes[0] || null };
}

async function fetchAllPatentsFromES(): Promise<any[]> {
  console.log('Fetching all patents from ElasticSearch...');
  const patents: any[] = [];
  let scrollId: string | null = null;
  const batchSize = 5000;

  // Initial search with scroll
  const initialResponse = await fetch(`${ES_URL}/${INDEX}/_search?scroll=2m`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: batchSize,
      _source: ['patent_id', 'title', 'cpc_codes'],
      query: { match_all: {} }
    })
  });

  let data = await initialResponse.json();
  scrollId = data._scroll_id;
  patents.push(...data.hits.hits.map((h: any) => h._source));
  console.log(`  Fetched ${patents.length} patents...`);

  // Continue scrolling
  while (data.hits.hits.length > 0) {
    const scrollResponse = await fetch(`${ES_URL}/_search/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scroll: '2m',
        scroll_id: scrollId
      })
    });

    data = await scrollResponse.json();
    if (data.hits.hits.length === 0) break;

    patents.push(...data.hits.hits.map((h: any) => h._source));
    console.log(`  Fetched ${patents.length} patents...`);
  }

  // Clear scroll
  if (scrollId) {
    await fetch(`${ES_URL}/_search/scroll`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scroll_id: scrollId })
    });
  }

  return patents;
}

function loadTermBasedSectors(): Map<string, { sector: string; sectorName: string }> {
  const sectorMap = new Map<string, { sector: string; sectorName: string }>();
  const sectorDir = './output/sectors';

  if (!fs.existsSync(sectorDir)) {
    return sectorMap;
  }

  const files = fs.readdirSync(sectorDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(`${sectorDir}/${file}`, 'utf-8'));
    const sector = data.sector;
    const sectorName = data.sectorName;

    for (const result of data.results || []) {
      sectorMap.set(result.patent_id, { sector, sectorName });
    }
  }

  console.log(`Loaded ${sectorMap.size} term-based sector assignments`);
  return sectorMap;
}

async function main() {
  console.log('='.repeat(60));
  console.log('CPC-Based Sector Assignment');
  console.log('='.repeat(60));
  console.log('');

  // Load existing term-based sectors
  const termSectors = loadTermBasedSectors();

  // Fetch all patents from ES
  const patents = await fetchAllPatentsFromES();
  console.log(`\nTotal patents to process: ${patents.length}`);

  // Assign sectors
  const assignments: PatentSectorAssignment[] = [];
  const sectorCounts: Record<string, number> = {};
  const sourceStats = { term: 0, cpc: 0, none: 0 };

  for (const patent of patents) {
    const patentId = patent.patent_id;
    const cpcCodes = patent.cpc_codes || [];
    const { sector: cpcSector, sectorName: cpcSectorName, primaryCpc } = getCPCSector(cpcCodes);

    // Check for term-based sector
    const termInfo = termSectors.get(patentId);

    let finalSector: string;
    let finalSectorName: string;
    let source: 'term' | 'cpc' | 'none';

    if (termInfo) {
      // Prefer term-based sector
      finalSector = termInfo.sector;
      finalSectorName = termInfo.sectorName;
      source = 'term';
      sourceStats.term++;
    } else if (cpcSector !== 'general') {
      // Use CPC-based sector
      finalSector = cpcSector;
      finalSectorName = cpcSectorName;
      source = 'cpc';
      sourceStats.cpc++;
    } else {
      // No sector assignment
      finalSector = 'general';
      finalSectorName = 'General';
      source = 'none';
      sourceStats.none++;
    }

    sectorCounts[finalSector] = (sectorCounts[finalSector] || 0) + 1;

    assignments.push({
      patent_id: patentId,
      title: patent.title || '',
      primary_cpc: primaryCpc,
      cpc_sector: cpcSector,
      cpc_sector_name: cpcSectorName,
      all_cpc_codes: cpcCodes,
      term_sector: termInfo?.sector || null,
      term_sector_name: termInfo?.sectorName || null,
      final_sector: finalSector,
      final_sector_name: finalSectorName,
      sector_source: source,
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
    total_patents: assignments.length,
    source_distribution: sourceStats,
    sector_distribution: sectorCounts,
    assignments,
  };

  const outputPath = `${outputDir}/all-patents-sectors-${timestamp}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Also save a CSV for easy viewing
  const csvPath = `./output/patents-with-sectors-${timestamp}.csv`;
  const csvHeader = 'patent_id,title,final_sector,final_sector_name,sector_source,primary_cpc';
  const csvRows = assignments.map(a =>
    `${a.patent_id},"${a.title.replace(/"/g, '""')}",${a.final_sector},"${a.final_sector_name}",${a.sector_source},${a.primary_cpc || ''}`
  );
  fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));
  console.log(`CSV saved to: ${csvPath}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total patents: ${assignments.length}`);
  console.log('\nSector Source Distribution:');
  console.log(`  Term-based (hybrid clustering): ${sourceStats.term}`);
  console.log(`  CPC-based (fallback): ${sourceStats.cpc}`);
  console.log(`  No sector (general): ${sourceStats.none}`);

  console.log('\nSector Distribution:');
  const sortedSectors = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1]);
  for (const [sector, count] of sortedSectors) {
    const pct = ((count / assignments.length) * 100).toFixed(1);
    console.log(`  ${sector}: ${count} (${pct}%)`);
  }
}

main().catch(console.error);
