import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyFeature02I() {
  try {
    console.log('\n=== Feature 02I Verification ===\n');
    
    // 1. Check that parsedTrialPage field exists and has values
    const pagesWithParsedTrialPage = await prisma.page.findMany({
      where: {
        parsedTrialPage: {
          not: null
        }
      },
      select: {
        id: true,
        sessionId: true,
        pageNumber: true,
        trialPageNumber: true,
        parsedTrialPage: true,
        pageId: true,
        headerText: true
      },
      take: 10,
      orderBy: {
        id: 'asc'
      }
    });
    
    console.log(`✅ Found ${pagesWithParsedTrialPage.length} pages with parsedTrialPage field`);
    if (pagesWithParsedTrialPage.length > 0) {
      console.log('\nSample pages:');
      pagesWithParsedTrialPage.slice(0, 3).forEach(page => {
        console.log(`  Page ${page.pageNumber}: parsedTrialPage=${page.parsedTrialPage}, trialPageNumber=${page.trialPageNumber}, pageId=${page.pageId}`);
        if (page.headerText) {
          console.log(`    Header: ${page.headerText.substring(0, 100)}...`);
        }
      });
    }
    
    // 2. Check for SUMMARY pages in each session
    const sessions = await prisma.session.findMany({
      include: {
        pages: {
          where: {
            OR: [
              { headerText: { contains: 'Page 1 of' } },
              { headerText: { contains: 'Page 2 of' } },
              { headerText: { contains: 'Page 3 of' } }
            ]
          },
          orderBy: {
            pageNumber: 'asc'
          }
        }
      },
      take: 3
    });
    
    console.log('\n✅ SUMMARY Pages per Session:');
    for (const session of sessions) {
      console.log(`\nSession ${session.id} (${session.sessionType}):`);
      const summaryPages = await prisma.page.findMany({
        where: {
          sessionId: session.id,
          pageNumber: {
            lte: 3  // First 3 pages are typically SUMMARY pages
          }
        },
        orderBy: {
          pageNumber: 'asc'
        }
      });
      
      console.log(`  Found ${summaryPages.length} pages in summary section`);
      summaryPages.forEach(page => {
        console.log(`    Page ${page.pageNumber}: trialPageNumber=${page.trialPageNumber}, parsedTrialPage=${page.parsedTrialPage}`);
      });
      
      // Check if these values are equal for the first transcript
      if (session.id === 1) {
        const allEqual = summaryPages.every(page => 
          page.pageNumber === page.trialPageNumber && 
          (page.parsedTrialPage === null || page.pageNumber === page.parsedTrialPage)
        );
        console.log(`  ✅ For first transcript, pageNumber === trialPageNumber: ${allEqual}`);
      }
    }
    
    // 3. Check line distribution across pages
    console.log('\n✅ Line Distribution:');
    const pagesWithLineCounts = await prisma.page.findMany({
      where: {
        sessionId: 1  // Check first session
      },
      include: {
        _count: {
          select: {
            lines: true
          }
        }
      },
      orderBy: {
        pageNumber: 'asc'
      },
      take: 5
    });
    
    pagesWithLineCounts.forEach(page => {
      console.log(`  Page ${page.pageNumber}: ${page._count.lines} lines`);
    });
    
    // 4. Check that no SessionSection has sectionType='HEADER'
    const headerSections = await prisma.sessionSection.findMany({
      where: {
        sectionType: 'HEADER'
      }
    });
    
    if (headerSections.length === 0) {
      console.log('\n✅ No SessionSection records with sectionType=HEADER (correct!)');
    } else {
      console.log(`\n⚠️ Found ${headerSections.length} SessionSection records with sectionType=HEADER (should be 0)`);
    }
    
    // 5. Verify that page headers are stored in Page.headerText
    const pagesWithHeaders = await prisma.page.count({
      where: {
        headerText: {
          not: null
        }
      }
    });
    
    console.log(`\n✅ Pages with headerText: ${pagesWithHeaders}`);
    
    // 6. Check a specific issue from feature spec: Page 2 should exist
    const page2InSession1 = await prisma.page.findFirst({
      where: {
        sessionId: 1,
        pageNumber: 2
      }
    });
    
    if (page2InSession1) {
      console.log('\n✅ Page 2 exists in Session 1 (issue fixed!)');
      console.log(`  Page ID: ${page2InSession1.id}`);
      console.log(`  Trial Page Number: ${page2InSession1.trialPageNumber}`);
      console.log(`  Parsed Trial Page: ${page2InSession1.parsedTrialPage}`);
      
      // Count lines on page 2
      const page2Lines = await prisma.line.count({
        where: {
          pageId: page2InSession1.id
        }
      });
      console.log(`  Lines on page 2: ${page2Lines}`);
    } else {
      console.log('\n❌ Page 2 does not exist in Session 1 (issue NOT fixed)');
    }
    
    console.log('\n=== Verification Complete ===\n');
    
  } catch (error) {
    console.error('Verification failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyFeature02I();