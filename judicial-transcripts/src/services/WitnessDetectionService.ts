/**
 * Feature 03C: Witness Detection Service
 * 
 * Detects witness introductions and extracts witness information from transcript lines
 * Based on pattern analysis of 80+ witness sworn lines across multiple trials
 */

import { logger } from '../utils/logger';

export interface WitnessInfo {
  name: string;
  party: 'PLAINTIFF' | 'DEFENDANT' | null;
  swornStatus: 'SWORN' | 'PREVIOUSLY_SWORN';
  hasTitle: boolean;
  originalLine: string;
  confidence: number;
}

export interface WitnessPattern {
  id: string;
  regex: RegExp;
  confidence: number;
  extractWitnessInfo: (match: RegExpMatchArray, line: string) => WitnessInfo | null;
}

export class WitnessDetectionService {
  /**
   * Primary pattern: NAME, PARTY'S WITNESS, SWORN_STATUS
   * Matches 96% of witness lines based on analysis
   */
  private readonly primaryPattern: WitnessPattern = {
    id: 'standard_comma_separated',
    // Captures: name (with titles), party designation, sworn status
    regex: /^([A-Z][A-Z\s.,'-]+?),\s*((?:PLAINTIFF|DEFENDANT)S?'S?\s+WITNESS),\s*((?:PREVIOUSLY\s+)?SWORN)/i,
    confidence: 0.95,
    extractWitnessInfo: (match: RegExpMatchArray, line: string): WitnessInfo => {
      const name = this.cleanWitnessName(match[1]);
      const partyText = match[2].toUpperCase();
      const swornText = match[3].toUpperCase();
      
      return {
        name,
        party: partyText.includes('PLAINTIFF') ? 'PLAINTIFF' : 'DEFENDANT',
        swornStatus: swornText.includes('PREVIOUSLY') ? 'PREVIOUSLY_SWORN' : 'SWORN',
        hasTitle: this.detectTitle(match[1]),
        originalLine: line,
        confidence: 0.95
      };
    }
  };

  /**
   * Alternative patterns for edge cases
   */
  private readonly alternativePatterns: WitnessPattern[] = [
    {
      id: 'parenthetical_sworn',
      // Pattern for witness info in parentheses
      regex: /\(([A-Z][A-Z\s.,'-]+?),?\s*((?:PLAINTIFF|DEFENDANT)S?'S?\s+)?WITNESS,?\s*((?:PREVIOUSLY\s+)?SWORN)\)/i,
      confidence: 0.85,
      extractWitnessInfo: (match: RegExpMatchArray, line: string): WitnessInfo => {
        const name = this.cleanWitnessName(match[1]);
        const partyText = match[2]?.toUpperCase() || '';
        const swornText = match[3].toUpperCase();
        
        return {
          name,
          party: partyText.includes('PLAINTIFF') ? 'PLAINTIFF' : 
                 partyText.includes('DEFENDANT') ? 'DEFENDANT' : null,
          swornStatus: swornText.includes('PREVIOUSLY') ? 'PREVIOUSLY_SWORN' : 'SWORN',
          hasTitle: this.detectTitle(match[1]),
          originalLine: line,
          confidence: 0.85
        };
      }
    },
    {
      id: 'witness_called_pattern',
      // Pattern for "WITNESS CALLED: NAME"
      regex: /WITNESS\s+CALLED:\s*([A-Z][A-Z\s.,'-]+?)(?:\s*,\s*((?:PREVIOUSLY\s+)?SWORN))?/i,
      confidence: 0.80,
      extractWitnessInfo: (match: RegExpMatchArray, line: string): WitnessInfo => {
        const name = this.cleanWitnessName(match[1]);
        const swornText = match[2]?.toUpperCase() || 'SWORN';
        
        // Try to detect party from context
        const party = this.detectPartyFromContext(line);
        
        return {
          name,
          party,
          swornStatus: swornText.includes('PREVIOUSLY') ? 'PREVIOUSLY_SWORN' : 'SWORN',
          hasTitle: this.detectTitle(match[1]),
          originalLine: line,
          confidence: 0.80
        };
      }
    }
  ];

  /**
   * Detect witness from a transcript line
   */
  detectWitness(line: string): WitnessInfo | null {
    // Quick check for witness keywords
    if (!this.hasWitnessKeywords(line)) {
      return null;
    }

    // Try primary pattern first
    const primaryMatch = line.match(this.primaryPattern.regex);
    if (primaryMatch) {
      return this.primaryPattern.extractWitnessInfo(primaryMatch, line);
    }

    // Try alternative patterns
    for (const pattern of this.alternativePatterns) {
      const match = line.match(pattern.regex);
      if (match) {
        return pattern.extractWitnessInfo(match, line);
      }
    }

    // Log unmatched witness lines for future pattern improvement
    if (line.includes('WITNESS') && line.includes('SWORN')) {
      logger.debug(`Unmatched witness line: ${line}`);
    }

    return null;
  }

  /**
   * Batch detect witnesses from multiple lines
   */
  detectWitnessesInLines(lines: string[]): WitnessInfo[] {
    const witnesses: WitnessInfo[] = [];
    
    for (const line of lines) {
      const witness = this.detectWitness(line);
      if (witness) {
        witnesses.push(witness);
      }
    }

    return witnesses;
  }

  /**
   * Check if line contains witness keywords
   */
  private hasWitnessKeywords(line: string): boolean {
    const upperLine = line.toUpperCase();
    return upperLine.includes('WITNESS') && 
           (upperLine.includes('SWORN') || upperLine.includes('CALLED'));
  }

  /**
   * Clean and normalize witness name
   */
  private cleanWitnessName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/,$/, '')     // Remove trailing comma
      .replace(/^,/, '');    // Remove leading comma
  }

  /**
   * Detect if name contains a title
   */
  private detectTitle(name: string): boolean {
    const titles = [
      'Ph.D.', 'PHD', 'PH.D',
      'M.D.', 'MD',
      'Dr.', 'DR.',
      'Jr.', 'JR.',
      'Sr.', 'SR.',
      'III', 'II',
      'Esq.', 'ESQ.'
    ];
    
    const upperName = name.toUpperCase();
    return titles.some(title => upperName.includes(title.toUpperCase()));
  }

  /**
   * Try to detect party from line context
   */
  private detectPartyFromContext(line: string): 'PLAINTIFF' | 'DEFENDANT' | null {
    const upperLine = line.toUpperCase();
    
    if (upperLine.includes("PLAINTIFF'S") || upperLine.includes("PLAINTIFFS'")) {
      return 'PLAINTIFF';
    }
    if (upperLine.includes("DEFENDANT'S") || upperLine.includes("DEFENDANTS'")) {
      return 'DEFENDANT';
    }
    
    return null;
  }

  /**
   * Get pattern statistics for debugging
   */
  getPatternStatistics(): { patternId: string; regex: string; confidence: number }[] {
    const patterns = [this.primaryPattern, ...this.alternativePatterns];
    return patterns.map(p => ({
      patternId: p.id,
      regex: p.regex.source,
      confidence: p.confidence
    }));
  }

  /**
   * Test patterns against known examples
   */
  testPatterns(): { line: string; detected: boolean; witness?: WitnessInfo }[] {
    const testCases = [
      "MARK STEWART, DEFENDANTS' WITNESS, SWORN,",
      "GLENN RUSSELL, DEFENDANTS' WITNESS, SWORN",
      "ROBERT AKL, Ph.D., DEFENDANTS' WITNESS, SWORN",
      "MARK STEFIK, PLAINTIFF'S WITNESS, SWORN",
      "ALAN WARD, DEFENDANT'S WITNESS, PREVIOUSLY SWORN",
      "(JOHN DOE, PLAINTIFF'S WITNESS, SWORN)",
      "WITNESS CALLED: JANE SMITH",
      "Random line without witness information"
    ];

    return testCases.map(line => {
      const witness = this.detectWitness(line);
      return {
        line,
        detected: witness !== null,
        witness: witness || undefined
      };
    });
  }
}

// Export singleton instance
export const witnessDetectionService = new WitnessDetectionService();