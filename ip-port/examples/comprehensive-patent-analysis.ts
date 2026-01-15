/**
 * Comprehensive Patent Analysis Example
 * 
 * This script demonstrates a complete patent analysis workflow using all three APIs:
 * 1. PatentsView - Find patents and citations
 * 2. File Wrapper - Get prosecution history
 * 3. PTAB - Check for IPR challenges
 * 
 * Use Case: Analyze a competitor's patent portfolio for litigation risk
 * 
 * Usage:
 * 1. Set both PATENTSVIEW_API_KEY and USPTO_ODP_API_KEY in .env file
 * 2. Run: npx ts-node examples/comprehensive-patent-analysis.ts
 */

import { createPatentsViewClient } from '../clients/patentsview-client.js';
import { createFileWrapperClient } from '../clients/odp-file-wrapper-client.js';
import { createPTABClient } from '../clients/odp-ptab-client.js';
import * as dotenv from 'dotenv';

dotenv.config();

interface PatentAnalysis {
  patent: {
    number: string;
    title: string;
    date: string;
    assignee: string;
  };
  citations: {
    citedCount: number;
    citingCount: number;
    topCitedPatents: string[];
  };
  prosecution: {
    applicationNumber: string;
    filingDate: string;
    status: string;
    officeActionsCount: number;
    responsesCount: number;
    prosecutionDuration: number; // days
  } | null;
  ptab: {
    iprCount: number;
    isInstituted: boolean;
    isChallenged: boolean;
    challengeOutcome: string | null;
  };
  riskScore: number; // 0-100
}

