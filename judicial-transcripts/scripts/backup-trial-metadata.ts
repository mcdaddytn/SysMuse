#!/usr/bin/env ts-node
/**
 * Backs up trial-metadata.json files from source directories (Dropbox)
 * with timestamp suffix before copying updated configurations.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';
import { format } from 'date-fns';

// Configuration
const SOURCE_BASE = '/Users/gmcaveney/GrassLabel Dropbox/Grass Label Home/docs/transcripts/pdf';
const OUTPUT_BASE = './output/multi-trial';

interface BackupResult {
  trial: string;
  sourcePath: string;
  backupPath: string;
  success: boolean;
  error?: string;
}

function generateTimestamp(): string {
  // Format: MMDDYYHHMMSS
  const now = new Date();
  return format(now, 'MMddyyHHmmss');
}

function backupMetadataFile(trialDir: string): BackupResult {
  const sourcePath = path.join(SOURCE_BASE, trialDir, 'trial-metadata.json');
  const timestamp = generateTimestamp();
  const backupPath = path.join(SOURCE_BASE, trialDir, `trial-metadata-${timestamp}.json`);
  
  const result: BackupResult = {
    trial: trialDir,
    sourcePath,
    backupPath,
    success: false
  };
  
  try {
    // Check if source file exists
    if (!fs.existsSync(sourcePath)) {
      result.error = 'Source file does not exist';
      return result;
    }
    
    // Create backup
    fs.copyFileSync(sourcePath, backupPath);
    result.success = true;
    
    // Verify backup was created
    if (!fs.existsSync(backupPath)) {
      result.success = false;
      result.error = 'Backup file was not created';
    }
    
  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : String(error);
  }
  
  return result;
}

function copyUpdatedMetadata(trialDir: string): boolean {
  const sourcePath = path.join(OUTPUT_BASE, trialDir, 'trial-metadata.json');
  const destPath = path.join(SOURCE_BASE, trialDir, 'trial-metadata.json');
  
  try {
    if (!fs.existsSync(sourcePath)) {
      console.log(`  ⚠️  No updated metadata found for ${trialDir}`);
      return false;
    }
    
    fs.copyFileSync(sourcePath, destPath);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to copy metadata for ${trialDir}:`, error);
    return false;
  }
}

async function main() {
  const action = process.argv[2];
  
  if (action === '--help' || !action) {
    console.log(`
Usage: npx ts-node scripts/backup-trial-metadata.ts [command]

Commands:
  backup     - Create timestamped backups of all trial-metadata.json files
  copy       - Copy updated metadata from output to source directories
  backup-and-copy - Backup then copy (recommended)
  list       - List all trials with metadata files
  restore <trial> <timestamp> - Restore a specific backup

Examples:
  npx ts-node scripts/backup-trial-metadata.ts backup
  npx ts-node scripts/backup-trial-metadata.ts backup-and-copy
  npx ts-node scripts/backup-trial-metadata.ts restore "01 Genband" 121024143022
`);
    return;
  }
  
  // Get all trial directories from output
  const pattern = path.join(OUTPUT_BASE, '*/trial-metadata.json');
  const files = glob.sync(pattern);
  const trials = files.map(f => path.basename(path.dirname(f)));
  
  console.log(`Found ${trials.length} trials with metadata\n`);
  
  if (action === 'list') {
    trials.forEach(trial => {
      const sourcePath = path.join(SOURCE_BASE, trial, 'trial-metadata.json');
      const exists = fs.existsSync(sourcePath);
      console.log(`  ${exists ? '✓' : '✗'} ${trial}`);
    });
    return;
  }
  
  if (action === 'backup' || action === 'backup-and-copy') {
    console.log('Creating backups...\n');
    const timestamp = generateTimestamp();
    console.log(`Timestamp: ${timestamp}\n`);
    
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (const trial of trials) {
      const result = backupMetadataFile(trial);
      
      if (result.success) {
        console.log(`  ✅ Backed up: ${trial}`);
        console.log(`     → ${path.basename(result.backupPath)}`);
        successCount++;
      } else if (result.error === 'Source file does not exist') {
        console.log(`  ⏭️  Skipped: ${trial} (no source file)`);
        skipCount++;
      } else {
        console.log(`  ❌ Failed: ${trial}`);
        console.log(`     Error: ${result.error}`);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('Backup Summary:');
    console.log(`  ✅ Backed up: ${successCount} files`);
    console.log(`  ⏭️  Skipped: ${skipCount} files (no source)`);
    if (errorCount > 0) {
      console.log(`  ❌ Failed: ${errorCount} files`);
    }
    console.log('='.repeat(60));
    
    if (action === 'backup-and-copy' && successCount > 0) {
      console.log('\nCopying updated metadata files...\n');
      
      let copyCount = 0;
      for (const trial of trials) {
        // Only copy if we successfully backed up or if no source existed
        const sourcePath = path.join(SOURCE_BASE, trial, 'trial-metadata.json');
        const needsCopy = fs.existsSync(sourcePath) || !fs.existsSync(sourcePath);
        
        if (needsCopy && copyUpdatedMetadata(trial)) {
          console.log(`  ✅ Copied: ${trial}`);
          copyCount++;
        }
      }
      
      console.log('\n' + '='.repeat(60));
      console.log(`Copied ${copyCount} updated metadata files`);
      console.log('='.repeat(60));
    }
  }
  
  if (action === 'copy') {
    console.log('⚠️  Warning: Creating backups first is recommended!');
    console.log('Use "backup-and-copy" to backup then copy.\n');
    
    const response = await new Promise<string>(resolve => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      readline.question('Continue without backup? (y/N): ', (answer: string) => {
        readline.close();
        resolve(answer);
      });
    });
    
    if (response.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      return;
    }
    
    console.log('\nCopying updated metadata files...\n');
    
    let copyCount = 0;
    for (const trial of trials) {
      if (copyUpdatedMetadata(trial)) {
        console.log(`  ✅ Copied: ${trial}`);
        copyCount++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`Copied ${copyCount} updated metadata files`);
    console.log('='.repeat(60));
  }
  
  if (action === 'restore') {
    const trialName = process.argv[3];
    const timestamp = process.argv[4];
    
    if (!trialName || !timestamp) {
      console.log('Error: Please provide trial name and timestamp');
      console.log('Usage: restore <trial> <timestamp>');
      return;
    }
    
    const backupPath = path.join(SOURCE_BASE, trialName, `trial-metadata-${timestamp}.json`);
    const destPath = path.join(SOURCE_BASE, trialName, 'trial-metadata.json');
    
    if (!fs.existsSync(backupPath)) {
      console.log(`Error: Backup file not found: ${backupPath}`);
      return;
    }
    
    try {
      fs.copyFileSync(backupPath, destPath);
      console.log(`✅ Restored ${trialName} from backup ${timestamp}`);
    } catch (error) {
      console.error(`❌ Failed to restore:`, error);
    }
  }
}

// Run the script
main().catch(console.error);