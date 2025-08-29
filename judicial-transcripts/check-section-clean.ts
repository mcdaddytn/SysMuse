import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSectionClean() {
  const section = await prisma.sessionSection.findFirst({
    where: { sectionType: 'CASE_TITLE' }
  });
  
  if (section) {
    console.log('CASE_TITLE section text (should be clean):');
    console.log('---');
    console.log(section.sectionText);
    console.log('---');
    
    // Check for line numbers at start of lines
    const hasLineNumbers = /^\s*\d{1,4}\s+/m.test(section.sectionText);
    console.log(`Contains line numbers: ${hasLineNumbers ? 'YES (Problem!)' : 'NO (Good!)'}`);
  }
  
  await prisma.$disconnect();
}

checkSectionClean();