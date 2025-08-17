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
    return Mustache.render(template, data);
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