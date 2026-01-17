/**
 * Calculate Unified Top 250 Patents
 *
 * Combines all available data sources:
 * - Citation overlap (competitor citations, forward citations)
 * - LLM v1 analysis (eligibility, validity, claim breadth, enforcement)
 * - V3 LLM analysis (market relevance, evidence accessibility, standards, etc.)
 * - IPR risk (score 5=no IPR, 1=claims invalidated)
 * - Prosecution history (score 5=clean, 1=difficult)
 * - Sector assignments
 *
 * Uses three profiles (aggressive, moderate, conservative) equally weighted.
 */

import * as fs from 'fs';

interface PatentData {
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;
  forward_citations: number;
  years_remaining: number;
  competitor_citations: number;
  competitors: string[];
  competitor_count: number;

  // LLM v1 scores (1-5)
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  confidence?: number;

  // V3 LLM signals
  market_relevance_score?: number;
  trend_alignment_score?: number;
  evidence_accessibility_score?: number;
  investigation_priority_score?: number;
  implementation_type?: string;
  standards_relevance?: string;
  market_segment?: string;
  lifecycle_stage?: string;
  claim_type_primary?: string;

  // IPR & Prosecution
  ipr_risk_score?: number;  // 5=no IPR, 1=invalid
  prosecution_quality_score?: number;  // 5=clean, 1=difficult

  // Sector
  sector?: string;
  sector_name?: string;
  sector_source?: 'term' | 'mlt' | 'cpc' | 'none';

  // Calculated scores
  score_aggressive?: number;
  score_moderate?: number;
  score_conservative?: number;
  score_unified?: number;
}

function loadMultiScoreAnalysis(): Map<string, any> {
  const files = fs.readdirSync('./output')
    .filter(f => f.startsWith('multi-score-analysis-') && f.endsWith('.json'))
    .sort().reverse();

  if (files.length === 0) return new Map();

  const data = JSON.parse(fs.readFileSync(`./output/${files[0]}`, 'utf-8'));
  const map = new Map<string, any>();
  for (const p of data.patents || []) {
    map.set(p.patent_id, p);
  }
  console.log(`Loaded ${map.size} patents from multi-score analysis`);
  return map;
}

function loadLLMAnalysis(): Map<string, any> {
  // Load combined rankings (v1 LLM)
  const combinedFiles = fs.readdirSync('./output/llm-analysis/combined')
    .filter(f => f.startsWith('combined-rankings-') && f.endsWith('.json'))
    .sort().reverse();

  const map = new Map<string, any>();

  if (combinedFiles.length > 0) {
    const data = JSON.parse(fs.readFileSync(`./output/llm-analysis/combined/${combinedFiles[0]}`, 'utf-8'));
    for (const record of data.data?.records || []) {
      map.set(record.patent_id, record.llm_analysis);
    }
    console.log(`Loaded ${map.size} patents from LLM v1 analysis`);
  }

  return map;
}

function loadV3LLMAnalysis(): Map<string, any> {
  const v3File = './output/llm-analysis-v3/combined-v3-2026-01-17.json';
  const map = new Map<string, any>();

  if (fs.existsSync(v3File)) {
    const data = JSON.parse(fs.readFileSync(v3File, 'utf-8'));
    for (const analysis of data.analyses || []) {
      map.set(analysis.patent_id, analysis);
    }
    console.log(`Loaded ${map.size} patents from LLM v3 analysis`);
  }

  return map;
}

function loadIPRData(): Map<string, any> {
  const iprFile = './output/ipr/ipr-risk-check-2026-01-17.json';
  const map = new Map<string, any>();

  if (fs.existsSync(iprFile)) {
    const data = JSON.parse(fs.readFileSync(iprFile, 'utf-8'));
    for (const result of data.results || []) {
      map.set(result.patent_id, result);
    }
    console.log(`Loaded ${map.size} patents from IPR analysis`);
  }

  return map;
}

function loadProsecutionData(): Map<string, any> {
  const prosFile = './output/prosecution/prosecution-history-2026-01-17.json';
  const map = new Map<string, any>();

  if (fs.existsSync(prosFile)) {
    const data = JSON.parse(fs.readFileSync(prosFile, 'utf-8'));
    for (const result of data.results || []) {
      map.set(result.patent_id, result);
    }
    console.log(`Loaded ${map.size} patents from prosecution analysis`);
  }

  return map;
}

