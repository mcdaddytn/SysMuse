#!/usr/bin/env npx tsx
/**
 * Video-Codec Sector Expansion - Refined Search
 *
 * Searches for video codec patents using precise term matching
 * to avoid false positives from short acronyms.
 *
 * Usage: npx tsx scripts/expand-video-codec.ts
 */

import * as fs from 'fs';

// Highly specific video codec terms (multi-word or unambiguous)
const HIGH_CONFIDENCE_TERMS = [
  // Compression fundamentals
  'macroblock',
  'intra prediction', 'inter prediction', 'intra-prediction', 'inter-prediction',
  'intra frame', 'inter frame', 'intra-frame', 'inter-frame',
  'motion vector', 'motion compensation', 'motion estimation',
  'block matching', 'block-matching',
  'entropy coding', 'entropy encoder', 'entropy decoder',
  'CABAC', 'CAVLC',
  'arithmetic coding', 'context adaptive',
  'transform coefficient', 'DCT coefficient',
  'discrete cosine transform',
  'quantization matrix', 'quantization parameter',
  'rate control', 'bitrate control',
  'loop filter', 'deblocking filter', 'in-loop filter',
  'sample adaptive offset',

  // Standards (unambiguous)
  'H.264', 'H264', 'AVC codec', 'advanced video coding',
  'H.265', 'H265', 'HEVC', 'high efficiency video',
  'H.266', 'VVC', 'versatile video coding',
  'AV1 codec', 'AOMedia',
  'VP9', 'VP8',
  'MPEG-2 video', 'MPEG-4 video', 'MPEG video',

  // Components
  'video encoder', 'video decoder', 'video codec',
  'transcoder', 'transcoding',
  'bitstream parser', 'bitstream syntax',
  'NAL unit', 'network abstraction layer',
  'slice header', 'picture parameter set', 'sequence parameter set',

  // Specific techniques
  'bi-prediction', 'bi-directional prediction',
  'B-frame', 'P-frame', 'I-frame',
  'reference frame', 'reference picture',
  'coding tree unit', 'coding unit', 'prediction unit', 'transform unit',
  'affine motion', 'merge mode', 'skip mode', 'direct mode',
  'scalable video coding', 'multi-view coding', 'multiview video',
  '3D video coding'
];

// CPC codes specific to video coding
const VIDEO_CPC_PREFIXES = [
  'H04N19',  // Video coding (main class)
  'H04N21/2343', // Transform coding
  'H04N21/2368', // Filtering
  'H04N21/4402', // Encoding parameters
  'H04N21/234'   // Video coding
];

interface Patent {
  patent_id: string;
  title: string;
  abstract?: string;
  remaining_years?: number;
  competitor_citations?: number;
  cpc_codes?: string[];
}

interface Match {
  patent_id: string;
  title: string;
  abstract: string;
  remaining_years: number;
  competitor_citations: number;
  current_sector: string;
  matched_terms: string[];
  matched_cpc: string[];
  score: number;
}

async function main() {
  console.log('='.repeat(70));
  console.log('VIDEO-CODEC SECTOR EXPANSION - REFINED SEARCH');
  console.log('='.repeat(70));
  console.log(`High-confidence terms: ${HIGH_CONFIDENCE_TERMS.length}`);
  console.log(`Video CPC prefixes: ${VIDEO_CPC_PREFIXES.length}`);
  console.log('');

  // Load patent data
  const msaFile = fs.readdirSync('output')
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort().reverse()[0];

  const msa = JSON.parse(fs.readFileSync(`output/${msaFile}`, 'utf-8'));
  console.log(`Loaded ${msa.patents.length} patents`);

  // Load sector assignments
  const secFile = fs.readdirSync('output/sectors')
    .filter(f => f.startsWith('all-patents-sectors-v2') && f.endsWith('.json'))
    .sort().reverse()[0];

  const sectorMap = new Map<string, string>();
  const secData = JSON.parse(fs.readFileSync(`output/sectors/${secFile}`, 'utf-8'));
  secData.assignments.forEach((a: any) => sectorMap.set(a.patent_id, a.sector));

  // Current video-codec patents
  const currentVideoCodec = msa.patents.filter((p: Patent) =>
    sectorMap.get(p.patent_id) === 'video-codec'
  );
  const currentActive = currentVideoCodec.filter((p: Patent) =>
    (p.remaining_years || 0) >= 3
  );

  console.log(`Current video-codec: ${currentVideoCodec.length} total, ${currentActive.length} active`);
  console.log('');

  // Search for candidates
  const candidates: Match[] = [];

  for (const patent of msa.patents as Patent[]) {
    const currentSector = sectorMap.get(patent.patent_id) || 'unassigned';

    // Skip if already video-codec
    if (currentSector === 'video-codec') continue;

    // Skip if expired
    if ((patent.remaining_years || 0) < 3) continue;

    const title = (patent.title || '').toLowerCase();
    const abstract = (patent.abstract || '').toLowerCase();
    const text = title + ' ' + abstract;
    const cpcCodes = patent.cpc_codes || [];

    const matchedTerms: string[] = [];
    const matchedCpc: string[] = [];
    let score = 0;

    // Check high-confidence terms
    for (const term of HIGH_CONFIDENCE_TERMS) {
      const termLower = term.toLowerCase();
      // Use word boundary matching for short terms
      const regex = term.length <= 4
        ? new RegExp(`\\b${termLower}\\b`, 'i')
        : new RegExp(termLower, 'i');

      if (regex.test(title)) {
        matchedTerms.push(`title:${term}`);
        score += 5;  // Strong: in title
      } else if (regex.test(abstract)) {
        matchedTerms.push(`abstract:${term}`);
        score += 2;  // Medium: in abstract
      }
    }

    // Check CPC codes
    for (const prefix of VIDEO_CPC_PREFIXES) {
      for (const cpc of cpcCodes) {
        if (cpc.startsWith(prefix)) {
          matchedCpc.push(cpc);
          score += 10;  // Very strong: CPC match
        }
      }
    }

    // Boost for competitor citations
    const cc = patent.competitor_citations || 0;
    if (cc > 0) score += Math.min(cc * 0.5, 10);

    // Require meaningful matches
    if (score >= 5 && (matchedTerms.length >= 1 || matchedCpc.length >= 1)) {
      candidates.push({
        patent_id: patent.patent_id,
        title: patent.title || '',
        abstract: (patent.abstract || '').substring(0, 200),
        remaining_years: patent.remaining_years || 0,
        competitor_citations: cc,
        current_sector: currentSector,
        matched_terms: matchedTerms,
        matched_cpc: matchedCpc,
        score
      });
    }
  }

  // Sort by score
  candidates.sort((a, b) => b.score - a.score);

  console.log(`Found ${candidates.length} refined expansion candidates`);
  console.log('');

  // Categorize by match quality
  const highConfidence = candidates.filter(c => c.score >= 15 || c.matched_cpc.length > 0);
  const mediumConfidence = candidates.filter(c => c.score >= 8 && c.score < 15 && c.matched_cpc.length === 0);
  const lowConfidence = candidates.filter(c => c.score >= 5 && c.score < 8 && c.matched_cpc.length === 0);

  console.log('CANDIDATE QUALITY BREAKDOWN:');
  console.log(`  High confidence (CPC match or score>=15): ${highConfidence.length}`);
  console.log(`  Medium confidence (score 8-14): ${mediumConfidence.length}`);
  console.log(`  Low confidence (score 5-7): ${lowConfidence.length}`);
  console.log('');

  // Show high confidence candidates
  console.log('HIGH CONFIDENCE CANDIDATES (recommend adding):');
  console.log('-'.repeat(70));

  for (const c of highConfidence.slice(0, 30)) {
    console.log(`${c.patent_id} [score=${c.score}] yrs=${c.remaining_years.toFixed(1)} cc=${c.competitor_citations}`);
    console.log(`  Current: ${c.current_sector}`);
    console.log(`  Title: ${c.title.substring(0, 65)}`);
    if (c.matched_cpc.length > 0) {
      console.log(`  CPC: ${c.matched_cpc.join(', ')}`);
    }
    console.log(`  Terms: ${c.matched_terms.slice(0, 4).join(', ')}`);
    console.log('');
  }

  // Show medium confidence
  console.log('');
  console.log('MEDIUM CONFIDENCE CANDIDATES (review needed):');
  console.log('-'.repeat(70));

  for (const c of mediumConfidence.slice(0, 20)) {
    console.log(`${c.patent_id} [score=${c.score}] yrs=${c.remaining_years.toFixed(1)} cc=${c.competitor_citations}`);
    console.log(`  Current: ${c.current_sector} | Title: ${c.title.substring(0, 50)}`);
    console.log(`  Terms: ${c.matched_terms.slice(0, 3).join(', ')}`);
    console.log('');
  }

  // Save results
  const output = {
    generatedAt: new Date().toISOString(),
    currentSectorSize: {
      total: currentVideoCodec.length,
      active: currentActive.length
    },
    candidateCounts: {
      highConfidence: highConfidence.length,
      mediumConfidence: mediumConfidence.length,
      lowConfidence: lowConfidence.length,
      total: candidates.length
    },
    highConfidenceCandidates: highConfidence,
    mediumConfidenceCandidates: mediumConfidence,
    lowConfidenceCandidates: lowConfidence.slice(0, 50)
  };

  const outputPath = `output/video-codec-expansion-refined-${new Date().toISOString().split('T')[0]}.json`;
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Summary
  console.log('');
  console.log('='.repeat(70));
  console.log('EXPANSION RECOMMENDATION');
  console.log('='.repeat(70));
  console.log(`Current video-codec active: ${currentActive.length}`);
  console.log(`High confidence additions: +${highConfidence.length}`);
  console.log(`Potential new size: ${currentActive.length + highConfidence.length} active patents`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Review high-confidence candidates above');
  console.log('2. If acceptable, update sector assignments');
  console.log('3. Run sector-specific LLM questions on expanded sector');
}

main().catch(console.error);
