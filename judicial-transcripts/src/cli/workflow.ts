#!/usr/bin/env node

import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { EnhancedTrialWorkflowService, WorkflowPhase, WorkflowConfig } from '../services/EnhancedTrialWorkflowService';
import * as fs from 'fs';
import * as path from 'path';
const chalk = require('chalk');
const Table = require('cli-table3');

const prisma = new PrismaClient();
const program = new Command();

program
  .name('workflow')
  .description('Trial transcript workflow management')
  .version('1.0.0');

/**
 * Run workflow command
 */
program
  .command('run')
  .description('Run workflow to specified phase')
  .option('--phase <phase>', 'Target phase (convert, phase1, phase2, phase3, complete)', 'phase3')
  .option('--config <file>', 'Configuration file path')
  .option('--trial-id <id>', 'Specific trial ID to process')
  .option('--case-number <number>', 'Specific trial by case number')
  .option('--reset-system', 'Reset database before running')
  .option('--verbose', 'Show verbose output')
  .option('--force-rerun', 'Force rerun of completed steps')
  .option('--skip-optional', 'Skip optional steps (LLM, cleanup)')
  .option('--continue-on-error', 'Continue processing even if a trial fails')
  .action(async (options) => {
    try {
      console.log(chalk.blue('═══════════════════════════════════════'));
      console.log(chalk.blue.bold('  Trial Workflow Execution'));
      console.log(chalk.blue('═══════════════════════════════════════'));
      console.log();

      // Validate phase
      const validPhases = Object.values(WorkflowPhase);
      if (!validPhases.includes(options.phase as WorkflowPhase)) {
        console.error(chalk.red(`Invalid phase: ${options.phase}`));
        console.error(`Valid phases: ${validPhases.join(', ')}`);
        process.exit(1);
      }

      // System reset if requested
      if (options.resetSystem) {
        console.log(chalk.yellow('⚠️  System reset requested'));
        console.log('This will clear the database and reload seed data.');
        
        // In a real implementation, we'd prompt for confirmation
        console.log(chalk.cyan('Resetting database...'));
        
        // Clear all main tables explicitly
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "TrialAttorney" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "Attorney" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "LawFirmOffice" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "LawFirm" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "Address" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "Judge" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "CourtReporter" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "Witness" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "Speaker" CASCADE');
        await prisma.$executeRawUnsafe('TRUNCATE TABLE "Trial" CASCADE');
        
        console.log(chalk.green('✓ Database reset complete'));
        
        // Run seed
        console.log(chalk.cyan('Loading seed data...'));
        const { execSync } = require('child_process');
        execSync('npm run seed', { 
          stdio: options.verbose ? 'inherit' : 'ignore',
          maxBuffer: 50 * 1024 * 1024 // 50MB buffer
        });
        console.log(chalk.green('✓ Seed data loaded'));
        console.log();
      }

      // Load configuration
      let configData: any = {};
      let trialIds: number[] = [];
      let trialNames: string[] = [];  // Track trial names in order

      if (options.config) {
        if (!fs.existsSync(options.config)) {
          console.error(chalk.red(`Configuration file not found: ${options.config}`));
          process.exit(1);
        }
        
        configData = JSON.parse(fs.readFileSync(options.config, 'utf-8'));
        console.log(chalk.cyan(`Configuration loaded: ${options.config}`));

        // Get trial IDs from configuration
        if (configData.includedTrials) {
          for (const trialPath of configData.includedTrials) {
            const shortName = path.basename(trialPath);
            trialNames.push(shortName);  // Store trial names in order
            const trial = await prisma.trial.findFirst({
              where: { shortName }
            });
            
            if (!trial) {
              // Trial doesn't exist yet, it will be created during PDF convert/Phase 1
              console.log(chalk.yellow(`Trial not found, will be created: ${shortName}`));
              // For new trials, we'll use negative indexes to track which trial
              trialIds.push(-(trialNames.length));  // Use negative index
            } else {
              trialIds.push(trial.id);
            }
          }
        }
      }

      // Override with specific trial ID if provided
      if (options.trialId) {
        trialIds = [parseInt(options.trialId)];
      } else if (options.caseNumber) {
        // Look up trial by case number
        const trial = await prisma.trial.findUnique({
          where: { caseNumber: options.caseNumber }
        });
        
        if (trial) {
          trialIds = [trial.id];
        } else {
          console.error(chalk.red(`Trial with case number "${options.caseNumber}" not found`));
          process.exit(1);
        }
      }

      // If no trials specified, get all trials
      if (trialIds.length === 0) {
        const trials = await prisma.trial.findMany();
        trialIds = trials.map(t => t.id);
        
        if (trialIds.length === 0) {
          console.error(chalk.red('No trials found in database'));
          console.log(chalk.yellow('Run Phase 1 first to import trials'));
          process.exit(1);
        }
      }

      // Create workflow service
      const workflowConfig: WorkflowConfig = {
        configFile: options.config,
        verbose: options.verbose,
        forceRerun: options.forceRerun,
        skipOptional: options.skipOptional,
        enableLLMOverrides: configData.workflow?.enableLLMOverrides || false,
        enableLLMMarkers: configData.workflow?.enableLLMMarkers || false,
        cleanupPhase2After: configData.workflow?.cleanupPhase2After || false,
        phase2RetentionHours: configData.workflow?.phase2RetentionHours || 24,
        outputDir: configData.outputDir || 'output/multi-trial',
        inputDir: configData.inputDir,
        autoReview: configData.workflow?.autoReview,
        execTimeout: configData.workflow?.execTimeout || 1200000  // Default 20 minutes for batch processing
      };

      const workflowService = new EnhancedTrialWorkflowService(prisma, workflowConfig);

      console.log(chalk.cyan(`Target phase: ${chalk.bold(options.phase)}`));
      console.log(chalk.cyan(`Trials to process: ${chalk.bold(trialIds.filter(id => id > 0).length || 'from config')}`));
      console.log();

      // Process each trial sequentially
      let successCount = 0;
      let failCount = 0;
      const failures: Array<{ trialId: number | string; error: string }> = [];

      for (let i = 0; i < trialIds.length; i++) {
        const trialId = trialIds[i];
        
        try {
          // For new trials (negative id), we'll run the workflow without a specific trial ID
          // The Phase 1 process will create the trial
          if (trialId < 0) {
            // Get the correct trial name based on the negative index
            const trialIndex = Math.abs(trialId) - 1;
            const trialName = trialNames[trialIndex];
            
            if (!trialName) {
              console.error(chalk.red(`Invalid trial index: ${trialIndex}`));
              failCount++;
              failures.push({ trialId: `index-${trialIndex}`, error: 'Invalid trial index' });
              continue;
            }
            
            console.log(chalk.cyan(`Processing new trial: ${trialName}`));
            
            console.log(chalk.yellow(`Running PDF convert for ${trialName} to sync metadata...`));
            
            try {
              // Run PDF convert using the existing config with --trial filter
              const { execSync } = require('child_process');
              // Use npx directly to avoid npm script argument passing issues
              const convertCmd = `npx ts-node src/cli/convert-pdf.ts "${options.config}" --trial "${trialName}"`;
              if (options.verbose) {
                console.log(`Running: ${convertCmd}`);
              }
              execSync(convertCmd, { 
                stdio: options.verbose ? 'inherit' : 'pipe',
                timeout: configData.workflow?.execTimeout || 600000
              });
              console.log(chalk.green('✓ PDF convert and metadata sync complete'));
            
              // Now run Phase 1 parse which will create the trial (also using the main config with trial filter)
              console.log(chalk.yellow('Running Phase 1 parsing...'));
              const phase1Cmd = `npx ts-node src/cli/parse.ts parse --phase1 --config "${options.config}" --trial "${trialName}"`;
              if (options.verbose) {
                console.log(`Running: ${phase1Cmd}`);
              }
              execSync(phase1Cmd, { 
                stdio: options.verbose ? 'inherit' : 'pipe',
                timeout: configData.workflow?.execTimeout || 600000
              });
            } catch (error) {
              console.error(chalk.red(`Failed to process ${trialName}: ${error}`));
              throw error;
            }
            
            // Get the newly created trial by shortName
            const newTrial = await prisma.trial.findFirst({
              where: { shortName: trialName }
            });
            
            if (newTrial) {
              const newTrialId = newTrial.id;
              console.log(chalk.cyan(`Trial ${trialName} has ID: ${newTrialId}`));
              
              // For phase1, we still need to run LLM override and import steps
              // The workflow service will handle the remaining phase1 steps
              if (options.phase === WorkflowPhase.PHASE1) {
                console.log(chalk.yellow('Running remaining phase1 steps (LLM override, import)...'));
                
                // Run the remaining phase1 steps (LLM override, import)
                // but skip PDF convert and phase1 parse since they're done
                const trial = await prisma.trial.findUnique({
                  where: { id: newTrialId },
                  include: { workflowState: true }
                });
                
                if (trial) {
                  // Create workflow state if it doesn't exist
                  if (!trial.workflowState) {
                    console.log(chalk.yellow('Creating TrialWorkflowState record...'));
                    const workflowState = await prisma.trialWorkflowState.create({
                      data: {
                        trialId: newTrialId,
                        pdfConvertCompleted: true,  // We ran PDF convert above
                        pdfConvertAt: new Date(),
                        phase1Completed: true,  // We ran phase1 parse above
                        phase1CompletedAt: new Date(),
                        currentStatus: 'IN_PROGRESS'
                      }
                    });
                    console.log(chalk.green(`✓ TrialWorkflowState created with ID: ${workflowState.id}`));
                  } else {
                    console.log(chalk.yellow('TrialWorkflowState already exists'));
                    // Update to mark PDF convert and phase1 as complete
                    await prisma.trialWorkflowState.update({
                      where: { trialId: newTrialId },
                      data: {
                        pdfConvertCompleted: true,
                        pdfConvertAt: new Date(),
                        phase1Completed: true,
                        phase1CompletedAt: new Date(),
                        currentStatus: 'IN_PROGRESS'
                      }
                    });
                    console.log(chalk.green('✓ Updated TrialWorkflowState'));
                  }
                  
                  // Now run the workflow to complete phase1 (LLM steps)
                  console.log(chalk.yellow('Running workflow service to complete phase1...'));
                  await workflowService.runToPhase(newTrialId, options.phase as WorkflowPhase);
                  console.log(chalk.green('✓ Workflow service completed'));
                } else {
                  console.error(chalk.red(`Could not find trial with ID ${newTrialId}`));
                }
              } else if (options.phase !== WorkflowPhase.PHASE1) {
                // Continue with remaining phases if target is beyond phase1
                await workflowService.runToPhase(newTrialId, options.phase as WorkflowPhase);
              }
            } else {
              console.error(chalk.red(`Could not find or create trial: ${trialName}`));
              failCount++;
              failures.push({ trialId: trialName, error: 'Trial not found after creation' });
            }
            successCount++;
          } else {
            const trial = await prisma.trial.findUnique({
              where: { id: trialId }
            });

            if (!trial) {
              console.error(chalk.red(`Trial ${trialId} not found`));
              failCount++;
              failures.push({ trialId, error: 'Trial not found' });
              continue;
            }

            console.log(chalk.blue(`\n▶ Processing Trial ${trialId}: ${trial.shortName || trial.name}`));
            console.log(chalk.gray(`  Case: ${trial.caseNumber}`));

            await workflowService.runToPhase(trialId, options.phase as WorkflowPhase);
            
            console.log(chalk.green(`✓ Trial ${trialId} completed successfully`));
            successCount++;
          }
        } catch (error) {
          const trialDesc = trialId < 0 ? trialNames[Math.abs(trialId) - 1] : `ID ${trialId}`;
          console.error(chalk.red(`✗ Trial ${trialDesc} failed: ${error instanceof Error ? error.message : error}`));
          failCount++;
          failures.push({ 
            trialId: trialDesc, 
            error: error instanceof Error ? error.message : String(error)
          });
          
          // Continue processing next trial if configured to do so
          if (options.continueOnError) {
            console.log(chalk.yellow('Continuing with next trial...'));
          } else if (i < trialIds.length - 1) {
            console.log(chalk.red('Stopping due to error. Use --continue-on-error to proceed despite failures.'));
            break;
          }
        }
      }

      // Summary
      console.log();
      console.log(chalk.blue('═══════════════════════════════════════'));
      console.log(chalk.blue.bold('  Workflow Summary'));
      console.log(chalk.blue('═══════════════════════════════════════'));
      console.log();
      console.log(chalk.green(`  Successful: ${successCount}`));
      console.log(chalk.red(`  Failed: ${failCount}`));
      
      if (failures.length > 0) {
        console.log();
        console.log(chalk.red('Failed trials:'));
        for (const failure of failures) {
          console.log(chalk.red(`  - Trial ${failure.trialId}: ${failure.error}`));
        }
      }

      process.exit(failCount > 0 ? 1 : 0);
    } catch (error) {
      console.error(chalk.red('Workflow execution failed:'), error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

/**
 * Status command
 */
program
  .command('status')
  .description('Check workflow status')
  .option('--trial-id <id>', 'Specific trial ID')
  .option('--case-number <number>', 'Specific trial by case number')
  .option('--all', 'Show all trials')
  .option('--format <format>', 'Output format (table, json, summary)', 'table')
  .action(async (options) => {
    try {
      const workflowService = new EnhancedTrialWorkflowService(prisma, {});

      let trialId: number | null = null;
      
      if (options.trialId) {
        trialId = parseInt(options.trialId);
      } else if (options.caseNumber) {
        // Look up trial by case number
        const trial = await prisma.trial.findUnique({
          where: { caseNumber: options.caseNumber }
        });
        
        if (trial) {
          trialId = trial.id;
        } else {
          console.error(chalk.red(`Trial with case number "${options.caseNumber}" not found`));
          process.exit(1);
        }
      }
      
      if (trialId) {
        // Get status for specific trial
        const status = await workflowService.getWorkflowStatus(trialId);
        
        if (options.format === 'json') {
          console.log(JSON.stringify(status, null, 2));
        } else {
          displayTrialStatus(status, options.format === 'summary');
        }
      } else {
        // Get status for all trials
        const statuses = await workflowService.getAllWorkflowStatus();
        
        if (options.format === 'json') {
          console.log(JSON.stringify(statuses, null, 2));
        } else if (options.format === 'table') {
          displayStatusTable(statuses);
        } else {
          for (const status of statuses) {
            displayTrialStatus(status, true);
            console.log();
          }
        }
      }
    } catch (error) {
      console.error(chalk.red('Failed to get workflow status:'), error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

/**
 * Reset command
 */
program
  .command('reset')
  .description('Reset workflow state for a trial')
  .option('--trial-id <id>', 'Trial ID to reset')
  .option('--case-number <number>', 'Trial by case number to reset')
  .option('--all', 'Reset all trials')
  .action(async (options) => {
    try {
      if (!options.trialId && !options.caseNumber && !options.all) {
        console.error(chalk.red('Either --trial-id, --case-number, or --all must be specified'));
        process.exit(1);
      }

      if (options.all) {
        await prisma.trialWorkflowState.deleteMany();
        console.log(chalk.green('✓ Reset workflow state for all trials'));
      } else {
        let trialId: number = 0;
        
        if (options.trialId) {
          trialId = parseInt(options.trialId);
        } else if (options.caseNumber) {
          // Look up trial by case number
          const trial = await prisma.trial.findUnique({
            where: { caseNumber: options.caseNumber }
          });
          
          if (trial) {
            trialId = trial.id;
          } else {
            console.error(chalk.red(`Trial with case number "${options.caseNumber}" not found`));
            process.exit(1);
          }
        }
        
        if (trialId > 0) {
          await prisma.trialWorkflowState.delete({
            where: { trialId }
          });
          console.log(chalk.green(`✓ Reset workflow state for trial ${trialId}`));
        }
      }
    } catch (error) {
      console.error(chalk.red('Failed to reset workflow state:'), error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

/**
 * Display trial status
 */
function displayTrialStatus(status: any, summary: boolean = false): void {
  console.log(chalk.blue.bold(`Trial ${status.trialId}: ${status.trialName}`));
  console.log(chalk.gray(`Case: ${status.caseNumber || 'N/A'}`));
  console.log(chalk.cyan(`Completion: ${status.completionPercentage}%`));
  
  if (!summary) {
    console.log();
    console.log(chalk.green('Completed steps:'));
    for (const step of status.completedSteps) {
      console.log(chalk.green(`  ✓ ${step}`));
    }
    
    if (status.pendingSteps.length > 0) {
      console.log();
      console.log(chalk.yellow('Pending steps:'));
      for (const step of status.pendingSteps) {
        console.log(chalk.yellow(`  ⏸ ${step}`));
      }
    }
  }
  
  if (status.lastError) {
    console.log();
    console.log(chalk.red(`Last error: ${status.lastError}`));
    console.log(chalk.red(`Error time: ${status.lastErrorAt}`));
    console.log(chalk.red(`Retry count: ${status.retryCount}`));
  }
}

/**
 * Display status table
 */
function displayStatusTable(statuses: any[]): void {
  const table = new Table({
    head: ['ID', 'Trial', 'Case', 'Progress', 'Status', 'Last Activity'],
    colWidths: [5, 30, 20, 10, 15, 20],
    style: {
      head: ['cyan']
    }
  });

  for (const status of statuses) {
    const progressBar = createProgressBar(status.completionPercentage);
    const statusText = status.lastError ? chalk.red('Failed') :
                       status.completionPercentage === 100 ? chalk.green('Complete') :
                       status.completionPercentage > 0 ? chalk.yellow('In Progress') :
                       chalk.gray('Not Started');
    
    table.push([
      status.trialId,
      status.trialName.substring(0, 28),
      status.caseNumber?.substring(0, 18) || 'N/A',
      progressBar,
      statusText,
      status.lastActivity ? new Date(status.lastActivity).toLocaleString() : 'Never'
    ]);
  }

  console.log(table.toString());
}

/**
 * Create ASCII progress bar
 */
function createProgressBar(percentage: number): string {
  const width = 8;
  const filled = Math.floor((percentage / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `${bar} ${percentage}%`;
}

// Parse arguments
program.parse(process.argv);

// Show help if no command specified
if (!process.argv.slice(2).length) {
  program.outputHelp();
}