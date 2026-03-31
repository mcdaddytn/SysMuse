/**
 * Cross-Classification Query Service
 *
 * Provides query capabilities for multi-classification data:
 * - Find patents by secondary/tertiary associations
 * - Find patents spanning multiple super-sectors
 * - Get classification statistics
 * - Analyze cross-domain patent distributions
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// =============================================================================
// Types
// =============================================================================

export interface ClassificationQueryParams {
  taxonomyNodeId?: string;
  taxonomyNodeCode?: string;
  associationRanks?: number[];     // [1,2,3] or [2,3] for non-primary only
  minConfidence?: number;
  minWeight?: number;
  portfolioGroupId?: string;
  portfolioId?: string;
  limit?: number;
  offset?: number;
}

export interface CrossDomainQueryParams {
  superSectorIds?: string[];       // Must span ALL of these
  superSectorCodes?: string[];     // Alternative: use codes
  associationRanks?: number[];     // Which ranks to consider
  portfolioGroupId?: string;
  portfolioId?: string;
  limit?: number;
  offset?: number;
}

export interface PatentClassification {
  patentId: string;
  associationRank: number;
  taxonomyNodeId: string;
  taxonomyNodeCode: string;
  taxonomyNodeName: string;
  taxonomyNodeLevel: number;
  weight: number;
  confidence: number | null;
  sourceCodes: string[];
  inventiveSourceCount: number;
  // Ancestry
  level1Code: string | null;
  level1Name: string | null;
  level2Code: string | null;
  level2Name: string | null;
  level3Code: string | null;
  level3Name: string | null;
}

export interface PatentWithClassifications {
  patentId: string;
  title: string;
  assignee: string;
  filingDate: string | null;
  classifications: PatentClassification[];
}

export interface ClassificationStats {
  totalPatents: number;
  withPrimary: number;
  withSecondary: number;
  withTertiary: number;
  byLevel: {
    level: number;
    uniqueNodes: number;
    totalClassifications: number;
  }[];
  topNodes: {
    nodeId: string;
    nodeCode: string;
    nodeName: string;
    count: number;
    rank: number;
  }[];
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Find patents by taxonomy association
 * Can filter by specific node, ranks, and confidence
 */
export async function findPatentsByAssociation(
  params: ClassificationQueryParams
): Promise<PatentWithClassifications[]> {
  const {
    taxonomyNodeId,
    taxonomyNodeCode,
    associationRanks = [1, 2, 3],
    minConfidence,
    minWeight,
    portfolioGroupId,
    portfolioId,
    limit = 100,
    offset = 0,
  } = params;

  // Build WHERE conditions
  const conditions: string[] = ["oc.object_type = 'patent'"];

  if (taxonomyNodeId) {
    conditions.push(`oc.taxonomy_node_id = '${taxonomyNodeId}'`);
  } else if (taxonomyNodeCode) {
    conditions.push(`tn.code = '${taxonomyNodeCode}'`);
  }

  if (associationRanks.length > 0) {
    conditions.push(`oc.association_rank IN (${associationRanks.join(',')})`);
  }

  if (minConfidence !== undefined) {
    conditions.push(`oc.confidence >= ${minConfidence}`);
  }

  if (minWeight !== undefined) {
    conditions.push(`oc.weight >= ${minWeight}`);
  }

  if (portfolioGroupId) {
    conditions.push(`oc.portfolio_group_id = '${portfolioGroupId}'`);
  }

  if (portfolioId) {
    conditions.push(`EXISTS (
      SELECT 1 FROM portfolio_patents pp
      WHERE pp.patent_id = oc.object_id AND pp.portfolio_id = '${portfolioId}'
    )`);
  }

  const whereClause = conditions.join(' AND ');

  // Query matching patent IDs first
  const patentIds = await prisma.$queryRawUnsafe<{ object_id: string }[]>(`
    SELECT DISTINCT oc.object_id
    FROM object_classifications oc
    JOIN taxonomy_nodes tn ON oc.taxonomy_node_id = tn.id
    WHERE ${whereClause}
    ORDER BY oc.object_id
    LIMIT ${limit} OFFSET ${offset}
  `);

  if (patentIds.length === 0) {
    return [];
  }

  // Get full classifications for matching patents
  return getPatentsWithClassifications(patentIds.map(p => p.object_id));
}

