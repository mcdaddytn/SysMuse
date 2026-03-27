#!/usr/bin/env npx ts-node
/**
 * Association Coverage Analysis
 *
 * Determines the optimal number of "privileged" classification associations
 * needed to capture the inventive nature of complex patents.
 *
 * Questions answered:
 * 1. Coverage curve: What % of inventive CPC meaning captured with N associations?
 * 2. Diminishing returns: Where is the elbow in the coverage curve?
 * 3. CPC co-occurrence: Which codes/sectors naturally cluster together?
 * 4. Sector affinity: Which taxonomy sectors frequently co-occur?
 * 5. Practical recommendation: How many privileged associations for our data?
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

interface CpcHierarchy {
  section: string;
  class: string;
  subclass: string;
  mainGroup: string;
  full: string;
}

interface PatentAssociations {
  patentId: string;
  v2Score: number | null;
  inventiveCpcs: string[];
  inventiveSectors: string[];        // Unique sectors from inventive CPCs
  inventiveSuperSectors: string[];   // Unique super-sectors
  sectorsByPriority: string[];       // Sectors ordered by CPC weight
  superSectorsByPriority: string[];
}

interface CoverageAtN {
  n: number;
  patentsCovered: number;
  pctPatentsCovered: number;
  avgSectorsCaptured: number;
  avgSuperSectorsCaptured: number;
  pctSectorsCaptured: number;
  pctSuperSectorsCaptured: number;
}

interface SectorCooccurrence {
  sector1: string;
  sector2: string;
  cooccurrenceCount: number;
  jaccardSimilarity: number;  // Intersection / Union
  pctOfSector1: number;       // % of sector1 patents that also have sector2
  pctOfSector2: number;
}

interface CpcGroupCluster {
  clusterName: string;
  cpcGroups: string[];        // CPC main groups in this cluster
  sectors: string[];          // Taxonomy sectors covered
  patentCount: number;
  avgCooccurrence: number;
}

interface AssociationReport {
  generatedAt: string;
  sample: {
    totalPatents: number;
    patentsWithMultipleSectors: number;
    avgSectorsPerPatent: number;
    avgSuperSectorsPerPatent: number;
    maxSectorsOnPatent: number;
    maxSuperSectorsOnPatent: number;
  };
  coverageCurve: {
    bySectors: CoverageAtN[];
    bySuperSectors: CoverageAtN[];
    recommendation: {
      optimalN: number;
      reasoning: string;
      coverageAtOptimal: number;
      marginalGainBeyond: number;
    };
  };
  sectorCooccurrence: {
    topPairs: SectorCooccurrence[];
    clusterGroups: Array<{
      superSector: string;
      internalCooccurrence: number;  // How often sectors in same super-sector co-occur
      externalCooccurrence: number;  // Cross-super-sector co-occurrence
    }>;
    suggestedMerges: Array<{
      sectors: string[];
      reason: string;
      patentOverlap: number;
    }>;
  };
  cpcClustering: {
    topCooccurringCpcGroups: Array<{
      cpc1: string;
      cpc2: string;
      count: number;
      sectors: string[];
    }>;
    suggestedClusters: CpcGroupCluster[];
  };
  distributionAnalysis: {
    sectorCountDistribution: Record<number, number>;
    superSectorCountDistribution: Record<number, number>;
    patentsNeedingNAssociations: Record<number, { count: number; pct: number }>;
  };
  designRecommendations: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CPC & Taxonomy Utilities
// ═══════════════════════════════════════════════════════════════════════════

function parseCpcHierarchy(code: string): CpcHierarchy {
  const normalized = code.replace(/\//g, '');
  const section = normalized.charAt(0);
  const classMatch = normalized.match(/^([A-HY]\d{2})/);
  const subclassMatch = normalized.match(/^([A-HY]\d{2}[A-Z])/);
  const mainGroupMatch = normalized.match(/^([A-HY]\d{2}[A-Z]?\d+)/);

  return {
    section,
    class: classMatch ? classMatch[1] : section,
    subclass: subclassMatch ? subclassMatch[1] : (classMatch ? classMatch[1] : section),
    mainGroup: mainGroupMatch ? mainGroupMatch[1] : (subclassMatch ? subclassMatch[1] : section),
    full: code,
  };
}

function isIndexingCode(code: string): boolean {
  if (code.startsWith('Y')) return true;
  const indexPattern = /^[A-H]\d{2}[A-Z]2\d{3}/;
  if (indexPattern.test(code)) return true;
  return false;
}

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

function mapCpcToSectors(cpcCode: string, taxonomy: Map<string, TaxonomySector>): string[] {
  if (isIndexingCode(cpcCode)) return [];

  const normalized = cpcCode.replace(/\//g, '');
  const matched: string[] = [];

  for (const sector of taxonomy.values()) {
    for (const prefix of sector.cpcPrefixes) {
      const normalizedPrefix = prefix.replace('/', '');
      if (normalized.startsWith(normalizedPrefix)) {
        matched.push(sector.name);
        break;
      }
    }
  }

  return matched;
}

function getSuperSector(sectorName: string, taxonomy: Map<string, TaxonomySector>): string | null {
  const sector = taxonomy.get(sectorName);
  return sector?.superSector || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Data Loading
// ═══════════════════════════════════════════════════════════════════════════

async function loadTopPatentsWithCpc(limit: number): Promise<Array<{
  patentId: string;
  v2Score: number | null;
  inventiveCpcs: string[];
  additionalCpcs: string[];
}>> {
  // Get active V2 snapshot
  const snapshot = await prisma.scoreSnapshot.findFirst({
    where: { isActive: true, scoreType: 'V2' },
    select: { id: true },
  });

  let patentIds: string[];
  let scoreMap = new Map<string, number>();

  if (snapshot) {
    const entries = await prisma.patentScoreEntry.findMany({
      where: { snapshotId: snapshot.id },
      select: { patentId: true, score: true },
      orderBy: { score: 'desc' },
      take: limit,
    });
    patentIds = entries.map(e => e.patentId);
    scoreMap = new Map(entries.map(e => [e.patentId, e.score]));
  } else {
    // Fallback to baseScore
    const patents = await prisma.patent.findMany({
      where: { baseScore: { not: null } },
      select: { patentId: true, baseScore: true },
      orderBy: { baseScore: 'desc' },
      take: limit,
    });
    patentIds = patents.map(p => p.patentId);
    scoreMap = new Map(patents.map(p => [p.patentId, p.baseScore || 0]));
  }

  // Get CPC codes for these patents
  const cpcData = await prisma.patentCpc.findMany({
    where: { patentId: { in: patentIds } },
    select: { patentId: true, cpcCode: true, isInventive: true },
  });

  // Group by patent
  const patentCpcMap = new Map<string, { inventive: string[]; additional: string[] }>();
  for (const patentId of patentIds) {
    patentCpcMap.set(patentId, { inventive: [], additional: [] });
  }
  for (const cpc of cpcData) {
    const entry = patentCpcMap.get(cpc.patentId);
    if (entry) {
      if (cpc.isInventive) {
        entry.inventive.push(cpc.cpcCode);
      } else {
        entry.additional.push(cpc.cpcCode);
      }
    }
  }

  return patentIds.map(patentId => ({
    patentId,
    v2Score: scoreMap.get(patentId) || null,
    inventiveCpcs: patentCpcMap.get(patentId)?.inventive || [],
    additionalCpcs: patentCpcMap.get(patentId)?.additional || [],
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// Analysis Functions
// ═══════════════════════════════════════════════════════════════════════════

function analyzePatentAssociations(
  patent: { patentId: string; v2Score: number | null; inventiveCpcs: string[] },
  taxonomy: Map<string, TaxonomySector>
): PatentAssociations {
  // Map each inventive CPC to sectors
  const sectorCounts = new Map<string, number>();
  const superSectorCounts = new Map<string, number>();

  for (const cpc of patent.inventiveCpcs) {
    const sectors = mapCpcToSectors(cpc, taxonomy);
    for (const sector of sectors) {
      sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
      const ss = getSuperSector(sector, taxonomy);
      if (ss) {
        superSectorCounts.set(ss, (superSectorCounts.get(ss) || 0) + 1);
      }
    }
  }

  // Sort by count (priority)
  const sectorsByPriority = Array.from(sectorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([s]) => s);

  const superSectorsByPriority = Array.from(superSectorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ss]) => ss);

  return {
    patentId: patent.patentId,
    v2Score: patent.v2Score,
    inventiveCpcs: patent.inventiveCpcs,
    inventiveSectors: sectorsByPriority,
    inventiveSuperSectors: superSectorsByPriority,
    sectorsByPriority,
    superSectorsByPriority,
  };
}

function calculateCoverageAtN(associations: PatentAssociations[], maxN: number): {
  bySectors: CoverageAtN[];
  bySuperSectors: CoverageAtN[];
} {
  const bySectors: CoverageAtN[] = [];
  const bySuperSectors: CoverageAtN[] = [];

  for (let n = 1; n <= maxN; n++) {
    // For sectors
    let totalSectorsCaptured = 0;
    let totalSectorsAvailable = 0;
    let patentsCovered = 0;

    for (const pa of associations) {
      const available = pa.inventiveSectors.length;
      const captured = Math.min(n, available);
      totalSectorsCaptured += captured;
      totalSectorsAvailable += available;
      if (captured > 0) patentsCovered++;
    }

    bySectors.push({
      n,
      patentsCovered,
      pctPatentsCovered: (patentsCovered / associations.length) * 100,
      avgSectorsCaptured: totalSectorsCaptured / associations.length,
      avgSuperSectorsCaptured: 0,  // Will fill below
      pctSectorsCaptured: totalSectorsAvailable > 0
        ? (totalSectorsCaptured / totalSectorsAvailable) * 100
        : 0,
      pctSuperSectorsCaptured: 0,
    });

    // For super-sectors
    let totalSuperSectorsCaptured = 0;
    let totalSuperSectorsAvailable = 0;

    for (const pa of associations) {
      const available = pa.inventiveSuperSectors.length;
      const captured = Math.min(n, available);
      totalSuperSectorsCaptured += captured;
      totalSuperSectorsAvailable += available;
    }

    bySuperSectors.push({
      n,
      patentsCovered,
      pctPatentsCovered: (patentsCovered / associations.length) * 100,
      avgSectorsCaptured: 0,
      avgSuperSectorsCaptured: totalSuperSectorsCaptured / associations.length,
      pctSectorsCaptured: 0,
      pctSuperSectorsCaptured: totalSuperSectorsAvailable > 0
        ? (totalSuperSectorsCaptured / totalSuperSectorsAvailable) * 100
        : 0,
    });
  }

  return { bySectors, bySuperSectors };
}

function analyzeSectorCooccurrence(
  associations: PatentAssociations[]
): SectorCooccurrence[] {
  // Count patents per sector
  const sectorPatents = new Map<string, Set<string>>();

  for (const pa of associations) {
    for (const sector of pa.inventiveSectors) {
      if (!sectorPatents.has(sector)) {
        sectorPatents.set(sector, new Set());
      }
      sectorPatents.get(sector)!.add(pa.patentId);
    }
  }

  // Calculate co-occurrence for each pair
  const cooccurrences: SectorCooccurrence[] = [];
  const sectors = Array.from(sectorPatents.keys());

  for (let i = 0; i < sectors.length; i++) {
    for (let j = i + 1; j < sectors.length; j++) {
      const s1 = sectors[i];
      const s2 = sectors[j];
      const patents1 = sectorPatents.get(s1)!;
      const patents2 = sectorPatents.get(s2)!;

      // Intersection
      const intersection = new Set([...patents1].filter(p => patents2.has(p)));
      if (intersection.size === 0) continue;

      // Union
      const union = new Set([...patents1, ...patents2]);

      cooccurrences.push({
        sector1: s1,
        sector2: s2,
        cooccurrenceCount: intersection.size,
        jaccardSimilarity: intersection.size / union.size,
        pctOfSector1: (intersection.size / patents1.size) * 100,
        pctOfSector2: (intersection.size / patents2.size) * 100,
      });
    }
  }

  return cooccurrences.sort((a, b) => b.cooccurrenceCount - a.cooccurrenceCount);
}

function analyzeCpcGroupCooccurrence(
  patents: Array<{ inventiveCpcs: string[] }>
): Array<{ cpc1: string; cpc2: string; count: number }> {
  // Extract main groups from CPCs
  const patentGroups: string[][] = patents.map(p => {
    const groups = new Set<string>();
    for (const cpc of p.inventiveCpcs) {
      if (!isIndexingCode(cpc)) {
        const hierarchy = parseCpcHierarchy(cpc);
        groups.add(hierarchy.mainGroup);
      }
    }
    return Array.from(groups);
  });

  // Count co-occurrences
  const cooccurrences = new Map<string, number>();

  for (const groups of patentGroups) {
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const key = [groups[i], groups[j]].sort().join('|');
        cooccurrences.set(key, (cooccurrences.get(key) || 0) + 1);
      }
    }
  }

  return Array.from(cooccurrences.entries())
    .map(([key, count]) => {
      const [cpc1, cpc2] = key.split('|');
      return { cpc1, cpc2, count };
    })
    .filter(c => c.count >= 5)  // Minimum threshold
    .sort((a, b) => b.count - a.count);
}

function findOptimalN(coverageCurve: CoverageAtN[]): {
  optimalN: number;
  reasoning: string;
  coverageAtOptimal: number;
  marginalGainBeyond: number;
} {
  // Find the "elbow" - where marginal gain drops significantly
  const marginalGains: number[] = [];
  for (let i = 1; i < coverageCurve.length; i++) {
    marginalGains.push(
      coverageCurve[i].pctSectorsCaptured - coverageCurve[i-1].pctSectorsCaptured
    );
  }

  // Find where marginal gain drops below threshold (e.g., 5%)
  let optimalN = 1;
  for (let i = 0; i < marginalGains.length; i++) {
    if (marginalGains[i] >= 5) {
      optimalN = i + 2;  // +2 because marginalGains[0] is gain from 1→2
    }
  }

  // Also check for 90% coverage threshold
  for (let i = 0; i < coverageCurve.length; i++) {
    if (coverageCurve[i].pctSectorsCaptured >= 90) {
      optimalN = Math.max(optimalN, coverageCurve[i].n);
      break;
    }
  }

  const coverageAtOptimal = coverageCurve[optimalN - 1]?.pctSectorsCaptured || 0;
  const marginalGainBeyond = optimalN < coverageCurve.length
    ? coverageCurve[optimalN].pctSectorsCaptured - coverageAtOptimal
    : 0;

  const reasoning = `At N=${optimalN}, we capture ${coverageAtOptimal.toFixed(1)}% of sector associations. ` +
    `Adding one more association only gains ${marginalGainBeyond.toFixed(1)}% more coverage.`;

  return { optimalN, reasoning, coverageAtOptimal, marginalGainBeyond };
}

function suggestSectorMerges(
  cooccurrences: SectorCooccurrence[],
  taxonomy: Map<string, TaxonomySector>
): Array<{ sectors: string[]; reason: string; patentOverlap: number }> {
  const suggestions: Array<{ sectors: string[]; reason: string; patentOverlap: number }> = [];

  // Find high-overlap pairs (>40% of smaller sector)
  for (const co of cooccurrences.slice(0, 50)) {
    const minOverlap = Math.min(co.pctOfSector1, co.pctOfSector2);
    if (minOverlap >= 40) {
      const s1SS = getSuperSector(co.sector1, taxonomy);
      const s2SS = getSuperSector(co.sector2, taxonomy);
      const sameSuperSector = s1SS === s2SS;

      suggestions.push({
        sectors: [co.sector1, co.sector2],
        reason: sameSuperSector
          ? `Same super-sector (${s1SS}), ${minOverlap.toFixed(0)}% overlap`
          : `Cross super-sector (${s1SS}↔${s2SS}), ${minOverlap.toFixed(0)}% overlap`,
        patentOverlap: co.cooccurrenceCount,
      });
    }
  }

  return suggestions.slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Analysis
// ═══════════════════════════════════════════════════════════════════════════

async function runAnalysis(): Promise<AssociationReport> {
  console.log('Starting association coverage analysis...\n');

  const taxonomy = loadTaxonomy();
  console.log(`Loaded ${taxonomy.size} taxonomy sectors\n`);

  // Load top patents
  const TOP_N = 2000;  // Larger sample for statistical significance
  console.log(`Loading top ${TOP_N} patents by V2 score...`);
  const patents = await loadTopPatentsWithCpc(TOP_N);
  console.log(`  Loaded ${patents.length} patents\n`);

  // Analyze associations for each patent
  console.log('Analyzing patent associations...');
  const associations = patents.map(p => analyzePatentAssociations(p, taxonomy));

  // Calculate basic stats
  const withMultipleSectors = associations.filter(a => a.inventiveSectors.length > 1);
  const maxSectors = Math.max(...associations.map(a => a.inventiveSectors.length));
  const maxSuperSectors = Math.max(...associations.map(a => a.inventiveSuperSectors.length));
  const avgSectors = associations.reduce((s, a) => s + a.inventiveSectors.length, 0) / associations.length;
  const avgSuperSectors = associations.reduce((s, a) => s + a.inventiveSuperSectors.length, 0) / associations.length;

  // Calculate coverage curves
  console.log('Calculating coverage curves...');
  const coverage = calculateCoverageAtN(associations, 6);
  const optimalResult = findOptimalN(coverage.bySectors);

  // Sector co-occurrence
  console.log('Analyzing sector co-occurrence...');
  const sectorCooccurrences = analyzeSectorCooccurrence(associations);
  const suggestedMerges = suggestSectorMerges(sectorCooccurrences, taxonomy);

  // Analyze internal vs external co-occurrence per super-sector
  const superSectorCooccurrence: Array<{
    superSector: string;
    internalCooccurrence: number;
    externalCooccurrence: number;
  }> = [];

  const superSectors = new Set<string>();
  for (const sector of taxonomy.values()) {
    if (sector.superSector !== 'UNCLASSIFIED') {
      superSectors.add(sector.superSector);
    }
  }

  for (const ss of superSectors) {
    const sectorsInSS = Array.from(taxonomy.values())
      .filter(s => s.superSector === ss)
      .map(s => s.name);
    const sectorsSet = new Set(sectorsInSS);

    let internalCount = 0;
    let externalCount = 0;

    for (const co of sectorCooccurrences) {
      const s1InSS = sectorsSet.has(co.sector1);
      const s2InSS = sectorsSet.has(co.sector2);

      if (s1InSS && s2InSS) {
        internalCount += co.cooccurrenceCount;
      } else if (s1InSS || s2InSS) {
        externalCount += co.cooccurrenceCount;
      }
    }

    superSectorCooccurrence.push({
      superSector: ss,
      internalCooccurrence: internalCount,
      externalCooccurrence: externalCount,
    });
  }

  // CPC group co-occurrence
  console.log('Analyzing CPC group co-occurrence...');
  const cpcCooccurrences = analyzeCpcGroupCooccurrence(patents);

  // Map CPC groups to sectors for context
  const topCpcCooccurrences = cpcCooccurrences.slice(0, 30).map(co => {
    const sectors1 = mapCpcToSectors(co.cpc1, taxonomy);
    const sectors2 = mapCpcToSectors(co.cpc2, taxonomy);
    return {
      ...co,
      sectors: Array.from(new Set([...sectors1, ...sectors2])),
    };
  });

  // Distribution analysis
  const sectorCountDist: Record<number, number> = {};
  const superSectorCountDist: Record<number, number> = {};

  for (const a of associations) {
    const sc = a.inventiveSectors.length;
    const ssc = a.inventiveSuperSectors.length;
    sectorCountDist[sc] = (sectorCountDist[sc] || 0) + 1;
    superSectorCountDist[ssc] = (superSectorCountDist[ssc] || 0) + 1;
  }

  // Patents needing N associations
  const needingN: Record<number, { count: number; pct: number }> = {};
  for (let n = 1; n <= 6; n++) {
    const count = associations.filter(a => a.inventiveSectors.length >= n).length;
    needingN[n] = { count, pct: (count / associations.length) * 100 };
  }

  // Generate recommendations
  const recommendations: string[] = [];

  if (optimalResult.optimalN >= 3) {
    recommendations.push(
      `Recommend ${optimalResult.optimalN} privileged associations: captures ${optimalResult.coverageAtOptimal.toFixed(1)}% of sector coverage`
    );
  } else {
    recommendations.push(
      `Even with just 2 associations, coverage is ${coverage.bySectors[1].pctSectorsCaptured.toFixed(1)}% - 3 associations recommended for cross-domain patents`
    );
  }

  const highOverlapMerges = suggestedMerges.filter(m => m.patentOverlap >= 50);
  if (highOverlapMerges.length > 0) {
    recommendations.push(
      `Consider clustering these high-overlap sector pairs: ${highOverlapMerges.map(m => m.sectors.join('+')).join(', ')}`
    );
  }

  const crossSuperSectorPct = associations.filter(a => a.inventiveSuperSectors.length > 1).length / associations.length * 100;
  if (crossSuperSectorPct > 30) {
    recommendations.push(
      `${crossSuperSectorPct.toFixed(0)}% of patents span super-sectors - consider cross-domain query support`
    );
  }

  // Build report
  const report: AssociationReport = {
    generatedAt: new Date().toISOString(),
    sample: {
      totalPatents: associations.length,
      patentsWithMultipleSectors: withMultipleSectors.length,
      avgSectorsPerPatent: avgSectors,
      avgSuperSectorsPerPatent: avgSuperSectors,
      maxSectorsOnPatent: maxSectors,
      maxSuperSectorsOnPatent: maxSuperSectors,
    },
    coverageCurve: {
      bySectors: coverage.bySectors,
      bySuperSectors: coverage.bySuperSectors,
      recommendation: optimalResult,
    },
    sectorCooccurrence: {
      topPairs: sectorCooccurrences.slice(0, 30),
      clusterGroups: superSectorCooccurrence,
      suggestedMerges,
    },
    cpcClustering: {
      topCooccurringCpcGroups: topCpcCooccurrences,
      suggestedClusters: [],  // Would need more sophisticated clustering
    },
    distributionAnalysis: {
      sectorCountDistribution: sectorCountDist,
      superSectorCountDistribution: superSectorCountDist,
      patentsNeedingNAssociations: needingN,
    },
    designRecommendations: recommendations,
  };

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    const report = await runAnalysis();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('           ASSOCIATION COVERAGE ANALYSIS                        ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('SAMPLE STATISTICS:');
    console.log(`  Total patents analyzed: ${report.sample.totalPatents}`);
    console.log(`  Patents with multiple sectors: ${report.sample.patentsWithMultipleSectors} (${(report.sample.patentsWithMultipleSectors / report.sample.totalPatents * 100).toFixed(1)}%)`);
    console.log(`  Avg sectors per patent: ${report.sample.avgSectorsPerPatent.toFixed(2)}`);
    console.log(`  Avg super-sectors per patent: ${report.sample.avgSuperSectorsPerPatent.toFixed(2)}`);
    console.log(`  Max sectors on any patent: ${report.sample.maxSectorsOnPatent}`);
    console.log(`  Max super-sectors on any patent: ${report.sample.maxSuperSectorsOnPatent}`);

    console.log('\n\nCOVERAGE CURVE - SECTORS:');
    console.log('  N associations  |  % Sectors Captured  |  Marginal Gain');
    console.log('  ─────────────────────────────────────────────────────────');
    for (let i = 0; i < report.coverageCurve.bySectors.length; i++) {
      const c = report.coverageCurve.bySectors[i];
      const marginal = i > 0
        ? (c.pctSectorsCaptured - report.coverageCurve.bySectors[i-1].pctSectorsCaptured).toFixed(1)
        : '-';
      console.log(`        ${c.n}         |       ${c.pctSectorsCaptured.toFixed(1).padStart(5)}%        |     ${marginal.toString().padStart(5)}%`);
    }

    console.log('\n\nCOVERAGE CURVE - SUPER-SECTORS:');
    console.log('  N associations  |  % Super-Sectors Captured  |  Marginal Gain');
    console.log('  ─────────────────────────────────────────────────────────────');
    for (let i = 0; i < report.coverageCurve.bySuperSectors.length; i++) {
      const c = report.coverageCurve.bySuperSectors[i];
      const marginal = i > 0
        ? (c.pctSuperSectorsCaptured - report.coverageCurve.bySuperSectors[i-1].pctSuperSectorsCaptured).toFixed(1)
        : '-';
      console.log(`        ${c.n}         |          ${c.pctSuperSectorsCaptured.toFixed(1).padStart(5)}%           |     ${marginal.toString().padStart(5)}%`);
    }

    console.log('\n\nOPTIMAL N RECOMMENDATION:');
    console.log(`  ${report.coverageCurve.recommendation.reasoning}`);

    console.log('\n\nDISTRIBUTION - How many sectors do patents need?');
    console.log('  Sectors  |  Patents  |  Cumulative %');
    console.log('  ───────────────────────────────────────');
    let cumulative = 0;
    for (let n = 0; n <= report.sample.maxSectorsOnPatent; n++) {
      const count = report.distributionAnalysis.sectorCountDistribution[n] || 0;
      cumulative += count;
      const pct = (cumulative / report.sample.totalPatents * 100).toFixed(1);
      console.log(`     ${n}     |   ${count.toString().padStart(5)}   |    ${pct.padStart(5)}%`);
    }

    console.log('\n\nPATENTS NEEDING N+ ASSOCIATIONS:');
    for (const [n, data] of Object.entries(report.distributionAnalysis.patentsNeedingNAssociations)) {
      console.log(`  Need ${n}+ associations: ${data.count} patents (${data.pct.toFixed(1)}%)`);
    }

    console.log('\n\nTOP SECTOR CO-OCCURRENCE PAIRS:');
    for (const co of report.sectorCooccurrence.topPairs.slice(0, 15)) {
      console.log(`  ${co.sector1.padEnd(25)} ↔ ${co.sector2.padEnd(25)} : ${co.cooccurrenceCount.toString().padStart(4)} patents (J=${co.jaccardSimilarity.toFixed(2)})`);
    }

    console.log('\n\nSUGGESTED SECTOR MERGES (high overlap):');
    for (const merge of report.sectorCooccurrence.suggestedMerges) {
      console.log(`  ${merge.sectors.join(' + ')}`);
      console.log(`    Reason: ${merge.reason}`);
      console.log(`    Overlap: ${merge.patentOverlap} patents`);
    }

    console.log('\n\nTOP CPC GROUP CO-OCCURRENCES:');
    for (const co of report.cpcClustering.topCooccurringCpcGroups.slice(0, 15)) {
      console.log(`  ${co.cpc1.padEnd(10)} ↔ ${co.cpc2.padEnd(10)} : ${co.count.toString().padStart(4)} patents → [${co.sectors.slice(0, 3).join(', ')}]`);
    }

    console.log('\n\nDESIGN RECOMMENDATIONS:');
    for (const rec of report.designRecommendations) {
      console.log(`  → ${rec}`);
    }

    // Save report
    const outputDir = path.join(process.cwd(), 'output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outputDir, `association-coverage-${timestamp}.json`);
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
