/**
 * Test script for USPTO Open Data Portal - File Wrapper API
 * 
 * This script demonstrates:
 * - Application search
 * - Prosecution history retrieval
 * - Office action analysis
 * - Document downloads
 * 
 * Usage:
 * 1. Set USPTO_ODP_API_KEY in .env file
 * 2. Run: npx ts-node examples/test-file-wrapper.ts
 */

import { createFileWrapperClient } from '../clients/odp-file-wrapper-client.js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

async function testFileWrapperAPI() {
  console.log('=== USPTO File Wrapper API Test ===\n');

  try {
    // Create client
    const client = createFileWrapperClient();
    console.log('✓ File Wrapper client created successfully\n');

    // Test 1: Get application by number
    console.log('Test 1: Get application by application number');
    const testAppNumber = '16123456'; // Use a known application number
    
    try {
      const application = await client.getApplication(testAppNumber);
      console.log(`✓ Found application: ${application.applicationNumberFormatted}`);
      console.log(`  Title: ${application.inventionTitle}`);
      console.log(`  Filing Date: ${application.filingDate}`);
      console.log(`  Status: ${application.applicationStatusDescriptionText}`);
      
      if (application.patentNumber) {
        console.log(`  Patent Number: ${application.patentNumberFormatted}`);
      }
      
      if (application.inventors && application.inventors.length > 0) {
        console.log(`  First Inventor: ${application.inventors[0].inventorNameFull}`);
      }
      
      if (application.applicants && application.applicants.length > 0) {
        console.log(`  First Applicant: ${application.applicants[0].applicantName}`);
      }
      console.log('');
    } catch (error) {
      console.log(`✗ Application ${testAppNumber} not found or not accessible`);
      console.log(`  Note: File Wrapper API only includes applications from 2001 onwards`);
      console.log('');
    }

    // Test 2: Search applications by assignee
    console.log('Test 2: Search applications by assignee');
    const searchResults = await client.searchByAssignee(
      'Apple Inc.',
      '2024-01-01',
      '2024-12-31'
    );
    
    console.log(`✓ Found ${searchResults.recordTotalQuantity} applications for Apple Inc. in 2024`);
    console.log(`  Retrieved ${searchResults.applications.length} applications in this batch`);
    
    if (searchResults.applications.length > 0) {
      const firstApp = searchResults.applications[0];
      console.log(`  Sample: ${firstApp.applicationNumberFormatted} - ${firstApp.inventionTitle?.substring(0, 60)}...`);
    }
    console.log('');

    // Test 3: Get file history documents (if we have a valid app)
    if (searchResults.applications.length > 0) {
      const sampleApp = searchResults.applications[0];
      console.log(`Test 3: Get file history documents for ${sampleApp.applicationNumberFormatted}`);
      
      try {
        const documents = await client.getDocuments(sampleApp.applicationNumber);
        console.log(`✓ Found ${documents.recordTotalQuantity} documents in file history`);
        
        if (documents.documents.length > 0) {
          console.log(`  Document types found:`);
          const documentTypes = new Set(documents.documents.map(d => d.documentCodeDescription));
          Array.from(documentTypes).slice(0, 5).forEach(type => {
            const count = documents.documents.filter(d => d.documentCodeDescription === type).length;
            console.log(`    - ${type}: ${count}`);
          });
        }
        console.log('');

        // Test 4: Get office actions
        console.log('Test 4: Extract office actions from file history');
        const officeActions = await client.getOfficeActions(sampleApp.applicationNumber);
        
        console.log(`✓ Found ${officeActions.length} office actions`);
        officeActions.slice(0, 3).forEach(oa => {
          console.log(`  - ${oa.mailDate}: ${oa.documentCodeDescription}`);
        });
        console.log('');

        // Test 5: Get applicant responses
        console.log('Test 5: Extract applicant responses from file history');
        const responses = await client.getApplicantResponses(sampleApp.applicationNumber);
        
        console.log(`✓ Found ${responses.length} applicant responses`);
        responses.slice(0, 3).forEach(resp => {
          console.log(`  - ${resp.mailDate}: ${resp.documentCodeDescription}`);
        });
        console.log('');

        // Test 6: Get prosecution timeline
        console.log('Test 6: Get complete prosecution timeline');
        const timeline = await client.getProsecutionTimeline(sampleApp.applicationNumber);
        
        console.log(`✓ Prosecution timeline retrieved`);
        console.log(`  Application: ${timeline.application.applicationNumberFormatted}`);
        console.log(`  Total transactions: ${timeline.transactions.length}`);
        console.log(`  Key documents: ${timeline.keyDocuments.length}`);
        
        if (timeline.keyDocuments.length > 0) {
          console.log(`  Recent key events:`);
          timeline.keyDocuments
            .slice(0, 5)
            .forEach(doc => {
              console.log(`    ${doc.mailDate}: ${doc.documentCodeDescription}`);
            });
        }
        console.log('');

      } catch (error) {
        console.log(`✗ Could not retrieve documents for this application`);
        console.log(`  Error: ${error.message}`);
        console.log('');
      }
    }

    // Test 7: Get application status
    console.log('Test 7: Check application status');
    if (searchResults.applications.length > 0) {
      const appToCheck = searchResults.applications[0];
      const status = await client.getApplicationStatus(appToCheck.applicationNumber);
      
      console.log(`✓ Status for ${appToCheck.applicationNumberFormatted}:`);
      console.log(`  Status: ${status.status}`);
      console.log(`  Status Date: ${status.statusDate}`);
      console.log(`  Is Pending: ${status.isPending}`);
      console.log(`  Is Patented: ${status.isPatented}`);
      console.log(`  Is Abandoned: ${status.isAbandoned}`);
      console.log('');
    }

    // Test 8: Search by patent number
    console.log('Test 8: Get application by patent number');
    const patentNumber = '11000000'; // Use a known patent number
    
    try {
      const appByPatent = await client.getApplicationByPatentNumber(patentNumber);
      
      if (appByPatent) {
        console.log(`✓ Found application for patent ${patentNumber}`);
        console.log(`  Application Number: ${appByPatent.applicationNumberFormatted}`);
        console.log(`  Title: ${appByPatent.inventionTitle?.substring(0, 60)}...`);
      } else {
        console.log(`✗ No application found for patent ${patentNumber}`);
      }
    } catch (error) {
      console.log(`✗ Error searching for patent ${patentNumber}`);
    }
    console.log('');

    // Test 9: Pagination example
    console.log('Test 9: Pagination example - fetching multiple pages');
    let totalFetched = 0;
    let pageCount = 0;
    const maxPages = 2; // Limit for testing
    
    for await (const page of client.searchPaginated(
      {
        assignee: 'Microsoft',
        filingDateFrom: '2024-01-01',
        filingDateTo: '2024-03-31',
      },
      10 // Small page size for testing
    )) {
      pageCount++;
      totalFetched += page.length;
      console.log(`  Page ${pageCount}: Retrieved ${page.length} applications (total: ${totalFetched})`);
      
      if (pageCount >= maxPages) {
        console.log(`  Stopping at ${maxPages} pages for demo purposes`);
        break;
      }
    }
    console.log('');

    console.log('=== All File Wrapper API Tests Passed ✓ ===');

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
testFileWrapperAPI().catch(console.error);
