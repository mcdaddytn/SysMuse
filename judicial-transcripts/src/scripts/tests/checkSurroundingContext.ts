import { PrismaClient } from '@prisma/client';

async function checkContext() {
  const prisma = new PrismaClient();
  
  // Find a "Sustained" statement
  const sustainedStmt = await prisma.statementEvent.findFirst({
    where: {
      text: { contains: 'Sustained' },
      speaker: { speakerType: 'JUDGE' }
    },
    include: {
      event: { include: { session: true } },
      speaker: true
    }
  });
  
  if (!sustainedStmt) {
    console.log('No sustained statement found');
    return;
  }
  
  console.log('Found sustained statement:');
  console.log(`Session: ${sustainedStmt.event.session?.sessionDate} ${sustainedStmt.event.session?.sessionType}`);
  console.log(`Line ${sustainedStmt.event.startLineNumber}: ${sustainedStmt.speaker?.speakerPrefix}: ${sustainedStmt.text}`);
  console.log('\nFinding surrounding statements in same session...\n');
  
  // Get 5 statements before and after
  const before = await prisma.statementEvent.findMany({
    where: {
      event: {
        sessionId: sustainedStmt.event.sessionId,
        startLineNumber: { lt: sustainedStmt.event.startLineNumber! }
      }
    },
    orderBy: { event: { startLineNumber: 'desc' } },
    take: 5,
    include: { speaker: true, event: true }
  });
  
  const after = await prisma.statementEvent.findMany({
    where: {
      event: {
        sessionId: sustainedStmt.event.sessionId,
        startLineNumber: { gt: sustainedStmt.event.startLineNumber! }
      }
    },
    orderBy: { event: { startLineNumber: 'asc' } },
    take: 5,
    include: { speaker: true, event: true }
  });
  
  console.log('=== CONTEXT BEFORE ===');
  before.reverse().forEach((s: any) => {
    const preview = s.text.length > 80 ? s.text.substring(0, 80) + '...' : s.text;
    console.log(`Line ${s.event.startLineNumber}: [${s.speaker?.speakerType}] ${s.speaker?.speakerPrefix}: ${preview}`);
  });
  
  console.log('\n=== THE SUSTAINED STATEMENT ===');
  console.log(`Line ${sustainedStmt.event.startLineNumber}: [${sustainedStmt.speaker?.speakerType}] ${sustainedStmt.speaker?.speakerPrefix}: ${sustainedStmt.text}`);
  
  console.log('\n=== CONTEXT AFTER ===');
  after.forEach((s: any) => {
    const preview = s.text.length > 80 ? s.text.substring(0, 80) + '...' : s.text;
    console.log(`Line ${s.event.startLineNumber}: [${s.speaker?.speakerType}] ${s.speaker?.speakerPrefix}: ${preview}`);
  });
  
  console.log('\n=== SPEAKER DISTRIBUTION ===');
  const allStatements = [...before, sustainedStmt, ...after];
  const speakerCounts = new Map<string, number>();
  allStatements.forEach((s: any) => {
    const speaker = s.speaker?.speakerPrefix || 'UNKNOWN';
    speakerCounts.set(speaker, (speakerCounts.get(speaker) || 0) + 1);
  });
  
  speakerCounts.forEach((count, speaker) => {
    console.log(`${speaker}: ${count} statements`);
  });
  
  await prisma.$disconnect();
}

checkContext().catch(console.error);