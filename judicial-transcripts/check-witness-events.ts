import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkWitnessEvents() {
  try {
    // Get witness event statistics
    const events = await prisma.witnessCalledEvent.findMany({
      select: {
        examinationType: true,
        swornStatus: true,
        presentedByVideo: true,
        continued: true
      }
    });
    
    // Count by type
    const stats: Record<string, any> = {};
    events.forEach(event => {
      const key = `${event.examinationType}_${event.swornStatus}`;
      if (!stats[key]) {
        stats[key] = { 
          examinationType: event.examinationType, 
          swornStatus: event.swornStatus,
          count: 0,
          videoCount: 0,
          continuedCount: 0
        };
      }
      stats[key].count++;
      if (event.presentedByVideo) stats[key].videoCount++;
      if (event.continued) stats[key].continuedCount++;
    });
    
    console.log('\n=== WITNESS EVENT STATISTICS ===');
    console.log('Total witness events:', events.length);
    console.log('\nBy Examination Type and Sworn Status:');
    console.log('--------------------------------------');
    
    Object.values(stats).forEach((stat: any) => {
      console.log(`${stat.examinationType} / ${stat.swornStatus}: ${stat.count} events`);
      if (stat.videoCount > 0) console.log(`  - Video depositions: ${stat.videoCount}`);
      if (stat.continuedCount > 0) console.log(`  - Continued: ${stat.continuedCount}`);
    });
    
    // Check for REDIRECT and RECROSS
    const hasRedirect = events.some(e => e.examinationType === 'REDIRECT_EXAMINATION');
    const hasRecross = events.some(e => e.examinationType === 'RECROSS_EXAMINATION');
    
    console.log('\n=== EXAMINATION TYPE COVERAGE ===');
    console.log('DIRECT_EXAMINATION:', events.filter(e => e.examinationType === 'DIRECT_EXAMINATION').length);
    console.log('CROSS_EXAMINATION:', events.filter(e => e.examinationType === 'CROSS_EXAMINATION').length);
    console.log('REDIRECT_EXAMINATION:', events.filter(e => e.examinationType === 'REDIRECT_EXAMINATION').length);
    console.log('RECROSS_EXAMINATION:', events.filter(e => e.examinationType === 'RECROSS_EXAMINATION').length);
    console.log('VIDEO_DEPOSITION:', events.filter(e => e.examinationType === 'VIDEO_DEPOSITION').length);
    
    // Check sworn status distribution
    console.log('\n=== SWORN STATUS DISTRIBUTION ===');
    console.log('SWORN:', events.filter(e => e.swornStatus === 'SWORN').length);
    console.log('PREVIOUSLY_SWORN:', events.filter(e => e.swornStatus === 'PREVIOUSLY_SWORN').length);
    console.log('NOT_SWORN:', events.filter(e => e.swornStatus === 'NOT_SWORN').length);
    
  } finally {
    await prisma.$disconnect();
  }
}

checkWitnessEvents().catch(console.error);