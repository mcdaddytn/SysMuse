#!/usr/bin/env npx tsx
/**
 * Sector Expansion Script
 *
 * Searches the portfolio for patents related to a sector but not currently assigned to it.
 * Uses term-based search, CPC mining, and MLT queries.
 *
 * Usage:
 *   npx tsx scripts/expand-sector.ts video-codec
 *   npx tsx scripts/expand-sector.ts ai-ml
 *   npx tsx scripts/expand-sector.ts --dry-run video-codec
 */

import * as fs from 'fs';

// Sector-specific search terms
const SECTOR_TERMS: Record<string, string[]> = {
  'video-codec': [
    // Codec fundamentals
    'macroblock', 'intra prediction', 'inter prediction', 'intra-frame', 'inter-frame',
    'motion vector', 'motion compensation', 'motion estimation', 'block matching',
    'entropy coding', 'CABAC', 'CAVLC', 'arithmetic coding', 'context adaptive',
    'transform coefficient', 'DCT', 'discrete cosine', 'inverse transform',
    'quantization matrix', 'quantization parameter', 'rate control',
    'loop filter', 'deblocking', 'sample adaptive offset', 'in-loop filter',
    // Standards
    'H.264', 'AVC', 'advanced video coding',
    'H.265', 'HEVC', 'high efficiency video',
    'H.266', 'VVC', 'versatile video coding',
    'AV1', 'AOMedia', 'VP9', 'VP8', 'WebM',
    'MPEG-2', 'MPEG-4',
    // Components
    'video encoder', 'video decoder', 'codec', 'transcoder', 'transcoding',
    'bitstream', 'NAL unit', 'slice', 'picture parameter', 'sequence parameter',
    // Techniques
    'bi-prediction', 'B-frame', 'P-frame', 'I-frame', 'reference frame',
    'coding tree unit', 'prediction unit', 'transform unit',
    'affine motion', 'merge mode', 'skip mode', 'direct mode',
    'scalable video', 'multi-view', '3D video'
  ],
  'ai-ml': [
    // Core concepts
    'neural network', 'deep learning', 'machine learning', 'artificial intelligence',
    'deep neural', 'neural net',
    // Architectures
    'convolutional neural', 'convolutional network', 'CNN',
    'recurrent neural', 'recurrent network', 'LSTM', 'long short-term memory',
    'transformer', 'attention mechanism', 'self-attention', 'multi-head attention',
    'generative adversarial', 'GAN', 'autoencoder', 'variational autoencoder',
    'graph neural', 'residual network', 'ResNet',
    // Training
    'backpropagation', 'gradient descent', 'stochastic gradient',
    'training neural', 'training model', 'training data',
    'loss function', 'optimization', 'hyperparameter',
    'batch normalization', 'dropout', 'regularization',
    // Inference
    'inference engine', 'model inference', 'neural inference',
    'quantized neural', 'model compression', 'pruning neural',
    // Applications
    'object detection', 'image recognition', 'image classification',
    'semantic segmentation', 'instance segmentation',
    'natural language processing', 'NLP', 'language model',
    'speech recognition', 'voice recognition',
    'recommendation system', 'recommender',
    'anomaly detection',
    // Hardware
    'neural accelerator', 'neural processor', 'AI accelerator',
    'tensor processor', 'TPU', 'neural processing unit', 'NPU',
    'GPU computing', 'parallel neural'
  ],
  'automotive-adas': [
    // Core ADAS
    'ADAS', 'advanced driver assistance', 'driver assistance system',
    'autonomous vehicle', 'autonomous driving', 'self-driving',
    'automated driving', 'driverless',
    // Detection
    'pedestrian detection', 'vehicle detection', 'object detection vehicle',
    'obstacle detection', 'traffic sign recognition', 'traffic light detection',
    // Lane
    'lane detection', 'lane keeping', 'lane departure', 'lane change assist',
    'lane marking', 'road marking',
    // Safety
    'collision avoidance', 'collision warning', 'forward collision',
    'automatic emergency braking', 'AEB', 'emergency braking',
    'blind spot detection', 'blind spot monitoring',
    'cross traffic alert', 'rear cross traffic',
    // Cruise/Speed
    'adaptive cruise control', 'ACC', 'cruise control radar',
    'speed limit assist', 'intelligent speed',
    // Parking
    'parking assist', 'automated parking', 'park assist',
    'surround view', 'around view', '360 degree view',
    // Sensors
    'LiDAR', 'LIDAR', 'lidar sensor', 'laser scanner',
    'automotive radar', 'radar sensor vehicle', 'millimeter wave radar',
    'ultrasonic sensor', 'parking sensor',
    'camera vehicle', 'automotive camera', 'rearview camera',
    'sensor fusion', 'multi-sensor fusion',
    // Planning
    'path planning', 'trajectory planning', 'motion planning vehicle',
    'route planning', 'navigation system',
    // V2X
    'V2X', 'vehicle to vehicle', 'V2V', 'vehicle to infrastructure', 'V2I',
    'connected vehicle', 'vehicular communication',
    // Specific systems
    'electronic stability', 'ESC', 'traction control',
    'anti-lock braking', 'ABS'
  ],
  'rf-acoustic': [
    // BAW/FBAR
    'bulk acoustic wave', 'BAW resonator', 'BAW filter',
    'film bulk acoustic', 'FBAR', 'thin film bulk acoustic',
    'solidly mounted resonator', 'SMR',
    // SAW
    'surface acoustic wave', 'SAW filter', 'SAW resonator',
    'SAW device', 'interdigital transducer', 'IDT',
    // Materials
    'piezoelectric', 'piezoelectric layer', 'piezoelectric film',
    'aluminum nitride', 'AlN', 'zinc oxide piezo',
    'scandium aluminum nitride', 'ScAlN',
    'lithium niobate', 'lithium tantalate',
    // RF components
    'RF filter', 'radio frequency filter', 'bandpass filter',
    'duplexer', 'diplexer', 'multiplexer RF',
    'acoustic resonator', 'resonator filter',
    'RF front end', 'front-end module',
    // Structure
    'thin film resonator', 'acoustic mirror', 'Bragg reflector',
    'electrode acoustic', 'top electrode', 'bottom electrode',
    'acoustic cavity', 'resonator cavity',
    // Applications
    'mobile phone filter', 'wireless filter', '5G filter',
    'LTE filter', 'WiFi filter', 'GPS filter'
  ]
};

