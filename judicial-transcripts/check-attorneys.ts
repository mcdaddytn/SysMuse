import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAttorneys() {
  try {
    // Check RUBINO
    const rubino = await prisma.attorney.findMany({
      where: {
        name: {
          contains: 'RUBINO'
        }
      }
    });
    
    console.log('\n=== RUBINO ATTORNEY RECORD ===');
    rubino.forEach(att => {
      console.log('Name:', att.name);
      console.log('Title:', att.title);
      console.log('Last Name:', att.lastName);
      console.log('Speaker Prefix:', att.speakerPrefix);
      console.log('---');
    });
    
    // Check LOEBBAKA
    const loebbaka = await prisma.attorney.findMany({
      where: {
        OR: [
          { name: { contains: 'LOEBBAKA' } },
          { lastName: { contains: 'LOEBBAKA' } }
        ]
      }
    });
    
    console.log('\n=== LOEBBAKA ATTORNEY RECORDS ===');
    loebbaka.forEach(att => {
      console.log('Name:', att.name);
      console.log('Title:', att.title);
      console.log('Last Name:', att.lastName);
      console.log('Speaker Prefix:', att.speakerPrefix);
      console.log('---');
    });
    
    // Check anonymous speakers
    const anonymousSpeakers = await prisma.anonymousSpeaker.findMany({
      include: {
        speaker: true
      }
    });
    
    console.log('\n=== ANONYMOUS SPEAKERS ===');
    console.log('Total anonymous speakers:', anonymousSpeakers.length);
    
    // Check if RUBINO or LOEBBAKA are in anonymous speakers
    const problematicAnon = anonymousSpeakers.filter(anon => 
      anon.speaker.speakerPrefix.includes('RUBINO') || 
      anon.speaker.speakerPrefix.includes('LOEBBAKA') ||
      anon.speaker.speakerPrefix.includes('III')
    );
    
    if (problematicAnon.length > 0) {
      console.log('\n⚠️  Attorneys incorrectly marked as anonymous:');
      problematicAnon.forEach(anon => {
        console.log(`  - ${anon.speaker.speakerPrefix} (role: ${anon.role})`);
      });
    }
    
    // List all anonymous speaker prefixes
    console.log('\nAll anonymous speaker prefixes:');
    const uniquePrefixes = [...new Set(anonymousSpeakers.map(a => a.speaker.speakerPrefix))].sort();
    uniquePrefixes.forEach(prefix => {
      console.log(`  - ${prefix}`);
    });
    
  } finally {
    await prisma.$disconnect();
  }
}

checkAttorneys().catch(console.error);