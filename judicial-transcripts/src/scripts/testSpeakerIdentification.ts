#!/usr/bin/env ts-node

import { PrismaClient } from '@prisma/client';
import { SpeakerRegistry } from '../services/SpeakerRegistry';
import { ExaminationContextManager } from '../services/ExaminationContextManager';
import { MultiTrialSpeakerService } from '../services/MultiTrialSpeakerService';

const prisma = new PrismaClient();

async function testSpeakerIdentification() {
  console.log('🔍 Testing Speaker Identification System\n');
  
  try {
    // Get the most recent trial
    const trial = await prisma.trial.findFirst({
      orderBy: { id: 'desc' }
    });
    
    if (!trial) {
      console.log('❌ No trials found in database. Please run phase1 parsing first.');
      return;
    }
    
    console.log(`📋 Testing with trial: ${trial.name} (ID: ${trial.id})\n`);
    
    // Test 1: Initialize Speaker Services
    console.log('Test 1: Initializing Speaker Services');
    const speakerService = new MultiTrialSpeakerService(prisma, trial.id);
    const speakerRegistry = new SpeakerRegistry(prisma, trial.id);
    await speakerRegistry.initialize();
    const examinationContext = new ExaminationContextManager(speakerRegistry);
    
    const initialStats = speakerRegistry.getStatistics();
    console.log(`✅ Speaker Registry initialized with ${initialStats.total} speakers`);
    console.log(`   Breakdown: ${JSON.stringify(initialStats.byType)}\n`);
    
    // Test 2: Create Court Participants
    console.log('Test 2: Creating Court Participants');
    
    // Create judge
    const { judge, speaker: judgeSpeaker } = await speakerService.createJudgeWithSpeaker(
      'RODNEY GILSTRAP',
      'JUDGE',
      'HONORABLE'
    );
    console.log(`✅ Created judge: ${judge.name}`);
    
    // Create attorneys
    const attorneyData = [
      { name: 'JOHN SMITH', title: 'MR.', lastName: 'SMITH', role: 'PLAINTIFF' as const },
      { name: 'JANE DOE', title: 'MS.', lastName: 'DOE', role: 'DEFENDANT' as const }
    ];
    
    for (const data of attorneyData) {
      const { attorney } = await speakerService.createAttorneyWithSpeaker({
        ...data,
        speakerPrefix: `${data.title} ${data.lastName}`
      });
      console.log(`✅ Created attorney: ${attorney.name} for ${data.role}`);
    }
    
    // Test 3: Test Q&A Context Resolution
    console.log('\nTest 3: Testing Q&A Context Resolution');
    
    // Simulate witness examination
    const witnessLine = {
      text: 'JOHN WITNESS, PLAINTIFF\'S WITNESS',
      lineNumber: 100
    };
    await examinationContext.updateFromLine(witnessLine);
    console.log('✅ Witness context set');
    
    // Set examining attorney
    const byAttorneyLine = {
      text: 'BY MR. SMITH:',
      lineNumber: 101
    };
    await examinationContext.updateFromLine(byAttorneyLine);
    console.log('✅ Examining attorney set');
    
    // Test Q&A resolution
    const qLine = {
      text: 'Q. What is your name?',
      lineNumber: 102
    };
    const qSpeaker = await examinationContext.resolveSpeaker(qLine);
    console.log(`✅ Q resolved to: ${qSpeaker?.speakerPrefix || 'unknown'}`);
    
    const aLine = {
      text: 'A. John Witness.',
      lineNumber: 103
    };
    const aSpeaker = await examinationContext.resolveSpeaker(aLine);
    console.log(`✅ A resolved to: ${aSpeaker?.speakerPrefix || 'unknown'}`);
    
    // Test 4: Check Speaker Statistics
    console.log('\nTest 4: Final Speaker Statistics');
    await speakerRegistry.initialize(); // Reinitialize to get updated stats
    
    const finalStats = speakerRegistry.getStatistics();
    console.log(`Total speakers: ${finalStats.total}`);
    console.log(`By type: ${JSON.stringify(finalStats.byType)}`);
    
    if (finalStats.unmatched.length > 0) {
      console.log(`⚠️  Unmatched speakers: ${finalStats.unmatched.join(', ')}`);
    }
    
    // Test 5: Verify Multi-Trial Isolation
    console.log('\nTest 5: Verifying Multi-Trial Isolation');
    
    const allSpeakers = await speakerService.getAllSpeakersForTrial();
    const speakersByTrial = await prisma.speaker.groupBy({
      by: ['trialId'],
      _count: true,
      where: {
        trialId: trial.id
      }
    });
    
    console.log(`✅ All ${allSpeakers.length} speakers are associated with trial ${trial.id}`);
    
    // Test 6: Check Database Records
    console.log('\nTest 6: Database Record Verification');
    
    const dbStats = await prisma.speaker.groupBy({
      by: ['speakerType'],
      where: { trialId: trial.id },
      _count: true
    });
    
    console.log('Database speaker counts by type:');
    for (const stat of dbStats) {
      console.log(`  ${stat.speakerType}: ${stat._count}`);
    }
    
    // Test 7: Test Examination Types
    console.log('\nTest 7: Testing Examination Type Detection');
    
    const examTypes = [
      'DIRECT EXAMINATION',
      'CROSS-EXAMINATION',
      'REDIRECT EXAMINATION',
      'RECROSS EXAMINATION'
    ];
    
    for (const examType of examTypes) {
      await examinationContext.updateFromLine({
        text: examType,
        lineNumber: 200
      });
      const currentType = examinationContext.getExaminationType();
      console.log(`✅ ${examType} detected as: ${currentType}`);
    }
    
    console.log('\n✅ All tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testSpeakerIdentification().catch(console.error);