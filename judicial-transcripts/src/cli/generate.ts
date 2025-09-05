#!/usr/bin/env node
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { LLMExtractor } from '../services/llm/LLMExtractor';
import { OverrideData } from '../services/override/types';

const prisma = new PrismaClient();
const program = new Command();

program
  .name('generate')
  .description('Generate entity override files using LLM for active trials')
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
  // Use includedTrials as the primary source for trials to process
  return config.includedTrials || config.activeTrials || [];
}

/**
 * Save override file with backup
 */
function saveOverrideFile(filePath: string, data: any, backup: boolean = true): void {
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Backup existing file if it exists
  if (backup && fs.existsSync(filePath)) {
    const backupPath = filePath + '.bk';
    fs.copyFileSync(filePath, backupPath);
    console.log(`  📋 Backed up existing file`);
  }
  
  // Save the new file
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`  ✅ Saved: ${path.basename(filePath)}`);
}

/**
 * Generate attorney overrides from LLM
 */
program
  .command('attorney')
  .alias('Attorney')
  .description('Generate attorney overrides from LLM for active trials')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--provider <provider>', 'LLM provider: openai, anthropic, google')
  .option('--model <model>', 'LLM model to use')
  .option('--temperature <temp>', 'LLM temperature (0-1)', '0.1')
  .option('--dry-run', 'Show what would be generated without saving')
  .option('--no-backup', 'Do not backup existing files')
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
      
      console.log(`\n🤖 Generating attorney overrides for ${activeTrials.length} trials...`);
      console.log(`  Output directory: ${outputDir}\n`);
      
      const extractor = new LLMExtractor({
        provider: options.provider,
        model: options.model,
        temperature: parseFloat(options.temperature)
      });
      
      let successCount = 0;
      let failCount = 0;
      
      for (const trialName of activeTrials) {
        console.log(`\n📂 Processing: ${trialName}`);
        
        const trialDir = path.join(outputDir, trialName);
        const transcriptPath = path.join(trialDir, 'transcript_header.txt');
        
        // Check if we have transcript header to work with
        if (!fs.existsSync(transcriptPath)) {
          console.log(`  ⚠️  No transcript header found, skipping`);
          continue;
        }
        
        try {
          if (options.dryRun) {
            console.log(`  Would generate attorneys from: ${transcriptPath}`);
            console.log(`  Would save to: ${path.join(trialDir, 'Attorney.json')}`);
            successCount++;
          } else {
            // Extract entities using LLM
            const context = {
              transcriptHeader: fs.readFileSync(transcriptPath, 'utf-8'),
              trialName,
              trialPath: trialDir
            };
            
            const entities = await extractor.requestEntityExtraction(context, false);
            
            if (entities && entities.Attorney && entities.Attorney.length > 0) {
              // Prepare attorney override data with all related entities
              const attorneyData: OverrideData = {
                Attorney: entities.Attorney.map(e => ({
                  ...e,
                  overrideAction: 'Upsert' as const,
                  overrideKey: 'attorneyFingerprint'
                })),
                LawFirm: entities.LawFirm?.map(e => ({
                  ...e,
                  overrideAction: 'Upsert' as const,
                  overrideKey: 'lawFirmFingerprint'
                })),
                LawFirmOffice: entities.LawFirmOffice?.map(e => ({
                  ...e,
                  overrideAction: 'Upsert' as const,
                  overrideKey: 'lawFirmOfficeFingerprint'
                })),
                Address: entities.Address?.map(e => ({
                  ...e,
                  overrideAction: 'Upsert' as const
                })),
                TrialAttorney: entities.TrialAttorney?.map(e => ({
                  ...e,
                  overrideAction: 'Upsert' as const
                }))
              };
              
              // Save to output directory
              const outputPath = path.join(trialDir, 'Attorney.json');
              saveOverrideFile(outputPath, attorneyData, options.backup !== false);
              
              console.log(`  📊 Generated ${attorneyData.Attorney?.length || 0} attorneys`);
              if (attorneyData.LawFirm?.length) {
                console.log(`     - ${attorneyData.LawFirm.length} law firms`);
              }
              if (attorneyData.LawFirmOffice?.length) {
                console.log(`     - ${attorneyData.LawFirmOffice.length} law firm offices`);
              }
              successCount++;
            } else {
              console.log(`  ⚠️  No attorneys extracted`);
              failCount++;
            }
          }
        } catch (error) {
          console.error(`  ❌ Error: ${error}`);
          failCount++;
        }
      }
      
      console.log(`\n✨ Generation complete!`);
      console.log(`  ✅ Success: ${successCount} trials`);
      if (failCount > 0) {
        console.log(`  ❌ Failed: ${failCount} trials`);
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

/**
 * Generate judge overrides from LLM (placeholder for future implementation)
 */
program
  .command('judge')
  .alias('Judge')
  .description('Generate judge overrides from LLM for active trials (not yet implemented)')
  .action(async (options) => {
    console.log('⚠️  Judge extraction is not yet implemented');
    console.log('   Judges can be identified in transcript headers but are not currently extracted');
    process.exit(0);
  });

/**
 * Generate court reporter overrides from LLM (placeholder for future implementation)
 */
program
  .command('courtreporter')
  .alias('CourtReporter')
  .alias('court-reporter')
  .description('Generate court reporter overrides from LLM for active trials (not yet implemented)')
  .action(async (options) => {
    console.log('⚠️  Court reporter extraction is not yet implemented');
    console.log('   Court reporters can be identified in transcript headers but are not currently extracted');
    process.exit(0);
  });

/**
 * Generate all entity overrides
 */
program
  .command('all')
  .description('Generate all entity override types for active trials')
  .option('--config <path>', 'Path to multi-trial configuration')
  .option('--provider <provider>', 'LLM provider: openai, anthropic, google')
  .option('--model <model>', 'LLM model to use')
  .option('--temperature <temp>', 'LLM temperature (0-1)', '0.1')
  .option('--dry-run', 'Show what would be generated without saving')
  .option('--no-backup', 'Do not backup existing files')
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
      
      console.log(`\n🤖 Generating all entity overrides for ${activeTrials.length} trials...`);
      console.log(`  Output directory: ${outputDir}\n`);
      
      const extractor = new LLMExtractor({
        provider: options.provider,
        model: options.model,
        temperature: parseFloat(options.temperature)
      });
      
      let totalGenerated = 0;
      
      for (const trialName of activeTrials) {
        console.log(`\n📂 Processing: ${trialName}`);
        
        const trialDir = path.join(outputDir, trialName);
        
        // Try to extract from trial folder
        try {
          if (options.dryRun) {
            console.log(`  Would generate all entities for trial`);
            console.log(`  Would save to: ${trialDir}/`);
          } else {
            const entities = await extractor.extractFromTrialFolder(trialDir);
            
            if (entities) {
              // Save attorney-related entities to Attorney.json
              // This includes Attorney, LawFirm, LawFirmOffice, Address, and TrialAttorney
              if (entities.Attorney && entities.Attorney.length > 0) {
                const data: OverrideData = {
                  Attorney: entities.Attorney.map(e => ({ 
                    ...e, 
                    overrideAction: 'Upsert' as const,
                    overrideKey: 'attorneyFingerprint'
                  })),
                  LawFirm: entities.LawFirm?.map(e => ({ 
                    ...e, 
                    overrideAction: 'Upsert' as const,
                    overrideKey: 'lawFirmFingerprint'
                  })),
                  LawFirmOffice: entities.LawFirmOffice?.map(e => ({ 
                    ...e, 
                    overrideAction: 'Upsert' as const,
                    overrideKey: 'lawFirmOfficeFingerprint'
                  })),
                  Address: entities.Address?.map(e => ({ 
                    ...e, 
                    overrideAction: 'Upsert' as const
                  })),
                  TrialAttorney: entities.TrialAttorney?.map(e => ({ 
                    ...e, 
                    overrideAction: 'Upsert' as const
                  }))
                };
                saveOverrideFile(path.join(trialDir, 'Attorney.json'), data, options.backup !== false);
                console.log(`  ✅ Generated attorney-related entities`);
              }
              
              // Trial updates are separate (if needed)
              if (entities.Trial) {
                const trials = Array.isArray(entities.Trial) ? entities.Trial : [entities.Trial];
                const data: OverrideData = {
                  Trial: trials.map(e => ({ ...e, overrideAction: 'Update' as const }))
                };
                saveOverrideFile(path.join(trialDir, 'Trial.json'), data, options.backup !== false);
                console.log(`  ✅ Generated trial updates`);
              }
              
              totalGenerated++;
            } else {
              console.log(`  ⚠️  No entities extracted`);
            }
          }
        } catch (error) {
          console.error(`  ❌ Error: ${error}`);
        }
      }
      
      console.log(`\n✨ Generation complete!`);
      console.log(`  Generated entities for ${totalGenerated} trials`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);