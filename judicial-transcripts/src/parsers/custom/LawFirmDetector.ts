import { IParser, ParseResult, ParserConfig } from '../interfaces/IParser';

export class LawFirmDetector implements IParser {
  name: string;
  type: 'CUSTOM' = 'CUSTOM';
  private indicators: string[];

  constructor(config: ParserConfig) {
    this.name = config.name;
    this.indicators = config.indicators || [
      'LLP', 'L.L.P.',
      'LLLP', 'L.L.L.P.',
      'LLC', 'L.L.C.',
      'PLLC', 'P.L.L.C.',
      'PLLP', 'P.L.L.P.',
      'PC', 'P.C.',
      'PA', 'P.A.',
      'LAW FIRM',
      'LAW OFFICE',
      'LAW GROUP',
      'LEGAL',
      'ATTORNEYS',
      'ASSOCIATES',
      'PARTNERS',
      '& ASSOCIATES',
      'COUNSEL'
    ];
  }

  parse(text: string): ParseResult {
    const upperText = text.toUpperCase();
    
    // Check if the line contains any law firm indicators
    for (const indicator of this.indicators) {
      const index = upperText.indexOf(indicator.toUpperCase());
      if (index !== -1) {
        // Additional checks to avoid false positives
        if (this.isLikelyLawFirm(text, indicator)) {
          return {
            matched: true,
            value: text.trim(),
            captures: {
              firmName: text.trim(),
              indicator: indicator
            },
            position: {
              start: 0,
              end: text.length
            }
          };
        }
      }
    }

    return { matched: false };
  }

  parseAll(text: string): ParseResult[] {
    // Split into lines and check each line
    const lines = text.split('\n');
    const results: ParseResult[] = [];
    let currentPosition = 0;

    for (const line of lines) {
      const result = this.parse(line);
      if (result.matched && result.position) {
        // Adjust position relative to full text
        result.position.start += currentPosition;
        result.position.end += currentPosition;
        results.push(result);
      }
      currentPosition += line.length + 1; // +1 for newline
    }

    return results;
  }

  private isLikelyLawFirm(text: string, indicator: string): boolean {
    // Don't match if it's clearly an attorney name with title
    if (/^(MR\.|MS\.|MRS\.|DR\.)\s+/i.test(text)) {
      return false;
    }

    // Special handling for common patterns
    const upperText = text.toUpperCase();
    
    // Check for standalone firm indicators at word boundaries
    const indicatorUpper = indicator.toUpperCase();
    const indicatorIndex = upperText.indexOf(indicatorUpper);
    
    if (indicatorIndex === -1) {
      return false;
    }

    // For abbreviations like LLP, LLC, etc., check they're at word boundaries
    if (indicator.includes('.')) {
      // Period-separated abbreviations should be at the end or followed by punctuation/space
      const afterIndicator = upperText.substring(indicatorIndex + indicator.length);
      if (afterIndicator && !/^[\s,;.]/.test(afterIndicator)) {
        return false;
      }
    } else if (/^[A-Z]+$/.test(indicator)) {
      // All-caps abbreviations should be preceded and followed by word boundaries
      const beforeChar = indicatorIndex > 0 ? upperText[indicatorIndex - 1] : ' ';
      const afterChar = indicatorIndex + indicator.length < upperText.length ? 
                       upperText[indicatorIndex + indicator.length] : ' ';
      
      if (!/[\s,;.]/.test(beforeChar) || (!/[\s,;.]/.test(afterChar) && afterChar !== '')) {
        return false;
      }
    }

    // Additional validation: firm names typically don't start with common first names alone
    const commonFirstNames = ['JOHN', 'JANE', 'ROBERT', 'MARY', 'JAMES', 'PATRICIA'];
    const firstWord = text.split(/\s+/)[0].toUpperCase();
    if (commonFirstNames.includes(firstWord) && !text.includes('&')) {
      return false;
    }

    return true;
  }
}