/**
 * Find patents spanning multiple super-sectors
 */
export async function findCrossDomainPatents(
  params: CrossDomainQueryParams
): Promise<PatentWithClassifications[]> {
  const {
    superSectorIds,
    superSectorCodes,
    associationRanks = [1, 2, 3],
    portfolioGroupId,
    portfolioId,
    limit = 100,
    offset = 0,
  } = params;

  // Resolve super-sector IDs if codes provided
  let targetSuperSectorIds = superSectorIds || [];
  if (superSectorCodes && superSectorCodes.length > 0) {
    const nodes = await prisma.taxonomyNode.findMany({
      where: { code: { in: superSectorCodes }, level: 1 },
      select: { id: true },
    });
    targetSuperSectorIds = nodes.map(n => n.id);
  }

  if (targetSuperSectorIds.length === 0) {
    return [];
  }

  const requiredCount = targetSuperSectorIds.length;
  const idList = targetSuperSectorIds.map(id => `'${id}'`).join(',');
  const rankList = associationRanks.join(',');

  // Find patents that have classifications in ALL specified super-sectors
  let portfolioFilter = '';
  if (portfolioGroupId) {
    portfolioFilter = `AND oc.portfolio_group_id = '${portfolioGroupId}'`;
  }
  if (portfolioId) {
    portfolioFilter += ` AND EXISTS (
      SELECT 1 FROM portfolio_patents pp
      WHERE pp.patent_id = oc.object_id AND pp.portfolio_id = '${portfolioId}'
    )`;
  }

  const patentIds = await prisma.$queryRawUnsafe<{ object_id: string }[]>(`
    WITH patent_supersectors AS (
      SELECT DISTINCT
        oc.object_id,
        COALESCE(p2.id, p1.id, tn.id) as supersector_id
      FROM object_classifications oc
      JOIN taxonomy_nodes tn ON oc.taxonomy_node_id = tn.id
      LEFT JOIN taxonomy_nodes p1 ON tn.parent_id = p1.id
      LEFT JOIN taxonomy_nodes p2 ON p1.parent_id = p2.id
      WHERE oc.object_type = 'patent'
        AND oc.association_rank IN (${rankList})
        ${portfolioFilter}
    )
    SELECT object_id
    FROM patent_supersectors
    WHERE supersector_id IN (${idList})
    GROUP BY object_id
    HAVING COUNT(DISTINCT supersector_id) = ${requiredCount}
    ORDER BY object_id
    LIMIT ${limit} OFFSET ${offset}
  `);

  if (patentIds.length === 0) {
    return [];
  }

  return getPatentsWithClassifications(patentIds.map(p => p.object_id));
}

/**
 * Get all classifications for specific patents with ancestry
 */
