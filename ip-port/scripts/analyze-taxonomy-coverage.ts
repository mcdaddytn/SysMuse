#!/usr/bin/env npx ts-node
/**
 * Comprehensive Taxonomy Coverage Analysis
 *
 * Analyzes the current CPC-based taxonomy against actual patent CPC codes to identify:
 * 1. Overall CPC coverage (how many patent CPCs are captured by taxonomy)
 * 2. Inventive CPC analysis (first-only vs. all inventive strategy comparison)
 * 3. Average CPC codes per patent (inventive vs. non-inventive)
 * 4. CPC codes on patents not present in taxonomy (gaps)
 * 5. Unclassified patents analysis (pre-CPC era check)
 * 6. Multiple taxonomy associations analysis
 *
 * Output: Detailed report saved to output/taxonomy-analysis-{timestamp}.json
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

interface TaxonomySector {
  name: string;
  displayName: string;
  superSector: string;
  cpcPrefixes: string[];
}

interface CpcCodeStats {
  code: string;
  patentCount: number;
  inventiveCount: number;
  additionalCount: number;
  matchedSectors: string[];
  isInTaxonomy: boolean;
  taxonomyMatchType: 'exact' | 'prefix' | 'none';
}

interface PatentCpcSummary {
  patentId: string;
  totalCpcCodes: number;
  inventiveCodes: number;
  additionalCodes: number;
  mappedToTaxonomy: number;
  unmappedCodes: string[];
  assignedSector: string | null;
  assignedSuperSector: string | null;
  couldMapToSectors: string[];  // All sectors any CPC could map to
  grantDate: string | null;
}

interface AnalysisReport {
  generatedAt: string;
  summary: {
    totalPatents: number;
    totalPatentsWithCpc: number;
    totalPatentsWithoutCpc: number;
    totalCpcCodes: number;
    uniqueCpcCodes: number;
    taxonomySectorCount: number;
    taxonomyCpcPrefixCount: number;
  };
  cpcCoverage: {
    cpcCodesInTaxonomy: number;
    cpcCodesNotInTaxonomy: number;
    coveragePercentage: number;
    patentsFullyCovered: number;
    patentsPartiallyCovered: number;
    patentsNotCovered: number;
  };
  inventiveAnalysis: {
    patentsWithInventiveCodes: number;
    avgInventiveCodesPerPatent: number;
    avgAdditionalCodesPerPatent: number;
    firstInventiveMatchesTaxonomy: number;
    otherInventiveMatchesTaxonomy: number;
    missedByFirstOnlyStrategy: number;
    missedByFirstOnlyStrategyPct: number;
  };
  sectorDistribution: Record<string, {
    patentCount: number;
    uniqueCpcCodes: number;
    avgCpcPerPatent: number;
  }>;
  unmappedCpcAnalysis: {
    totalUnmappedCodes: number;
    topUnmappedByFrequency: Array<{ code: string; count: number; level: string }>;
    unmappedByClass: Record<string, number>;
    potentialNewSectors: Array<{
      cpcPrefix: string;
      patentCount: number;
      description: string;
    }>;
  };
  unclassifiedPatents: {
    total: number;
    preCpcEra: number;  // Grant date before 2013 (CPC adoption)
    postCpcNoCodes: number;  // After 2013 but no CPC codes
    hasCpcButUnmapped: number;  // Has CPC codes but none match taxonomy
    byGrantYear: Record<string, number>;
    samplePatentIds: string[];
  };
  multipleAssociations: {
    patentsWithMultiplePotentialSectors: number;
    avgPotentialSectorsPerPatent: number;
    distribution: Record<string, number>;  // "1 sector": N, "2 sectors": M, etc.
  };
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Taxonomy Loader
// ═══════════════════════════════════════════════════════════════════════════

function loadTaxonomy(): Map<string, TaxonomySector> {
  const configPath = path.join(process.cwd(), 'config/sector-taxonomy-cpc-only.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  const sectors = new Map<string, TaxonomySector>();

  // Build sector to super-sector lookup
  const sectorToSuperSector = new Map<string, string>();
  for (const [ssKey, ssData] of Object.entries(config.superSectors) as [string, any][]) {
    for (const sectorName of ssData.sectors) {
      sectorToSuperSector.set(sectorName, ssKey);
    }
  }

  // Load sectors with their CPC prefixes
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

function findMatchingSectors(cpcCode: string, sectors: Map<string, TaxonomySector>): string[] {
  const normalized = cpcCode.replace(/\//g, '');
  const matches: string[] = [];

  for (const sector of sectors.values()) {
    for (const prefix of sector.cpcPrefixes) {
      const normalizedPrefix = prefix.replace('/', '');
      if (normalized.startsWith(normalizedPrefix)) {
        matches.push(sector.name);
        break;  // Only add each sector once per CPC
      }
    }
  }

  return matches;
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
// CPC Utilities
// ═══════════════════════════════════════════════════════════════════════════

function getCpcLevel(cpcCode: string): string {
  const normalized = cpcCode.replace(/\//g, '');
  if (normalized.length === 1) return 'SECTION';
  if (normalized.length <= 3) return 'CLASS';
  if (normalized.length === 4) return 'SUBCLASS';
  if (!normalized.includes('/') && normalized.length <= 7) return 'GROUP';
  return 'SUBGROUP';
}

function getCpcClass(cpcCode: string): string {
  // Extract the class (e.g., "H04L" from "H04L63/14")
  const match = cpcCode.match(/^([A-H]\d{2}[A-Z]?)/);
  return match ? match[1] : cpcCode.substring(0, 4);
}

function getCpcGroup(cpcCode: string): string {
  // Extract the group (e.g., "H04L63" from "H04L63/14")
  const normalized = cpcCode.replace(/\//g, '');
  const match = normalized.match(/^([A-H]\d{2}[A-Z]?\d+)/);
  return match ? match[1] : normalized.substring(0, 6);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Analysis
// ═══════════════════════════════════════════════════════════════════════════

async function runAnalysis(): Promise<AnalysisReport> {
  console.log('Starting comprehensive taxonomy coverage analysis...\n');

  const startTime = Date.now();

  // Load taxonomy
  console.log('Loading taxonomy configuration...');
  const sectors = loadTaxonomy();
  const taxonomyPrefixes = getAllTaxonomyPrefixes(sectors);
  console.log(`  Loaded ${sectors.size} sectors with ${taxonomyPrefixes.size} unique CPC prefixes\n`);

  // Load all patents with their CPC codes
  console.log('Loading patents with CPC codes from database...');
  const patents = await prisma.patent.findMany({
    select: {
      patentId: true,
      grantDate: true,
      primarySector: true,
      superSector: true,
      cpcCodes: {
        select: {
          cpcCode: true,
          isInventive: true,
        },
      },
    },
  });
  console.log(`  Loaded ${patents.length} patents\n`);

  // Initialize counters and accumulators
  const cpcCodeStats = new Map<string, CpcCodeStats>();
  const patentSummaries: PatentCpcSummary[] = [];
  const unclassifiedByYear = new Map<string, number>();
  const unmappedCpcByClass = new Map<string, number>();
  const potentialNewSectorCandidates = new Map<string, { count: number; patents: Set<string> }>();

  let totalCpcCodes = 0;
  let patsWithCpc = 0;
  let patsWithoutCpc = 0;
  let patsFullyCovered = 0;
  let patsPartiallyCovered = 0;
  let patsNotCovered = 0;
  let totalInventive = 0;
  let totalAdditional = 0;
  let firstInventiveMatches = 0;
  let otherInventiveMatches = 0;
  let missedByFirstOnly = 0;

  const sectorPatentCounts = new Map<string, Set<string>>();
  const sectorCpcCodes = new Map<string, Set<string>>();

  // Process each patent
  console.log('Analyzing patent CPC mappings...');
  let processedCount = 0;

  for (const patent of patents) {
    processedCount++;
    if (processedCount % 10000 === 0) {
      console.log(`  Processed ${processedCount}/${patents.length} patents...`);
    }

    const cpcCodes = patent.cpcCodes;
    totalCpcCodes += cpcCodes.length;

    if (cpcCodes.length === 0) {
      patsWithoutCpc++;

      // Track by grant year for pre-CPC analysis
      const year = patent.grantDate?.substring(0, 4) || 'unknown';
      unclassifiedByYear.set(year, (unclassifiedByYear.get(year) || 0) + 1);

      patentSummaries.push({
        patentId: patent.patentId,
        totalCpcCodes: 0,
        inventiveCodes: 0,
        additionalCodes: 0,
        mappedToTaxonomy: 0,
        unmappedCodes: [],
        assignedSector: patent.primarySector,
        assignedSuperSector: patent.superSector,
        couldMapToSectors: [],
        grantDate: patent.grantDate,
      });
      continue;
    }

    patsWithCpc++;

    // Categorize CPC codes
    const inventiveCodes = cpcCodes.filter(c => c.isInventive);
    const additionalCodes = cpcCodes.filter(c => !c.isInventive);
    totalInventive += inventiveCodes.length;
    totalAdditional += additionalCodes.length;

    // Check taxonomy coverage
    const allSectorsForPatent = new Set<string>();
    let mappedCount = 0;
    const unmappedForPatent: string[] = [];

    for (const cpc of cpcCodes) {
      const code = cpc.cpcCode;
      const isInTax = isCpcInTaxonomy(code, taxonomyPrefixes);
      const matchedSectors = findMatchingSectors(code, sectors);

      if (isInTax) {
        mappedCount++;
        for (const s of matchedSectors) {
          allSectorsForPatent.add(s);

          // Track sector stats
          if (!sectorPatentCounts.has(s)) sectorPatentCounts.set(s, new Set());
          sectorPatentCounts.get(s)!.add(patent.patentId);

          if (!sectorCpcCodes.has(s)) sectorCpcCodes.set(s, new Set());
          sectorCpcCodes.get(s)!.add(code);
        }
      } else {
        unmappedForPatent.push(code);

        // Track unmapped by CPC class
        const cpcClass = getCpcClass(code);
        unmappedCpcByClass.set(cpcClass, (unmappedCpcByClass.get(cpcClass) || 0) + 1);

        // Track as potential new sector candidate (at group level)
        const cpcGroup = getCpcGroup(code);
        if (!potentialNewSectorCandidates.has(cpcGroup)) {
          potentialNewSectorCandidates.set(cpcGroup, { count: 0, patents: new Set() });
        }
        const candidate = potentialNewSectorCandidates.get(cpcGroup)!;
        candidate.count++;
        candidate.patents.add(patent.patentId);
      }

      // Update CPC code stats
      if (!cpcCodeStats.has(code)) {
        cpcCodeStats.set(code, {
          code,
          patentCount: 0,
          inventiveCount: 0,
          additionalCount: 0,
          matchedSectors,
          isInTaxonomy: isInTax,
          taxonomyMatchType: isInTax ? (matchedSectors.length > 0 ? 'prefix' : 'exact') : 'none',
        });
      }
      const stats = cpcCodeStats.get(code)!;
      stats.patentCount++;
      if (cpc.isInventive) stats.inventiveCount++;
      else stats.additionalCount++;
    }

    // Coverage classification
    if (mappedCount === cpcCodes.length) {
      patsFullyCovered++;
    } else if (mappedCount > 0) {
      patsPartiallyCovered++;
    } else {
      patsNotCovered++;
    }

    // Inventive CPC analysis: first-only vs. all strategy
    if (inventiveCodes.length > 0) {
      const firstInventive = inventiveCodes[0].cpcCode;
      const firstMatches = isCpcInTaxonomy(firstInventive, taxonomyPrefixes);
      if (firstMatches) firstInventiveMatches++;

      // Check if any OTHER inventive code matches
      const otherInventive = inventiveCodes.slice(1);
      const anyOtherMatches = otherInventive.some(c => isCpcInTaxonomy(c.cpcCode, taxonomyPrefixes));
      if (anyOtherMatches) otherInventiveMatches++;

      // Would we miss a match by only using first?
      if (!firstMatches && anyOtherMatches) {
        missedByFirstOnly++;
      }
    }

    patentSummaries.push({
      patentId: patent.patentId,
      totalCpcCodes: cpcCodes.length,
      inventiveCodes: inventiveCodes.length,
      additionalCodes: additionalCodes.length,
      mappedToTaxonomy: mappedCount,
      unmappedCodes: unmappedForPatent,
      assignedSector: patent.primarySector,
      assignedSuperSector: patent.superSector,
      couldMapToSectors: Array.from(allSectorsForPatent),
      grantDate: patent.grantDate,
    });
  }

  console.log(`\nAnalysis complete. Generating report...\n`);

  // Calculate statistics
  const uniqueCpcCodes = cpcCodeStats.size;
  const cpcInTaxonomy = Array.from(cpcCodeStats.values()).filter(s => s.isInTaxonomy).length;
  const cpcNotInTaxonomy = uniqueCpcCodes - cpcInTaxonomy;

  // Sector distribution
  const sectorDistribution: Record<string, { patentCount: number; uniqueCpcCodes: number; avgCpcPerPatent: number }> = {};
  for (const [sectorName, patentSet] of sectorPatentCounts) {
    const cpcSet = sectorCpcCodes.get(sectorName) || new Set();
    sectorDistribution[sectorName] = {
      patentCount: patentSet.size,
      uniqueCpcCodes: cpcSet.size,
      avgCpcPerPatent: patentSet.size > 0 ? cpcSet.size / patentSet.size : 0,
    };
  }

  // Top unmapped CPC codes
  const unmappedCodes = Array.from(cpcCodeStats.values())
    .filter(s => !s.isInTaxonomy)
    .sort((a, b) => b.patentCount - a.patentCount)
    .slice(0, 50)
    .map(s => ({
      code: s.code,
      count: s.patentCount,
      level: getCpcLevel(s.code),
    }));

  // Potential new sectors (groups with high patent counts)
  const potentialNewSectors = Array.from(potentialNewSectorCandidates.entries())
    .map(([prefix, data]) => ({
      cpcPrefix: prefix,
      patentCount: data.patents.size,
      description: `${prefix} - ${data.patents.size} patents`,
    }))
    .sort((a, b) => b.patentCount - a.patentCount)
    .slice(0, 30);

  // Unclassified patents analysis
  const preCpcYear = 2013;  // CPC was adopted around 2013
  let preCpcCount = 0;
  let postCpcNoCodes = 0;
  let hasCpcUnmapped = 0;

  for (const summary of patentSummaries) {
    if (summary.totalCpcCodes === 0) {
      const year = parseInt(summary.grantDate?.substring(0, 4) || '0');
      if (year > 0 && year < preCpcYear) {
        preCpcCount++;
      } else {
        postCpcNoCodes++;
      }
    } else if (summary.mappedToTaxonomy === 0) {
      hasCpcUnmapped++;
    }
  }

  // Multiple association analysis
  const multiAssocDist: Record<string, number> = {};
  let patsWithMultiple = 0;
  let totalPotentialSectors = 0;

  for (const summary of patentSummaries) {
    const numSectors = summary.couldMapToSectors.length;
    const key = `${numSectors} sector${numSectors !== 1 ? 's' : ''}`;
    multiAssocDist[key] = (multiAssocDist[key] || 0) + 1;
    if (numSectors > 1) {
      patsWithMultiple++;
      totalPotentialSectors += numSectors;
    }
  }

  // Build report
  const report: AnalysisReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalPatents: patents.length,
      totalPatentsWithCpc: patsWithCpc,
      totalPatentsWithoutCpc: patsWithoutCpc,
      totalCpcCodes,
      uniqueCpcCodes,
      taxonomySectorCount: sectors.size,
      taxonomyCpcPrefixCount: taxonomyPrefixes.size,
    },
    cpcCoverage: {
      cpcCodesInTaxonomy: cpcInTaxonomy,
      cpcCodesNotInTaxonomy: cpcNotInTaxonomy,
      coveragePercentage: uniqueCpcCodes > 0 ? (cpcInTaxonomy / uniqueCpcCodes) * 100 : 0,
      patentsFullyCovered: patsFullyCovered,
      patentsPartiallyCovered: patsPartiallyCovered,
      patentsNotCovered: patsNotCovered,
    },
    inventiveAnalysis: {
      patentsWithInventiveCodes: patentSummaries.filter(p => p.inventiveCodes > 0).length,
      avgInventiveCodesPerPatent: patsWithCpc > 0 ? totalInventive / patsWithCpc : 0,
      avgAdditionalCodesPerPatent: patsWithCpc > 0 ? totalAdditional / patsWithCpc : 0,
      firstInventiveMatchesTaxonomy: firstInventiveMatches,
      otherInventiveMatchesTaxonomy: otherInventiveMatches,
      missedByFirstOnlyStrategy: missedByFirstOnly,
      missedByFirstOnlyStrategyPct: patsWithCpc > 0 ? (missedByFirstOnly / patsWithCpc) * 100 : 0,
    },
    sectorDistribution,
    unmappedCpcAnalysis: {
      totalUnmappedCodes: cpcNotInTaxonomy,
      topUnmappedByFrequency: unmappedCodes,
      unmappedByClass: Object.fromEntries(
        Array.from(unmappedCpcByClass.entries()).sort((a, b) => b[1] - a[1])
      ),
      potentialNewSectors,
    },
    unclassifiedPatents: {
      total: patsWithoutCpc + hasCpcUnmapped,
      preCpcEra: preCpcCount,
      postCpcNoCodes: postCpcNoCodes,
      hasCpcButUnmapped: hasCpcUnmapped,
      byGrantYear: Object.fromEntries(
        Array.from(unclassifiedByYear.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      ),
      samplePatentIds: patentSummaries
        .filter(p => p.totalCpcCodes === 0 || p.mappedToTaxonomy === 0)
        .slice(0, 20)
        .map(p => p.patentId),
    },
    multipleAssociations: {
      patentsWithMultiplePotentialSectors: patsWithMultiple,
      avgPotentialSectorsPerPatent: patsWithCpc > 0 ? totalPotentialSectors / patsWithCpc : 0,
      distribution: multiAssocDist,
    },
    recommendations: generateRecommendations(
      cpcInTaxonomy / uniqueCpcCodes,
      missedByFirstOnly / (patsWithCpc || 1),
      preCpcCount,
      potentialNewSectors,
      patsWithMultiple
    ),
  };

  const durationSec = (Date.now() - startTime) / 1000;
  console.log(`Analysis completed in ${durationSec.toFixed(1)} seconds\n`);

  return report;
}

function generateRecommendations(
  coverageRatio: number,
  missedByFirstOnlyRatio: number,
  preCpcCount: number,
  potentialNewSectors: Array<{ cpcPrefix: string; patentCount: number }>,
  multipleAssocCount: number
): string[] {
  const recs: string[] = [];

  if (coverageRatio < 0.9) {
    recs.push(`CPC coverage is ${(coverageRatio * 100).toFixed(1)}% - consider expanding taxonomy to cover more CPC prefixes`);
  } else if (coverageRatio >= 0.95) {
    recs.push(`Excellent CPC coverage at ${(coverageRatio * 100).toFixed(1)}% - taxonomy is comprehensive`);
  }

  if (missedByFirstOnlyRatio > 0.05) {
    recs.push(`${(missedByFirstOnlyRatio * 100).toFixed(1)}% of patents would benefit from multi-inventive-CPC strategy instead of first-only`);
  }

  if (preCpcCount > 100) {
    recs.push(`${preCpcCount} patents are pre-CPC era (before 2013) - consider IPC-based fallback classification`);
  }

  const highValueNewSectors = potentialNewSectors.filter(s => s.patentCount >= 50);
  if (highValueNewSectors.length > 0) {
    recs.push(`${highValueNewSectors.length} unmapped CPC groups have 50+ patents - evaluate for new sector creation`);
    recs.push(`Top candidates: ${highValueNewSectors.slice(0, 5).map(s => `${s.cpcPrefix} (${s.patentCount})`).join(', ')}`);
  }

  if (multipleAssocCount > 1000) {
    recs.push(`${multipleAssocCount} patents could map to multiple sectors - consider multi-sector assignment model`);
  }

  return recs;
}

// ═══════════════════════════════════════════════════════════════════════════
// Output
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    const report = await runAnalysis();

    // Print summary to console
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                 TAXONOMY COVERAGE ANALYSIS SUMMARY             ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('OVERALL SUMMARY:');
    console.log(`  Total patents:              ${report.summary.totalPatents.toLocaleString()}`);
    console.log(`  Patents with CPC codes:     ${report.summary.totalPatentsWithCpc.toLocaleString()}`);
    console.log(`  Patents without CPC codes:  ${report.summary.totalPatentsWithoutCpc.toLocaleString()}`);
    console.log(`  Unique CPC codes:           ${report.summary.uniqueCpcCodes.toLocaleString()}`);
    console.log(`  Taxonomy sectors:           ${report.summary.taxonomySectorCount}`);
    console.log(`  Taxonomy CPC prefixes:      ${report.summary.taxonomyCpcPrefixCount}`);

    console.log('\nCPC COVERAGE:');
    console.log(`  CPC codes in taxonomy:      ${report.cpcCoverage.cpcCodesInTaxonomy.toLocaleString()} (${report.cpcCoverage.coveragePercentage.toFixed(1)}%)`);
    console.log(`  CPC codes NOT in taxonomy:  ${report.cpcCoverage.cpcCodesNotInTaxonomy.toLocaleString()}`);
    console.log(`  Patents fully covered:      ${report.cpcCoverage.patentsFullyCovered.toLocaleString()}`);
    console.log(`  Patents partially covered:  ${report.cpcCoverage.patentsPartiallyCovered.toLocaleString()}`);
    console.log(`  Patents not covered:        ${report.cpcCoverage.patentsNotCovered.toLocaleString()}`);

    console.log('\nINVENTIVE CPC ANALYSIS:');
    console.log(`  Patents with inventive CPCs: ${report.inventiveAnalysis.patentsWithInventiveCodes.toLocaleString()}`);
    console.log(`  Avg inventive codes/patent:  ${report.inventiveAnalysis.avgInventiveCodesPerPatent.toFixed(2)}`);
    console.log(`  Avg additional codes/patent: ${report.inventiveAnalysis.avgAdditionalCodesPerPatent.toFixed(2)}`);
    console.log(`  First inventive matches:     ${report.inventiveAnalysis.firstInventiveMatchesTaxonomy.toLocaleString()}`);
    console.log(`  Missed by first-only:        ${report.inventiveAnalysis.missedByFirstOnlyStrategy.toLocaleString()} (${report.inventiveAnalysis.missedByFirstOnlyStrategyPct.toFixed(2)}%)`);

    console.log('\nUNCLASSIFIED PATENTS:');
    console.log(`  Total unclassified:          ${report.unclassifiedPatents.total.toLocaleString()}`);
    console.log(`  Pre-CPC era (before 2013):   ${report.unclassifiedPatents.preCpcEra.toLocaleString()}`);
    console.log(`  Post-CPC, no codes:          ${report.unclassifiedPatents.postCpcNoCodes.toLocaleString()}`);
    console.log(`  Has CPC but unmapped:        ${report.unclassifiedPatents.hasCpcButUnmapped.toLocaleString()}`);

    console.log('\nMULTIPLE SECTOR ASSOCIATIONS:');
    console.log(`  Patents with multiple potential sectors: ${report.multipleAssociations.patentsWithMultiplePotentialSectors.toLocaleString()}`);
    console.log(`  Avg potential sectors/patent: ${report.multipleAssociations.avgPotentialSectorsPerPatent.toFixed(2)}`);

    console.log('\nTOP 10 UNMAPPED CPC CODES (by patent count):');
    for (const item of report.unmappedCpcAnalysis.topUnmappedByFrequency.slice(0, 10)) {
      console.log(`  ${item.code.padEnd(15)} ${item.count.toString().padStart(6)} patents  (${item.level})`);
    }

    console.log('\nTOP 10 UNMAPPED CPC CLASSES:');
    const unmappedClasses = Object.entries(report.unmappedCpcAnalysis.unmappedByClass).slice(0, 10);
    for (const [cls, count] of unmappedClasses) {
      console.log(`  ${cls.padEnd(6)} ${count.toString().padStart(6)} occurrences`);
    }

    console.log('\nPOTENTIAL NEW SECTORS (unmapped CPC groups with 50+ patents):');
    const highValueSectors = report.unmappedCpcAnalysis.potentialNewSectors.filter(s => s.patentCount >= 50);
    for (const item of highValueSectors.slice(0, 10)) {
      console.log(`  ${item.cpcPrefix.padEnd(10)} ${item.patentCount.toString().padStart(5)} patents`);
    }

    console.log('\nRECOMMENDATIONS:');
    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`);
    }

    // Save full report
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outputDir, `taxonomy-analysis-${timestamp}.json`);
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
