import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAddresses() {
  console.log('\n=== Checking Address Preservation ===\n');
  
  const appearances = await prisma.sessionSection.findFirst({
    where: {
      sectionType: 'APPEARANCES'
    }
  });
  
  if (appearances) {
    console.log('APPEARANCES Section (first 1000 chars):');
    console.log('=' .repeat(60));
    console.log(appearances.sectionText.substring(0, 1000));
    console.log('=' .repeat(60));
    
    // Check for addresses that should be present
    const addressChecks = [
      '230 Park Avenue',
      '104 East Houston',
      '2040 Main Street',
      'New York, NY',
      'Marshall, TX',
      'Irvine, CA',
      'Seattle, WA',
      'Texarkana, TX',
      'Mountain View, CA',
      'Tyler, TX'
    ];
    
    console.log('\nAddress preservation checks:');
    let foundCount = 0;
    for (const addr of addressChecks) {
      if (appearances.sectionText.includes(addr)) {
        console.log(`✓ Found: "${addr}"`);
        foundCount++;
      } else {
        console.log(`✗ Missing: "${addr}"`);
        // Check for partial matches (indicating truncation)
        const partial = addr.substring(Math.min(3, addr.length));
        if (appearances.sectionText.includes(partial)) {
          console.log(`  ⚠ Partial match found for: "${partial}"`);
        }
      }
    }
    
    // Check for incorrectly truncated text patterns
    const badPatterns = [
      /^\d{1,3}\s+[A-Z]/gm,  // Line starting with just numbers (indicates bad cleaning)
      /rk Avenue/,           // Should be "Park Avenue"
      /st Houston/,          // Should be "East Houston"  
      /urth Avenue/,         // Should be "Fourth Avenue"
      /lifornia Street/      // Should be "California Street"
    ];
    
    console.log('\nChecking for truncation issues:');
    let issueCount = 0;
    for (const pattern of badPatterns) {
      const match = appearances.sectionText.match(pattern);
      if (match) {
        console.log(`✗ Found truncation issue: "${match[0]}"`);
        issueCount++;
      }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Addresses found: ${foundCount}/${addressChecks.length}`);
    console.log(`Truncation issues: ${issueCount}`);
    
    if (foundCount === addressChecks.length && issueCount === 0) {
      console.log('✅ All addresses preserved correctly!');
    } else {
      console.log('⚠ Some address preservation issues detected');
    }
    
  } else {
    console.log('No APPEARANCES section found in database');
  }
  
  await prisma.$disconnect();
}

checkAddresses().catch(console.error);