import { IParser, ParseResult, ParserConfig } from '../../../src/parsers/interfaces/IParser';

/**
 * Example custom parser implementation
 * Demonstrates how to create a parser that implements the IParser interface
 */
export class ExampleCustomParser implements IParser {
  name: string;
  type: 'CUSTOM' = 'CUSTOM';
  private config: ParserConfig;

  constructor(config: ParserConfig) {
    this.name = config.name;
    this.config = config;
  }

  /**
   * Parse text for a single match
   */
  parse(text: string): ParseResult {
    // Example: Parse exhibit references like "Plaintiff's Exhibit 123"
    const pattern = /(Plaintiff's|Defendant's)\s+Exhibit\s+(\d+)/i;
    const match = text.match(pattern);

    if (match) {
      return {
        matched: true,
        value: match[0],
        captures: {
          party: match[1],
          exhibitNumber: match[2]
        },
        position: {
          start: match.index || 0,
          end: (match.index || 0) + match[0].length
        }
      };
    }

    return {
      matched: false
    };
  }

  /**
   * Parse text for all matches
   */
  parseAll(text: string): ParseResult[] {
    const results: ParseResult[] = [];
    const pattern = /(Plaintiff's|Defendant's)\s+Exhibit\s+(\d+)/gi;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      results.push({
        matched: true,
        value: match[0],
        captures: {
          party: match[1],
          exhibitNumber: match[2]
        },
        position: {
          start: match.index,
          end: match.index + match[0].length
        }
      });
    }

    return results;
  }
}