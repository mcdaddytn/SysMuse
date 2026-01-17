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
  discoveredBy?: string[];
  notes?: string;
  patentCount?: number;
  primaryTechnologies?: string[];
}

interface DiscoveryStrategy {
  name: string;
  description: string;
  type: 'manual' | 'citation-overlap' | 'term-extraction';
  dateAdded: string;
  parameters: Record<string, any>;
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
  discoveryStrategies?: Record<string, DiscoveryStrategy>;
  categories: Record<string, CategoryConfig>;
  excludePatterns: string[];
  notes: Record<string, any>;
}

export interface CompetitorMatch {
  company: string;
  category: string;
  pattern: string;
  discoveredBy?: string[];
}

export interface CompanyInfo {
  name: string;
  category: string;
  patterns: string[];
  discoveredBy: string[];
  notes?: string;
  patentCount?: number;
  primaryTechnologies?: string[];
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

  /**
   * Get all discovery strategies defined in config
   */
  getDiscoveryStrategies(): Record<string, DiscoveryStrategy> {
    return this.config.discoveryStrategies || {};
  }

  /**
   * Get companies discovered by a specific strategy
   */
  getCompaniesByStrategy(strategyId: string): CompanyInfo[] {
    const results: CompanyInfo[] = [];

    for (const [categoryName, category] of Object.entries(this.config.categories)) {
      if (!category.enabled) continue;

      for (const company of category.companies) {
        const discoveredBy = company.discoveredBy || ['manual-initial'];
        if (discoveredBy.includes(strategyId)) {
          results.push({
            name: company.name,
            category: categoryName,
            patterns: company.patterns,
            discoveredBy,
            notes: company.notes,
            patentCount: company.patentCount,
            primaryTechnologies: company.primaryTechnologies,
          });
        }
      }
    }

    return results;
  }

  /**
   * Get all companies with full info
   */
  getAllCompaniesWithInfo(): CompanyInfo[] {
    const results: CompanyInfo[] = [];

    for (const [categoryName, category] of Object.entries(this.config.categories)) {
      if (!category.enabled) continue;

      for (const company of category.companies) {
        results.push({
          name: company.name,
          category: categoryName,
          patterns: company.patterns,
          discoveredBy: company.discoveredBy || ['manual-initial'],
          notes: company.notes,
          patentCount: company.patentCount,
          primaryTechnologies: company.primaryTechnologies,
        });
      }
    }

    return results;
  }

  /**
   * Get summary of companies by discovery strategy
   */
  getStrategySummary(): Record<string, { strategyName: string; companyCount: number; companies: string[] }> {
    const strategies = this.getDiscoveryStrategies();
    const result: Record<string, { strategyName: string; companyCount: number; companies: string[] }> = {};

    for (const [strategyId, strategy] of Object.entries(strategies)) {
      const companies = this.getCompaniesByStrategy(strategyId);
      result[strategyId] = {
        strategyName: strategy.name,
        companyCount: companies.length,
        companies: companies.map(c => c.name),
      };
    }

    return result;
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

  console.log('\nDiscovery Strategies:');
  const strategies = matcher.getDiscoveryStrategies();
  for (const [id, strategy] of Object.entries(strategies)) {
    console.log(`  ${id}: ${strategy.name} (${strategy.type})`);
  }

  console.log('\nCompanies by Strategy:');
  const strategySummary = matcher.getStrategySummary();
  for (const [id, summary] of Object.entries(strategySummary)) {
    console.log(`  ${summary.strategyName}: ${summary.companyCount} companies`);
    console.log(`    ${summary.companies.slice(0, 5).join(', ')}${summary.companies.length > 5 ? '...' : ''}`);
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
    'MURATA MANUFACTURING CO., LTD.',
    'Skyworks Solutions, Inc.',
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
