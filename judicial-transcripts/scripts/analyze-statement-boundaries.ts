import { PrismaClient, MarkerSectionType } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeStatementBoundaries(trialName: string, sectionType: MarkerSectionType) {
  const section = await prisma.markerSection.findFirst({
    where: {
      trial: { shortName: trialName },
      markerSectionType: sectionType
    },
    select: {
      id: true,
      name: true,
      startEventId: true,
      endEventId: true,
      confidence: true,
      trialId: true
    }
  });

  if (!section) {
    console.log(`No ${sectionType} found for ${trialName}`);
    return;
  }

  console.log(`\n=== ${trialName} - ${sectionType} ===`);
  console.log(`Range: Events ${section.startEventId}-${section.endEventId}`);
  console.log(`Confidence: ${section.confidence}`);

  // Get all events in this range
  const events = await prisma.trialEvent.findMany({
    where: {
      trialId: section.trialId,
      id: {
        gte: section.startEventId!,
        lte: section.endEventId!
      },
      eventType: 'STATEMENT'
    },
    include: {
      statement: {
        include: { speaker: true }
      }
    },
    orderBy: { id: 'asc' }
  });

  // Analyze speakers
  const speakerStats = new Map<string, { type: string, count: number, words: number }>();
  let firstSpeaker = null;
  let lastSpeaker = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const speaker = event.statement?.speaker;
    if (!speaker) continue;

    const key = `${speaker.speakerHandle} (${speaker.speakerType})`;

    if (i === 0) firstSpeaker = key;
    if (i === events.length - 1) lastSpeaker = key;

    if (!speakerStats.has(key)) {
      speakerStats.set(key, {
        type: speaker.speakerType,
        count: 0,
        words: 0
      });
    }

    const stats = speakerStats.get(key)!;
    stats.count++;
    stats.words += event.wordCount || 0;
  }

  console.log(`\nFirst speaker: ${firstSpeaker}`);
  console.log(`Last speaker: ${lastSpeaker}`);

  console.log('\nSpeaker breakdown:');
  const sortedSpeakers = Array.from(speakerStats.entries()).sort((a, b) => b[1].words - a[1].words);

  let attorneyWords = 0;
  let totalWords = 0;

  for (const [speaker, stats] of sortedSpeakers) {
    console.log(`  ${speaker}: ${stats.count} statements, ${stats.words} words`);
    totalWords += stats.words;
    if (stats.type === 'ATTORNEY') {
      attorneyWords += stats.words;
    }
  }

  const attorneyRatio = totalWords > 0 ? attorneyWords / totalWords : 0;
  console.log(`\nAttorney ratio: ${(attorneyRatio * 100).toFixed(1)}% (${attorneyWords}/${totalWords} words)`);

  // Check for violations
  const violations = [];

  // First speaker should be attorney
  if (firstSpeaker && !firstSpeaker.includes('ATTORNEY')) {
    violations.push(`❌ First speaker is not an attorney: ${firstSpeaker}`);
  }

  // Last speaker should be attorney
  if (lastSpeaker && !lastSpeaker.includes('ATTORNEY')) {
    violations.push(`❌ Last speaker is not an attorney: ${lastSpeaker}`);
  }

  // Check for inappropriate speakers
  for (const [speaker, stats] of speakerStats) {
    if (stats.type === 'WITNESS') {
      violations.push(`❌ Contains witness: ${speaker}`);
    }
    if (stats.type === 'JUROR') {
      violations.push(`❌ Contains juror: ${speaker}`);
    }
    if (stats.type === 'COURT_OFFICER' && stats.words > 50) {
      violations.push(`⚠️ Court officer speaks too much: ${speaker} (${stats.words} words)`);
    }
  }

  if (violations.length > 0) {
    console.log('\nViolations:');
    violations.forEach(v => console.log(`  ${v}`));
  } else {
    console.log('\n✅ No violations detected');
  }

  // Look at boundary events
  console.log('\nBoundary analysis:');

  // Check 3 events before start
  const beforeEvents = await prisma.trialEvent.findMany({
    where: {
      trialId: section.trialId,
      id: {
        gte: section.startEventId! - 3,
        lt: section.startEventId!
      },
      eventType: 'STATEMENT'
    },
    include: {
      statement: {
        include: { speaker: true }
      }
    },
    orderBy: { id: 'asc' }
  });

  if (beforeEvents.length > 0) {
    console.log('  Before start:');
    beforeEvents.forEach(e => {
      const speaker = e.statement?.speaker;
      console.log(`    Event ${e.id}: ${speaker?.speakerHandle} (${speaker?.speakerType}) - ${e.wordCount} words`);
    });
  }

  // Check 3 events after end
  const afterEvents = await prisma.trialEvent.findMany({
    where: {
      trialId: section.trialId,
      id: {
        gt: section.endEventId!,
        lte: section.endEventId! + 3
      },
      eventType: 'STATEMENT'
    },
    include: {
      statement: {
        include: { speaker: true }
      }
    },
    orderBy: { id: 'asc' }
  });

  if (afterEvents.length > 0) {
    console.log('  After end:');
    afterEvents.forEach(e => {
      const speaker = e.statement?.speaker;
      console.log(`    Event ${e.id}: ${speaker?.speakerHandle} (${speaker?.speakerType}) - ${e.wordCount} words`);
    });
  }

  return { section, events, violations };
}

async function main() {
  // Analyze 01 Genband opening statements
  await analyzeStatementBoundaries('01 Genband', MarkerSectionType.OPENING_STATEMENT_PLAINTIFF);
  await analyzeStatementBoundaries('01 Genband', MarkerSectionType.OPENING_STATEMENT_DEFENSE);

  // Analyze 01 Genband closing statements
  await analyzeStatementBoundaries('01 Genband', MarkerSectionType.CLOSING_STATEMENT_PLAINTIFF);
  await analyzeStatementBoundaries('01 Genband', MarkerSectionType.CLOSING_STATEMENT_DEFENSE);
  await analyzeStatementBoundaries('01 Genband', MarkerSectionType.CLOSING_REBUTTAL_PLAINTIFF);

  await prisma.$disconnect();
}

main().catch(console.error);