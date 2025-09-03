#!/usr/bin/env ts-node

import * as fs from 'fs';

// Test page detection on a problematic file
const testFile = 'output/multi-trial/23 Flexuspine V. Globus Medical/Flexuspine V. Globus Medical August 16, 2016 AM.txt';

console.log(`Testing: ${testFile}`);
console.log('=' .repeat(80));

// Read the file
const content = fs.readFileSync(testFile, 'utf-8');
const lines = content.split('\n');

console.log(`Total lines: ${lines.length}`);

// Method 1: Split by form feed
const pages = content.split('\f');
console.log(`Pages found by splitting on \\f: ${pages.length}\n`);

// Show what's at page boundaries
for (let i = 0; i < Math.min(5, pages.length); i++) {
  console.log(`\nPage ${i + 1}:`);
  const pageLines = pages[i].split('\n');
  
  // Show last 2 lines of this page (if not first page)
  if (i > 0) {
    const prevPageLines = pages[i-1].split('\n');
    console.log('  Last 2 lines of previous page:');
    for (let j = Math.max(0, prevPageLines.length - 2); j < prevPageLines.length; j++) {
      console.log(`    [${j}]: "${prevPageLines[j].substring(0, 80)}${prevPageLines[j].length > 80 ? '...' : ''}"`);
    }
  }
  
  console.log('  First 5 lines of this page:');
  for (let j = 0; j < Math.min(5, pageLines.length); j++) {
    const line = pageLines[j];
    if (line.trim()) {
      console.log(`    [${j}]: "${line.substring(0, 80)}${line.length > 80 ? '...' : ''}"`);
    } else {
      console.log(`    [${j}]: [blank]`);
    }
  }
}

// Check page 10 specifically since that's where issues start
console.log('\n' + '=' .repeat(80));
console.log('Checking Page 10 specifically:');
if (pages.length >= 10) {
  const page10Lines = pages[9].split('\n'); // 0-indexed
  console.log('First 10 lines of page 10:');
  for (let i = 0; i < Math.min(10, page10Lines.length); i++) {
    const line = page10Lines[i];
    console.log(`  Line ${i}: "${line.substring(0, 100)}${line.length > 100 ? '...' : ''}"`);
  }
}

// Method 2: Check where form feeds are in the line array
console.log('\n' + '=' .repeat(80));
console.log('Lines containing form feed character:');
let ffCount = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('\f')) {
    ffCount++;
    if (ffCount <= 5) {
      console.log(`  Line ${i}: "${lines[i].replace(/\f/g, '[FF]').substring(0, 100)}..."`);
      // Show next line too
      if (i + 1 < lines.length) {
        console.log(`    Next line ${i+1}: "${lines[i+1].substring(0, 100)}..."`);
      }
    }
  }
}
console.log(`Total lines with form feed: ${ffCount}`);