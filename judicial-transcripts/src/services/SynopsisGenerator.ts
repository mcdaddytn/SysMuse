// src/services/SynopsisGenerator.ts
import { Anthropic } from '@anthropic-ai/sdk';
import logger from '../utils/logger';

export class SynopsisGenerator {
  private anthropic: Anthropic;
  
  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY || ''
    });
  }
  
  async generate(
    text: string,
    sectionName: string,
    options?: {
      maxLength?: number;
      context?: string;
      model?: string;
    }
  ): Promise<string> {
    try {
      const maxLength = options?.maxLength || 500;
      const context = options?.context || '';
      const model = options?.model || 'claude-3-opus-20240229';
      
      const prompt = `
Please create a concise synopsis of the following trial transcript section.
Section: ${sectionName}
${context ? `Context: ${context}` : ''}
Maximum length: ${maxLength} words

Transcript:
${text}

Synopsis:`;
      
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: Math.min(maxLength * 2, 4000),
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });
      
      const synopsis = response.content[0].type === 'text' 
        ? response.content[0].text 
        : '[Synopsis generation failed]';
      
      logger.info(`Generated synopsis for section: ${sectionName}`);
      return synopsis;
      
    } catch (error) {
      logger.error('Error generating synopsis:', error);
      return `[Error generating synopsis for ${sectionName}]`;
    }
  }
  
  async generateBatch(
    sections: Array<{
      text: string;
      name: string;
    }>,
    options?: any
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    
    for (const section of sections) {
      const synopsis = await this.generate(
        section.text,
        section.name,
        options
      );
      results.set(section.name, synopsis);
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return results;
  }
}