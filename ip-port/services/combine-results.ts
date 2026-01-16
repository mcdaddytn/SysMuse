/**
 * Combine Results Service
 *
 * Merges LLM analysis results with quantitative scoring data
 * to produce unified patent rankings and exports.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PatentAnalysis } from './llm-patent-analysis.js';

const OUTPUT_DIR = './output';
const LLM_OUTPUT_DIR = './output/llm-analysis';
const COMBINED_DIR = './output/llm-analysis/combined';
const EXPORTS_DIR = './output/llm-analysis/exports';

// Combined patent record with all scoring data
interface CombinedPatentRecord {
  // Identifiers
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;

  // Quantitative metrics
  years_remaining: number;
  forward_citations: number;
  competitor_citations: number;
  top_competitors: string;

  // Quantitative scores
  licensing_score: number;
  litigation_score: number;
  strategic_score: number;
  quantitative_overall: number;

  // LLM analysis (if available)
  llm_summary?: string;
  llm_prior_art_problem?: string;
  llm_technical_solution?: string;
  llm_eligibility_score?: number;
  llm_validity_score?: number;
  llm_claim_breadth?: number;
  llm_enforcement_clarity?: number;
  llm_design_around_difficulty?: number;
  llm_confidence?: number;
  llm_quality_score?: number;

  // Final combined scores
  final_score?: number;
  final_rank?: number;
}

// Quantitative data from CSV
interface QuantitativeRecord {
  rank: number;
  patent_id: string;
  title: string;
  grant_date: string;
  assignee: string;
  years_remaining: number;
  forward_citations: number;
  competitor_citations: number;
  top_competitors: string;
  licensing_score: number;
  litigation_score: number;
  strategic_score: number;
  overall_score: number;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      fields.push(current.replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.replace(/^"|"$/g, ''));

  return fields;
}

function loadQuantitativeData(): Map<string, QuantitativeRecord> {
  const csvPath = path.join(OUTPUT_DIR, 'top-250-actionable-2026-01-15.csv');
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header

  const records = new Map<string, QuantitativeRecord>();

  for (const line of lines) {
    const fields = parseCSVLine(line);
    const record: QuantitativeRecord = {
      rank: parseInt(fields[0]),
      patent_id: fields[1],
      title: fields[2],
      grant_date: fields[3],
      assignee: fields[4],
      years_remaining: parseFloat(fields[5]),
      forward_citations: parseInt(fields[6]),
      competitor_citations: parseInt(fields[7]),
      top_competitors: fields[8],
      licensing_score: parseFloat(fields[9]),
      litigation_score: parseFloat(fields[10]),
      strategic_score: parseFloat(fields[11]),
      overall_score: parseFloat(fields[12]),
    };
    records.set(record.patent_id, record);
  }

  return records;
}

function loadLLMAnalyses(): Map<string, PatentAnalysis> {
  const analyses = new Map<string, PatentAnalysis>();
  const batchesDir = path.join(LLM_OUTPUT_DIR, 'batches');

  if (!fs.existsSync(batchesDir)) {
    return analyses;
  }

  const batchFiles = fs.readdirSync(batchesDir).filter(f => f.endsWith('.json'));

  for (const file of batchFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(batchesDir, file), 'utf-8'));
      for (const analysis of data.analyses || []) {
        analyses.set(analysis.patent_id, analysis);
      }
    } catch (error) {
      console.warn(`Warning: Could not load ${file}`);
    }
  }

  return analyses;
}

function calculateLLMQualityScore(analysis: PatentAnalysis): number {
  return (
    analysis.eligibility_score * 0.25 +
    analysis.validity_score * 0.25 +
    analysis.claim_breadth * 0.20 +
    analysis.enforcement_clarity * 0.15 +
    analysis.design_around_difficulty * 0.15
  ) / 5 * 100;
}

function calculateFinalScore(
  quantitative: QuantitativeRecord,
  llmQualityScore?: number
): number {
  // If no LLM score, use quantitative only
  if (llmQualityScore === undefined) {
    return quantitative.overall_score;
  }

  // Weighted combination
  const termFactor = Math.min(1, quantitative.years_remaining / 15) * 100;

  return (
    quantitative.overall_score * 0.50 +
    llmQualityScore * 0.30 +
    termFactor * 0.20
  );
}

export function combineResults(): CombinedPatentRecord[] {
  console.log('Loading quantitative data...');
  const quantitative = loadQuantitativeData();
  console.log(`  Loaded ${quantitative.size} patents`);

  console.log('Loading LLM analyses...');
  const llmAnalyses = loadLLMAnalyses();
  console.log(`  Loaded ${llmAnalyses.size} LLM analyses`);

  // Combine data
  const combined: CombinedPatentRecord[] = [];

  for (const [patentId, quant] of quantitative) {
    const llm = llmAnalyses.get(patentId);
    const llmQualityScore = llm ? calculateLLMQualityScore(llm) : undefined;

    const record: CombinedPatentRecord = {
      // Identifiers
      patent_id: patentId,
      title: quant.title,
      grant_date: quant.grant_date,
      assignee: quant.assignee,

      // Quantitative metrics
      years_remaining: quant.years_remaining,
      forward_citations: quant.forward_citations,
      competitor_citations: quant.competitor_citations,
      top_competitors: quant.top_competitors,

      // Quantitative scores
      licensing_score: quant.licensing_score,
      litigation_score: quant.litigation_score,
      strategic_score: quant.strategic_score,
      quantitative_overall: quant.overall_score,

      // LLM analysis
      ...(llm && {
        llm_summary: llm.summary,
        llm_prior_art_problem: llm.prior_art_problem,
        llm_technical_solution: llm.technical_solution,
        llm_eligibility_score: llm.eligibility_score,
        llm_validity_score: llm.validity_score,
        llm_claim_breadth: llm.claim_breadth,
        llm_enforcement_clarity: llm.enforcement_clarity,
        llm_design_around_difficulty: llm.design_around_difficulty,
        llm_confidence: llm.confidence,
        llm_quality_score: llmQualityScore,
      }),

      // Final score
      final_score: calculateFinalScore(quant, llmQualityScore),
    };

    combined.push(record);
  }

  // Sort by final score and assign ranks
  combined.sort((a, b) => (b.final_score || 0) - (a.final_score || 0));
  combined.forEach((record, index) => {
    record.final_rank = index + 1;
  });

  return combined;
}

export function exportToCSV(records: CombinedPatentRecord[], filename: string): void {
  const headers = [
    'Final Rank',
    'Patent ID',
    'Title',
    'Grant Date',
    'Assignee',
    'Years Remaining',
    'Forward Citations',
    'Competitor Citations',
    'Top Competitors',
    'Licensing Score',
    'Litigation Score',
    'Strategic Score',
    'Quantitative Overall',
    'LLM Eligibility',
    'LLM Validity',
    'LLM Claim Breadth',
    'LLM Enforcement',
    'LLM Design-Around',
    'LLM Confidence',
    'LLM Quality Score',
    'Final Score',
  ];

  const rows = records.map(r => [
    r.final_rank,
    r.patent_id,
    `"${r.title.replace(/"/g, '""')}"`,
    r.grant_date,
    `"${r.assignee.replace(/"/g, '""')}"`,
    r.years_remaining.toFixed(1),
    r.forward_citations,
    r.competitor_citations,
    `"${r.top_competitors}"`,
    r.licensing_score.toFixed(1),
    r.litigation_score.toFixed(1),
    r.strategic_score.toFixed(1),
    r.quantitative_overall.toFixed(1),
    r.llm_eligibility_score ?? '',
    r.llm_validity_score ?? '',
    r.llm_claim_breadth ?? '',
    r.llm_enforcement_clarity ?? '',
    r.llm_design_around_difficulty ?? '',
    r.llm_confidence ?? '',
    r.llm_quality_score?.toFixed(1) ?? '',
    r.final_score?.toFixed(1) ?? '',
  ].join(','));

  const csv = [headers.join(','), ...rows].join('\n');

  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  const filepath = path.join(EXPORTS_DIR, filename);
  fs.writeFileSync(filepath, csv);
  console.log(`Exported CSV: ${filepath}`);
}

export function exportToJSON(records: CombinedPatentRecord[], filename: string): void {
  if (!fs.existsSync(COMBINED_DIR)) {
    fs.mkdirSync(COMBINED_DIR, { recursive: true });
  }

  const filepath = path.join(COMBINED_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify({
    generated: new Date().toISOString(),
    totalRecords: records.length,
    recordsWithLLM: records.filter(r => r.llm_quality_score !== undefined).length,
    records,
  }, null, 2));
  console.log(`Exported JSON: ${filepath}`);
}

export function exportToText(records: CombinedPatentRecord[], directory: string): void {
  const exportDir = path.join(EXPORTS_DIR, directory);
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  for (const record of records) {
    const lines = [
      '═'.repeat(70),
      `PATENT ANALYSIS: US${record.patent_id}`,
      '═'.repeat(70),
      '',
      `Patent Number:     US${record.patent_id}`,
      `Title:             ${record.title}`,
      `Grant Date:        ${record.grant_date}`,
      `Assignee:          ${record.assignee}`,
      '',
      '─'.repeat(70),
      'FINAL RANKING',
      '─'.repeat(70),
      '',
      `Final Rank:        #${record.final_rank} of ${records.length}`,
      `Final Score:       ${record.final_score?.toFixed(1)}`,
      '',
      '─'.repeat(70),
      'QUANTITATIVE METRICS',
      '─'.repeat(70),
      '',
      `Years Remaining:   ${record.years_remaining.toFixed(1)}`,
      `Forward Citations: ${record.forward_citations}`,
      `Competitor Cites:  ${record.competitor_citations}`,
      `Top Competitors:   ${record.top_competitors || 'N/A'}`,
      '',
      `Licensing Score:   ${record.licensing_score.toFixed(1)}`,
      `Litigation Score:  ${record.litigation_score.toFixed(1)}`,
      `Strategic Score:   ${record.strategic_score.toFixed(1)}`,
      `Quantitative:      ${record.quantitative_overall.toFixed(1)}`,
      '',
    ];

    if (record.llm_quality_score !== undefined) {
      lines.push(
        '─'.repeat(70),
        'LLM ANALYSIS',
        '─'.repeat(70),
        '',
        `Eligibility (101): ${record.llm_eligibility_score}/5`,
        `Validity Score:    ${record.llm_validity_score}/5`,
        `Claim Breadth:     ${record.llm_claim_breadth}/5`,
        `Enforcement:       ${record.llm_enforcement_clarity}/5`,
        `Design-Around:     ${record.llm_design_around_difficulty}/5`,
        `Confidence:        ${record.llm_confidence}/5`,
        `LLM Quality:       ${record.llm_quality_score.toFixed(1)}`,
        '',
        '─'.repeat(70),
        'SUMMARY',
        '─'.repeat(70),
        '',
        record.llm_summary || '',
        '',
        '─'.repeat(70),
        'PRIOR ART PROBLEM',
        '─'.repeat(70),
        '',
        record.llm_prior_art_problem || '',
        '',
        '─'.repeat(70),
        'TECHNICAL SOLUTION',
        '─'.repeat(70),
        '',
        record.llm_technical_solution || '',
        ''
      );
    }

    lines.push(
      '═'.repeat(70),
      'END OF PATENT ANALYSIS',
      '═'.repeat(70),
      ''
    );

    const filepath = path.join(exportDir, `US${record.patent_id}.txt`);
    fs.writeFileSync(filepath, lines.join('\n'));
  }

  console.log(`Exported ${records.length} text files to: ${exportDir}`);
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  COMBINE RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  switch (command) {
    case 'combine': {
      const combined = combineResults();

      const withLLM = combined.filter(r => r.llm_quality_score !== undefined).length;
      console.log(`\nCombined ${combined.length} patents (${withLLM} with LLM analysis)`);

      // Show top 10
      console.log('\nTop 10 by Final Score:');
      for (const r of combined.slice(0, 10)) {
        const llmStatus = r.llm_quality_score !== undefined ? `LLM: ${r.llm_quality_score.toFixed(1)}` : 'No LLM';
        console.log(`  #${r.final_rank}: ${r.patent_id} - ${r.final_score?.toFixed(1)} (${llmStatus})`);
      }
      break;
    }

    case 'export': {
      const format = args[1] || 'all';
      const dateStr = new Date().toISOString().split('T')[0];

      const combined = combineResults();

      if (format === 'csv' || format === 'all') {
        exportToCSV(combined, `combined-rankings-${dateStr}.csv`);
      }

      if (format === 'json' || format === 'all') {
        exportToJSON(combined, `combined-rankings-${dateStr}.json`);
      }

      if (format === 'text' || format === 'all') {
        exportToText(combined, `patent-summaries-${dateStr}`);
      }

      console.log('\n✓ Export complete');
      break;
    }

    case 'status': {
      console.log('Checking data status...\n');

      const quantitative = loadQuantitativeData();
      console.log(`Quantitative records: ${quantitative.size}`);

      const llmAnalyses = loadLLMAnalyses();
      console.log(`LLM analyses: ${llmAnalyses.size}`);

      const coverage = (llmAnalyses.size / quantitative.size * 100).toFixed(1);
      console.log(`Coverage: ${coverage}%`);

      if (llmAnalyses.size > 0) {
        console.log('\nLLM-analyzed patents:');
        let count = 0;
        for (const [id] of llmAnalyses) {
          if (count++ >= 10) {
            console.log(`  ... and ${llmAnalyses.size - 10} more`);
            break;
          }
          console.log(`  ${id}`);
        }
      }
      break;
    }

    default:
      console.log(`
Combine Results CLI

Commands:
  status              Show data status (quantitative + LLM coverage)
  combine             Combine data and show top rankings
  export [format]     Export combined results (csv, json, text, or all)

Examples:
  npx tsx services/combine-results.ts status
  npx tsx services/combine-results.ts combine
  npx tsx services/combine-results.ts export csv
  npx tsx services/combine-results.ts export all
      `);
  }
}

// Run if executed directly
if (process.argv[1]?.includes('combine-results')) {
  main().catch(console.error);
}
