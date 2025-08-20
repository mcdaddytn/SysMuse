import { PrismaClient } from '@prisma/client';

async function checkSorting() {
  const prisma = new PrismaClient();
  
  try {
    // Get a sample of events sorted different ways
    console.log('=== CHECKING SORTING ISSUES ===\n');
    
    // Method 1: Sort by startTime only (current approach)
    const byStartTime = await prisma.trialEvent.findMany({
      where: { trialId: 1, eventType: 'STATEMENT' },
      orderBy: { startTime: 'asc' },
      take: 10,
      include: { statement: { include: { speaker: true } } }
    });
    
    console.log('Sort by startTime only:');
    for (const event of byStartTime) {
      console.log(`  ID: ${event.id}, SessionID: ${event.sessionId}, Time: ${event.startTime}, Speaker: ${event.statement?.speaker?.speakerHandle}`);
    }
    
    // Method 2: Sort by id (should be chronological)
    const byId = await prisma.trialEvent.findMany({
      where: { trialId: 1, eventType: 'STATEMENT' },
      orderBy: { id: 'asc' },
      take: 10,
      include: { statement: { include: { speaker: true } } }
    });
    
    console.log('\nSort by ID:');
    for (const event of byId) {
      console.log(`  ID: ${event.id}, SessionID: ${event.sessionId}, Time: ${event.startTime}, Speaker: ${event.statement?.speaker?.speakerHandle}`);
    }
    
    // Method 3: Sort by sessionId then startTime
    const bySessionAndTime = await prisma.trialEvent.findMany({
      where: { trialId: 1, eventType: 'STATEMENT' },
      orderBy: [
        { sessionId: 'asc' },
        { startTime: 'asc' }
      ],
      take: 10,
      include: { statement: { include: { speaker: true } } }
    });
    
    console.log('\nSort by sessionId then startTime:');
    for (const event of bySessionAndTime) {
      console.log(`  ID: ${event.id}, SessionID: ${event.sessionId}, Time: ${event.startTime}, Speaker: ${event.statement?.speaker?.speakerHandle}`);
    }
    
    // Check for the specific text we're looking for
    const lambrianakosBeams = await prisma.statementEvent.findFirst({
      where: {
        text: { contains: "Do Echo's beams ever move" }
      },
      include: {
        event: true,
        speaker: true
      }
    });
    
    if (lambrianakosBeams) {
      console.log('\n=== Found "Do Echo\'s beams ever move" ===');
      console.log(`  Statement ID: ${lambrianakosBeams.id}`);
      console.log(`  Event ID: ${lambrianakosBeams.eventId}`);
      console.log(`  Session ID: ${lambrianakosBeams.event.sessionId}`);
      console.log(`  Time: ${lambrianakosBeams.event.startTime}`);
      console.log(`  Speaker: ${lambrianakosBeams.speaker?.speakerHandle}`);
      
      // Get surrounding events by ID
      const surroundingEvents = await prisma.trialEvent.findMany({
        where: {
          trialId: 1,
          eventType: 'STATEMENT',
          id: {
            gte: lambrianakosBeams.eventId - 2,
            lte: lambrianakosBeams.eventId + 2
          }
        },
        orderBy: { id: 'asc' },
        include: { statement: { include: { speaker: true } } }
      });
      
      console.log('\nSurrounding events (by ID):');
      for (const event of surroundingEvents) {
        const text = event.statement?.text?.substring(0, 50) || '';
        console.log(`  ID ${event.id}: ${event.statement?.speaker?.speakerHandle?.padEnd(25)} ${text}`);
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkSorting();