import * as Mustache from 'mustache';

export type TemplateType = 'Native' | 'Mustache';

export interface TemplateEngineConfig {
  templateType?: TemplateType;
  nativeStartDelimiter?: string;
  nativeEndDelimiter?: string;
}

export interface TemplateEngine {
  render(template: string, data: any): string;
}

export class NativeTemplateEngine implements TemplateEngine {
  private startDelimiter: string;
  private endDelimiter: string;

  constructor(startDelimiter = '{', endDelimiter = '}') {
    this.startDelimiter = startDelimiter;
    this.endDelimiter = endDelimiter;
  }

  render(template: string, data: any): string {
    let result = template;
    
    const regex = new RegExp(
      `${this.escapeRegExp(this.startDelimiter)}([^${this.escapeRegExp(this.endDelimiter)}]+)${this.escapeRegExp(this.endDelimiter)}`,
      'g'
    );
    
    result = result.replace(regex, (match, path) => {
      const value = this.getNestedValue(data, path.trim());
      return value !== undefined && value !== null ? String(value) : '';
    });
    
    return result;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getNestedValue(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[key];
    }
    
    return current;
  }
}

export class MustacheTemplateEngine implements TemplateEngine {
  render(template: string, data: any): string {
    // Convert variable interpolations to triple braces to disable HTML escaping
    // But keep section tags ({{#...}} {{/...}} {{^...}}) as double braces
    let unescapedTemplate = template;
    
    // First, temporarily replace existing triple braces to protect them
    unescapedTemplate = unescapedTemplate.replace(/\{\{\{/g, '<<<TRIPLE_OPEN>>>');
    unescapedTemplate = unescapedTemplate.replace(/\}\}\}/g, '<<<TRIPLE_CLOSE>>>');
    
    // Now convert double braces to triple braces, but NOT for section tags
    // Section tags start with #, /, or ^
    unescapedTemplate = unescapedTemplate.replace(/\{\{([^#/^][^}]*)\}\}/g, '{{{$1}}}');
    
    // Restore any original triple braces
    unescapedTemplate = unescapedTemplate.replace(/<<<TRIPLE_OPEN>>>/g, '{{{');
    unescapedTemplate = unescapedTemplate.replace(/<<<TRIPLE_CLOSE>>>/g, '}}}');
    
    return Mustache.render(unescapedTemplate, data);
  }
}

export class TemplateEngineFactory {
  static create(config?: TemplateEngineConfig): TemplateEngine {
    const templateType = config?.templateType || 'Native';
    
    if (templateType === 'Mustache') {
      return new MustacheTemplateEngine();
    } else {
      return new NativeTemplateEngine(
        config?.nativeStartDelimiter,
        config?.nativeEndDelimiter
      );
    }
  }
}