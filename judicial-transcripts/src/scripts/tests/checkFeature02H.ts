import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkFeature02H() {
  console.log('\n=== Feature 02H Verification ===\n');
  
  // 1. Check documentSection distribution
  const sections = await prisma.line.groupBy({
    by: ['documentSection'],
    _count: true,
    orderBy: {
      _count: {
        documentSection: 'desc'
      }
    }
  });
  
  console.log('1. Document Section Distribution:');
  sections.forEach((s: any) => {
    console.log(`   ${s.documentSection}: ${s._count} lines`);
  });
  
  const totalLines = await prisma.line.count();
  console.log(`   Total lines: ${totalLines}`);
  
  // Success criteria: Should have SUMMARY, PROCEEDINGS, and potentially CERTIFICATION
  const sectionTypes = sections.map((s: any) => s.documentSection);
  if (sectionTypes.includes('SUMMARY')) {
    console.log('   ✓ SUMMARY lines are being captured');
  } else {
    console.log('   ✗ SUMMARY lines are NOT being captured');
  }
  
  if (sectionTypes.includes('CERTIFICATION')) {
    console.log('   ✓ CERTIFICATION lines are being captured');
  } else {
    console.log('   ⚠ CERTIFICATION lines not found (may not be in transcripts)');
  }
  
  // 2. Check SessionSection text cleaning
  console.log('\n2. SessionSection Text Cleaning:');
  const sessionSections = await prisma.sessionSection.findMany({
    take: 3,
    where: {
      sectionType: 'APPEARANCES'
    }
  });
  
  let hasLinePrefix = false;
  sessionSections.forEach((s: any) => {
    const preview = s.sectionText.substring(0, 80);
    console.log(`   Sample: "${preview}..."`);
    
    // Check for various line prefix patterns
    if (/^\s*\d{1,2}\s{5,}/.test(s.sectionText) || // SUMMARY format: "17     "
        /^\d{2}:\d{2}:\d{2}\s+\d+/.test(s.sectionText) || // PROCEEDINGS format
        /^\s*\d+\s+\w/.test(s.sectionText)) { // Simple number + text
      console.log('   ✗ Still contains line prefixes!');
      hasLinePrefix = true;
    } else {
      console.log('   ✓ Clean text (no line prefixes)');
    }
  });
  
  // 3. Check line numbering continuity
  console.log('\n3. Line Numbering Continuity:');
  
  // Check a sample session
  const session = await prisma.session.findFirst({
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        include: {
          lines: {
            orderBy: { lineNumber: 'asc' },
            take: 5
          }
        }
      }
    }
  });
  
  if (session && session.pages.length > 0) {
    console.log(`   Session ${session.id} has ${session.pages.length} pages`);
    
    // Check that line numbers reset per page
    let lastSessionLineNum = 0;
    session.pages.forEach((page: any, idx: number) => {
      if (page.lines.length > 0) {
        const firstLine = page.lines[0];
        const lastLine = page.lines[page.lines.length - 1];
        console.log(`   Page ${page.pageNumber}: lineNumbers ${firstLine.lineNumber}-${lastLine.lineNumber}, sessionLineNumbers ${firstLine.sessionLineNumber}-${lastLine.sessionLineNumber}`);
        
        // Verify page line numbers start at 1
        if (firstLine.lineNumber !== 1 && idx > 0) {
          console.log(`   ✗ Page ${page.pageNumber} doesn't start with lineNumber 1`);
        }
        
        // Verify session line numbers are continuous
        if (lastSessionLineNum > 0 && firstLine.sessionLineNumber !== lastSessionLineNum + 1) {
          console.log(`   ✗ Session line numbers not continuous between pages`);
        }
        lastSessionLineNum = lastLine.sessionLineNumber;
      }
    });
  }
  
  // 4. Summary
  console.log('\n=== Summary ===');
  const summaryCount = sections.find((s: any) => s.documentSection === 'SUMMARY')?._count || 0;
  const proceedingsCount = sections.find((s: any) => s.documentSection === 'PROCEEDINGS')?._count || 0;
  const certificationCount = sections.find((s: any) => s.documentSection === 'CERTIFICATION')?._count || 0;
  
  console.log(`✓ Total lines stored: ${totalLines}`);
  console.log(`${summaryCount > 0 ? '✓' : '✗'} SUMMARY lines: ${summaryCount}`);
  console.log(`${proceedingsCount > 0 ? '✓' : '✗'} PROCEEDINGS lines: ${proceedingsCount}`);
  console.log(`${certificationCount > 0 ? '✓' : '⚠'} CERTIFICATION lines: ${certificationCount}`);
  console.log(`${!hasLinePrefix ? '✓' : '✗'} SessionSection text cleaning: ${!hasLinePrefix ? 'Clean' : 'Has line prefixes'}`);
  
  await prisma.$disconnect();
}

checkFeature02H().catch(console.error);