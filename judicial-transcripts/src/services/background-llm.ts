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
  systemPrompt: string;
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
  private config: BackgroundLLMConfig;
  private currentProfile: string;
  private llm: any;

  constructor(configPath?: string, profileOverride?: string) {
    this.config = this.loadConfig(configPath);
    this.currentProfile = profileOverride || this.config.llmProfiles.default;
    this.initializeLLM();
  }

  private loadConfig(configPath?: string): BackgroundLLMConfig {
    const defaultConfig: BackgroundLLMConfig = {
      llmProfiles: {
        default: 'chatgpt',
        profiles: {
          'chatgpt': {
            provider: 'openai',
            model: 'gpt-4',
            apiKeyEnv: 'OPENAI_API_KEY',
            maxTokens: 2000,
            temperature: 0.3,
            systemPrompt: 'You are an expert legal analyst specializing in IP litigation.'
          },
          'chatgpt-turbo': {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            apiKeyEnv: 'OPENAI_API_KEY',
            maxTokens: 1500,
            temperature: 0.3,
            systemPrompt: 'You are an expert legal analyst specializing in IP litigation.'
          },
          'claude': {
            provider: 'anthropic',
            model: 'claude-3-opus-20240229',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
            maxTokens: 2000,
            temperature: 0.3,
            systemPrompt: 'You are an expert legal analyst specializing in IP litigation.'
          },
          'claude-sonnet': {
            provider: 'anthropic',
            model: 'claude-3-sonnet-20240229',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
            maxTokens: 1500,
            temperature: 0.3,
            systemPrompt: 'You are an expert legal analyst specializing in IP litigation.'
          },
          'gemini': {
            provider: 'google',
            model: 'gemini-pro',
            apiKeyEnv: 'GOOGLE_API_KEY',
            maxTokens: 2000,
            temperature: 0.3,
            systemPrompt: 'You are an expert legal analyst specializing in IP litigation.'
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

    if (configPath) {
      try {
        const customConfig = require(path.resolve(configPath));
        return { ...defaultConfig, ...customConfig };
      } catch (error) {
        console.warn(chalk.yellow(`Could not load config from ${configPath}, using defaults`));
      }
    }

    return defaultConfig;
  }

  private initializeLLM() {
    const profile = this.config.llmProfiles.profiles[this.currentProfile];
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

  private async ensureDirectoryExists(dirPath: string) {
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

      const trialNames = [...new Set(attorney.trialAttorneys.map(ta => ta.trial?.shortName).filter(Boolean))];
      const lawFirms = [...new Set(attorney.trialAttorneys.map(ta => ta.lawFirm?.name).filter(Boolean))];

      const prompt = `Please provide a comprehensive one-page professional summary for the following attorney:

Name: ${attorney.name}
Law Firm(s): ${lawFirms.join(', ') || 'Unknown'}
Bar Number: ${attorney.barNumber || 'Not provided'}
Trials Involved: ${trialNames.join(', ') || 'No trial data available'}

Please focus on:
1. Professional background and education
2. Specialization in intellectual property (IP) litigation
3. Notable cases and achievements in IP law
4. Any significant verdicts or settlements
5. Professional recognitions or awards
6. Years of experience and career progression
7. Any published articles or speaking engagements related to IP law

If limited information is publicly available, please indicate that and provide what context you can about the law firm and typical career paths for IP litigation attorneys.

Note: Please keep the response to approximately one page (500-700 words).`;

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

      const prompt = `Please provide a comprehensive summary of the following intellectual property litigation case:

Case Name: ${trial.shortName || trial.name || 'Unknown'}
Court: ${trial.court || 'Not specified'}
Date Range: ${dateRange}
Plaintiff: ${trial.plaintiff || 'Not specified'}
Defendant: ${trial.defendant || 'Not specified'}
Law Firms Involved: ${lawFirms.join(', ') || 'Not specified'}

Please provide information on:
1. Overview of the case and the intellectual property disputes involved
2. Key patents, trademarks, or other IP at issue
3. Main legal arguments from both sides
4. Verdict and damages awarded (if applicable)
5. Notable performances by attorneys or key moments in the trial
6. Any precedential value or impact on future IP litigation
7. Post-trial motions or appeals (if known)
8. Industry impact or significance of the case

If this is a well-known case, please include any public reception or media coverage. If information is limited, please provide what context you can about similar cases or the typical progression of such IP disputes.

Note: Please keep the response to approximately one page (500-700 words).`;

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
          { role: 'system', content: profile.systemPrompt },
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
          { role: 'system', content: profile.systemPrompt },
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
}