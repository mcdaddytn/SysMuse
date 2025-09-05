#!/usr/bin/env ts-node
/**
 * Import attorney metadata (NOT creating trials or speakers)
 * This stores attorney information that will be used during Phase 1 parsing
 * when speakers and attorneys are naturally created from transcript text.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function importAttorneyMetadata() {
  const outputDir = './output/multi-trial';
  
  // Find all Attorney.json files
  const attorneyFiles: string[] = [];
  const trials = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const trial of trials) {
    const attorneyFile = path.join(outputDir, trial, 'Attorney.json');
    if (fs.existsSync(attorneyFile)) {
      attorneyFiles.push(attorneyFile);
    }
  }
  
  console.log(`Found ${attorneyFiles.length} Attorney.json files\n`);
  console.log('⚠️  NOTE: This script stores attorney metadata only.');
  console.log('   Trials and Speakers will be created during Phase 1 parsing.\n');
  
  // For now, we'll store this data in a separate metadata table or JSON file
  // that can be referenced during parsing
  
  const allAttorneyMetadata: any[] = [];
  
  for (const file of attorneyFiles) {
    const trialName = path.basename(path.dirname(file));
    console.log(`📂 Reading: ${trialName}`);
    
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      
      if (data.Attorney) {
        console.log(`   Found ${data.Attorney.length} attorneys`);
        
        // Add trial context to each attorney
        data.Attorney.forEach((attorney: any) => {
          allAttorneyMetadata.push({
            ...attorney,
            trialName,
            sourceTrial: trialName
          });
        });
      }
    } catch (error) {
      console.error(`   ❌ Error reading ${file}:`, error);
    }
  }
  
  // Save consolidated metadata to a file that can be used during parsing
  const metadataFile = path.join(outputDir, 'attorney-metadata.json');
  fs.writeFileSync(metadataFile, JSON.stringify(allAttorneyMetadata, null, 2));
  
  console.log(`\n✅ Saved attorney metadata for ${allAttorneyMetadata.length} attorneys`);
  console.log(`   File: ${metadataFile}`);
  console.log('\n📝 This metadata will be used during Phase 1 parsing to:');
  console.log('   - Match attorneys by fingerprint when they appear in transcripts');
  console.log('   - Enhance attorney records with additional information');
  console.log('   - Enable cross-trial attorney matching');
  
  // Show summary of metadata
  const byTrial = allAttorneyMetadata.reduce((acc, att) => {
    acc[att.trialName] = (acc[att.trialName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  console.log('\n📊 Attorney metadata by trial:');
  Object.entries(byTrial).forEach(([trial, count]) => {
    console.log(`   ${trial}: ${count} attorneys`);
  });
}

importAttorneyMetadata()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });