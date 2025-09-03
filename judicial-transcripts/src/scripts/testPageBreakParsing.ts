#!/usr/bin/env ts-node

import * as fs from 'fs';
import { SmartPageHeaderParser } from '../parsers/SmartPageHeaderParser';

// Read a file and test page break parsing
function testPageBreaks(filePath: string) {
  console.log(`Testing file: ${filePath}`);
  console.log('=' .repeat(80));
  
  // Read file content
  const content = fs.readFileSync(filePath, 'utf-8');
  
  // Split by form feed character
  const pages = content.split('\f');
  console.log(`Found ${pages.length} pages by splitting on form feed\n`);
  
  // Create parser with pageHeaderLines = 4
  const parser = new SmartPageHeaderParser(4);
  
  // Test first few pages
  for (let i = 0; i < Math.min(5, pages.length); i++) {
    console.log(`\n--- Page ${i + 1} ---`);
    
    const pageContent = pages[i];
    const lines = pageContent.split('\n');
    
    // Show first 6 lines of the page
    console.log('First 6 lines of page:');
    for (let j = 0; j < Math.min(6, lines.length); j++) {
      const line = lines[j];
      if (line.trim()) {
        console.log(`  Line ${j}: "${line.substring(0, 100)}${line.length > 100 ? '...' : ''}"`);
      } else {
        console.log(`  Line ${j}: [blank]`);
      }
    }
    
    // Parse header
    const result = parser.parseHeader(lines, 0);
    
    console.log('\nParsed header results:');
    console.log(`  Case Number: ${result.caseNumber}`);
    console.log(`  Page Number: ${result.parsedPageNumber} of ${result.parsedTotalPages}`);
    console.log(`  Trial Page: ${result.parsedTrialPage}`);
    console.log(`  PageID: ${result.pageId}`);
    console.log(`  Header Lines Used: ${result.headerLinesUsed}`);
    console.log(`  Remaining Lines: ${result.remainingLines.length}`);
    
    // Show what we captured as header
    if (result.fullHeaderText) {
      console.log(`  Full header text (${result.fullHeaderText.length} chars):`);
      const headerLines = result.fullHeaderText.split('\n');
      headerLines.forEach((line, idx) => {
        console.log(`    H${idx}: "${line.substring(0, 80)}${line.length > 80 ? '...' : ''}"`);
      });
    }
  }
}

// Test the Flexuspine file
const flexuspineFile = 'output/multi-trial/23 Flexuspine V. Globus Medical/Flexuspine V. Globus Medical August 15, 2016 PM.txt';
testPageBreaks(flexuspineFile);

// Also check if form feed is at end of lines
console.log('\n' + '=' .repeat(80));
console.log('Checking for form feeds at end of lines:');
const content = fs.readFileSync(flexuspineFile, 'utf-8');
const lines = content.split('\n');
let ffCount = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\f')) {
    ffCount++;
    const ffIndex = lines[i].indexOf('\f');
    const beforeFF = lines[i].substring(Math.max(0, ffIndex - 20), ffIndex);
    const afterFF = lines[i].substring(ffIndex + 1, Math.min(lines[i].length, ffIndex + 21));
    console.log(`  Line ${i}: ...${beforeFF}[FF]${afterFF}...`);
    if (ffCount <= 3) {
      console.log(`    Full line: "${lines[i].replace(/\f/g, '[FF]').substring(0, 150)}..."`);
    }
  }
}
console.log(`Total lines with form feed: ${ffCount}`);