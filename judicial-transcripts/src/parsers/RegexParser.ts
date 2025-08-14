import { IParser, ParseResult, ParserConfig } from './interfaces/IParser';

export class RegexParser implements IParser {
  name: string;
  type: 'REGEX' = 'REGEX';
  private patterns: Array<{
    regex: RegExp;
    value?: string;
    captures?: Record<string, string>;
  }> = [];

  constructor(config: ParserConfig) {
    this.name = config.name;
    
    if (config.patterns && Array.isArray(config.patterns)) {
      // Multiple patterns with individual configurations
      this.patterns = config.patterns.map(p => ({
        regex: new RegExp(p.pattern, p.flags || ''),
        value: p.value,
        captures: p.captures || config.captures
      }));
    } else if (Array.isArray(config.pattern)) {
      // Array of patterns with shared configuration
      this.patterns = config.pattern.map(p => ({
        regex: new RegExp(p, config.flags || ''),
        captures: config.captures
      }));
    } else if (config.pattern) {
      // Single pattern
      this.patterns = [{
        regex: new RegExp(config.pattern, config.flags || ''),
        captures: config.captures
      }];
    } else {
      throw new Error(`RegexParser ${config.name}: No pattern provided`);
    }
  }

  parse(text: string): ParseResult {
    for (const { regex, value, captures } of this.patterns) {
      const match = text.match(regex);
      if (match) {
        const result: ParseResult = {
          matched: true,
          value: value || match[0],
          position: {
            start: match.index || 0,
            end: (match.index || 0) + match[0].length
          }
        };

        // Map capture groups based on configuration
        if (captures && match.length > 1) {
          result.captures = {};
          for (const [groupNum, captureName] of Object.entries(captures)) {
            const index = parseInt(groupNum);
            if (match[index]) {
              result.captures[captureName] = match[index];
            }
          }
        }

        return result;
      }
    }

    return { matched: false };
  }

  parseAll(text: string): ParseResult[] {
    const results: ParseResult[] = [];
    
    for (const { regex, value, captures } of this.patterns) {
      // Create a new regex with global flag for finding all matches
      const globalRegex = new RegExp(regex.source, regex.flags + (regex.flags.includes('g') ? '' : 'g'));
      let match;
      
      while ((match = globalRegex.exec(text)) !== null) {
        const result: ParseResult = {
          matched: true,
          value: value || match[0],
          position: {
            start: match.index,
            end: match.index + match[0].length
          }
        };

        // Map capture groups
        if (captures && match.length > 1) {
          result.captures = {};
          for (const [groupNum, captureName] of Object.entries(captures)) {
            const index = parseInt(groupNum);
            if (match[index]) {
              result.captures[captureName] = match[index];
            }
          }
        }

        results.push(result);
      }
    }

    return results;
  }
}