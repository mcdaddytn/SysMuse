#!/usr/bin/env npx tsx
/**
 * Validate Portfolio Configuration
 *
 * Checks for conflicts between portfolio assignees and competitors:
 * 1. Portfolio entities should not appear as competitors
 * 2. All portfolio entities should be in excludePatterns
 * 3. No competitor patterns should match portfolio assignees
 *
 * Also identifies potential portfolio entities in citation data that
 * might need to be added (acquisitions, subsidiaries, etc.)
 *
 * Usage:
 *   npx tsx scripts/validate-portfolio-config.ts [--fix] [--verbose]
 */

import * as fs from 'fs';

interface PortfolioAssignee {
  entity: string;
  variants: string[];
  acquisitionDate: string | null;
  notes: string;
  priority: number;
}

interface PortfolioConfig {
  portfolio: string;
  client: string;
  asOfDate: string;
  description: string;
  assignees: PortfolioAssignee[];
}

interface CompanyConfig {
  name: string;
  patterns: string[];
}

interface CompetitorConfig {
  version: string;
  categories: Record<string, { companies: CompanyConfig[] }>;
  excludePatterns: string[];
}

const VERBOSE = process.argv.includes('--verbose');
const FIX = process.argv.includes('--fix');

async function main() {
  console.log('=' .repeat(70));
  console.log('PORTFOLIO CONFIGURATION VALIDATOR');
  console.log('=' .repeat(70));

  // Load configs
  const portfolio: PortfolioConfig = JSON.parse(
    fs.readFileSync('config/broadcom-assignees.json', 'utf-8')
  );
  const competitors: CompetitorConfig = JSON.parse(
    fs.readFileSync('config/competitors.json', 'utf-8')
  );

  console.log(`\nPortfolio: ${portfolio.portfolio}`);
  console.log(`Client: ${portfolio.client}`);
  console.log(`Portfolio entities: ${portfolio.assignees.length}`);
  console.log(`Exclude patterns: ${competitors.excludePatterns.length}`);

  const issues: string[] = [];
  const warnings: string[] = [];

  // =========================================================================
  // Check 1: All portfolio variants should be in excludePatterns
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('CHECK 1: Portfolio variants in excludePatterns');
  console.log('-'.repeat(70));

  const excludePatternsLower = competitors.excludePatterns.map(p => p.toLowerCase());
  const missingFromExclude: string[] = [];

  for (const assignee of portfolio.assignees) {
    // Check entity name
    const entityLower = assignee.entity.toLowerCase();
    const foundEntity = excludePatternsLower.some(p =>
      entityLower.includes(p) || p.includes(entityLower.split(' ')[0])
    );

    if (!foundEntity) {
      missingFromExclude.push(assignee.entity);
      if (VERBOSE) console.log(`  MISSING: ${assignee.entity}`);
    }

    // Check variants
    for (const variant of assignee.variants) {
      const variantLower = variant.toLowerCase();
      const foundVariant = excludePatternsLower.some(p =>
        variantLower.includes(p) || p.includes(variantLower.split(' ')[0])
      );

      if (!foundVariant && VERBOSE) {
        console.log(`  MISSING VARIANT: ${variant}`);
      }
    }
  }

  if (missingFromExclude.length > 0) {
    issues.push(`${missingFromExclude.length} portfolio entities not in excludePatterns: ${missingFromExclude.join(', ')}`);
  } else {
    console.log('  All portfolio entities covered by excludePatterns');
  }

  // =========================================================================
  // Check 2: No portfolio entities in competitor list
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('CHECK 2: Portfolio entities in competitor list');
  console.log('-'.repeat(70));

  const portfolioPatterns: string[] = [];
  for (const assignee of portfolio.assignees) {
    portfolioPatterns.push(assignee.entity.toLowerCase());
    for (const variant of assignee.variants) {
      portfolioPatterns.push(variant.toLowerCase());
    }
  }

  const competitorsInPortfolio: string[] = [];

  // Build a set of exact portfolio entity names (lowercase) for precise matching
  const portfolioEntityNames = new Set<string>();
  for (const assignee of portfolio.assignees) {
    portfolioEntityNames.add(assignee.entity.toLowerCase());
    for (const variant of assignee.variants) {
      portfolioEntityNames.add(variant.toLowerCase());
    }
  }

  // Key terms that indicate a portfolio entity (more precise than first-word matching)
  const portfolioKeyTerms = [
    'broadcom', 'avago', 'lsi logic', 'lsi corporation', 'brocade',
    'ca, inc', 'ca technologies', 'computer associates',
    'symantec', 'nortonlifelock', 'vmware', 'carbon black'
  ];

  for (const [category, data] of Object.entries(competitors.categories)) {
    for (const company of data.companies) {
      const companyLower = company.name.toLowerCase();

      // Check 1: Exact match against portfolio entity names
      if (portfolioEntityNames.has(companyLower)) {
        competitorsInPortfolio.push(`${company.name} (${category})`);
        if (VERBOSE) console.log(`  EXACT MATCH: ${company.name} in ${category}`);
        continue;
      }

      // Check 2: Company name contains a key portfolio term
      let foundConflict = false;
      for (const term of portfolioKeyTerms) {
        if (companyLower.includes(term) || term.includes(companyLower)) {
          competitorsInPortfolio.push(`${company.name} (${category})`);
          if (VERBOSE) console.log(`  TERM MATCH: ${company.name} matches "${term}" in ${category}`);
          foundConflict = true;
          break;
        }
      }
      if (foundConflict) continue;

      // Check 3: Company patterns match portfolio terms
      for (const pattern of company.patterns) {
        const patternLower = pattern.toLowerCase();
        for (const term of portfolioKeyTerms) {
          if (patternLower.includes(term) || term.includes(patternLower)) {
            if (!competitorsInPortfolio.some(c => c.startsWith(`${company.name} (`))) {
              competitorsInPortfolio.push(`${company.name} (${category}) via pattern "${pattern}"`);
              if (VERBOSE) console.log(`  PATTERN MATCH: ${company.name} pattern "${pattern}" matches "${term}"`);
            }
          }
        }
      }
    }
  }

  if (competitorsInPortfolio.length > 0) {
    issues.push(`${competitorsInPortfolio.length} portfolio entities found in competitor list`);
    for (const c of competitorsInPortfolio) {
      console.log(`  REMOVE: ${c}`);
    }
  } else {
    console.log('  No portfolio entities in competitor list');
  }

  // =========================================================================
  // Check 3: Verify excludePatterns are working
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('CHECK 3: ExcludePatterns effectiveness');
  console.log('-'.repeat(70));

  // Test each portfolio variant against excludePatterns
  let covered = 0;
  let notCovered = 0;

  for (const assignee of portfolio.assignees) {
    for (const variant of assignee.variants) {
      const variantLower = variant.toLowerCase();
      const isCovered = competitors.excludePatterns.some(p =>
        variantLower.includes(p.toLowerCase())
      );

      if (isCovered) {
        covered++;
      } else {
        notCovered++;
        warnings.push(`Variant not covered: "${variant}" (${assignee.entity})`);
        if (VERBOSE) console.log(`  NOT COVERED: "${variant}"`);
      }
    }
  }

  console.log(`  Covered variants: ${covered}`);
  console.log(`  Not covered variants: ${notCovered}`);

  // =========================================================================
  // Check 4: Look for potential acquisitions in citation data
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('CHECK 4: Potential portfolio entities in citation data');
  console.log('-'.repeat(70));

  // Known Broadcom-related patterns that might indicate acquisitions or subsidiaries
  const suspiciousPatterns = [
    'symantec',
    'vmware',
    'carbon black',
    'broadcom',
    'avago',
    'lsi',
    'brocade',
    'ca, inc',
    'ca technologies',
    'computer associates',
    'blue coat',  // Symantec acquisition
    'lifelock',   // Symantec acquisition
    'verisign',   // Symantec acquisition (some assets)
    'pivotal',    // VMware spinoff/acquisition
    'spring',     // VMware (Spring Framework)
    'tanzu',      // VMware product
    'nyansa',     // VMware acquisition
    'lastline',   // VMware acquisition
    'avi networks', // VMware acquisition
  ];

  // Check if we have citator data to scan
  const citatorFiles = fs.readdirSync('output')
    .filter(f => f.startsWith('unknown-citators-analysis-'))
    .sort()
    .reverse();

  if (citatorFiles.length > 0) {
    const citatorData = JSON.parse(
      fs.readFileSync(`output/${citatorFiles[0]}`, 'utf-8')
    );

    const potentialPortfolio: string[] = [];

    for (const citator of citatorData.top_known_competitors || []) {
      const companyLower = citator.company.toLowerCase();
      for (const pattern of suspiciousPatterns) {
        if (companyLower.includes(pattern)) {
          potentialPortfolio.push(`${citator.company} (${citator.citations} citations)`);
          break;
        }
      }
    }

    if (potentialPortfolio.length > 0) {
      console.log('  Potential portfolio entities found in citator data:');
      for (const p of potentialPortfolio.slice(0, 10)) {
        console.log(`    - ${p}`);
      }
      if (potentialPortfolio.length > 10) {
        console.log(`    ... and ${potentialPortfolio.length - 10} more`);
      }
    } else {
      console.log('  No suspicious entities found in citator data');
    }
  } else {
    console.log('  No citator data available to scan');
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  if (issues.length === 0 && warnings.length === 0) {
    console.log('\n  All checks passed! Portfolio configuration is valid.');
  } else {
    if (issues.length > 0) {
      console.log(`\n  ISSUES (${issues.length}):`);
      for (const issue of issues) {
        console.log(`    - ${issue}`);
      }
    }

    if (warnings.length > 0) {
      console.log(`\n  WARNINGS (${warnings.length}):`);
      for (const warning of warnings.slice(0, 10)) {
        console.log(`    - ${warning}`);
      }
      if (warnings.length > 10) {
        console.log(`    ... and ${warnings.length - 10} more`);
      }
    }
  }

  // =========================================================================
  // Suggested excludePatterns additions
  // =========================================================================
  console.log('\n' + '-'.repeat(70));
  console.log('SUGGESTED ADDITIONS TO excludePatterns');
  console.log('-'.repeat(70));

  const suggestedPatterns = new Set<string>();

  // Add any entity names not already covered
  for (const assignee of portfolio.assignees) {
    const entityFirst = assignee.entity.split(' ')[0];
    if (!excludePatternsLower.some(p => p === entityFirst.toLowerCase())) {
      suggestedPatterns.add(entityFirst);
    }
  }

  // Add common subsidiary patterns
  const additionalPatterns = [
    'Blue Coat',      // Symantec acquisition
    'LifeLock',       // Symantec acquisition
    'Pivotal',        // VMware spinoff
    'Tanzu',          // VMware brand
    'Avi Networks',   // VMware acquisition
    'Lastline',       // VMware acquisition
    'Nyansa',         // VMware acquisition
  ];

  for (const p of additionalPatterns) {
    if (!excludePatternsLower.some(ep => ep.toLowerCase() === p.toLowerCase())) {
      suggestedPatterns.add(p);
    }
  }

  if (suggestedPatterns.size > 0) {
    console.log('  Consider adding these patterns:');
    for (const p of suggestedPatterns) {
      console.log(`    "${p}",`);
    }
  } else {
    console.log('  No additional patterns suggested');
  }

  console.log('\n' + '='.repeat(70));
  console.log('DONE');
  console.log('='.repeat(70));

  // Exit with error code if issues found
  if (issues.length > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
