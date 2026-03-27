# Taxonomy Analysis Service — Detailed Design

## Overview

This service answers specific questions about taxonomy effectiveness using only
existing data. It is a read-only analytical layer — no mutations, no side effects,
no changes to existing services or tables.

The service is organized into **seven analysis modules**, each addressing a
concrete design question. Every method returns structured data suitable for both
Claude Code analysis and future GUI dashboards.

---

## 1. Types & Interfaces

```typescript
// services/taxonomy-analysis/types.ts

// ── Shared Types ──

export interface ScopeFilter {
  portfolioId?: string;
  superSector?: string;
  sector?: string;
  excludeQuarantined?: boolean;  // Default true
  excludeExpired?: boolean;      // Default false
}

// ── Module 1: CPC Distribution ──

export interface CpcDistributionStats {
  totalPatents: number;
  totalCpcAssignments: number;  // Sum of all patent_cpc_codes rows
  uniqueCpcCodes: number;
  perPatent: {
    min: number;
    max: number;
    avg: number;
    median: number;
    p25: number;
    p75: number;
    p90: number;
    p95: number;
    stddev: number;
  };
  histogram: { cpcCount: number; patentCount: number }[];
  // Patents with 0 CPC codes (shouldn't happen but worth checking)
  patentsWithNoCpc: number;
}

export interface CpcFrequencyEntry {
  cpcCode: string;
  cpcTitle: string | null;
  level: string;              // SECTION, CLASS, SUBCLASS, GROUP, SUBGROUP
  patentCount: number;
  inventiveCount: number;     // Times appearing as isInventive=true
  inventiveRatio: number;     // inventiveCount / patentCount
  currentSector: string | null;
  currentSuperSector: string | null;
  // CPC hierarchy parents (for navigation)
  parentCode: string | null;
  sectionCode: string;        // First character
}

// ── Module 2: Classification Coverage ──

export interface ClassificationCoverage {
  totalPatents: number;
  classified: number;          // Has non-null primarySector
  unclassified: number;        // primarySector IS NULL or 'UNCLASSIFIED'
  classifiedPct: number;
  // By super-sector
  bySuperSector: {
    superSector: string;
    displayName: string;
    patentCount: number;
    pctOfTotal: number;
    sectorCount: number;
  }[];
  // Unclassified breakdown — why are they unclassified?
  unclassifiedAnalysis: {
    hasCpcCodes: number;       // Has CPC codes but no rule matched
    noCpcCodes: number;        // No CPC codes at all
    quarantined: number;       // Quarantined patents
    sampleUnmatched: {         // Sample patents with CPCs but no sector match
      patentId: string;
      title: string;
      cpcCodes: string[];
    }[];
  };
}

// ── Module 3: Multi-Classification Potential ──

export interface MultiClassificationAnalysis {
  summary: {
    totalPatentsAnalyzed: number;
    singleSector: number;
    twoSectors: number;
    threeSectors: number;
    fourPlusSectors: number;
    avgSectorsPerPatent: number;
    medianSectorsPerPatent: number;
  };
  // Most common sector combinations for multi-classified patents
  topSectorPairs: {
    sectorA: string;
    sectorB: string;
    superSectorA: string;
    superSectorB: string;
    patentCount: number;
    sameSuperSector: boolean;
  }[];
  topSectorTriples: {
    sectors: string[];
    patentCount: number;
  }[];
  // Per super-sector: how much internal vs cross-super-sector overlap?
  overlapBySuperSector: {
    superSector: string;
    totalPatentsWithMultiple: number;
    internalOverlap: number;   // Multiple sectors WITHIN same super-sector
    externalOverlap: number;   // Sectors in DIFFERENT super-sectors
  }[];
}

export interface PatentClassificationDetail {
  patentId: string;
  title: string;
  assignee: string;
  grantDate: string | null;
  // Current assignment (denormalized on patent)
  currentSuperSector: string | null;
  currentSector: string | null;
  currentSubSector: string | null;
  currentPrimaryCpc: string | null;
  // All CPC codes on this patent
  cpcCodes: {
    code: string;
    isInventive: boolean;
    title: string | null;
    level: string;
    // What sector WOULD this CPC map to? (all matching rules)
    matchingRules: {
      sectorName: string;
      superSectorName: string;
      ruleType: string;
      ruleExpression: string;
      ruleId: string;
    }[];
  }[];
  // Aggregate: all sectors this patent's CPCs map to
  potentialClassifications: {
    sectorName: string;
    superSectorName: string;
    matchingCpcCount: number;
    inventiveCpcCount: number;
    // Strength: what fraction of this patent's CPCs point here?
    cpcCoverageRatio: number;
    isPrimary: boolean;   // Matches the current assignment
  }[];
  // Classification confidence
  classificationConfidence: 'high' | 'medium' | 'low' | 'ambiguous';
  // high = 70%+ CPCs point to one sector
  // medium = 40-70% to one sector
  // low = <40% to one sector
  // ambiguous = multiple sectors tied
}

// ── Module 4: Portfolio Comparison ──

export interface PortfolioTaxonomyComparison {
  portfolios: {
    id: string;
    name: string;
    patentCount: number;
  }[];
  // Super-sector distribution per portfolio
  superSectorDistribution: {
    superSector: string;
    byPortfolio: Record<string, { count: number; pct: number }>;
  }[];
  // CPC codes that are dominant in one portfolio but rare in others
  discriminatingCpcs: {
    cpcCode: string;
    cpcTitle: string | null;
    dominantPortfolio: string;
    dominantPct: number;
    otherPortfolioAvgPct: number;
    discriminationScore: number;  // How different from average
  }[];
  // Sector coverage comparison
  sectorCoverage: {
    sector: string;
    superSector: string;
    byPortfolio: Record<string, { count: number; pct: number }>;
    variance: number;  // High variance = portfolios differ a lot
  }[];
  // Overall similarity matrix (Jaccard similarity on CPC sets)
  similarityMatrix: {
    portfolioA: string;
    portfolioB: string;
    jaccardCpc: number;           // Jaccard on CPC code sets
    jaccardSuperSector: number;   // Jaccard on super-sector distributions
  }[];
}

// ── Module 5: Sector Balance ──

export interface SectorBalanceAnalysis {
  overview: {
    totalSectors: number;
    totalPatents: number;
    avgSectorSize: number;
    medianSectorSize: number;
    giniCoefficient: number;      // Inequality measure (0=equal, 1=one sector has all)
  };
  sectors: {
    sectorName: string;
    superSector: string;
    patentCount: number;
    // Size assessment
    status: 'critically_small' | 'undersized' | 'ok' | 'oversized' | 'critically_large';
    // Relative to targets
    targetMin: number | null;
    targetMax: number | null;
    // CPC concentration within sector
    topCpcCodes: { code: string; title: string | null; count: number; pctOfSector: number }[];
    cpcConcentration: number;     // HHI of CPC distribution (0=diverse, 1=concentrated)
    // Split/merge suggestions
    splitCandidates: {
      cpcCode: string;
      patentCount: number;
      wouldCreateSectorOfSize: number;
    }[] | null;
    mergeCandidate: string | null;  // Nearby small sector to merge with
  }[];
}

// ── Module 6: Rule Effectiveness ──

export interface RuleEffectivenessReport {
  overview: {
    totalRules: number;
    activeRules: number;
    inactiveRules: number;
    exclusionRules: number;
    byType: Record<string, number>;  // CPC_PREFIX: 45, KEYWORD: 12, etc.
    byScope: Record<string, number>; // LIBRARY: 50, PORTFOLIO: 8
  };
  rules: {
    ruleId: string;
    sectorName: string;
    superSector: string;
    ruleType: string;
    expression: string;
    scope: string;
    priority: number;
    isExclusion: boolean;
    isActive: boolean;
    // Effectiveness metrics
    matchedPatentCount: number;
    // Is this rule redundant? (all its matches also matched by another rule)
    isRedundant: boolean;
    redundantWith: string | null;  // Rule ID that covers same patents
    // Does this rule conflict? (matches patents assigned to different sectors)
    conflictsWith: { ruleId: string; sectorName: string; overlapCount: number }[];
  }[];
  // Patents matched by NO rule
  orphanedPatents: {
    count: number;
    samples: { patentId: string; title: string; cpcCodes: string[] }[];
  };
}

// ── Module 7: CPC Hierarchy Analysis ──

export interface CpcHierarchyAnalysis {
  // For a given CPC prefix: what's below it and how do patents distribute?
  root: string;
  rootTitle: string | null;
  totalPatentsUnder: number;
  children: CpcHierarchyNode[];
}

export interface CpcHierarchyNode {
  code: string;
  title: string | null;
  level: string;
  patentCount: number;        // Patents directly assigned here
  cumulativeCount: number;    // Including all children
  currentSector: string | null;
  currentSuperSector: string | null;
  children?: CpcHierarchyNode[];
  // Useful for deciding where to split sectors
  isSplitCandidate: boolean;  // Large enough to be its own sector
}
```

