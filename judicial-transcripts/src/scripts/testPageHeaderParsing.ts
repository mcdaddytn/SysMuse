#!/usr/bin/env ts-node

import { SmartPageHeaderParser } from '../parsers/SmartPageHeaderParser';
import logger from '../utils/logger';

// Test various header formats
const testCases = [
  {
    name: 'Standard Format',
    lines: [
      'Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200',
      '1:1 - 25:25                                                    1',
      '',
      '1   THE COURT: Good morning, everyone.'
    ]
  },
  {
    name: 'Inverted Format',
    lines: [
      '1',
      'Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200',
      '1:1 - 25:25',
      '',
      '1   THE COURT: Good morning, everyone.'
    ]
  },
  {
    name: 'Split with Whitespace',
    lines: [
      'Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200',
      '',
      '1:1 - 25:25',
      '1',
      '1   THE COURT: Good morning, everyone.'
    ]
  },
  {
    name: 'Combined on One Line',
    lines: [
      'Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200',
      '1:1 - 25:25    1',
      '',
      '1   THE COURT: Good morning, everyone.'
    ]
  },
  {
    name: 'Extra Whitespace',
    lines: [
      'Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 1 of 200',
      '',
      '',
      '1:1 - 25:25                                                    1',
      '1   THE COURT: Good morning, everyone.'
    ]
  }
];

function runTests() {
  logger.info('Testing Smart Page Header Parser');
  logger.info('=' . repeat(60));
  
  // Test with pageHeaderLines = 3
  const parser3 = new SmartPageHeaderParser(3);
  
  // Test with pageHeaderLines = 4
  const parser4 = new SmartPageHeaderParser(4);
  
  for (const testCase of testCases) {
    logger.info(`\nTest: ${testCase.name}`);
    logger.info('-' . repeat(40));
    
    // Test with 3 header lines
    const result3 = parser3.parseHeader(testCase.lines, 0);
    logger.info('With pageHeaderLines=3:');
    logger.info(`  Case Number: ${result3.caseNumber}`);
    logger.info(`  Page Number: ${result3.parsedPageNumber} of ${result3.parsedTotalPages}`);
    logger.info(`  Trial Page: ${result3.parsedTrialPage}`);
    logger.info(`  Line Range: ${result3.startLineNumber} - ${result3.endLineNumber}`);
    logger.info(`  Header Lines Used: ${result3.headerLinesUsed}`);
    logger.info(`  Remaining Lines: ${result3.remainingLines.length}`);
    
    // Test with 4 header lines
    const result4 = parser4.parseHeader(testCase.lines, 0);
    logger.info('\nWith pageHeaderLines=4:');
    logger.info(`  Case Number: ${result4.caseNumber}`);
    logger.info(`  Page Number: ${result4.parsedPageNumber} of ${result4.parsedTotalPages}`);
    logger.info(`  Trial Page: ${result4.parsedTrialPage}`);
    logger.info(`  Line Range: ${result4.startLineNumber} - ${result4.endLineNumber}`);
    logger.info(`  Header Lines Used: ${result4.headerLinesUsed}`);
    logger.info(`  Remaining Lines: ${result4.remainingLines.length}`);
    
    // Verify we're not losing transcript content
    if (result3.remainingLines.length > 0) {
      logger.info(`  First remaining line: "${result3.remainingLines[0]}"`);
    }
  }
  
  logger.info('\n' + '=' . repeat(60));
  logger.info('Test complete!');
}

// Test page break detection
function testPageBreaks() {
  logger.info('\nTesting Page Break Detection');
  logger.info('=' . repeat(60));
  
  const linesWithPageBreak = [
    'Last line of page 1',
    '\f',  // Form feed character
    'Case 2:13-CV-1112-JRG    JURY TRIAL    Day 1    Page 2 of 200',
    '26:1 - 50:25                                                  2',
    '',
    '26  Q. Can you continue?'
  ];
  
  // Find page breaks
  const pageBreaks: number[] = [];
  for (let i = 0; i < linesWithPageBreak.length; i++) {
    if (linesWithPageBreak[i].includes('\f')) {
      logger.info(`Found page break at line ${i}`);
      if (i + 1 < linesWithPageBreak.length) {
        pageBreaks.push(i + 1);
        logger.info(`Next page starts at line ${i + 1}: "${linesWithPageBreak[i + 1]}"`);
      }
    }
  }
  
  logger.info(`Total page breaks found: ${pageBreaks.length}`);
}

// Run the tests
runTests();
testPageBreaks();