import { BackgroundLLMService } from './background-llm';
import { promises as fs } from 'fs';
import * as path from 'path';
import chalk from 'chalk';

interface BatchState {
  startTime: string;
  trials: string[];
  completed: Record<string, string[]>;
  failed: Record<string, string[]>;
  skipped: Record<string, string[]>;
  inProgress?: { trial: string; component: string };
  lastUpdate: string;
}

export class EnhancedBackgroundLLMService extends BackgroundLLMService {
  private batchStatePath = path.join(__dirname, '../../output/batch-state.json');

  /**
   * Load or initialize batch state
   */
  private async loadBatchState(): Promise<BatchState | null> {
    try {
      const data = await fs.readFile(this.batchStatePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Save batch state
   */
  private async saveBatchState(state: BatchState) {
    await fs.writeFile(this.batchStatePath, JSON.stringify(state, null, 2));
  }

  /**
   * Generate component summaries with enhanced tracking
   */
  public async generateComponentSummariesEnhanced(
    trialName: string,
    components: string[],
    summaryType: string = 'LLMSummary1'
  ): Promise<{ completed: string[]; failed: string[]; skipped: string[] }> {
    const result = {
      completed: [] as string[],
      failed: [] as string[],
      skipped: [] as string[]
    };

    const config = await this.loadComponentSummaryConfig();
    const summaryConfig = config.summaryTypes[summaryType];

    if (!summaryConfig) {
      throw new Error(`Summary type ${summaryType} not found in configuration`);
    }

    console.log(chalk.cyan(`\n=== Processing ${trialName} ===`));

    // Check for trial summary dependency
    const trialSummary = await this.checkTrialSummaryDependency(trialName);
    if (!trialSummary && summaryConfig.components.some((c: any) => c.dependencies?.includes('trialSummary'))) {
      console.error(chalk.red(`Trial summary required but not found for ${trialName}`));
      result.skipped.push(...components);
      return result;
    }

    // Create output directory
    const outputDir = path.join(
      __dirname,
      '../../output/markersections',
      trialName,
      summaryConfig.outputDir
    );
    await this.ensureDirectoryExists(outputDir);

    // Process each component
    const componentsToProcess = components[0] === 'all'
      ? summaryConfig.components.map((c: any) => c.name)
      : components;

    for (const componentName of componentsToProcess) {
      const componentConfig = summaryConfig.components.find((c: any) => c.name === componentName);
      if (!componentConfig) {
        console.warn(chalk.yellow(`Component ${componentName} not found in configuration`));
        result.skipped.push(componentName);
        continue;
      }

      try {
        const success = await this.generateSingleComponentSummaryEnhanced(
          trialName,
          componentConfig,
          trialSummary,
          outputDir,
          summaryConfig.llmProfile
        );

        if (success === 'completed') {
          result.completed.push(componentName);
        } else if (success === 'skipped') {
          result.skipped.push(componentName);
        } else {
          result.failed.push(componentName);
        }
      } catch (error) {
        console.error(chalk.red(`Error processing ${componentName}: ${error}`));
        result.failed.push(componentName);
      }
    }

    // Summary report
    console.log(chalk.cyan(`\n=== Summary for ${trialName} ===`));
    console.log(chalk.green(`Completed: ${result.completed.length}`));
    console.log(chalk.yellow(`Skipped: ${result.skipped.length}`));
    console.log(chalk.red(`Failed: ${result.failed.length}`));

    return result;
  }

  /**
   * Enhanced single component generation with better error handling
   */
  private async generateSingleComponentSummaryEnhanced(
    trialName: string,
    componentConfig: any,
    trialSummary: string | null,
    outputDir: string,
    llmProfile: string
  ): Promise<'completed' | 'skipped' | 'failed'> {
    const outputPath = path.join(outputDir, componentConfig.outputFile);

    // Check if already exists
    if (this.config.processing.skipExisting) {
      try {
        await fs.access(outputPath);
        const stats = await fs.stat(outputPath);
        if (stats.size > 100) {  // Check if file has meaningful content
          console.log(chalk.gray(`  ✓ Already exists: ${componentConfig.name}`));
          return 'skipped';
        }
      } catch {}
    }

    console.log(chalk.yellow(`  Processing ${componentConfig.name}...`));

    // Load source text
    const sourcePath = path.join(
      __dirname,
      '../../output/markersections',
      trialName,
      componentConfig.sourceFile
    );

    let sourceText: string;
    try {
      sourceText = await fs.readFile(sourcePath, 'utf-8');
      if (sourceText.length < 100) {
        console.warn(chalk.yellow(`  ⚠ Source file too small: ${componentConfig.name}`));
        return 'skipped';
      }
    } catch (error) {
      console.warn(chalk.yellow(`  ⚠ Source not found: ${componentConfig.name}`));
      return 'skipped';
    }

    // Load context template
    const templatePath = path.join(
      __dirname,
      '../../config/templates',
      componentConfig.contextTemplate
    );

    let contextTemplate: string;
    try {
      contextTemplate = await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      console.error(chalk.red(`  ✗ Template not found: ${componentConfig.contextTemplate}`));
      return 'failed';
    }

    // Build prompt with context
    let prompt = contextTemplate
      .replace('{{trialSummary}}', trialSummary || 'Trial summary not available')
      .replace('{{sourceText}}', sourceText)
      .replace('{{trialName}}', trialName)
      .replace('{{componentType}}', componentConfig.name);

    // Initialize LLM with specified profile
    await this.initializeLLM(llmProfile);

    try {
      // Add retry logic
      let attempt = 0;
      const maxAttempts = 3;
      let lastError: any;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          const messages = [
            { role: 'system', content: 'You are a legal analyst specializing in trial transcript analysis.' },
            { role: 'user', content: prompt }
          ];

          console.log(chalk.gray(`    Attempt ${attempt}/${maxAttempts}...`));
          const response = await this.llm.invoke(messages);
          const responseText = response.content;

          await fs.writeFile(outputPath, responseText);
          console.log(chalk.green(`  ✓ Generated ${componentConfig.name}`));
          return 'completed';
        } catch (error: any) {
          lastError = error;
          console.warn(chalk.yellow(`    Attempt ${attempt} failed: ${error.message}`));
          if (attempt < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          }
        }
      }

      throw lastError;
    } catch (error) {
      console.error(chalk.red(`  ✗ Failed to generate ${componentConfig.name}: ${error}`));
      return 'failed';
    }
  }

  /**
   * Batch process with resume capability
   */
  public async batchProcessTrialComponentsWithResume(
    trialNames: string[],
    summaryType: string = 'LLMSummary1',
    resume: boolean = true
  ) {
    // Load or create batch state
    let state: BatchState;
    if (resume) {
      const existingState = await this.loadBatchState();
      if (existingState && existingState.trials.join(',') === trialNames.join(',')) {
        state = existingState;
        console.log(chalk.cyan('Resuming previous batch...'));
        console.log(chalk.gray(`Started: ${state.startTime}`));
        console.log(chalk.gray(`Last update: ${state.lastUpdate}`));
      } else {
        state = this.createNewBatchState(trialNames);
      }
    } else {
      state = this.createNewBatchState(trialNames);
    }

    console.log(chalk.cyan(`\n=== Batch Processing ${trialNames.length} Trials ===`));

    for (const trialName of trialNames) {
      // Skip if already completed
      if (state.completed[trialName]?.length === 4) {
        console.log(chalk.gray(`Skipping completed trial: ${trialName}`));
        continue;
      }

      state.inProgress = { trial: trialName, component: 'all' };
      state.lastUpdate = new Date().toISOString();
      await this.saveBatchState(state);

      const result = await this.generateComponentSummariesEnhanced(trialName, ['all'], summaryType);

      // Update state
      state.completed[trialName] = result.completed;
      state.failed[trialName] = result.failed;
      state.skipped[trialName] = result.skipped;
      delete state.inProgress;
      state.lastUpdate = new Date().toISOString();
      await this.saveBatchState(state);
    }

    // Final report
    console.log(chalk.green(`\n=== Batch Complete ===`));
    console.log(`Total trials: ${trialNames.length}`);

    let totalCompleted = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    for (const trial of trialNames) {
      totalCompleted += (state.completed[trial] || []).length;
      totalFailed += (state.failed[trial] || []).length;
      totalSkipped += (state.skipped[trial] || []).length;
    }

    console.log(chalk.green(`Total completed: ${totalCompleted}`));
    console.log(chalk.yellow(`Total skipped: ${totalSkipped}`));
    console.log(chalk.red(`Total failed: ${totalFailed}`));

    // Clean up state file if all successful
    if (totalFailed === 0) {
      try {
        await fs.unlink(this.batchStatePath);
      } catch {}
    }
  }

  private createNewBatchState(trials: string[]): BatchState {
    return {
      startTime: new Date().toISOString(),
      trials,
      completed: {},
      failed: {},
      skipped: {},
      lastUpdate: new Date().toISOString()
    };
  }

  /**
   * Get detailed batch status
   */
  public async getBatchStatus() {
    const state = await this.loadBatchState();
    if (!state) {
      console.log(chalk.yellow('No batch in progress'));
      return;
    }

    console.log(chalk.cyan('\n=== Batch Status ==='));
    console.log(`Started: ${state.startTime}`);
    console.log(`Last update: ${state.lastUpdate}`);

    if (state.inProgress) {
      console.log(chalk.yellow(`In progress: ${state.inProgress.trial} - ${state.inProgress.component}`));
    }

    console.log('\nTrials:');
    for (const trial of state.trials) {
      const completed = (state.completed[trial] || []).length;
      const failed = (state.failed[trial] || []).length;
      const skipped = (state.skipped[trial] || []).length;
      const total = completed + failed + skipped;

      const status = completed === 4 ? '✓' : failed > 0 ? '✗' : '○';
      console.log(`  ${status} ${trial}: ${completed}/${total} completed`);
    }
  }
}