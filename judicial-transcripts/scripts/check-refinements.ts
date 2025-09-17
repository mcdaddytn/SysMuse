import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkFinalResults() {
  console.log('=== 01 Genband - After Refinements ===');
  const sections = await prisma.markerSection.findMany({
    where: {
      trial: { shortName: '01 Genband' },
      markerSectionType: {
        in: ['OPENING_STATEMENT_PLAINTIFF', 'OPENING_STATEMENT_DEFENSE',
             'CLOSING_STATEMENT_PLAINTIFF', 'CLOSING_STATEMENT_DEFENSE',
             'CLOSING_REBUTTAL_PLAINTIFF']
      }
    },
    select: {
      name: true,
      markerSectionType: true,
      startEventId: true,
      endEventId: true,
      confidence: true,
      metadata: true
    },
    orderBy: { startEventId: 'asc' }
  });

  console.log('Found sections:');
  for (const s of sections) {
    console.log(`  ${s.markerSectionType}:`);
    console.log(`    Events: ${s.startEventId}-${s.endEventId}`);
    console.log(`    Confidence: ${s.confidence}`);
  }

  // Check our target events
  console.log('\n=== Target Events Verification ===');

  const targets = [
    { id: 5658, name: 'MR. KUBEHL (expected in plaintiff closing)' },
    { id: 5662, name: 'MR. VERHOEVEN (expected in defense closing)' },
    { id: 5672, name: 'MR. DACUS (expected in plaintiff rebuttal)' }
  ];

  for (const target of targets) {
    const covered = sections.filter(s =>
      s.startEventId && s.endEventId &&
      s.startEventId <= target.id && s.endEventId >= target.id
    );

    console.log(`Event ${target.id} (${target.name}):`);
    if (covered.length > 0) {
      console.log(`  ✅ Captured in: ${covered.map(c => c.markerSectionType).join(', ')}`);
    } else {
      console.log(`  ❌ NOT captured`);
    }
  }

  await prisma.$disconnect();
}

checkFinalResults().catch(console.error);