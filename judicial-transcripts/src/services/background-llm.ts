import { PrismaClient } from '@prisma/client';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { promises as fs } from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { generateFileToken } from '../utils/fileTokenGenerator';

const prisma = new PrismaClient();

interface LLMProfile {
  provider: string;
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
}

interface LLMConfig {
  default: string;
  profiles: Record<string, LLMProfile>;
}

interface ProcessingConfig {
  batchSize: number;
  retryAttempts: number;
  retryDelay: number;
  skipExisting: boolean;
  overwritePrompts: boolean;
  logSkipped: boolean;
}

interface BackgroundLLMConfig {
  llmProfiles: LLMConfig;
  processing: ProcessingConfig;
  output: {
    baseDir: string;
    attorneyDir: string;
    trialDir: string;
  };
}

export class BackgroundLLMService {
  protected config: BackgroundLLMConfig;
  private currentProfile: string;
  protected llm: any;
  private contextSuffix: string;
  private systemPrompt: string = '';

  constructor(configPath?: string, profileOverride?: string, contextSuffix: string = 'medium') {
    this.config = this.loadConfig(configPath);
    this.currentProfile = profileOverride || this.config.llmProfiles.default;
    this.contextSuffix = contextSuffix;
    this.loadSystemPrompt();
    this.initializeLLM();
  }

  private loadSystemPrompt() {
    try {
      const promptPath = path.join(__dirname, '../../templates/llm-legal-role-prompt.txt');
      this.systemPrompt = require('fs').readFileSync(promptPath, 'utf-8');
    } catch (error) {
      console.warn(chalk.yellow('Could not load system prompt from templates, using default'));
      this.systemPrompt = 'You are an expert legal researcher with access to comprehensive public information about attorneys, law firms, and legal cases. Use all available information from your training data including court records, news articles, legal directories, firm websites, and professional databases. Provide specific, factual details rather than generic descriptions.';
    }
  }

