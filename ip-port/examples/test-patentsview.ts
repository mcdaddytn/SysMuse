/**
 * Test script for PatentsView API
 * 
 * This script demonstrates:
 * - API key validation
 * - Basic patent searches
 * - Citation analysis
 * - Pagination
 * 
 * Usage:
 * 1. Set PATENTSVIEW_API_KEY in .env file
 * 2. Run: npx ts-node examples/test-patentsview.ts
 */

import { createPatentsViewClient } from '../clients/patentsview-client.js';
import * as dotenv from 'dotenv';

dotenv.config();

async function testPatentsViewAPI() {
  console.log('=== PatentsView API Test ===\n');

  try {
    // Create client
    const client = createPatentsViewClient();
    console.log('✓ PatentsView client created successfully\n');

    // Test 1: Search for a specific patent
    console.log('Test 1: Get specific patent by number');
    const patent = await client.getPatent('10000000', [
      'patent_id',
      'patent_number',
      'patent_title',
      'patent_date',
      'assignees',
      'inventors',
    ]);
    
    if (patent) {
      console.log(`✓ Found patent: ${patent.patent_number}`);
      console.log(`  Title: ${patent.patent_title}`);
      console.log(`  Date: ${patent.patent_date}`);
      console.log(`  Assignees: ${patent.assignees?.map(a => a.assignee_organization).join(', ')}`);
    } else {
      console.log('✗ Patent not found');
    }
    console.log('');

    // Test 2: Search by date range
    console.log('Test 2: Search patents from 2023');
    const dateRangeResults = await client.searchByDateRange(
      '2023-01-01',
      '2023-01-31',
      undefined,
      ['patent_id', 'patent_number', 'patent_title', 'patent_date']
    );
    
    console.log(`✓ Found ${dateRangeResults.total_hits} patents in January 2023`);
    console.log(`  Retrieved ${dateRangeResults.count} patents in this batch`);
    if (dateRangeResults.patents.length > 0) {
      console.log(`  First patent: ${dateRangeResults.patents[0].patent_number} - ${dateRangeResults.patents[0].patent_title}`);
    }
    console.log('');

    // Test 3: Search by assignee
    console.log('Test 3: Search patents by assignee');
    const assigneeResults = await client.searchByAssignee(
      'Apple Inc.',
      { _gte: { patent_date: '2024-01-01' } },
      ['patent_id', 'patent_number', 'patent_title', 'patent_date', 'assignees']
    );
    
    console.log(`✓ Found ${assigneeResults.total_hits} Apple Inc. patents from 2024`);
    console.log(`  Retrieved ${assigneeResults.count} patents in this batch`);
    if (assigneeResults.patents.length > 0) {
      console.log(`  Sample patent: ${assigneeResults.patents[0].patent_number} - ${assigneeResults.patents[0].patent_title?.substring(0, 60)}...`);
    }
    console.log('');

    // Test 4: Full text search
    console.log('Test 4: Full text search for "machine learning"');
    const fullTextResults = await client.searchFullText(
      'machine learning',
      ['patent_id', 'patent_number', 'patent_title', 'patent_date'],
      'title'
    );
    
    console.log(`✓ Found ${fullTextResults.total_hits} patents with "machine learning" in title`);
    console.log(`  Retrieved ${fullTextResults.count} patents in this batch`);
    if (fullTextResults.patents.length > 0) {
      console.log(`  Sample: ${fullTextResults.patents[0].patent_number} - ${fullTextResults.patents[0].patent_title?.substring(0, 60)}...`);
    }
    console.log('');

    // Test 5: Citation analysis
    console.log('Test 5: Citation analysis for a patent');
    const citations = await client.getPatentCitations('10000000');
    
    console.log(`✓ Citation analysis complete`);
    console.log(`  Backward citations (cited by this patent): ${citations.backward.length}`);
    console.log(`  Forward citations (citing this patent): ${citations.forward.length}`);
    
    if (citations.backward.length > 0) {
      const firstCited = citations.backward[0];
      console.log(`  Sample cited patent: ${firstCited.cited_patent_number}`);
    }
    
    if (citations.forward.length > 0) {
      const firstCiting = citations.forward[0];
      console.log(`  Sample citing patent: ${firstCiting.patent_number} - ${firstCiting.patent_title?.substring(0, 50)}...`);
    }
    console.log('');

    // Test 6: Advanced query with multiple conditions
    console.log('Test 6: Advanced query - AI patents from Google in 2023');
    const advancedResults = await client.searchPatents({
      query: {
        _and: [
          { _text_any: { patent_title: 'artificial intelligence' } },
          { 'assignees.assignee_organization': 'Google LLC' },
          { _gte: { patent_date: '2023-01-01' } },
          { _lte: { patent_date: '2023-12-31' } },
        ],
      },
      fields: ['patent_id', 'patent_number', 'patent_title', 'patent_date', 'assignees'],
      options: { size: 10 },
    });
    
    console.log(`✓ Found ${advancedResults.total_hits} matching patents`);
    console.log(`  Retrieved ${advancedResults.count} patents`);
    advancedResults.patents.slice(0, 3).forEach(p => {
      console.log(`  - ${p.patent_number}: ${p.patent_title?.substring(0, 60)}...`);
    });
    console.log('');

    // Test 7: Pagination example
    console.log('Test 7: Pagination example - fetching multiple pages');
    let totalFetched = 0;
    let pageCount = 0;
    const maxPages = 3; // Limit for testing
    
    for await (const page of client.searchPaginated(
      {
        query: { _gte: { patent_date: '2024-01-01' } },
        fields: ['patent_id', 'patent_number', 'patent_date'],
        sort: [{ patent_date: 'desc' }],
      },
      25 // Small page size for testing
    )) {
      pageCount++;
      totalFetched += page.length;
      console.log(`  Page ${pageCount}: Retrieved ${page.length} patents (total: ${totalFetched})`);
      
      if (pageCount >= maxPages) {
        console.log(`  Stopping at ${maxPages} pages for demo purposes`);
        break;
      }
    }
    console.log('');

    console.log('=== All PatentsView API Tests Passed ✓ ===');

  } catch (error) {
    console.error('\n✗ Error during testing:', error);
    
    if (error.message?.includes('PATENTSVIEW_API_KEY')) {
      console.error('\nℹ Please set PATENTSVIEW_API_KEY in your .env file');
      console.error('  Request an API key at: https://patentsview-support.atlassian.net/servicedesk/customer/portal/1/group/1/create/18');
    }
    
    process.exit(1);
  }
}

// Run the test
testPatentsViewAPI().catch(console.error);
