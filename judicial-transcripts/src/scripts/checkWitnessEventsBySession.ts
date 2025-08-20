import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
  try {
    // Get all witness events with session info
    const events = await prisma.witnessCalledEvent.findMany({
      include: {
        event: {
          include: {
            session: true
          }
        },
        witness: true
      },
      orderBy: {
        event: {
          startLineNumber: 'asc'
        }
      }
    });
    
    // Group by session
    const bySession: Record<number, typeof events> = {};
    for (const e of events) {
      const sessionId = e.event.sessionId || 0;
      if (!bySession[sessionId]) bySession[sessionId] = [];
      bySession[sessionId].push(e);
    }
    
    console.log('Events by session:');
    let totalExpected = 0;
    for (const [sessionId, evs] of Object.entries(bySession)) {
      if (evs.length > 0 && evs[0].event.session) {
        const session = evs[0].event.session;
        console.log(`Session ${sessionId} (${session.sessionDate.toISOString().split('T')[0]} ${session.sessionType}): ${evs.length} events`);
        
        // Show first few events
        for (const e of evs.slice(0, 3)) {
          console.log(`  - Line ${e.event.startLineNumber}: ${e.witness?.name} - ${e.examinationType} - ${e.swornStatus}`);
        }
        if (evs.length > 3) {
          console.log(`  ... and ${evs.length - 3} more`);
        }
      }
    }
    
    console.log(`\nTotal events: ${events.length}`);
    console.log('Expected: 57-58');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

check();