---

## 2. Service Implementation

### 2.1 Service Shell & Constructor

```typescript
// services/taxonomy-analysis/taxonomy-analysis-service.ts

import { PrismaClient, Prisma } from '@prisma/client';
import type {
  ScopeFilter,
  CpcDistributionStats,
  CpcFrequencyEntry,
  ClassificationCoverage,
  MultiClassificationAnalysis,
  PatentClassificationDetail,
  PortfolioTaxonomyComparison,
  SectorBalanceAnalysis,
  RuleEffectivenessReport,
  CpcHierarchyAnalysis,
} from './types';

export class TaxonomyAnalysisService {
  constructor(private prisma: PrismaClient) {}

  // ── Helpers ──

  /** Build a WHERE fragment that scopes to a portfolio if provided */
  private scopeWhere(scope: ScopeFilter, patentAlias = 'p'): string {
    const clauses: string[] = [];
    if (scope.excludeQuarantined !== false) {
      clauses.push(`${patentAlias}.is_quarantined = false`);
    }
    if (scope.excludeExpired) {
      clauses.push(`${patentAlias}.is_expired = false`);
    }
    if (scope.portfolioId) {
      clauses.push(`${patentAlias}.patent_id IN (
        SELECT patent_id FROM portfolio_patents WHERE portfolio_id = '${scope.portfolioId}'
      )`);
    }
    if (scope.superSector) {
      clauses.push(`${patentAlias}.super_sector = '${scope.superSector}'`);
    }
    if (scope.sector) {
      clauses.push(`${patentAlias}.primary_sector = '${scope.sector}'`);
    }
    return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  }

  /**
   * Core reusable CTE: for each patent's CPC code, find ALL sector rules
   * that match. This is the foundation of multi-classification analysis.
   *
   * Returns: patent_id, cpc_code, is_inventive, sector_id, sector_name,
   *          super_sector_name, rule_id, rule_type, expression
   */
  private cpcSectorMatchCte(scope: ScopeFilter): string {
    const scopeFilter = scope.portfolioId
      ? `AND pc.patent_id IN (
           SELECT patent_id FROM portfolio_patents 
           WHERE portfolio_id = '${scope.portfolioId}'
         )`
      : '';
    const sectorFilter = scope.superSector
      ? `AND ss.name = '${scope.superSector}'`
      : '';

    return `
    cpc_sector_matches AS (
      SELECT
        pc.patent_id,
        pc.cpc_code,
        pc.is_inventive,
        s.id AS sector_id,
        s.name AS sector_name,
        COALESCE(ss.name, 'UNASSIGNED') AS super_sector_name,
        sr.id AS rule_id,
        sr.rule_type,
        sr.expression,
        sr.priority,
        sr.is_exclusion
      FROM patent_cpc_codes pc
      JOIN sector_rules sr ON (
        sr.is_active = true
        AND sr.is_exclusion = false
        AND (sr.scope = 'LIBRARY' OR sr.portfolio_id = ${scope.portfolioId ? `'${scope.portfolioId}'` : 'NULL'})
        AND (
          (sr.rule_type = 'CPC_PREFIX' AND pc.cpc_code LIKE sr.expression || '%')
          OR (sr.rule_type = 'CPC_SUBGROUP' AND pc.cpc_code = sr.expression)
        )
      )
      JOIN sectors s ON sr.sector_id = s.id
      LEFT JOIN super_sectors ss ON s.super_sector_id = ss.id
      ${scopeFilter}
      ${sectorFilter}
    )`;
  }
```

### 2.2 Module 1: CPC Distribution

```typescript
  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 1: CPC DISTRIBUTION
  // "How are CPC codes distributed across patents?"
  // ═══════════════════════════════════════════════════════════════════════

  async getCpcDistribution(scope: ScopeFilter = {}): Promise<CpcDistributionStats> {
    const where = this.scopeWhere(scope);

    // Count CPCs per patent
    const perPatentStats = await this.prisma.$queryRawUnsafe<[{
      total_patents: bigint;
      total_assignments: bigint;
      unique_cpcs: bigint;
      min_cpc: number;
      max_cpc: number;
      avg_cpc: number;
      median_cpc: number;
      p25: number;
      p75: number;
      p90: number;
      p95: number;
      stddev_cpc: number;
      no_cpc_count: bigint;
    }]>(`
      WITH patent_cpc_counts AS (
        SELECT p.patent_id, COALESCE(cnt.cpc_count, 0) AS cpc_count
        FROM patents p
        LEFT JOIN (
          SELECT patent_id, COUNT(*) AS cpc_count
          FROM patent_cpc_codes
          GROUP BY patent_id
        ) cnt ON p.patent_id = cnt.patent_id
        ${where}
      )
      SELECT
        COUNT(*) AS total_patents,
        (SELECT COUNT(*) FROM patent_cpc_codes pc
         JOIN patents p ON pc.patent_id = p.patent_id ${where}) AS total_assignments,
        (SELECT COUNT(DISTINCT pc.cpc_code) FROM patent_cpc_codes pc
         JOIN patents p ON pc.patent_id = p.patent_id ${where}) AS unique_cpcs,
        MIN(cpc_count)::int AS min_cpc,
        MAX(cpc_count)::int AS max_cpc,
        ROUND(AVG(cpc_count)::numeric, 2)::float AS avg_cpc,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cpc_count)::float AS median_cpc,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY cpc_count)::float AS p25,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY cpc_count)::float AS p75,
        PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY cpc_count)::float AS p90,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cpc_count)::float AS p95,
        ROUND(STDDEV(cpc_count)::numeric, 2)::float AS stddev_cpc,
        COUNT(*) FILTER (WHERE cpc_count = 0) AS no_cpc_count
      FROM patent_cpc_counts
    `);

    // Histogram: how many patents have N CPC codes
    const histogram = await this.prisma.$queryRawUnsafe<
      { cpc_count: number; patent_count: bigint }[]
    >(`
      WITH patent_cpc_counts AS (
        SELECT p.patent_id, COALESCE(cnt.cpc_count, 0) AS cpc_count
        FROM patents p
        LEFT JOIN (
          SELECT patent_id, COUNT(*) AS cpc_count
          FROM patent_cpc_codes
          GROUP BY patent_id
        ) cnt ON p.patent_id = cnt.patent_id
        ${where}
      )
      SELECT 
        CASE 
          WHEN cpc_count = 0 THEN 0
          WHEN cpc_count <= 5 THEN cpc_count
          WHEN cpc_count <= 10 THEN 10
          WHEN cpc_count <= 20 THEN 20
          WHEN cpc_count <= 50 THEN 50
          ELSE 100
        END AS cpc_count,
        COUNT(*) AS patent_count
      FROM patent_cpc_counts
      GROUP BY 1
      ORDER BY 1
    `);

    const stats = perPatentStats[0];
    return {
      totalPatents: Number(stats.total_patents),
      totalCpcAssignments: Number(stats.total_assignments),
      uniqueCpcCodes: Number(stats.unique_cpcs),
      perPatent: {
        min: stats.min_cpc,
        max: stats.max_cpc,
        avg: stats.avg_cpc,
        median: stats.median_cpc,
        p25: stats.p25,
        p75: stats.p75,
        p90: stats.p90,
        p95: stats.p95,
        stddev: stats.stddev_cpc,
      },
      histogram: histogram.map(h => ({
        cpcCount: h.cpc_count,
        patentCount: Number(h.patent_count),
      })),
      patentsWithNoCpc: Number(stats.no_cpc_count),
    };
  }

  async getTopCpcCodes(opts: {
    scope?: ScopeFilter;
    level?: 'SECTION' | 'CLASS' | 'SUBCLASS' | 'GROUP' | 'SUBGROUP';
    limit?: number;
  } = {}): Promise<CpcFrequencyEntry[]> {
    const scope = opts.scope || {};
    const limit = opts.limit || 50;
    const level = opts.level || 'SUBCLASS'; // Default: H04L, G06F level

    // Truncate CPC codes to requested level for aggregation
    const truncateExpr = {
      SECTION:  `LEFT(pc.cpc_code, 1)`,
      CLASS:    `LEFT(pc.cpc_code, 3)`,
      SUBCLASS: `LEFT(pc.cpc_code, 4)`,
      GROUP:    `SPLIT_PART(pc.cpc_code, '/', 1)`,  // Everything before /
      SUBGROUP: `pc.cpc_code`,
    }[level];

    const portfolioJoin = scope.portfolioId
      ? `JOIN portfolio_patents pp ON p.patent_id = pp.patent_id 
             AND pp.portfolio_id = '${scope.portfolioId}'`
      : '';
    const sectorFilter = scope.superSector
      ? `AND p.super_sector = '${scope.superSector}'`
      : scope.sector
      ? `AND p.primary_sector = '${scope.sector}'`
      : '';

    const rows = await this.prisma.$queryRawUnsafe<{
      cpc_prefix: string;
      patent_count: bigint;
      inventive_count: bigint;
      cpc_title: string | null;
      cpc_level: string | null;
      parent_code: string | null;
      current_sector: string | null;
      current_super_sector: string | null;
    }[]>(`
      SELECT
        ${truncateExpr} AS cpc_prefix,
        COUNT(DISTINCT p.patent_id) AS patent_count,
        COUNT(DISTINCT p.patent_id) FILTER (WHERE pc.is_inventive) AS inventive_count,
        cc.title AS cpc_title,
        cc.level AS cpc_level,
        cc.parent_code,
        cc.sector_id AS current_sector,
        cc.super_sector_id AS current_super_sector
      FROM patent_cpc_codes pc
      JOIN patents p ON pc.patent_id = p.patent_id
        AND p.is_quarantined = false
        ${sectorFilter}
      ${portfolioJoin}
      LEFT JOIN cpc_codes cc ON cc.code = ${truncateExpr}
      GROUP BY cpc_prefix, cc.title, cc.level, cc.parent_code, cc.sector_id, cc.super_sector_id
      ORDER BY patent_count DESC
      LIMIT ${limit}
    `);

    return rows.map(r => ({
      cpcCode: r.cpc_prefix,
      cpcTitle: r.cpc_title,
      level: r.cpc_level || level,
      patentCount: Number(r.patent_count),
      inventiveCount: Number(r.inventive_count),
      inventiveRatio: Number(r.inventive_count) / Number(r.patent_count),
      currentSector: r.current_sector,
      currentSuperSector: r.current_super_sector,
      parentCode: r.parent_code,
      sectionCode: r.cpc_prefix.charAt(0),
    }));
  }
```

