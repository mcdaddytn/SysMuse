#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Baseline counts from docs/baseline-record-counts.md
const BASELINE_COUNTS = {
  trial: 1,
  session: 12,
  page: 1533,
  line: 38550,
  speaker: 81,
  attorney: 19,
  lawFirm: 6,
  lawFirmOffice: 7,
  trialAttorney: 19,
  witness: 16,
  witnessCalledEvent: 58,
  judge: 1,
  juror: 39,
  statementEvent: 12265,
  trialEvent: 12480,
  anonymousSpeaker: 6,
  courtReporter: 1,
  sessionSection: 108,
  address: 7
};

async function runRegressionTest() {
  console.log('🔍 Running Regression Tests Against Baseline\n');
  console.log('Reference: docs/baseline-record-counts.md\n');
  
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  
  // Table header
  console.log('Table'.padEnd(25) + 'Actual'.padEnd(10) + 'Expected'.padEnd(10) + 'Status');
  console.log('-'.repeat(55));
  
  for (const [table, expectedCount] of Object.entries(BASELINE_COUNTS)) {
    try {
      const actualCount = await (prisma as any)[table].count();
      
      if (actualCount === expectedCount) {
        console.log(
          `${table.padEnd(25)}${actualCount.toString().padEnd(10)}${expectedCount.toString().padEnd(10)}✅`
        );
        passed++;
      } else {
        const diff = actualCount - expectedCount;
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        console.log(
          `${table.padEnd(25)}${actualCount.toString().padEnd(10)}${expectedCount.toString().padEnd(10)}❌ (${diffStr})`
        );
        failed++;
        failures.push(`${table}: expected ${expectedCount}, got ${actualCount} (diff: ${diffStr})`);
      }
    } catch (error) {
      console.log(
        `${table.padEnd(25)}${'ERROR'.padEnd(10)}${expectedCount.toString().padEnd(10)}❌`
      );
      failed++;
      failures.push(`${table}: error accessing table`);
    }
  }
  
  console.log('\n' + '='.repeat(55));
  console.log('\n📊 Regression Test Summary:');
  console.log(`  Total Tests: ${Object.keys(BASELINE_COUNTS).length}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  
  const passRate = ((passed / Object.keys(BASELINE_COUNTS).length) * 100).toFixed(1);
  console.log(`  Pass Rate: ${passRate}%`);
  
  if (failures.length > 0) {
    console.log('\n❌ Failed Tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    
    // Provide helpful hints
    console.log('\n💡 Troubleshooting Tips:');
    
    if (failures.some(f => f.includes('attorney'))) {
      console.log('  - Attorney issues: Check summary parsing in Phase 1');
    }
    if (failures.some(f => f.includes('witness'))) {
      console.log('  - Witness issues: Check witness detection patterns in Phase 2');
    }
    if (failures.some(f => f.includes('speaker'))) {
      console.log('  - Speaker issues: Check for duplicate speaker creation');
    }
    if (failures.some(f => f.includes('line') || f.includes('page'))) {
      console.log('  - Line/Page issues: Verify all transcript files are being processed');
    }
    
    console.log('\nTo debug further:');
    console.log('  1. Check if all 12 transcript files were processed');
    console.log('  2. Review Phase 1 and Phase 2 logs for errors');
    console.log('  3. Ensure you\'re using the correct parser mode (legacy vs multi-pass)');
    
    process.exit(1);
  } else {
    console.log('\n✅ All regression tests passed! The system matches baseline expectations.');
  }
  
  await prisma.$disconnect();
}

// Run the test
runRegressionTest().catch(error => {
  console.error('❌ Regression test failed with error:', error);
  process.exit(1);
});