async function analyzePatent(patentNumber: string): Promise<PatentAnalysis> {
  const pvClient = createPatentsViewClient();
  const fwClient = createFileWrapperClient();
  const ptabClient = createPTABClient();

  console.log(`\n=== Analyzing Patent ${patentNumber} ===\n`);

  // Step 1: Get patent data from PatentsView
  console.log('Step 1: Retrieving patent data...');
  const patent = await pvClient.getPatent(patentNumber, [
    'patent_id',
    'patent_number',
    'patent_title',
    'patent_date',
    'assignees',
    'application_number',
    'filing_date',
  ]);

  if (!patent) {
    throw new Error(`Patent ${patentNumber} not found`);
  }

  console.log(`✓ Found: ${patent.patent_title}`);
  console.log(`  Assignee: ${patent.assignees?.[0]?.assignee_organization || 'Unknown'}`);

  // Step 2: Get citation network
  console.log('\nStep 2: Analyzing citation network...');
  const citations = await pvClient.getPatentCitations(patentNumber);
  
  console.log(`✓ Citations analyzed`);
  console.log(`  Backward citations (cited): ${citations.backward.length}`);
  console.log(`  Forward citations (citing): ${citations.forward.length}`);

  const topCited = citations.backward
    .slice(0, 5)
    .map(c => c.cited_patent_number!)
    .filter(Boolean);

  // Step 3: Get prosecution history
  console.log('\nStep 3: Retrieving prosecution history...');
  let prosecutionData: PatentAnalysis['prosecution'] = null;

  try {
    const application = await fwClient.getApplicationByPatentNumber(patentNumber);
    
    if (application) {
      console.log(`✓ Found application: ${application.applicationNumberFormatted}`);
      
      const [officeActions, responses] = await Promise.all([
        fwClient.getOfficeActions(application.applicationNumber),
        fwClient.getApplicantResponses(application.applicationNumber),
      ]);

      const filingDate = new Date(application.filingDate!);
      const patentDate = new Date(patent.patent_date!);
      const prosecutionDays = Math.floor(
        (patentDate.getTime() - filingDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      prosecutionData = {
        applicationNumber: application.applicationNumberFormatted!,
        filingDate: application.filingDate!,
        status: application.applicationStatusDescriptionText!,
        officeActionsCount: officeActions.length,
        responsesCount: responses.length,
        prosecutionDuration: prosecutionDays,
      };

      console.log(`  Office Actions: ${officeActions.length}`);
      console.log(`  Applicant Responses: ${responses.length}`);
      console.log(`  Prosecution Duration: ${prosecutionDays} days`);
    }
  } catch (error) {
    console.log(`✗ Prosecution history not available (pre-2001 application or API error)`);
  }

  // Step 4: Check for PTAB challenges
  console.log('\nStep 4: Checking for PTAB challenges...');
  const iprResults = await ptabClient.searchIPRsByPatent(patentNumber);
  
  let isInstituted = false;
  let challengeOutcome: string | null = null;

  if (iprResults.trials.length > 0) {
    console.log(`✓ Found ${iprResults.trials.length} IPR proceeding(s)`);
    
    iprResults.trials.forEach(trial => {
      console.log(`  - ${trial.trialNumber}`);
      console.log(`    Status: ${trial.trialStatusText}`);
      console.log(`    Institution: ${trial.institutionDecision || 'Pending'}`);
      
      if (trial.institutionDecision === 'Instituted') {
        isInstituted = true;
      }
      
      if (trial.finalWrittenDecisionType) {
        challengeOutcome = trial.patentability || trial.finalWrittenDecisionType;
        console.log(`    Outcome: ${challengeOutcome}`);
      }
    });
  } else {
    console.log(`✓ No IPR challenges found`);
  }

  // Step 5: Calculate risk score
  console.log('\nStep 5: Calculating litigation risk score...');
  
  let riskScore = 50; // Base score

  // High citation count reduces risk (indicates importance)
  if (citations.forward.length > 50) riskScore -= 15;
  else if (citations.forward.length > 20) riskScore -= 10;
  else if (citations.forward.length < 5) riskScore += 10;

  // Long prosecution increases risk (more back-and-forth with examiner)
  if (prosecutionData && prosecutionData.prosecutionDuration > 1000) riskScore += 15;
  else if (prosecutionData && prosecutionData.prosecutionDuration < 500) riskScore -= 10;

  // Multiple office actions increase risk
  if (prosecutionData && prosecutionData.officeActionsCount > 3) riskScore += 10;

  // IPR challenges increase risk significantly
  if (iprResults.trials.length > 0) riskScore += 20;
  if (isInstituted) riskScore += 15;
  if (challengeOutcome?.includes('Unpatentable')) riskScore += 30;

  // Clamp to 0-100
  riskScore = Math.max(0, Math.min(100, riskScore));

  console.log(`✓ Risk Score: ${riskScore}/100`);

  const analysis: PatentAnalysis = {
    patent: {
      number: patent.patent_number!,
      title: patent.patent_title!,
      date: patent.patent_date!,
      assignee: patent.assignees?.[0]?.assignee_organization || 'Unknown',
    },
    citations: {
      citedCount: citations.backward.length,
      citingCount: citations.forward.length,
      topCitedPatents: topCited,
    },
    prosecution: prosecutionData,
    ptab: {
      iprCount: iprResults.trials.length,
      isInstituted,
      isChallenged: iprResults.trials.length > 0,
      challengeOutcome,
    },
    riskScore,
  };

  return analysis;
}

async function analyzePortfolio(assigneeOrg: string, startDate: string, endDate: string) {
  console.log(`\n=== Portfolio Analysis: ${assigneeOrg} ===`);
  console.log(`Date Range: ${startDate} to ${endDate}\n`);

  const pvClient = createPatentsViewClient();

  // Get patents for the assignee in date range
  console.log('Retrieving patents...');
  const patents = await pvClient.searchByAssignee(
    assigneeOrg,
    { _and: [
      { _gte: { patent_date: startDate } },
      { _lte: { patent_date: endDate } }
    ]},
    ['patent_id', 'patent_number', 'patent_title', 'patent_date', 'assignees']
  );

  console.log(`✓ Found ${patents.total_hits} patents\n`);

  // Analyze a sample of patents (limit for demo)
  const sampleSize = Math.min(3, patents.patents.length);
  const analyses: PatentAnalysis[] = [];

  for (let i = 0; i < sampleSize; i++) {
    const patent = patents.patents[i];
    try {
      const analysis = await analyzePatent(patent.patent_number!);
      analyses.push(analysis);
      
      // Add delay to respect rate limits
      if (i < sampleSize - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`Error analyzing ${patent.patent_number}: ${error.message}`);
    }
  }

  // Generate summary
  console.log(`\n=== Portfolio Summary ===\n`);
  console.log(`Total Patents Analyzed: ${analyses.length}`);
  
  const avgRiskScore = analyses.reduce((sum, a) => sum + a.riskScore, 0) / analyses.length;
  console.log(`Average Risk Score: ${avgRiskScore.toFixed(1)}/100`);

  const challengedCount = analyses.filter(a => a.ptab.isChallenged).length;
  console.log(`Patents with IPR Challenges: ${challengedCount}/${analyses.length}`);

  const avgCitations = analyses.reduce((sum, a) => sum + a.citations.citingCount, 0) / analyses.length;
  console.log(`Average Forward Citations: ${avgCitations.toFixed(1)}`);

  // High risk patents
  const highRiskPatents = analyses.filter(a => a.riskScore > 70);
  if (highRiskPatents.length > 0) {
    console.log(`\nHigh Risk Patents (>70 score):`);
    highRiskPatents.forEach(a => {
      console.log(`  - ${a.patent.number}: ${a.patent.title.substring(0, 60)}...`);
      console.log(`    Risk Score: ${a.riskScore}`);
      if (a.ptab.isChallenged) {
        console.log(`    ⚠ Has IPR challenges`);
      }
    });
  }

  return analyses;
}

async function main() {
  try {
    // Example 1: Analyze a single patent
    console.log('=== Example 1: Single Patent Analysis ===');
    await analyzePatent('10000000');

    // Example 2: Portfolio analysis
    console.log('\n\n=== Example 2: Portfolio Analysis ===');
    await analyzePortfolio('Apple Inc.', '2024-01-01', '2024-06-30');

    console.log('\n=== Analysis Complete ✓ ===');

  } catch (error) {
    console.error('\n✗ Error during analysis:', error);
    
    if (error.message?.includes('API_KEY')) {
      console.error('\nℹ Please ensure both API keys are set in your .env file:');
      console.error('  - PATENTSVIEW_API_KEY');
      console.error('  - USPTO_ODP_API_KEY');
    }
    
    process.exit(1);
  }
}

// Run the analysis
main().catch(console.error);
