export interface ParseResult {
  matched: boolean;
  value?: string;
  captures?: Record<string, string>;
  position?: {
    start: number;
    end: number;
  };
}

export interface IParser {
  name: string;
  type: 'REGEX' | 'CUSTOM';
  parse(text: string): ParseResult;
  parseAll(text: string): ParseResult[];
}

export interface ParserConfig {
  name: string;
  type: 'REGEX' | 'CUSTOM';
  pattern?: string | string[];
  patterns?: Array<{
    pattern: string;
    flags?: string;
    value?: string;
    captures?: Record<string, string>;
  }>;
  flags?: string;
  captures?: Record<string, string>;
  implementation?: string;
  indicators?: string[];
  [key: string]: any;
}