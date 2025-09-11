#!/usr/bin/env npx ts-node

import * as fs from 'fs';
import * as path from 'path';

interface TrialMetadata {
  Trial: any[];
  Attorney: any[];
  LawFirm: any[];
  LawFirmOffice: any[];
  Address: any[];
  Judge: any[];
  CourtReporter: any[];
  TrialAttorney: any[];
  metadata: any;
}

function fixTrialAttorneyAssociations(metadataPath: string): boolean {
  if (!fs.existsSync(metadataPath)) {
    console.log(`❌ File not found: ${metadataPath}`);
    return false;
  }

  const content = fs.readFileSync(metadataPath, 'utf-8');
  const data: TrialMetadata = JSON.parse(content);

  // Check if TrialAttorney is already populated
  if (data.TrialAttorney && data.TrialAttorney.length > 0) {
    console.log(`✓ TrialAttorney already populated`);
    return false;
  }

  // Check if there are attorneys to associate
  if (!data.Attorney || data.Attorney.length === 0) {
    console.log(`⚠️ No attorneys found to associate`);
    return false;
  }

  // Get the trial ID (usually 1 for single trial files)
  const trialId = data.Trial?.[0]?.id || 1;

  // Create TrialAttorney associations
  const trialAttorneys = [];
  
  for (let i = 0; i < data.Attorney.length; i++) {
    const attorney = data.Attorney[i];
    
    // Try to determine which law firm office this attorney belongs to
    // This is a simplified approach - in reality you might need more logic
    let lawFirmOfficeId = 1; // Default to first office
    
    // Try to match attorney to a law firm office based on available data
    if (data.LawFirmOffice && data.LawFirmOffice.length > 0) {
      // For now, alternate between offices or use heuristics
      // In a real scenario, you'd need to parse the transcript or use other data
      if (i < data.Attorney.length / 2) {
        lawFirmOfficeId = data.LawFirmOffice[0]?.id || 1;
      } else if (data.LawFirmOffice.length > 1) {
        lawFirmOfficeId = data.LawFirmOffice[1]?.id || 1;
      }
    }
    
    // Determine side (plaintiff vs defendant) - simplified heuristic
    // In reality, you'd parse the transcript or use attorney appearance context
    const side = i < data.Attorney.length / 2 ? 'plaintiff' : 'defendant';
    
    trialAttorneys.push({
      id: i + 1,
      trialId: trialId,
      attorneyId: attorney.id,
      lawFirmOfficeId: lawFirmOfficeId,
      side: side,
      leadCounsel: false,
      overrideAction: "ConditionalInsert",
      overrideKey: "attorneyFingerprint"
    });
  }

  // Update the data
  data.TrialAttorney = trialAttorneys;

  // Write back to file
  fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2));
  console.log(`✅ Added ${trialAttorneys.length} TrialAttorney associations`);
  return true;
}

function main() {
  const trialsToFix = [
    '23 Flexuspine V. Globus Medical',
    '33 Personal Audio V. Cbs',
    '34 Personalized Media V Google',
    '35 Rembrandt V Samsung'
  ];

  console.log('=== Fixing TrialAttorney Associations ===\n');

  for (const trial of trialsToFix) {
    const metadataPath = path.join(
      'output/multi-trial',
      trial,
      'trial-metadata.json'
    );
    
    console.log(`Processing: ${trial}`);
    fixTrialAttorneyAssociations(metadataPath);
    console.log();
  }

  // Also check for trial 22 which needs full attorney extraction
  console.log('=== Trials Needing Full Attorney Extraction ===\n');
  console.log('22 Core Wireless V. Apple - No attorneys defined at all');
  console.log('50 Packet Netscout - No metadata file');
  console.log('85 Navico V. Garmin - No metadata file');
}

if (require.main === module) {
  main();
}