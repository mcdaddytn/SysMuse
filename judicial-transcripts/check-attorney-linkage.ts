import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAttorneyLinkage() {
  const trials = await prisma.trial.findMany();
  
  console.log('Checking attorney linkage for trials with 5-10 sessions:');
  console.log('='.repeat(70));
  
  const goodTrials: number[] = [];
  
  for (const trial of trials) {
    const sessionCount = await prisma.session.count({
      where: { trialId: trial.id }
    });
    
    if (sessionCount < 5 || sessionCount > 10) continue;
    
    const attorneys = await prisma.trialAttorney.findMany({
      where: { trialId: trial.id },
      include: { speaker: true }
    });
    
    const linkedCount = attorneys.filter(a => a.speakerId !== null).length;
    const plaintiffCount = attorneys.filter(a => a.role === 'PLAINTIFF').length;
    const defenseCount = attorneys.filter(a => a.role === 'DEFENDANT').length;
    
    if (linkedCount > 0 && plaintiffCount > 0 && defenseCount > 0) {
      const name = trial.name.length > 60 ? trial.name.substring(0, 60) + '...' : trial.name;
      console.log(`✓ Trial ${trial.id}: ${name}`);
      console.log(`  Sessions: ${sessionCount}, Attorneys: ${attorneys.length} (linked: ${linkedCount})`);
      console.log(`  Roles: Plaintiff=${plaintiffCount}, Defense=${defenseCount}`);
      console.log('');
      goodTrials.push(trial.id);
    }
  }
  
  console.log(`\nFound ${goodTrials.length} trials with good attorney linkage and 5-10 sessions`);
  console.log('Trial IDs:', goodTrials.join(', '));
  
  await prisma.$disconnect();
}

checkAttorneyLinkage();