/**
 * Taxonomy Analyzer Service
 *
 * Analyzes CPC distribution within taxonomy nodes to inform sub-sector design.
 * Replaces ad-hoc scripts: analyze-network-mgmt-cpc.cjs, analyze-subsector-cpc-dist.cjs,
 * analyze-broadcom-v2.cjs
 *
 * Used by the taxonomy refactor system to understand CPC structure before
 * proposing sub-sector boundaries.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface CpcGroupDistribution {
  cpcGroup: string;
  totalPatents: number;
  inventivePatents: number;
  portfolioCounts: Record<string, number>; // portfolioName → count
}

export interface CpcAnalysisResult {
  sectorCode: string;
  totalPatents: number;
  portfolioBreakdown: Record<string, number>; // portfolioName → count
  cpcPrefixes: string[];                      // top-level CPC prefixes (e.g., H04L41, H04L43)
  groupDistributions: CpcGroupDistribution[];
  dualNumberingDetected: string[];            // CPC classes with 3-digit/4-digit parallel series
}

export interface SubsectorDistribution {
  nodeCode: string;
  nodeName: string;
  totalPatents: number;
  portfolioCounts: Record<string, number>;
  cpcDistribution: {
    granularity: string;         // '7-char', '8-char', 'full-group'
    groups: CpcGroupDistribution[];
  }[];
}

export interface PortfolioDistributionResult {
  portfolioName: string;
  portfolioId: string;
  totalClassified: number;
  nodeDistribution: {
    nodeCode: string;
    nodeName: string;
    primaryCount: number;
    totalCount: number;
  }[];
  multiClassStats: {
    patentsWithMultiple: number;
    avgClassificationsPerPatent: number;
  };
}

export interface AnalyzerOptions {
  /** Portfolio IDs to analyze for per-portfolio sizing (optional) */
  referencePortfolioIds?: string[];
  /** Minimum patents for a CPC group to appear in results */
  minPatentsThreshold?: number;
  /** Maximum groups to return per analysis */
  maxGroups?: number;
}

// =============================================================================
// Service
// =============================================================================

/**
 * Analyze CPC distribution for patents within a taxonomy node.
 *
 * Examines all patent CPC codes to understand how they cluster,
 * what CPC prefixes are represented, and how patents distribute
 * across portfolios — the prerequisite for proposing sub-sectors.
 */
export async function analyzeCpcDistribution(
  sectorNodeId: string,
  options: AnalyzerOptions = {}
): Promise<CpcAnalysisResult> {
  const {
    referencePortfolioIds = [],
    minPatentsThreshold = 5,
    maxGroups = 50,
  } = options;

  // 1. Get sector node info
  const sectorNode = await prisma.taxonomyNode.findUnique({
    where: { id: sectorNodeId },
    select: { id: true, code: true, taxonomyTypeId: true },
  });
  if (!sectorNode) throw new Error(`Node ${sectorNodeId} not found`);

  // 2. Get patent numbers classified to this sector
  const patentNums = await getPatentNumbersForNode(sectorNode.id);

  if (patentNums.length === 0) {
    return {
      sectorCode: sectorNode.code,
      totalPatents: 0,
      portfolioBreakdown: {},
      cpcPrefixes: [],
      groupDistributions: [],
      dualNumberingDetected: [],
    };
  }

  // 3. Portfolio breakdown
  const portfolioBreakdown = await getPortfolioBreakdown(patentNums, referencePortfolioIds);

  // 4. Discover CPC prefixes (5-char level: H04L4, G06F9, etc.)
  const prefixRows = await prisma.$queryRawUnsafe(`
    SELECT
      LEFT(pc.cpc_code, 5) as prefix,
      COUNT(DISTINCT pc.patent_id) as cnt
    FROM patent_cpc_codes pc
    WHERE pc.patent_id = ANY($1::text[])
      AND pc.cpc_code NOT LIKE 'Y%'
    GROUP BY LEFT(pc.cpc_code, 5)
    HAVING COUNT(DISTINCT pc.patent_id) >= $2
    ORDER BY cnt DESC
    LIMIT 20
  `, patentNums, minPatentsThreshold) as { prefix: string; cnt: bigint }[];

  const cpcPrefixes = prefixRows.map((r) => r.prefix);

  // 5. CPC group distribution at the "group" level (e.g., H04L41/06, H04L43/08)
  const groupDistributions = await getCpcGroupDistribution(
    patentNums,
    referencePortfolioIds,
    minPatentsThreshold,
    maxGroups
  );

  // 6. Detect dual numbering (e.g., H04L41/08xx and H04L41/8xx coexisting)
  const dualNumberingDetected = await detectDualNumbering(patentNums, cpcPrefixes);

  return {
    sectorCode: sectorNode.code,
    totalPatents: patentNums.length,
    portfolioBreakdown,
    cpcPrefixes,
    groupDistributions,
    dualNumberingDetected,
  };
}

/**
 * Analyze distribution within existing v2 sub-sectors.
 *
 * For sub-sectors that are too large, this drills into their CPC
 * distribution at multiple granularities to find split opportunities.
 */
export async function analyzeSubsectorDistribution(
  portfolioGroupId: string,
  nodeIds: string[],
  options: AnalyzerOptions = {}
): Promise<SubsectorDistribution[]> {
  const {
    referencePortfolioIds = [],
    minPatentsThreshold = 10,
    maxGroups = 30,
  } = options;

  const results: SubsectorDistribution[] = [];

  for (const nodeId of nodeIds) {
    const node = await prisma.taxonomyNode.findUnique({
      where: { id: nodeId },
      select: { id: true, code: true, name: true },
    });
    if (!node) continue;

    // Get patents classified to this sub-sector (primary only)
    const classifications = await prisma.objectClassification.findMany({
      where: {
        portfolioGroupId,
        taxonomyNodeId: nodeId,
        associationRank: 1,
      },
      select: { objectId: true },
    });
    const patentNums = classifications.map((c) => c.objectId);

    if (patentNums.length === 0) continue;

    // Portfolio counts
    const portfolioCounts = await getPortfolioBreakdown(patentNums, referencePortfolioIds);

    // Multi-granularity CPC distribution
    const cpcDistribution = await getMultiGranularityDistribution(
      patentNums,
      minPatentsThreshold,
      maxGroups
    );

    results.push({
      nodeCode: node.code,
      nodeName: node.name,
      totalPatents: patentNums.length,
      portfolioCounts,
      cpcDistribution,
    });
  }

  return results;
}

/**
 * Analyze how patents in a portfolio group distribute across sub-sectors.
 */
export async function analyzePortfolioDistribution(
  portfolioGroupId: string,
  portfolioIds: string[]
): Promise<PortfolioDistributionResult[]> {
  const results: PortfolioDistributionResult[] = [];

  for (const portfolioId of portfolioIds) {
    // Get portfolio info
    const portfolio = await prisma.portfolio.findUnique({
      where: { id: portfolioId },
      select: { id: true, name: true },
    });
    if (!portfolio) continue;

    // Get patent numbers in this portfolio
    const portfolioPatents = await prisma.$queryRawUnsafe(`
      SELECT pp.patent_id
      FROM portfolio_patents pp
      WHERE pp.portfolio_id = $1
    `, portfolioId) as { patent_id: string }[];
    const patentNums = portfolioPatents.map((p) => p.patent_id);

    if (patentNums.length === 0) continue;

    // Get classifications for these patents
    const nodeDistRows = await prisma.$queryRawUnsafe(`
      SELECT
        tn.code as node_code,
        tn.name as node_name,
        COUNT(DISTINCT oc.object_id) FILTER (WHERE oc.association_rank = 1) as primary_cnt,
        COUNT(DISTINCT oc.object_id) as total_cnt
      FROM object_classifications oc
      JOIN taxonomy_nodes tn ON tn.id = oc.taxonomy_node_id
      WHERE oc.portfolio_group_id = $1
        AND oc.object_id = ANY($2::text[])
      GROUP BY tn.code, tn.name
      ORDER BY primary_cnt DESC
    `, portfolioGroupId, patentNums) as {
      node_code: string;
      node_name: string;
      primary_cnt: bigint;
      total_cnt: bigint;
    }[];

    // Multi-class stats
    const allClassifications = await prisma.objectClassification.findMany({
      where: {
        portfolioGroupId,
        objectId: { in: patentNums },
      },
      select: { objectId: true, associationRank: true },
    });

    const patentsWithMultiple = new Set<string>();
    for (const c of allClassifications) {
      if (c.associationRank > 1) patentsWithMultiple.add(c.objectId);
    }

    const primaryCount = allClassifications.filter((c) => c.associationRank === 1).length;

    results.push({
      portfolioName: portfolio.name,
      portfolioId: portfolio.id,
      totalClassified: primaryCount,
      nodeDistribution: nodeDistRows.map((r) => ({
        nodeCode: r.node_code,
        nodeName: r.node_name,
        primaryCount: Number(r.primary_cnt),
        totalCount: Number(r.total_cnt),
      })),
      multiClassStats: {
        patentsWithMultiple: patentsWithMultiple.size,
        avgClassificationsPerPatent:
          primaryCount > 0 ? allClassifications.length / primaryCount : 0,
      },
    });
  }

  return results;
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Get patent numbers (from patent_id field) for a given taxonomy node.
 * Looks in both objectClassification and the patent.primarySector pragmatic field.
 */
async function getPatentNumbersForNode(nodeId: string): Promise<string[]> {
  // Try objectClassification first
  const ocs = await prisma.objectClassification.findMany({
    where: { taxonomyNodeId: nodeId, objectType: 'patent' },
    select: { objectId: true },
  });

  if (ocs.length > 0) {
    return [...new Set(ocs.map((c) => c.objectId))];
  }

  // Fallback: use pragmatic field via node code
  const node = await prisma.taxonomyNode.findUnique({
    where: { id: nodeId },
    select: { code: true },
  });
  if (!node) return [];

  const patents = await prisma.patent.findMany({
    where: { primarySector: node.code },
    select: { patentId: true },
  });
  return patents.map((p) => p.patentId);
}

/**
 * Count patents per portfolio for a set of patent numbers.
 */
async function getPortfolioBreakdown(
  patentNums: string[],
  referencePortfolioIds: string[]
): Promise<Record<string, number>> {
  const whereClause = referencePortfolioIds.length > 0
    ? `AND pp.portfolio_id = ANY($2::text[])`
    : '';
  const params: any[] = [patentNums];
  if (referencePortfolioIds.length > 0) params.push(referencePortfolioIds);

  const rows = await prisma.$queryRawUnsafe(`
    SELECT po.name, COUNT(DISTINCT pp.patent_id) as cnt
    FROM portfolio_patents pp
    JOIN portfolios po ON po.id = pp.portfolio_id
    WHERE pp.patent_id = ANY($1::text[])
      ${whereClause}
    GROUP BY po.name
    ORDER BY cnt DESC
    LIMIT 20
  `, ...params) as { name: string; cnt: bigint }[];

  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.name] = Number(r.cnt);
  }
  return result;
}

/**
 * Get CPC distribution at the "group" level.
 * Groups CPCs like H04L41/06, H04L43/08, extracting the numeric group part.
 */
async function getCpcGroupDistribution(
  patentNums: string[],
  referencePortfolioIds: string[],
  minPatents: number,
  maxGroups: number
): Promise<CpcGroupDistribution[]> {
  // Get group-level distribution
  const rows = await prisma.$queryRawUnsafe(`
    SELECT
      SPLIT_PART(pc.cpc_code, '/', 1) || '/' ||
        REGEXP_REPLACE(SPLIT_PART(pc.cpc_code, '/', 2), '[^0-9].*$', '') as cpc_group,
      COUNT(DISTINCT pc.patent_id) as total,
      COUNT(DISTINCT CASE WHEN pc.is_inventive THEN pc.patent_id END) as inventive
    FROM patent_cpc_codes pc
    WHERE pc.patent_id = ANY($1::text[])
      AND pc.cpc_code NOT LIKE 'Y%'
    GROUP BY cpc_group
    HAVING COUNT(DISTINCT pc.patent_id) >= $2
    ORDER BY total DESC
    LIMIT $3
  `, patentNums, minPatents, maxGroups) as {
    cpc_group: string;
    total: bigint;
    inventive: bigint;
  }[];

  const results: CpcGroupDistribution[] = [];
  for (const row of rows) {
    const portfolioCounts: Record<string, number> = {};

    if (referencePortfolioIds.length > 0) {
      const pcRows = await prisma.$queryRawUnsafe(`
        SELECT po.name, COUNT(DISTINCT pc.patent_id) as cnt
        FROM patent_cpc_codes pc
        JOIN portfolio_patents pp ON pp.patent_id = pc.patent_id
        JOIN portfolios po ON po.id = pp.portfolio_id
        WHERE pc.patent_id = ANY($1::text[])
          AND pc.cpc_code LIKE $2
          AND pp.portfolio_id = ANY($3::text[])
        GROUP BY po.name
      `, patentNums, row.cpc_group + '%', referencePortfolioIds) as {
        name: string;
        cnt: bigint;
      }[];
      for (const pc of pcRows) {
        portfolioCounts[pc.name] = Number(pc.cnt);
      }
    }

    results.push({
      cpcGroup: row.cpc_group,
      totalPatents: Number(row.total),
      inventivePatents: Number(row.inventive),
      portfolioCounts,
    });
  }

  return results;
}

/**
 * Get CPC distribution at multiple granularities for drill-down analysis.
 */
async function getMultiGranularityDistribution(
  patentNums: string[],
  minPatents: number,
  maxGroups: number
): Promise<{ granularity: string; groups: CpcGroupDistribution[] }[]> {
  const granularities = [
    { name: '5-char', length: 5 },   // e.g., H04L4
    { name: '7-char', length: 7 },   // e.g., H04L41/
    { name: '9-char', length: 9 },   // e.g., H04L41/08
    { name: 'full-group', length: 0 }, // full CPC group
  ];

  const result: { granularity: string; groups: CpcGroupDistribution[] }[] = [];

  for (const gran of granularities) {
    const selectExpr = gran.length > 0
      ? `LEFT(pc.cpc_code, ${gran.length})`
      : `SPLIT_PART(pc.cpc_code, '/', 1) || '/' || REGEXP_REPLACE(SPLIT_PART(pc.cpc_code, '/', 2), '[^0-9].*$', '')`;

    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        ${selectExpr} as cpc_key,
        COUNT(DISTINCT pc.patent_id) as total,
        COUNT(DISTINCT CASE WHEN pc.is_inventive THEN pc.patent_id END) as inventive
      FROM patent_cpc_codes pc
      WHERE pc.patent_id = ANY($1::text[])
        AND pc.cpc_code NOT LIKE 'Y%'
      GROUP BY cpc_key
      HAVING COUNT(DISTINCT pc.patent_id) >= $2
      ORDER BY total DESC
      LIMIT $3
    `, patentNums, minPatents, maxGroups) as {
      cpc_key: string;
      total: bigint;
      inventive: bigint;
    }[];

    result.push({
      granularity: gran.name,
      groups: rows.map((r) => ({
        cpcGroup: r.cpc_key,
        totalPatents: Number(r.total),
        inventivePatents: Number(r.inventive),
        portfolioCounts: {},
      })),
    });
  }

  return result;
}

/**
 * Detect CPC classes that have parallel 3-digit and 4-digit numbering.
 * e.g., H04L41/08xx (config management) vs H04L41/8xx (SDN management)
 */
async function detectDualNumbering(
  patentNums: string[],
  cpcPrefixes: string[]
): Promise<string[]> {
  const dualClasses: string[] = [];

  for (const prefix of cpcPrefixes) {
    // Check if there are both /0Nxx (4-digit) and /Nxx (3-digit) codes
    // For a prefix like H04L4, check H04L41/0*, H04L41/[1-9]*, H04L42/0*, etc.
    // Simpler: just check if there are codes with 3-digit and 4-digit parts after slash
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        CASE
          WHEN LENGTH(SPLIT_PART(pc.cpc_code, '/', 2)) >= 4
            AND LEFT(SPLIT_PART(pc.cpc_code, '/', 2), 1) = '0'
          THEN '4-digit'
          WHEN LENGTH(SPLIT_PART(pc.cpc_code, '/', 2)) >= 3
            AND LEFT(SPLIT_PART(pc.cpc_code, '/', 2), 1) != '0'
          THEN '3-digit'
          ELSE 'other'
        END as num_type,
        LEFT(SPLIT_PART(pc.cpc_code, '/', 2), 2) as subgroup_prefix,
        COUNT(DISTINCT pc.patent_id) as cnt
      FROM patent_cpc_codes pc
      WHERE pc.patent_id = ANY($1::text[])
        AND pc.cpc_code LIKE $2
      GROUP BY num_type, subgroup_prefix
      HAVING COUNT(DISTINCT pc.patent_id) >= 10
    `, patentNums, prefix + '%') as {
      num_type: string;
      subgroup_prefix: string;
      cnt: bigint;
    }[];

    const has4digit = rows.some((r) => r.num_type === '4-digit');
    const has3digit = rows.some((r) => r.num_type === '3-digit');

    if (has4digit && has3digit) {
      // Find the specific class (e.g., H04L41)
      const classRows = await prisma.$queryRawUnsafe(`
        SELECT DISTINCT SPLIT_PART(pc.cpc_code, '/', 1) as cpc_class
        FROM patent_cpc_codes pc
        WHERE pc.patent_id = ANY($1::text[])
          AND pc.cpc_code LIKE $2
        LIMIT 5
      `, patentNums, prefix + '%') as { cpc_class: string }[];
      for (const cr of classRows) {
        if (!dualClasses.includes(cr.cpc_class)) {
          dualClasses.push(cr.cpc_class);
        }
      }
    }
  }

  return dualClasses;
}
