/**
 * Feature 03C: Case Number Extraction Utility
 * 
 * Extracts case numbers from page headers to uniquely identify trials
 * Case numbers are the most reliable way to distinguish between different trials
 */

import { logger } from './logger';

export interface CaseNumberInfo {
  caseNumber: string;
  format: string;
  confidence: number;
}

export class CaseNumberExtractor {
  /**
   * Common case number patterns in federal courts
   * Format: [Division]:[Year]-[Type]-[Number]-[Judge]
   * Examples:
   * - 2:19-CV-00123-JRG
   * - 2:14-CV-00033-JRG
   * - 6:20-CV-00459-ADA
   */
  private readonly patterns = {
    federal: {
      // Standard federal format with division, year, type, number, and judge
      regex: /\b(\d{1,2}:\d{2}-[A-Za-z]{2,4}-\d{5,6}-[A-Z]{2,4})\b/i,
      format: 'FEDERAL_STANDARD',
      confidence: 0.95
    },
    federalNoJudge: {
      // Federal format without judge designation
      regex: /\b(\d{1,2}:\d{2}-[A-Za-z]{2,4}-\d{5,6})\b/i,
      format: 'FEDERAL_NO_JUDGE',
      confidence: 0.90
    },
    federalAlternate: {
      // Alternative federal format (sometimes year is 4 digits)
      regex: /\b(\d{1,2}:\d{4}-[A-Za-z]{2,4}-\d{5,6}(?:-[A-Z]{2,4})?)\b/i,
      format: 'FEDERAL_ALTERNATE',
      confidence: 0.85
    },
    civilAction: {
      // Civil Action format
      regex: /Civil Action No\.\s*([A-Z0-9:.-]+)/i,
      format: 'CIVIL_ACTION',
      confidence: 0.90
    },
    caseNo: {
      // Generic Case No. format
      regex: /Case No\.\s*([A-Z0-9:.-]+)/i,
      format: 'CASE_NO',
      confidence: 0.85
    },
    causeNo: {
      // Cause Number format (used in some jurisdictions)
      regex: /Cause No\.\s*([A-Z0-9:.-]+)/i,
      format: 'CAUSE_NO',
      confidence: 0.85
    }
  };

  /**
   * Extract case number from page header text
   */
  extractFromPageHeader(headerText: string): CaseNumberInfo | null {
    // Try each pattern in order of confidence
    for (const [key, pattern] of Object.entries(this.patterns)) {
      const match = headerText.match(pattern.regex);
      if (match) {
        const caseNumber = this.normalizeCaseNumber(match[1]);
        
        logger.debug(`Extracted case number: ${caseNumber} using pattern: ${pattern.format}`);
        
        return {
          caseNumber,
          format: pattern.format,
          confidence: pattern.confidence
        };
      }
    }

    // If no pattern matches, log for debugging
    if (this.looksLikeCaseNumber(headerText)) {
      logger.warn(`Potential case number in header but no pattern matched: ${headerText.substring(0, 200)}`);
    }

    return null;
  }

  /**
   * Extract from multiple lines (e.g., first few lines of a page)
   */
  extractFromLines(lines: string[]): CaseNumberInfo | null {
    // Check first 5 lines for case number
    const linesToCheck = lines.slice(0, 5);
    
    for (const line of linesToCheck) {
      const result = this.extractFromPageHeader(line);
      if (result) {
        return result;
      }
    }

    // Try concatenating first few lines (sometimes case number spans lines)
    const combined = linesToCheck.join(' ');
    return this.extractFromPageHeader(combined);
  }

  /**
   * Extract from transcript file content
   */
  extractFromTranscript(content: string): CaseNumberInfo | null {
    // Get first 1000 characters (should contain header)
    const headerSection = content.substring(0, 1000);
    
    // Try direct extraction
    let result = this.extractFromPageHeader(headerSection);
    if (result) {
      return result;
    }

    // Try line by line
    const lines = headerSection.split('\n');
    result = this.extractFromLines(lines);
    if (result) {
      return result;
    }

    // Last resort: look for case number anywhere in first page
    const firstPage = content.substring(0, 3000);
    return this.extractFromPageHeader(firstPage);
  }

  /**
   * Normalize case number format
   */
  private normalizeCaseNumber(caseNumber: string): string {
    return caseNumber
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')  // Remove spaces
      .replace(/['"]/g, ''); // Remove quotes
  }

  /**
   * Check if text might contain a case number
   */
  private looksLikeCaseNumber(text: string): boolean {
    const indicators = [
      'case no',
      'civil action',
      'cause no',
      ':\\d{2}-',  // Colon followed by year
      '-cv-',      // Civil case indicator
      '-cr-'       // Criminal case indicator
    ];

    const lowerText = text.toLowerCase();
    return indicators.some(indicator => lowerText.includes(indicator));
  }

  /**
   * Validate case number format
   */
  isValidCaseNumber(caseNumber: string): boolean {
    // Check against all patterns
    for (const pattern of Object.values(this.patterns)) {
      if (pattern.regex.test(caseNumber)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Compare two case numbers (accounting for variations)
   */
  areSameCaseNumber(case1: string, case2: string): boolean {
    const normalized1 = this.normalizeCaseNumber(case1);
    const normalized2 = this.normalizeCaseNumber(case2);
    
    // Exact match
    if (normalized1 === normalized2) {
      return true;
    }

    // Check if one is a subset of the other (missing judge designation)
    if (normalized1.startsWith(normalized2) || normalized2.startsWith(normalized1)) {
      return true;
    }

    return false;
  }

  /**
   * Extract all case numbers from text (for finding related cases)
   */
  extractAllCaseNumbers(text: string): CaseNumberInfo[] {
    const results: CaseNumberInfo[] = [];
    const seen = new Set<string>();

    for (const [key, pattern] of Object.entries(this.patterns)) {
      const matches = text.matchAll(new RegExp(pattern.regex, 'g'));
      
      for (const match of matches) {
        const caseNumber = this.normalizeCaseNumber(match[1]);
        
        if (!seen.has(caseNumber)) {
          seen.add(caseNumber);
          results.push({
            caseNumber,
            format: pattern.format,
            confidence: pattern.confidence
          });
        }
      }
    }

    // Sort by confidence
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Test the extractor with known examples
   */
  testExtractor(): void {
    const testCases = [
      "Case No. 2:19-CV-00123-JRG",
      "Civil Action No. 2:14-CV-00033-JRG",
      "CAUSE NO. 6:20-CV-00459-ADA",
      "2:19-cv-00066-JRG United States District Court",
      "Random text without case number",
      "Page 1 of Case 2:16-CV-00230-JRG Transcript"
    ];

    console.log("Testing Case Number Extractor:");
    for (const testCase of testCases) {
      const result = this.extractFromPageHeader(testCase);
      console.log(`Input: "${testCase}"`);
      console.log(`Result:`, result || 'No case number found');
      console.log('---');
    }
  }
}

// Export singleton instance
export const caseNumberExtractor = new CaseNumberExtractor();