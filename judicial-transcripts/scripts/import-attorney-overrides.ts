#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client';
import { OverrideImporter } from '../src/services/override/OverrideImporter';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function importAttorneyOverrides() {
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
  
  console.log(`Found ${attorneyFiles.length} Attorney.json files to import:\n`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of attorneyFiles) {
    const trialName = path.basename(path.dirname(file));
    console.log(`\n📂 Importing: ${trialName}`);
    console.log(`   File: ${file}`);
    
    try {
      // First ensure the trial exists
      const existingTrial = await prisma.trial.findFirst({
        where: { shortName: trialName }
      });
      
      let trialData;
      if (!existingTrial) {
        // Create a minimal trial entry if it doesn't exist
        console.log(`   📝 Creating trial: ${trialName}`);
        const trial = await prisma.trial.create({
          data: {
            name: trialName,
            shortName: trialName,
            caseNumber: `CASE-${trialName}`, // Placeholder
            court: 'U.S. District Court', // Placeholder
            caseHandle: trialName
          }
        });
        
        // Create a Trial override structure with the created trial
        trialData = {
          Trial: {
            id: trial.id,
            name: trial.name,
            shortName: trial.shortName,
            caseNumber: trial.caseNumber,
            court: trial.court,
            overrideAction: 'Update' as const
          }
        };
      } else {
        // Use existing trial
        trialData = {
          Trial: {
            id: existingTrial.id,
            name: existingTrial.name,
            shortName: existingTrial.shortName,
            caseNumber: existingTrial.caseNumber,
            court: existingTrial.court,
            overrideAction: 'Update' as const
          }
        };
      }
      
      // Read the attorney data
      const attorneyData = JSON.parse(fs.readFileSync(file, 'utf-8'));
      
      // Combine trial and attorney data
      const combinedData = {
        ...trialData,
        ...attorneyData
      };
      
      const importer = new OverrideImporter(prisma);
      const result = await importer.applyOverrides(combinedData);
      
      if (result.success) {
        console.log(`   ✅ Success!`);
        if (result.imported.attorneys) {
          console.log(`      - ${result.imported.attorneys} attorneys`);
        }
        if (result.imported.lawFirms) {
          console.log(`      - ${result.imported.lawFirms} law firms`);
        }
        if (result.imported.lawFirmOffices) {
          console.log(`      - ${result.imported.lawFirmOffices} law firm offices`);
        }
        if (result.imported.addresses) {
          console.log(`      - ${result.imported.addresses} addresses`);
        }
        successCount++;
      } else {
        console.log(`   ❌ Failed:`, result.errors?.join(', '));
        errorCount++;
      }
    } catch (error) {
      console.error(`   ❌ Error:`, error);
      errorCount++;
    }
  }
  
  console.log(`\n✨ Import complete!`);
  console.log(`   ✅ Success: ${successCount} files`);
  if (errorCount > 0) {
    console.log(`   ❌ Failed: ${errorCount} files`);
  }
  
  // Show total counts in database
  const totalAttorneys = await prisma.attorney.count();
  const totalLawFirms = await prisma.lawFirm.count();
  const totalSpeakers = await prisma.speaker.count({ where: { speakerType: 'ATTORNEY' } });
  
  console.log(`\n📊 Database totals:`);
  console.log(`   - ${totalAttorneys} attorneys`);
  console.log(`   - ${totalLawFirms} law firms`);
  console.log(`   - ${totalSpeakers} attorney speakers`);
}

importAttorneyOverrides()
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });