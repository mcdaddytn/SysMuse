/**
 * Competitor Configuration Loader
 *
 * Loads competitor patterns from config/competitors.json
 * and provides utilities for matching assignee names.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_PATH = path.join(__dirname, '../config/competitors.json');

interface CompanyConfig {
  name: string;
  patterns: string[];
}

interface CategoryConfig {
  description: string;
  enabled: boolean;
  companies: CompanyConfig[];
}

interface CompetitorConfig {
  version: string;
  description: string;
  lastUpdated: string;
  categories: Record<string, CategoryConfig>;
  excludePatterns: string[];
  notes: Record<string, string>;
}

export interface CompetitorMatch {
  company: string;
  category: string;
  pattern: string;
}

export class CompetitorMatcher {
  private config: CompetitorConfig;
  private allPatterns: Array<{ pattern: RegExp; company: string; category: string }> = [];
  private excludePatterns: RegExp[] = [];

  constructor(configPath?: string) {
    const filePath = configPath || CONFIG_PATH;
    this.config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    this.buildPatternIndex();
  }

  private buildPatternIndex(): void {
    // Build exclude patterns
    this.excludePatterns = this.config.excludePatterns.map(
      p => new RegExp(p, 'i')
    );

    // Build match patterns from enabled categories
    for (const [categoryName, category] of Object.entries(this.config.categories)) {
      if (!category.enabled) continue;

      for (const company of category.companies) {
        for (const pattern of company.patterns) {
          this.allPatterns.push({
            pattern: new RegExp(pattern, 'i'),
            company: company.name,
            category: categoryName,
          });
        }
      }
    }
  }

  /**
   * Check if an assignee name should be excluded (is Broadcom-related)
   */
  isExcluded(assignee: string): boolean {
    return this.excludePatterns.some(p => p.test(assignee));
  }

  /**
   * Match an assignee name against competitor patterns
   * Returns null if no match or if excluded
   */
  matchCompetitor(assignee: string): CompetitorMatch | null {
    if (!assignee || this.isExcluded(assignee)) {
      return null;
    }

    for (const { pattern, company, category } of this.allPatterns) {
      if (pattern.test(assignee)) {
        return { company, category, pattern: pattern.source };
      }
    }

    return null;
  }

  /**
   * Get all unique company names for display
   */
  getAllCompanyNames(): string[] {
    const names = new Set<string>();
    for (const category of Object.values(this.config.categories)) {
      if (!category.enabled) continue;
      for (const company of category.companies) {
        names.add(company.name);
      }
    }
    return Array.from(names).sort();
  }

  /**
   * Get flat array of all patterns for backward compatibility
   */
  getAllPatterns(): string[] {
    const patterns: string[] = [];
    for (const category of Object.values(this.config.categories)) {
      if (!category.enabled) continue;
      for (const company of category.companies) {
        patterns.push(...company.patterns);
      }
    }
    return patterns;
  }

  /**
   * Get companies grouped by category
   */
  getCompaniesByCategory(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [categoryName, category] of Object.entries(this.config.categories)) {
      if (!category.enabled) continue;
      result[categoryName] = category.companies.map(c => c.name);
    }
    return result;
  }

  /**
   * Get enabled categories
   */
  getEnabledCategories(): string[] {
    return Object.entries(this.config.categories)
      .filter(([_, cat]) => cat.enabled)
      .map(([name, _]) => name);
  }

  /**
   * Get configuration summary for logging
   */
  getSummary(): string {
    const enabledCategories = this.getEnabledCategories();
    const totalCompanies = this.getAllCompanyNames().length;
    const totalPatterns = this.getAllPatterns().length;

    return `Competitor Config v${this.config.version}: ${totalCompanies} companies across ${enabledCategories.length} categories (${totalPatterns} patterns)`;
  }
}

// Export a default instance
let defaultMatcher: CompetitorMatcher | null = null;

export function getCompetitorMatcher(): CompetitorMatcher {
  if (!defaultMatcher) {
    defaultMatcher = new CompetitorMatcher();
  }
  return defaultMatcher;
}

// CLI test
if (import.meta.url === `file://${process.argv[1]}`) {
  const matcher = new CompetitorMatcher();
  console.log('\n' + matcher.getSummary() + '\n');

  console.log('Categories:');
  const byCategory = matcher.getCompaniesByCategory();
  for (const [cat, companies] of Object.entries(byCategory)) {
    console.log(`  ${cat}: ${companies.join(', ')}`);
  }

  console.log('\nTest matches:');
  const testCases = [
    'Microsoft Corporation',
    'GOOGLE LLC',
    'Palo Alto Networks, Inc.',
    'Cisco Systems, Inc.',
    'Broadcom Corporation',
    'Random Company Inc.',
    'CrowdStrike Holdings',
    'Qualcomm Incorporated',
  ];

  for (const test of testCases) {
    const match = matcher.matchCompetitor(test);
    const excluded = matcher.isExcluded(test);
    if (excluded) {
      console.log(`  "${test}" -> EXCLUDED (Broadcom-related)`);
    } else if (match) {
      console.log(`  "${test}" -> ${match.company} (${match.category})`);
    } else {
      console.log(`  "${test}" -> no match`);
    }
  }
}
