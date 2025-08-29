import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testImprovements() {
  try {
    // Check for Lines with linePrefix
    const linesWithPrefix = await prisma.line.findMany({
      where: {
        linePrefix: {
          not: null
        }
      },
      take: 5
    });
    
    console.log(`Lines with linePrefix: ${linesWithPrefix.length}`);
    if (linesWithPrefix.length > 0) {
      console.log('Sample line with prefix:');
      const sample = linesWithPrefix[0];
      console.log(`  Line ID: ${sample.id}`);
      console.log(`  Line prefix: "${sample.linePrefix}"`);
      console.log(`  Text: "${sample.text}"`);
      console.log(`  Timestamp: ${sample.timestamp}`);
      console.log(`  DateTime: ${sample.dateTime}`);
    }
    
    // Check for Pages with parsedTrialLine
    const pagesWithParsedTrialLine = await prisma.page.findMany({
      where: {
        parsedTrialLine: {
          not: null
        }
      },
      take: 5
    });
    
    console.log(`\nPages with parsedTrialLine: ${pagesWithParsedTrialLine.length}`);
    if (pagesWithParsedTrialLine.length > 0) {
      console.log('Sample page:');
      const page = pagesWithParsedTrialLine[0];
      console.log(`  Page ID: ${page.id}`);
      console.log(`  Trial page number: ${page.trialPageNumber}`);
      console.log(`  Parsed trial line: ${page.parsedTrialLine}`);
      console.log(`  Header text: ${page.headerText?.substring(0, 100)}...`);
    }
    
    // Check for Lines with dateTime
    const linesWithDateTime = await prisma.line.count({
      where: {
        dateTime: {
          not: null
        }
      }
    });
    console.log(`\nLines with dateTime set: ${linesWithDateTime}`);
    
    // Check SessionSection text is cleaned
    const sections = await prisma.sessionSection.findMany({
      take: 2
    });
    
    console.log(`\nSessionSections found: ${sections.length}`);
    if (sections.length > 0) {
      console.log('Sample section text (should have no line prefixes):');
      const section = sections[0];
      console.log(`  Type: ${section.sectionType}`);
      console.log(`  First 200 chars: ${section.sectionText.substring(0, 200)}`);
      
      // Check if there are line prefixes in the text
      const hasLinePrefix = /^\s*\d+\s+/m.test(section.sectionText);
      console.log(`  Contains line prefixes: ${hasLinePrefix ? 'YES (PROBLEM!)' : 'NO (Good!)'}`);
    }
    
  } catch (error) {
    console.error('Error testing improvements:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testImprovements();