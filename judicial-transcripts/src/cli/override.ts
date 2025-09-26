#!/usr/bin/env node
import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { OverrideImporter } from '../services/override/OverrideImporter';
import { LLMExtractor, ExtractedEntities } from '../services/llm/LLMExtractor';
import { PromptBuilder } from '../services/llm/PromptBuilder';
import { MultiProviderLLM } from '../services/llm/MultiProviderLLM';
import { OverrideData } from '../services/override/types';

const prisma = new PrismaClient();

const program = new Command();

program
  .name('override')
  .description('Entity override system - import overrides and extract entities using LLM')
  .version('1.0.0');

// Import command
program
  .command('import <file>')
  .description('Import entity overrides from JSON file')
  .option('--validate-only', 'Only validate the file without importing')
  .option('--verbose', 'Show detailed import progress')
  .action(async (file: string, options) => {
    try {
      console.log(`\n🔄 Loading override file: ${file}`);
      
      const importer = new OverrideImporter(prisma);
      const data = await importer.loadOverrideFile(file);
      
      // Validate
      console.log('\n📋 Validating override data...');
      const validation = importer.validateOverrides(data);
      
      if (validation.errors.length > 0) {
        console.error('\n❌ Validation errors:');
        validation.errors.forEach(err => console.error(`  - ${err}`));
      }
      
      if (validation.warnings.length > 0) {
        console.warn('\n⚠️  Validation warnings:');
        validation.warnings.forEach(warn => console.warn(`  - ${warn}`));
      }
      
      if (!validation.valid) {
        console.error('\n❌ Validation failed. Please fix errors before importing.');
        process.exit(1);
      }
      
      console.log('✅ Validation passed');
      
      if (options.validateOnly) {
        console.log('\n✅ Validation only mode - no import performed');
        process.exit(0);
      }
      
      // Import
      console.log('\n📥 Importing overrides...');
      const result = await importer.applyOverrides(data);
      
      if (result.success) {
        console.log('\n✅ Import successful!');
        console.log('\n📊 Import statistics:');
        if (result.imported.trials) console.log(`  - Trials: ${result.imported.trials}`);
        if (result.imported.attorneys) console.log(`  - Attorneys: ${result.imported.attorneys}`);
        if (result.imported.lawFirms) console.log(`  - Law Firms: ${result.imported.lawFirms}`);
        if (result.imported.lawFirmOffices) console.log(`  - Law Firm Offices: ${result.imported.lawFirmOffices}`);
        if (result.imported.addresses) console.log(`  - Addresses: ${result.imported.addresses}`);
        if (result.imported.judges) console.log(`  - Judges: ${result.imported.judges}`);
        if (result.imported.courtReporters) console.log(`  - Court Reporters: ${result.imported.courtReporters}`);
        if (result.imported.trialAttorneys) console.log(`  - Trial Attorneys: ${result.imported.trialAttorneys}`);
        
        if (options.verbose && result.correlationMap) {
          console.log('\n🔗 Correlation mappings:');
          const map = result.correlationMap;
          if (map.Trial.size > 0) console.log(`  - Trial IDs mapped: ${map.Trial.size}`);
          if (map.Attorney.size > 0) console.log(`  - Attorney IDs mapped: ${map.Attorney.size}`);
          if (map.LawFirm.size > 0) console.log(`  - LawFirm IDs mapped: ${map.LawFirm.size}`);
        }
      } else {
        console.error('\n❌ Import failed:');
        result.errors?.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Extract command
program
  .command('extract')
  .description('Extract entities from transcript headers using LLM')
  .option('--trial-path <path>', 'Path to specific trial folder')
  .option('--all-trials <path>', 'Path to base folder containing all trial folders')
  .option('--output <file>', 'Output JSON file path')
  .option('--import', 'Automatically import extracted entities')
  .option('--provider <provider>', 'LLM provider: openai, anthropic, google')
  .option('--model <model>', 'LLM model to use')
  .option('--temperature <temp>', 'LLM temperature (0-1)', '0.1')
  .option('--save-prompt', 'Save prompt and context for debugging')
  .action(async (options) => {
    try {
      if (!options.trialPath && !options.allTrials) {
        console.error('❌ Error: Specify either --trial-path or --all-trials');
        process.exit(1);
      }

      const extractor = new LLMExtractor({
        provider: options.provider,
        model: options.model,
        temperature: parseFloat(options.temperature)
      });

      let entities: OverrideData | OverrideData[] | null = null;

      if (options.trialPath) {
        console.log(`\n🔍 Extracting entities from ${options.trialPath}...`);
        entities = await extractor.extractFromTrialFolder(options.trialPath, options.output);
        
        if (!entities) {
          console.error('❌ No entities extracted');
          process.exit(1);
        }
        
        // Validate (cast to ExtractedEntities for validation)
        const validation = extractor.validateExtraction(entities as ExtractedEntities);
        if (!validation.valid) {
          console.error('\n❌ Extraction validation failed:');
          validation.errors.forEach(err => console.error(`  - ${err}`));
        } else {
          console.log('✅ Extraction validated successfully');
        }
      } else if (options.allTrials) {
        console.log(`\n🔍 Extracting entities from all trials in ${options.allTrials}...`);
        const results = await extractor.extractFromAllTrials(options.allTrials);
        entities = results;
        
        console.log(`\n✅ Extracted entities from ${results.length} trials`);
      }

      // Save to file if output specified
      if (options.output && entities) {
        const outputPath = path.resolve(options.output);
        console.log(`\n💾 Saving to ${outputPath}...`);
        
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
        
        fs.writeFileSync(outputPath, JSON.stringify(entities, null, 2));
        console.log('✅ Saved successfully');
      }

      // Import if requested
      if (options.import && entities) {
        console.log('\n📥 Importing extracted entities...');
        const importer = new OverrideImporter(prisma);
        
        // Handle array of extractions
        const entitiesToImport = Array.isArray(entities) ? 
          mergeExtractions(entities) : entities;
        
        const result = await importer.applyOverrides(entitiesToImport);
        
        if (result.success) {
          console.log('✅ Import successful!');
        } else {
          console.error('❌ Import failed:', result.errors);
          process.exit(1);
        }
      }

      // Display extracted entities summary
      if (entities && !Array.isArray(entities)) {
        console.log('\n📊 Extraction summary:');
        if (entities.Trial) {
          const trialCount = Array.isArray(entities.Trial) ? entities.Trial.length : 1;
          console.log(`  - Trials: ${trialCount}`);
        }
        if (entities.Attorney) console.log(`  - Attorneys: ${entities.Attorney.length}`);
        if (entities.LawFirm) console.log(`  - Law Firms: ${entities.LawFirm.length}`);
        if (entities.Judge) console.log(`  - Judges: ${entities.Judge.length}`);
        if (entities.CourtReporter) console.log(`  - Court Reporters: ${entities.CourtReporter.length}`);
      }

    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Export command
program
  .command('export')
  .description('Export existing database entities to override format')
  .option('--trial-id <id>', 'Trial ID to export')
  .option('--output <file>', 'Output JSON file path', 'export-override.json')
  .action(async (options) => {
    try {
      if (!options.trialId) {
        console.error('❌ Error: --trial-id is required');
        process.exit(1);
      }

      const trialId = parseInt(options.trialId);
      console.log(`\n📤 Exporting entities for trial ${trialId}...`);

      // Fetch all related entities
      const trial = await prisma.trial.findUnique({
        where: { id: trialId },
        include: {
          judge: true,
          courtReporter: {
            include: { address: true }
          },
          attorneys: {
            include: {
              attorney: true,
              lawFirm: true,
              lawFirmOffice: {
                include: { address: true }
              }
            }
          }
        }
      });

      if (!trial) {
        console.error(`❌ Trial ${trialId} not found`);
        process.exit(1);
      }

      // Build override structure
      const overrideData: OverrideData = {
        Trial: [{
          ...trial,
          createdAt: trial.createdAt.toISOString(),
          updatedAt: trial.updatedAt.toISOString()
        }],
        Attorney: [],
        LawFirm: [],
        LawFirmOffice: [],
        Address: [],
        Judge: trial.judge ? [{
          ...trial.judge,
          speakerId: trial.judge.speakerId ?? undefined,
          createdAt: undefined,
          updatedAt: undefined
        }] : [],
        CourtReporter: trial.courtReporter ? [{
          ...trial.courtReporter,
          expirationDate: trial.courtReporter.expirationDate?.toISOString(),
          createdAt: undefined,
          updatedAt: undefined
        }] : [],
        TrialAttorney: []
      };

      // Collect unique entities
      const lawFirms = new Map();
      const lawFirmOffices = new Map();
      const addresses = new Map();

      trial.attorneys.forEach(ta => {
        // Add attorney
        if (!overrideData.Attorney!.find(a => a.id === ta.attorney.id)) {
          overrideData.Attorney!.push({
            ...ta.attorney,
            // speakerId removed from Attorney model - now on TrialAttorney
            createdAt: ta.attorney.createdAt.toISOString(),
            updatedAt: ta.attorney.updatedAt.toISOString()
          });
        }

        // Add law firm
        if (ta.lawFirm && !lawFirms.has(ta.lawFirm.id)) {
          lawFirms.set(ta.lawFirm.id, ta.lawFirm);
        }

        // Add law firm office and address
        if (ta.lawFirmOffice) {
          if (!lawFirmOffices.has(ta.lawFirmOffice.id)) {
            lawFirmOffices.set(ta.lawFirmOffice.id, ta.lawFirmOffice);
          }
          if (ta.lawFirmOffice.address && !addresses.has(ta.lawFirmOffice.address.id)) {
            addresses.set(ta.lawFirmOffice.address.id, ta.lawFirmOffice.address);
          }
        }

        // Add trial attorney relationship
        overrideData.TrialAttorney!.push({
          id: `ta-${ta.id}`,
          trialId: ta.trialId,
          attorneyId: ta.attorneyId,
          // speakerId not included in override - speakers are created during transcript parsing
          lawFirmId: ta.lawFirmId,
          lawFirmOfficeId: ta.lawFirmOfficeId,
          role: ta.role
        });
      });

      // Add court reporter address
      if (trial.courtReporter?.address) {
        addresses.set(trial.courtReporter.address.id, trial.courtReporter.address);
      }

      // Convert maps to arrays
      overrideData.LawFirm = Array.from(lawFirms.values());
      overrideData.LawFirmOffice = Array.from(lawFirmOffices.values());
      overrideData.Address = Array.from(addresses.values());

      // Save to file
      const outputPath = path.resolve(options.output);
      fs.writeFileSync(outputPath, JSON.stringify(overrideData, null, 2));

      console.log(`✅ Exported to ${outputPath}`);
      console.log('\n📊 Export summary:');
      const trialCount = overrideData.Trial ? (Array.isArray(overrideData.Trial) ? overrideData.Trial.length : 1) : 0;
      console.log(`  - Trials: ${trialCount}`);
      console.log(`  - Attorneys: ${overrideData.Attorney?.length || 0}`);
      console.log(`  - Law Firms: ${overrideData.LawFirm?.length || 0}`);
      console.log(`  - Law Firm Offices: ${overrideData.LawFirmOffice?.length || 0}`);
      console.log(`  - Addresses: ${overrideData.Address?.length || 0}`);
      console.log(`  - Judges: ${overrideData.Judge?.length || 0}`);
      console.log(`  - Court Reporters: ${overrideData.CourtReporter?.length || 0}`);

    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Regenerate command
program
  .command('regenerate')
  .description('Regenerate overrides using database context and LLM')
  .option('--config <file>', 'Multi-trial configuration file')
  .option('--trial-id <id>', 'Specific trial ID to regenerate')
  .option('--provider <provider>', 'LLM provider: openai, anthropic, google')
  .option('--model <model>', 'LLM model to use')
  .option('--save-prompts', 'Save prompts and contexts to output directory')
  .option('--use-existing', 'Use existing overrides as base for refinement')
  .option('--output-dir <dir>', 'Output directory for overrides')
  .action(async (options) => {
    try {
      const promptBuilder = new PromptBuilder(prisma);
      const extractor = new LLMExtractor(
        {
          provider: options.provider,
          model: options.model,
          temperature: 0.1
        },
        prisma
      );

      let trialIds: number[] = [];

      if (options.config) {
        // Load multi-trial config
        const config = JSON.parse(fs.readFileSync(options.config, 'utf-8'));
        if (config.includedTrials) {
          // Get trial IDs from included trials
          const trials = await prisma.trial.findMany({
            where: {
              shortName: { in: config.includedTrials }
            },
            select: { id: true }
          });
          trialIds = trials.map(t => t.id);
        }
      } else if (options.trialId) {
        trialIds = [parseInt(options.trialId)];
      } else {
        console.error('❌ Error: Specify either --config or --trial-id');
        process.exit(1);
      }

      console.log(`\n🔄 Regenerating overrides for ${trialIds.length} trial(s)...`);

      for (const trialId of trialIds) {
        console.log(`\n📊 Processing trial ${trialId}...`);

        // Generate context from database
        const context = await promptBuilder.generateContextFromDatabase(trialId, {
          includeExistingData: options.useExisting,
          includeRelatedEntities: true,
          includeStatistics: true
        });

        console.log(`  - Found ${context.attorneys?.length || 0} attorneys`);
        console.log(`  - Found ${context.lawFirms?.length || 0} law firms`);

        // Build prompt using template or custom logic
        const prompt = promptBuilder.buildPromptFromTemplate('entity-extraction', context);

        // Save prompt and context if requested
        if (options.savePrompts) {
          const { promptPath, contextPath } = await promptBuilder.savePromptAndContext(
            prompt,
            context,
            options.outputDir
          );
          console.log(`  ✅ Saved prompt: ${promptPath}`);
          console.log(`  ✅ Saved context: ${contextPath}`);
        }

        // Check if LLM is available
        const hasApiKey = process.env.OPENAI_API_KEY || 
                         process.env.ANTHROPIC_API_KEY || 
                         process.env.GOOGLE_API_KEY;
        
        if (hasApiKey) {
          console.log('  🤖 Calling LLM for extraction...');
          
          // Create LLM context from database context
          const llmContext = {
            transcriptHeader: JSON.stringify(context, null, 2),
            trialName: context.trial?.name,
            trialPath: context.trial?.shortName
          };

          const entities = await extractor.requestEntityExtraction(llmContext, options.savePrompts);
          
          // Save regenerated overrides
          const outputDir = options.outputDir || 'output/llm/overrides';
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          const outputFile = path.join(outputDir, `trial-${trialId}-regenerated.json`);
          fs.writeFileSync(outputFile, JSON.stringify(entities, null, 2));
          
          console.log(`  ✅ Saved regenerated overrides: ${outputFile}`);
        } else {
          console.log('  ℹ️  No API key found - only saved prompts for manual review');
        }
      }

      console.log('\n✅ Regeneration complete!');

    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// Helper function to merge multiple extractions
function mergeExtractions(extractions: OverrideData[]): OverrideData {
  const merged: OverrideData = {
    Trial: [],
    Attorney: [],
    LawFirm: [],
    LawFirmOffice: [],
    Address: [],
    Judge: [],
    CourtReporter: [],
    TrialAttorney: []
  };

  let idOffset = 0;
  
  extractions.forEach(extraction => {
    // Merge each entity type with ID offset to avoid conflicts
    if (extraction.Trial) {
      const trials = Array.isArray(extraction.Trial) ? extraction.Trial : [extraction.Trial];
      trials.forEach((t: any) => {
        t.id = typeof t.id === 'number' ? t.id + idOffset : `${idOffset}-${t.id}`;
        if (!merged.Trial) merged.Trial = [];
        if (Array.isArray(merged.Trial)) {
          merged.Trial.push(t);
        }
      });
    }
    
    if (extraction.Attorney) {
      extraction.Attorney.forEach(a => {
        a.id = typeof a.id === 'number' ? a.id + idOffset : `${idOffset}-${a.id}`;
        merged.Attorney!.push(a);
      });
    }
    
    if (extraction.LawFirm) {
      extraction.LawFirm.forEach(f => {
        f.id = typeof f.id === 'number' ? f.id + idOffset : `${idOffset}-${f.id}`;
        merged.LawFirm!.push(f);
      });
    }
    
    if (extraction.LawFirmOffice) {
      extraction.LawFirmOffice.forEach(o => {
        o.id = typeof o.id === 'number' ? o.id + idOffset : `${idOffset}-${o.id}`;
        o.lawFirmId = typeof o.lawFirmId === 'number' ? o.lawFirmId + idOffset : `${idOffset}-${o.lawFirmId}`;
        if (o.addressId) {
          o.addressId = typeof o.addressId === 'number' ? o.addressId + idOffset : `${idOffset}-${o.addressId}`;
        }
        merged.LawFirmOffice!.push(o);
      });
    }
    
    if (extraction.Address) {
      extraction.Address.forEach(a => {
        a.id = typeof a.id === 'number' ? a.id + idOffset : `${idOffset}-${a.id}`;
        merged.Address!.push(a);
      });
    }
    
    if (extraction.Judge) {
      extraction.Judge.forEach(j => {
        j.id = typeof j.id === 'number' ? j.id + idOffset : `${idOffset}-${j.id}`;
        if (j.trialId) {
          j.trialId = typeof j.trialId === 'number' ? j.trialId + idOffset : `${idOffset}-${j.trialId}`;
        }
        merged.Judge!.push(j);
      });
    }
    
    if (extraction.CourtReporter) {
      extraction.CourtReporter.forEach(c => {
        c.id = typeof c.id === 'number' ? c.id + idOffset : `${idOffset}-${c.id}`;
        if (c.trialId) {
          c.trialId = typeof c.trialId === 'number' ? c.trialId + idOffset : `${idOffset}-${c.trialId}`;
        }
        if (c.addressId) {
          c.addressId = typeof c.addressId === 'number' ? c.addressId + idOffset : `${idOffset}-${c.addressId}`;
        }
        merged.CourtReporter!.push(c);
      });
    }
    
    idOffset += 1000; // Increment offset for next extraction
  });

  return merged;
}

// Batch extract command
program
  .command('batch-extract')
  .description('Extract entities from all trials in batch mode')
  .requiredOption('--input-dir <dir>', 'Directory containing trial folders')
  .requiredOption('--output-dir <dir>', 'Directory for override files')
  .option('--provider <provider>', 'LLM provider: openai, anthropic, google', 'openai')
  .option('--model <model>', 'LLM model to use')
  .option('--parallel <n>', 'Number of parallel processes', '1')
  .option('--resume', 'Resume from last processed trial')
  .option('--dry-run', 'Show what would be processed without executing')
  .option('--save-prompts', 'Save prompts for debugging')
  .action(async (options) => {
    try {
      const inputDir = path.resolve(options.inputDir);
      const outputDir = path.resolve(options.outputDir);
      
      // Ensure directories exist
      if (!fs.existsSync(inputDir)) {
        console.error(`❌ Input directory not found: ${inputDir}`);
        process.exit(1);
      }
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Get all trial directories
      const trialDirs = fs.readdirSync(inputDir)
        .map(name => path.join(inputDir, name))
        .filter(dir => fs.statSync(dir).isDirectory());
      
      console.log(`\n🗂️  Found ${trialDirs.length} trials to process`);
      
      // Check for resume file
      const progressFile = path.join(outputDir, '.batch-progress.json');
      let processed: string[] = [];
      
      if (options.resume && fs.existsSync(progressFile)) {
        const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
        processed = progress.processed || [];
        console.log(`📂 Resuming from previous run (${processed.length} already processed)`);
      }
      
      // Filter out already processed trials
      const toProcess = trialDirs.filter(dir => !processed.includes(path.basename(dir)));
      
      if (toProcess.length === 0) {
        console.log('✅ All trials already processed!');
        process.exit(0);
      }
      
      console.log(`\n📋 Processing ${toProcess.length} trials...`);
      
      if (options.dryRun) {
        console.log('\n🔍 Dry run - trials to process:');
        toProcess.forEach((dir, i) => {
          console.log(`  ${i + 1}. ${path.basename(dir)}`);
        });
        console.log('\n✅ Dry run complete (no extraction performed)');
        process.exit(0);
      }
      
      // Initialize extractor
      const extractor = new LLMExtractor({
        provider: options.provider,
        model: options.model,
        temperature: 0.1
      });
      
      // Process trials
      const startTime = Date.now();
      let successCount = 0;
      let failCount = 0;
      const failedTrials: string[] = [];
      
      for (let i = 0; i < toProcess.length; i++) {
        const trialDir = toProcess[i];
        const trialName = path.basename(trialDir);
        const progress = `[${i + 1}/${toProcess.length}]`;
        
        console.log(`\n${progress} Processing: ${trialName}`);
        
        try {
          const outputFile = path.join(outputDir, `${trialName}.json`);
          
          // Extract entities
          const entities = await extractor.extractFromTrialFolder(trialDir);
          
          if (entities) {
            // Save to file
            fs.writeFileSync(outputFile, JSON.stringify(entities, null, 2));
            console.log(`  ✅ Saved to: ${outputFile}`);
            successCount++;
          } else {
            console.log(`  ⚠️  No entities extracted`);
            failCount++;
            failedTrials.push(trialName);
          }
          
          // Update progress
          processed.push(trialName);
          fs.writeFileSync(progressFile, JSON.stringify({
            processed,
            lastUpdate: new Date().toISOString(),
            stats: { success: successCount, failed: failCount }
          }, null, 2));
          
        } catch (error) {
          console.error(`  ❌ Error: ${error}`);
          failCount++;
          failedTrials.push(trialName);
          
          // Still mark as processed to avoid retry
          processed.push(trialName);
          fs.writeFileSync(progressFile, JSON.stringify({
            processed,
            lastUpdate: new Date().toISOString(),
            stats: { success: successCount, failed: failCount }
          }, null, 2));
        }
        
        // Progress estimate
        const elapsed = Date.now() - startTime;
        const avgTime = elapsed / (i + 1);
        const remaining = avgTime * (toProcess.length - i - 1);
        const eta = new Date(Date.now() + remaining);
        
        if (i < toProcess.length - 1) {
          console.log(`  ⏱️  ETA: ${eta.toLocaleTimeString()}`);
        }
      }
      
      // Final summary
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('\n' + '═'.repeat(50));
      console.log('📊 Batch Processing Complete');
      console.log('═'.repeat(50));
      console.log(`✅ Successful: ${successCount}`);
      console.log(`❌ Failed: ${failCount}`);
      console.log(`⏱️  Total time: ${totalTime} seconds`);
      console.log(`📁 Output directory: ${outputDir}`);
      
      if (failedTrials.length > 0) {
        console.log('\n⚠️  Failed trials:');
        failedTrials.forEach(trial => console.log(`  - ${trial}`));
      }
      
      // Clean up progress file if all successful
      if (failCount === 0) {
        fs.unlinkSync(progressFile);
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

// List models command
program
  .command('list-models')
  .description('List available LLM providers and models')
  .action(async () => {
    try {
      const multiLLM = new MultiProviderLLM();
      
      console.log('\n📋 Available LLM Providers and Models:\n');
      
      const providers: Array<'openai' | 'anthropic' | 'google'> = ['openai', 'anthropic', 'google'];
      
      for (const provider of providers) {
        const isConfigured = multiLLM.isProviderConfigured(provider);
        const models = multiLLM.getAvailableModels(provider);
        
        console.log(`${provider.toUpperCase()}`);
        console.log(`  Status: ${isConfigured ? '✅ Configured' : '❌ No API key'}`);
        
        if (models.length > 0) {
          console.log('  Models:');
          models.forEach(model => {
            console.log(`    - ${model}`);
          });
        }
        console.log();
      }
      
      const currentInfo = multiLLM.getInfo();
      console.log('Current Default:');
      console.log(`  Provider: ${currentInfo.provider}`);
      console.log(`  Model: ${currentInfo.model}`);
      console.log(`  Available: ${currentInfo.available ? '✅ Yes' : '❌ No API key'}`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);