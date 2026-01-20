#!/usr/bin/env npx tsx
/**
 * Merge LLM Analyses into Multi-Score Analysis
 *
 * Combines LLM analysis results from multiple sources into the main
 * multi-score-analysis file so they're available for spreadsheet export.
 *
 * Sources:
 *   1. output/llm-analysis-v3/combined-v3-*.json (general LLM analyses)
 *   2. output/vmware-llm-analysis/combined-vmware-llm-*.json (VMware LLM analyses)
 *
 * Usage: npx tsx scripts/merge-llm-into-analysis.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface LLMAnalysis {
  patent_id: string;
  summary?: string;
  prior_art_problem?: string;
  technical_solution?: string;
  eligibility_score?: number;
  validity_score?: number;
  claim_breadth?: number;
  claim_clarity_score?: number;
  enforcement_clarity?: number;
  design_around_difficulty?: number;
  evidence_accessibility_score?: number;
  technology_category?: string;
  product_types?: string[];
  market_relevance_score?: number;
  trend_alignment_score?: number;
  likely_implementers?: string[];
  detection_method?: string;
  investigation_priority_score?: number;
  implementation_type?: string;
  standards_relevance?: string;
  standards_bodies?: string[];
  market_segment?: string;
  implementation_complexity?: string;
  claim_type_primary?: string;
  geographic_scope?: string;
  lifecycle_stage?: string;
  confidence?: number;
  legal_viability_score?: number;
  enforcement_potential_score?: number;
  market_value_score?: number;
}

interface Patent {
  patent_id: string;
  llm_analysis?: LLMAnalysis;
  [key: string]: any;
}

interface MultiScoreAnalysis {
  metadata: any;
  patents: Patent[];
}

function findLatestFile(dir: string, pattern: RegExp): string | null {
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => pattern.test(f))
    .sort()
    .reverse();

  return files.length > 0 ? path.join(dir, files[0]) : null;
}

function loadLLMAnalyses(filePath: string): Map<string, LLMAnalysis> {
  const analyses = new Map<string, LLMAnalysis>();

  if (!fs.existsSync(filePath)) {
    console.log(`  File not found: ${filePath}`);
    return analyses;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  // Handle different file formats
  if (data.analyses && Array.isArray(data.analyses)) {
    // Format: { analyses: [...] }
    for (const analysis of data.analyses) {
      if (analysis.patent_id) {
        // Extract just the LLM fields, not patent metadata
        const llmFields: LLMAnalysis = {
          patent_id: analysis.patent_id,
          summary: analysis.summary,
          prior_art_problem: analysis.prior_art_problem,
          technical_solution: analysis.technical_solution,
          eligibility_score: analysis.eligibility_score,
          validity_score: analysis.validity_score,
          claim_breadth: analysis.claim_breadth,
          claim_clarity_score: analysis.claim_clarity_score,
          enforcement_clarity: analysis.enforcement_clarity,
          design_around_difficulty: analysis.design_around_difficulty,
          evidence_accessibility_score: analysis.evidence_accessibility_score,
          technology_category: analysis.technology_category,
          product_types: analysis.product_types,
          market_relevance_score: analysis.market_relevance_score,
          trend_alignment_score: analysis.trend_alignment_score,
          likely_implementers: analysis.likely_implementers,
          detection_method: analysis.detection_method,
          investigation_priority_score: analysis.investigation_priority_score,
          implementation_type: analysis.implementation_type,
          standards_relevance: analysis.standards_relevance,
          standards_bodies: analysis.standards_bodies,
          market_segment: analysis.market_segment,
          implementation_complexity: analysis.implementation_complexity,
          claim_type_primary: analysis.claim_type_primary,
          geographic_scope: analysis.geographic_scope,
          lifecycle_stage: analysis.lifecycle_stage,
          confidence: analysis.confidence,
          legal_viability_score: analysis.legal_viability_score,
          enforcement_potential_score: analysis.enforcement_potential_score,
          market_value_score: analysis.market_value_score,
        };
        analyses.set(analysis.patent_id, llmFields);
      }
    }
  } else if (typeof data === 'object') {
    // Format: { patent_id: analysis, ... }
    for (const [patentId, analysis] of Object.entries(data)) {
      if (patentId !== 'version' && patentId !== 'generated_at' && patentId !== 'total_patents' && patentId !== 'sources') {
        analyses.set(patentId, analysis as LLMAnalysis);
      }
    }
  }

  return analyses;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('        MERGE LLM ANALYSES INTO MULTI-SCORE-ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find the latest multi-score-analysis file
  const analysisFile = findLatestFile('./output', /multi-score-analysis-\d{4}-\d{2}-\d{2}\.json$/);
  if (!analysisFile) {
    console.error('ERROR: No multi-score-analysis file found');
    process.exit(1);
  }
  console.log(`Loading: ${analysisFile}`);

  const analysis: MultiScoreAnalysis = JSON.parse(fs.readFileSync(analysisFile, 'utf-8'));
  console.log(`  Patents in analysis: ${analysis.patents.length.toLocaleString()}`);

  // Count existing LLM analyses
  const existingLLM = analysis.patents.filter(p => p.llm_analysis).length;
  console.log(`  Existing LLM analyses: ${existingLLM.toLocaleString()}\n`);

  // Load LLM analyses from all sources
  const allLLMAnalyses = new Map<string, LLMAnalysis>();

  // Source 1: V3 combined analyses
  const v3File = findLatestFile('./output/llm-analysis-v3', /combined-v3-.*\.json$/);
  if (v3File) {
    console.log(`Loading V3 analyses: ${v3File}`);
    const v3Analyses = loadLLMAnalyses(v3File);
    console.log(`  Found: ${v3Analyses.size.toLocaleString()} analyses`);
    for (const [id, analysis] of v3Analyses) {
      allLLMAnalyses.set(id, analysis);
    }
  }

  // Source 2: VMware LLM analyses
  const vmwareFile = findLatestFile('./output/vmware-llm-analysis', /combined-vmware-llm-.*\.json$/);
  if (vmwareFile) {
    console.log(`Loading VMware analyses: ${vmwareFile}`);
    const vmwareAnalyses = loadLLMAnalyses(vmwareFile);
    console.log(`  Found: ${vmwareAnalyses.size.toLocaleString()} analyses`);
    for (const [id, analysis] of vmwareAnalyses) {
      if (!allLLMAnalyses.has(id)) {
        allLLMAnalyses.set(id, analysis);
      }
    }
  }

  console.log(`\nTotal unique LLM analyses: ${allLLMAnalyses.size.toLocaleString()}\n`);

  // Merge into analysis
  let merged = 0;
  let alreadyHad = 0;
  let notInAnalysis = 0;

  const patentMap = new Map<string, Patent>();
  for (const patent of analysis.patents) {
    patentMap.set(patent.patent_id, patent);
  }

  for (const [patentId, llmAnalysis] of allLLMAnalyses) {
    const patent = patentMap.get(patentId);
    if (patent) {
      if (!patent.llm_analysis) {
        patent.llm_analysis = llmAnalysis;
        merged++;
      } else {
        alreadyHad++;
      }
    } else {
      notInAnalysis++;
    }
  }

  console.log('MERGE RESULTS:');
  console.log('─'.repeat(50));
  console.log(`  Newly merged:     ${merged.toLocaleString()}`);
  console.log(`  Already had LLM:  ${alreadyHad.toLocaleString()}`);
  console.log(`  Not in analysis:  ${notInAnalysis.toLocaleString()}`);

  // Update metadata
  analysis.metadata.llmMerge = {
    mergedAt: new Date().toISOString(),
    sources: [v3File, vmwareFile].filter(Boolean),
    totalLLMAnalyses: allLLMAnalyses.size,
    mergedCount: merged,
  };

  // Save updated analysis
  const today = new Date().toISOString().split('T')[0];
  const outputFile = `./output/multi-score-analysis-${today}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(analysis, null, 2));

  // Also update LATEST symlink
  const latestFile = './output/multi-score-analysis-LATEST.json';
  if (fs.existsSync(latestFile)) {
    fs.unlinkSync(latestFile);
  }
  fs.copyFileSync(outputFile, latestFile);

  console.log(`\n✓ Saved: ${outputFile}`);
  console.log(`✓ Updated: ${latestFile}`);

  // Final count
  const finalLLM = analysis.patents.filter(p => p.llm_analysis).length;
  console.log(`\nFinal LLM coverage: ${finalLLM.toLocaleString()} / ${analysis.patents.length.toLocaleString()} (${((finalLLM / analysis.patents.length) * 100).toFixed(1)}%)`);

  console.log('\n' + '═'.repeat(60) + '\n');
}

main().catch(console.error);
