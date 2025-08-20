#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function monitorProgress(trialId?: number) {
  console.log('\n====================================');
  console.log('PHASE 3 PROCESSING PROGRESS MONITOR');
  console.log('====================================\n');

  const where = trialId ? { trialId } : {};

  // ElasticSearch Expression Processing
  const totalExpressions = await prisma.elasticSearchExpression.count();
  const totalStatements = await prisma.statementEvent.count({
    where: trialId ? { event: { trialId } } : {}
  });
  const expectedESResults = totalExpressions * totalStatements;
  const actualESResults = await prisma.elasticSearchResult.count({ where });
  const matchedESResults = await prisma.elasticSearchResult.count({ 
    where: { ...where, matched: true } 
  });

  console.log('📊 ElasticSearch Expression Evaluation:');
  console.log(`   Expressions: ${totalExpressions}`);
  console.log(`   Statements: ${totalStatements}`);
  console.log(`   Expected Results: ${expectedESResults.toLocaleString()}`);
  console.log(`   Actual Results: ${actualESResults.toLocaleString()}`);
  console.log(`   Progress: ${((actualESResults / expectedESResults) * 100).toFixed(1)}%`);
  console.log(`   Matched: ${matchedESResults} (${((matchedESResults / actualESResults) * 100).toFixed(2)}%)\n`);

  // Show top matching expressions
  const topMatches = await prisma.elasticSearchResult.groupBy({
    by: ['expressionId'],
    where: { ...where, matched: true },
    _count: { matched: true }
  });

  if (topMatches.length > 0) {
    console.log('🎯 Top Matching Expressions:');
    for (const match of topMatches.slice(0, 5)) {
      const expr = await prisma.elasticSearchExpression.findUnique({
        where: { id: match.expressionId }
      });
      console.log(`   ${expr?.name}: ${match._count.matched} matches`);
    }
    console.log('');
  }

  // Accumulator Processing
  const totalAccumulators = await prisma.accumulatorExpression.count();
  const accumulatorResults = await prisma.accumulatorResult.count({ where });
  
  console.log('🔄 Accumulator Processing:');
  console.log(`   Active Accumulators: ${totalAccumulators}`);
  console.log(`   Results Generated: ${accumulatorResults}`);
  
  if (accumulatorResults > 0) {
    const matchedAccumResults = await prisma.accumulatorResult.count({
      where: { ...where, booleanResult: true }
    });
    console.log(`   Matched: ${matchedAccumResults}\n`);
  } else {
    console.log('   Status: Not started or in progress\n');
  }

  // Marker Discovery
  const markers = await prisma.marker.count({ where });
  const markerSections = await prisma.markerSection.count({ where });
  
  console.log('🏷️  Marker Discovery:');
  console.log(`   Markers Created: ${markers}`);
  console.log(`   Marker Sections: ${markerSections}`);

  if (markers > 0) {
    // Show marker type breakdown
    const markerTypes = await prisma.marker.groupBy({
      by: ['markerType'],
      where,
      _count: { markerType: true }
    });
    
    console.log('\n   Marker Types:');
    for (const type of markerTypes) {
      console.log(`     ${type.markerType}: ${type._count.markerType}`);
    }
  }

  // Witness Processing
  const witnessEvents = await prisma.witnessCalledEvent.count({
    where: trialId ? { event: { trialId } } : {}
  });
  const witnesses = await prisma.witness.count({
    where: trialId ? { trialId } : {}
  });

  console.log('\n👤 Witness Processing:');
  console.log(`   Witnesses: ${witnesses}`);
  console.log(`   Witness Called Events: ${witnessEvents}`);
  console.log(`   Average Examinations per Witness: ${(witnessEvents / witnesses).toFixed(1)}`);

  // Performance Metrics
  const latestESResult = await prisma.elasticSearchResult.findFirst({
    where,
    orderBy: { createdAt: 'desc' }
  });

  if (latestESResult) {
    const timeDiff = Date.now() - latestESResult.createdAt.getTime();
    const minutesAgo = Math.floor(timeDiff / 60000);
    
    console.log('\n⏱️  Performance:');
    console.log(`   Last ES Result: ${minutesAgo} minutes ago`);
    
    if (minutesAgo > 5) {
      console.log('   ⚠️  Processing may have stalled or completed');
    } else {
      console.log('   ✅ Processing appears to be active');
    }
  }

  console.log('\n====================================\n');
}

// Parse command line arguments
const trialId = process.argv[2] ? parseInt(process.argv[2]) : undefined;

monitorProgress(trialId)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());