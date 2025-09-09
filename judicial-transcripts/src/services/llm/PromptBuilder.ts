import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { format } from 'date-fns';
import { OverrideData } from '../override/types';
import logger from '../../utils/logger';

export interface LLMPrompt {
  system: string;
  user: string;
  examples?: any[];
  metadata?: {
    trialId?: number;
    trialName?: string;
    timestamp: string;
    promptVersion?: string;
  };
}

export interface DatabaseContext {
  trial?: any;
  attorneys?: any[];
  judges?: any[];
  courtReporters?: any[];
  lawFirms?: any[];
  existingOverrides?: OverrideData;
  statistics?: {
    totalAttorneys: number;
    totalSessions: number;
    totalPages: number;
  };
}

export interface ContextOptions {
  includeExistingData?: boolean;
  includeRelatedEntities?: boolean;
  includeStatistics?: boolean;
  limitResults?: number;
}

export interface PromptTemplate {
  name: string;
  version: string;
  systemTemplate: string;
  userTemplate: string;
  examples?: any[];
}

export class PromptBuilder {
  private prisma: PrismaClient;
  private config: any;
  private templates: Map<string, PromptTemplate>;

  constructor(prisma: PrismaClient, config?: any) {
    this.prisma = prisma;
    this.config = config || this.loadSystemConfig();
    this.templates = new Map();
    this.loadTemplates();
  }

  private loadSystemConfig(): any {
    const configPath = path.join(process.cwd(), 'config', 'system-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    return {};
  }

  private loadTemplates(): void {
    const templatesDir = path.join(process.cwd(), 'docs', 'feature-assets', 'feature-03H', 'prompts', 'templates');
    if (!fs.existsSync(templatesDir)) {
      logger.warn(`Templates directory not found: ${templatesDir}`);
      return;
    }

    const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.json'));
    for (const file of templateFiles) {
      try {
        const template = JSON.parse(fs.readFileSync(path.join(templatesDir, file), 'utf-8'));
        this.templates.set(template.name, template);
      } catch (error) {
        logger.error(`Failed to load template ${file}:`, error);
      }
    }
  }

  async generateContextFromDatabase(
    trialId: number,
    options: ContextOptions = {}
  ): Promise<DatabaseContext> {
    const context: DatabaseContext = {};

    // Fetch trial data
    const trial = await this.prisma.trial.findUnique({
      where: { id: trialId },
      include: {
        judge: true,
        courtReporter: true,
        sessions: options.limitResults ? { take: options.limitResults } : undefined
      }
    });

    if (!trial) {
      throw new Error(`Trial ${trialId} not found`);
    }

    context.trial = trial;

    // Fetch attorneys if requested
    if (options.includeRelatedEntities) {
      const trialAttorneys = await this.prisma.trialAttorney.findMany({
        where: { trialId },
        include: {
          attorney: true,
          lawFirm: true,
          lawFirmOffice: {
            include: { address: true }
          }
        }
      });

      context.attorneys = trialAttorneys.map(ta => ({
        ...ta.attorney,
        role: ta.role,
        lawFirm: ta.lawFirm,
        lawFirmOffice: ta.lawFirmOffice
      }));

      // Get unique law firms
      const lawFirmIds = [...new Set(trialAttorneys.map(ta => ta.lawFirmId).filter(Boolean))];
      context.lawFirms = await this.prisma.lawFirm.findMany({
        where: { id: { in: lawFirmIds as number[] } }
      });
    }

    // Add statistics if requested
    if (options.includeStatistics) {
      const [attorneyCount, sessionCount] = await Promise.all([
        this.prisma.trialAttorney.count({ where: { trialId } }),
        this.prisma.session.count({ where: { trialId } })
      ]);

      context.statistics = {
        totalAttorneys: attorneyCount,
        totalSessions: sessionCount,
        totalPages: trial.totalPages || 0
      };
    }

    // Include existing override data if available
    if (options.includeExistingData) {
      context.existingOverrides = await this.loadExistingOverrides(trialId);
    }

    return context;
  }

  private async loadExistingOverrides(trialId: number): Promise<OverrideData | undefined> {
    // Check for existing override files for this trial
    const overrideDir = path.join(this.config.llm?.output?.overrides || 'output/llm/overrides');
    const trialOverrideFile = path.join(overrideDir, `trial-${trialId}-overrides.json`);
    
    if (fs.existsSync(trialOverrideFile)) {
      try {
        return JSON.parse(fs.readFileSync(trialOverrideFile, 'utf-8'));
      } catch (error) {
        logger.warn(`Failed to load existing overrides for trial ${trialId}:`, error);
      }
    }
    
    return undefined;
  }

  buildPromptFromTemplate(
    templateName: string,
    context: DatabaseContext
  ): LLMPrompt {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template ${templateName} not found`);
    }

    // Replace template variables with context data
    const systemPrompt = this.interpolateTemplate(template.systemTemplate, context);
    const userPrompt = this.interpolateTemplate(template.userTemplate, context);

    return {
      system: systemPrompt,
      user: userPrompt,
      examples: template.examples,
      metadata: {
        trialId: context.trial?.id,
        trialName: context.trial?.name,
        timestamp: new Date().toISOString(),
        promptVersion: template.version
      }
    };
  }

  private interpolateTemplate(template: string, context: DatabaseContext): string {
    let result = template;
    
    // Replace {{variable}} patterns with context data
    result = result.replace(/\{\{trial\.(\w+)\}\}/g, (match, prop) => {
      return context.trial?.[prop] || match;
    });

    result = result.replace(/\{\{statistics\.(\w+)\}\}/g, (match, prop) => {
      return (context.statistics as any)?.[prop]?.toString() || match;
    });

    // Special handling for arrays
    if (context.attorneys && result.includes('{{attorneys}}')) {
      const attorneyList = context.attorneys
        .map(a => `- ${a.name} (${a.role}) - ${a.lawFirm?.name || 'No firm'}`)
        .join('\n');
      result = result.replace('{{attorneys}}', attorneyList);
    }

    return result;
  }

  buildRefinementPrompt(
    existingData: OverrideData,
    corrections: any
  ): LLMPrompt {
    const systemPrompt = `You are a legal data refinement specialist. You will be given existing entity data and specific corrections to apply.

Your task is to:
1. Apply the provided corrections to the existing data
2. Ensure all relationships remain valid
3. Maintain data consistency
4. Generate updated override JSON

Rules:
- Preserve all IDs for relationship mapping
- Only modify fields mentioned in corrections
- Validate attorney-law firm relationships
- Ensure role assignments are correct (PLAINTIFF/DEFENDANT)`;

    const userPrompt = `Existing data:
${JSON.stringify(existingData, null, 2)}

Corrections to apply:
${JSON.stringify(corrections, null, 2)}

Generate the updated override JSON:`;

    return {
      system: systemPrompt,
      user: userPrompt,
      metadata: {
        timestamp: new Date().toISOString(),
        promptVersion: 'refinement-v1'
      }
    };
  }

  async savePromptAndContext(
    prompt: LLMPrompt,
    context: DatabaseContext,
    outputDir?: string
  ): Promise<{ promptPath: string; contextPath: string }> {
    const baseDir = outputDir || this.config.llm?.output?.baseDir || 'output/llm';
    const timestamp = format(new Date(), 'yyyy-MM-dd-HHmmss');
    const trialId = context.trial?.id || 'unknown';
    
    // Create directories if they don't exist
    const promptsDir = path.join(baseDir, 'prompts');
    const contextsDir = path.join(baseDir, 'contexts');
    
    [promptsDir, contextsDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Save prompt
    const promptFile = path.join(promptsDir, `${timestamp}-trial-${trialId}-prompt.json`);
    fs.writeFileSync(promptFile, JSON.stringify(prompt, null, 2));

    // Save context
    const contextFile = path.join(contextsDir, `${timestamp}-trial-${trialId}-context.json`);
    fs.writeFileSync(contextFile, JSON.stringify(context, null, 2));

    // Also save a markdown version of the prompt for easier reading
    const promptMd = path.join(promptsDir, `${timestamp}-trial-${trialId}-prompt.md`);
    const mdContent = `# LLM Prompt for Trial ${trialId}

## Metadata
- Trial: ${context.trial?.name || 'Unknown'}
- Timestamp: ${prompt.metadata?.timestamp}
- Version: ${prompt.metadata?.promptVersion || 'N/A'}

## System Prompt
${prompt.system}

## User Prompt
${prompt.user}

## Examples
${prompt.examples ? JSON.stringify(prompt.examples, null, 2) : 'None provided'}
`;
    fs.writeFileSync(promptMd, mdContent);

    return {
      promptPath: promptFile,
      contextPath: contextFile
    };
  }

  mergeContexts(contexts: DatabaseContext[]): DatabaseContext {
    const merged: DatabaseContext = {
      attorneys: [],
      judges: [],
      courtReporters: [],
      lawFirms: [],
      statistics: {
        totalAttorneys: 0,
        totalSessions: 0,
        totalPages: 0
      }
    };

    for (const context of contexts) {
      if (context.attorneys) {
        merged.attorneys!.push(...context.attorneys);
      }
      if (context.judges) {
        merged.judges!.push(...context.judges);
      }
      if (context.courtReporters) {
        merged.courtReporters!.push(...context.courtReporters);
      }
      if (context.lawFirms) {
        merged.lawFirms!.push(...context.lawFirms);
      }
      if (context.statistics) {
        merged.statistics!.totalAttorneys += context.statistics.totalAttorneys;
        merged.statistics!.totalSessions += context.statistics.totalSessions;
        merged.statistics!.totalPages += context.statistics.totalPages;
      }
    }

    // Remove duplicates based on ID
    merged.attorneys = this.deduplicateById(merged.attorneys!);
    merged.lawFirms = this.deduplicateById(merged.lawFirms!);

    return merged;
  }

  private deduplicateById(items: any[]): any[] {
    const seen = new Set();
    return items.filter(item => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    });
  }
}