// Minimum score thresholds by sector (some need stricter matching)
const SECTOR_MIN_SCORES: Record<string, number> = {
  'video-codec': 5,
  'ai-ml': 4,
  'automotive-adas': 4,
  'rf-acoustic': 5
};

// CPC codes associated with sectors
const SECTOR_CPC_PREFIXES: Record<string, string[]> = {
  'video-codec': ['H04N19', 'H04N21/2343', 'H04N21/2368', 'H04N21/4402'],
  'ai-ml': ['G06N3', 'G06N20', 'G06F18/2'],
  'automotive-adas': ['B60W30', 'B60W50', 'G06V20/58', 'G08G1'],
  'rf-acoustic': ['H03H9/02', 'H03H9/17', 'H03H9/25']
};

interface Patent {
  patent_id: string;
  title: string;
  abstract?: string;
  remaining_years?: number;
  competitor_citations?: number;
  cpc_codes?: string[];
}

interface SearchResult {
  patent_id: string;
  title: string;
  remaining_years: number;
  competitor_citations: number;
  current_sector: string;
  match_type: string;
  match_terms: string[];
  relevance_score: number;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sectorArg = args.find(a => !a.startsWith('--'));

  if (!sectorArg || !SECTOR_TERMS[sectorArg]) {
    console.log('Usage: npx tsx scripts/expand-sector.ts [--dry-run] <sector>');
    console.log('');
    console.log('Available sectors:');
    Object.keys(SECTOR_TERMS).forEach(s => console.log('  ' + s));
    process.exit(1);
  }

  const targetSector = sectorArg;
  const searchTerms = SECTOR_TERMS[targetSector];
  const cpcPrefixes = SECTOR_CPC_PREFIXES[targetSector] || [];