function loadSectorData(): Map<string, any> {
  const sectorFile = './output/sectors/all-patents-sectors-2026-01-17.json';
  const map = new Map<string, any>();

  if (fs.existsSync(sectorFile)) {
    const data = JSON.parse(fs.readFileSync(sectorFile, 'utf-8'));
    for (const assignment of data.assignments || []) {
      map.set(assignment.patent_id, assignment);
    }
    console.log(`Loaded ${map.size} patents from sector assignments`);
  }

  // Also load MLT expansions
  const mltFile = './output/sectors/mlt-expanded-sectors-2026-01-17.json';
  if (fs.existsSync(mltFile)) {
    const data = JSON.parse(fs.readFileSync(mltFile, 'utf-8'));
    for (const assignment of data.assignments || []) {
      if (assignment.sector_source === 'mlt') {
        const existing = map.get(assignment.patent_id);
        if (existing) {
          existing.final_sector = assignment.mlt_sector;
          existing.final_sector_name = assignment.mlt_sector_name;
          existing.sector_source = 'mlt';
        }
      }
    }
    console.log(`Applied MLT sector expansions`);
  }

  return map;
}

// Normalization functions
function normalize(value: number | undefined, max: number, sqrtScale: boolean = false): number {
  if (value === undefined || value === null) return 0;
  if (sqrtScale) {
    return Math.min(1, Math.sqrt(value) / Math.sqrt(max));
  }
  return Math.min(1, value / max);
}

function normalizeScore(value: number | undefined): number {
  if (value === undefined || value === null) return 0.5;  // Default to middle
  return value / 5;
}

// Weight profiles
const PROFILES = {
  aggressive: {
    name: 'Aggressive',
    description: 'High weight on market opportunity and competitor citations',
    weights: {
      competitor_citations: 0.25,
      competitor_count: 0.10,
      forward_citations: 0.05,
      years_remaining: 0.10,
      eligibility_score: 0.10,
      validity_score: 0.10,
      claim_breadth: 0.10,
      enforcement_clarity: 0.05,
      market_relevance_score: 0.10,
      ipr_risk_score: 0.025,
      prosecution_quality_score: 0.025,
    }
  },
  moderate: {
    name: 'Moderate',
    description: 'Balanced across all factors',
    weights: {
      competitor_citations: 0.15,
      competitor_count: 0.05,
      forward_citations: 0.10,
      years_remaining: 0.15,
      eligibility_score: 0.15,
      validity_score: 0.15,
      claim_breadth: 0.05,
      enforcement_clarity: 0.10,
      market_relevance_score: 0.05,
      ipr_risk_score: 0.025,
      prosecution_quality_score: 0.025,
    }
  },
  conservative: {
    name: 'Conservative',
    description: 'High weight on legal strength and low risk',
    weights: {
      competitor_citations: 0.10,
      competitor_count: 0.05,
      forward_citations: 0.05,
      years_remaining: 0.15,
      eligibility_score: 0.20,
      validity_score: 0.20,
      claim_breadth: 0.05,
      enforcement_clarity: 0.10,
      market_relevance_score: 0.00,
      ipr_risk_score: 0.05,
      prosecution_quality_score: 0.05,
    }
  }
};

