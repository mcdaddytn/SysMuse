#!/usr/bin/env npx ts-node
/**
 * Taxonomy Gap Analysis - Deep Dive
 *
 * Analyzes specific gaps in taxonomy coverage:
 * 1. Indexing codes (Y, G06F2xxx, H04L2xxx) vs primary classification
 * 2. Missing H04L/H04W subgroups that should be in taxonomy
 * 3. Sector prefix specificity analysis
 * 4. Recommendations for taxonomy expansion
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface TaxonomySector {
  name: string;
  displayName: string;
  superSector: string;
  cpcPrefixes: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CPC Code Classification
// ═══════════════════════════════════════════════════════════════════════════

function isIndexingCode(code: string): boolean {
  // Y section codes are cross-sectional tagging codes (not primary classification)
  if (code.startsWith('Y')) return true;

  // 4-digit pattern after class indicates indexing scheme
  // e.g., G06F2009, H04L2101, H04W2092
  const indexPattern = /^[A-H]\d{2}[A-Z]2\d{3}/;
  if (indexPattern.test(code)) return true;

  // Y10T and Y10S are old US classification indexes
  if (code.startsWith('Y10')) return true;

  return false;
}

function getCpcClass(code: string): string {
  const match = code.match(/^([A-H]\d{2}[A-Z]?)/);
  return match ? match[1] : code.substring(0, 4);
}

function getCpcGroup(code: string): string {
  // Extract primary group (before the /)
  const normalized = code.replace(/\//g, '');
  const match = normalized.match(/^([A-H]\d{2}[A-Z]?\d+)/);
  return match ? match[1] : normalized.substring(0, 7);
}

function getCpcSection(code: string): string {
  return code.charAt(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Taxonomy Loader
// ═══════════════════════════════════════════════════════════════════════════

function loadTaxonomy(): Map<string, TaxonomySector> {
  const configPath = path.join(process.cwd(), 'config/sector-taxonomy-cpc-only.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const sectors = new Map<string, TaxonomySector>();

  const sectorToSuperSector = new Map<string, string>();
  for (const [ssKey, ssData] of Object.entries(config.superSectors) as [string, any][]) {
    for (const sectorName of ssData.sectors) {
      sectorToSuperSector.set(sectorName, ssKey);
    }
  }

  for (const [sectorKey, sectorData] of Object.entries(config.sectors) as [string, any][]) {
    sectors.set(sectorKey, {
      name: sectorKey,
      displayName: sectorData.displayName,
      superSector: sectorToSuperSector.get(sectorKey) || 'UNCLASSIFIED',
      cpcPrefixes: sectorData.cpcPrefixes || [],
    });
  }

  return sectors;
}

function getAllTaxonomyPrefixes(sectors: Map<string, TaxonomySector>): Set<string> {
  const prefixes = new Set<string>();
  for (const sector of sectors.values()) {
    for (const prefix of sector.cpcPrefixes) {
      prefixes.add(prefix.replace('/', ''));
    }
  }
  return prefixes;
}

function isCpcInTaxonomy(cpcCode: string, prefixes: Set<string>): boolean {
  const normalized = cpcCode.replace(/\//g, '');
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Analysis Functions
// ═══════════════════════════════════════════════════════════════════════════

interface GapAnalysisReport {
  generatedAt: string;
  indexingCodeSummary: {
    totalIndexingCodes: number;
    uniqueIndexingCodes: number;
    bySection: Record<string, number>;
    byType: Record<string, { codes: number; patents: number }>;
    topIndexingCodes: Array<{ code: string; patents: number; type: string }>;
  };
  primaryCodeGaps: {
    totalPrimaryCodes: number;
    unmappedPrimaryCodes: number;
    byClass: Record<string, {
      total: number;
      unmapped: number;
      unmappedPct: number;
      topUnmapped: string[];
    }>;
    coreClassGaps: {
      // H04L, H04W, G06F - core classes that should be well covered
      className: string;
      totalGroups: number;
      coveredGroups: number;
      gapGroups: Array<{ group: string; patentCount: number }>;
    }[];
  };
  taxonomyPrefixAnalysis: {
    prefixesBySpecificity: Record<string, number>;  // e.g., "4-char": N, "5-char": M
    overlappingPrefixes: Array<{ prefix1: string; prefix2: string; sector1: string; sector2: string }>;
    gapsBetweenPrefixes: Array<{ class: string; coveredPrefixes: string[]; gapRanges: string[] }>;
  };
  recommendations: {
    prefixesToAdd: Array<{
      prefix: string;
      suggestedSector: string;
      patentCount: number;
      reason: string;
    }>;
    prefixesToBroaden: Array<{
      currentPrefix: string;
      suggestedPrefix: string;
      sector: string;
      additionalPatents: number;
    }>;
    indexingCodeHandling: string;
  };
}

async function analyzeGaps(): Promise<GapAnalysisReport> {
  console.log('Starting taxonomy gap analysis...\n');

  const sectors = loadTaxonomy();
  const taxonomyPrefixes = getAllTaxonomyPrefixes(sectors);

  // Load all CPC codes with patent counts
  console.log('Loading CPC code statistics from database...');
  const cpcStats = await prisma.patentCpc.groupBy({
    by: ['cpcCode'],
    _count: { cpcCode: true },
  });

  console.log(`  Found ${cpcStats.length} unique CPC codes\n`);

  // Categorize codes
  const indexingCodes = new Map<string, number>();  // code -> patent count
  const primaryCodes = new Map<string, number>();
  const indexingBySection = new Map<string, number>();
  const indexingByType = new Map<string, { codes: Set<string>; patents: number }>();

  for (const stat of cpcStats) {
    const code = stat.cpcCode;
    const count = stat._count.cpcCode;

    if (isIndexingCode(code)) {
      indexingCodes.set(code, count);

      // Track by section
      const section = getCpcSection(code);
      indexingBySection.set(section, (indexingBySection.get(section) || 0) + count);

      // Track by type
      let type = 'other';
      if (code.startsWith('Y02')) type = 'Y02-climate';
      else if (code.startsWith('Y10')) type = 'Y10-uspc';
      else if (code.match(/^[A-H]\d{2}[A-Z]2\d{3}/)) type = 'indexing-scheme';
      else if (code.startsWith('Y')) type = 'Y-other';

      if (!indexingByType.has(type)) {
        indexingByType.set(type, { codes: new Set(), patents: 0 });
      }
      indexingByType.get(type)!.codes.add(code);
      indexingByType.get(type)!.patents += count;
    } else {
      primaryCodes.set(code, count);
    }
  }

  // Analyze primary code gaps
  const primaryCodesByClass = new Map<string, Map<string, number>>();
  const unmappedPrimaryByClass = new Map<string, Map<string, number>>();

  for (const [code, count] of primaryCodes) {
    const cls = getCpcClass(code);
    const isInTax = isCpcInTaxonomy(code, taxonomyPrefixes);

    if (!primaryCodesByClass.has(cls)) {
      primaryCodesByClass.set(cls, new Map());
      unmappedPrimaryByClass.set(cls, new Map());
    }
    primaryCodesByClass.get(cls)!.set(code, count);

    if (!isInTax) {
      unmappedPrimaryByClass.get(cls)!.set(code, count);
    }
  }

  // Focus on core classes (H04L, H04W, G06F, etc.)
  const coreClasses = ['H04L', 'H04W', 'G06F', 'H04N', 'H04B', 'G06N', 'H01L', 'H03H'];
  const coreClassGaps: GapAnalysisReport['primaryCodeGaps']['coreClassGaps'] = [];

  for (const cls of coreClasses) {
    const allCodes = primaryCodesByClass.get(cls) || new Map();
    const unmapped = unmappedPrimaryByClass.get(cls) || new Map();

    // Group codes by their CPC group
    const groupedCodes = new Map<string, { total: number; unmapped: number }>();
    for (const [code, count] of allCodes) {
      const group = getCpcGroup(code);
      if (!groupedCodes.has(group)) {
        groupedCodes.set(group, { total: 0, unmapped: 0 });
      }
      groupedCodes.get(group)!.total += count;
    }
    for (const [code, count] of unmapped) {
      const group = getCpcGroup(code);
      if (groupedCodes.has(group)) {
        groupedCodes.get(group)!.unmapped += count;
      }
    }

    // Find groups with significant unmapped codes
    const gapGroups: Array<{ group: string; patentCount: number }> = [];
    for (const [group, stats] of groupedCodes) {
      if (stats.unmapped >= 10 && stats.unmapped / stats.total > 0.5) {
        gapGroups.push({ group, patentCount: stats.unmapped });
      }
    }
    gapGroups.sort((a, b) => b.patentCount - a.patentCount);

    coreClassGaps.push({
      className: cls,
      totalGroups: groupedCodes.size,
      coveredGroups: Array.from(groupedCodes.values()).filter(g => g.unmapped / g.total < 0.5).length,
      gapGroups: gapGroups.slice(0, 10),
    });
  }

  // Analyze taxonomy prefix specificity
  const prefixesByLength = new Map<number, number>();
  for (const prefix of taxonomyPrefixes) {
    const len = prefix.length;
    prefixesByLength.set(len, (prefixesByLength.get(len) || 0) + 1);
  }

  // Generate recommendations
  const prefixesToAdd: GapAnalysisReport['recommendations']['prefixesToAdd'] = [];

  // Find high-value unmapped groups
  for (const gap of coreClassGaps) {
    for (const g of gap.gapGroups.slice(0, 3)) {
      // Find the most likely sector for this group
      let suggestedSector = 'general';
      if (g.group.startsWith('H04L63')) suggestedSector = 'network-threat-protection';
      else if (g.group.startsWith('H04L9')) suggestedSector = 'network-crypto';
      else if (g.group.startsWith('H04W92')) suggestedSector = 'wireless-infrastructure';
      else if (g.group.startsWith('H04W')) suggestedSector = 'wireless-services';
      else if (g.group.startsWith('G06F21')) suggestedSector = 'computing-auth-boot';

      prefixesToAdd.push({
        prefix: g.group + '/',
        suggestedSector,
        patentCount: g.patentCount,
        reason: `${g.patentCount} patents using ${g.group} codes not covered by current taxonomy`,
      });
    }
  }

  // Build report
  const report: GapAnalysisReport = {
    generatedAt: new Date().toISOString(),
    indexingCodeSummary: {
      totalIndexingCodes: Array.from(indexingCodes.values()).reduce((a, b) => a + b, 0),
      uniqueIndexingCodes: indexingCodes.size,
      bySection: Object.fromEntries(indexingBySection),
      byType: Object.fromEntries(
        Array.from(indexingByType.entries()).map(([type, data]) => [
          type,
          { codes: data.codes.size, patents: data.patents }
        ])
      ),
      topIndexingCodes: Array.from(indexingCodes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([code, count]) => ({
          code,
          patents: count,
          type: code.startsWith('Y02') ? 'climate' :
                code.startsWith('Y10') ? 'uspc' :
                code.match(/^[A-H]\d{2}[A-Z]2/) ? 'indexing' : 'other'
        })),
    },
    primaryCodeGaps: {
      totalPrimaryCodes: primaryCodes.size,
      unmappedPrimaryCodes: Array.from(unmappedPrimaryByClass.values())
        .reduce((sum, m) => sum + m.size, 0),
      byClass: Object.fromEntries(
        Array.from(primaryCodesByClass.entries())
          .map(([cls, codes]) => {
            const unmapped = unmappedPrimaryByClass.get(cls) || new Map();
            const topUnmapped = Array.from(unmapped.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([code]) => code);
            return [cls, {
              total: codes.size,
              unmapped: unmapped.size,
              unmappedPct: codes.size > 0 ? (unmapped.size / codes.size) * 100 : 0,
              topUnmapped,
            }];
          })
          .filter(([, data]) => (data as any).unmapped > 0)
          .sort((a, b) => (b[1] as any).unmapped - (a[1] as any).unmapped)
      ),
      coreClassGaps,
    },
    taxonomyPrefixAnalysis: {
      prefixesBySpecificity: Object.fromEntries(
        Array.from(prefixesByLength.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([len, count]) => [`${len}-char`, count])
      ),
      overlappingPrefixes: [],  // Would require additional analysis
      gapsBetweenPrefixes: [],  // Would require additional analysis
    },
    recommendations: {
      prefixesToAdd,
      prefixesToBroaden: [],
      indexingCodeHandling: `${indexingCodes.size} indexing codes (Y-section, 2xxx-scheme) found. These are secondary tags and should NOT be used for primary sector classification. Consider filtering these out during sector assignment.`,
    },
  };

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    const report = await analyzeGaps();

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                 TAXONOMY GAP ANALYSIS                          ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('INDEXING CODES (should be excluded from primary classification):');
    console.log(`  Total indexing code occurrences: ${report.indexingCodeSummary.totalIndexingCodes.toLocaleString()}`);
    console.log(`  Unique indexing codes: ${report.indexingCodeSummary.uniqueIndexingCodes.toLocaleString()}`);
    console.log('\n  By type:');
    for (const [type, data] of Object.entries(report.indexingCodeSummary.byType)) {
      console.log(`    ${type.padEnd(20)} ${data.codes.toString().padStart(6)} codes, ${data.patents.toString().padStart(8)} patents`);
    }

    console.log('\n  Top 10 indexing codes:');
    for (const item of report.indexingCodeSummary.topIndexingCodes.slice(0, 10)) {
      console.log(`    ${item.code.padEnd(20)} ${item.patents.toString().padStart(6)} patents  (${item.type})`);
    }

    console.log('\n\nPRIMARY CODE GAPS:');
    console.log(`  Total primary codes: ${report.primaryCodeGaps.totalPrimaryCodes.toLocaleString()}`);
    console.log(`  Unmapped primary codes: ${report.primaryCodeGaps.unmappedPrimaryCodes.toLocaleString()}`);

    console.log('\n  By CPC class (top 15 with gaps):');
    const classEntries = Object.entries(report.primaryCodeGaps.byClass).slice(0, 15);
    for (const [cls, data] of classEntries) {
      console.log(`    ${cls.padEnd(6)} total: ${data.total.toString().padStart(5)}, unmapped: ${data.unmapped.toString().padStart(5)} (${data.unmappedPct.toFixed(1)}%)`);
    }

    console.log('\n\nCORE CLASS ANALYSIS (H04L, H04W, G06F, etc.):');
    for (const gap of report.primaryCodeGaps.coreClassGaps) {
      console.log(`\n  ${gap.className}:`);
      console.log(`    Total groups: ${gap.totalGroups}, Covered: ${gap.coveredGroups}`);
      if (gap.gapGroups.length > 0) {
        console.log('    Gap groups (>50% unmapped, >10 patents):');
        for (const g of gap.gapGroups.slice(0, 5)) {
          console.log(`      ${g.group.padEnd(12)} ${g.patentCount} patents`);
        }
      }
    }

    console.log('\n\nTAXONOMY PREFIX SPECIFICITY:');
    for (const [spec, count] of Object.entries(report.taxonomyPrefixAnalysis.prefixesBySpecificity)) {
      console.log(`  ${spec}: ${count} prefixes`);
    }

    console.log('\n\nRECOMMENDATIONS:');
    console.log('\n  Prefixes to add:');
    for (const rec of report.recommendations.prefixesToAdd.slice(0, 10)) {
      console.log(`    ${rec.prefix.padEnd(12)} → ${rec.suggestedSector.padEnd(25)} (${rec.patentCount} patents)`);
    }

    console.log('\n  Indexing code handling:');
    console.log(`    ${report.recommendations.indexingCodeHandling}`);

    // Save report
    const outputDir = path.join(process.cwd(), 'output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outputDir, `taxonomy-gaps-${timestamp}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`Full report saved to: ${outputPath}`);

  } catch (error) {
    console.error('Analysis failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
