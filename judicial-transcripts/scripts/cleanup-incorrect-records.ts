#!/usr/bin/env ts-node
/**
 * Clean up incorrectly created database records from override import
 * These records should only be created during Phase 1 parsing
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanupIncorrectRecords() {
  console.log('🧹 Cleaning up incorrectly created database records...\n');
  
  try {
    // Find trials with placeholder case numbers (created by import)
    const placeholderTrials = await prisma.trial.findMany({
      where: {
        caseNumber: {
          startsWith: 'CASE-'
        }
      }
    });
    
    // Get counts separately
    const trialData = await Promise.all(placeholderTrials.map(async (trial) => {
      const sessionCount = await prisma.session.count({ where: { trialId: trial.id } });
      const speakerCount = await prisma.speaker.count({ where: { trialId: trial.id } });
      const trialAttorneyCount = await prisma.trialAttorney.count({ where: { trialId: trial.id } });
      
      return {
        ...trial,
        sessionCount,
        speakerCount,
        trialAttorneyCount
      };
    }));
    
    if (placeholderTrials.length > 0) {
      console.log(`Found ${placeholderTrials.length} trials with placeholder case numbers:`);
      
      for (const trial of trialData) {
        console.log(`\n  Trial: ${trial.name} (ID: ${trial.id})`);
        console.log(`    Case Number: ${trial.caseNumber}`);
        console.log(`    Sessions: ${trial.sessionCount}`);
        console.log(`    Speakers: ${trial.speakerCount}`);
        console.log(`    Trial Attorneys: ${trial.trialAttorneyCount}`);
        
        if (trial.sessionCount === 0) {
          console.log(`    ⚠️  No sessions - likely created by import, not parsing`);
        }
      }
      
      console.log('\n' + '='.repeat(60));
      console.log('⚠️  WARNING: About to delete the following:');
      console.log('='.repeat(60));
      
      // Count what will be deleted
      const attorneysToDelete = await prisma.attorney.count({
        where: {
          trialAttorneys: {
            none: {} // Attorneys with no trial associations
          }
        }
      });
      
      const speakersToDelete = await prisma.speaker.count({
        where: {
          trialId: {
            in: placeholderTrials.map(t => t.id)
          }
        }
      });
      
      console.log(`  - ${placeholderTrials.length} placeholder trials`);
      console.log(`  - ${speakersToDelete} speakers from those trials`);
      console.log(`  - ${attorneysToDelete} attorneys without trial associations`);
      
      // Ask for confirmation
      console.log('\n⚠️  This will delete these records permanently!');
      console.log('To proceed, run with --force flag');
      
      if (process.argv.includes('--force')) {
        console.log('\n🗑️  Deleting records...');
        
        // Delete in correct order to respect foreign keys
        
        // 1. Delete trial attorneys associations
        const deletedTrialAttorneys = await prisma.trialAttorney.deleteMany({
          where: {
            trialId: {
              in: placeholderTrials.map(t => t.id)
            }
          }
        });
        console.log(`  ✓ Deleted ${deletedTrialAttorneys.count} trial attorney associations`);
        
        // 2. Delete attorneys without any trial associations
        const deletedAttorneys = await prisma.attorney.deleteMany({
          where: {
            trialAttorneys: {
              none: {}
            }
          }
        });
        console.log(`  ✓ Deleted ${deletedAttorneys.count} orphaned attorneys`);
        
        // 3. Delete speakers
        const deletedSpeakers = await prisma.speaker.deleteMany({
          where: {
            trialId: {
              in: placeholderTrials.map(t => t.id)
            }
          }
        });
        console.log(`  ✓ Deleted ${deletedSpeakers.count} speakers`);
        
        // 4. Delete trials
        const deletedTrials = await prisma.trial.deleteMany({
          where: {
            id: {
              in: placeholderTrials.map(t => t.id)
            }
          }
        });
        console.log(`  ✓ Deleted ${deletedTrials.count} trials`);
        
        console.log('\n✅ Cleanup complete!');
      } else {
        console.log('\nℹ️  Run with --force flag to proceed with deletion');
      }
    } else {
      console.log('✅ No placeholder trials found - database is clean');
    }
    
    // Show current database state
    console.log('\n📊 Current database state:');
    const trialCount = await prisma.trial.count();
    const attorneyCount = await prisma.attorney.count();
    const speakerCount = await prisma.speaker.count();
    const lawFirmCount = await prisma.lawFirm.count();
    
    console.log(`  - ${trialCount} trials`);
    console.log(`  - ${attorneyCount} attorneys`);
    console.log(`  - ${speakerCount} speakers`);
    console.log(`  - ${lawFirmCount} law firms`);
    
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupIncorrectRecords()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });