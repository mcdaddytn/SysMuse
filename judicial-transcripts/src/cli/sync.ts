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
  // Always use includedTrials - includedTrials is deprecated/placeholder
  return config.includedTrials || [];
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
  .description('Copy entity override files from output back to input for included trials')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--approve', 'Mark files as reviewed/approved during sync')
  .option('--dry-run', 'Show what would be copied without actually copying')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const includedTrials = getActiveTrials(config);
      
      if (includedTrials.length === 0) {
        console.log('❌ No included trials found in configuration');
        process.exit(1);
      }
      
      const inputDir = config.inputDir;
      const outputDir = config.outputDir;
      
      if (!inputDir || !outputDir) {
        console.error('❌ Input and output directories must be specified in config');
        process.exit(1);
      }
      
      console.log(`\n🔄 Syncing override files for ${includedTrials.length} trials...`);
      console.log(`  From: ${outputDir}`);
      console.log(`  To: ${inputDir}\n`);
      
      const overrideFiles = [
        'Attorney.json',
        'Witness.json',
        'Trial.json',
        'Judge.json',
        'CourtReporter.json',
        'Marker.json',
        'trial-metadata.json'  // LLM-generated metadata
      ];
      
      let totalCopied = 0;
      
      for (const trialName of includedTrials) {
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
              // Read the source file
              let content = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
              
              // Add review metadata if --approve flag is set
              if (options.approve) {
                if (!content.metadata) {
                  content.metadata = {};
                }
                content.metadata.userReview = true;
                content.metadata.reviewedAt = new Date().toISOString();
                content.metadata.reviewedBy = 'sync-command';
              }
              
              // Backup existing file if it exists
              if (fs.existsSync(targetPath)) {
                const backupPath = targetPath + '.bk';
                fs.copyFileSync(targetPath, backupPath);
              }
              
              // Write the potentially modified content
              fs.writeFileSync(targetPath, JSON.stringify(content, null, 2));
              console.log(`  ✅ Copied: ${fileName}${options.approve ? ' (approved)' : ''}`);
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
      const includedTrials = getActiveTrials(config);
      
      if (includedTrials.length === 0) {
        console.log('❌ No included trials found in configuration');
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
      
      console.log(`\n🔄 Extracting custom configurations for ${includedTrials.length} trials...`);
      
      const customDir = 'config/trial-configs/custom';
      if (!options.dryRun && !fs.existsSync(customDir)) {
        fs.mkdirSync(customDir, { recursive: true });
      }
      
      let savedCount = 0;
      
      for (const trialName of includedTrials) {
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
      
      for (const trialName of includedTrials) {
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

/**
 * Sync marker files from output to input directories
 */
program
  .command('markers')
  .description('Copy marker files from output back to input for active trials')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--phase <number>', 'Phase number (1 for post-Phase2, 2 for post-Phase3)', '1')
  .option('--approve', 'Mark files as reviewed/approved during sync')
  .option('--dry-run', 'Show what would be copied without actually copying')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const includedTrials = getActiveTrials(config);
      
      if (includedTrials.length === 0) {
        console.log('❌ No included trials found in configuration');
        process.exit(1);
      }
      
      const inputDir = config.inputDir;
      const outputDir = config.outputDir;
      
      if (!inputDir || !outputDir) {
        console.error('❌ Input and output directories must be specified in config');
        process.exit(1);
      }
      
      const markerFile = options.phase === '1' ? 'markers-phase2.json' : 'markers-phase3.json';
      const phaseName = options.phase === '1' ? 'post-Phase2' : 'post-Phase3';
      
      console.log(`\n🔄 Syncing ${phaseName} marker files for ${includedTrials.length} trials...`);
      console.log(`  From: ${outputDir}`);
      console.log(`  To: ${inputDir}\n`);
      
      let totalCopied = 0;
      
      for (const trialName of includedTrials) {
        const sourceDir = path.join(outputDir, trialName);
        const targetDir = path.join(inputDir, trialName);
        const sourcePath = path.join(sourceDir, markerFile);
        const targetPath = path.join(targetDir, markerFile);
        
        if (!fs.existsSync(sourcePath)) {
          console.log(`⚠️  Marker file not found: ${sourcePath}`);
          continue;
        }
        
        console.log(`\n📂 Processing: ${trialName}`);
        
        // Ensure target directory exists
        if (!options.dryRun && !fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        
        if (options.dryRun) {
          console.log(`  Would copy: ${markerFile}`);
        } else {
          // Read the source file
          let content = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
          
          // Add review metadata if --approve flag is set
          if (options.approve) {
            if (!content.metadata) {
              content.metadata = {};
            }
            content.metadata.userReviewed = true;
            content.metadata.reviewedAt = new Date().toISOString();
            content.metadata.reviewedBy = 'sync-command';
          }
          
          // Backup existing file if it exists
          if (fs.existsSync(targetPath)) {
            const backupPath = targetPath + '.bk';
            fs.copyFileSync(targetPath, backupPath);
          }
          
          // Write the potentially modified content
          fs.writeFileSync(targetPath, JSON.stringify(content, null, 2));
          console.log(`  ✅ Copied: ${markerFile}${options.approve ? ' (approved)' : ''}`);
        }
        totalCopied++;
      }
      
      console.log(`\n✨ ${options.dryRun ? 'Would copy' : 'Copied'} ${totalCopied} marker files`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

/**
 * Approve all markers across all trials
 */
program
  .command('approve-all-markers')
  .description('Approve all marker files across all trials in one operation')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--phase <number>', 'Phase number (1 or 2)', '1')
  .option('--dry-run', 'Show what would be approved without actually modifying')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const includedTrials = getActiveTrials(config);
      
      if (includedTrials.length === 0) {
        console.log('❌ No included trials found in configuration');
        process.exit(1);
      }
      
      const outputDir = config.outputDir;
      
      if (!outputDir) {
        console.error('❌ Output directory must be specified in config');
        process.exit(1);
      }
      
      console.log(`\n✅ Approving all markers for ${includedTrials.length} trials...`);
      console.log(`  Phase: ${options.phase}`);
      console.log(`  Output directory: ${outputDir}\n`);
      
      const markerFiles = options.phase === '1' 
        ? ['Marker.json']
        : ['MarkerSection.json'];
      
      let totalApproved = 0;
      let totalErrors = 0;
      
      for (const trialName of includedTrials) {
        const trialDir = path.join(outputDir, trialName);
        console.log(`\n📁 Processing: ${trialName}`);
        
        for (const markerFile of markerFiles) {
          const markerPath = path.join(trialDir, markerFile);
          
          if (!fs.existsSync(markerPath)) {
            console.log(`  ⏭️  Skipped: ${markerFile} (not found)`);
            continue;
          }
          
          if (options.dryRun) {
            console.log(`  🔍 Would approve: ${markerFile}`);
            totalApproved++;
            continue;
          }
          
          try {
            // Read the marker file
            let content = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
            
            // Add approval metadata
            if (!content.metadata) {
              content.metadata = {};
            }
            content.metadata.userReviewed = true;
            content.metadata.reviewedAt = new Date().toISOString();
            content.metadata.reviewedBy = 'approve-all-command';
            
            // Write back the approved content
            fs.writeFileSync(markerPath, JSON.stringify(content, null, 2));
            console.log(`  ✅ Approved: ${markerFile}`);
            totalApproved++;
          } catch (error) {
            console.error(`  ❌ Error approving ${markerFile}: ${error}`);
            totalErrors++;
          }
        }
      }
      
      console.log(`\n✨ ${options.dryRun ? 'Would approve' : 'Approved'} ${totalApproved} marker files`);
      if (totalErrors > 0) {
        console.log(`⚠️  ${totalErrors} errors occurred`);
      }
      
      if (!options.dryRun) {
        console.log('\n💡 You can now resume workflows with: npx ts-node src/cli/workflow.ts resume --all');
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

/**
 * Sync trial style configuration between directories
 */
program
  .command('trialstyle')
  .description('Sync trialstyle.json files between source and destination')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--direction <dir>', 'Direction: to-source or to-dest', 'to-dest')
  .option('--all', 'Sync all trials (not just active ones)')
  .option('--dry-run', 'Show what would be copied without actually copying')
  .action(async (options) => {
    try {
      const config = loadMultiTrialConfig(options.config);
      const trials = options.all ? config.trials : getActiveTrials(config);
      
      if (trials.length === 0) {
        console.log('❌ No trials found in configuration');
        process.exit(1);
      }
      
      const inputDir = config.inputDir;
      const outputDir = config.outputDir;
      
      if (!inputDir || !outputDir) {
        console.error('❌ Input and output directories must be specified in config');
        process.exit(1);
      }
      
      const [sourceBase, targetBase] = options.direction === 'to-source' 
        ? [outputDir, inputDir] 
        : [inputDir, outputDir];
      
      console.log(`\n🔄 Syncing trialstyle.json files...`);
      console.log(`  Direction: ${options.direction}`);
      console.log(`  From: ${sourceBase}`);
      console.log(`  To: ${targetBase}\n`);
      
      let totalCopied = 0;
      
      for (const trialName of trials) {
        const sourceDir = path.join(sourceBase, typeof trialName === 'string' ? trialName : trialName.name);
        const targetDir = path.join(targetBase, typeof trialName === 'string' ? trialName : trialName.name);
        const sourcePath = path.join(sourceDir, 'trialstyle.json');
        const targetPath = path.join(targetDir, 'trialstyle.json');
        
        if (!fs.existsSync(sourcePath)) {
          console.log(`⚠️  Source file not found: ${sourcePath}`);
          continue;
        }
        
        if (options.dryRun) {
          console.log(`Would copy: ${sourcePath} -> ${targetPath}`);
        } else {
          // Ensure target directory exists
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          // Backup existing file if it exists
          if (fs.existsSync(targetPath)) {
            const backupPath = targetPath + '.bk';
            fs.copyFileSync(targetPath, backupPath);
          }
          
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`✅ Copied: ${typeof trialName === 'string' ? trialName : trialName.name}/trialstyle.json`);
        }
        totalCopied++;
      }
      
      console.log(`\n✨ ${options.dryRun ? 'Would copy' : 'Copied'} ${totalCopied} trialstyle.json files`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);