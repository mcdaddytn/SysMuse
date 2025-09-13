#!/usr/bin/env node

import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { TrialDeletionService } from '../services/TrialDeletionService';
import logger from '../utils/logger';

const prisma = new PrismaClient();
const program = new Command();

program
  .name('delete-trial')
  .description('Delete a trial and all its associated data from the database')
  .version('1.0.0');

program
  .command('delete <identifier>')
  .description('Delete a trial by ID, case number, or short name')
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .option('--force', 'Skip confirmation prompt')
  .action(async (identifier: string, options: { dryRun?: boolean; force?: boolean }) => {
    try {
      const service = new TrialDeletionService(prisma);
      
      // First do a dry run to show what will be deleted
      const dryRunResult = await service.deleteTrial(identifier, true);
      
      if (!dryRunResult.success) {
        console.error(chalk.red('Trial not found'));
        process.exit(1);
      }

      // Display trial information
      console.log(chalk.cyan('\n════════════════════════════════════════'));
      console.log(chalk.cyan('  Trial Information'));
      console.log(chalk.cyan('════════════════════════════════════════'));
      console.log(chalk.white(`  ID:          ${dryRunResult.trial.id}`));
      console.log(chalk.white(`  Name:        ${dryRunResult.trial.name}`));
      console.log(chalk.white(`  Case Number: ${dryRunResult.trial.caseNumber}`));
      console.log(chalk.white(`  Short Name:  ${dryRunResult.trial.shortName || 'N/A'}`));
      
      // Display what will be deleted
      console.log(chalk.cyan('\n════════════════════════════════════════'));
      console.log(chalk.cyan('  Data to be Deleted'));
      console.log(chalk.cyan('════════════════════════════════════════'));
      
      const stats = dryRunResult.statistics;
      const categories = [
        { title: 'Core Data', items: [
          { name: 'Trial Record', count: stats.trial },
          { name: 'Sessions', count: stats.sessions },
          { name: 'Pages', count: stats.pages },
          { name: 'Lines', count: stats.lines }
        ]},
        { title: 'Events', items: [
          { name: 'Trial Events', count: stats.trialEvents },
          { name: 'Court Directives', count: stats.courtDirectiveEvents },
          { name: 'Statement Events', count: stats.statementEvents },
          { name: 'Witness Called Events', count: stats.witnessCalledEvents }
        ]},
        { title: 'Markers', items: [
          { name: 'Markers', count: stats.markers },
          { name: 'Marker Sections', count: stats.markerSections },
          { name: 'Marker Timelines', count: stats.markerTimelines }
        ]},
        { title: 'People', items: [
          { name: 'Speakers', count: stats.speakers },
          { name: 'Trial Attorneys', count: stats.trialAttorneys },
          { name: 'Witnesses', count: stats.witnesses },
          { name: 'Anonymous Speakers', count: stats.anonymousSpeakers },
          { name: 'Jurors', count: stats.jurors },
          { name: 'Judge', count: stats.judge },
          { name: 'Court Reporter', count: stats.courtReporter }
        ]},
        { title: 'Other', items: [
          { name: 'Session Sections', count: stats.sessionSections },
          { name: 'Search Results', count: stats.elasticSearchResults },
          { name: 'Accumulator Results', count: stats.accumulatorResults },
          { name: 'Processing Status', count: stats.processingStatus },
          { name: 'Workflow State', count: stats.workflowState }
        ]}
      ];
      
      categories.forEach(category => {
        const hasData = category.items.some(item => item.count > 0);
        if (hasData) {
          console.log(chalk.cyan(`\n  ${category.title}:`));
          category.items.forEach(item => {
            if (item.count > 0) {
              console.log(chalk.yellow(`    ${item.name.padEnd(25)} ${item.count}`));
            }
          });
        }
      });

      if (options.dryRun) {
        console.log(chalk.green('\n✓ Dry run completed. No data was deleted.'));
        await service.close();
        process.exit(0);
      }

      // Confirm deletion
      if (!options.force) {
        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmDelete',
            message: chalk.red(`\nAre you sure you want to delete trial "${dryRunResult.trial.name}" and all associated data? This action cannot be undone.`),
            default: false
          }
        ]);

        if (!answers.confirmDelete) {
          console.log(chalk.yellow('\n✗ Deletion cancelled'));
          await service.close();
          process.exit(0);
        }
      }

      // Perform actual deletion
      console.log(chalk.yellow('\n⚡ Deleting trial...'));
      const result = await service.deleteTrial(identifier, false);
      
      console.log(chalk.green(`\n✓ ${result.message}`));
      console.log(chalk.green('\nDeletion summary:'));
      
      Object.entries(result.statistics).forEach(([key, count]) => {
        if (count > 0) {
          console.log(chalk.green(`  ${key}: ${count} records deleted`));
        }
      });
      
      await service.close();
      process.exit(0);
      
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      await prisma.$disconnect();
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all trials in the database')
  .option('--json', 'Output in JSON format')
  .action(async (options: { json?: boolean }) => {
    try {
      const service = new TrialDeletionService(prisma);
      const trials = await service.listTrials();
      
      if (options.json) {
        console.log(JSON.stringify(trials, null, 2));
      } else {
        console.log(chalk.cyan('\n════════════════════════════════════════════════════════════════════════════════'));
        console.log(chalk.cyan('  Trials in Database'));
        console.log(chalk.cyan('════════════════════════════════════════════════════════════════════════════════'));
        console.log(chalk.gray('  ID   Short Name                         Case Number         Sessions  Attorneys'));
        console.log(chalk.gray('  ──   ──────────                         ────────────        ────────  ──────────'));
        
        trials.forEach(trial => {
          const id = trial.id.toString().padEnd(5);
          const shortName = (trial.shortName || 'N/A').padEnd(35);
          const caseNumber = trial.caseNumber.padEnd(20);
          const sessions = trial.sessionCount.toString().padEnd(10);
          const attorneys = trial.attorneyCount.toString();
          
          console.log(chalk.white(`  ${id}${shortName}${caseNumber}${sessions}${attorneys}`));
        });
        
        console.log(chalk.cyan(`\n  Total trials: ${trials.length}`));
      }
      
      await service.close();
      process.exit(0);
      
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      await prisma.$disconnect();
      process.exit(1);
    }
  });

