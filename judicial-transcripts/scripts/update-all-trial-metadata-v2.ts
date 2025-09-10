#!/usr/bin/env ts-node
/**
 * Updates all trial-metadata.json files with:
 * 1. ConditionalInsert for most entities
 * 2. Upsert with fullAddress key for Addresses
 * 3. Import flags in metadata
 * 4. TrialAttorney records based on attorneys
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

interface TrialMetadata {
  Trial?: any[];
  Attorney?: any[];
  LawFirm?: any[];
  LawFirmOffice?: any[];
  Address?: any[];
  Judge?: any[];
  CourtReporter?: any[];
  TrialAttorney?: any[];
  metadata?: any;
}

// Function to determine attorney role based on law firm name or attorney name
function determineAttorneyRole(attorney: any, lawFirm: any, trialName: string): string {
  const firmName = lawFirm?.name?.toLowerCase() || '';
  const attorneyName = attorney?.name?.toLowerCase() || '';
  const lastName = attorney?.lastName?.toLowerCase() || '';
  
  // Check if trial name contains plaintiff/defendant info
  const trialNameLower = trialName.toLowerCase();
  
  // Common plaintiff firm patterns
  if (firmName.includes('mckool') || firmName.includes('dacus') || 
      firmName.includes('potter') || firmName.includes('minton')) {
    return 'PLAINTIFF';
  }
  
  // Common defendant firm patterns
  if (firmName.includes('quinn') || firmName.includes('emanuel') || 
      firmName.includes('fish') || firmName.includes('richardson') ||
      firmName.includes('fenwick') || firmName.includes('wilson')) {
    return 'DEFENDANT';
  }
  
  // Default based on position in array (rough heuristic)
  return 'UNKNOWN';
}

async function updateTrialMetadata(filePath: string): Promise<void> {
  console.log(`\nProcessing: ${filePath}`);
  
  try {
    // Read existing file
    const content = fs.readFileSync(filePath, 'utf-8');
    const data: TrialMetadata = JSON.parse(content);
    
    // Extract trial directory name for context
    const trialDir = path.basename(path.dirname(filePath));
    console.log(`  Trial: ${trialDir}`);
    
    // Update Trial entities
    if (data.Trial && Array.isArray(data.Trial)) {
      data.Trial.forEach(trial => {
        trial.overrideAction = 'ConditionalInsert';
        trial.overrideKey = trial.overrideKey || 'shortName';
      });
      console.log(`  ✓ Updated ${data.Trial.length} Trial entities`);
    }
    
    // Update Attorney entities
    if (data.Attorney && Array.isArray(data.Attorney)) {
      data.Attorney.forEach(attorney => {
        attorney.overrideAction = 'ConditionalInsert';
        attorney.overrideKey = attorney.overrideKey || 'attorneyFingerprint';
      });
      console.log(`  ✓ Updated ${data.Attorney.length} Attorney entities`);
    }
    
    // Update LawFirm entities
    if (data.LawFirm && Array.isArray(data.LawFirm)) {
      data.LawFirm.forEach(firm => {
        firm.overrideAction = 'ConditionalInsert';
        firm.overrideKey = firm.overrideKey || 'lawFirmFingerprint';
      });
      console.log(`  ✓ Updated ${data.LawFirm.length} LawFirm entities`);
    }
    
    // Update LawFirmOffice entities
    if (data.LawFirmOffice && Array.isArray(data.LawFirmOffice)) {
      data.LawFirmOffice.forEach(office => {
        office.overrideAction = 'ConditionalInsert';
        office.overrideKey = office.overrideKey || 'lawFirmOfficeFingerprint';
      });
      console.log(`  ✓ Updated ${data.LawFirmOffice.length} LawFirmOffice entities`);
    }
    
    // Update Address entities - Use Upsert with fullAddress
    if (data.Address && Array.isArray(data.Address)) {
      data.Address.forEach(address => {
        address.overrideAction = 'Upsert';
        address.overrideKey = 'fullAddress';
      });
      console.log(`  ✓ Updated ${data.Address.length} Address entities`);
    }
    
    // Update Judge entities
    if (data.Judge && Array.isArray(data.Judge)) {
      data.Judge.forEach(judge => {
        judge.overrideAction = 'ConditionalInsert';
        judge.overrideKey = judge.overrideKey || 'judgeFingerprint';
      });
      console.log(`  ✓ Updated ${data.Judge.length} Judge entities`);
    }
    
    // Update CourtReporter entities
    if (data.CourtReporter && Array.isArray(data.CourtReporter)) {
      data.CourtReporter.forEach(reporter => {
        reporter.overrideAction = 'ConditionalInsert';
        reporter.overrideKey = reporter.overrideKey || 'courtReporterFingerprint';
      });
      console.log(`  ✓ Updated ${data.CourtReporter.length} CourtReporter entities`);
    }
    
    // Generate TrialAttorney records if not present
    if ((!data.TrialAttorney || data.TrialAttorney.length === 0) && 
        data.Attorney && data.Attorney.length > 0 && 
        data.Trial && data.Trial.length > 0) {
      
      data.TrialAttorney = [];
      const trialId = data.Trial[0].id || 1;
      
      data.Attorney!.forEach((attorney, index) => {
        // Find corresponding law firm
        const lawFirm = data.LawFirm?.find(f => {
          // Try to match by common patterns or index
          if (attorney.lastName && f.name) {
            // Check if attorney's last name is in firm name (e.g., "DACUS" in "THE DACUS FIRM")
            return f.name.toUpperCase().includes(attorney.lastName.toUpperCase());
          }
          // Fallback to index matching
          return data.LawFirm && data.LawFirm[index] === f;
        });
        
        const lawFirmId = lawFirm?.id || (index + 1);
        const lawFirmOfficeId = data.LawFirmOffice?.find(o => o.lawFirmId === lawFirmId)?.id || (index + 1);
        
        // Determine role based on firm and attorney info
        let role = determineAttorneyRole(attorney, lawFirm, trialDir);
        
        // Special case: if only 2 attorneys, assume first is plaintiff, second is defendant
        if (data.Attorney!.length === 2 && role === 'UNKNOWN') {
          role = index === 0 ? 'PLAINTIFF' : 'DEFENDANT';
        }
        
        // For trials with many attorneys, try to guess based on patterns
        if (data.Attorney!.length > 4 && role === 'UNKNOWN') {
          // First half typically plaintiff, second half defendant
          role = index < data.Attorney!.length / 2 ? 'PLAINTIFF' : 'DEFENDANT';
        }
        
        data.TrialAttorney!.push({
          id: index + 1,
          trialId: trialId,
          attorneyId: attorney.id || (index + 1),
          speakerId: null,
          role: role,
          lawFirmId: lawFirmId,
          lawFirmOfficeId: lawFirmOfficeId,
          overrideAction: 'ConditionalInsert',
          overrideKey: 'composite'
        });
      });
      
      console.log(`  ✓ Generated ${data.TrialAttorney!.length} TrialAttorney records`);
    } else if (data.TrialAttorney && data.TrialAttorney.length > 0) {
      // Update existing TrialAttorney records
      data.TrialAttorney.forEach(ta => {
        ta.overrideAction = 'ConditionalInsert';
        ta.overrideKey = 'composite';
        if (ta.speakerId === undefined) {
          ta.speakerId = null;
        }
      });
      console.log(`  ✓ Updated ${data.TrialAttorney.length} existing TrialAttorney records`);
    }
    
    // Update metadata with import flags
    if (!data.metadata) {
      data.metadata = {};
    }
    
    // Add import flags if not present
    if (data.metadata.importAttorney === undefined) {
      data.metadata.importAttorney = true;
    }
    if (data.metadata.importJudge === undefined) {
      data.metadata.importJudge = false;
    }
    if (data.metadata.importCourtReporter === undefined) {
      data.metadata.importCourtReporter = false;
    }
    
    console.log(`  ✓ Updated metadata with import flags`);
    
    // Write back to file
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    console.log(`  ✅ Successfully updated ${filePath}`);
    
  } catch (error) {
    console.error(`  ❌ Error processing ${filePath}:`, error);
  }
}

async function main() {
  console.log('Updating all trial-metadata.json files in output/multi-trial...\n');
  
  const pattern = path.join(__dirname, '../output/multi-trial/*/trial-metadata.json');
  const files = glob.sync(pattern);
  
  console.log(`Found ${files.length} trial-metadata.json files`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of files) {
    try {
      await updateTrialMetadata(file);
      successCount++;
    } catch (error) {
      errorCount++;
      console.error(`Failed to update ${file}:`, error);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Update Summary:');
  console.log(`  ✅ Successfully updated: ${successCount} files`);
  if (errorCount > 0) {
    console.log(`  ❌ Failed: ${errorCount} files`);
  }
  console.log('='.repeat(60));
}

// Run the script
main().catch(console.error);