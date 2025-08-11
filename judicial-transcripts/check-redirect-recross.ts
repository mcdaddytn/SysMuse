import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkRedirectRecross() {
  try {
    // Find lines containing REDIRECT
    const redirectLines = await prisma.line.findMany({
      where: {
        text: {
          contains: 'REDIRECT'
        }
      },
      take: 10
    });
    
    console.log('\n=== LINES CONTAINING "REDIRECT" ===');
    redirectLines.forEach(line => {
      console.log(`Line ${line.lineNumber}: ${line.text}`);
    });
    
    // Find lines containing RECROSS
    const recrossLines = await prisma.line.findMany({
      where: {
        text: {
          contains: 'RECROSS'
        }
      },
      take: 10
    });
    
    console.log('\n=== LINES CONTAINING "RECROSS" ===');
    recrossLines.forEach(line => {
      console.log(`Line ${line.lineNumber}: ${line.text}`);
    });
    
    // Find lines that match the pattern
    const examLines = await prisma.line.findMany({
      where: {
        OR: [
          { text: { contains: 'REDIRECT EXAMINATION' } },
          { text: { contains: 'RECROSS-EXAMINATION' } },
          { text: { contains: 'RECROSS EXAMINATION' } }
        ]
      },
      take: 20
    });
    
    console.log('\n=== EXAMINATION TYPE LINES ===');
    examLines.forEach(line => {
      console.log(`Line ${line.lineNumber}: ${line.text}`);
      console.log(`  Speaker: ${line.speakerPrefix || 'none'}`);
    });
    
  } finally {
    await prisma.$disconnect();
  }
}

checkRedirectRecross().catch(console.error);