  private loadConfig(configPath?: string): BackgroundLLMConfig {
    // Try to load from config file first
    const configFile = configPath || path.join(__dirname, '../../config/llm-models.json');

    try {
      const configData = require('fs').readFileSync(configFile, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      console.warn(chalk.yellow(`Could not load config from ${configFile}, using defaults`));

      // Fallback to default config if file not found
      return {
        llmProfiles: {
          default: 'claude-sonnet',
          profiles: {
            'claude-sonnet': {
              provider: 'anthropic',
              model: 'claude-3-5-sonnet-20241022',
              apiKeyEnv: 'ANTHROPIC_API_KEY',
              maxTokens: 2000,
              temperature: 0.3
            }
          }
        },
        processing: {
          batchSize: 5,
          retryAttempts: 3,
          retryDelay: 1000,
          skipExisting: true,
          overwritePrompts: false,
          logSkipped: true
        },
        output: {
          baseDir: 'output',
          attorneyDir: 'attorneyProfiles',
          trialDir: 'trialSummaries'
        }
      };
    }
  }

  protected initializeLLM(profileOverride?: string) {
    const profile = this.config.llmProfiles.profiles[profileOverride || this.currentProfile];
    if (!profile) {
      throw new Error(`LLM profile '${this.currentProfile}' not found. Available profiles: ${Object.keys(this.config.llmProfiles.profiles).join(', ')}`);
    }

    const apiKey = profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : undefined;
    if (profile.apiKeyEnv && !apiKey) {
      throw new Error(`API key not found in environment variable ${profile.apiKeyEnv}`);
    }

    switch (profile.provider) {
      case 'openai':
        this.llm = new ChatOpenAI({
          modelName: profile.model,
          temperature: profile.temperature,
          maxTokens: profile.maxTokens,
          openAIApiKey: apiKey
        });
        break;
      case 'anthropic':
        this.llm = new ChatAnthropic({
          modelName: profile.model,
          temperature: profile.temperature,
          maxTokens: profile.maxTokens,
          anthropicApiKey: apiKey
        });
        break;
      case 'google':
        this.llm = new ChatGoogleGenerativeAI({
          model: profile.model,
          temperature: profile.temperature,
          apiKey: apiKey
        });
        break;
      default:
        throw new Error(`Unsupported provider: ${profile.provider}`);
    }

    console.log(chalk.green(`Initialized LLM with profile: ${this.currentProfile}`));
  }

  public listProfiles() {
    console.log(chalk.cyan('Available LLM Profiles:'));
    for (const [name, profile] of Object.entries(this.config.llmProfiles.profiles)) {
      const isDefault = name === this.config.llmProfiles.default;
      console.log(`  ${chalk.yellow(name)}${isDefault ? chalk.green(' (default)') : ''}: ${profile.provider}/${profile.model}`);
    }
  }

  protected async ensureDirectoryExists(dirPath: string) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  private async getExistingResponses(entityType: 'attorneys' | 'trials'): Promise<Set<string>> {
    const dir = entityType === 'attorneys'
      ? path.join(this.config.output.baseDir, this.config.output.attorneyDir)
      : path.join(this.config.output.baseDir, this.config.output.trialDir);

    await this.ensureDirectoryExists(dir);

    const files = await fs.readdir(dir);
    const responseFiles = files.filter(f => f.endsWith('_response.txt'));

    const identifiers = new Set<string>();
    for (const file of responseFiles) {
      const identifier = file.replace('_response.txt', '').replace('_profile', '').replace('_summary', '');
      identifiers.add(identifier);
    }

    return identifiers;
  }

  public async generateAttorneyPrompts() {
    const outputDir = path.join(this.config.output.baseDir, this.config.output.attorneyDir);
    await this.ensureDirectoryExists(outputDir);

    const attorneys = await prisma.attorney.findMany({
      include: {
        trialAttorneys: {
          include: {
            lawFirm: true,
            trial: true
          }
        }
      },
      orderBy: {
        id: 'asc'
      }
    });

    // Filter attorneys with law firm associations
    const attorneysWithFirms = attorneys.filter(a =>
      a.trialAttorneys.some(ta => ta.lawFirmId !== null)
    );

    console.log(chalk.cyan(`Found ${attorneysWithFirms.length} attorneys with law firm associations`));
    console.log(chalk.cyan(`Using context template: attorney-context-${this.contextSuffix}.txt`));

    // Load the attorney context template
    let templateContent: string;
    try {
      const templatePath = path.join(__dirname, `../../templates/attorney-context-${this.contextSuffix}.txt`);
      templateContent = await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      console.error(chalk.red(`Could not load attorney template: attorney-context-${this.contextSuffix}.txt`));
      throw error;
    }

    let promptsGenerated = 0;
    let promptsSkipped = 0;

    for (const attorney of attorneysWithFirms) {
      const fingerprint = attorney.attorneyFingerprint || `attorney_${attorney.id}`;
      const promptPath = path.join(outputDir, `${fingerprint}_profile_prompt.txt`);

      if (!this.config.processing.overwritePrompts) {
        try {
          await fs.access(promptPath);
          promptsSkipped++;
          if (this.config.processing.logSkipped) {
            console.log(chalk.gray(`Skipping existing prompt for ${attorney.name}`));
          }
          continue;
        } catch {}
      }

      const lawFirms = [...new Set(attorney.trialAttorneys.map(ta => ta.lawFirm?.name).filter(Boolean))];

      // Replace template variables
      const prompt = templateContent
        .replace(/{{attorneyName}}/g, attorney.name || 'Unknown')
        .replace(/{{lawFirms}}/g, lawFirms.join(', ') || 'Unknown')
        .replace(/{{barNumber}}/g, attorney.barNumber || 'Not provided');

      await fs.writeFile(promptPath, prompt);
      promptsGenerated++;
      console.log(chalk.green(`Generated prompt for ${attorney.name}`));
    }

    console.log(chalk.cyan(`\nPrompts generated: ${promptsGenerated}, Prompts skipped: ${promptsSkipped}`));
  }

  public async generateTrialPrompts() {
    const outputDir = path.join(this.config.output.baseDir, this.config.output.trialDir);
    await this.ensureDirectoryExists(outputDir);

    const trials = await prisma.trial.findMany({
      include: {
        sessions: {
          orderBy: {
            sessionDate: 'asc'
          }
        },
        attorneys: {
          include: {
            attorney: true,
            lawFirm: true
          }
        }
      },
      orderBy: {
        id: 'asc'
      }
    });

    console.log(chalk.cyan(`Found ${trials.length} trials`));
    console.log(chalk.cyan(`Using context template: trial-context-${this.contextSuffix}.txt`));

    // Load the trial context template - default to long if suffix doesn't exist
    let templateContent: string;
    const templatePath = path.join(__dirname, `../../templates/trial-context-${this.contextSuffix}.txt`);
    const fallbackPath = path.join(__dirname, '../../templates/trial-context-long.txt');

    try {
      templateContent = await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      try {
        console.warn(chalk.yellow(`Template trial-context-${this.contextSuffix}.txt not found, using trial-context-long.txt`));
        templateContent = await fs.readFile(fallbackPath, 'utf-8');
      } catch (fallbackError) {
        console.error(chalk.red(`Could not load trial template`));
        throw fallbackError;
      }
    }

    let promptsGenerated = 0;
    let promptsSkipped = 0;

    for (const trial of trials) {
      const shortNameHandle = trial.shortNameHandle || generateFileToken(trial.shortName || `trial_${trial.id}`);
      const promptPath = path.join(outputDir, `${shortNameHandle}_summary_prompt.txt`);

      if (!this.config.processing.overwritePrompts) {
        try {
          await fs.access(promptPath);
          promptsSkipped++;
          if (this.config.processing.logSkipped) {
            console.log(chalk.gray(`Skipping existing prompt for ${trial.shortName}`));
          }
          continue;
        } catch {}
      }

      const sessionDates = trial.sessions.map(s => s.sessionDate?.toISOString().split('T')[0]).filter(Boolean);
      const dateRange = sessionDates.length > 0
        ? `${sessionDates[0]} to ${sessionDates[sessionDates.length - 1]}`
        : 'Date information not available';

      const lawFirms = [...new Set(trial.attorneys
        .map(ta => ta.lawFirm?.name)
        .filter(Boolean))];

      // Replace template variables
      const prompt = templateContent
        .replace(/{{caseName}}/g, trial.shortName || trial.name || 'Unknown')
        .replace(/{{plaintiff}}/g, trial.plaintiff || 'Not specified')
        .replace(/{{defendant}}/g, trial.defendant || 'Not specified')
        .replace(/{{caseNumber}}/g, trial.caseNumber || 'Not specified')
        .replace(/{{court}}/g, trial.court || 'Not specified')
        .replace(/{{trialDates}}/g, dateRange)
        .replace(/{{lawFirms}}/g, lawFirms.join(', ') || 'Not specified');

      await fs.writeFile(promptPath, prompt);
      promptsGenerated++;
      console.log(chalk.green(`Generated prompt for ${trial.shortName}`));
    }

    console.log(chalk.cyan(`\nPrompts generated: ${promptsGenerated}, Prompts skipped: ${promptsSkipped}`));
  }

  public async executeAttorneyBatch(batchSize?: number) {
    const size = batchSize || this.config.processing.batchSize;
    const outputDir = path.join(this.config.output.baseDir, this.config.output.attorneyDir);
    await this.ensureDirectoryExists(outputDir);

    const existingResponses = await this.getExistingResponses('attorneys');

    const attorneys = await prisma.attorney.findMany({
      include: {
        trialAttorneys: {
          include: {
            lawFirm: true
          }
        }
      },
      orderBy: {
        id: 'asc'
      }
    });

    // Filter attorneys with law firm associations
    const attorneysWithFirms = attorneys.filter(a =>
      a.trialAttorneys.some(ta => ta.lawFirmId !== null)
    );

    const pending = attorneysWithFirms.filter(a => {
      const fingerprint = a.attorneyFingerprint || `attorney_${a.id}`;
      return !existingResponses.has(fingerprint);
    });

    if (pending.length === 0) {
      console.log(chalk.green('All attorney profiles have been generated!'));
      return;
    }

    console.log(chalk.cyan(`Processing ${Math.min(size, pending.length)} of ${pending.length} pending attorney profiles`));
    console.log(chalk.cyan(`Using LLM profile: ${this.currentProfile}`));

    const batch = pending.slice(0, size);
    const profile = this.config.llmProfiles.profiles[this.currentProfile];

    for (const attorney of batch) {
      const fingerprint = attorney.attorneyFingerprint || `attorney_${attorney.id}`;
      const promptPath = path.join(outputDir, `${fingerprint}_profile_prompt.txt`);
      const responsePath = path.join(outputDir, `${fingerprint}_profile_response.txt`);

      try {
        const prompt = await fs.readFile(promptPath, 'utf-8');

        console.log(chalk.yellow(`Processing ${attorney.name}...`));

        const messages = [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: prompt }
        ];

        const response = await this.llm.invoke(messages);
        const responseText = response.content;

        await fs.writeFile(responsePath, responseText);
        console.log(chalk.green(`✓ Generated profile for ${attorney.name}`));

      } catch (error) {
        console.error(chalk.red(`✗ Failed to process ${attorney.name}: ${error}`));
      }
    }

    const remaining = pending.length - batch.length;
    if (remaining > 0) {
      console.log(chalk.cyan(`\n${remaining} attorney profiles remaining. Run again to continue.`));
    }
  }

  public async executeTrialBatch(batchSize?: number) {
    const size = batchSize || this.config.processing.batchSize;
    const outputDir = path.join(this.config.output.baseDir, this.config.output.trialDir);
    await this.ensureDirectoryExists(outputDir);

    const existingResponses = await this.getExistingResponses('trials');

    const trials = await prisma.trial.findMany({
      orderBy: {
        id: 'asc'
      }
    });

    const pending = [];
    for (const trial of trials) {
      const shortNameHandle = trial.shortNameHandle || generateFileToken(trial.shortName || `trial_${trial.id}`);
      if (!existingResponses.has(shortNameHandle)) {
        pending.push({ ...trial, handle: shortNameHandle });
      }
    }

    if (pending.length === 0) {
      console.log(chalk.green('All trial summaries have been generated!'));
      return;
    }

    console.log(chalk.cyan(`Processing ${Math.min(size, pending.length)} of ${pending.length} pending trial summaries`));
    console.log(chalk.cyan(`Using LLM profile: ${this.currentProfile}`));

    const batch = pending.slice(0, size);
    const profile = this.config.llmProfiles.profiles[this.currentProfile];

    for (const trial of batch) {
      const promptPath = path.join(outputDir, `${trial.handle}_summary_prompt.txt`);
      const responsePath = path.join(outputDir, `${trial.handle}_summary_response.txt`);

      try {
        const prompt = await fs.readFile(promptPath, 'utf-8');

        console.log(chalk.yellow(`Processing ${trial.shortName}...`));

        const messages = [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: prompt }
        ];

        const response = await this.llm.invoke(messages);
        const responseText = response.content;

        await fs.writeFile(responsePath, responseText);
        console.log(chalk.green(`✓ Generated summary for ${trial.shortName}`));

      } catch (error) {
        console.error(chalk.red(`✗ Failed to process ${trial.shortName}: ${error}`));
      }
    }

    const remaining = pending.length - batch.length;
    if (remaining > 0) {
      console.log(chalk.cyan(`\n${remaining} trial summaries remaining. Run again to continue.`));
    }
  }

  public async getStatus(entityType: 'attorneys' | 'trials') {
    const existingResponses = await this.getExistingResponses(entityType);

    if (entityType === 'attorneys') {
      // Count attorneys with law firm associations through TrialAttorney
      const attorneys = await prisma.attorney.findMany({
        include: {
          trialAttorneys: true
        }
      });
      const total = attorneys.filter(a =>
        a.trialAttorneys.some(ta => ta.lawFirmId !== null)
      ).length;
      const completed = existingResponses.size;
      const pending = total - completed;

      console.log(chalk.cyan('\n=== Attorney Profiles Status ==='));
      console.log(`Total attorneys with law firms: ${total}`);
      console.log(`Profiles completed: ${chalk.green(completed)}`);
      console.log(`Profiles pending: ${chalk.yellow(pending)}`);
      console.log(`Progress: ${chalk.cyan(`${Math.round((completed/total) * 100)}%`)}`);
    } else {
      const total = await prisma.trial.count();
      const completed = existingResponses.size;
      const pending = total - completed;

      console.log(chalk.cyan('\n=== Trial Summaries Status ==='));
      console.log(`Total trials: ${total}`);
      console.log(`Summaries completed: ${chalk.green(completed)}`);
      console.log(`Summaries pending: ${chalk.yellow(pending)}`);
      console.log(`Progress: ${chalk.cyan(`${Math.round((completed/total) * 100)}%`)}`);
    }
  }

  public async fullPipeline(entityType: 'attorneys' | 'trials', batchSize?: number) {
    console.log(chalk.cyan(`\nRunning full pipeline for ${entityType}...`));

    if (entityType === 'attorneys') {
      await this.generateAttorneyPrompts();
      await this.executeAttorneyBatch(batchSize);
    } else {
      await this.generateTrialPrompts();
      await this.executeTrialBatch(batchSize);
    }

    await this.getStatus(entityType);
  }

  // Component Summary Methods for Feature 09D
  protected async loadComponentSummaryConfig(): Promise<any> {
    const configPath = path.join(__dirname, '../../config/llm-summaries.json');
    try {
      const configData = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      console.error(chalk.red('Could not load llm-summaries.json config'));
      throw error;
    }
  }

  protected async checkTrialSummaryDependency(trialName: string): Promise<string | null> {
    // Use the same file token generation for consistency
    const trialHandle = generateFileToken(trialName);

    const summaryPath = path.join(
      __dirname,
      '../../output/trialSummaries',
      `${trialHandle}_summary_response.txt`
    );

    try {
      const content = await fs.readFile(summaryPath, 'utf-8');
      return content;
    } catch (error) {
      console.warn(chalk.yellow(`Trial summary not found for ${trialName}`));
      return null;
    }
  }

  public async generateComponentSummaries(
    trialName: string,
    components: string[],
    summaryType: string = 'LLMSummary1'
  ) {
    const config = await this.loadComponentSummaryConfig();
    const summaryConfig = config.summaryTypes[summaryType];

    if (!summaryConfig) {
      throw new Error(`Summary type ${summaryType} not found in configuration`);
    }

    console.log(chalk.cyan(`\n=== Generating ${summaryType} for ${trialName} ===`));

    // Check for trial summary dependency
    const trialSummary = await this.checkTrialSummaryDependency(trialName);
    if (!trialSummary && summaryConfig.components.some((c: any) => c.dependencies?.includes('trialSummary'))) {
      console.error(chalk.red(`Trial summary required but not found for ${trialName}`));
      console.log(chalk.yellow('Please generate trial summary first using: npm run background-llm -- trials --full'));
      return;
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
        continue;
      }

      await this.generateSingleComponentSummary(
        trialName,
        componentConfig,
        trialSummary,
        outputDir,
        summaryConfig.llmProfile
      );
    }

    console.log(chalk.green(`\n✓ Completed ${summaryType} generation for ${trialName}`));
  }

  private async generateSingleComponentSummary(
    trialName: string,
    componentConfig: any,
    trialSummary: string | null,
    outputDir: string,
    llmProfile: string
  ) {
    const outputPath = path.join(outputDir, componentConfig.outputFile);

    // Check if already exists
    if (this.config.processing.skipExisting) {
      try {
        await fs.access(outputPath);
        console.log(chalk.gray(`Skipping existing: ${componentConfig.name}`));
        return;
      } catch {}
    }

    console.log(chalk.yellow(`Processing ${componentConfig.name}...`));

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
    } catch (error) {
      console.error(chalk.red(`Source file not found: ${componentConfig.sourceFile}`));
      return;
    }

    // Load context template
    const templatePath = path.join(
      __dirname,
      '../../templates',
      componentConfig.contextTemplate
    );

    let template: string;
    try {
      template = await fs.readFile(templatePath, 'utf-8');
    } catch (error) {
      console.error(chalk.red(`Template not found: ${componentConfig.contextTemplate}`));
      return;
    }

    // Build prompt with substitutions
    const prompt = template
      .replace(/{{trialSummary}}/g, trialSummary || 'Trial summary not available')
      .replace(/{{sourceText}}/g, sourceText)
      .replace(/{{trialName}}/g, trialName)
      .replace(/{{componentType}}/g, componentConfig.name);

    // Generate summary using LLM
    try {
      const messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: prompt }
      ];

      const response = await this.llm.invoke(messages);
      const responseText = response.content;

      await fs.writeFile(outputPath, responseText);
      console.log(chalk.green(`✓ Generated ${componentConfig.name}`));
    } catch (error) {
      console.error(chalk.red(`✗ Failed to generate ${componentConfig.name}: ${error}`));
    }
  }

  public async batchProcessTrialComponents(
    trialNames: string[],
    summaryType: string = 'LLMSummary1'
  ) {
    console.log(chalk.cyan(`\n=== Batch Processing ${trialNames.length} Trials ===`));

    for (const trialName of trialNames) {
      await this.generateComponentSummaries(trialName, ['all'], summaryType);
    }

    console.log(chalk.green(`\n✓ Batch processing complete for ${trialNames.length} trials`));
  }
}