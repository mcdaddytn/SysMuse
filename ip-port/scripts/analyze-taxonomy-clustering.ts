#!/usr/bin/env npx ts-node
/**
 * Taxonomy Clustering Analysis
 *
 * Analyzes how current taxonomy sectors cluster together based on
 * actual patent co-occurrence, and suggests pragmatic restructuring
 * that could reduce multi-association needs while preserving meaning.
 *
 * Questions:
 * 1. Which sectors form natural clusters (high co-occurrence)?
 * 2. If we merged high-overlap sectors, how many associations would we need?
 * 3. What's the trade-off between fewer clusters vs. lost granularity?
 * 4. What would a "3-level optimized" taxonomy look like?
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

interface SectorStats {
  name: string;
  superSector: string;
  patentCount: number;
  avgCooccurrenceWithin: number;  // With other sectors in same super-sector
  avgCooccurrenceAcross: number;  // With sectors in different super-sectors
  topCooccurrences: Array<{ sector: string; count: number; jaccard: number }>;
}

interface ClusterProposal {
  clusterId: string;
  clusterName: string;
  sectors: string[];
  combinedPatentCount: number;
  internalOverlap: number;       // Avg Jaccard within cluster
  rationale: string;
}

interface RestructuredTaxonomy {
  level1: {
    name: string;
    clusters: Array<{
      name: string;
      sectors: string[];
    }>;
  }[];
  estimatedAssociationsNeeded: {
    n: number;
    coveragePct: number;
  }[];
}

interface ClusteringReport {
  generatedAt: string;
  currentState: {
    superSectorCount: number;
    sectorCount: number;
    avgSectorsPerPatent: number;
    coverageWith3: number;
  };
  sectorStats: SectorStats[];
  clusterProposals: ClusterProposal[];
  restructuredTaxonomy: RestructuredTaxonomy;
  impactAnalysis: {
    currentAssociationsNeededFor90Pct: number;
    proposedAssociationsNeededFor90Pct: number;
    sectorsLostToMerging: number;
    granularityRetained: string;
  };
  recommendations: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Utilities (reused from other scripts)
// ═══════════════════════════════════════════════════════════════════════════

function isIndexingCode(code: string): boolean {
  if (code.startsWith('Y')) return true;
  const indexPattern = /^[A-H]\d{2}[A-Z]2\d{3}/;
  return indexPattern.test(code);
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

// ═══════════════════════════════════════════════════════════════════════════
// Analysis Functions
// ═══════════════════════════════════════════════════════════════════════════

async function loadPatentSectorAssociations(
  taxonomy: Map<string, TaxonomySector>,
  limit: number
): Promise<Map<string, Set<string>>> {
  // Get top patents by score
  const snapshot = await prisma.scoreSnapshot.findFirst({
    where: { isActive: true, scoreType: 'V2' },
    select: { id: true },
  });

  let patentIds: string[];
  if (snapshot) {
    const entries = await prisma.patentScoreEntry.findMany({
      where: { snapshotId: snapshot.id },
      select: { patentId: true },
      orderBy: { score: 'desc' },
      take: limit,
    });
    patentIds = entries.map(e => e.patentId);
  } else {
    const patents = await prisma.patent.findMany({
      where: { baseScore: { not: null } },
      select: { patentId: true },
      orderBy: { baseScore: 'desc' },
      take: limit,
    });
    patentIds = patents.map(p => p.patentId);
  }

  // Get CPC codes for these patents
  const cpcData = await prisma.patentCpc.findMany({
    where: {
      patentId: { in: patentIds },
      isInventive: true,
    },
    select: { patentId: true, cpcCode: true },
  });

  // Map patents to sectors
  const patentSectors = new Map<string, Set<string>>();
  for (const patentId of patentIds) {
    patentSectors.set(patentId, new Set());
  }

  for (const cpc of cpcData) {
    const sectors = mapCpcToSectors(cpc.cpcCode, taxonomy);
    const patentSet = patentSectors.get(cpc.patentId);
    if (patentSet) {
      for (const sector of sectors) {
        patentSet.add(sector);
      }
    }
  }

  return patentSectors;
}

function calculateSectorCooccurrence(
  patentSectors: Map<string, Set<string>>,
  taxonomy: Map<string, TaxonomySector>
): Map<string, Map<string, { count: number; jaccard: number }>> {
  // Count patents per sector
  const sectorPatentSets = new Map<string, Set<string>>();
  for (const sector of taxonomy.keys()) {
    sectorPatentSets.set(sector, new Set());
  }

  for (const [patentId, sectors] of patentSectors) {
    for (const sector of sectors) {
      sectorPatentSets.get(sector)?.add(patentId);
    }
  }

  // Calculate co-occurrence matrix
  const cooccurrence = new Map<string, Map<string, { count: number; jaccard: number }>>();
  const sectorNames = Array.from(taxonomy.keys());

  for (const s1 of sectorNames) {
    cooccurrence.set(s1, new Map());
    const patents1 = sectorPatentSets.get(s1) || new Set();

    for (const s2 of sectorNames) {
      if (s1 === s2) continue;
      const patents2 = sectorPatentSets.get(s2) || new Set();

      const intersection = new Set([...patents1].filter(p => patents2.has(p)));
      const union = new Set([...patents1, ...patents2]);

      cooccurrence.get(s1)!.set(s2, {
        count: intersection.size,
        jaccard: union.size > 0 ? intersection.size / union.size : 0,
      });
    }
  }

  return cooccurrence;
}

function proposeClusters(
  cooccurrence: Map<string, Map<string, { count: number; jaccard: number }>>,
  taxonomy: Map<string, TaxonomySector>,
  patentSectors: Map<string, Set<string>>
): ClusterProposal[] {
  const proposals: ClusterProposal[] = [];
  const alreadyClustered = new Set<string>();

  // Count patents per sector
  const sectorPatentCount = new Map<string, number>();
  for (const sector of taxonomy.keys()) {
    sectorPatentCount.set(sector, 0);
  }
  for (const sectors of patentSectors.values()) {
    for (const sector of sectors) {
      sectorPatentCount.set(sector, (sectorPatentCount.get(sector) || 0) + 1);
    }
  }

  // Find high-affinity pairs (Jaccard > 0.25 or count > 30)
  const pairs: Array<{ s1: string; s2: string; count: number; jaccard: number }> = [];
  for (const [s1, inner] of cooccurrence) {
    for (const [s2, data] of inner) {
      if (s1 < s2 && (data.jaccard > 0.25 || data.count >= 30)) {
        pairs.push({ s1, s2, count: data.count, jaccard: data.jaccard });
      }
    }
  }
  pairs.sort((a, b) => b.jaccard - a.jaccard);

  // Greedily form clusters
  for (const pair of pairs) {
    if (alreadyClustered.has(pair.s1) || alreadyClustered.has(pair.s2)) continue;

    const ss1 = taxonomy.get(pair.s1)?.superSector;
    const ss2 = taxonomy.get(pair.s2)?.superSector;
    const sameSuperSector = ss1 === ss2;

    // Try to expand cluster with other high-affinity sectors
    const clusterSectors = [pair.s1, pair.s2];
    for (const [s3] of taxonomy) {
      if (alreadyClustered.has(s3) || clusterSectors.includes(s3)) continue;

      // Check affinity with all current cluster members
      let minJaccard = 1;
      for (const cs of clusterSectors) {
        const aff = cooccurrence.get(cs)?.get(s3)?.jaccard || 0;
        minJaccard = Math.min(minJaccard, aff);
      }

      if (minJaccard >= 0.15) {
        clusterSectors.push(s3);
      }
    }

    if (clusterSectors.length >= 2) {
      for (const s of clusterSectors) {
        alreadyClustered.add(s);
      }

      const combinedCount = Math.max(...clusterSectors.map(s => sectorPatentCount.get(s) || 0));

      proposals.push({
        clusterId: `cluster-${proposals.length + 1}`,
        clusterName: generateClusterName(clusterSectors, taxonomy),
        sectors: clusterSectors,
        combinedPatentCount: combinedCount,
        internalOverlap: pair.jaccard,
        rationale: sameSuperSector
          ? `Same super-sector (${ss1}), high co-occurrence`
          : `Cross super-sector (${ss1}↔${ss2}), frequent co-occurrence`,
      });
    }
  }

  return proposals;
}

function generateClusterName(sectors: string[], taxonomy: Map<string, TaxonomySector>): string {
  // Use most common super-sector as base
  const ssCounts = new Map<string, number>();
  for (const s of sectors) {
    const ss = taxonomy.get(s)?.superSector || 'UNCLASSIFIED';
    ssCounts.set(ss, (ssCounts.get(ss) || 0) + 1);
  }
  const primarySS = Array.from(ssCounts.entries())
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'MIXED';

  // Combine short names
  const shortNames = sectors.slice(0, 2).map(s => {
    const parts = s.split('-');
    return parts[0];
  });

  return `${primarySS.toLowerCase()}-${shortNames.join('-')}`;
}

function simulateClusteredCoverage(
  patentSectors: Map<string, Set<string>>,
  clusters: ClusterProposal[],
  taxonomy: Map<string, TaxonomySector>
): { n: number; coveragePct: number }[] {
  // Build cluster membership map
  const sectorToCluster = new Map<string, string>();
  for (const cluster of clusters) {
    for (const sector of cluster.sectors) {
      sectorToCluster.set(sector, cluster.clusterId);
    }
  }

  // For each patent, determine cluster associations
  const patentClusters: Array<{ patentId: string; clusters: string[] }> = [];

  for (const [patentId, sectors] of patentSectors) {
    const clusterSet = new Set<string>();
    for (const sector of sectors) {
      const clusterId = sectorToCluster.get(sector);
      if (clusterId) {
        clusterSet.add(clusterId);
      } else {
        // Unclustered sector becomes its own "cluster"
        clusterSet.add(`single-${sector}`);
      }
    }
    patentClusters.push({ patentId, clusters: Array.from(clusterSet) });
  }

  // Calculate coverage at each N
  const coverage: { n: number; coveragePct: number }[] = [];
  for (let n = 1; n <= 5; n++) {
    let totalClusters = 0;
    let capturedClusters = 0;

    for (const pc of patentClusters) {
      totalClusters += pc.clusters.length;
      capturedClusters += Math.min(n, pc.clusters.length);
    }

    coverage.push({
      n,
      coveragePct: totalClusters > 0 ? (capturedClusters / totalClusters) * 100 : 0,
    });
  }

  return coverage;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function runAnalysis(): Promise<ClusteringReport> {
  console.log('Starting taxonomy clustering analysis...\n');

  const taxonomy = loadTaxonomy();
  console.log(`Loaded ${taxonomy.size} sectors\n`);

  // Load patent-sector associations
  console.log('Loading patent sector associations...');
  const patentSectors = await loadPatentSectorAssociations(taxonomy, 2000);
  console.log(`  Loaded ${patentSectors.size} patents\n`);

  // Calculate stats
  let totalSectors = 0;
  const sectorCounts: number[] = [];
  for (const sectors of patentSectors.values()) {
    totalSectors += sectors.size;
    sectorCounts.push(sectors.size);
  }
  const avgSectorsPerPatent = totalSectors / patentSectors.size;

  // Calculate co-occurrence
  console.log('Calculating sector co-occurrence...');
  const cooccurrence = calculateSectorCooccurrence(patentSectors, taxonomy);

  // Build sector stats
  const sectorStats: SectorStats[] = [];
  const superSectors = new Set(Array.from(taxonomy.values()).map(s => s.superSector));

  for (const [sectorName, sectorData] of taxonomy) {
    const inner = cooccurrence.get(sectorName);
    if (!inner) continue;

    let withinSum = 0, withinCount = 0;
    let acrossSum = 0, acrossCount = 0;
    const topCooccurrences: Array<{ sector: string; count: number; jaccard: number }> = [];

    for (const [otherSector, data] of inner) {
      const otherSS = taxonomy.get(otherSector)?.superSector;
      if (otherSS === sectorData.superSector) {
        withinSum += data.jaccard;
        withinCount++;
      } else {
        acrossSum += data.jaccard;
        acrossCount++;
      }
      if (data.count > 0) {
        topCooccurrences.push({ sector: otherSector, count: data.count, jaccard: data.jaccard });
      }
    }

    topCooccurrences.sort((a, b) => b.jaccard - a.jaccard);

    let patentCount = 0;
    for (const sectors of patentSectors.values()) {
      if (sectors.has(sectorName)) patentCount++;
    }

    sectorStats.push({
      name: sectorName,
      superSector: sectorData.superSector,
      patentCount,
      avgCooccurrenceWithin: withinCount > 0 ? withinSum / withinCount : 0,
      avgCooccurrenceAcross: acrossCount > 0 ? acrossSum / acrossCount : 0,
      topCooccurrences: topCooccurrences.slice(0, 5),
    });
  }

  // Propose clusters
  console.log('Proposing clusters...');
  const clusterProposals = proposeClusters(cooccurrence, taxonomy, patentSectors);

  // Simulate coverage with clusters
  console.log('Simulating clustered coverage...');
  const clusteredCoverage = simulateClusteredCoverage(patentSectors, clusterProposals, taxonomy);

  // Build restructured taxonomy view
  const restructuredTaxonomy: RestructuredTaxonomy = {
    level1: [],
    estimatedAssociationsNeeded: clusteredCoverage,
  };

  // Group clusters by super-sector
  for (const ss of superSectors) {
    const ssClusters = clusterProposals.filter(c => {
      const primarySS = taxonomy.get(c.sectors[0])?.superSector;
      return primarySS === ss;
    });

    // Add unclustered sectors
    const clusteredSectors = new Set(clusterProposals.flatMap(c => c.sectors));
    const unclusteredInSS = Array.from(taxonomy.entries())
      .filter(([name, data]) => data.superSector === ss && !clusteredSectors.has(name))
      .map(([name]) => name);

    if (ssClusters.length > 0 || unclusteredInSS.length > 0) {
      restructuredTaxonomy.level1.push({
        name: ss,
        clusters: [
          ...ssClusters.map(c => ({ name: c.clusterName, sectors: c.sectors })),
          ...unclusteredInSS.map(s => ({ name: s, sectors: [s] })),
        ],
      });
    }
  }

  // Calculate current coverage at N=3
  let totalAvailable = 0, capturedAt3 = 0;
  for (const sectors of patentSectors.values()) {
    totalAvailable += sectors.size;
    capturedAt3 += Math.min(3, sectors.size);
  }
  const currentCoverageAt3 = (capturedAt3 / totalAvailable) * 100;

  // Recommendations
  const recommendations: string[] = [];

  if (clusterProposals.length > 0) {
    recommendations.push(
      `${clusterProposals.length} natural sector clusters identified based on co-occurrence`
    );
  }

  const highAffinityAcross = clusterProposals.filter(c => {
    const sectors = c.sectors;
    const sss = sectors.map(s => taxonomy.get(s)?.superSector);
    return new Set(sss).size > 1;
  });
  if (highAffinityAcross.length > 0) {
    recommendations.push(
      `${highAffinityAcross.length} clusters span super-sectors - consider cross-domain grouping`
    );
  }

  const improvedCoverage = clusteredCoverage.find(c => c.n === 3)?.coveragePct || 0;
  if (improvedCoverage > currentCoverageAt3) {
    recommendations.push(
      `Clustering improves N=3 coverage from ${currentCoverageAt3.toFixed(1)}% to ${improvedCoverage.toFixed(1)}%`
    );
  }

  // Build report
  const report: ClusteringReport = {
    generatedAt: new Date().toISOString(),
    currentState: {
      superSectorCount: superSectors.size,
      sectorCount: taxonomy.size,
      avgSectorsPerPatent,
      coverageWith3: currentCoverageAt3,
    },
    sectorStats: sectorStats.sort((a, b) => b.patentCount - a.patentCount),
    clusterProposals,
    restructuredTaxonomy,
    impactAnalysis: {
      currentAssociationsNeededFor90Pct: 3,  // From previous analysis
      proposedAssociationsNeededFor90Pct: clusteredCoverage.find(c => c.coveragePct >= 90)?.n || 3,
      sectorsLostToMerging: clusterProposals.reduce((sum, c) => sum + c.sectors.length - 1, 0),
      granularityRetained: `${taxonomy.size - clusterProposals.reduce((sum, c) => sum + c.sectors.length - 1, 0)}/${taxonomy.size} sectors remain distinct`,
    },
    recommendations,
  };

  return report;
}

async function main() {
  try {
    const report = await runAnalysis();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('              TAXONOMY CLUSTERING ANALYSIS                       ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('CURRENT STATE:');
    console.log(`  Super-sectors: ${report.currentState.superSectorCount}`);
    console.log(`  Sectors: ${report.currentState.sectorCount}`);
    console.log(`  Avg sectors per patent: ${report.currentState.avgSectorsPerPatent.toFixed(2)}`);
    console.log(`  Coverage with N=3: ${report.currentState.coverageWith3.toFixed(1)}%`);

    console.log('\n\nPROPOSED CLUSTERS (based on co-occurrence):');
    for (const cluster of report.clusterProposals) {
      console.log(`\n  ${cluster.clusterName}:`);
      console.log(`    Sectors: ${cluster.sectors.join(', ')}`);
      console.log(`    Internal overlap: ${(cluster.internalOverlap * 100).toFixed(0)}%`);
      console.log(`    Rationale: ${cluster.rationale}`);
    }

    console.log('\n\nCOVERAGE WITH CLUSTERING:');
    for (const c of report.restructuredTaxonomy.estimatedAssociationsNeeded) {
      console.log(`  N=${c.n}: ${c.coveragePct.toFixed(1)}%`);
    }

    console.log('\n\nIMPACT ANALYSIS:');
    console.log(`  Sectors merged: ${report.impactAnalysis.sectorsLostToMerging}`);
    console.log(`  Granularity retained: ${report.impactAnalysis.granularityRetained}`);

    console.log('\n\nTOP SECTORS BY PATENT COUNT:');
    for (const s of report.sectorStats.slice(0, 15)) {
      console.log(`  ${s.name.padEnd(30)} ${s.patentCount.toString().padStart(4)} patents  (${s.superSector})`);
      if (s.topCooccurrences.length > 0) {
        const top = s.topCooccurrences[0];
        console.log(`    → Most co-occurs with: ${top.sector} (J=${top.jaccard.toFixed(2)})`);
      }
    }

    console.log('\n\nRECOMMENDATIONS:');
    for (const rec of report.recommendations) {
      console.log(`  → ${rec}`);
    }

    // Save report
    const outputDir = path.join(process.cwd(), 'output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outputDir, `taxonomy-clustering-${timestamp}.json`);
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
