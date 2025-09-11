import * as fs from 'fs';
import * as path from 'path';

const sourceDir = '/Users/gmcaveney/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf';
const outputDir = './output/multi-trial';

// Trials that had override import issues
const problemTrials = [
  '18 Wi-Lan V. Htc',
  '22 Core Wireless V. Apple',
  '50 Packet Netscout',
  '62 Simpleair V. Google 582',
  '106 Chrimar Systems V. Aerohive'
];

interface MetadataStatus {
  trial: string;
  sourceExists: boolean;
  outputExists: boolean;
  sourceValid: boolean;
  outputValid: boolean;
  sourceSize: number;
  outputSize: number;
  hasAttorneys: boolean;
  attorneyCount: number;
  needsLLM: boolean;
}

function checkMetadataFile(filePath: string): { valid: boolean; size: number; attorneyCount: number } {
  if (!fs.existsSync(filePath)) {
    return { valid: false, size: 0, attorneyCount: 0 };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    const attorneyCount = data.Attorney ? data.Attorney.length : 0;
    return {
      valid: true,
      size: content.length,
      attorneyCount
    };
  } catch (error) {
    return { valid: false, size: fs.statSync(filePath).size, attorneyCount: 0 };
  }
}

async function checkAllTrials() {
  const results: MetadataStatus[] = [];
  
  // Get all trial directories from output
  const outputTrials = fs.readdirSync(outputDir)
    .filter(dir => fs.statSync(path.join(outputDir, dir)).isDirectory())
    .filter(dir => !dir.startsWith('.'));
  
  console.log(`Found ${outputTrials.length} trials in output directory\n`);
  
  for (const trial of outputTrials) {
    const sourceMetaPath = path.join(sourceDir, trial, 'trial-metadata.json');
    const outputMetaPath = path.join(outputDir, trial, 'trial-metadata.json');
    
    const sourceCheck = checkMetadataFile(sourceMetaPath);
    const outputCheck = checkMetadataFile(outputMetaPath);
    
    const status: MetadataStatus = {
      trial,
      sourceExists: fs.existsSync(sourceMetaPath),
      outputExists: fs.existsSync(outputMetaPath),
      sourceValid: sourceCheck.valid,
      outputValid: outputCheck.valid,
      sourceSize: sourceCheck.size,
      outputSize: outputCheck.size,
      hasAttorneys: sourceCheck.attorneyCount > 0 || outputCheck.attorneyCount > 0,
      attorneyCount: Math.max(sourceCheck.attorneyCount, outputCheck.attorneyCount),
      needsLLM: !fs.existsSync(sourceMetaPath) && fs.existsSync(outputMetaPath)
    };
    
    results.push(status);
  }
  
  // Sort by trial name
  results.sort((a, b) => a.trial.localeCompare(b.trial));
  
  // Print summary
  console.log('=== METADATA COVERAGE SUMMARY ===\n');
  
  const hasSource = results.filter(r => r.sourceExists);
  const hasOutput = results.filter(r => r.outputExists);
  const needsLLM = results.filter(r => r.needsLLM);
  const noMetadata = results.filter(r => !r.sourceExists && !r.outputExists);
  
  console.log(`Total trials: ${results.length}`);
  console.log(`Has source metadata: ${hasSource.length}`);
  console.log(`Has output metadata: ${hasOutput.length}`);
  console.log(`Needs LLM generation: ${needsLLM.length}`);
  console.log(`No metadata at all: ${noMetadata.length}\n`);
  
  // Show problem trials
  console.log('=== PROBLEM TRIALS (from override import failures) ===\n');
  for (const problemTrial of problemTrials) {
    const status = results.find(r => r.trial === problemTrial);
    if (status) {
      console.log(`${status.trial}:`);
      console.log(`  Source: ${status.sourceExists ? '✓' : '✗'} (${status.sourceSize} bytes)`);
      console.log(`  Output: ${status.outputExists ? '✓' : '✗'} (${status.outputSize} bytes)`);
      console.log(`  Attorneys: ${status.attorneyCount}`);
      console.log(`  Valid: Source=${status.sourceValid ? '✓' : '✗'}, Output=${status.outputValid ? '✓' : '✗'}`);
      console.log();
    }
  }
  
  // Show trials that needed LLM generation
  if (needsLLM.length > 0) {
    console.log('=== TRIALS THAT NEEDED LLM GENERATION ===\n');
    for (const trial of needsLLM) {
      console.log(`${trial.trial}: Output exists (${trial.outputSize} bytes), no source`);
    }
    console.log();
  }
  
  // Show trials with no metadata
  if (noMetadata.length > 0) {
    console.log('=== TRIALS WITH NO METADATA ===\n');
    for (const trial of noMetadata) {
      console.log(`${trial.trial}`);
    }
    console.log();
  }
  
  // Show trials where we should copy output back to source
  const shouldCopyToSource = results.filter(r => 
    r.outputExists && r.outputValid && (!r.sourceExists || r.outputSize > r.sourceSize)
  );
  
  if (shouldCopyToSource.length > 0) {
    console.log('=== SHOULD COPY OUTPUT TO SOURCE ===\n');
    for (const trial of shouldCopyToSource) {
      const reason = !trial.sourceExists ? 'no source' : 'output is larger';
      console.log(`${trial.trial}: ${reason} (output: ${trial.outputSize} bytes)`);
    }
  }
  
  return results;
}

checkAllTrials().catch(console.error);