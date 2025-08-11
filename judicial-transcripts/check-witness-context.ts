import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkWitnessContext() {
  try {
    // Get some REDIRECT lines with context
    const redirectLines = await prisma.line.findMany({
      where: {
        text: {
          contains: 'REDIRECT EXAMINATION'
        }
      },
      take: 3,
      orderBy: {
        id: 'asc'
      }
    });
    
    for (const line of redirectLines) {
      console.log(`\n=== REDIRECT EXAMINATION at Line ${line.lineNumber} ===`);
      console.log(`Text: ${line.text}`);
      
      // Get surrounding lines for context
      const contextLines = await prisma.line.findMany({
        where: {
          pageId: line.pageId,
          lineNumber: {
            gte: Math.max(1, line.lineNumber - 5),
            lte: line.lineNumber + 5
          }
        },
        orderBy: {
          lineNumber: 'asc'
        }
      });
      
      console.log('\nContext (5 lines before and after):');
      contextLines.forEach(ctxLine => {
        const marker = ctxLine.id === line.id ? ' >>> ' : '     ';
        console.log(`${marker}Line ${ctxLine.lineNumber}: ${ctxLine.text || '(blank)'}`);
      });
    }
    
    // Check if there's a witness on stand during REDIRECT
    const page = await prisma.page.findFirst({
      where: {
        lines: {
          some: {
            text: {
              contains: 'REDIRECT EXAMINATION'
            }
          }
        }
      },
      include: {
        lines: {
          orderBy: {
            lineNumber: 'asc'
          },
          take: 50
        }
      }
    });
    
    if (page) {
      console.log(`\n=== Page ${page.pageNumber} with REDIRECT ===`);
      let foundWitness = false;
      for (const line of page.lines) {
        if (line.text?.match(/WITNESS|SWORN/i)) {
          console.log(`Witness line: ${line.text}`);
          foundWitness = true;
        }
        if (line.text?.includes('REDIRECT')) {
          console.log(`>>> REDIRECT line: ${line.text}`);
          if (!foundWitness) {
            console.log('⚠️  No witness found before REDIRECT!');
          }
          break;
        }
      }
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

checkWitnessContext().catch(console.error);