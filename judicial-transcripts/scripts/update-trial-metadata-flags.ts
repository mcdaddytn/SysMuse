#!/usr/bin/env ts-node

/**
 * Script to update existing trial-metadata.json files with:
 * 1. Import flags (importAttorney, importJudge, importCourtReporter)
 * 2. ConditionalInsert action for entities with fingerprints
 * 
 * This script processes all trial-metadata.json files in output/multi-trial/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

interface MetadataFile {
  metadata?: any;
  Attorney?: any[];
  LawFirm?: any[];
  LawFirmOffice?: any[];
  Address?: any[];
  Judge?: any[];
  CourtReporter?: any[];
  Trial?: any;
  TrialAttorney?: any[];
}

function updateMetadataFiles() {
  console.log('Starting trial-metadata.json update...\n');
  
  // Find all trial-metadata.json files
  const pattern = path.join('output', 'multi-trial', '*', 'trial-metadata.json');
  const files = glob.sync(pattern);
  
  if (files.length === 0) {
    console.log('No trial-metadata.json files found in output/multi-trial/*/');
    return;
  }
  
  console.log(`Found ${files.length} trial-metadata.json files to update\n`);
  
  let updatedCount = 0;
  let errorCount = 0;
  
  for (const file of files) {
    const trialName = path.basename(path.dirname(file));
    console.log(`Processing: ${trialName}`);
    
    try {
      // Read existing file
      const content = fs.readFileSync(file, 'utf-8');
      const data: MetadataFile = JSON.parse(content);
      
      // 1. Add/update metadata section with import flags
      if (!data.metadata) {
        data.metadata = {};
      }
      
      // Set import flags (keep existing values if present)
      data.metadata.importAttorney = data.metadata.importAttorney ?? true;
      data.metadata.importJudge = data.metadata.importJudge ?? false;
      data.metadata.importCourtReporter = data.metadata.importCourtReporter ?? false;
      
      // Keep userReview flag if it exists
      if (!('userReview' in data.metadata)) {
        data.metadata.userReview = true;
      }
      
      // 2. Update override actions to ConditionalInsert for entities with fingerprints
      
      // Update Attorneys
      if (data.Attorney && Array.isArray(data.Attorney)) {
        data.Attorney.forEach(attorney => {
          attorney.overrideAction = 'ConditionalInsert';
          attorney.overrideKey = attorney.overrideKey || 'attorneyFingerprint';
        });
      }
      
      // Update LawFirms
      if (data.LawFirm && Array.isArray(data.LawFirm)) {
        data.LawFirm.forEach(firm => {
          firm.overrideAction = 'ConditionalInsert';
          firm.overrideKey = firm.overrideKey || 'lawFirmFingerprint';
        });
      }
      
      // Update LawFirmOffices
      if (data.LawFirmOffice && Array.isArray(data.LawFirmOffice)) {
        data.LawFirmOffice.forEach(office => {
          office.overrideAction = 'ConditionalInsert';
          office.overrideKey = office.overrideKey || 'lawFirmOfficeFingerprint';
        });
      }
      
      // Update Addresses
      if (data.Address && Array.isArray(data.Address)) {
        data.Address.forEach(address => {
          address.overrideAction = 'ConditionalInsert';
          // Addresses typically don't have fingerprints, use id
          address.overrideKey = address.overrideKey || 'id';
        });
      }
      
      // Update CourtReporters (only if importCourtReporter is true)
      if (data.CourtReporter && Array.isArray(data.CourtReporter)) {
        data.CourtReporter.forEach(reporter => {
          reporter.overrideAction = 'ConditionalInsert';
          reporter.overrideKey = reporter.overrideKey || 'courtReporterFingerprint';
        });
      }
      
      // Judges typically remain as Upsert since they're shared across trials
      // But we can update them if needed
      if (data.Judge && Array.isArray(data.Judge)) {
        data.Judge.forEach(judge => {
          // Keep as Upsert for judges since they're typically shared
          judge.overrideAction = judge.overrideAction || 'Upsert';
          judge.overrideKey = judge.overrideKey || 'judgeFingerprint';
        });
      }
      
      // Trials should remain as Upsert
      if (data.Trial) {
        const trials = Array.isArray(data.Trial) ? data.Trial : [data.Trial];
        trials.forEach(trial => {
          trial.overrideAction = trial.overrideAction || 'Upsert';
          trial.overrideKey = trial.overrideKey || 'shortName';
        });
      }
      
      // 3. Generate TrialAttorney records if not present
      // (This will be handled in a separate step if needed)
      
      // Write updated file
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      console.log(`  ✓ Updated successfully`);
      updatedCount++;
      
    } catch (error) {
      console.error(`  ✗ Error: ${error}`);
      errorCount++;
    }
  }
  
  console.log(`\n========================================`);
  console.log(`Update complete!`);
  console.log(`  Updated: ${updatedCount} files`);
  console.log(`  Errors: ${errorCount} files`);
  console.log(`========================================`);
  
  if (updatedCount > 0) {
    console.log(`\nNext steps:`);
    console.log(`1. Review the updated files manually`);
    console.log(`2. If satisfied, sync to source directory:`);
    console.log(`   npx ts-node scripts/sync.ts --source output/multi-trial --dest /path/to/dropbox`);
  }
}

// Run the script
try {
  updateMetadataFiles();
} catch (error) {
  console.error('Script failed:', error);
  process.exit(1);
}