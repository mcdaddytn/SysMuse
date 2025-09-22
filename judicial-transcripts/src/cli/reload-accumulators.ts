#!/usr/bin/env node

import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';

const prisma = new PrismaClient();

const program = new Command();

program
  .name('reload-accumulators')
  .description('Reload accumulator expressions from JSON configuration files')
  .version('1.0.0');

program
  .command('reload')
  .description('Delete existing accumulators and reload from JSON files')
  .option('--file <path>', 'Path to accumulator JSON file', 'seed-data/accumulator-expressions.json')
  .option('--extended', 'Use extended accumulator expressions file')
  .option('--dry-run', 'Show what would be done without making changes')
  .action(async (options) => {
    try {
      // Determine which file to use
      let filePath = options.file;
      if (options.extended) {
        filePath = 'seed-data/accumulator-expressions-extended.json';
      }

      // Resolve full path
      const fullPath = path.resolve(process.cwd(), filePath);

      console.log(chalk.cyan('\n════════════════════════════════════════'));
      console.log(chalk.cyan('  Reload Accumulator Expressions'));
      console.log(chalk.cyan('════════════════════════════════════════'));
      console.log(chalk.white(`  Config File: ${filePath}`));

      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        console.error(chalk.red(`\n✗ File not found: ${fullPath}`));
        process.exit(1);
      }

      // Load the JSON file
      const fileContent = await fs.readFile(fullPath, 'utf-8');
      const accumulators = JSON.parse(fileContent);

      console.log(chalk.white(`  Accumulators in file: ${accumulators.length}`));

      if (options.dryRun) {
        console.log(chalk.yellow('\n  DRY RUN MODE - No changes will be made'));
      }

      // Get existing accumulators
      const existingCount = await prisma.accumulatorExpression.count();
      console.log(chalk.white(`  Existing accumulators in DB: ${existingCount}`));

      if (!options.dryRun) {
        // Delete all existing accumulators
        console.log(chalk.yellow('\n  Deleting existing accumulators...'));

        // First delete dependent data
        await prisma.accumulatorResult.deleteMany();
        console.log(chalk.green('    ✓ Deleted accumulator results'));

        await prisma.accumulatorComponent.deleteMany();
        console.log(chalk.green('    ✓ Deleted accumulator components'));

        await prisma.accumulatorExpression.deleteMany();
        console.log(chalk.green('    ✓ Deleted accumulator expressions'));

        // Insert new accumulators
        console.log(chalk.yellow('\n  Loading new accumulators...'));

        for (const accumulator of accumulators) {
          await prisma.accumulatorExpression.create({
            data: {
              name: accumulator.name,
              description: accumulator.description,
              expressionType: accumulator.expressionType,
              windowSize: accumulator.windowSize,
              thresholdValue: accumulator.thresholdValue,
              minConfidenceLevel: accumulator.minConfidenceLevel,
              combinationType: accumulator.combinationType,
              metadata: accumulator.metadata,
              isActive: accumulator.isActive
            }
          });
          console.log(chalk.green(`    ✓ Loaded: ${accumulator.name}`));
        }

        console.log(chalk.green(`\n✓ Successfully reloaded ${accumulators.length} accumulators`));
      } else {
        console.log(chalk.cyan('\n  Accumulators to be loaded:'));
        accumulators.forEach((acc: any) => {
          console.log(chalk.white(`    - ${acc.name}`));
          if (acc.metadata?.attorneyMaxWords || acc.metadata?.judgeMaxWords) {
            console.log(chalk.gray(`      Word limits: attorney=${acc.metadata.attorneyMaxWords}, judge=${acc.metadata.judgeMaxWords}`));
          }
        });
      }

      console.log(chalk.cyan('\n  Next Steps:'));
      console.log(chalk.white('  1. Delete Phase 3 data for affected trials:'));
      console.log(chalk.gray('     npx ts-node src/cli/delete-trial.ts delete-phase3 <trial-id>'));
      console.log(chalk.white('  2. Re-run Phase 3 processing:'));
      console.log(chalk.gray('     npx ts-node src/cli/phase3.ts process --trial <trial-id>'));

    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('show')
  .description('Show current accumulator expressions in the database')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      const accumulators = await prisma.accumulatorExpression.findMany({
        orderBy: { name: 'asc' }
      });

      if (options.json) {
        console.log(JSON.stringify(accumulators, null, 2));
      } else {
        console.log(chalk.cyan('\n════════════════════════════════════════'));
        console.log(chalk.cyan('  Current Accumulator Expressions'));
        console.log(chalk.cyan('════════════════════════════════════════'));

        accumulators.forEach(acc => {
          console.log(chalk.white(`\n  ${acc.name}`));
          console.log(chalk.gray(`    Type: ${acc.expressionType}, Window: ${acc.windowSize}, Active: ${acc.isActive}`));

          const metadata = acc.metadata as any;
          if (metadata?.attorneyMaxWords || metadata?.judgeMaxWords) {
            console.log(chalk.gray(`    Word limits: attorney=${metadata.attorneyMaxWords}, judge=${metadata.judgeMaxWords}`));
          }
        });

        console.log(chalk.cyan(`\n  Total: ${accumulators.length} accumulators`));
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program
  .command('export')
  .description('Export current accumulators from database to JSON file')
  .option('--output <path>', 'Output file path', 'exported-accumulators.json')
  .action(async (options) => {
    try {
      const accumulators = await prisma.accumulatorExpression.findMany({
        orderBy: { name: 'asc' }
      });

      const exportData = accumulators.map(acc => ({
        name: acc.name,
        description: acc.description,
        expressionType: acc.expressionType,
        windowSize: acc.windowSize,
        thresholdValue: acc.thresholdValue,
        minConfidenceLevel: acc.minConfidenceLevel,
        combinationType: acc.combinationType,
        metadata: acc.metadata,
        isActive: acc.isActive
      }));

      await fs.writeFile(options.output, JSON.stringify(exportData, null, 2));

      console.log(chalk.green(`✓ Exported ${accumulators.length} accumulators to ${options.output}`));
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  });

program.parse(process.argv);