program
  .command('delete-phase3 [identifier]')
  .description('Delete only Phase 3 data (markers and marker sections) for a trial or all trials')
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .option('--force', 'Skip confirmation prompt')
  .action(async (identifier: string | undefined, options: { dryRun?: boolean; force?: boolean }) => {
    try {
      const service = new TrialDeletionService(prisma);

      // If no identifier provided, delete Phase 3 for all trials
      if (!identifier) {
        // Get all trials
        const trials = await prisma.trial.findMany({
          orderBy: { id: 'asc' }
        });

        if (trials.length === 0) {
          console.error(chalk.red('No trials found in database'));
          process.exit(1);
        }

        // Display what will be deleted
        console.log(chalk.cyan('\n════════════════════════════════════════'));
        console.log(chalk.cyan('  Delete Phase 3 Data for ALL Trials'));
        console.log(chalk.cyan('════════════════════════════════════════'));
        console.log(chalk.white(`  Total trials: ${trials.length}`));
        console.log(chalk.white('\n  Trials to process:'));
        trials.forEach(trial => {
          console.log(chalk.white(`    ${trial.id}: ${trial.name}`));
        });

        if (options.dryRun) {
          // Calculate total Phase 3 data
          const totalStats = await prisma.$transaction([
            prisma.markerSection.count(),
            prisma.marker.count(),
            prisma.accumulatorResult.count()
          ]);

          console.log(chalk.cyan('\n  Total Phase 3 Data to be Deleted:'));
          console.log(chalk.yellow(`    Marker Sections:     ${totalStats[0]}`));
          console.log(chalk.yellow(`    Markers:             ${totalStats[1]}`));
          console.log(chalk.yellow(`    Accumulator Results: ${totalStats[2]}`));

          console.log(chalk.green('\n✓ Dry run completed. No data was deleted.'));
          await service.close();
          process.exit(0);
        }

        // Confirm deletion
        if (!options.force) {
          const answers = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirmDelete',
              message: chalk.red(`\nAre you sure you want to delete Phase 3 data for ALL ${trials.length} trials? This cannot be undone.`),
              default: false
            }
          ]);

          if (!answers.confirmDelete) {
            console.log(chalk.yellow('\n✗ Deletion cancelled'));
            await service.close();
            process.exit(0);
          }
        }

        // Perform deletion for all trials
        console.log(chalk.yellow('\n⚡ Deleting Phase 3 data for all trials...'));

        let totalDeleted = {
          markers: 0,
          markerSections: 0,
          accumulatorResults: 0
        };

        for (const trial of trials) {
          console.log(chalk.gray(`  Processing trial ${trial.id}: ${trial.name}...`));
          const result = await service.deletePhase3Only(trial.id.toString(), false);

          if (result.success) {
            totalDeleted.markers += result.statistics.markers || 0;
            totalDeleted.markerSections += result.statistics.markerSections || 0;
            totalDeleted.accumulatorResults += result.statistics.accumulatorResults || 0;
          }
        }

        console.log(chalk.green('\n✓ Phase 3 data deleted for all trials'));
        console.log(chalk.green('\nTotal deletion summary:'));
        console.log(chalk.green(`  Markers:             ${totalDeleted.markers} records deleted`));
        console.log(chalk.green(`  Marker Sections:     ${totalDeleted.markerSections} records deleted`));
        console.log(chalk.green(`  Accumulator Results: ${totalDeleted.accumulatorResults} records deleted`));

        console.log(chalk.cyan('\n✓ You can now re-run Phase 3 processing for all trials.'));

        await service.close();
        process.exit(0);
      }

      // Single trial deletion (existing code)
      const dryRunResult = await service.deletePhase3Only(identifier, true);

      if (!dryRunResult.success) {
        console.error(chalk.red('Trial not found'));
        process.exit(1);
      }

      // Display trial information
      console.log(chalk.cyan('\n════════════════════════════════════════'));
      console.log(chalk.cyan('  Trial Information'));
      console.log(chalk.cyan('════════════════════════════════════════'));
      console.log(chalk.white(`  ID:          ${dryRunResult.trial.id}`));
      console.log(chalk.white(`  Name:        ${dryRunResult.trial.name}`));
      console.log(chalk.white(`  Case Number: ${dryRunResult.trial.caseNumber}`));
      console.log(chalk.white(`  Short Name:  ${dryRunResult.trial.shortName || 'N/A'}`));

      // Display what will be deleted
      console.log(chalk.cyan('\n════════════════════════════════════════'));
      console.log(chalk.cyan('  Phase 3 Data to be Deleted'));
      console.log(chalk.cyan('════════════════════════════════════════'));

      const stats = dryRunResult.statistics;
      console.log(chalk.yellow(`    Markers                   ${stats.markers}`));
      console.log(chalk.yellow(`    Marker Sections           ${stats.markerSections}`));
      console.log(chalk.yellow(`    Accumulator Results       ${stats.accumulatorResults}`));
      console.log(chalk.yellow(`    Processing Status         ${stats.processingStatus}`));
      console.log(chalk.yellow(`    Workflow State (Phase3)   ${stats.workflowState}`));

      if (options.dryRun) {
        console.log(chalk.green('\n✓ Dry run completed. No data was deleted.'));
        await service.close();
        process.exit(0);
      }

      // Confirm deletion
      if (!options.force) {
        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmDelete',
            message: chalk.red(`\nAre you sure you want to delete Phase 3 data for trial "${dryRunResult.trial.name}"? This will allow you to re-run Phase 3.`),
            default: false
          }
        ]);

        if (!answers.confirmDelete) {
          console.log(chalk.yellow('\n✗ Deletion cancelled'));
          await service.close();
          process.exit(0);
        }
      }

      // Perform actual deletion
      console.log(chalk.yellow('\n⚡ Deleting Phase 3 data...'));
      const result = await service.deletePhase3Only(identifier, false);

      console.log(chalk.green(`\n✓ ${result.message}`));
      console.log(chalk.green('\nPhase 3 deletion summary:'));

      Object.entries(result.statistics).forEach(([key, count]) => {
        if (count > 0) {
          console.log(chalk.green(`  ${key}: ${count} records deleted`));
        }
      });

      console.log(chalk.cyan('\n✓ You can now re-run Phase 3 processing for this trial.'));

      await service.close();
      process.exit(0);
      
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      await prisma.$disconnect();
      process.exit(1);
    }
  });

program
  .command('bulk-delete')
  .description('Delete multiple trials using a pattern or list')
  .option('--pattern <pattern>', 'Delete trials matching a pattern in short name')
  .option('--ids <ids>', 'Comma-separated list of trial IDs to delete')
  .option('--dry-run', 'Show what would be deleted without actually deleting')
  .option('--force', 'Skip confirmation prompt')
  .action(async (options: { pattern?: string; ids?: string; dryRun?: boolean; force?: boolean }) => {
    try {
      if (!options.pattern && !options.ids) {
        console.error(chalk.red('Error: You must specify either --pattern or --ids'));
        process.exit(1);
      }

      const service = new TrialDeletionService(prisma);
      
      // Get list of trials to delete
      let trialsToDelete: Array<{ id: number; name: string; shortName: string | null }> = [];
      
      if (options.ids) {
        const ids = options.ids.split(',').map(id => parseInt(id.trim()));
        for (const id of ids) {
          const dryRun = await service.deleteTrial(id, true);
          if (dryRun.success) {
            trialsToDelete.push(dryRun.trial);
          }
        }
      } else if (options.pattern) {
        const allTrials = await service.listTrials();
        const pattern = new RegExp(options.pattern, 'i');
        trialsToDelete = allTrials
          .filter(t => t.shortName && pattern.test(t.shortName))
          .map(t => ({ id: t.id, name: t.name, shortName: t.shortName }));
      }

      if (trialsToDelete.length === 0) {
        console.log(chalk.yellow('No trials found matching the criteria'));
        await service.close();
        process.exit(0);
      }

      // Display trials to be deleted
      console.log(chalk.cyan('\n════════════════════════════════════════'));
      console.log(chalk.cyan(`  Trials to Delete (${trialsToDelete.length})`));
      console.log(chalk.cyan('════════════════════════════════════════'));
      
      trialsToDelete.forEach(trial => {
        console.log(chalk.yellow(`  • [${trial.id}] ${trial.shortName || trial.name}`));
      });

      if (options.dryRun) {
        console.log(chalk.green('\n✓ Dry run completed. No data was deleted.'));
        await service.close();
        process.exit(0);
      }

      // Confirm deletion
      if (!options.force) {
        const answers = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmDelete',
            message: chalk.red(`\nAre you sure you want to delete ${trialsToDelete.length} trials? This action cannot be undone.`),
            default: false
          }
        ]);

        if (!answers.confirmDelete) {
          console.log(chalk.yellow('\n✗ Deletion cancelled'));
          await service.close();
          process.exit(0);
        }
      }

      // Delete trials
      console.log(chalk.yellow('\n⚡ Deleting trials...'));
      let successCount = 0;
      let failCount = 0;
      
      for (const trial of trialsToDelete) {
        try {
          await service.deleteTrial(trial.id, false);
          console.log(chalk.green(`  ✓ Deleted: ${trial.shortName || trial.name}`));
          successCount++;
        } catch (error) {
          console.log(chalk.red(`  ✗ Failed: ${trial.shortName || trial.name} - ${error instanceof Error ? error.message : String(error)}`));
          failCount++;
        }
      }
      
      console.log(chalk.cyan(`\n════════════════════════════════════════`));
      console.log(chalk.green(`  Success: ${successCount} trials deleted`));
      if (failCount > 0) {
        console.log(chalk.red(`  Failed: ${failCount} trials`));
      }
      
      await service.close();
      process.exit(failCount > 0 ? 1 : 0);
      
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      await prisma.$disconnect();
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}