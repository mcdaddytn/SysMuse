#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function analyzeData() {
  console.log('\n=== TRIAL DATA ANALYSIS ===\n');
  
  // Get trial info
  const trial = await prisma.trial.findFirst();
  console.log('Trial Information:');
  console.log('  ID:', trial?.id);
  console.log('  Name:', trial?.name);
  console.log('  Case Number:', trial?.caseNumber);
  console.log('  Court:', trial?.court);
  console.log('  Court Division:', trial?.courtDivision);
  console.log('  Court District:', trial?.courtDistrict);
  
  // Count records
  const counts = {
    lines: await prisma.line.count(),
    statements: await prisma.statementEvent.count(),
    speakers: await prisma.speaker.count(),
    attorneys: await prisma.attorney.count(),
    witnesses: await prisma.witness.count(),
    judges: await prisma.judge.count()
  };
  
  console.log('\nRecord Counts:');
  console.log('  Lines:', counts.lines);
  console.log('  Statements:', counts.statements);
  console.log('  Speakers:', counts.speakers);
  console.log('  Attorneys:', counts.attorneys);
  console.log('  Witnesses:', counts.witnesses);
  console.log('  Judges:', counts.judges);
  
  // Get top attorneys by statement count
  console.log('\nTop Attorneys by Statement Count:');
  const topAttorneys = await prisma.$queryRaw`
    SELECT a.name, a."speakerPrefix", COUNT(se.id) as statement_count
    FROM "Attorney" a
    JOIN "Speaker" s ON s.id = a."speakerId"
    JOIN "StatementEvent" se ON se."speakerId" = s.id
    GROUP BY a.id, a.name, a."speakerPrefix"
    ORDER BY statement_count DESC
    LIMIT 10
  `;
  console.log(topAttorneys);
  
  // Get top witnesses by statement count
  console.log('\nTop Witnesses by Statement Count:');
  const topWitnesses = await prisma.$queryRaw`
    SELECT w.name, w."displayName", COUNT(se.id) as statement_count
    FROM "Witness" w
    JOIN "Speaker" s ON s.id = w."speakerId"
    JOIN "StatementEvent" se ON se."speakerId" = s.id
    WHERE w."speakerId" IS NOT NULL
    GROUP BY w.id, w.name, w."displayName"
    ORDER BY statement_count DESC
    LIMIT 10
  `;
  console.log(topWitnesses);
  
  // Get judge info
  console.log('\nJudge Information:');
  const judges = await prisma.judge.findMany({
    include: {
      speaker: true
    }
  });
  for (const judge of judges) {
    const statementCount = await prisma.statementEvent.count({
      where: { speakerId: judge.speakerId }
    });
    console.log(`  ${judge.name} (${judge.speaker?.speakerPrefix || 'N/A'}): ${statementCount} statements`);
  }
  
  // Sample some actual text for objections
  console.log('\nSample Objection Texts:');
  const objectionSamples = await prisma.statementEvent.findMany({
    where: {
      OR: [
        { text: { contains: 'objection', mode: 'insensitive' } },
        { text: { contains: 'sustained', mode: 'insensitive' } },
        { text: { contains: 'overruled', mode: 'insensitive' } }
      ]
    },
    take: 5,
    include: {
      speaker: true
    }
  });
  
  for (const sample of objectionSamples) {
    console.log(`\n  Speaker: ${sample.speaker?.speakerPrefix}`);
    console.log(`  Text: ${sample.text.substring(0, 200)}...`);
  }
  
  await prisma.$disconnect();
}

analyzeData().catch(console.error);