### 2.3 Module 2: Classification Coverage

```typescript
  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 2: CLASSIFICATION COVERAGE
  // "How effective is the current taxonomy at classifying patents?"
  // ═══════════════════════════════════════════════════════════════════════

  async getClassificationCoverage(
    scope: ScopeFilter = {},
  ): Promise<ClassificationCoverage> {

    const portfolioJoin = scope.portfolioId
      ? `JOIN portfolio_patents pp ON p.patent_id = pp.patent_id 
             AND pp.portfolio_id = '${scope.portfolioId}'`
      : '';

    // Overall coverage
    const overview = await this.prisma.$queryRawUnsafe<[{
      total: bigint;
      classified: bigint;
      unclassified: bigint;
    }]>(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE p.super_sector IS NOT NULL 
                         AND p.super_sector != 'UNCLASSIFIED') AS classified,
        COUNT(*) FILTER (WHERE p.super_sector IS NULL 
                         OR p.super_sector = 'UNCLASSIFIED') AS unclassified
      FROM patents p
      ${portfolioJoin}
      WHERE p.is_quarantined = false
    `);

    // By super-sector
    const bySuperSector = await this.prisma.$queryRawUnsafe<{
      super_sector: string;
      display_name: string;
      patent_count: bigint;
      sector_count: bigint;
    }[]>(`
      SELECT
        COALESCE(p.super_sector, 'UNCLASSIFIED') AS super_sector,
        COALESCE(ss.display_name, 'Unclassified') AS display_name,
        COUNT(*) AS patent_count,
        COUNT(DISTINCT p.primary_sector) AS sector_count
      FROM patents p
      ${portfolioJoin}
      LEFT JOIN super_sectors ss ON p.super_sector = ss.name
      WHERE p.is_quarantined = false
      GROUP BY p.super_sector, ss.display_name
      ORDER BY patent_count DESC
    `);

    // Unclassified breakdown
    const unclassifiedBreakdown = await this.prisma.$queryRawUnsafe<[{
      has_cpc: bigint;
      no_cpc: bigint;
      quarantined: bigint;
    }]>(`
      SELECT
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM patent_cpc_codes pc WHERE pc.patent_id = p.patent_id
        )) AS has_cpc,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM patent_cpc_codes pc WHERE pc.patent_id = p.patent_id
        )) AS no_cpc,
        0::bigint AS quarantined
      FROM patents p
      ${portfolioJoin}
      WHERE p.is_quarantined = false
        AND (p.super_sector IS NULL OR p.super_sector = 'UNCLASSIFIED')
    `);

    // Sample unmatched patents (have CPCs but no classification)
    const samples = await this.prisma.$queryRawUnsafe<{
      patent_id: string;
      title: string;
      cpc_codes: string[];
    }[]>(`
      SELECT
        p.patent_id,
        p.title,
        ARRAY_AGG(pc.cpc_code ORDER BY pc.cpc_code) AS cpc_codes
      FROM patents p
      ${portfolioJoin}
      JOIN patent_cpc_codes pc ON p.patent_id = pc.patent_id
      WHERE p.is_quarantined = false
        AND (p.super_sector IS NULL OR p.super_sector = 'UNCLASSIFIED')
      GROUP BY p.patent_id, p.title
      LIMIT 20
    `);

    const total = Number(overview[0].total);
    const classified = Number(overview[0].classified);

    return {
      totalPatents: total,
      classified,
      unclassified: Number(overview[0].unclassified),
      classifiedPct: total > 0 ? classified / total : 0,
      bySuperSector: bySuperSector.map(r => ({
        superSector: r.super_sector,
        displayName: r.display_name,
        patentCount: Number(r.patent_count),
        pctOfTotal: total > 0 ? Number(r.patent_count) / total : 0,
        sectorCount: Number(r.sector_count),
      })),
      unclassifiedAnalysis: {
        hasCpcCodes: Number(unclassifiedBreakdown[0].has_cpc),
        noCpcCodes: Number(unclassifiedBreakdown[0].no_cpc),
        quarantined: Number(unclassifiedBreakdown[0].quarantined),
        sampleUnmatched: samples,
      },
    };
  }
```

### 2.4 Module 3: Multi-Classification Potential

This is the most important module. It evaluates what happens when we honor
ALL CPC codes instead of assigning each patent to a single sector.

```typescript
  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 3: MULTI-CLASSIFICATION POTENTIAL
  // "How many patents map to multiple sectors? What are the overlaps?"
  // ═══════════════════════════════════════════════════════════════════════

  async getMultiClassificationAnalysis(
    scope: ScopeFilter = {},
  ): Promise<MultiClassificationAnalysis> {
    const matchCte = this.cpcSectorMatchCte(scope);

    // Step 1: For each patent, count how many DISTINCT sectors its CPCs map to
    const sectorCounts = await this.prisma.$queryRawUnsafe<{
      sector_count: number;
      patent_count: bigint;
    }[]>(`
      WITH ${matchCte},
      patent_sector_counts AS (
        SELECT
          patent_id,
          COUNT(DISTINCT sector_name) AS sector_count
        FROM cpc_sector_matches
        GROUP BY patent_id
      )
      SELECT
        sector_count::int,
        COUNT(*) AS patent_count
      FROM patent_sector_counts
      GROUP BY sector_count
      ORDER BY sector_count
    `);

    // Also count patents with CPCs but no rule match (they map to 0 sectors)
    const totalAnalyzed = sectorCounts.reduce(
      (sum, r) => sum + Number(r.patent_count), 0
    );

    const summary = {
      totalPatentsAnalyzed: totalAnalyzed,
      singleSector: 0,
      twoSectors: 0,
      threeSectors: 0,
      fourPlusSectors: 0,
      avgSectorsPerPatent: 0,
      medianSectorsPerPatent: 0,
    };

    let weightedSum = 0;
    for (const r of sectorCounts) {
      const count = Number(r.patent_count);
      weightedSum += r.sector_count * count;
      if (r.sector_count === 1) summary.singleSector = count;
      else if (r.sector_count === 2) summary.twoSectors = count;
      else if (r.sector_count === 3) summary.threeSectors = count;
      else if (r.sector_count >= 4) summary.fourPlusSectors += count;
    }
    summary.avgSectorsPerPatent = totalAnalyzed > 0
      ? Math.round((weightedSum / totalAnalyzed) * 100) / 100
      : 0;

    // Step 2: Most common sector PAIRS among multi-classified patents
    const topPairs = await this.prisma.$queryRawUnsafe<{
      sector_a: string;
      sector_b: string;
      super_sector_a: string;
      super_sector_b: string;
      pair_count: bigint;
    }[]>(`
      WITH ${matchCte},
      patent_sectors AS (
        SELECT DISTINCT patent_id, sector_name, super_sector_name
        FROM cpc_sector_matches
      )
      SELECT
        ps1.sector_name AS sector_a,
        ps2.sector_name AS sector_b,
        ps1.super_sector_name AS super_sector_a,
        ps2.super_sector_name AS super_sector_b,
        COUNT(DISTINCT ps1.patent_id) AS pair_count
      FROM patent_sectors ps1
      JOIN patent_sectors ps2
        ON ps1.patent_id = ps2.patent_id
        AND ps1.sector_name < ps2.sector_name
      GROUP BY ps1.sector_name, ps2.sector_name,
               ps1.super_sector_name, ps2.super_sector_name
      ORDER BY pair_count DESC
      LIMIT 30
    `);

    // Step 3: Most common sector TRIPLES
    const topTriples = await this.prisma.$queryRawUnsafe<{
      sectors: string[];
      triple_count: bigint;
    }[]>(`
      WITH ${matchCte},
      patent_sectors AS (
        SELECT DISTINCT patent_id, sector_name
        FROM cpc_sector_matches
      ),
      patent_sector_arrays AS (
        SELECT patent_id, 
               ARRAY_AGG(DISTINCT sector_name ORDER BY sector_name) AS sectors
        FROM patent_sectors
        GROUP BY patent_id
        HAVING COUNT(DISTINCT sector_name) >= 3
      )
      SELECT sectors, COUNT(*) AS triple_count
      FROM patent_sector_arrays
      WHERE array_length(sectors, 1) = 3
      GROUP BY sectors
      ORDER BY triple_count DESC
      LIMIT 15
    `);

    // Step 4: Internal vs external overlap by super-sector
    const overlapBySuperSector = await this.prisma.$queryRawUnsafe<{
      super_sector: string;
      total_multi: bigint;
      internal_overlap: bigint;
      external_overlap: bigint;
    }[]>(`
      WITH ${matchCte},
      patent_sectors AS (
        SELECT DISTINCT patent_id, sector_name, super_sector_name
        FROM cpc_sector_matches
      ),
      multi_patents AS (
        SELECT patent_id
        FROM patent_sectors
        GROUP BY patent_id
        HAVING COUNT(DISTINCT sector_name) > 1
      ),
      patent_super_sector_counts AS (
        SELECT
          ps.patent_id,
          ps.super_sector_name,
          COUNT(DISTINCT ps.sector_name) AS sectors_in_this_ss,
          (SELECT COUNT(DISTINCT ps2.super_sector_name)
           FROM patent_sectors ps2
           WHERE ps2.patent_id = ps.patent_id) AS total_super_sectors
        FROM patent_sectors ps
        WHERE ps.patent_id IN (SELECT patent_id FROM multi_patents)
        GROUP BY ps.patent_id, ps.super_sector_name
      )
      SELECT
        super_sector_name AS super_sector,
        COUNT(DISTINCT patent_id) AS total_multi,
        COUNT(DISTINCT patent_id) FILTER (
          WHERE sectors_in_this_ss > 1 AND total_super_sectors = 1
        ) AS internal_overlap,
        COUNT(DISTINCT patent_id) FILTER (
          WHERE total_super_sectors > 1
        ) AS external_overlap
      FROM patent_super_sector_counts
      GROUP BY super_sector_name
      ORDER BY total_multi DESC
    `);

    return {
      summary,
      topSectorPairs: topPairs.map(r => ({
        sectorA: r.sector_a,
        sectorB: r.sector_b,
        superSectorA: r.super_sector_a,
        superSectorB: r.super_sector_b,
        patentCount: Number(r.pair_count),
        sameSuperSector: r.super_sector_a === r.super_sector_b,
      })),
      topSectorTriples: topTriples.map(r => ({
        sectors: r.sectors,
        patentCount: Number(r.triple_count),
      })),
      overlapBySuperSector: overlapBySuperSector.map(r => ({
        superSector: r.super_sector,
        totalPatentsWithMultiple: Number(r.total_multi),
        internalOverlap: Number(r.internal_overlap),
        externalOverlap: Number(r.external_overlap),
      })),
    };
  }

  /**
   * Detailed classification analysis for a single patent.
   * Shows every CPC code, which rules match, and what alternative
   * classifications would be possible.
   */
  async getPatentClassificationDetail(
    patentId: string,
  ): Promise<PatentClassificationDetail> {
    // Get the patent
    const patent = await this.prisma.patent.findUniqueOrThrow({
      where: { patentId },
      select: {
        patentId: true, title: true, assignee: true, grantDate: true,
        superSector: true, primarySector: true, primarySubSectorName: true,
        primaryCpc: true,
      },
    });

    // Get all CPC codes with their titles
    const cpcCodes = await this.prisma.$queryRawUnsafe<{
      cpc_code: string;
      is_inventive: boolean;
      title: string | null;
      level: string | null;
    }[]>(`
      SELECT pc.cpc_code, pc.is_inventive, cc.title, cc.level
      FROM patent_cpc_codes pc
      LEFT JOIN cpc_codes cc ON cc.code = pc.cpc_code
      WHERE pc.patent_id = '${patentId}'
      ORDER BY pc.is_inventive DESC, pc.cpc_code
    `);

    // For each CPC code, find matching sector rules
    const ruleMatches = await this.prisma.$queryRawUnsafe<{
      cpc_code: string;
      sector_name: string;
      super_sector_name: string;
      rule_type: string;
      expression: string;
      rule_id: string;
    }[]>(`
      SELECT
        pc.cpc_code,
        s.name AS sector_name,
        COALESCE(ss.name, 'UNASSIGNED') AS super_sector_name,
        sr.rule_type,
        sr.expression,
        sr.id AS rule_id
      FROM patent_cpc_codes pc
      JOIN sector_rules sr ON (
        sr.is_active = true
        AND sr.is_exclusion = false
        AND (
          (sr.rule_type = 'CPC_PREFIX' AND pc.cpc_code LIKE sr.expression || '%')
          OR (sr.rule_type = 'CPC_SUBGROUP' AND pc.cpc_code = sr.expression)
        )
      )
      JOIN sectors s ON sr.sector_id = s.id
      LEFT JOIN super_sectors ss ON s.super_sector_id = ss.id
      WHERE pc.patent_id = '${patentId}'
      ORDER BY pc.cpc_code, s.name
    `);

    // Build per-CPC match map
    const matchMap = new Map<string, typeof ruleMatches>();
    for (const m of ruleMatches) {
      if (!matchMap.has(m.cpc_code)) matchMap.set(m.cpc_code, []);
      matchMap.get(m.cpc_code)!.push(m);
    }

    // Build potential classifications
    const sectorAgg = new Map<string, {
      sectorName: string;
      superSectorName: string;
      matchingCpcCount: number;
      inventiveCpcCount: number;
    }>();

    const totalCpcs = cpcCodes.length;
    const cpcDetails = cpcCodes.map(cpc => {
      const matches = matchMap.get(cpc.cpc_code) || [];
      // Aggregate into potential classifications
      for (const m of matches) {
        const key = m.sector_name;
        if (!sectorAgg.has(key)) {
          sectorAgg.set(key, {
            sectorName: m.sector_name,
            superSectorName: m.super_sector_name,
            matchingCpcCount: 0,
            inventiveCpcCount: 0,
          });
        }
        const agg = sectorAgg.get(key)!;
        agg.matchingCpcCount++;
        if (cpc.is_inventive) agg.inventiveCpcCount++;
      }

      return {
        code: cpc.cpc_code,
        isInventive: cpc.is_inventive,
        title: cpc.title,
        level: cpc.level || 'SUBGROUP',
        matchingRules: matches.map(m => ({
          sectorName: m.sector_name,
          superSectorName: m.super_sector_name,
          ruleType: m.rule_type,
          ruleExpression: m.expression,
          ruleId: m.rule_id,
        })),
      };
    });

    const potentialClassifications = [...sectorAgg.values()]
      .map(agg => ({
        ...agg,
        cpcCoverageRatio: totalCpcs > 0 ? agg.matchingCpcCount / totalCpcs : 0,
        isPrimary: agg.sectorName === patent.primarySector,
      }))
      .sort((a, b) => b.matchingCpcCount - a.matchingCpcCount);

    // Determine confidence
    let confidence: PatentClassificationDetail['classificationConfidence'] = 'ambiguous';
    if (potentialClassifications.length === 0) {
      confidence = 'low';
    } else {
      const topRatio = potentialClassifications[0].cpcCoverageRatio;
      if (topRatio >= 0.7) confidence = 'high';
      else if (topRatio >= 0.4) confidence = 'medium';
      else if (potentialClassifications.length >= 2 &&
        potentialClassifications[0].matchingCpcCount ===
        potentialClassifications[1].matchingCpcCount) {
        confidence = 'ambiguous';
      } else {
        confidence = 'low';
      }
    }

    return {
      patentId: patent.patentId,
      title: patent.title,
      assignee: patent.assignee,
      grantDate: patent.grantDate,
      currentSuperSector: patent.superSector,
      currentSector: patent.primarySector,
      currentSubSector: patent.primarySubSectorName,
      currentPrimaryCpc: patent.primaryCpc,
      cpcCodes: cpcDetails,
      potentialClassifications,
      classificationConfidence: confidence,
    };
  }

  /**
   * Batch version: classification confidence across all patents.
   * Useful for understanding how many patents have clear vs ambiguous
   * sector assignments.
   */
  async getClassificationConfidenceDistribution(
    scope: ScopeFilter = {},
  ): Promise<{
    high: number;
    medium: number;
    low: number;
    ambiguous: number;
    noMatch: number;
    details: {
      superSector: string;
      high: number; medium: number; low: number; ambiguous: number;
    }[];
  }> {
    const matchCte = this.cpcSectorMatchCte(scope);

    const rows = await this.prisma.$queryRawUnsafe<{
      super_sector: string;
      confidence: string;
      patent_count: bigint;
    }[]>(`
      WITH ${matchCte},
      patent_totals AS (
        SELECT p.patent_id, p.super_sector,
          COALESCE(
            (SELECT COUNT(DISTINCT cpc_code) FROM patent_cpc_codes 
             WHERE patent_id = p.patent_id), 0
          ) AS total_cpcs
        FROM patents p
        ${scope.portfolioId ? `JOIN portfolio_patents pp ON p.patent_id = pp.patent_id 
          AND pp.portfolio_id = '${scope.portfolioId}'` : ''}
        WHERE p.is_quarantined = false
          ${scope.superSector ? `AND p.super_sector = '${scope.superSector}'` : ''}
      ),
      patent_top_sector AS (
        SELECT
          csm.patent_id,
          pt.super_sector,
          pt.total_cpcs,
          MAX(sector_cpc_count) AS top_sector_cpcs,
          COUNT(DISTINCT csm.sector_name) AS num_sectors
        FROM (
          SELECT patent_id, sector_name, COUNT(DISTINCT cpc_code) AS sector_cpc_count
          FROM cpc_sector_matches
          GROUP BY patent_id, sector_name
        ) csm
        JOIN patent_totals pt ON csm.patent_id = pt.patent_id
        GROUP BY csm.patent_id, pt.super_sector, pt.total_cpcs
      )
      SELECT
        COALESCE(super_sector, 'UNCLASSIFIED') AS super_sector,
        CASE
          WHEN total_cpcs = 0 THEN 'noMatch'
          WHEN top_sector_cpcs IS NULL THEN 'noMatch'
          WHEN top_sector_cpcs::float / GREATEST(total_cpcs, 1) >= 0.7 THEN 'high'
          WHEN top_sector_cpcs::float / GREATEST(total_cpcs, 1) >= 0.4 THEN 'medium'
          WHEN num_sectors >= 2 THEN 'ambiguous'
          ELSE 'low'
        END AS confidence,
        COUNT(*) AS patent_count
      FROM patent_top_sector
      GROUP BY super_sector, confidence
      ORDER BY super_sector, confidence
    `);

    // Aggregate
    const totals = { high: 0, medium: 0, low: 0, ambiguous: 0, noMatch: 0 };
    const bySs = new Map<string, typeof totals>();

    for (const r of rows) {
      const count = Number(r.patent_count);
      const conf = r.confidence as keyof typeof totals;
      totals[conf] = (totals[conf] || 0) + count;
      if (!bySs.has(r.super_sector)) {
        bySs.set(r.super_sector, { high: 0, medium: 0, low: 0, ambiguous: 0, noMatch: 0 });
      }
      bySs.get(r.super_sector)![conf] += count;
    }

    return {
      ...totals,
      details: [...bySs.entries()].map(([ss, counts]) => ({
        superSector: ss,
        ...counts,
      })),
    };
  }
```

### 2.5 Module 4: Portfolio Comparison

```typescript
  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 4: PORTFOLIO COMPARISON
  // "Do different portfolios need different taxonomies?"
  // ═══════════════════════════════════════════════════════════════════════

  async getPortfolioTaxonomyComparison(
    portfolioIds: string[],
  ): Promise<PortfolioTaxonomyComparison> {
    // Get portfolio info
    const portfolios = await this.prisma.portfolio.findMany({
      where: { id: { in: portfolioIds } },
      select: { id: true, name: true, patentCount: true },
    });

    // Super-sector distribution per portfolio
    const ssDist = await this.prisma.$queryRawUnsafe<{
      portfolio_id: string;
      super_sector: string;
      cnt: bigint;
    }[]>(`
      SELECT
        pp.portfolio_id,
        COALESCE(p.super_sector, 'UNCLASSIFIED') AS super_sector,
        COUNT(*) AS cnt
      FROM portfolio_patents pp
      JOIN patents p ON pp.patent_id = p.patent_id
      WHERE pp.portfolio_id = ANY(ARRAY[${portfolioIds.map(id => `'${id}'`).join(',')}])
        AND p.is_quarantined = false
      GROUP BY pp.portfolio_id, p.super_sector
    `);

    // Build distribution map
    const superSectors = [...new Set(ssDist.map(r => r.super_sector))].sort();
    const portfolioCounts = new Map<string, number>();
    for (const p of portfolios) {
      portfolioCounts.set(p.id, p.patentCount || 0);
    }

    const superSectorDistribution = superSectors.map(ss => {
      const byPortfolio: Record<string, { count: number; pct: number }> = {};
      for (const pid of portfolioIds) {
        const row = ssDist.find(r => r.portfolio_id === pid && r.super_sector === ss);
        const count = row ? Number(row.cnt) : 0;
        const total = portfolioCounts.get(pid) || 1;
        byPortfolio[pid] = { count, pct: count / total };
      }
      return { superSector: ss, byPortfolio };
    });

    // Discriminating CPCs — CPC codes dominant in one portfolio
    const discCpcs = await this.prisma.$queryRawUnsafe<{
      cpc_prefix: string;
      cpc_title: string | null;
      portfolio_id: string;
      pct_in_portfolio: number;
      avg_pct_others: number;
    }[]>(`
      WITH portfolio_cpc_counts AS (
        SELECT
          pp.portfolio_id,
          LEFT(pc.cpc_code, 4) AS cpc_prefix,
          COUNT(DISTINCT p.patent_id) AS cnt,
          COUNT(DISTINCT p.patent_id)::float / NULLIF(
            (SELECT COUNT(*) FROM portfolio_patents pp2
             JOIN patents p2 ON pp2.patent_id = p2.patent_id
             WHERE pp2.portfolio_id = pp.portfolio_id AND p2.is_quarantined = false),
          0) AS pct
        FROM portfolio_patents pp
        JOIN patents p ON pp.patent_id = p.patent_id
        JOIN patent_cpc_codes pc ON p.patent_id = pc.patent_id
        WHERE pp.portfolio_id = ANY(ARRAY[${portfolioIds.map(id => `'${id}'`).join(',')}])
          AND p.is_quarantined = false
        GROUP BY pp.portfolio_id, LEFT(pc.cpc_code, 4)
      ),
      avg_pcts AS (
        SELECT cpc_prefix, AVG(pct) AS avg_pct
        FROM portfolio_cpc_counts
        GROUP BY cpc_prefix
      )
      SELECT
        pcc.cpc_prefix,
        cc.title AS cpc_title,
        pcc.portfolio_id,
        pcc.pct AS pct_in_portfolio,
        ap.avg_pct AS avg_pct_others
      FROM portfolio_cpc_counts pcc
      JOIN avg_pcts ap ON pcc.cpc_prefix = ap.cpc_prefix
      LEFT JOIN cpc_codes cc ON cc.code = pcc.cpc_prefix
      WHERE pcc.pct > ap.avg_pct * 2  -- At least 2x the average
        AND pcc.cnt >= 20              -- Minimum significance
      ORDER BY (pcc.pct - ap.avg_pct) DESC
      LIMIT 40
    `);

    // Jaccard similarity on CPC sets between portfolio pairs
    const similarity = await this.prisma.$queryRawUnsafe<{
      pa: string;
      pb: string;
      jaccard: number;
    }[]>(`
      WITH portfolio_cpc_sets AS (
        SELECT pp.portfolio_id,
               ARRAY_AGG(DISTINCT LEFT(pc.cpc_code, 4)) AS cpc_set
        FROM portfolio_patents pp
        JOIN patents p ON pp.patent_id = p.patent_id
        JOIN patent_cpc_codes pc ON p.patent_id = pc.patent_id
        WHERE pp.portfolio_id = ANY(ARRAY[${portfolioIds.map(id => `'${id}'`).join(',')}])
          AND p.is_quarantined = false
        GROUP BY pp.portfolio_id
      )
      SELECT
        a.portfolio_id AS pa,
        b.portfolio_id AS pb,
        (SELECT COUNT(*) FROM unnest(a.cpc_set) x 
         WHERE x = ANY(b.cpc_set))::float /
        NULLIF(
          (SELECT COUNT(DISTINCT v) FROM (
            SELECT unnest(a.cpc_set) AS v UNION SELECT unnest(b.cpc_set)
          ) u),
        0) AS jaccard
      FROM portfolio_cpc_sets a
      CROSS JOIN portfolio_cpc_sets b
      WHERE a.portfolio_id < b.portfolio_id
    `);

    return {
      portfolios: portfolios.map(p => ({
        id: p.id, name: p.name, patentCount: p.patentCount || 0,
      })),
      superSectorDistribution,
      discriminatingCpcs: discCpcs.map(r => ({
        cpcCode: r.cpc_prefix,
        cpcTitle: r.cpc_title,
        dominantPortfolio: r.portfolio_id,
        dominantPct: r.pct_in_portfolio,
        otherPortfolioAvgPct: r.avg_pct_others,
        discriminationScore: r.pct_in_portfolio - r.avg_pct_others,
      })),
      sectorCoverage: [],  // Populated similarly to superSectorDistribution
      similarityMatrix: similarity.map(r => ({
        portfolioA: r.pa,
        portfolioB: r.pb,
        jaccardCpc: r.jaccard,
        jaccardSuperSector: 0,  // Can compute separately
      })),
    };
  }
```

### 2.6 Module 5: Sector Balance

```typescript
  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 5: SECTOR BALANCE
  // "Which sectors are too big or too small? Where should we split/merge?"
  // ═══════════════════════════════════════════════════════════════════════

  async getSectorBalanceAnalysis(
    scope: ScopeFilter = {},
  ): Promise<SectorBalanceAnalysis> {
    const portfolioJoin = scope.portfolioId
      ? `JOIN portfolio_patents pp ON p.patent_id = pp.patent_id 
             AND pp.portfolio_id = '${scope.portfolioId}'`
      : '';

    // Sector sizes with CPC concentration
    const sectors = await this.prisma.$queryRawUnsafe<{
      sector_name: string;
      super_sector: string;
      patent_count: bigint;
      target_min: number | null;
      target_max: number | null;
      top_cpcs: { code: string; title: string | null; count: number }[];
    }[]>(`
      WITH sector_patents AS (
        SELECT p.primary_sector, p.patent_id
        FROM patents p
        ${portfolioJoin}
        WHERE p.is_quarantined = false
          AND p.primary_sector IS NOT NULL
          ${scope.superSector ? `AND p.super_sector = '${scope.superSector}'` : ''}
      ),
      sector_sizes AS (
        SELECT primary_sector, COUNT(*) AS patent_count
        FROM sector_patents GROUP BY primary_sector
      ),
      sector_top_cpcs AS (
        SELECT
          sp.primary_sector,
          LEFT(pc.cpc_code, 4) AS cpc_prefix,
          cc.title AS cpc_title,
          COUNT(DISTINCT sp.patent_id) AS cpc_count
        FROM sector_patents sp
        JOIN patent_cpc_codes pc ON sp.patent_id = pc.patent_id
        LEFT JOIN cpc_codes cc ON cc.code = LEFT(pc.cpc_code, 4)
        GROUP BY sp.primary_sector, LEFT(pc.cpc_code, 4), cc.title
      ),
      sector_top_ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY primary_sector ORDER BY cpc_count DESC) AS rn
        FROM sector_top_cpcs
      )
      SELECT
        s.name AS sector_name,
        COALESCE(ss.name, 'UNASSIGNED') AS super_sector,
        COALESCE(sz.patent_count, 0) AS patent_count,
        s.target_min_size AS target_min,
        s.target_max_size AS target_max,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'code', str.cpc_prefix, 'title', str.cpc_title, 'count', str.cpc_count
          ) ORDER BY str.cpc_count DESC)
          FROM sector_top_ranked str 
          WHERE str.primary_sector = s.name AND str.rn <= 5),
          '[]'
        )::json AS top_cpcs
      FROM sectors s
      LEFT JOIN super_sectors ss ON s.super_sector_id = ss.id
      LEFT JOIN sector_sizes sz ON s.name = sz.primary_sector
      ORDER BY patent_count DESC
    `);

    // Compute overview stats
    const sizes = sectors.map(s => Number(s.patent_count));
    const totalPatents = sizes.reduce((a, b) => a + b, 0);
    const avgSize = totalPatents / Math.max(sizes.length, 1);
    const sortedSizes = [...sizes].sort((a, b) => a - b);
    const medianSize = sortedSizes[Math.floor(sortedSizes.length / 2)] || 0;

    // Gini coefficient
    let gini = 0;
    if (sizes.length > 0 && totalPatents > 0) {
      const n = sizes.length;
      const sorted = [...sizes].sort((a, b) => a - b);
      let numerator = 0;
      for (let i = 0; i < n; i++) {
        numerator += (2 * (i + 1) - n - 1) * sorted[i];
      }
      gini = numerator / (n * totalPatents);
    }

    // Classify each sector
    const DEFAULT_MIN = 20;
    const DEFAULT_MAX = 500;

    return {
      overview: {
        totalSectors: sectors.length,
        totalPatents,
        avgSectorSize: Math.round(avgSize),
        medianSectorSize: medianSize,
        giniCoefficient: Math.round(gini * 1000) / 1000,
      },
      sectors: sectors.map(s => {
        const count = Number(s.patent_count);
        const min = s.target_min ?? DEFAULT_MIN;
        const max = s.target_max ?? DEFAULT_MAX;

        let status: 'critically_small' | 'undersized' | 'ok' | 'oversized' | 'critically_large';
        if (count < min / 2) status = 'critically_small';
        else if (count < min) status = 'undersized';
        else if (count > max * 2) status = 'critically_large';
        else if (count > max) status = 'oversized';
        else status = 'ok';

        // CPC concentration (HHI)
        const topCpcs = (s.top_cpcs as any[]) || [];
        let hhi = 0;
        if (count > 0) {
          for (const cpc of topCpcs) {
            const share = cpc.count / count;
            hhi += share * share;
          }
        }

        // Split candidates for oversized sectors
        const splitCandidates = status === 'oversized' || status === 'critically_large'
          ? topCpcs
              .filter((c: any) => c.count >= DEFAULT_MIN)
              .slice(0, 5)
              .map((c: any) => ({
                cpcCode: c.code,
                patentCount: c.count,
                wouldCreateSectorOfSize: c.count,
              }))
          : null;

        return {
          sectorName: s.sector_name,
          superSector: s.super_sector,
          patentCount: count,
          status,
          targetMin: s.target_min,
          targetMax: s.target_max,
          topCpcCodes: topCpcs.map((c: any) => ({
            code: c.code,
            title: c.title,
            count: c.count,
            pctOfSector: count > 0 ? c.count / count : 0,
          })),
          cpcConcentration: Math.round(hhi * 1000) / 1000,
          splitCandidates,
          mergeCandidate: null, // Computed in a follow-up pass
        };
      }),
    };
  }
