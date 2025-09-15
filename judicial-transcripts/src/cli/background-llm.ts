#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
import { BackgroundLLMService } from '../services/background-llm';

dotenv.config();

const program = new Command();

program
  .name('background-llm')
  .description('Generate LLM-based profiles and summaries for attorneys and trials')
  .version('1.0.0');

program
  .command('list-profiles')
  .description('List all available LLM profiles')
  .action(async () => {
    try {
      const service = new BackgroundLLMService();
      service.listProfiles();
    } catch (error) {
      console.error(chalk.red('Error listing profiles:'), error);
      process.exit(1);
    }
  });

program
  .command('attorneys')
  .description('Generate attorney profiles')
  .option('--generate-prompts', 'Generate prompt files for attorneys')
  .option('--execute-batch', 'Execute batch processing of prompts')
  .option('--batch-size <number>', 'Number of prompts to process in batch', '5')
  .option('--llm-profile <profile>', 'LLM profile to use')
  .option('--config <path>', 'Path to configuration file')
  .option('--context <suffix>', 'Context template suffix (e.g., medium, long)', 'medium')
  .option('--full', 'Run full pipeline (generate prompts and execute)')
  .action(async (options) => {
    try {
      const service = new BackgroundLLMService(options.config, options.llmProfile, options.context);

      if (options.full) {
        await service.fullPipeline('attorneys', parseInt(options.batchSize));
      } else {
        if (options.generatePrompts) {
          console.log(chalk.cyan('\nGenerating attorney profile prompts...'));
          await service.generateAttorneyPrompts();
        }

        if (options.executeBatch) {
          console.log(chalk.cyan('\nExecuting attorney profile batch...'));
          await service.executeAttorneyBatch(parseInt(options.batchSize));
        }

        if (!options.generatePrompts && !options.executeBatch) {
          console.log(chalk.yellow('Please specify --generate-prompts, --execute-batch, or --full'));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error processing attorneys:'), error);
      process.exit(1);
    }
  });

program
  .command('trials')
  .description('Generate trial summaries')
  .option('--generate-prompts', 'Generate prompt files for trials')
  .option('--execute-batch', 'Execute batch processing of prompts')
  .option('--batch-size <number>', 'Number of prompts to process in batch', '5')
  .option('--llm-profile <profile>', 'LLM profile to use')
  .option('--config <path>', 'Path to configuration file')
  .option('--context <suffix>', 'Context template suffix (e.g., medium, long)', 'long')
  .option('--full', 'Run full pipeline (generate prompts and execute)')
  .action(async (options) => {
    try {
      const service = new BackgroundLLMService(options.config, options.llmProfile, options.context);

      if (options.full) {
        await service.fullPipeline('trials', parseInt(options.batchSize));
      } else {
        if (options.generatePrompts) {
          console.log(chalk.cyan('\nGenerating trial summary prompts...'));
          await service.generateTrialPrompts();
        }

        if (options.executeBatch) {
          console.log(chalk.cyan('\nExecuting trial summary batch...'));
          await service.executeTrialBatch(parseInt(options.batchSize));
        }

        if (!options.generatePrompts && !options.executeBatch) {
          console.log(chalk.yellow('Please specify --generate-prompts, --execute-batch, or --full'));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error processing trials:'), error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Check generation status')
  .option('--type <type>', 'Entity type (attorneys or trials)', 'attorneys')
  .action(async (options) => {
    try {
      const service = new BackgroundLLMService();

      if (options.type !== 'attorneys' && options.type !== 'trials') {
        console.error(chalk.red('Invalid type. Must be "attorneys" or "trials"'));
        process.exit(1);
      }

      await service.getStatus(options.type as 'attorneys' | 'trials');
    } catch (error) {
      console.error(chalk.red('Error checking status:'), error);
      process.exit(1);
    }
  });

program
  .command('trial-components')
  .description('Generate LLM summaries for trial components (Feature 09D)')
  .option('--trial <name>', 'Trial name (e.g., "04 Intellectual Ventures")')
  .option('--components <list>', 'Comma-separated component names or "all"', 'all')
  .option('--summary-type <type>', 'Summary type (e.g., LLMSummary1)', 'LLMSummary1')
  .option('--batch', 'Process multiple trials')
  .option('--trials <list>', 'Comma-separated trial names for batch processing')
  .option('--llm-profile <profile>', 'LLM profile to use', 'claude-sonnet')
  .option('--context <suffix>', 'Context template suffix', 'medium')
  .action(async (options) => {
    try {
      const service = new BackgroundLLMService(undefined, options.llmProfile, options.context);

      if (options.batch) {
        if (!options.trials) {
          console.error(chalk.red('--trials option required when using --batch'));
          process.exit(1);
        }
        const trialNames = options.trials.split(',').map((t: string) => t.trim());
        await service.batchProcessTrialComponents(trialNames, options.summaryType);
      } else {
        if (!options.trial) {
          console.error(chalk.red('--trial option required'));
          process.exit(1);
        }
        const components = options.components.split(',').map((c: string) => c.trim());
        await service.generateComponentSummaries(options.trial, components, options.summaryType);
      }
    } catch (error) {
      console.error(chalk.red('Error processing trial components:'), error);
      process.exit(1);
    }
  });

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}