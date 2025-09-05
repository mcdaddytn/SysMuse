#!/usr/bin/env node
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { generateFileToken } from '../utils/fileTokenGenerator';

const program = new Command();

program
  .name('sync')
  .description('Sync configuration and override files between directories')
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
 * Calculate the difference between two objects
 */
function calculateDiff(base: any, custom: any): any {
  const diff: any = {};
  
  for (const key in custom) {
    if (custom.hasOwnProperty(key)) {
      const baseValue = base[key];
      const customValue = custom[key];
      
      // If values are different, include in diff
      if (JSON.stringify(baseValue) !== JSON.stringify(customValue)) {
        diff[key] = customValue;
      }
    }
  }
  
  return diff;
}

/**
 * Sync override files from output to input directories
 */
program
  .command('overrides')
  .description('Copy entity override files from output back to input for active trials')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--dry-run', 'Show what would be copied without actually copying')
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
      
      console.log(`\n🔄 Syncing override files for ${activeTrials.length} trials...`);
      console.log(`  From: ${outputDir}`);
      console.log(`  To: ${inputDir}\n`);
      
      const overrideFiles = [
        'Attorney.json',
        'Witness.json',
        'Trial.json',
        'Judge.json',
        'CourtReporter.json',
        'Marker.json'
      ];
      
      let totalCopied = 0;
      
      for (const trialName of activeTrials) {
        const sourceDir = path.join(outputDir, trialName);
        const targetDir = path.join(inputDir, trialName);
        
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
        
        for (const fileName of overrideFiles) {
          const sourcePath = path.join(sourceDir, fileName);
          const targetPath = path.join(targetDir, fileName);
          
          if (fs.existsSync(sourcePath)) {
            if (options.dryRun) {
              console.log(`  Would copy: ${fileName}`);
            } else {
              // Backup existing file if it exists
              if (fs.existsSync(targetPath)) {
                const backupPath = targetPath + '.bk';
                fs.copyFileSync(targetPath, backupPath);
              }
              
              fs.copyFileSync(sourcePath, targetPath);
              console.log(`  ✅ Copied: ${fileName}`);
            }
            trialFilesCopied++;
          }
        }
        
        if (trialFilesCopied === 0) {
          console.log(`  ℹ️  No override files found`);
        }
        
        totalCopied += trialFilesCopied;
      }
      
      console.log(`\n✨ ${options.dryRun ? 'Would copy' : 'Copied'} ${totalCopied} files total`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

/**
 * Extract custom configuration (diff from default) and save to trial-configs/custom/
 */
program
  .command('config')
  .description('Extract custom config differences and save to trial-configs/custom/')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--dry-run', 'Show what would be saved without actually saving')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const activeTrials = getActiveTrials(config);
      
      if (activeTrials.length === 0) {
        console.log('❌ No active trials found in configuration');
        process.exit(1);
      }
      
      const outputDir = config.outputDir;
      if (!outputDir) {
        console.error('❌ Output directory must be specified in config');
        process.exit(1);
      }
      
      // Load default trialstyle.json
      const defaultConfigPath = 'config/trialstyle.json';
      if (!fs.existsSync(defaultConfigPath)) {
        console.error('❌ Default trialstyle.json not found');
        process.exit(1);
      }
      
      const defaultConfig = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
      
      console.log(`\n🔄 Extracting custom configurations for ${activeTrials.length} trials...`);
      
      const customDir = 'config/trial-configs/custom';
      if (!options.dryRun && !fs.existsSync(customDir)) {
        fs.mkdirSync(customDir, { recursive: true });
      }
      
      let savedCount = 0;
      
      for (const trialName of activeTrials) {
        const trialConfigPath = path.join(outputDir, trialName, 'trialstyle.json');
        
        if (!fs.existsSync(trialConfigPath)) {
          console.log(`⚠️  Config not found for: ${trialName}`);
          continue;
        }
        
        const trialConfig = JSON.parse(fs.readFileSync(trialConfigPath, 'utf-8'));
        
        // Calculate diff from default
        const diff = calculateDiff(defaultConfig, trialConfig);
        
        // Only save if there are differences
        if (Object.keys(diff).length > 0) {
          const shortNameHandle = generateFileToken(trialName);
          const customConfigPath = path.join(customDir, `${shortNameHandle}.json`);
          
          if (options.dryRun) {
            console.log(`\n📁 Would save: ${shortNameHandle}.json`);
            console.log(`  Differences from default:`);
            Object.keys(diff).forEach(key => {
              console.log(`    - ${key}`);
            });
          } else {
            // Backup existing file if it exists
            if (fs.existsSync(customConfigPath)) {
              const backupPath = customConfigPath + '.bk';
              fs.copyFileSync(customConfigPath, backupPath);
            }
            
            fs.writeFileSync(customConfigPath, JSON.stringify(diff, null, 2));
            console.log(`✅ Saved custom config: ${shortNameHandle}.json (${Object.keys(diff).length} differences)`);
          }
          savedCount++;
        } else {
          console.log(`ℹ️  No differences from default for: ${trialName}`);
        }
      }
      
      // Also save merged configs for reference
      const mergedDir = 'config/trial-configs/merged';
      if (!options.dryRun && !fs.existsSync(mergedDir)) {
        fs.mkdirSync(mergedDir, { recursive: true });
      }
      
      for (const trialName of activeTrials) {
        const trialConfigPath = path.join(outputDir, trialName, 'trialstyle.json');
        
        if (fs.existsSync(trialConfigPath)) {
          const shortNameHandle = generateFileToken(trialName);
          const mergedConfigPath = path.join(mergedDir, `${shortNameHandle}.json`);
          
          if (!options.dryRun) {
            const trialConfig = JSON.parse(fs.readFileSync(trialConfigPath, 'utf-8'));
            fs.writeFileSync(mergedConfigPath, JSON.stringify(trialConfig, null, 2));
          }
        }
      }
      
      console.log(`\n✨ ${options.dryRun ? 'Would save' : 'Saved'} ${savedCount} custom config files`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);