import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugClosingSearch() {
  const trial = await prisma.trial.findFirst({
    where: { shortName: '01 Genband' }
  });

  if (!trial) {
    console.log('Trial not found');
    await prisma.$disconnect();
    return;
  }

  // Get all high-word attorney statements after witness testimony
  const statements = await prisma.trialEvent.findMany({
    where: {
      trialId: trial.id,
      id: { gte: 5113, lte: 5700 },
      eventType: 'STATEMENT',
      wordCount: { gte: 1000 },
      statement: {
        speaker: {
          speakerType: 'ATTORNEY'
        }
      }
    },
    include: {
      statement: {
        include: { speaker: true }
      }
    },
    orderBy: { id: 'asc' }
  });

  console.log('High-word attorney statements (>1000 words) between 5113-5700:');
  for (const s of statements) {
    const speaker = s.statement?.speaker;

    // Check attorney role
    const attorney = await prisma.trialAttorney.findFirst({
      where: {
        trialId: trial.id,
        speaker: {
          speakerHandle: speaker?.speakerHandle || ''
        }
      }
    });

    console.log(`  Event ${s.id}: ${speaker?.speakerHandle} (${attorney?.role || 'UNKNOWN'}) - ${s.wordCount} words`);
  }

  // Now check what our LongStatementsAccumulatorV2 finds
  console.log('\nChecking search windows:');
  console.log(`  Witness testimony ends: 5112`);
  console.log(`  Search starts: 5113`);
  console.log(`  MR. KUBEHL at 5658 should be found`);
  console.log(`  MR. VERHOEVEN at 5662 should be found`);

  await prisma.$disconnect();
}

debugClosingSearch().catch(console.error);