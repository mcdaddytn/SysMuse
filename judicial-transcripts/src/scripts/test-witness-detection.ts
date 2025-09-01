/**
 * Feature 03C: Test script for witness detection and case number extraction
 */

import { witnessDetectionService } from '../services/WitnessDetectionService';
import { caseNumberExtractor } from '../utils/CaseNumberExtractor';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testWitnessDetection() {
  console.log('=== Testing Witness Detection Service ===\n');
  
  // Test with known patterns
  const testResults = witnessDetectionService.testPatterns();
  
  console.log('Pattern Test Results:');
  for (const result of testResults) {
    console.log(`Input: "${result.line}"`);
    if (result.detected && result.witness) {
      console.log(`✅ Detected: ${result.witness.name} (${result.witness.party}, ${result.witness.swornStatus})`);
      console.log(`   Confidence: ${result.witness.confidence}`);
    } else {
      console.log(`❌ Not detected`);
    }
    console.log('---');
  }
  
  // Test with database data if available
  try {
    const witnessLines = await prisma.line.findMany({
      where: {
        AND: [
          { text: { contains: 'WITNESS' } },
          { text: { contains: 'SWORN' } }
        ]
      },
      take: 20
    });
    
    if (witnessLines.length > 0) {
      console.log('\n=== Testing with Database Data ===\n');
      
      for (const line of witnessLines) {
        const witness = witnessDetectionService.detectWitness(line.text || '');
        if (witness) {
          console.log(`✅ Line ${line.lineNumber}: ${witness.name}`);
          console.log(`   Party: ${witness.party || 'Unknown'}`);
          console.log(`   Status: ${witness.swornStatus}`);
          console.log(`   Has Title: ${witness.hasTitle}`);
        } else {
          console.log(`❌ Line ${line.lineNumber}: Failed to detect witness`);
          console.log(`   Text: ${line.text}`);
        }
        console.log('---');
      }
      
      // Statistics
      const detectedCount = witnessLines.filter(l => 
        witnessDetectionService.detectWitness(l.text || '') !== null
      ).length;
      
      console.log(`\nDetection Rate: ${detectedCount}/${witnessLines.length} (${(detectedCount/witnessLines.length*100).toFixed(1)}%)`);
    } else {
      console.log('\nNo witness lines found in database');
    }
  } catch (error) {
    console.log('\nCould not test with database data:', error);
  }
}

async function testCaseNumberExtraction() {
  console.log('\n=== Testing Case Number Extraction ===\n');
  
  // Test with known patterns
  caseNumberExtractor.testExtractor();
  
  // Test with sample page headers
  const sampleHeaders = [
    `1                    Case 2:19-CV-00123-JRG Document 456 Filed 01/01/20 Page 1 of 150`,
    `     Civil Action No. 2:14-CV-00033-JRG
     UNITED STATES DISTRICT COURT
     EASTERN DISTRICT OF TEXAS`,
    `Page 1
     CAUSE NO. 6:20-CV-00459-ADA
     IN THE UNITED STATES DISTRICT COURT`,
    `Random header without case number
     Trial Transcript
     January 1, 2020`
  ];
  
  console.log('\nTesting with sample headers:');
  for (const header of sampleHeaders) {
    const result = caseNumberExtractor.extractFromPageHeader(header);
    console.log(`Header: "${header.substring(0, 50)}..."`);
    if (result) {
      console.log(`✅ Extracted: ${result.caseNumber} (${result.format}, confidence: ${result.confidence})`);
    } else {
      console.log(`❌ No case number found`);
    }
    console.log('---');
  }
  
  // Test with database data if available
  try {
    const firstPages = await prisma.page.findMany({
      where: { pageNumber: 1 },
      include: {
        lines: {
          where: { lineNumber: { lte: 5 } },
          orderBy: { lineNumber: 'asc' }
        },
        session: {
          include: { trial: true }
        }
      },
      take: 5
    });
    
    if (firstPages.length > 0) {
      console.log('\n=== Testing with Database Pages ===\n');
      
      for (const page of firstPages) {
        const headerText = page.lines.map(l => l.text).join('\n');
        const result = caseNumberExtractor.extractFromLines(page.lines.map(l => l.text || ''));
        
        console.log(`Trial: ${page.session.trial.name}`);
        console.log(`Current Case Number: ${page.session.trial.caseNumber}`);
        
        if (result) {
          console.log(`✅ Extracted: ${result.caseNumber}`);
          const matches = result.caseNumber === page.session.trial.caseNumber;
          console.log(`   ${matches ? '✅' : '⚠️'} ${matches ? 'Matches' : 'Different from'} database`);
        } else {
          console.log(`❌ Could not extract case number`);
        }
        console.log('---');
      }
    } else {
      console.log('\nNo pages found in database');
    }
  } catch (error) {
    console.log('\nCould not test with database data:', error);
  }
}

async function main() {
  await testWitnessDetection();
  await testCaseNumberExtraction();
  
  await prisma.$disconnect();
}

main().catch(console.error);