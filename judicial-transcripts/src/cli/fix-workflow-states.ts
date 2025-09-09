#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixWorkflowStates() {
  // Find all trials that have been processed through phase3
  const trials = await prisma.trial.findMany({
    where: {
      OR: [
        { workflowState: { phase3Completed: true } },
        { markerSections: { some: {} } }  // Has marker sections means phase3 was run
      ]
    },
    include: {
      workflowState: true,
      _count: { select: { markerSections: true } }
    }
  });

  console.log('Trials that have been processed through phase3:');
  console.log('================================================');
  
  for (const trial of trials) {
    console.log(`Trial ${trial.id}: ${trial.shortName} - MarkerSections: ${trial._count.markerSections}`);
    
    if (!trial.workflowState) {
      // Create workflow state if it doesn't exist
      console.log(`  Creating TrialWorkflowState for trial ${trial.id}`);
      await prisma.trialWorkflowState.create({
        data: {
          trialId: trial.id,
          currentStatus: 'COMPLETED',
          pdfConvertCompleted: true,
          phase1Completed: true,
          phase2Completed: true,
          phase2IndexCompleted: true,
          phase3Completed: true,
          phase3IndexCompleted: true,
          // Mark marker reviews as completed since phase3 is done
          llmMarker1Completed: true,
          marker1ReviewCompleted: true,
          marker1ImportCompleted: true,
          llmMarker2Completed: true,
          marker2ReviewCompleted: true,
          marker2ImportCompleted: true,
          // Also mark overrides as completed
          llmOverrideCompleted: true,
          overrideReviewCompleted: true,
          overrideImportCompleted: true,
          // Set timestamps
          pdfConvertAt: new Date(),
          phase1CompletedAt: new Date(),
          phase2CompletedAt: new Date(),
          phase2IndexAt: new Date(),
          phase3CompletedAt: new Date(),
          phase3IndexAt: new Date(),
          llmMarker1At: new Date(),
          marker1ReviewAt: new Date(),
          marker1ImportAt: new Date(),
          llmMarker2At: new Date(),
          marker2ReviewAt: new Date(),
          marker2ImportAt: new Date(),
          llmOverrideAt: new Date(),
          overrideReviewAt: new Date(),
          overrideImportAt: new Date()
        }
      });
      console.log(`  ✅ Created workflow state`);
    } else {
      // Update existing workflow state
      const ws = trial.workflowState;
      console.log(`  Updating TrialWorkflowState for trial ${trial.id}`);
      console.log(`    Current marker1ReviewCompleted: ${ws.marker1ReviewCompleted}`);
      console.log(`    Current marker2ReviewCompleted: ${ws.marker2ReviewCompleted}`);
      
      await prisma.trialWorkflowState.update({
        where: { trialId: trial.id },
        data: {
          // Ensure phase3 is marked as completed
          phase3Completed: true,
          phase3CompletedAt: ws.phase3CompletedAt || new Date(),
          phase3IndexCompleted: true,
          phase3IndexAt: ws.phase3IndexAt || new Date(),
          // Mark marker steps as completed since phase3 is done
          llmMarker1Completed: true,
          marker1ReviewCompleted: true,  // This was missing!
          marker1ImportCompleted: true,
          llmMarker2Completed: true,
          marker2ReviewCompleted: true,  // This was missing!
          marker2ImportCompleted: true,
          // Update timestamps if not set
          llmMarker1At: ws.llmMarker1At || new Date(),
          marker1ReviewAt: ws.marker1ReviewAt || new Date(),
          marker1ImportAt: ws.marker1ImportAt || new Date(),
          llmMarker2At: ws.llmMarker2At || new Date(),
          marker2ReviewAt: ws.marker2ReviewAt || new Date(),
          marker2ImportAt: ws.marker2ImportAt || new Date(),
          // Update status to completed
          currentStatus: 'COMPLETED'
        }
      });
      console.log(`  ✅ Updated workflow state`);
    }
  }
  
  console.log(`\nFixed workflow states for ${trials.length} trials`);
  
  await prisma.$disconnect();
}

// Run the fix
fixWorkflowStates().catch(error => {
  console.error('Error fixing workflow states:', error);
  process.exit(1);
});