function calculateScore(patent: PatentData, weights: Record<string, number>): number {
  let score = 0;
  let weightSum = 0;

  // Quantitative metrics
  if (weights.competitor_citations) {
    const norm = normalize(patent.competitor_citations, 50);
    score += weights.competitor_citations * norm;
    weightSum += weights.competitor_citations;
  }

  if (weights.competitor_count) {
    const norm = normalize(patent.competitor_count, 10);
    score += weights.competitor_count * norm;
    weightSum += weights.competitor_count;
  }

  if (weights.forward_citations) {
    const norm = normalize(patent.forward_citations, 500, true);
    score += weights.forward_citations * norm;
    weightSum += weights.forward_citations;
  }

  if (weights.years_remaining) {
    const norm = normalize(patent.years_remaining, 15);
    score += weights.years_remaining * norm;
    weightSum += weights.years_remaining;
  }

  // LLM v1 scores
  if (weights.eligibility_score && patent.eligibility_score !== undefined) {
    score += weights.eligibility_score * normalizeScore(patent.eligibility_score);
    weightSum += weights.eligibility_score;
  }

  if (weights.validity_score && patent.validity_score !== undefined) {
    score += weights.validity_score * normalizeScore(patent.validity_score);
    weightSum += weights.validity_score;
  }

  if (weights.claim_breadth && patent.claim_breadth !== undefined) {
    score += weights.claim_breadth * normalizeScore(patent.claim_breadth);
    weightSum += weights.claim_breadth;
  }

  if (weights.enforcement_clarity && patent.enforcement_clarity !== undefined) {
    score += weights.enforcement_clarity * normalizeScore(patent.enforcement_clarity);
    weightSum += weights.enforcement_clarity;
  }

  // V3 LLM scores
  if (weights.market_relevance_score && patent.market_relevance_score !== undefined) {
    score += weights.market_relevance_score * normalizeScore(patent.market_relevance_score);
    weightSum += weights.market_relevance_score;
  }

  // IPR & Prosecution (higher = better)
  if (weights.ipr_risk_score && patent.ipr_risk_score !== undefined) {
    score += weights.ipr_risk_score * normalizeScore(patent.ipr_risk_score);
    weightSum += weights.ipr_risk_score;
  }

  if (weights.prosecution_quality_score && patent.prosecution_quality_score !== undefined) {
    score += weights.prosecution_quality_score * normalizeScore(patent.prosecution_quality_score);
    weightSum += weights.prosecution_quality_score;
  }

  // Normalize by actual weight sum (handles missing data)
  return weightSum > 0 ? (score / weightSum) * 100 : 0;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Unified Top 250 Patent Calculation');
  console.log('='.repeat(60));
  console.log('');

  // Load all data sources
  const multiScore = loadMultiScoreAnalysis();
  const llmV1 = loadLLMAnalysis();
  const llmV3 = loadV3LLMAnalysis();
  const iprData = loadIPRData();
  const prosData = loadProsecutionData();
  const sectorData = loadSectorData();

  console.log('');

  // Merge all data into unified patent records
  const patents: PatentData[] = [];

  for (const [patentId, ms] of multiScore) {
    const llm1 = llmV1.get(patentId);
    const llm3 = llmV3.get(patentId);
    const ipr = iprData.get(patentId);
    const pros = prosData.get(patentId);
    const sector = sectorData.get(patentId);

    const patent: PatentData = {
      patent_id: patentId,
      title: ms.title || '',
      grant_date: ms.date || '',
      assignee: ms.assignee || '',
      forward_citations: ms.forward_citations || 0,
      years_remaining: ms.remaining_years || 0,
      competitor_citations: ms.competitor_citations || 0,
      competitors: ms.competitors || [],
      competitor_count: ms.competitorCount || (ms.competitors?.length || 0),

      // LLM v1
      eligibility_score: llm1?.eligibility_score || llm3?.eligibility_score,
      validity_score: llm1?.validity_score || llm3?.validity_score,
      claim_breadth: llm1?.claim_breadth || llm3?.claim_breadth,
      enforcement_clarity: llm1?.enforcement_clarity || llm3?.enforcement_clarity,
      design_around_difficulty: llm1?.design_around_difficulty || llm3?.design_around_difficulty,
      confidence: llm1?.confidence || llm3?.confidence,

      // V3 LLM
      market_relevance_score: llm3?.market_relevance_score,
      trend_alignment_score: llm3?.trend_alignment_score,
      evidence_accessibility_score: llm3?.evidence_accessibility_score,
      investigation_priority_score: llm3?.investigation_priority_score,
      implementation_type: llm3?.implementation_type,
      standards_relevance: llm3?.standards_relevance,
      market_segment: llm3?.market_segment,
      lifecycle_stage: llm3?.lifecycle_stage,
      claim_type_primary: llm3?.claim_type_primary,

      // IPR & Prosecution
      ipr_risk_score: ipr?.ipr_risk_score,
      prosecution_quality_score: pros?.prosecution_quality_score,

      // Sector
      sector: sector?.final_sector || sector?.cpc_sector,
      sector_name: sector?.final_sector_name || sector?.cpc_sector_name,
      sector_source: sector?.sector_source,
    };

    // Calculate scores for each profile
    patent.score_aggressive = calculateScore(patent, PROFILES.aggressive.weights);
    patent.score_moderate = calculateScore(patent, PROFILES.moderate.weights);
    patent.score_conservative = calculateScore(patent, PROFILES.conservative.weights);

    // Unified score = average of three profiles
    patent.score_unified = (patent.score_aggressive + patent.score_moderate + patent.score_conservative) / 3;

    patents.push(patent);
  }

  // Sort by unified score
  patents.sort((a, b) => (b.score_unified || 0) - (a.score_unified || 0));

  // Get top 250
  const top250 = patents.slice(0, 250);

  // Compare with current rankings
  console.log('Comparing with current tier-litigation rankings...');
  const currentFiles = fs.readdirSync('./output')
    .filter(f => f.startsWith('tier-litigation-') && f.endsWith('.json'))
    .sort().reverse();

  let currentTop100: string[] = [];
  if (currentFiles.length > 0) {
    const currentData = JSON.parse(fs.readFileSync(`./output/${currentFiles[0]}`, 'utf-8'));
    currentTop100 = currentData.map((p: any) => p.patent_id);
  }

  // Calculate overlap
  const newTop100Ids = top250.slice(0, 100).map(p => p.patent_id);
  const overlap = newTop100Ids.filter(id => currentTop100.includes(id));
  const newEntries = newTop100Ids.filter(id => !currentTop100.includes(id));
  const dropped = currentTop100.filter(id => !newTop100Ids.includes(id));

  console.log(`\nTop 100 comparison:`);
  console.log(`  Current top 100: ${currentTop100.length}`);
  console.log(`  New top 100: ${newTop100Ids.length}`);
  console.log(`  Overlap: ${overlap.length} (${(overlap.length / 100 * 100).toFixed(0)}%)`);
  console.log(`  New entries: ${newEntries.length}`);
  console.log(`  Dropped: ${dropped.length}`);

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];

  const output = {
    generated_at: new Date().toISOString(),
    methodology: {
      profiles: PROFILES,
      unified_score: 'Average of aggressive, moderate, and conservative profiles',
    },
    statistics: {
      total_patents_analyzed: patents.length,
      top_250_count: top250.length,
      patents_with_llm_v1: patents.filter(p => p.eligibility_score !== undefined).length,
      patents_with_llm_v3: patents.filter(p => p.market_relevance_score !== undefined).length,
      patents_with_ipr: patents.filter(p => p.ipr_risk_score !== undefined).length,
      patents_with_prosecution: patents.filter(p => p.prosecution_quality_score !== undefined).length,
    },
    comparison: {
      overlap_with_current_top100: overlap.length,
      new_entries: newEntries,
      dropped: dropped,
    },
    patents: top250,
  };

  fs.writeFileSync(`./output/unified-top250-${timestamp}.json`, JSON.stringify(output, null, 2));
  console.log(`\nSaved: output/unified-top250-${timestamp}.json`);

  // Save CSV
  const csvHeader = [
    'rank', 'patent_id', 'title', 'grant_date', 'assignee',
    'years_remaining', 'forward_citations', 'competitor_citations', 'competitor_count', 'competitors',
    'sector', 'sector_name', 'sector_source',
    'eligibility_score', 'validity_score', 'claim_breadth', 'enforcement_clarity', 'design_around_difficulty',
    'market_relevance_score', 'evidence_accessibility_score', 'trend_alignment_score',
    'implementation_type', 'standards_relevance', 'market_segment', 'lifecycle_stage',
    'ipr_risk_score', 'prosecution_quality_score',
    'score_aggressive', 'score_moderate', 'score_conservative', 'score_unified'
  ].join(',');

  const csvRows = top250.map((p, i) => [
    i + 1,
    p.patent_id,
    `"${(p.title || '').replace(/"/g, '""')}"`,
    p.grant_date,
    `"${(p.assignee || '').replace(/"/g, '""')}"`,
    p.years_remaining?.toFixed(1) || '',
    p.forward_citations || '',
    p.competitor_citations || '',
    p.competitor_count || '',
    `"${(p.competitors || []).join('; ')}"`,
    p.sector || '',
    `"${p.sector_name || ''}"`,
    p.sector_source || '',
    p.eligibility_score || '',
    p.validity_score || '',
    p.claim_breadth || '',
    p.enforcement_clarity || '',
    p.design_around_difficulty || '',
    p.market_relevance_score || '',
    p.evidence_accessibility_score || '',
    p.trend_alignment_score || '',
    p.implementation_type || '',
    p.standards_relevance || '',
    p.market_segment || '',
    p.lifecycle_stage || '',
    p.ipr_risk_score || '',
    p.prosecution_quality_score || '',
    p.score_aggressive?.toFixed(1) || '',
    p.score_moderate?.toFixed(1) || '',
    p.score_conservative?.toFixed(1) || '',
    p.score_unified?.toFixed(1) || ''
  ].join(','));

  fs.writeFileSync(`./output/unified-top250-${timestamp}.csv`, [csvHeader, ...csvRows].join('\n'));
  console.log(`Saved: output/unified-top250-${timestamp}.csv`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('TOP 10 UNIFIED RANKINGS');
  console.log('='.repeat(60));

  for (let i = 0; i < 10; i++) {
    const p = top250[i];
    const llmStatus = p.eligibility_score !== undefined ? '✓ LLM' : '○ LLM';
    const iprStatus = p.ipr_risk_score !== undefined ? '✓ IPR' : '○ IPR';
    console.log(`${i + 1}. ${p.patent_id} - ${p.score_unified?.toFixed(1)} (${llmStatus}, ${iprStatus})`);
    console.log(`   ${p.title.substring(0, 60)}...`);
    console.log(`   Competitors: ${p.competitors?.slice(0, 3).join(', ')} (${p.competitor_citations} cites)`);
  }

  // Data coverage summary
  console.log('\n' + '='.repeat(60));
  console.log('DATA COVERAGE IN TOP 250');
  console.log('='.repeat(60));
  const top250Stats = {
    with_llm: top250.filter(p => p.eligibility_score !== undefined).length,
    with_v3: top250.filter(p => p.market_relevance_score !== undefined).length,
    with_ipr: top250.filter(p => p.ipr_risk_score !== undefined).length,
    with_pros: top250.filter(p => p.prosecution_quality_score !== undefined).length,
    with_sector_term: top250.filter(p => p.sector_source === 'term' || p.sector_source === 'mlt').length,
    with_sector_cpc: top250.filter(p => p.sector_source === 'cpc').length,
  };

  console.log(`LLM v1 analysis: ${top250Stats.with_llm}/250 (${(top250Stats.with_llm / 250 * 100).toFixed(0)}%)`);
  console.log(`LLM v3 analysis: ${top250Stats.with_v3}/250 (${(top250Stats.with_v3 / 250 * 100).toFixed(0)}%)`);
  console.log(`IPR risk data: ${top250Stats.with_ipr}/250 (${(top250Stats.with_ipr / 250 * 100).toFixed(0)}%)`);
  console.log(`Prosecution data: ${top250Stats.with_pros}/250 (${(top250Stats.with_pros / 250 * 100).toFixed(0)}%)`);
  console.log(`Term-based sectors: ${top250Stats.with_sector_term}/250`);
  console.log(`CPC-based sectors: ${top250Stats.with_sector_cpc}/250`);

  // Patents needing enrichment
  const needsLLM = top250.filter(p => p.eligibility_score === undefined).map(p => p.patent_id);
  const needsIPR = top250.filter(p => p.ipr_risk_score === undefined).map(p => p.patent_id);
  const needsPros = top250.filter(p => p.prosecution_quality_score === undefined).map(p => p.patent_id);

  console.log(`\nPatents needing enrichment:`);
  console.log(`  LLM analysis: ${needsLLM.length}`);
  console.log(`  IPR check: ${needsIPR.length}`);
  console.log(`  Prosecution history: ${needsPros.length}`);

  // Save list of patents needing enrichment
  fs.writeFileSync(`./output/top250-needs-llm-${timestamp}.json`, JSON.stringify(needsLLM, null, 2));
  fs.writeFileSync(`./output/top250-needs-ipr-${timestamp}.json`, JSON.stringify(needsIPR, null, 2));
  fs.writeFileSync(`./output/top250-needs-pros-${timestamp}.json`, JSON.stringify(needsPros, null, 2));

  console.log(`\nSaved enrichment lists to output/`);
}

main().catch(console.error);
