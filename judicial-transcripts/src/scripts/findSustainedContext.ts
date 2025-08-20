import { PrismaClient } from '@prisma/client';

async function findSustainedContext() {
  const prisma = new PrismaClient();
  
  try {
    // Find a "sustained" statement from the judge
    const sustainedStmt = await prisma.statementEvent.findFirst({
      where: {
        text: { contains: 'Sustained' },
        speaker: { speakerType: 'JUDGE' }
      },
      include: {
        event: { include: { session: true, trial: true } },
        speaker: true
      }
    });
    
    if (!sustainedStmt) {
      console.log('No sustained statement found');
      return;
    }
    
    console.log('Found sustained ruling:');
    console.log(`  Session: ${sustainedStmt.event.session?.sessionDate} ${sustainedStmt.event.session?.sessionType}`);
    console.log(`  Line: ${sustainedStmt.event.startLineNumber}`);
    console.log(`  Text: "${sustainedStmt.text}"`);
    console.log('\nLooking for surrounding statements...\n');
    
    // Get surrounding statements
    const surroundingStmts = await prisma.statementEvent.findMany({
      where: {
        event: {
          sessionId: sustainedStmt.event.sessionId,
          startLineNumber: {
            gte: (sustainedStmt.event.startLineNumber || 0) - 10,
            lte: (sustainedStmt.event.startLineNumber || 0) + 10
          }
        }
      },
      include: {
        event: true,
        speaker: true
      },
      orderBy: {
        event: { startLineNumber: 'asc' }
      }
    });
    
    console.log('=== COURTROOM DIALOGUE ===\n');
    for (const stmt of surroundingStmts) {
      const marker = stmt.id === sustainedStmt.id ? '>>> ' : '    ';
      console.log(`${marker}[Line ${stmt.event.startLineNumber}] ${stmt.speaker?.speakerPrefix || 'UNKNOWN'} (${stmt.speaker?.speakerType || 'UNKNOWN'}):`);
      console.log(`    ${stmt.text.substring(0, 100)}${stmt.text.length > 100 ? '...' : ''}`);
      console.log();
    }
    
  } finally {
    await prisma.$disconnect();
  }
}

findSustainedContext().catch(console.error);