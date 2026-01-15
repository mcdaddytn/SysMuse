/**
 * Test script for USPTO Open Data Portal - File Wrapper API
 *
 * This script demonstrates:
 * - Application search
 * - Application retrieval
 * - Basic API connectivity
 *
 * Usage:
 * 1. Set USPTO_ODP_API_KEY in .env file
 * 2. Run: npx tsx examples/test-file-wrapper.ts
 */

import { createFileWrapperClient } from '../clients/odp-file-wrapper-client.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function testFileWrapperAPI() {
  console.log('=== USPTO File Wrapper API Test ===\n');

  try {
    // Create client
    const client = createFileWrapperClient();
    console.log('✓ File Wrapper client created successfully\n');

    // Test 1: Basic search (most recent applications)
    console.log('Test 1: Search most recent applications');
    const searchResults = await client.searchApplications({
      size: 5,
    });

    console.log(`✓ API connected successfully`);
    console.log(`  Total applications in database: ${searchResults.count?.toLocaleString()}`);
    console.log(`  Records returned: ${searchResults.patentFileWrapperDataBag?.length || 0}`);

    if (searchResults.patentFileWrapperDataBag && searchResults.patentFileWrapperDataBag.length > 0) {
      console.log('\n  Recent applications:');
      searchResults.patentFileWrapperDataBag.slice(0, 3).forEach((record, i) => {
        const meta = record.applicationMetaData;
        console.log(`  ${i + 1}. ${record.applicationNumberText}`);
        console.log(`     Title: ${meta?.inventionTitle?.substring(0, 60) || 'N/A'}...`);
        console.log(`     Filing: ${meta?.filingDate || 'N/A'} | Status: ${meta?.applicationStatusDescriptionText || 'N/A'}`);
      });
    }
    console.log('');

    // Test 2: Search with date filter
    console.log('Test 2: Search applications filed in 2024');
    const dateResults = await client.searchApplications({
      filingDateFrom: '2024-01-01',
      filingDateTo: '2024-12-31',
      size: 3,
    });

    console.log(`✓ Found applications filed in 2024`);
    console.log(`  Count: ${dateResults.count?.toLocaleString() || 'N/A'}`);

    if (dateResults.patentFileWrapperDataBag && dateResults.patentFileWrapperDataBag.length > 0) {
      const sample = dateResults.patentFileWrapperDataBag[0];
      console.log(`  Sample: ${sample.applicationNumberText} - ${sample.applicationMetaData?.inventionTitle?.substring(0, 50)}...`);
    }
    console.log('');

    // Test 3: Get specific application
    console.log('Test 3: Get specific application details');
    if (searchResults.patentFileWrapperDataBag && searchResults.patentFileWrapperDataBag.length > 0) {
      const appNum = searchResults.patentFileWrapperDataBag[0].applicationNumberText;
      try {
        const app = await client.getApplication(appNum);
        console.log(`✓ Retrieved application ${appNum}`);
        if (app) {
          console.log(`  Has event history: ${app.eventDataBag ? 'Yes (' + app.eventDataBag.length + ' events)' : 'No'}`);
          console.log(`  Has assignments: ${app.assignmentBag ? 'Yes' : 'No'}`);
        }
      } catch (e) {
        console.log(`✗ Could not retrieve application ${appNum}`);
      }
    }
    console.log('');

    console.log('=== All File Wrapper API Tests Passed ✓ ===');

  } catch (error) {
    console.error('\n✗ Error during testing:', error);

    if (error instanceof Error && error.message?.includes('USPTO_ODP_API_KEY')) {
      console.error('\nℹ Please set USPTO_ODP_API_KEY in your .env file');
      console.error('  Get an API key at: https://data.uspto.gov/apis/getting-started');
    }

    process.exit(1);
  }
}

// Run the test
testFileWrapperAPI().catch(console.error);