export async function getPatentsWithClassifications(
  patentIds: string[]
): Promise<PatentWithClassifications[]> {
  if (patentIds.length === 0) {
    return [];
  }

  const idList = patentIds.map(id => `'${id}'`).join(',');

  // Get patent details
  const patents = await prisma.patent.findMany({
    where: { patentId: { in: patentIds } },
    select: {
      patentId: true,
      title: true,
      assignee: true,
      filingDate: true,
    },
  });

  // Get classifications with ancestry
  const classifications = await prisma.$queryRawUnsafe<{
    object_id: string;
    association_rank: number;
    taxonomy_node_id: string;
    node_code: string;
    node_name: string;
    node_level: number;
    weight: number;
    confidence: number | null;
    source_codes: string[];
    inventive_source_count: number;
    level1_code: string | null;
    level1_name: string | null;
    level2_code: string | null;
    level2_name: string | null;
    level3_code: string | null;
    level3_name: string | null;
  }[]>(`
    WITH node_ancestry AS (
      SELECT
        n.id,
        n.code,
        n.name,
        n.level,
        CASE WHEN n.level = 1 THEN n.code
             WHEN n.level = 2 THEN p1.code
             WHEN n.level = 3 THEN p2.code
        END as level1_code,
        CASE WHEN n.level = 1 THEN n.name
             WHEN n.level = 2 THEN p1.name
             WHEN n.level = 3 THEN p2.name
        END as level1_name,
        CASE WHEN n.level = 2 THEN n.code
             WHEN n.level = 3 THEN p1.code
             ELSE NULL
        END as level2_code,
        CASE WHEN n.level = 2 THEN n.name
             WHEN n.level = 3 THEN p1.name
             ELSE NULL
        END as level2_name,
        CASE WHEN n.level = 3 THEN n.code ELSE NULL END as level3_code,
        CASE WHEN n.level = 3 THEN n.name ELSE NULL END as level3_name
      FROM taxonomy_nodes n
      LEFT JOIN taxonomy_nodes p1 ON n.parent_id = p1.id
      LEFT JOIN taxonomy_nodes p2 ON p1.parent_id = p2.id
    )
    SELECT
      oc.object_id,
      oc.association_rank,
      oc.taxonomy_node_id,
      na.code as node_code,
      na.name as node_name,
      na.level as node_level,
      oc.weight,
      oc.confidence,
      oc.source_codes,
      oc.inventive_source_count,
      na.level1_code,
      na.level1_name,
      na.level2_code,
      na.level2_name,
      na.level3_code,
      na.level3_name
    FROM object_classifications oc
    JOIN node_ancestry na ON oc.taxonomy_node_id = na.id
    WHERE oc.object_id IN (${idList})
      AND oc.object_type = 'patent'
    ORDER BY oc.object_id, oc.association_rank
  `);

  // Group classifications by patent
  const patentMap = new Map<string, PatentClassification[]>();
  for (const c of classifications) {
    if (!patentMap.has(c.object_id)) {
      patentMap.set(c.object_id, []);
    }
    patentMap.get(c.object_id)!.push({
      patentId: c.object_id,
      associationRank: c.association_rank,
      taxonomyNodeId: c.taxonomy_node_id,
      taxonomyNodeCode: c.node_code,
      taxonomyNodeName: c.node_name,
      taxonomyNodeLevel: c.node_level,
      weight: Number(c.weight),
      confidence: c.confidence ? Number(c.confidence) : null,
      sourceCodes: c.source_codes || [],
      inventiveSourceCount: c.inventive_source_count,
      level1Code: c.level1_code,
      level1Name: c.level1_name,
      level2Code: c.level2_code,
      level2Name: c.level2_name,
      level3Code: c.level3_code,
      level3Name: c.level3_name,
    });
  }

  // Build results
  return patents.map(p => ({
    patentId: p.patentId,
    title: p.title,
    assignee: p.assignee,
    filingDate: p.filingDate,
    classifications: patentMap.get(p.patentId) || [],
  }));
}

/**
 * Get classification statistics for a portfolio group
 */
export async function getClassificationStats(
  portfolioGroupId?: string
): Promise<ClassificationStats> {
  const groupFilter = portfolioGroupId
    ? `AND oc.portfolio_group_id = '${portfolioGroupId}'`
    : '';

  // Count patents by association rank
  const rankCounts = await prisma.$queryRawUnsafe<{
    association_rank: number;
    count: bigint;
  }[]>(`
    SELECT association_rank, COUNT(DISTINCT object_id) as count
    FROM object_classifications
    WHERE object_type = 'patent' ${groupFilter}
    GROUP BY association_rank
    ORDER BY association_rank
  `);

  const withPrimary = Number(rankCounts.find(r => r.association_rank === 1)?.count || 0);
  const withSecondary = Number(rankCounts.find(r => r.association_rank === 2)?.count || 0);
  const withTertiary = Number(rankCounts.find(r => r.association_rank === 3)?.count || 0);

  // Count by level
  const levelCounts = await prisma.$queryRawUnsafe<{
    level: number;
    unique_nodes: bigint;
    total_classifications: bigint;
  }[]>(`
    SELECT
      tn.level,
      COUNT(DISTINCT oc.taxonomy_node_id) as unique_nodes,
      COUNT(*) as total_classifications
    FROM object_classifications oc
    JOIN taxonomy_nodes tn ON oc.taxonomy_node_id = tn.id
    WHERE oc.object_type = 'patent' ${groupFilter}
    GROUP BY tn.level
    ORDER BY tn.level
  `);

  // Top nodes by classification count
  const topNodes = await prisma.$queryRawUnsafe<{
    node_id: string;
    node_code: string;
    node_name: string;
    count: bigint;
    rank: number;
  }[]>(`
    SELECT
      oc.taxonomy_node_id as node_id,
      tn.code as node_code,
      tn.name as node_name,
      COUNT(*) as count,
      oc.association_rank as rank
    FROM object_classifications oc
    JOIN taxonomy_nodes tn ON oc.taxonomy_node_id = tn.id
    WHERE oc.object_type = 'patent' ${groupFilter}
    GROUP BY oc.taxonomy_node_id, tn.code, tn.name, oc.association_rank
    ORDER BY count DESC
    LIMIT 50
  `);

  return {
    totalPatents: withPrimary,
    withPrimary,
    withSecondary,
    withTertiary,
    byLevel: levelCounts.map(l => ({
      level: l.level,
      uniqueNodes: Number(l.unique_nodes),
      totalClassifications: Number(l.total_classifications),
    })),
    topNodes: topNodes.map(n => ({
      nodeId: n.node_id,
      nodeCode: n.node_code,
      nodeName: n.node_name,
      count: Number(n.count),
      rank: n.rank,
    })),
  };
}

