#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('restore')
  .description('Restore configuration and override files from input to output directories')
  .version('1.0.0');

/**
 * Load the multi-trial configuration file
 */
function loadMultiTrialConfig(configPath?: string): any {
  const defaultPaths = [
    'config/multi-trial-config-mac.json',
    'config/multi-trial-config.json'
  ];
  
  const pathToUse = configPath || defaultPaths.find(p => fs.existsSync(p));
  
  if (!pathToUse || !fs.existsSync(pathToUse)) {
    throw new Error('Multi-trial configuration not found. Specify with --config');
  }
  
  return JSON.parse(fs.readFileSync(pathToUse, 'utf-8'));
}

/**
 * Get active trials from configuration
 */
function getActiveTrials(config: any): string[] {
  // Use activeTrials if present, otherwise use includedTrials
  return config.activeTrials || config.includedTrials || [];
}

/**
 * Restore override files from input to output directories for processing
 */
program
  .command('overrides')
  .description('Copy override files from input to output for active trials (for processing)')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--dry-run', 'Show what would be copied without actually copying')
  .option('--force', 'Overwrite existing files without backup')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const activeTrials = getActiveTrials(config);
      
      if (activeTrials.length === 0) {
        console.log('❌ No active trials found in configuration');
        process.exit(1);
      }
      
      const inputDir = config.inputDir;
      const outputDir = config.outputDir;
      
      if (!inputDir || !outputDir) {
        console.error('❌ Input and output directories must be specified in config');
        process.exit(1);
      }
      
      console.log(`\n🔄 Restoring override files for ${activeTrials.length} trials...`);
      console.log(`  From: ${inputDir}`);
      console.log(`  To: ${outputDir}\n`);
      
      const overrideFiles = [
        'Attorney.json',
        'Witness.json',
        'Trial.json',
        'Judge.json',
        'CourtReporter.json',
        'Marker.json'
      ];
      
      let totalCopied = 0;
      let totalBackedUp = 0;
      
      for (const trialName of activeTrials) {
        const sourceDir = path.join(inputDir, trialName);
        const targetDir = path.join(outputDir, trialName);
        
        if (!fs.existsSync(sourceDir)) {
          console.log(`⚠️  Source directory not found: ${sourceDir}`);
          continue;
        }
        
        console.log(`\n📂 Processing: ${trialName}`);
        
        // Ensure target directory exists
        if (!options.dryRun && !fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        let trialFilesCopied = 0;
        let trialFilesBackedUp = 0;
        
        for (const fileName of overrideFiles) {
          const sourcePath = path.join(sourceDir, fileName);
          const targetPath = path.join(targetDir, fileName);
          
          if (fs.existsSync(sourcePath)) {
            if (options.dryRun) {
              if (fs.existsSync(targetPath)) {
                console.log(`  Would backup and copy: ${fileName}`);
              } else {
                console.log(`  Would copy: ${fileName}`);
              }
            } else {
              // Backup existing file if it exists and force flag not set
              if (fs.existsSync(targetPath) && !options.force) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const backupPath = targetPath + `.${timestamp}.bk`;
                fs.copyFileSync(targetPath, backupPath);
                console.log(`  📋 Backed up: ${fileName}`);
                trialFilesBackedUp++;
              }
              
              fs.copyFileSync(sourcePath, targetPath);
              console.log(`  ✅ Restored: ${fileName}`);
            }
            trialFilesCopied++;
          }
        }
        
        if (trialFilesCopied === 0) {
          console.log(`  ℹ️  No override files found to restore`);
        } else if (trialFilesBackedUp > 0) {
          console.log(`  📊 Restored ${trialFilesCopied} files (${trialFilesBackedUp} backed up)`);
        }
        
        totalCopied += trialFilesCopied;
        totalBackedUp += trialFilesBackedUp;
      }
      
      if (options.dryRun) {
        console.log(`\n✨ Would restore ${totalCopied} files total`);
      } else {
        console.log(`\n✨ Restored ${totalCopied} files total`);
        if (totalBackedUp > 0) {
          console.log(`   (Created ${totalBackedUp} backups)`);
        }
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

/**
 * Restore all configurations and overrides for a fresh start
 */
program
  .command('all')
  .description('Restore both configurations and override files')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--dry-run', 'Show what would be restored without actually restoring')
  .option('--force', 'Overwrite existing files without backup')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const activeTrials = getActiveTrials(config);
      
      console.log(`\n🔄 Full restore for ${activeTrials.length} trials...`);
      
      // First restore override files
      console.log('\n📋 Step 1: Restoring override files...');
      await program.parse(['node', 'restore.ts', 'overrides', 
        ...(options.config ? ['--config', options.config] : []),
        ...(options.dryRun ? ['--dry-run'] : []),
        ...(options.force ? ['--force'] : [])
      ]);
      
      console.log('\n✅ Full restore complete!');
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

/**
 * Clean backup files
 */
program
  .command('clean-backups')
  .description('Remove backup files from output directories')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .option('--keep <n>', 'Keep the n most recent backups', '3')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const activeTrials = getActiveTrials(config);
      const outputDir = config.outputDir;
      
      if (!outputDir) {
        console.error('❌ Output directory must be specified in config');
        process.exit(1);
      }
      
      const keepCount = parseInt(options.keep) || 3;
      console.log(`\n🧹 Cleaning backup files (keeping ${keepCount} most recent)...`);
      
      let totalDeleted = 0;
      
      for (const trialName of activeTrials) {
        const trialDir = path.join(outputDir, trialName);
        
        if (!fs.existsSync(trialDir)) {
          continue;
        }
        
        const files = fs.readdirSync(trialDir);
        const backupFiles = files.filter(f => f.endsWith('.bk'));
        
        if (backupFiles.length === 0) {
          continue;
        }
        
        console.log(`\n📂 ${trialName}: Found ${backupFiles.length} backup files`);
        
        // Group backups by base filename
        const backupGroups: { [key: string]: string[] } = {};
        backupFiles.forEach(file => {
          const baseFile = file.replace(/\.\d{4}-\d{2}-\d{2}T.*\.bk$/, '').replace(/\.bk$/, '');
          if (!backupGroups[baseFile]) {
            backupGroups[baseFile] = [];
          }
          backupGroups[baseFile].push(file);
        });
        
        // Process each group
        for (const [baseFile, backups] of Object.entries(backupGroups)) {
          // Sort by modification time (newest first)
          const sortedBackups = backups
            .map(file => ({
              name: file,
              path: path.join(trialDir, file),
              mtime: fs.statSync(path.join(trialDir, file)).mtime
            }))
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
          
          // Delete older backups
          const toDelete = sortedBackups.slice(keepCount);
          
          if (toDelete.length > 0) {
            console.log(`  ${baseFile}: Removing ${toDelete.length} old backup(s)`);
            
            for (const backup of toDelete) {
              if (options.dryRun) {
                console.log(`    Would delete: ${backup.name}`);
              } else {
                fs.unlinkSync(backup.path);
                console.log(`    Deleted: ${backup.name}`);
              }
              totalDeleted++;
            }
          }
        }
      }
      
      console.log(`\n✨ ${options.dryRun ? 'Would delete' : 'Deleted'} ${totalDeleted} backup files`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);