import { PrismaClient } from '@prisma/client';
import { SessionSectionParser } from '../../parsers/SessionSectionParser';

const prisma = new PrismaClient();

async function testAddressPreservation() {
  console.log('\n=== Testing Address Preservation in SessionSection ===\n');
  
  // Test data that mimics the actual transcript format
  const testLines = [
    '17     FOR THE PLAINTIFF:',
    '18     MR. ALFRED R. FABRICANT',
    '          MR. PETER LAMBRIANAKOS',
    '19     MR. VINCENT J. RUBINO, III',
    '          MS. AMY PARK',
    '20     MR. ENRIQUE ITURRALDE',
    '          FABRICANT LLP',
    '21     230 Park Avenue, 3rd Floor W.',
    '          New York, NY 10169',
    '',
    '22     MR. SAMUEL F. BAXTER',
    '          MS. JENNIFER L. TRUELOVE',
    '          MCKOOL SMITH, P.C.',
    '23     104 East Houston Street, Suite 300',
    '          Marshall, TX 75670',
    '',
    '24     FOR THE DEFENDANTS:',
    '25     MR. JOSEPH R. RE',
    '          ALAN G. LAQUER',
    '          KENDALL M. LOEBBAKA',
    '26     JOSHUA J. STOWELL',
    '          KNOBBE, MARTENS, OLSON & BEAR, LLP',
    '27     2040 Main Street, Fourteenth Floor',
    '          Irvine, CA 92614'
  ];
  
  // Create a test session and trial
  const trial = await prisma.trial.create({
    data: {
      caseNumber: 'TEST-001',
      name: 'Test Case',
      court: 'Test Court',
      plaintiff: 'Test Plaintiff',
      defendant: 'Test Defendant',
      caseHandle: 'test-case'
    }
  });
  
  const session = await prisma.session.create({
    data: {
      trialId: trial.id,
      sessionDate: new Date(),
      sessionType: 'MORNING',
      fileName: 'test.txt'
    }
  });
  
  // Test the SessionSectionParser
  const parser = new SessionSectionParser(prisma);
  await parser.parseSummarySections(testLines, session.id, trial.id);
  
  // Retrieve and check the APPEARANCES section
  const appearances = await prisma.sessionSection.findFirst({
    where: {
      sessionId: session.id,
      sectionType: 'APPEARANCES'
    }
  });
  
  if (appearances) {
    console.log('APPEARANCES Section Text:');
    console.log('=' .repeat(50));
    console.log(appearances.sectionText);
    console.log('=' .repeat(50));
    
    // Check for specific addresses
    const checks = [
      { text: '230 Park Avenue', description: 'Fabricant LLP address line 1' },
      { text: 'New York, NY 10169', description: 'Fabricant LLP address line 2' },
      { text: '104 East Houston Street', description: 'McKool Smith address line 1' },
      { text: 'Marshall, TX 75670', description: 'McKool Smith address line 2' },
      { text: '2040 Main Street', description: 'Knobbe Martens address line 1' },
      { text: 'Irvine, CA 92614', description: 'Knobbe Martens address line 2' }
    ];
    
    console.log('\nAddress Preservation Checks:');
    let allPassed = true;
    for (const check of checks) {
      if (appearances.sectionText.includes(check.text)) {
        console.log(`✓ ${check.description}: "${check.text}" found`);
      } else {
        console.log(`✗ ${check.description}: "${check.text}" NOT found`);
        allPassed = false;
        
        // Check if it's partially there (might be cut off)
        const partial = check.text.substring(0, 10);
        if (appearances.sectionText.includes(partial)) {
          console.log(`  ⚠ Partial match found: "${partial}..."`);
        }
      }
    }
    
    // Check for incorrectly removed text
    const incorrectRemovals = [
      'rk Avenue',  // Should be "Park Avenue" not "rk Avenue"
      'st Houston', // Should be "East Houston" not "st Houston"
      '0 Main',     // Should be "2040 Main" not "0 Main"
    ];
    
    console.log('\nChecking for incorrect removals:');
    for (const badText of incorrectRemovals) {
      if (appearances.sectionText.includes(badText)) {
        console.log(`✗ Found incorrectly truncated text: "${badText}"`);
        allPassed = false;
      }
    }
    
    if (allPassed) {
      console.log('\n✅ All addresses preserved correctly!');
    } else {
      console.log('\n❌ Some addresses were not preserved correctly');
    }
    
  } else {
    console.log('❌ No APPEARANCES section found!');
  }
  
  // Clean up test data
  await prisma.sessionSection.deleteMany({ where: { sessionId: session.id } });
  await prisma.session.delete({ where: { id: session.id } });
  await prisma.trial.delete({ where: { id: trial.id } });
  
  await prisma.$disconnect();
}

testAddressPreservation().catch(console.error);