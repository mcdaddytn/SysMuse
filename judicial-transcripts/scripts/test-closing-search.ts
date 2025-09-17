import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function searchDefenseClosing() {
  const trial = await prisma.trial.findFirst({
    where: { shortName: '01 Genband' }
  });

  if (!trial) {
    console.log('Trial not found');
    await prisma.$disconnect();
    return;
  }

  // Find the witness testimony end to know where closing should start
  const witnessEnd = await prisma.markerSection.findFirst({
    where: {
      trialId: trial.id,
      markerSectionType: 'WITNESS_TESTIMONY_PERIOD'
    },
    select: { endEventId: true }
  });

  console.log('Witness testimony ends at event:', witnessEnd?.endEventId);

  // Find high word count statements by any attorney after witness testimony
  const searchStart = witnessEnd?.endEventId || 5100;
  const defenseStatements = await prisma.trialEvent.findMany({
    where: {
      trialId: trial.id,
      id: { gte: searchStart },
      eventType: 'STATEMENT',
      wordCount: { gte: 200 },
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
    orderBy: { id: 'asc' },
    take: 30
  });

  console.log(`\nHigh word count attorney statements after event ${searchStart}:`);
  defenseStatements.forEach(e => {
    console.log(`  Event ${e.id}: ${e.statement?.speaker?.speakerHandle} - ${e.wordCount} words`);
  });

  // Check attorney assignments
  const attorneys = await prisma.trialAttorney.findMany({
    where: { trialId: trial.id },
    include: { attorney: true }
  });

  console.log('\nDefense attorneys:');
  attorneys.filter(a => a.role === 'DEFENDANT').forEach(a => {
    console.log(`  ${a.attorney.name || a.attorney.lastName}`);
  });

  console.log('\nPlaintiff attorneys:');
  attorneys.filter(a => a.role === 'PLAINTIFF').forEach(a => {
    console.log(`  ${a.attorney.name || a.attorney.lastName}`);
  });

  // Look for the specific plaintiff closing statement text mentioned
  const kubehlStatement = await prisma.trialEvent.findMany({
    where: {
      trialId: trial.id,
      eventType: 'STATEMENT',
      statement: {
        text: {
          contains: 'So we saw, starting on Monday, that obviously these two companies compete'
        }
      }
    },
    include: {
      statement: {
        include: { speaker: true }
      }
    }
  });

  if (kubehlStatement.length > 0) {
    console.log('\nFound MR. KUBEHL statement:');
    kubehlStatement.forEach(e => {
      console.log(`  Event ${e.id}: ${e.statement?.speaker?.speakerHandle} - ${e.wordCount} words`);
    });
  }

  await prisma.$disconnect();
}

searchDefenseClosing().catch(console.error);