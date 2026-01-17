/**
 * IPR Risk Check Script
 *
 * Checks Patent Trial and Appeal Board (PTAB) for IPR proceedings against patents.
 * Uses USPTO ODP PTAB API (v3).
 *
 * Output: IPR risk data for each patent including:
 * - Has IPR history
 * - Number of petitions filed
 * - Number instituted
 * - Claims invalidated
 * - Final outcomes
 * - IPR risk score (1-5: 5=no IPR, 1=claims invalidated)
 *
 * Usage:
 *   npx tsx scripts/check-ipr-risk.ts [patent-ids-file] [--top N]
 *   npx tsx scripts/check-ipr-risk.ts --sector cloud-auth
 *   npx tsx scripts/check-ipr-risk.ts --top 50
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { PTABClient, PTABTrial } from '../clients/odp-ptab-client.js';

dotenv.config();

const apiKey = process.env.USPTO_ODP_API_KEY;

interface IPRRiskData {
  patent_id: string;
  has_ipr_history: boolean;
  petitions_filed: number;
  petitions_instituted: number;
  petitions_denied: number;
  petitions_settled: number;
  petitions_terminated: number;
  claims_challenged: number;
  claims_invalidated: number;
  claims_upheld: number;
  ipr_risk_score: number;
  ipr_risk_category: 'no_history' | 'challenged_survived' | 'settled' | 'partial_invalid' | 'invalid';
  petitioner_names: string[];
  trial_numbers: string[];
  latest_decision_date: string | null;
  details: IPRTrialSummary[];
}

interface IPRTrialSummary {
  trial_number: string;
  trial_type: string;
  status: string;
  petitioner: string;
  filing_date: string | null;
  institution_decision: string | null;
  institution_date: string | null;
  final_decision_date: string | null;
  outcome: string | null;
}

function calculateIPRRiskScore(data: Omit<IPRRiskData, 'ipr_risk_score' | 'ipr_risk_category'>): { score: number; category: IPRRiskData['ipr_risk_category'] } {
  // No IPR history = lowest risk (score 5)
  if (!data.has_ipr_history || data.petitions_filed === 0) {
    return { score: 5, category: 'no_history' };
  }

  // All petitions denied = survived challenge (score 4)
  if (data.petitions_denied === data.petitions_filed && data.petitions_filed > 0) {
    return { score: 4, category: 'challenged_survived' };
  }

  // All petitions settled = moderate risk (score 3)
  if (data.petitions_settled === data.petitions_filed && data.petitions_filed > 0) {
    return { score: 3, category: 'settled' };
  }

  // Some claims invalidated but some upheld = higher risk (score 2)
  if (data.claims_invalidated > 0 && data.claims_upheld > 0) {
    return { score: 2, category: 'partial_invalid' };
  }

  // All claims challenged were invalidated = highest risk (score 1)
  if (data.claims_invalidated > 0 && data.claims_upheld === 0) {
    return { score: 1, category: 'invalid' };
  }

  // Default: moderate risk for other scenarios
  return { score: 3, category: 'settled' };
}

async function checkPatentIPR(client: PTABClient, patentNumber: string): Promise<IPRRiskData> {
  // Normalize patent number (remove leading zeros, ensure string)
  const normalizedPatent = patentNumber.replace(/^0+/, '');

  console.log(`  Checking IPR for patent ${normalizedPatent}...`);

  const result: Omit<IPRRiskData, 'ipr_risk_score' | 'ipr_risk_category'> = {
    patent_id: patentNumber,
    has_ipr_history: false,
    petitions_filed: 0,
    petitions_instituted: 0,
    petitions_denied: 0,
    petitions_settled: 0,
    petitions_terminated: 0,
    claims_challenged: 0,
    claims_invalidated: 0,
    claims_upheld: 0,
    petitioner_names: [],
    trial_numbers: [],
    latest_decision_date: null,
    details: [],
  };

  try {
    const response = await client.searchIPRsByPatent(normalizedPatent);

    if (response.trials.length === 0) {
      const { score, category } = calculateIPRRiskScore(result);
      return { ...result, ipr_risk_score: score, ipr_risk_category: category };
    }

    result.has_ipr_history = true;
    result.petitions_filed = response.trials.length;

    const petitioners = new Set<string>();
    let latestDate: Date | null = null;

    for (const trial of response.trials) {
      // Track petitioners
      if (trial.petitionerPartyName) {
        petitioners.add(trial.petitionerPartyName);
      }

      // Track trial numbers
      result.trial_numbers.push(trial.trialNumber);

      // Track status
      const status = trial.trialStatusCategory?.toLowerCase() || '';
      if (status.includes('institut')) {
        result.petitions_instituted++;
      } else if (status.includes('denied') || status.includes('not institut')) {
        result.petitions_denied++;
      } else if (status.includes('settl')) {
        result.petitions_settled++;
      } else if (status.includes('terminat')) {
        result.petitions_terminated++;
      }

      // Track claims (if available)
      if (trial.claimsChallenged) {
        const challengedCount = trial.claimsChallenged.split(',').length;
        result.claims_challenged += challengedCount;
      }

      // Track decision dates
      const decisionDate = trial.finalWrittenDecisionDate || trial.institutionDecisionDate;
      if (decisionDate) {
        const date = new Date(decisionDate);
        if (!latestDate || date > latestDate) {
          latestDate = date;
        }
      }

      // Add trial summary
      result.details.push({
        trial_number: trial.trialNumber,
        trial_type: trial.trialType || 'IPR',
        status: trial.trialStatusText || trial.trialStatusCategory || 'Unknown',
        petitioner: trial.petitionerPartyName || 'Unknown',
        filing_date: trial.filingDate || null,
        institution_decision: trial.institutionDecision || null,
        institution_date: trial.institutionDecisionDate || null,
        final_decision_date: trial.finalWrittenDecisionDate || null,
        outcome: trial.patentability || null,
      });
    }

    result.petitioner_names = Array.from(petitioners);
    result.latest_decision_date = latestDate ? latestDate.toISOString().split('T')[0] : null;

    const { score, category } = calculateIPRRiskScore(result);
    return { ...result, ipr_risk_score: score, ipr_risk_category: category };

  } catch (error: any) {
    // API errors - return no history with a note
    console.log(`    API error for ${patentNumber}: ${error.message}`);
    const { score, category } = calculateIPRRiskScore(result);
    return { ...result, ipr_risk_score: score, ipr_risk_category: category };
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
  const patentIds = loadPatentIds(args);

  if (patentIds.length === 0) {
    console.error('No patent IDs found. Usage:');
    console.error('  npx tsx scripts/check-ipr-risk.ts --sector cloud-auth');
    console.error('  npx tsx scripts/check-ipr-risk.ts --top 50');
    console.error('  npx tsx scripts/check-ipr-risk.ts patent-ids.txt');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('IPR Risk Check');
  console.log('='.repeat(60));
  console.log(`Patents to check: ${patentIds.length}`);
  console.log('');

  const client = new PTABClient({ apiKey });
  const results: IPRRiskData[] = [];
  const summary = {
    total: patentIds.length,
    with_ipr: 0,
    no_ipr: 0,
    by_risk_score: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  };

  for (let i = 0; i < patentIds.length; i++) {
    const patentId = patentIds[i];
    console.log(`[${i + 1}/${patentIds.length}] Checking ${patentId}...`);

    const result = await checkPatentIPR(client, patentId);
    results.push(result);

    if (result.has_ipr_history) {
      summary.with_ipr++;
      console.log(`    IPR FOUND: ${result.petitions_filed} petition(s), score=${result.ipr_risk_score}`);
    } else {
      summary.no_ipr++;
      console.log(`    No IPR history (score=5)`);
    }

    summary.by_risk_score[result.ipr_risk_score as 1|2|3|4|5]++;

    // Rate limiting - 1 request per second
    await new Promise(r => setTimeout(r, 1000));
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const outputDir = './output/ipr';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const output = {
    generated_at: new Date().toISOString(),
    summary,
    results,
  };

  const outputPath = path.join(outputDir, `ipr-risk-check-${timestamp}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total patents checked: ${summary.total}`);
  console.log(`Patents with IPR history: ${summary.with_ipr} (${(summary.with_ipr / summary.total * 100).toFixed(1)}%)`);
  console.log(`Patents without IPR history: ${summary.no_ipr}`);
  console.log('\nRisk Score Distribution:');
  console.log(`  Score 5 (No IPR): ${summary.by_risk_score[5]}`);
  console.log(`  Score 4 (Survived): ${summary.by_risk_score[4]}`);
  console.log(`  Score 3 (Settled): ${summary.by_risk_score[3]}`);
  console.log(`  Score 2 (Partial): ${summary.by_risk_score[2]}`);
  console.log(`  Score 1 (Invalid): ${summary.by_risk_score[1]}`);

  // List patents with IPR history
  const withIPR = results.filter(r => r.has_ipr_history);
  if (withIPR.length > 0) {
    console.log('\nPatents with IPR History:');
    for (const r of withIPR.slice(0, 10)) {
      console.log(`  ${r.patent_id}: ${r.petitions_filed} petition(s), score=${r.ipr_risk_score} (${r.ipr_risk_category})`);
    }
    if (withIPR.length > 10) {
      console.log(`  ... and ${withIPR.length - 10} more`);
    }
  }
}

main().catch(console.error);
