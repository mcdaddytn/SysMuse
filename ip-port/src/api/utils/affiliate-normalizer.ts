/**
 * Affiliate Normalizer
 *
 * Maps raw USPTO assignee names to normalized affiliate names
 * for portfolio reporting and filtering.
 */

import * as fs from 'fs';
import * as path from 'path';

interface AffiliateConfig {
  displayName: string;
  acquiredYear: number | null;
  parent?: string;
  patterns: string[];
}

interface AffiliatesData {
  affiliates: Record<string, AffiliateConfig>;
}

// Cache for affiliate patterns
let affiliatePatterns: { pattern: RegExp; affiliate: string; displayName: string }[] | null = null;

/**
 * Load affiliate configuration
 */
function loadAffiliateConfig(): AffiliatesData {
  const configPath = path.join(process.cwd(), 'config/portfolio-affiliates.json');
  const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return data;
}

/**
 * Build regex patterns for affiliate matching
 */
function buildPatterns(): { pattern: RegExp; affiliate: string; displayName: string }[] {
  if (affiliatePatterns) {
    return affiliatePatterns;
  }

  const config = loadAffiliateConfig();
  const patterns: { pattern: RegExp; affiliate: string; displayName: string }[] = [];

  // Sort affiliates by pattern length (longest first) for better matching
  const sortedAffiliates = Object.entries(config.affiliates).sort((a, b) => {
    const maxLenA = Math.max(...a[1].patterns.map(p => p.length));
    const maxLenB = Math.max(...b[1].patterns.map(p => p.length));
    return maxLenB - maxLenA;
  });

  for (const [affiliateKey, affiliateData] of sortedAffiliates) {
    for (const patternStr of affiliateData.patterns) {
      // Escape special regex characters and create case-insensitive pattern
      const escaped = patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push({
        pattern: new RegExp(escaped, 'i'),
        affiliate: affiliateKey,
        displayName: affiliateData.displayName
      });
    }
  }

  affiliatePatterns = patterns;
  return patterns;
}

/**
 * Normalize an assignee name to its affiliate
 *
 * @param assignee Raw USPTO assignee name
 * @returns Normalized affiliate name, or "Unknown" if no match
 */
export function normalizeAffiliate(assignee: string): string {
  if (!assignee) return 'Unknown';

  const patterns = buildPatterns();

  for (const { pattern, displayName } of patterns) {
    if (pattern.test(assignee)) {
      return displayName;
    }
  }

  return 'Unknown';
}

/**
 * Get affiliate key (short name) for an assignee
 *
 * @param assignee Raw USPTO assignee name
 * @returns Affiliate key, or null if no match
 */
export function getAffiliateKey(assignee: string): string | null {
  if (!assignee) return null;

  const patterns = buildPatterns();

  for (const { pattern, affiliate } of patterns) {
    if (pattern.test(assignee)) {
      return affiliate;
    }
  }

  return null;
}

/**
 * Get list of all affiliates with their display names
 */
export function getAllAffiliates(): { key: string; displayName: string; acquiredYear: number | null }[] {
  const config = loadAffiliateConfig();
  return Object.entries(config.affiliates).map(([key, data]) => ({
    key,
    displayName: data.displayName,
    acquiredYear: data.acquiredYear
  }));
}

/**
 * Clear the cached patterns (useful for testing or config reload)
 */
export function clearCache(): void {
  affiliatePatterns = null;
}