/**
 * Get super-sector distribution for patents
 */
export async function getSuperSectorDistribution(
  portfolioGroupId?: string
): Promise<{
  superSectorId: string;
  superSectorCode: string;
  superSectorName: string;
  primaryCount: number;
  secondaryCount: number;
  tertiaryCount: number;
  totalCount: number;
}[]> {
  const groupFilter = portfolioGroupId
    ? `AND oc.portfolio_group_id = '${portfolioGroupId}'`
    : '';

  const results = await prisma.$queryRawUnsafe<{
    supersector_id: string;
    supersector_code: string;
    supersector_name: string;
    rank: number;
    count: bigint;
  }[]>(`
    SELECT
      COALESCE(p2.id, p1.id, tn.id) as supersector_id,
      COALESCE(p2.code, p1.code, tn.code) as supersector_code,
      COALESCE(p2.name, p1.name, tn.name) as supersector_name,
      oc.association_rank as rank,
      COUNT(DISTINCT oc.object_id) as count
    FROM object_classifications oc
    JOIN taxonomy_nodes tn ON oc.taxonomy_node_id = tn.id
    LEFT JOIN taxonomy_nodes p1 ON tn.parent_id = p1.id
    LEFT JOIN taxonomy_nodes p2 ON p1.parent_id = p2.id
    WHERE oc.object_type = 'patent' ${groupFilter}
    GROUP BY
      COALESCE(p2.id, p1.id, tn.id),
      COALESCE(p2.code, p1.code, tn.code),
      COALESCE(p2.name, p1.name, tn.name),
      oc.association_rank
    ORDER BY supersector_code, rank
  `);

  // Pivot by rank
  const distribution = new Map<string, {
    superSectorId: string;
    superSectorCode: string;
    superSectorName: string;
    primaryCount: number;
    secondaryCount: number;
    tertiaryCount: number;
  }>();

  for (const r of results) {
    if (!distribution.has(r.supersector_id)) {
      distribution.set(r.supersector_id, {
        superSectorId: r.supersector_id,
        superSectorCode: r.supersector_code,
        superSectorName: r.supersector_name,
        primaryCount: 0,
        secondaryCount: 0,
        tertiaryCount: 0,
      });
    }
    const entry = distribution.get(r.supersector_id)!;
    if (r.rank === 1) entry.primaryCount = Number(r.count);
    if (r.rank === 2) entry.secondaryCount = Number(r.count);
    if (r.rank === 3) entry.tertiaryCount = Number(r.count);
  }

  return Array.from(distribution.values()).map(d => ({
    ...d,
    totalCount: d.primaryCount + d.secondaryCount + d.tertiaryCount,
  }));
}

// =============================================================================
// Export
// =============================================================================

export const crossClassificationService = {
  findPatentsByAssociation,
  findCrossDomainPatents,
  getPatentsWithClassifications,
  getClassificationStats,
  getSuperSectorDistribution,
};

export default crossClassificationService;