```

### 2.7 Module 6: Rule Effectiveness

```typescript
  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 6: RULE EFFECTIVENESS
  // "Which rules are matching? Which are redundant or conflicting?"
  // ═══════════════════════════════════════════════════════════════════════

  async getRuleEffectiveness(
    opts: { sectorId?: string; scope?: ScopeFilter } = {},
  ): Promise<RuleEffectivenessReport> {
    const scope = opts.scope || {};

    // Overview counts
    const overview = await this.prisma.sectorRule.groupBy({
      by: ['ruleType', 'scope', 'isActive', 'isExclusion'],
      _count: true,
    });

    // Per-rule match counts using the actual matching logic
    const portfolioFilter = scope.portfolioId
      ? `AND pc.patent_id IN (
           SELECT patent_id FROM portfolio_patents 
           WHERE portfolio_id = '${scope.portfolioId}'
         )`
      : '';
    const sectorFilter = opts.sectorId
      ? `AND sr.sector_id = '${opts.sectorId}'`
      : '';

    const ruleMatches = await this.prisma.$queryRawUnsafe<{
      rule_id: string;
      sector_name: string;
      super_sector_name: string;
      rule_type: string;
      expression: string;
      scope: string;
      priority: number;
      is_exclusion: boolean;
      is_active: boolean;
      matched_count: bigint;
    }[]>(`
      SELECT
        sr.id AS rule_id,
        s.name AS sector_name,
        COALESCE(ss.name, 'UNASSIGNED') AS super_sector_name,
        sr.rule_type,
        sr.expression,
        sr.scope,
        sr.priority,
        sr.is_exclusion,
        sr.is_active,
        COUNT(DISTINCT pc.patent_id) AS matched_count
      FROM sector_rules sr
      JOIN sectors s ON sr.sector_id = s.id
      LEFT JOIN super_sectors ss ON s.super_sector_id = ss.id
      LEFT JOIN patent_cpc_codes pc ON (
        (sr.rule_type = 'CPC_PREFIX' AND pc.cpc_code LIKE sr.expression || '%')
        OR (sr.rule_type = 'CPC_SUBGROUP' AND pc.cpc_code = sr.expression)
      )
      ${portfolioFilter}
      ${sectorFilter}
      WHERE sr.rule_type IN ('CPC_PREFIX', 'CPC_SUBGROUP')
      GROUP BY sr.id, s.name, ss.name, sr.rule_type, sr.expression,
               sr.scope, sr.priority, sr.is_exclusion, sr.is_active
      ORDER BY matched_count DESC
    `);

    // Find conflicts: rules from DIFFERENT sectors matching the SAME patents
    const conflicts = await this.prisma.$queryRawUnsafe<{
      rule_a: string;
      sector_a: string;
      rule_b: string;
      sector_b: string;
      overlap_count: bigint;
    }[]>(`
      WITH rule_patent_sets AS (
        SELECT
          sr.id AS rule_id,
          s.name AS sector_name,
          ARRAY_AGG(DISTINCT pc.patent_id) AS patent_ids,
          COUNT(DISTINCT pc.patent_id) AS cnt
        FROM sector_rules sr
        JOIN sectors s ON sr.sector_id = s.id
        JOIN patent_cpc_codes pc ON (
          (sr.rule_type = 'CPC_PREFIX' AND pc.cpc_code LIKE sr.expression || '%')
          OR (sr.rule_type = 'CPC_SUBGROUP' AND pc.cpc_code = sr.expression)
        )
        WHERE sr.is_active = true AND sr.is_exclusion = false
          AND sr.rule_type IN ('CPC_PREFIX', 'CPC_SUBGROUP')
          ${sectorFilter}
        GROUP BY sr.id, s.name
        HAVING COUNT(DISTINCT pc.patent_id) > 0
      )
      SELECT
        a.rule_id AS rule_a, a.sector_name AS sector_a,
        b.rule_id AS rule_b, b.sector_name AS sector_b,
        (SELECT COUNT(*) FROM unnest(a.patent_ids) x 
         WHERE x = ANY(b.patent_ids))::bigint AS overlap_count
      FROM rule_patent_sets a
      JOIN rule_patent_sets b ON a.rule_id < b.rule_id
        AND a.sector_name != b.sector_name
      WHERE (SELECT COUNT(*) FROM unnest(a.patent_ids) x 
             WHERE x = ANY(b.patent_ids)) > 0
      ORDER BY overlap_count DESC
      LIMIT 50
    `);

    // Build conflict map
    const conflictMap = new Map<string, { ruleId: string; sectorName: string; overlapCount: number }[]>();
    for (const c of conflicts) {
      const countNum = Number(c.overlap_count);
      if (!conflictMap.has(c.rule_a)) conflictMap.set(c.rule_a, []);
      if (!conflictMap.has(c.rule_b)) conflictMap.set(c.rule_b, []);
      conflictMap.get(c.rule_a)!.push({ ruleId: c.rule_b, sectorName: c.sector_b, overlapCount: countNum });
      conflictMap.get(c.rule_b)!.push({ ruleId: c.rule_a, sectorName: c.sector_a, overlapCount: countNum });
    }

    // Orphaned patents (no rule matches)
    const orphaned = await this.prisma.$queryRawUnsafe<{
      patent_id: string; title: string; cpc_codes: string[];
    }[]>(`
      SELECT p.patent_id, p.title,
             ARRAY_AGG(pc.cpc_code ORDER BY pc.cpc_code) AS cpc_codes
      FROM patents p
      JOIN patent_cpc_codes pc ON p.patent_id = pc.patent_id
      ${scope.portfolioId ? `JOIN portfolio_patents pp ON p.patent_id = pp.patent_id 
        AND pp.portfolio_id = '${scope.portfolioId}'` : ''}
      WHERE p.is_quarantined = false
        AND NOT EXISTS (
          SELECT 1 FROM sector_rules sr
          WHERE sr.is_active = true AND sr.is_exclusion = false
            AND sr.rule_type IN ('CPC_PREFIX', 'CPC_SUBGROUP')
            AND (
              (sr.rule_type = 'CPC_PREFIX' AND pc.cpc_code LIKE sr.expression || '%')
              OR (sr.rule_type = 'CPC_SUBGROUP' AND pc.cpc_code = sr.expression)
            )
        )
      GROUP BY p.patent_id, p.title
      LIMIT 30
    `);

    // Build overview
    const byType: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    let totalRules = 0, activeRules = 0, inactiveRules = 0, exclusionRules = 0;
    for (const g of overview) {
      const count = g._count;
      totalRules += count;
      byType[g.ruleType] = (byType[g.ruleType] || 0) + count;
      byScope[g.scope] = (byScope[g.scope] || 0) + count;
      if (g.isActive) activeRules += count; else inactiveRules += count;
      if (g.isExclusion) exclusionRules += count;
    }

    return {
      overview: { totalRules, activeRules, inactiveRules, exclusionRules, byType, byScope },
      rules: ruleMatches.map(r => ({
        ruleId: r.rule_id,
        sectorName: r.sector_name,
        superSector: r.super_sector_name,
        ruleType: r.rule_type,
        expression: r.expression,
        scope: r.scope,
        priority: r.priority,
        isExclusion: r.is_exclusion,
        isActive: r.is_active,
        matchedPatentCount: Number(r.matched_count),
        isRedundant: false,     // Computed in post-processing
        redundantWith: null,
        conflictsWith: conflictMap.get(r.rule_id) || [],
      })),
      orphanedPatents: {
        count: orphaned.length,  // Note: this is capped at 30
        samples: orphaned,
      },
    };
  }
```

### 2.8 Module 7: CPC Hierarchy Analysis

```typescript
  // ═══════════════════════════════════════════════════════════════════════
  // MODULE 7: CPC HIERARCHY ANALYSIS
  // "For a given CPC prefix, what's below it and how do patents distribute?"
  // ═══════════════════════════════════════════════════════════════════════

  async getCpcHierarchy(opts: {
    rootCode: string;           // e.g., "H04L" or "H04L63"
    depth?: number;             // How many levels deep (default 2)
    scope?: ScopeFilter;
    minPatentCount?: number;    // Filter out tiny branches
  }): Promise<CpcHierarchyAnalysis> {
    const depth = opts.depth ?? 2;
    const minCount = opts.minPatentCount ?? 5;
    const scope = opts.scope || {};

    const portfolioJoin = scope.portfolioId
      ? `JOIN portfolio_patents pp ON p.patent_id = pp.patent_id 
             AND pp.portfolio_id = '${scope.portfolioId}'`
      : '';

    // Get all CPC codes under this root with patent counts
    const nodes = await this.prisma.$queryRawUnsafe<{
      code: string;
      title: string | null;
      level: string;
      parent_code: string | null;
      patent_count: bigint;
      sector_name: string | null;
      super_sector_name: string | null;
    }[]>(`
      WITH cpc_patent_counts AS (
        SELECT
          pc.cpc_code,
          COUNT(DISTINCT p.patent_id) AS patent_count
        FROM patent_cpc_codes pc
        JOIN patents p ON pc.patent_id = p.patent_id AND p.is_quarantined = false
        ${portfolioJoin}
        WHERE pc.cpc_code LIKE '${opts.rootCode}%'
        GROUP BY pc.cpc_code
      )
      SELECT
        cc.code,
        cc.title,
        cc.level,
        cc.parent_code,
        COALESCE(cpc.patent_count, 0) AS patent_count,
        s.name AS sector_name,
        ss.name AS super_sector_name
      FROM cpc_codes cc
      LEFT JOIN cpc_patent_counts cpc ON cc.code = cpc.cpc_code
      LEFT JOIN sectors s ON cc.sector_id = s.id
      LEFT JOIN super_sectors ss ON cc.super_sector_id = ss.id
      WHERE cc.code LIKE '${opts.rootCode}%'
        AND COALESCE(cpc.patent_count, 0) >= ${minCount}
      ORDER BY cc.code
    `);

    // Build tree
    const rootTitle = nodes.find(n => n.code === opts.rootCode)?.title || null;
    const nodeMap = new Map<string, CpcHierarchyNode>();

    // First pass: create all nodes
    for (const n of nodes) {
      nodeMap.set(n.code, {
        code: n.code,
        title: n.title,
        level: n.level,
        patentCount: Number(n.patent_count),
        cumulativeCount: Number(n.patent_count),
        currentSector: n.sector_name,
        currentSuperSector: n.super_sector_name,
        children: [],
        isSplitCandidate: Number(n.patent_count) >= 50,
      });
    }

    // Second pass: link children to parents
    for (const [code, node] of nodeMap) {
      if (node.level === 'SUBGROUP' && code.includes('/')) {
        const parentCode = code.split('/')[0];
        const parent = nodeMap.get(parentCode);
        if (parent) {
          parent.children!.push(node);
          parent.cumulativeCount += node.patentCount;
        }
      }
    }

    // Get top-level children (direct children of root)
    const rootNode = nodeMap.get(opts.rootCode);
    const children = rootNode?.children || 
      [...nodeMap.values()].filter(n => 
        n.code !== opts.rootCode && 
        n.code.startsWith(opts.rootCode) &&
        (n.level === 'GROUP' || n.level === 'SUBGROUP')
      );

    const totalPatents = children.reduce((sum, c) => sum + c.cumulativeCount, 0);

    return {
      root: opts.rootCode,
      rootTitle,
      totalPatentsUnder: totalPatents,
      children: children.sort((a, b) => b.cumulativeCount - a.cumulativeCount),
    };
  }
}
```

---

## 3. REST Routes

```typescript
// routes/taxonomy-analysis-routes.ts

import { Router } from 'express';
import { TaxonomyAnalysisService } from '../services/taxonomy-analysis/taxonomy-analysis-service';
import type { ScopeFilter } from '../services/taxonomy-analysis/types';

export function registerTaxonomyAnalysisRoutes(
  router: Router,
  service: TaxonomyAnalysisService,
) {
  // Helper: extract scope from query params
  function parseScope(query: any): ScopeFilter {
    return {
      portfolioId: query.portfolioId as string | undefined,
      superSector: query.superSector as string | undefined,
      sector: query.sector as string | undefined,
      excludeQuarantined: query.excludeQuarantined !== 'false',
      excludeExpired: query.excludeExpired === 'true',
    };
  }

  // ── Module 1: CPC Distribution ──

  router.get('/api/analysis/taxonomy/cpc-distribution', async (req, res) => {
    const result = await service.getCpcDistribution(parseScope(req.query));
    res.json(result);
  });

  router.get('/api/analysis/taxonomy/top-cpc', async (req, res) => {
    const result = await service.getTopCpcCodes({
      scope: parseScope(req.query),
      level: req.query.level as any,
      limit: parseInt(req.query.limit as string) || 50,
    });
    res.json(result);
  });

  // ── Module 2: Classification Coverage ──

  router.get('/api/analysis/taxonomy/coverage', async (req, res) => {
    const result = await service.getClassificationCoverage(parseScope(req.query));
    res.json(result);
  });

  // ── Module 3: Multi-Classification ──

  router.get('/api/analysis/taxonomy/multi-classification', async (req, res) => {
    const result = await service.getMultiClassificationAnalysis(parseScope(req.query));
    res.json(result);
  });

  router.get('/api/analysis/taxonomy/patent-detail/:patentId', async (req, res) => {
    const result = await service.getPatentClassificationDetail(req.params.patentId);
    res.json(result);
  });

  router.get('/api/analysis/taxonomy/confidence-distribution', async (req, res) => {
    const result = await service.getClassificationConfidenceDistribution(parseScope(req.query));
    res.json(result);
  });

  // ── Module 4: Portfolio Comparison ──

  router.get('/api/analysis/taxonomy/portfolio-comparison', async (req, res) => {
    const ids = (req.query.portfolioIds as string)?.split(',') || [];
    if (ids.length < 2) {
      return res.status(400).json({ error: 'Provide at least 2 portfolioIds' });
    }
    const result = await service.getPortfolioTaxonomyComparison(ids);
    res.json(result);
  });

  // ── Module 5: Sector Balance ──

  router.get('/api/analysis/taxonomy/sector-balance', async (req, res) => {
    const result = await service.getSectorBalanceAnalysis(parseScope(req.query));
    res.json(result);
  });

  // ── Module 6: Rule Effectiveness ──

  router.get('/api/analysis/taxonomy/rule-effectiveness', async (req, res) => {
    const result = await service.getRuleEffectiveness({
      sectorId: req.query.sectorId as string,
      scope: parseScope(req.query),
    });
    res.json(result);
  });

  // ── Module 7: CPC Hierarchy ──

  router.get('/api/analysis/taxonomy/cpc-hierarchy/:rootCode', async (req, res) => {
    const result = await service.getCpcHierarchy({
      rootCode: req.params.rootCode,
      depth: parseInt(req.query.depth as string) || 2,
      scope: parseScope(req.query),
      minPatentCount: parseInt(req.query.minCount as string) || 5,
    });
    res.json(result);
  });
}
```

---

## 4. Analysis Playbook — Running the Design Investigation

This is the sequence of analyses we run to answer the key taxonomy design questions,
and what each result tells us.

### Step 1: Baseline census

```
GET /api/analysis/taxonomy/cpc-distribution
GET /api/analysis/taxonomy/coverage
```

**What we learn:** How many CPC codes per patent (expect 5-15 typical). What fraction
are classified vs unclassified. Where the gaps are.

**Decision informed:** Whether our rule set is adequate or if we have large
unclassified populations that need new rules.

### Step 2: Multi-classification potential

```
GET /api/analysis/taxonomy/multi-classification
GET /api/analysis/taxonomy/confidence-distribution
```

**What we learn:** What % of patents have CPCs pointing to 2+ sectors. Which sector
pairs overlap most. Whether overlaps are within the same super-sector (less
concerning) or across super-sectors (indicates genuine multi-domain patents).

**Decision informed:** How many taxonomy associations per patent are needed.
If 80% of patents map to 1 sector and the 20% that map to 2+ are mostly within
the same super-sector, then primary+secondary classification within a super-sector
might suffice. If we see lots of cross-super-sector overlap, we need full multi-
classification.

### Step 3: Portfolio divergence

```
GET /api/analysis/taxonomy/portfolio-comparison?portfolioIds=broadcom-core-id,apple-id,nvidia-id
```

**What we learn:** Whether broadcom's CPC distribution is similar enough to
competitors that one taxonomy works, or whether the technology focus is so
different that portfolio-specific weightings or rules are needed.

**Decision informed:** Universal taxonomy vs portfolio-specific taxonomy vs hybrid
(universal structure, portfolio-specific rules/weights).

### Step 4: Sector balance check

```
GET /api/analysis/taxonomy/sector-balance
GET /api/analysis/taxonomy/sector-balance?portfolioId=broadcom-core-id
```

**What we learn:** Which sectors are too large for effective LLM analysis (>500
patents) and which are too small to be statistically meaningful (<20). CPC
concentration tells us whether an oversized sector is dominated by one CPC
cluster (easy to split) or is genuinely diverse (hard to split).

**Decision informed:** Which sectors need refactoring first. Whether sub-sector
generation handles the size problem adequately or if we need sector-level splits.

### Step 5: Per-patent drill-down

```
GET /api/analysis/taxonomy/patent-detail/10002051
```

**What we learn:** For any specific patent, exactly which CPC codes point where,
and how confident the current assignment is. Useful for spot-checking when we
see surprising results in aggregate analysis.

### Step 6: Rule audit

```
GET /api/analysis/taxonomy/rule-effectiveness
```

**What we learn:** Which rules are matching lots of patents (high-value rules),
which match nothing (dead rules), and which conflict with rules from other sectors
(rules that need priority resolution). The conflict data directly shows where
the "which sector wins?" disambiguation logic matters.

**Decision informed:** Whether rule-based classification is robust or whether
we need LLM-assisted classification for ambiguous patents.

### Step 7: CPC hierarchy drill-down

```
GET /api/analysis/taxonomy/cpc-hierarchy/H04L
GET /api/analysis/taxonomy/cpc-hierarchy/H04L63
```

**What we learn:** How patents distribute within a CPC tree. If H04L63 has 2000
patents but H04L63/14 alone has 800, that's a natural split point.

**Decision informed:** Where to draw CPC boundaries for sectors and sub-sectors.
Whether our current CPC prefix rules are at the right granularity.
```

---

## 5. File Organization

```
src/services/taxonomy-analysis/
├── types.ts                          # All interfaces and types
├── taxonomy-analysis-service.ts      # The service class (all 7 modules)
└── index.ts                          # Re-exports

src/routes/
└── taxonomy-analysis-routes.ts       # REST endpoints
```