  console.log('='.repeat(70));
  console.log(`SECTOR EXPANSION: ${targetSector.toUpperCase()}`);
  console.log('='.repeat(70));
  console.log(`Search terms: ${searchTerms.length}`);
  console.log(`CPC prefixes: ${cpcPrefixes.join(', ') || 'none'}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  // Load patent data
  const msaFile = fs.readdirSync('output')
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort().reverse()[0];

  if (!msaFile) {
    console.error('No multi-score-analysis file found');
    process.exit(1);
  }

  const msa = JSON.parse(fs.readFileSync(`output/${msaFile}`, 'utf-8'));
  console.log(`Loaded ${msa.patents.length} patents from ${msaFile}`);

  // Load sector assignments
  const secFiles = fs.readdirSync('output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-v2') && f.endsWith('.json'))
    .sort().reverse();

  const sectorMap = new Map<string, string>();
  if (secFiles.length > 0) {
    const secData = JSON.parse(fs.readFileSync(`output/sectors/${secFiles[0]}`, 'utf-8'));
    secData.assignments.forEach((a: any) => sectorMap.set(a.patent_id, a.sector));
    console.log(`Loaded sector assignments for ${sectorMap.size} patents`);
  }

  // Count current sector size
  const currentInSector = msa.patents.filter((p: Patent) => sectorMap.get(p.patent_id) === targetSector);
  const currentActive = currentInSector.filter((p: Patent) => (p.remaining_years || 0) >= 3);
  console.log(`Current ${targetSector}: ${currentInSector.length} total, ${currentActive.length} active (3+ years)`);
  console.log('');

  // Search for candidates NOT currently in target sector
  const candidates: SearchResult[] = [];

  for (const patent of msa.patents as Patent[]) {
    const currentSector = sectorMap.get(patent.patent_id) || 'unassigned';

    // Skip if already in target sector
    if (currentSector === targetSector) continue;

    // Skip if expired (less than 3 years)
    if ((patent.remaining_years || 0) < 3) continue;

    const title = (patent.title || '').toLowerCase();
    const abstract = (patent.abstract || '').toLowerCase();
    const cpcCodes = patent.cpc_codes || [];

    const matchTerms: string[] = [];
    let matchType = '';
    let relevanceScore = 0;

    // Term matching
    for (const term of searchTerms) {
      const termLower = term.toLowerCase();
      if (title.includes(termLower)) {
        matchTerms.push(`title:${term}`);
        relevanceScore += 3;  // Title matches are strong
      } else if (abstract.includes(termLower)) {
        matchTerms.push(`abstract:${term}`);
        relevanceScore += 1;
      }
    }

    // CPC matching
    for (const prefix of cpcPrefixes) {
      for (const cpc of cpcCodes) {
        if (cpc.startsWith(prefix)) {
          matchTerms.push(`cpc:${cpc}`);
          relevanceScore += 5;  // CPC matches are very strong
          matchType = 'cpc';
        }
      }
    }

    if (matchTerms.length > 0 && !matchType) {
      matchType = 'term';
    }

    // Boost for competitor citations
    const cc = patent.competitor_citations || 0;
    if (cc > 0) relevanceScore += Math.min(cc, 10);

    if (matchTerms.length >= 2 || relevanceScore >= 5) {
      candidates.push({
        patent_id: patent.patent_id,
        title: patent.title || '',
        remaining_years: patent.remaining_years || 0,
        competitor_citations: cc,
        current_sector: currentSector,
        match_type: matchType,
        match_terms: matchTerms.slice(0, 5),  // Limit to top 5
        relevance_score: relevanceScore
      });
    }
  }

  // Sort by relevance score
  candidates.sort((a, b) => b.relevance_score - a.relevance_score);

  console.log(`Found ${candidates.length} expansion candidates`);
  console.log('');

  // Group by current sector
  const bySector = new Map<string, SearchResult[]>();
  for (const c of candidates) {
    if (!bySector.has(c.current_sector)) {
      bySector.set(c.current_sector, []);
    }
    bySector.get(c.current_sector)!.push(c);
  }

  console.log('Candidates by current sector:');
  for (const [sector, patents] of [...bySector.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${sector}: ${patents.length}`);
  }
  console.log('');

  // Show top candidates
  console.log('TOP 50 EXPANSION CANDIDATES:');
  console.log('-'.repeat(70));

  for (const c of candidates.slice(0, 50)) {
    console.log(`${c.patent_id} [score=${c.relevance_score}] yrs=${c.remaining_years.toFixed(1)} cc=${c.competitor_citations}`);
    console.log(`  Current: ${c.current_sector} | Match: ${c.match_type}`);
    console.log(`  Title: ${c.title.substring(0, 60)}...`);
    console.log(`  Terms: ${c.match_terms.join(', ')}`);
    console.log('');
  }

  // Save full results
  const outputPath = `output/sector-expansion-${targetSector}-${new Date().toISOString().split('T')[0]}.json`;
  const output = {
    generatedAt: new Date().toISOString(),
    targetSector,
    searchTerms,
    cpcPrefixes,
    currentSectorSize: currentInSector.length,
    currentActiveSize: currentActive.length,
    candidatesFound: candidates.length,
    candidates: candidates.slice(0, 200)  // Top 200
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Full results saved to: ${outputPath}`);

  // Summary
  console.log('');
  console.log('='.repeat(70));
  console.log('EXPANSION SUMMARY');
  console.log('='.repeat(70));
  console.log(`Current ${targetSector} active patents: ${currentActive.length}`);
  console.log(`Expansion candidates found: ${candidates.length}`);
  console.log(`Potential new sector size: ${currentActive.length + candidates.length} active patents`);
  console.log('');

  if (!dryRun && candidates.length > 0) {
    console.log('To apply expansion, review candidates and update sector assignments.');
    console.log('Run with --dry-run to preview without saving.');
  }
}

main().catch(console.error);
