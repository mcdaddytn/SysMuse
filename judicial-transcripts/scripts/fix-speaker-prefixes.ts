#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';
import { generateSpeakerPrefix, generateSpeakerHandle } from '../src/services/speakers/speakerUtils';

const prisma = new PrismaClient();

async function fixSpeakerPrefixes() {
  console.log('🔧 Fixing Speaker Prefixes...\n');
  
  // Get all attorney speakers
  const speakers = await prisma.speaker.findMany({
    where: { speakerType: 'ATTORNEY' },
    include: { attorney: true }
  });
  
  console.log(`Found ${speakers.length} attorney speakers to check\n`);
  
  let fixedCount = 0;
  let issues = [];
  
  for (const speaker of speakers) {
    const attorney = speaker.attorney;
    if (!attorney) continue;
    
    // Generate correct speaker prefix based on attorney name and stored prefix
    const correctPrefix = generateSpeakerPrefix(attorney.name, attorney.speakerPrefix || undefined);
    const correctHandle = generateSpeakerHandle(attorney.name);
    
    let needsUpdate = false;
    let updates: any = {};
    
    // Check if speaker prefix needs fixing
    if (speaker.speakerPrefix !== correctPrefix) {
      console.log(`❌ Speaker ${speaker.id} (${attorney.name}):`);
      console.log(`   Current prefix: "${speaker.speakerPrefix}"`);
      console.log(`   Should be: "${correctPrefix}"`);
      needsUpdate = true;
      updates.speakerPrefix = correctPrefix;
      issues.push({
        attorneyName: attorney.name,
        oldPrefix: speaker.speakerPrefix,
        newPrefix: correctPrefix
      });
    }
    
    // Check if speaker handle needs fixing
    if (speaker.speakerHandle !== correctHandle) {
      if (!needsUpdate) {
        console.log(`❌ Speaker ${speaker.id} (${attorney.name}):`);
      }
      console.log(`   Current handle: "${speaker.speakerHandle}"`);
      console.log(`   Should be: "${correctHandle}"`);
      needsUpdate = true;
      updates.speakerHandle = correctHandle;
    }
    
    if (needsUpdate) {
      // Update the speaker
      await prisma.speaker.update({
        where: { id: speaker.id },
        data: updates
      });
      console.log(`   ✅ Fixed!\n`);
      fixedCount++;
    }
  }
  
  console.log('\n📊 Summary:');
  console.log(`   Total speakers: ${speakers.length}`);
  console.log(`   Fixed: ${fixedCount}`);
  console.log(`   Already correct: ${speakers.length - fixedCount}`);
  
  if (issues.length > 0) {
    console.log('\n📝 Fixed Issues:');
    const groupedByPattern = issues.reduce((acc, issue) => {
      const pattern = issue.oldPrefix.match(/^[A-Z]+\./) ? 'Wrong case title' : 
                      issue.oldPrefix === issue.newPrefix.toUpperCase() ? 'Already uppercase' :
                      'Missing or wrong format';
      if (!acc[pattern]) acc[pattern] = [];
      acc[pattern].push(issue);
      return acc;
    }, {} as Record<string, typeof issues>);
    
    Object.entries(groupedByPattern).forEach(([pattern, items]) => {
      console.log(`\n   ${pattern}: ${items.length} cases`);
      items.slice(0, 3).forEach(item => {
        console.log(`     - ${item.attorneyName}: "${item.oldPrefix}" → "${item.newPrefix}"`);
      });
      if (items.length > 3) {
        console.log(`     ... and ${items.length - 3} more`);
      }
    });
  }
  
  // Also update attorney speakerPrefix fields if they're in wrong case
  console.log('\n🔧 Checking Attorney speakerPrefix fields...');
  
  const attorneys = await prisma.attorney.findMany();
  let attorneyFixCount = 0;
  
  for (const attorney of attorneys) {
    if (attorney.speakerPrefix) {
      const upperPrefix = attorney.speakerPrefix.toUpperCase();
      if (attorney.speakerPrefix !== upperPrefix) {
        console.log(`   Fixing attorney ${attorney.name}: "${attorney.speakerPrefix}" → "${upperPrefix}"`);
        await prisma.attorney.update({
          where: { id: attorney.id },
          data: { speakerPrefix: upperPrefix }
        });
        attorneyFixCount++;
      }
    }
  }
  
  if (attorneyFixCount > 0) {
    console.log(`   ✅ Fixed ${attorneyFixCount} attorney speakerPrefix fields`);
  } else {
    console.log(`   ✅ All attorney speakerPrefix fields are correct`);
  }
}

fixSpeakerPrefixes()
  .catch(error => {
    console.error('❌ Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });