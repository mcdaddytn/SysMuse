#!/usr/bin/env npx ts-node

import { Command } from 'commander';
import { PrismaClient } from '@prisma/client';
import { SeedUpdateService } from '../services/SeedUpdateService';
import { Logger } from '../utils/logger';
const chalk = require('chalk');

const logger = new Logger('SeedUpdate-CLI');
const prisma = new PrismaClient();

const program = new Command();

program
  .name('seed-update')
  .description('Update database seed data from JSON files')
  .version('1.0.0');

program
  .command('update')
  .description('Update seed data from specified files')
  .option('-f, --file <files...>', 'Seed files to update')
  .option('-d, --dry-run', 'Preview changes without applying them')
  .option('-v, --verbose', 'Show detailed output')
  .option('--all', 'Update all seed files')
  .action(async (options) => {
    try {
      const service = new SeedUpdateService(prisma);
      
      // Determine which files to update
      let filesToUpdate: string[] = [];
      
      if (options.all) {
        // List all available seed files
        filesToUpdate = [
          'accumulator-expressions.json',
          'court-directives.json',
          'elasticsearch-expressions.json',
          'marker-templates.json'
        ];
        logger.info(chalk.blue('Updating all seed files'));
      } else if (options.file && options.file.length > 0) {
        filesToUpdate = options.file;
      } else {
        logger.error(chalk.red('No files specified. Use --file or --all'));
        process.exit(1);
      }

      if (options.dryRun) {
        logger.info(chalk.yellow('🔍 DRY RUN MODE - No changes will be applied'));
      }

      logger.info(chalk.blue(`Processing ${filesToUpdate.length} file(s)...\n`));

      // Process each file
      const results = await service.updateFromFiles(filesToUpdate, {
        dryRun: options.dryRun,
        verbose: options.verbose
      });

      // Display summary
      console.log('\n' + chalk.bold('📊 Update Summary:'));
      console.log('─'.repeat(60));
      
      let totalUpdated = 0;
      let totalInserted = 0;
      let totalErrors = 0;

      for (const result of results) {
        console.log(chalk.blue(`\n📁 ${result.file}:`));
        console.log(`   Table: ${result.table}`);
        console.log(`   ${chalk.green('✓')} Updated: ${result.updated}`);
        console.log(`   ${chalk.cyan('+')} Inserted: ${result.inserted}`);
        
        if (result.errors > 0) {
          console.log(`   ${chalk.red('✗')} Errors: ${result.errors}`);
          if (options.verbose && result.errorDetails.length > 0) {
            result.errorDetails.forEach(err => {
              console.log(chalk.red(`     - ${JSON.stringify(err)}`));
            });
          }
        }

        totalUpdated += result.updated;
        totalInserted += result.inserted;
        totalErrors += result.errors;
      }

      console.log('\n' + '─'.repeat(60));
      console.log(chalk.bold('Total:'));
      console.log(`  Updated: ${chalk.green(totalUpdated)}`);
      console.log(`  Inserted: ${chalk.cyan(totalInserted)}`);
      if (totalErrors > 0) {
        console.log(`  Errors: ${chalk.red(totalErrors)}`);
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\n⚠️  Dry run completed. No changes were applied.'));
      } else {
        console.log(chalk.green('\n✅ Seed update completed successfully!'));
      }

      await service.disconnect();
    } catch (error) {
      logger.error('Seed update failed:', error);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List available seed files')
  .action(() => {
    console.log(chalk.bold('\n📋 Available Seed Files:\n'));
    const files = [
      { name: 'accumulator-expressions.json', description: 'Accumulator expression patterns' },
      { name: 'accumulator-expressions-extended.json', description: 'Extended accumulator patterns' },
      { name: 'court-directives.json', description: 'Court directive definitions' },
      { name: 'elasticsearch-expressions.json', description: 'ElasticSearch query expressions' },
      { name: 'marker-templates.json', description: 'Marker template definitions' },
      { name: 'search-patterns.json', description: 'Search pattern configurations' },
      { name: 'system-config.json', description: 'System configuration settings' }
    ];

    files.forEach(file => {
      console.log(`  ${chalk.cyan(file.name.padEnd(35))} ${file.description}`);
    });

    console.log(chalk.gray('\nUse: seed-update update --file <filename> to update specific files'));
  });

program
  .command('validate')
  .description('Validate seed files without updating')
  .option('-f, --file <files...>', 'Seed files to validate')
  .action(async (options) => {
    try {
      const service = new SeedUpdateService(prisma);
      const filesToValidate = options.file || [];

      if (filesToValidate.length === 0) {
        logger.error(chalk.red('No files specified for validation'));
        process.exit(1);
      }

      logger.info(chalk.blue('Validating seed files...'));

      for (const file of filesToValidate) {
        try {
          // Perform dry run to validate
          const result = await service.updateFromFile(file, { dryRun: true });
          
          if (result.errors === 0) {
            console.log(`${chalk.green('✓')} ${file}: Valid`);
          } else {
            console.log(`${chalk.red('✗')} ${file}: ${result.errors} error(s)`);
          }
        } catch (error: any) {
          console.log(`${chalk.red('✗')} ${file}: ${error.message}`);
        }
      }

      await service.disconnect();
    } catch (error) {
      logger.error('Validation failed:', error);
      process.exit(1);
    }
  });

// Example usage in help text
program.addHelpText('after', `
${chalk.bold('Examples:')}
  
  Update specific file:
    $ seed-update update --file accumulator-expressions.json
  
  Update multiple files:
    $ seed-update update --file accumulator-expressions.json court-directives.json
  
  Dry run (preview changes):
    $ seed-update update --file accumulator-expressions.json --dry-run
  
  Update all seed files:
    $ seed-update update --all
  
  Verbose output:
    $ seed-update update --file accumulator-expressions.json --verbose
  
  List available files:
    $ seed-update list
  
  Validate files:
    $ seed-update validate --file accumulator-expressions.json
`);

program.parse(process.argv);