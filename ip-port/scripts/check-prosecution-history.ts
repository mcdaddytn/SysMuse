/**
 * Prosecution History Check Script
 *
 * Retrieves prosecution history data from USPTO File Wrapper API.
 * Analyzes prosecution quality signals for patent valuation.
 *
 * Output: Prosecution history data including:
 * - Office action count
 * - Rejections overcome
 * - Claim amendments
 * - Continuation/divisional count
 * - Time to grant
 * - Prosecution quality score (1-5: 5=clean, 1=difficult prosecution)
 *
 * Usage:
 *   npx tsx scripts/check-prosecution-history.ts [patent-ids-file] [--top N] [--skip-existing]
 *   npx tsx scripts/check-prosecution-history.ts --sector cloud-auth
 *   npx tsx scripts/check-prosecution-history.ts --top 50 --skip-existing
 *
 * Note: File Wrapper API only has applications from 2001+
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { FileWrapperClient, PatentFileWrapperRecord } from '../clients/odp-file-wrapper-client.js';

dotenv.config();

const apiKey = process.env.USPTO_ODP_API_KEY;
const PROSECUTION_CACHE_DIR = path.join(process.cwd(), 'cache/prosecution-scores');

interface ProsecutionHistoryData {
  patent_id: string;
  application_number: string | null;
  filing_date: string | null;
  grant_date: string | null;
  time_to_grant_months: number | null;
  office_actions_count: number;
  non_final_rejections: number;
  final_rejections: number;
  allowances: number;
  applicant_responses: number;
  rce_count: number;
  continuation_count: number;
  divisional_count: number;
  total_documents: number;
  prosecution_quality_score: number;
  prosecution_quality_category: 'clean' | 'smooth' | 'moderate' | 'difficult' | 'very_difficult' | 'no_data';
  key_events: ProsecutionEvent[];
  error: string | null;
}

interface ProsecutionEvent {
  date: string | null;
  code: string;
  description: string;
  type: 'office_action' | 'response' | 'allowance' | 'rejection' | 'other';
}

function calculateProsecutionScore(data: ProsecutionHistoryData): { score: number; category: ProsecutionHistoryData['prosecution_quality_category'] } {
  // No data available
  if (data.error || data.application_number === null) {
    return { score: 3, category: 'no_data' };
  }

  // Calculate score based on prosecution signals
  let score = 5; // Start with perfect score

  // Deduct for office actions
  if (data.non_final_rejections > 0) {
    score -= Math.min(data.non_final_rejections * 0.5, 1.5);
  }
  if (data.final_rejections > 0) {
    score -= Math.min(data.final_rejections * 0.75, 1.5);
  }

  // Deduct for RCEs (significant prosecution difficulty)
  if (data.rce_count > 0) {
    score -= Math.min(data.rce_count * 0.5, 1.0);
  }

  // Deduct for very long prosecution
  if (data.time_to_grant_months) {
    if (data.time_to_grant_months > 60) { // > 5 years
      score -= 0.5;
    } else if (data.time_to_grant_months > 48) { // > 4 years
      score -= 0.25;
    }
  }

  // Bonus for continuation families (shows patent family value)
  if (data.continuation_count > 0 || data.divisional_count > 0) {
    // This is actually a positive signal - company invested in family
    // But for prosecution quality, we keep it neutral
  }

  // Ensure score is within 1-5 range
  score = Math.max(1, Math.min(5, score));
  score = Math.round(score * 10) / 10; // Round to 1 decimal

  // Determine category
  let category: ProsecutionHistoryData['prosecution_quality_category'];
  if (score >= 4.5) {
    category = 'clean';
  } else if (score >= 3.5) {
    category = 'smooth';
  } else if (score >= 2.5) {
    category = 'moderate';
  } else if (score >= 1.5) {
    category = 'difficult';
  } else {
    category = 'very_difficult';
  }

  return { score, category };
}

async function checkProsecutionHistory(client: FileWrapperClient, patentNumber: string): Promise<ProsecutionHistoryData> {
  const result: ProsecutionHistoryData = {
    patent_id: patentNumber,
    application_number: null,
    filing_date: null,
    grant_date: null,
    time_to_grant_months: null,
    office_actions_count: 0,
    non_final_rejections: 0,
    final_rejections: 0,
    allowances: 0,
    applicant_responses: 0,
    rce_count: 0,
    continuation_count: 0,
    divisional_count: 0,
    total_documents: 0,
    prosecution_quality_score: 3,
    prosecution_quality_category: 'no_data',
    key_events: [],
    error: null,
  };

  try {
    // First, find the application by patent number
    console.log(`  Looking up application for patent ${patentNumber}...`);
    const app = await client.getApplicationByPatentNumber(patentNumber);

    if (!app) {
      result.error = 'Application not found (may be pre-2001)';
      return result;
    }

    result.application_number = app.applicationNumberText;
    result.filing_date = app.applicationMetaData?.filingDate || null;

    // Get grant date from metadata
    const grantDate = app.applicationMetaData?.patentGrantDate || null;
    if (grantDate) {
      result.grant_date = grantDate;

      // Calculate time to grant
      if (result.filing_date) {
        const filingMs = new Date(result.filing_date).getTime();
        const grantMs = new Date(grantDate).getTime();
        result.time_to_grant_months = Math.round((grantMs - filingMs) / (1000 * 60 * 60 * 24 * 30));
      }
    }

    // Get continuation/divisional count
    if (app.parentContinuityBag) {
      for (const parent of app.parentContinuityBag) {
        if (parent.relationshipDescription?.toLowerCase().includes('continuation')) {
          result.continuation_count++;
        } else if (parent.relationshipDescription?.toLowerCase().includes('divisional')) {
          result.divisional_count++;
        }
      }
    }

    // Get documents for detailed analysis
    console.log(`  Fetching documents for application ${result.application_number}...`);
    const docsResponse = await client.getDocuments(result.application_number);
    result.total_documents = docsResponse.recordTotalQuantity || docsResponse.documents?.length || 0;

    // Analyze documents
    for (const doc of docsResponse.documents || []) {
      const code = doc.documentCode || '';
      const desc = doc.documentCodeDescription || '';

      // Office actions
      if (code === 'CTNF' || desc.toLowerCase().includes('non-final rejection')) {
        result.non_final_rejections++;
        result.office_actions_count++;
        result.key_events.push({
          date: doc.mailDate || null,
          code,
          description: 'Non-Final Rejection',
          type: 'rejection',
        });
      } else if (code === 'CTFR' || desc.toLowerCase().includes('final rejection')) {
        result.final_rejections++;
        result.office_actions_count++;
        result.key_events.push({
          date: doc.mailDate || null,
          code,
          description: 'Final Rejection',
          type: 'rejection',
        });
      } else if (code === 'N417' || desc.toLowerCase().includes('allowance')) {
        result.allowances++;
        result.key_events.push({
          date: doc.mailDate || null,
          code,
          description: 'Notice of Allowance',
          type: 'allowance',
        });
      }

      // Applicant responses
      if (code === 'A.P' || code === 'AREF' || desc.toLowerCase().includes('amendment') || desc.toLowerCase().includes('response')) {
        result.applicant_responses++;
        result.key_events.push({
          date: doc.mailDate || null,
          code,
          description: desc || 'Applicant Response',
          type: 'response',
        });
      }

      // RCE
      if (code === 'RCEX' || desc.toLowerCase().includes('request for continued examination')) {
        result.rce_count++;
        result.key_events.push({
          date: doc.mailDate || null,
          code,
          description: 'Request for Continued Examination',
          type: 'other',
        });
      }
    }

    // Sort events by date
    result.key_events.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    // Keep only most recent 10 events
    result.key_events = result.key_events.slice(-10);

    // Calculate score
    const { score, category } = calculateProsecutionScore(result);
    result.prosecution_quality_score = score;
    result.prosecution_quality_category = category;

    return result;

  } catch (error: any) {
    result.error = error.message || 'Unknown error';
    return result;
  }
}

function loadPatentIds(args: string[]): string[] {
  // Check for --sector flag
  const sectorIndex = args.indexOf('--sector');
  if (sectorIndex !== -1 && args[sectorIndex + 1]) {
    const sectorId = args[sectorIndex + 1];
    const sectorFile = `./output/sectors/${sectorId}-analysis-2026-01-17.json`;

    if (fs.existsSync(sectorFile)) {
      const data = JSON.parse(fs.readFileSync(sectorFile, 'utf-8'));
      const patents = (data.results || []).map((r: any) => r.patent_id);
      console.log(`Loaded ${patents.length} patents from sector: ${sectorId}`);
      return patents;
    } else {
      console.error(`Sector file not found: ${sectorFile}`);
      process.exit(1);
    }
  }

  // Check for --top flag
  const topIndex = args.indexOf('--top');
  if (topIndex !== -1) {
    const topN = parseInt(args[topIndex + 1] || '50', 10);

    // Load from tier-litigation file
    const tierFiles = fs.readdirSync('./output')
      .filter(f => f.startsWith('tier-litigation-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (tierFiles.length > 0) {
      const data = JSON.parse(fs.readFileSync(`./output/${tierFiles[0]}`, 'utf-8'));
      const patents = data.slice(0, topN).map((p: any) => p.patent_id);
      console.log(`Loaded top ${patents.length} litigation candidates`);
      return patents;
    }

    // Fallback: use streaming-candidates sorted by forward citations
    const candidateFiles = fs.readdirSync('./output')
      .filter(f => f.startsWith('streaming-candidates-') && f.endsWith('.json'))
      .sort()
      .reverse();

    if (candidateFiles.length > 0) {
      const data = JSON.parse(fs.readFileSync(`./output/${candidateFiles[0]}`, 'utf-8'));
      const sorted = (data.candidates || [])
        .filter((c: any) => (c.remaining_years || 0) > 0)
        .sort((a: any, b: any) => (b.forward_citations || 0) - (a.forward_citations || 0))
        .slice(0, topN);
      const patents = sorted.map((c: any) => c.patent_id);
      console.log(`Loaded top ${patents.length} active patents by forward citations`);
      return patents;
    }
  }

  // Check for file argument
  if (args[0] && fs.existsSync(args[0])) {
    const content = fs.readFileSync(args[0], 'utf-8');
    if (args[0].endsWith('.json')) {
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : data.patents || data.patent_ids || [];
    } else {
      return content.split('\n').filter(line => line.trim());
    }
  }

  // Default: load all sector patents
  const sectorDir = './output/sectors';
  const patents: string[] = [];

  if (fs.existsSync(sectorDir)) {
    const files = fs.readdirSync(sectorDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(sectorDir, file), 'utf-8'));
      for (const result of data.results || []) {
        if (!patents.includes(result.patent_id)) {
          patents.push(result.patent_id);
        }
      }
    }
    console.log(`Loaded ${patents.length} patents from all sectors`);
  }

  return patents;
}

async function main() {
  if (!apiKey) {
    console.error('USPTO_ODP_API_KEY environment variable is required');
    console.error('This API requires ID.me verification. See: https://data.uspto.gov/');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const skipExisting = args.includes('--skip-existing');
  const patentIds = loadPatentIds(args);

  if (patentIds.length === 0) {
    console.error('No patent IDs found. Usage:');
    console.error('  npx tsx scripts/check-prosecution-history.ts --sector cloud-auth');
    console.error('  npx tsx scripts/check-prosecution-history.ts --top 50 --skip-existing');
    console.error('  npx tsx scripts/check-prosecution-history.ts patent-ids.txt');
    process.exit(1);
  }

  // Ensure per-patent cache directory exists
  if (!fs.existsSync(PROSECUTION_CACHE_DIR)) {
    fs.mkdirSync(PROSECUTION_CACHE_DIR, { recursive: true });
  }

  // Filter out already-cached patents if --skip-existing
  let idsToProcess = patentIds;
  if (skipExisting) {
    idsToProcess = patentIds.filter(id => !fs.existsSync(path.join(PROSECUTION_CACHE_DIR, `${id}.json`)));
    console.log(`Skipping ${patentIds.length - idsToProcess.length} patents with existing cache data`);
  }

  console.log('='.repeat(60));
  console.log('Prosecution History Check');
  console.log('='.repeat(60));
  console.log(`Patents to check: ${idsToProcess.length}${skipExisting ? ` (${patentIds.length - idsToProcess.length} skipped)` : ''}`);
  console.log('Note: File Wrapper API only has applications from 2001+');
  console.log('');

  const client = new FileWrapperClient({ apiKey });
  const results: ProsecutionHistoryData[] = [];
  const summary = {
    total: idsToProcess.length,
    with_data: 0,
    no_data: 0,
    by_quality_score: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    avg_time_to_grant: 0,
    avg_office_actions: 0,
    total_rces: 0,
  };

  let totalTimeToGrant = 0;
  let timeToGrantCount = 0;
  let totalOfficeActions = 0;

  for (let i = 0; i < idsToProcess.length; i++) {
    const patentId = idsToProcess[i];
    console.log(`[${i + 1}/${idsToProcess.length}] Checking ${patentId}...`);

    const result = await checkProsecutionHistory(client, patentId);
    results.push(result);

    // Save per-patent cache file
    const cacheFile = path.join(PROSECUTION_CACHE_DIR, `${patentId}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));

    if (result.error) {
      summary.no_data++;
      console.log(`    No data: ${result.error}`);
    } else {
      summary.with_data++;
      console.log(`    Score=${result.prosecution_quality_score} (${result.prosecution_quality_category}), OA=${result.office_actions_count}, RCE=${result.rce_count}`);

      if (result.time_to_grant_months) {
        totalTimeToGrant += result.time_to_grant_months;
        timeToGrantCount++;
      }
      totalOfficeActions += result.office_actions_count;
      summary.total_rces += result.rce_count;
    }

    // Quantize score to integer for summary
    const scoreInt = Math.round(result.prosecution_quality_score) as 1|2|3|4|5;
    summary.by_quality_score[scoreInt]++;

    // Rate limiting - 1 request per second (2 API calls per patent)
    await new Promise(r => setTimeout(r, 2000));
  }

  // Calculate averages
  summary.avg_time_to_grant = timeToGrantCount > 0 ? Math.round(totalTimeToGrant / timeToGrantCount) : 0;
  summary.avg_office_actions = summary.with_data > 0 ? Math.round(totalOfficeActions / summary.with_data * 10) / 10 : 0;

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output/prosecution';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    summary,
    results,
  };

  const outputPath = path.join(outputDir, `prosecution-history-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total patents checked: ${summary.total}`);
  console.log(`Patents with data: ${summary.with_data} (${(summary.with_data / summary.total * 100).toFixed(1)}%)`);
  console.log(`Patents without data: ${summary.no_data}`);
  console.log(`\nAverage time to grant: ${summary.avg_time_to_grant} months`);
  console.log(`Average office actions: ${summary.avg_office_actions}`);
  console.log(`Total RCEs filed: ${summary.total_rces}`);
  console.log('\nProsecution Quality Distribution:');
  console.log(`  Score 5 (Clean): ${summary.by_quality_score[5]}`);
  console.log(`  Score 4 (Smooth): ${summary.by_quality_score[4]}`);
  console.log(`  Score 3 (Moderate): ${summary.by_quality_score[3]}`);
  console.log(`  Score 2 (Difficult): ${summary.by_quality_score[2]}`);
  console.log(`  Score 1 (V. Difficult): ${summary.by_quality_score[1]}`);

  // List patents with difficult prosecution
  const difficult = results.filter(r => r.prosecution_quality_score < 3 && !r.error);
  if (difficult.length > 0) {
    console.log('\nPatents with Difficult Prosecution:');
    for (const r of difficult.slice(0, 10)) {
      console.log(`  ${r.patent_id}: score=${r.prosecution_quality_score}, OA=${r.office_actions_count}, RCE=${r.rce_count}`);
    }
    if (difficult.length > 10) {
      console.log(`  ... and ${difficult.length - 10} more`);
    }
  }
}

main().catch(console.error);
