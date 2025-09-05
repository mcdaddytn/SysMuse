#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixNullSpeakerPrefixes() {
  console.log('🔧 Fixing Null Attorney Speaker Prefixes...\n');
  
  // Get all attorneys with null or empty speakerPrefix
  const attorneys = await prisma.attorney.findMany({
    where: {
      OR: [
        { speakerPrefix: null },
        { speakerPrefix: '' }
      ]
    },
    include: { speaker: true }
  });
  
  console.log(`Found ${attorneys.length} attorneys with null/empty speakerPrefix\n`);
  
  let fixedCount = 0;
  let skippedCount = 0;
  
  for (const attorney of attorneys) {
    let generatedPrefix = null;
    
    // First, try to use the speaker's prefix if it looks correct
    if (attorney.speaker?.speakerPrefix && 
        attorney.speaker.speakerPrefix.includes('.') && 
        attorney.speaker.speakerPrefix !== attorney.name.toUpperCase()) {
      // Speaker has a good prefix like "MR. SMITH"
      generatedPrefix = attorney.speaker.speakerPrefix;
    } 
    // Otherwise, generate from title and lastName
    else if (attorney.lastName) {
      // Determine title if not provided
      let title = attorney.title;
      
      if (!title) {
        // Try to extract title from name
        const nameParts = attorney.name.split(' ');
        const firstPart = nameParts[0].toUpperCase();
        
        if (['MR.', 'MS.', 'MRS.', 'DR.'].includes(firstPart)) {
          title = firstPart;
        } else if (firstPart === 'MR' || firstPart === 'MS' || firstPart === 'MRS' || firstPart === 'DR') {
          title = firstPart + '.';
        } else {
          // Default to MR. if we can't determine
          title = 'MR.';
        }
      } else {
        // Ensure title has proper format
        title = title.toUpperCase();
        if (!title.endsWith('.') && ['MR', 'MS', 'MRS', 'DR'].includes(title)) {
          title += '.';
        }
      }
      
      generatedPrefix = `${title} ${attorney.lastName.toUpperCase()}`;
    }
    
    if (generatedPrefix) {
      console.log(`✅ Updating ${attorney.name}:`);
      console.log(`   Setting speakerPrefix to: "${generatedPrefix}"`);
      
      // Update the attorney record
      await prisma.attorney.update({
        where: { id: attorney.id },
        data: { speakerPrefix: generatedPrefix }
      });
      
      // Also ensure the speaker has the correct prefix
      if (attorney.speaker && attorney.speaker.speakerPrefix !== generatedPrefix) {
        console.log(`   Also updating speaker prefix from "${attorney.speaker.speakerPrefix}" to "${generatedPrefix}"`);
        await prisma.speaker.update({
          where: { id: attorney.speaker.id },
          data: { speakerPrefix: generatedPrefix }
        });
      }
      
      fixedCount++;
    } else {
      console.log(`⚠️  Skipping ${attorney.name}: Cannot generate prefix (no lastName)`);
      skippedCount++;
    }
    console.log('');
  }
  
  console.log('📊 Summary:');
  console.log(`   ✅ Fixed: ${fixedCount} attorneys`);
  if (skippedCount > 0) {
    console.log(`   ⚠️  Skipped: ${skippedCount} attorneys (missing required data)`);
  }
  
  // Verify the fixes
  const remaining = await prisma.attorney.count({
    where: {
      OR: [
        { speakerPrefix: null },
        { speakerPrefix: '' }
      ]
    }
  });
  
  if (remaining > 0) {
    console.log(`\n⚠️  Warning: ${remaining} attorneys still have null/empty speakerPrefix`);
  } else {
    console.log('\n✅ All attorney speakerPrefix fields are now populated!');
  }
}

fixNullSpeakerPrefixes()
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });