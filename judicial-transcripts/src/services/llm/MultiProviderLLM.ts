import { ChatOpenAI } from 'langchain/chat_models/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from 'langchain/chat_models/base';
import * as fs from 'fs';
import * as path from 'path';

export type LLMProvider = 'openai' | 'anthropic' | 'google';

export interface LLMConfig {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
}

export interface ModelConfig {
  maxTokens: number;
  temperature: number;
  contextWindow: number;
}

export class MultiProviderLLM {
  private config: any;
  private provider: LLMProvider;
  private model: string;
  private llm?: BaseChatModel;

  constructor(config?: LLMConfig) {
    // Load system configuration
    this.config = this.loadSystemConfig();
    
    // Determine provider and model
    this.provider = config?.provider || 
                   process.env.LLM_PROVIDER as LLMProvider || 
                   this.config.llm?.defaultProvider || 
                   'openai';
    
    this.model = config?.model || 
                process.env.LLM_MODEL || 
                this.getDefaultModelForProvider(this.provider);

    // Get API key for provider
    const apiKey = config?.apiKey || this.getApiKeyForProvider(this.provider);

    // Initialize the appropriate LLM
    if (apiKey) {
      this.llm = this.createLLM(this.provider, this.model, apiKey, config);
    }
  }

  private loadSystemConfig(): any {
    const configPath = path.join(process.cwd(), 'config', 'system-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    return {};
  }

  private getDefaultModelForProvider(provider: LLMProvider): string {
    const defaults = {
      openai: 'gpt-4-turbo-preview',  // Using gpt-4-turbo for 128k context window
      anthropic: 'claude-3-sonnet-20240229',
      google: 'gemini-pro'
    };
    return defaults[provider] || 'gpt-4-turbo-preview';
  }

  private getApiKeyForProvider(provider: LLMProvider): string | undefined {
    const envKeys = {
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_API_KEY'
    };
    
    return process.env[envKeys[provider]];
  }

  private getModelConfig(provider: LLMProvider, model: string): ModelConfig {
    const providerConfig = this.config.llm?.providers?.[provider];
    const modelConfig = providerConfig?.models?.[model];
    
    if (modelConfig) {
      return modelConfig;
    }

    // Default configurations - adjusted for model capabilities
    if (model.includes('gpt-4-turbo') || model.includes('gpt-4-1106')) {
      return {
        maxTokens: 4000,
        temperature: 0.1,
        contextWindow: 128000  // 128k context for gpt-4-turbo
      };
    } else if (model.includes('gpt-3.5-turbo-16k')) {
      return {
        maxTokens: 4000,
        temperature: 0.1,
        contextWindow: 16384  // 16k context
      };
    }
    
    // Default for standard models
    return {
      maxTokens: 4000,
      temperature: 0.1,
      contextWindow: 8192
    };
  }

  private createLLM(
    provider: LLMProvider,
    model: string,
    apiKey: string,
    customConfig?: LLMConfig
  ): BaseChatModel {
    const modelConfig = this.getModelConfig(provider, model);
    const temperature = customConfig?.temperature ?? modelConfig.temperature;
    const maxTokens = customConfig?.maxTokens ?? modelConfig.maxTokens;

    switch (provider) {
      case 'openai':
        return new ChatOpenAI({
          openAIApiKey: apiKey,
          modelName: model,
          temperature,
          maxTokens
        }) as any;

      case 'anthropic':
        return new ChatAnthropic({
          anthropicApiKey: apiKey,
          modelName: model,
          temperature,
          maxTokens
        }) as any;

      case 'google':
        return new ChatGoogleGenerativeAI({
          apiKey,
          model,
          temperature,
          maxOutputTokens: maxTokens
        }) as any;

      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  public getLLM(): BaseChatModel | undefined {
    return this.llm;
  }

  public getProvider(): LLMProvider {
    return this.provider;
  }

  public getModel(): string {
    return this.model;
  }

  public getConfig(): ModelConfig {
    return this.getModelConfig(this.provider, this.model);
  }

  public isAvailable(): boolean {
    return this.llm !== undefined;
  }

  public getInfo(): { provider: LLMProvider; model: string; available: boolean } {
    return {
      provider: this.provider,
      model: this.model,
      available: this.isAvailable()
    };
  }

  /**
   * Switch to a different provider/model combination
   */
  public switchModel(provider: LLMProvider, model: string, apiKey?: string): void {
    const key = apiKey || this.getApiKeyForProvider(provider);
    
    if (!key) {
      throw new Error(`No API key found for provider: ${provider}`);
    }

    this.provider = provider;
    this.model = model;
    this.llm = this.createLLM(provider, model, key);
  }

  /**
   * Get available models for a provider
   */
  public getAvailableModels(provider?: LLMProvider): string[] {
    const targetProvider = provider || this.provider;
    const providerConfig = this.config.llm?.providers?.[targetProvider];
    
    if (providerConfig?.models) {
      return Object.keys(providerConfig.models);
    }

    // Fallback to known models
    const fallbackModels = {
      openai: ['gpt-4', 'gpt-4-turbo-preview', 'gpt-4-1106-preview', 'gpt-3.5-turbo', 'gpt-3.5-turbo-16k'],
      anthropic: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
      google: ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash']
    };

    return fallbackModels[targetProvider] || [];
  }

  /**
   * Check if a specific provider is configured
   */
  public isProviderConfigured(provider: LLMProvider): boolean {
    const apiKey = this.getApiKeyForProvider(provider);
    return apiKey !== undefined && apiKey !== '';
  }

  /**
   * Get all configured providers
   */
  public getConfiguredProviders(): LLMProvider[] {
    const providers: LLMProvider[] = ['openai', 'anthropic', 'google'];
    return providers.filter(p => this.isProviderConfigured(p));
  }
}