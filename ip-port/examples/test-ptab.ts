/**
 * Test script for USPTO Open Data Portal - PTAB API
 * 
 * This script demonstrates:
 * - IPR search functionality
 * - PTAB trial data retrieval
 * - Decision analysis
 * - Statistical calculations
 * 
 * Usage:
 * 1. Set USPTO_ODP_API_KEY in .env file
 * 2. Run: npx ts-node examples/test-ptab.ts
 */

import { createPTABClient } from '../clients/odp-ptab-client.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function testPTABAPI() {
  console.log('=== USPTO PTAB API Test ===\n');

  try {
    // Create client
    const client = createPTABClient();
    console.log('✓ PTAB client created successfully\n');

    // Test 1: Search for IPRs by patent number
    console.log('Test 1: Search IPRs for a specific patent');
    const patentNumber = '9000000'; // Use a patent number that likely has IPRs
    
    try {
      const iprResults = await client.searchIPRsByPatent(patentNumber);
      
      console.log(`✓ Found ${iprResults.totalHits} IPR proceedings for patent ${patentNumber}`);
      
      if (iprResults.trials.length > 0) {
        console.log(`  Sample IPR: ${iprResults.trials[0].trialNumber}`);
        console.log(`    Status: ${iprResults.trials[0].trialStatusText}`);
        console.log(`    Petitioner: ${iprResults.trials[0].petitionerPartyName}`);
        console.log(`    Patent Owner: ${iprResults.trials[0].patentOwnerName}`);
        
        if (iprResults.trials[0].institutionDecision) {
          console.log(`    Institution: ${iprResults.trials[0].institutionDecision}`);
        }
      }
    } catch (error) {
      console.log(`✗ No IPRs found for patent ${patentNumber} or API error`);
    }
    console.log('');

    // Test 2: Search IPRs filed in a date range
    console.log('Test 2: Search IPRs filed in 2023');
    const dateRangeResults = await client.searchIPRsByDateRange(
      '2023-01-01',
      '2023-12-31'
    );
    
    console.log(`✓ Found ${dateRangeResults.totalHits} IPRs filed in 2023`);
    console.log(`  Retrieved ${dateRangeResults.trials.length} trials in this batch`);
    
    if (dateRangeResults.trials.length > 0) {
      const firstTrial = dateRangeResults.trials[0];
      console.log(`  Sample: ${firstTrial.trialNumber}`);
      console.log(`    Filed: ${firstTrial.filingDate}`);
      console.log(`    Patent: ${firstTrial.respondentPatentNumber}`);
    }
    console.log('');

    // Test 3: Search by petitioner
    console.log('Test 3: Search IPRs by petitioner');
    const petitionerResults = await client.searchByPetitioner('Apple Inc.');
    
    console.log(`✓ Found ${petitionerResults.totalHits} trials where Apple Inc. is petitioner`);
    console.log(`  Retrieved ${petitionerResults.trials.length} trials`);
    
    if (petitionerResults.trials.length > 0) {
      console.log(`  Recent trials:`);
      petitionerResults.trials.slice(0, 3).forEach(trial => {
        console.log(`    ${trial.trialNumber}: Patent ${trial.respondentPatentNumber} vs ${trial.patentOwnerName}`);
      });
    }
    console.log('');

    // Test 4: Get instituted IPRs
    console.log('Test 4: Get instituted IPRs from 2023');
    const institutedResults = await client.getInstitutedIPRs(
      '2023-01-01',
      '2023-12-31'
    );
    
    console.log(`✓ Found ${institutedResults.totalHits} instituted IPRs in 2023`);
    console.log(`  Retrieved ${institutedResults.trials.length} trials`);
    console.log('');

    // Test 5: Get denied institution decisions
    console.log('Test 5: Get denied institution decisions from 2023');
    const deniedResults = await client.getDeniedInstitutions(
      '2023-01-01',
      '2023-12-31'
    );
    
    console.log(`✓ Found ${deniedResults.totalHits} denied institutions in 2023`);
    console.log(`  Retrieved ${deniedResults.trials.length} trials`);
    console.log('');

    // Test 6: Get trial details
    if (dateRangeResults.trials.length > 0) {
      const sampleTrialNumber = dateRangeResults.trials[0].trialNumber;
      console.log(`Test 6: Get complete trial information for ${sampleTrialNumber}`);
      
      try {
        const trialComplete = await client.getTrialComplete(sampleTrialNumber);
        
        console.log(`✓ Retrieved complete trial data`);
        console.log(`  Trial Number: ${trialComplete.trial.trialNumber}`);
        console.log(`  Type: ${trialComplete.trial.trialType}`);
        console.log(`  Status: ${trialComplete.trial.trialStatusText}`);
        console.log(`  Patent: ${trialComplete.trial.respondentPatentNumber}`);
        console.log(`  Documents: ${trialComplete.documents.length}`);
        
        if (trialComplete.documents.length > 0) {
          console.log(`  Recent documents:`);
          trialComplete.documents.slice(0, 5).forEach(doc => {
            console.log(`    ${doc.filingDate}: ${doc.documentTypeDescription}`);
          });
        }
      } catch (error) {
        console.log(`✗ Could not retrieve complete trial data`);
      }
      console.log('');
    }

    // Test 7: Search PTAB decisions
    console.log('Test 7: Search final written decisions');
    const decisionsResults = await client.getFinalWrittenDecisions(
      '2023-01-01',
      '2023-12-31'
    );
    
    console.log(`✓ Found ${decisionsResults.totalHits} final written decisions in 2023`);
    console.log(`  Retrieved ${decisionsResults.decisions.length} decisions`);
    
    if (decisionsResults.decisions.length > 0) {
      console.log(`  Sample decisions:`);
      decisionsResults.decisions.slice(0, 3).forEach(decision => {
        console.log(`    ${decision.trialNumber} (${decision.decisionDate}): Patent ${decision.patentNumber}`);
      });
    }
    console.log('');

    // Test 8: Full text search in decisions
    console.log('Test 8: Full text search in decisions for "obviousness"');
    const fullTextResults = await client.searchDecisionsFullText('obviousness');
    
    console.log(`✓ Found ${fullTextResults.totalHits} decisions mentioning "obviousness"`);
    console.log(`  Retrieved ${fullTextResults.decisions.length} decisions`);
    console.log('');

    // Test 9: Calculate statistics
    if (dateRangeResults.trials.length > 0) {
      console.log('Test 9: Calculate statistics for 2023 IPRs');
      
      // Get more comprehensive data for statistics
      const allTrials: any[] = [];
      let page = 0;
      const maxPages = 5; // Limit for testing
      
      while (page < maxPages) {
        const pageResults = await client.searchIPRsByDateRange(
          '2023-01-01',
          '2023-12-31'
        );
        
        if (pageResults.trials.length === 0) break;
        
        allTrials.push(...pageResults.trials);
        page++;
        
        if (allTrials.length >= pageResults.totalHits) break;
      }
      
      const stats = client.calculateStatistics(allTrials);
      
      console.log(`✓ Statistics calculated for ${stats.totalTrials} trials:`);
      console.log(`  Total IPRs: ${stats.totalIPR}`);
      console.log(`  Total PGRs: ${stats.totalPGR}`);
      console.log(`  Total CBMs: ${stats.totalCBM}`);
      console.log(`  Institution Rate: ${stats.institutionRate.toFixed(1)}%`);
      console.log(`  Settlement Rate: ${stats.settlementRate.toFixed(1)}%`);
      console.log(`  Average Duration: ${stats.averageDuration.toFixed(0)} days`);
      console.log('');
    }

    // Test 10: Search by patent owner
    console.log('Test 10: Search trials by patent owner');
    const ownerResults = await client.searchByPatentOwner('Microsoft Corporation');
    
    console.log(`✓ Found ${ownerResults.totalHits} trials where Microsoft Corporation is patent owner`);
    console.log(`  Retrieved ${ownerResults.trials.length} trials`);
    
    if (ownerResults.trials.length > 0) {
      console.log(`  Sample trials:`);
      ownerResults.trials.slice(0, 3).forEach(trial => {
        console.log(`    ${trial.trialNumber}: ${trial.petitionerPartyName} vs Patent ${trial.respondentPatentNumber}`);
      });
    }
    console.log('');

    // Test 11: Pagination example
    console.log('Test 11: Pagination example - fetching multiple pages');
    let totalFetched = 0;
    let pageCount = 0;
    const maxPagesDemo = 2; // Limit for testing
    
    for await (const page of client.searchPaginated(
      {
        filters: [
          { name: 'trialMetaData.trialTypeCode', value: 'IPR' },
        ],
        rangeFilters: [
          {
            field: 'trialMetaData.accordedFilingDate',
            valueFrom: '2023-01-01',
            valueTo: '2023-03-31',
          },
        ],
      },
      25 // Small page size for testing
    )) {
      pageCount++;
      totalFetched += page.length;
      console.log(`  Page ${pageCount}: Retrieved ${page.length} trials (total: ${totalFetched})`);
      
      if (pageCount >= maxPagesDemo) {
        console.log(`  Stopping at ${maxPagesDemo} pages for demo purposes`);
        break;
      }
    }
    console.log('');

    console.log('=== All PTAB API Tests Passed ✓ ===');

  } catch (error) {
    console.error('\n✗ Error during testing:', error);
    
    if (error.message?.includes('USPTO_ODP_API_KEY')) {
      console.error('\nℹ Please set USPTO_ODP_API_KEY in your .env file');
      console.error('  1. Create USPTO.gov account');
      console.error('  2. Complete ID.me verification');
      console.error('  3. Get API key at: https://data.uspto.gov/myodp');
    }
    
    process.exit(1);
  }
}

// Run the test
testPTABAPI().catch(console.error);
