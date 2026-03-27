#!/usr/bin/env npx ts-node
/**
 * Inventive CPC Divergence Analysis
 *
 * Analyzes how inventive CPC codes diverge within individual patents,
 * especially among high-value patents. This informs taxonomy design
 * for handling patents with multiple legitimate classifications.
 *
 * Questions answered:
 * 1. Among top-N patents, how many have multiple inventive CPCs?
 * 2. At what CPC hierarchy level do inventive CPCs diverge?
 *    (Section, Class, Subclass, Main Group, Subgroup)
 * 3. How many patents have inventive CPCs that map to DIFFERENT
 *    super-sectors, sectors, or sub-sectors in our taxonomy?
 * 4. What are examples of high-value patents with significant divergence?
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
  section: string;      // A-H, Y
  class: string;        // e.g., H04
  subclass: string;     // e.g., H04L
  mainGroup: string;    // e.g., H04L63
  subgroup: string;     // e.g., H04L63/14
  full: string;         // original code
}

type DivergenceLevel = 'section' | 'class' | 'subclass' | 'mainGroup' | 'subgroup' | 'identical' | 'single';

interface PatentCpcAnalysis {
  patentId: string;
  title: string;
  superSector: string | null;
  primarySector: string | null;
  v2Score: number | null;
  inventiveCpcCount: number;
  additionalCpcCount: number;
  inventiveCpcs: CpcHierarchy[];
  divergenceLevel: DivergenceLevel;
  mappedSuperSectors: string[];
  mappedSectors: string[];
  taxonomyDivergence: {
    divergesAtSuperSector: boolean;
    divergesAtSector: boolean;
    superSectorCount: number;
    sectorCount: number;
  };
}

interface DivergenceReport {
  generatedAt: string;
  sampleCriteria: {
    globalTopN: number;
    perSuperSectorTopN: number;
    totalPatentsAnalyzed: number;
  };
  divergenceSummary: {
    patentsWithMultipleInventive: number;
    patentsWithMultipleInventivePct: number;
    byDivergenceLevel: Record<DivergenceLevel, number>;
    byDivergenceLevelPct: Record<DivergenceLevel, number>;
  };
  taxonomyImpact: {
    divergeAtSuperSector: number;
    divergeAtSuperSectorPct: number;
    divergeAtSector: number;
    divergeAtSectorPct: number;
    avgSuperSectorsPerPatent: number;
    avgSectorsPerPatent: number;
    distribution: {
      superSectors: Record<string, number>;  // "1": N, "2": M, "3+": P
      sectors: Record<string, number>;
    };
  };
  superSectorBreakdown: Record<string, {
    patentsAnalyzed: number;
    multipleInventive: number;
    divergeAtSuperSector: number;
    divergeAtSector: number;
    avgInventiveCpcs: number;
  }>;
  examplePatents: {
    highDivergence: PatentCpcAnalysis[];
    crossSuperSector: PatentCpcAnalysis[];
    multipleSectors: PatentCpcAnalysis[];
  };
  observations: string[];
  designImplications: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CPC Parsing
// ═══════════════════════════════════════════════════════════════════════════

function parseCpcHierarchy(code: string): CpcHierarchy {
  // Normalize the code
  const normalized = code.replace(/\//g, '');

  // Parse hierarchy levels
  const section = normalized.charAt(0);
  const classMatch = normalized.match(/^([A-HY]\d{2})/);
  const subclassMatch = normalized.match(/^([A-HY]\d{2}[A-Z])/);
  const mainGroupMatch = normalized.match(/^([A-HY]\d{2}[A-Z]?\d+)/);

  return {
    section,
    class: classMatch ? classMatch[1] : section,
    subclass: subclassMatch ? subclassMatch[1] : (classMatch ? classMatch[1] : section),
    mainGroup: mainGroupMatch ? mainGroupMatch[1] : (subclassMatch ? subclassMatch[1] : section),
    subgroup: normalized,
    full: code,
  };
}

function getDivergenceLevel(cpcs: CpcHierarchy[]): DivergenceLevel {
  if (cpcs.length <= 1) return 'single';

  // Check each level from top to bottom
  const sections = new Set(cpcs.map(c => c.section));
  if (sections.size > 1) return 'section';

  const classes = new Set(cpcs.map(c => c.class));
  if (classes.size > 1) return 'class';

  const subclasses = new Set(cpcs.map(c => c.subclass));
  if (subclasses.size > 1) return 'subclass';

  const mainGroups = new Set(cpcs.map(c => c.mainGroup));
  if (mainGroups.size > 1) return 'mainGroup';

  const subgroups = new Set(cpcs.map(c => c.subgroup));
  if (subgroups.size > 1) return 'subgroup';

  return 'identical';
}

// ═══════════════════════════════════════════════════════════════════════════
// Taxonomy
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

function mapCpcToTaxonomy(cpcCode: string, sectors: Map<string, TaxonomySector>): {
  sectors: string[];
  superSectors: string[];
} {
  const normalized = cpcCode.replace(/\//g, '');
  const matchedSectors = new Set<string>();
  const matchedSuperSectors = new Set<string>();

  for (const sector of sectors.values()) {
    for (const prefix of sector.cpcPrefixes) {
      const normalizedPrefix = prefix.replace('/', '');
      if (normalized.startsWith(normalizedPrefix)) {
        matchedSectors.add(sector.name);
        matchedSuperSectors.add(sector.superSector);
        break;
      }
    }
  }

  return {
    sectors: Array.from(matchedSectors),
    superSectors: Array.from(matchedSuperSectors),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Data Loading
// ═══════════════════════════════════════════════════════════════════════════

async function getTopPatentsByScore(
  limit: number,
  superSector?: string
): Promise<Array<{
  patentId: string;
  title: string;
  superSector: string | null;
  primarySector: string | null;
  score: number;
}>> {
  // Get active V2 snapshot
  const snapshot = await prisma.scoreSnapshot.findFirst({
    where: { isActive: true, scoreType: 'V2' },
    select: { id: true },
  });

  if (!snapshot) {
    console.log('  No active V2 snapshot found, using baseScore');
    // Fallback to baseScore
    const where = superSector ? { superSector } : {};
    const patents = await prisma.patent.findMany({
      where: { ...where, baseScore: { not: null } },
      select: {
        patentId: true,
        title: true,
        superSector: true,
        primarySector: true,
        baseScore: true,
      },
      orderBy: { baseScore: 'desc' },
      take: limit,
    });
    return patents.map(p => ({
      patentId: p.patentId,
      title: p.title,
      superSector: p.superSector,
      primarySector: p.primarySector,
      score: p.baseScore || 0,
    }));
  }

  // Use snapshot scores
  const entries = await prisma.patentScoreEntry.findMany({
    where: { snapshotId: snapshot.id },
    select: {
      patentId: true,
      score: true,
    },
    orderBy: { score: 'desc' },
    take: limit * 2,  // Get more to filter by super-sector if needed
  });

  const patentIds = entries.map(e => e.patentId);
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: {
      patentId: true,
      title: true,
      superSector: true,
      primarySector: true,
    },
  });

  const patentMap = new Map(patents.map(p => [p.patentId, p]));
  const scoreMap = new Map(entries.map(e => [e.patentId, e.score]));

  let results = patents.map(p => ({
    patentId: p.patentId,
    title: p.title,
    superSector: p.superSector,
    primarySector: p.primarySector,
    score: scoreMap.get(p.patentId) || 0,
  }));

  if (superSector) {
    results = results.filter(p => p.superSector === superSector);
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// Analysis
// ═══════════════════════════════════════════════════════════════════════════

async function analyzePatent(
  patentId: string,
  patentInfo: { title: string; superSector: string | null; primarySector: string | null; score: number },
  taxonomy: Map<string, TaxonomySector>
): Promise<PatentCpcAnalysis> {
  // Get CPC codes
  const cpcCodes = await prisma.patentCpc.findMany({
    where: { patentId },
    select: { cpcCode: true, isInventive: true },
  });

  const inventiveCpcs = cpcCodes
    .filter(c => c.isInventive)
    .map(c => parseCpcHierarchy(c.cpcCode));

  const additionalCpcs = cpcCodes.filter(c => !c.isInventive);

  // Determine divergence level
  const divergenceLevel = getDivergenceLevel(inventiveCpcs);

  // Map to taxonomy
  const allMappedSectors = new Set<string>();
  const allMappedSuperSectors = new Set<string>();

  for (const cpc of inventiveCpcs) {
    const mapped = mapCpcToTaxonomy(cpc.full, taxonomy);
    mapped.sectors.forEach(s => allMappedSectors.add(s));
    mapped.superSectors.forEach(ss => allMappedSuperSectors.add(ss));
  }

  return {
    patentId,
    title: patentInfo.title,
    superSector: patentInfo.superSector,
    primarySector: patentInfo.primarySector,
    v2Score: patentInfo.score,
    inventiveCpcCount: inventiveCpcs.length,
    additionalCpcCount: additionalCpcs.length,
    inventiveCpcs,
    divergenceLevel,
    mappedSuperSectors: Array.from(allMappedSuperSectors),
    mappedSectors: Array.from(allMappedSectors),
    taxonomyDivergence: {
      divergesAtSuperSector: allMappedSuperSectors.size > 1,
      divergesAtSector: allMappedSectors.size > 1,
      superSectorCount: allMappedSuperSectors.size,
      sectorCount: allMappedSectors.size,
    },
  };
}

async function runAnalysis(): Promise<DivergenceReport> {
  console.log('Starting inventive CPC divergence analysis...\n');

  const taxonomy = loadTaxonomy();
  console.log(`Loaded ${taxonomy.size} taxonomy sectors\n`);

  // Get super-sectors from taxonomy
  const superSectors = new Set<string>();
  for (const sector of taxonomy.values()) {
    if (sector.superSector && sector.superSector !== 'UNCLASSIFIED') {
      superSectors.add(sector.superSector);
    }
  }

  const GLOBAL_TOP_N = 1000;
  const PER_SUPER_SECTOR_N = 100;

  // Collect patents to analyze
  const patentsToAnalyze = new Map<string, { title: string; superSector: string | null; primarySector: string | null; score: number }>();

  // Global top N
  console.log(`Loading global top ${GLOBAL_TOP_N} patents by V2 score...`);
  const globalTop = await getTopPatentsByScore(GLOBAL_TOP_N);
  for (const p of globalTop) {
    patentsToAnalyze.set(p.patentId, p);
  }
  console.log(`  Found ${globalTop.length} patents\n`);

  // Per super-sector top N
  for (const ss of superSectors) {
    console.log(`Loading top ${PER_SUPER_SECTOR_N} patents for ${ss}...`);
    const ssTop = await getTopPatentsByScore(PER_SUPER_SECTOR_N, ss);
    for (const p of ssTop) {
      if (!patentsToAnalyze.has(p.patentId)) {
        patentsToAnalyze.set(p.patentId, p);
      }
    }
    console.log(`  Found ${ssTop.length} patents (${patentsToAnalyze.size} total unique)\n`);
  }

  console.log(`\nAnalyzing ${patentsToAnalyze.size} unique patents...\n`);

  // Analyze each patent
  const analyses: PatentCpcAnalysis[] = [];
  let processed = 0;

  for (const [patentId, patentInfo] of patentsToAnalyze) {
    const analysis = await analyzePatent(patentId, patentInfo, taxonomy);
    analyses.push(analysis);
    processed++;
    if (processed % 200 === 0) {
      console.log(`  Processed ${processed}/${patentsToAnalyze.size}...`);
    }
  }

  console.log(`\nGenerating report...\n`);

  // Calculate statistics
  const withMultipleInventive = analyses.filter(a => a.inventiveCpcCount > 1);
  const divergenceCounts: Record<DivergenceLevel, number> = {
    section: 0,
    class: 0,
    subclass: 0,
    mainGroup: 0,
    subgroup: 0,
    identical: 0,
    single: 0,
  };

  for (const a of analyses) {
    divergenceCounts[a.divergenceLevel]++;
  }

  const divergeAtSuperSector = analyses.filter(a => a.taxonomyDivergence.divergesAtSuperSector);
  const divergeAtSector = analyses.filter(a => a.taxonomyDivergence.divergesAtSector);

  // Super-sector breakdown
  const superSectorBreakdown: Record<string, any> = {};
  for (const ss of superSectors) {
    const ssAnalyses = analyses.filter(a => a.superSector === ss);
    if (ssAnalyses.length === 0) continue;

    superSectorBreakdown[ss] = {
      patentsAnalyzed: ssAnalyses.length,
      multipleInventive: ssAnalyses.filter(a => a.inventiveCpcCount > 1).length,
      divergeAtSuperSector: ssAnalyses.filter(a => a.taxonomyDivergence.divergesAtSuperSector).length,
      divergeAtSector: ssAnalyses.filter(a => a.taxonomyDivergence.divergesAtSector).length,
      avgInventiveCpcs: ssAnalyses.reduce((sum, a) => sum + a.inventiveCpcCount, 0) / ssAnalyses.length,
    };
  }

  // Distribution of sector/super-sector counts
  const superSectorDist: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  const sectorDist: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0, "4+": 0 };

  for (const a of analyses) {
    const ssCount = a.taxonomyDivergence.superSectorCount;
    const sCount = a.taxonomyDivergence.sectorCount;

    if (ssCount === 0) superSectorDist["0"]++;
    else if (ssCount === 1) superSectorDist["1"]++;
    else if (ssCount === 2) superSectorDist["2"]++;
    else superSectorDist["3+"]++;

    if (sCount === 0) sectorDist["0"]++;
    else if (sCount === 1) sectorDist["1"]++;
    else if (sCount === 2) sectorDist["2"]++;
    else if (sCount === 3) sectorDist["3"]++;
    else sectorDist["4+"]++;
  }

  // Find example patents
  const highDivergence = analyses
    .filter(a => a.divergenceLevel === 'section' || a.divergenceLevel === 'class')
    .sort((a, b) => (b.v2Score || 0) - (a.v2Score || 0))
    .slice(0, 10);

  const crossSuperSector = analyses
    .filter(a => a.taxonomyDivergence.superSectorCount > 1)
    .sort((a, b) => (b.v2Score || 0) - (a.v2Score || 0))
    .slice(0, 10);

  const multipleSectors = analyses
    .filter(a => a.taxonomyDivergence.sectorCount >= 3)
    .sort((a, b) => (b.v2Score || 0) - (a.v2Score || 0))
    .slice(0, 10);

  // Generate observations
  const observations: string[] = [];
  const pct = (n: number, total: number) => ((n / total) * 100).toFixed(1);

  const multiPct = parseFloat(pct(withMultipleInventive.length, analyses.length));
  if (multiPct > 50) {
    observations.push(`${multiPct}% of top patents have multiple inventive CPC codes - this is common among high-value patents`);
  }

  const ssDivergePct = parseFloat(pct(divergeAtSuperSector.length, analyses.length));
  if (ssDivergePct > 5) {
    observations.push(`${ssDivergePct}% of patents have inventive CPCs mapping to DIFFERENT super-sectors - these span technology domains`);
  }

  const sectorDivergePct = parseFloat(pct(divergeAtSector.length, analyses.length));
  if (sectorDivergePct > 20) {
    observations.push(`${sectorDivergePct}% of patents have inventive CPCs mapping to multiple sectors - single-sector assignment loses nuance`);
  }

  const classLevelDiv = divergenceCounts.section + divergenceCounts.class;
  if (classLevelDiv > 50) {
    observations.push(`${classLevelDiv} patents diverge at section or class level - these represent fundamentally multi-domain inventions`);
  }

  // Design implications
  const designImplications: string[] = [
    "Consider multi-classification model: store all applicable classifications per patent, weighted by inventive/additional",
    "Top-level (super-sector) divergence is less common but significant - these are cross-domain innovations",
    "Sector-level divergence is more common - taxonomy should support multiple sector assignments",
    "High-value patents often span categories - single classification may undervalue or misrepresent them",
    "CPC co-occurrence analysis could inform grouping decisions for pragmatic taxonomy design",
  ];

  const report: DivergenceReport = {
    generatedAt: new Date().toISOString(),
    sampleCriteria: {
      globalTopN: GLOBAL_TOP_N,
      perSuperSectorTopN: PER_SUPER_SECTOR_N,
      totalPatentsAnalyzed: analyses.length,
    },
    divergenceSummary: {
      patentsWithMultipleInventive: withMultipleInventive.length,
      patentsWithMultipleInventivePct: parseFloat(pct(withMultipleInventive.length, analyses.length)),
      byDivergenceLevel: divergenceCounts,
      byDivergenceLevelPct: {
        section: parseFloat(pct(divergenceCounts.section, analyses.length)),
        class: parseFloat(pct(divergenceCounts.class, analyses.length)),
        subclass: parseFloat(pct(divergenceCounts.subclass, analyses.length)),
        mainGroup: parseFloat(pct(divergenceCounts.mainGroup, analyses.length)),
        subgroup: parseFloat(pct(divergenceCounts.subgroup, analyses.length)),
        identical: parseFloat(pct(divergenceCounts.identical, analyses.length)),
        single: parseFloat(pct(divergenceCounts.single, analyses.length)),
      },
    },
    taxonomyImpact: {
      divergeAtSuperSector: divergeAtSuperSector.length,
      divergeAtSuperSectorPct: parseFloat(pct(divergeAtSuperSector.length, analyses.length)),
      divergeAtSector: divergeAtSector.length,
      divergeAtSectorPct: parseFloat(pct(divergeAtSector.length, analyses.length)),
      avgSuperSectorsPerPatent: analyses.reduce((s, a) => s + a.taxonomyDivergence.superSectorCount, 0) / analyses.length,
      avgSectorsPerPatent: analyses.reduce((s, a) => s + a.taxonomyDivergence.sectorCount, 0) / analyses.length,
      distribution: {
        superSectors: superSectorDist,
        sectors: sectorDist,
      },
    },
    superSectorBreakdown,
    examplePatents: {
      highDivergence,
      crossSuperSector,
      multipleSectors,
    },
    observations,
    designImplications,
  };

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  try {
    const report = await runAnalysis();

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('        INVENTIVE CPC DIVERGENCE ANALYSIS (Top Patents)        ');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('SAMPLE:');
    console.log(`  Global top: ${report.sampleCriteria.globalTopN}`);
    console.log(`  Per super-sector: ${report.sampleCriteria.perSuperSectorTopN}`);
    console.log(`  Total unique patents analyzed: ${report.sampleCriteria.totalPatentsAnalyzed}\n`);

    console.log('INVENTIVE CPC DIVERGENCE:');
    console.log(`  Patents with multiple inventive CPCs: ${report.divergenceSummary.patentsWithMultipleInventive} (${report.divergenceSummary.patentsWithMultipleInventivePct}%)`);
    console.log('\n  Divergence level among inventive CPCs:');
    console.log(`    Section level (A vs H):     ${report.divergenceSummary.byDivergenceLevel.section.toString().padStart(5)} (${report.divergenceSummary.byDivergenceLevelPct.section}%)`);
    console.log(`    Class level (H04 vs G06):   ${report.divergenceSummary.byDivergenceLevel.class.toString().padStart(5)} (${report.divergenceSummary.byDivergenceLevelPct.class}%)`);
    console.log(`    Subclass (H04L vs H04W):    ${report.divergenceSummary.byDivergenceLevel.subclass.toString().padStart(5)} (${report.divergenceSummary.byDivergenceLevelPct.subclass}%)`);
    console.log(`    Main group (H04L63 vs 65):  ${report.divergenceSummary.byDivergenceLevel.mainGroup.toString().padStart(5)} (${report.divergenceSummary.byDivergenceLevelPct.mainGroup}%)`);
    console.log(`    Subgroup (H04L63/08 vs 14): ${report.divergenceSummary.byDivergenceLevel.subgroup.toString().padStart(5)} (${report.divergenceSummary.byDivergenceLevelPct.subgroup}%)`);
    console.log(`    Identical codes:            ${report.divergenceSummary.byDivergenceLevel.identical.toString().padStart(5)} (${report.divergenceSummary.byDivergenceLevelPct.identical}%)`);
    console.log(`    Single inventive CPC:       ${report.divergenceSummary.byDivergenceLevel.single.toString().padStart(5)} (${report.divergenceSummary.byDivergenceLevelPct.single}%)`);

    console.log('\nTAXONOMY IMPACT:');
    console.log(`  Inventive CPCs map to different SUPER-SECTORS: ${report.taxonomyImpact.divergeAtSuperSector} (${report.taxonomyImpact.divergeAtSuperSectorPct}%)`);
    console.log(`  Inventive CPCs map to different SECTORS:       ${report.taxonomyImpact.divergeAtSector} (${report.taxonomyImpact.divergeAtSectorPct}%)`);
    console.log(`  Avg super-sectors per patent: ${report.taxonomyImpact.avgSuperSectorsPerPatent.toFixed(2)}`);
    console.log(`  Avg sectors per patent:       ${report.taxonomyImpact.avgSectorsPerPatent.toFixed(2)}`);

    console.log('\n  Distribution - Super-sectors per patent:');
    for (const [k, v] of Object.entries(report.taxonomyImpact.distribution.superSectors)) {
      console.log(`    ${k}: ${v} patents`);
    }

    console.log('\n  Distribution - Sectors per patent:');
    for (const [k, v] of Object.entries(report.taxonomyImpact.distribution.sectors)) {
      console.log(`    ${k}: ${v} patents`);
    }

    console.log('\nSUPER-SECTOR BREAKDOWN:');
    for (const [ss, data] of Object.entries(report.superSectorBreakdown)) {
      console.log(`  ${ss}:`);
      console.log(`    Analyzed: ${data.patentsAnalyzed}, Multiple inventive: ${data.multipleInventive} (${((data.multipleInventive/data.patentsAnalyzed)*100).toFixed(1)}%)`);
      console.log(`    Diverge at super-sector: ${data.divergeAtSuperSector}, at sector: ${data.divergeAtSector}`);
      console.log(`    Avg inventive CPCs: ${data.avgInventiveCpcs.toFixed(2)}`);
    }

    console.log('\nEXAMPLE: Patents with HIGH CPC DIVERGENCE (section/class level):');
    for (const p of report.examplePatents.highDivergence.slice(0, 5)) {
      console.log(`  ${p.patentId} (score: ${p.v2Score?.toFixed(1) || 'N/A'})`);
      console.log(`    ${p.title.substring(0, 70)}...`);
      console.log(`    Inventive CPCs: ${p.inventiveCpcs.map(c => c.full).join(', ')}`);
      console.log(`    Divergence: ${p.divergenceLevel}, Sectors: ${p.mappedSectors.join(', ')}`);
    }

    console.log('\nEXAMPLE: Patents spanning MULTIPLE SUPER-SECTORS:');
    for (const p of report.examplePatents.crossSuperSector.slice(0, 5)) {
      console.log(`  ${p.patentId} (score: ${p.v2Score?.toFixed(1) || 'N/A'})`);
      console.log(`    ${p.title.substring(0, 70)}...`);
      console.log(`    Super-sectors: ${p.mappedSuperSectors.join(', ')}`);
      console.log(`    Sectors: ${p.mappedSectors.join(', ')}`);
    }

    console.log('\nOBSERVATIONS:');
    for (const obs of report.observations) {
      console.log(`  • ${obs}`);
    }

    console.log('\nDESIGN IMPLICATIONS:');
    for (const impl of report.designImplications) {
      console.log(`  → ${impl}`);
    }

    // Save report
    const outputDir = path.join(process.cwd(), 'output');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(outputDir, `inventive-divergence-${timestamp}.json`);
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
