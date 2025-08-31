import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function exportComparisonData(outputDir: string) {
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`Exporting data to ${outputDir}...`);

  // Export pages with details
  const pages = await prisma.page.findMany({
    orderBy: [
      { sessionId: 'asc' },
      { pageNumber: 'asc' }
    ],
    include: {
      session: {
        select: {
          sessionDate: true,
          sessionType: true
        }
      }
    }
  });

  const pageData = pages.map(p => ({
    id: p.id,
    sessionId: p.sessionId,
    sessionDate: p.session.sessionDate,
    sessionType: p.session.sessionType,
    pageNumber: p.pageNumber,
    trialPageNumber: p.trialPageNumber
  }));

  fs.writeFileSync(
    path.join(outputDir, 'pages.json'),
    JSON.stringify(pageData, null, 2)
  );
  console.log(`Exported ${pages.length} pages`);

  // Export lines (sample first 1000 and last 1000)
  const firstLines = await prisma.line.findMany({
    take: 1000,
    orderBy: { lineNumber: 'asc' },
    select: {
      id: true,
      lineNumber: true,
      trialLineNumber: true,
      text: true,
      speakerPrefix: true,
      documentSection: true,
      pageId: true
    }
  });

  const totalLines = await prisma.line.count();
  const lastLines = await prisma.line.findMany({
    skip: Math.max(0, totalLines - 1000),
    orderBy: { lineNumber: 'asc' },
    select: {
      id: true,
      lineNumber: true,
      trialLineNumber: true,
      text: true,
      speakerPrefix: true,
      documentSection: true,
      pageId: true
    }
  });

  fs.writeFileSync(
    path.join(outputDir, 'lines-first-1000.json'),
    JSON.stringify(firstLines, null, 2)
  );
  fs.writeFileSync(
    path.join(outputDir, 'lines-last-1000.json'),
    JSON.stringify(lastLines, null, 2)
  );
  console.log(`Exported ${totalLines} total lines (sampled first and last 1000)`);

  // Export statement events
  const statements = await prisma.statementEvent.findMany({
    take: 500,
    orderBy: { id: 'asc' },
    include: {
      speaker: {
        select: {
          speakerPrefix: true,
          speakerType: true
        }
      },
      event: {
        select: {
          startLineNumber: true,
          endLineNumber: true,
          lineCount: true
        }
      }
    }
  });

  const statementData = statements.map(s => ({
    id: s.id,
    eventId: s.eventId,
    speakerPrefix: s.speaker?.speakerPrefix,
    speakerType: s.speaker?.speakerType,
    lineCount: s.event.lineCount || 0,
    startLine: s.event.startLineNumber,
    endLine: s.event.endLineNumber
  }));

  fs.writeFileSync(
    path.join(outputDir, 'statements-sample.json'),
    JSON.stringify(statementData, null, 2)
  );

  // Export summary statistics
  const stats = {
    trials: await prisma.trial.count(),
    sessions: await prisma.session.count(),
    pages: await prisma.page.count(),
    lines: await prisma.line.count(),
    speakers: await prisma.speaker.count(),
    attorneys: await prisma.attorney.count(),
    judges: await prisma.judge.count(),
    witnesses: await prisma.witness.count(),
    jurors: await prisma.juror.count(),
    anonymousSpeakers: await prisma.anonymousSpeaker.count(),
    trialEvents: await prisma.trialEvent.count(),
    statementEvents: await prisma.statementEvent.count(),
    courtDirectiveEvents: await prisma.courtDirectiveEvent.count(),
    witnessCalledEvents: await prisma.witnessCalledEvent.count(),
    lawFirms: await prisma.lawFirm.count(),
    addresses: await prisma.address.count(),
    courtReporters: await prisma.courtReporter.count()
  };

  fs.writeFileSync(
    path.join(outputDir, 'statistics.json'),
    JSON.stringify(stats, null, 2)
  );
  console.log('Exported statistics');

  // Export speakers for comparison
  const speakers = await prisma.speaker.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      speakerPrefix: true,
      speakerType: true,
      speakerHandle: true
    }
  });

  fs.writeFileSync(
    path.join(outputDir, 'speakers.json'),
    JSON.stringify(speakers, null, 2)
  );
  console.log(`Exported ${speakers.length} speakers`);
}

// Run the export
const outputDir = process.argv[2] || 'data-export';
exportComparisonData(outputDir)
  .then(() => {
    console.log('Export complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Export failed:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });