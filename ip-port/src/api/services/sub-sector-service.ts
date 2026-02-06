/**
 * Sub-Sector Service
 *
 * Generates and manages sub-sectors within sectors for manageable LLM analysis.
 *
 * Strategy:
 * 1. CPC-based primary splitting (using full subgroup codes)
 * 2. Date-based secondary splitting for large groups (> threshold)
 * 3. Flagging for user intervention on remaining large groups
 */

import { PrismaClient, SubSectorStatus, SubSectorGroupingType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ============================================================================
// Types
// ============================================================================

export interface SubSectorConfig {
  // Target thresholds
  targetMaxSize: number;       // Default: 100 - try to keep sub-sectors under this
  targetMinSize: number;       // Default: 10 - warn if sub-sectors are too small

  // Date-based splitting config
  dateSplitEnabled: boolean;   // Default: true
  dateSplitTargetSize: number; // Default: 50 - target size when splitting by date

  // What to do with groups still over threshold after date splitting
  flagThreshold: number;       // Default: 100 - flag for review if still over this
}

export interface ProspectiveSubSector {
  name: string;
  displayName: string;
  groupingType: SubSectorGroupingType;
  cpcCode?: string;
  cpcPrefix?: string;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  parentCpcCode?: string;
  patentCount: number;
  patentIds: string[];
  needsReview: boolean;
  reviewReason?: string;
}

export interface SubSectorGenerationResult {
  sectorId: string;
  sectorName: string;
  totalPatents: number;
  config: SubSectorConfig;

  // Generated sub-sectors
  subSectors: ProspectiveSubSector[];

  // Summary stats
  stats: {
    totalSubSectors: number;
    underThreshold: number;
    overThreshold: number;
    needsReview: number;
    avgSize: number;
    medianSize: number;
    maxSize: number;
    minSize: number;
  };
}

export interface ApplyResult {
  sectorId: string;
  created: number;
  updated: number;
  deleted: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: SubSectorConfig = {
  targetMaxSize: 100,
  targetMinSize: 10,
  dateSplitEnabled: true,
  dateSplitTargetSize: 50,
  flagThreshold: 100,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate prospective sub-sectors for a sector
 * Does NOT save to database - returns analysis for user review
 */
export async function generateSubSectors(
  sectorName: string,
  candidatesFile: string = 'streaming-candidates-2026-01-25.json',
  config: Partial<SubSectorConfig> = {}
): Promise<SubSectorGenerationResult> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };

  // Load sector from database
  const sector = await prisma.sector.findUnique({
    where: { name: sectorName },
    include: { superSector: true },
  });

  if (!sector) {
    throw new Error(`Sector not found: ${sectorName}`);
  }

  // Load candidates
  const candidatesPath = path.join(process.cwd(), 'output', candidatesFile);
  const data = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates = data.candidates || [];

  // Filter to patents in this sector
  const sectorPatents = candidates.filter(
    (p: any) => p.primary_sector === sectorName
  );

  if (sectorPatents.length === 0) {
    return {
      sectorId: sector.id,
      sectorName: sector.name,
      totalPatents: 0,
      config: fullConfig,
      subSectors: [],
      stats: {
        totalSubSectors: 0,
        underThreshold: 0,
        overThreshold: 0,
        needsReview: 0,
        avgSize: 0,
        medianSize: 0,
        maxSize: 0,
        minSize: 0,
      },
    };
  }

  // Step 1: Group by CPC subgroup
  const cpcGroups = groupByCpcSubgroup(sectorPatents);

  // Step 2: Apply date-based splitting for large groups
  const subSectors: ProspectiveSubSector[] = [];

  for (const [cpcCode, patents] of Object.entries(cpcGroups)) {
    if (patents.length <= fullConfig.targetMaxSize || !fullConfig.dateSplitEnabled) {
      // Small enough or date splitting disabled - keep as single sub-sector
      const needsReview = patents.length > fullConfig.flagThreshold;
      subSectors.push({
        name: cpcCode,
        displayName: formatCpcDisplayName(cpcCode),
        groupingType: SubSectorGroupingType.CPC_SUBGROUP,
        cpcCode: cpcCode,
        patentCount: patents.length,
        patentIds: patents.map((p: any) => p.patent_id || p.id),
        needsReview,
        reviewReason: needsReview ? `${patents.length} patents exceeds threshold of ${fullConfig.flagThreshold}` : undefined,
      });
    } else {
      // Large group - apply date-based splitting
      const dateSplits = splitByDateRange(patents, fullConfig.dateSplitTargetSize);

      for (const split of dateSplits) {
        const name = `${cpcCode}_${split.dateLabel}`;
        const needsReview = split.patents.length > fullConfig.flagThreshold;

        subSectors.push({
          name,
          displayName: `${formatCpcDisplayName(cpcCode)} (${split.dateLabel})`,
          groupingType: SubSectorGroupingType.DATE_RANGE,
          parentCpcCode: cpcCode,
          dateRangeStart: split.startDate,
          dateRangeEnd: split.endDate,
          patentCount: split.patents.length,
          patentIds: split.patents.map((p: any) => p.patent_id || p.id),
          needsReview,
          reviewReason: needsReview ? `${split.patents.length} patents still exceeds threshold after date split` : undefined,
        });
      }
    }
  }

  // Sort by patent count descending
  subSectors.sort((a, b) => b.patentCount - a.patentCount);

  // Calculate stats
  const sizes = subSectors.map(s => s.patentCount);
  const stats = {
    totalSubSectors: subSectors.length,
    underThreshold: subSectors.filter(s => s.patentCount <= fullConfig.targetMaxSize).length,
    overThreshold: subSectors.filter(s => s.patentCount > fullConfig.targetMaxSize).length,
    needsReview: subSectors.filter(s => s.needsReview).length,
    avgSize: sizes.length > 0 ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : 0,
    medianSize: sizes.length > 0 ? sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : 0,
    maxSize: sizes.length > 0 ? Math.max(...sizes) : 0,
    minSize: sizes.length > 0 ? Math.min(...sizes) : 0,
  };

  return {
    sectorId: sector.id,
    sectorName: sector.name,
    totalPatents: sectorPatents.length,
    config: fullConfig,
    subSectors,
    stats,
  };
}

/**
 * Apply generated sub-sectors to database
 * Creates SubSector records in PROSPECTIVE status
 */
export async function applySubSectors(
  result: SubSectorGenerationResult,
  options: { replaceExisting?: boolean } = {}
): Promise<ApplyResult> {
  const { replaceExisting = false } = options;

  let deleted = 0;

  if (replaceExisting) {
    // Delete existing prospective sub-sectors for this sector
    const deleteResult = await prisma.subSector.deleteMany({
      where: {
        sectorId: result.sectorId,
        status: SubSectorStatus.PROSPECTIVE,
      },
    });
    deleted = deleteResult.count;
  }

  // Create new sub-sectors
  const created = await prisma.subSector.createMany({
    data: result.subSectors.map(ss => ({
      sectorId: result.sectorId,
      name: ss.name,
      displayName: ss.displayName,
      groupingType: ss.groupingType,
      cpcCode: ss.cpcCode,
      cpcPrefix: ss.cpcPrefix,
      dateRangeStart: ss.dateRangeStart,
      dateRangeEnd: ss.dateRangeEnd,
      parentCpcCode: ss.parentCpcCode,
      patentCount: ss.patentCount,
      needsReview: ss.needsReview,
      reviewReason: ss.reviewReason,
      status: SubSectorStatus.PROSPECTIVE,
    })),
    skipDuplicates: true,
  });

  return {
    sectorId: result.sectorId,
    created: created.count,
    updated: 0,
    deleted,
  };
}

/**
 * Get existing sub-sectors for a sector
 */
export async function getSubSectors(
  sectorName: string,
  status?: SubSectorStatus
): Promise<any[]> {
  const where: any = {
    sector: { name: sectorName },
  };

  if (status) {
    where.status = status;
  }

  return prisma.subSector.findMany({
    where,
    include: { sector: true },
    orderBy: { patentCount: 'desc' },
  });
}

/**
 * Update sub-sector status (e.g., PROSPECTIVE -> APPLIED)
 */
export async function updateSubSectorStatus(
  subSectorId: string,
  status: SubSectorStatus
): Promise<any> {
  return prisma.subSector.update({
    where: { id: subSectorId },
    data: { status },
  });
}

/**
 * Manually split a sub-sector that needs review
 * Supports: date split, random chunks, or custom grouping
 */
export async function manualSplitSubSector(
  subSectorId: string,
  splitType: 'date' | 'chunks' | 'custom',
  options: {
    targetSize?: number;
    chunkCount?: number;
    customGroups?: Array<{ name: string; patentIds: string[] }>;
  } = {}
): Promise<ProspectiveSubSector[]> {
  const subSector = await prisma.subSector.findUnique({
    where: { id: subSectorId },
    include: { sector: true },
  });

  if (!subSector) {
    throw new Error(`SubSector not found: ${subSectorId}`);
  }

  // Load candidates to get patent details
  const candidatesPath = path.join(process.cwd(), 'output', 'streaming-candidates-2026-01-25.json');
  const data = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates = data.candidates || [];

  // Filter to patents in this sub-sector
  let patents: any[];
  if (subSector.cpcCode) {
    patents = candidates.filter((p: any) =>
      p.primary_sector === subSector.sector.name &&
      (p.cpc_codes || []).includes(subSector.cpcCode)
    );
  } else if (subSector.parentCpcCode && subSector.dateRangeStart) {
    patents = candidates.filter((p: any) => {
      if (p.primary_sector !== subSector.sector.name) return false;
      if (!(p.cpc_codes || []).some((c: string) => c === subSector.parentCpcCode || c.startsWith(subSector.parentCpcCode + '/'))) return false;
      const patentDate = p.patent_date || '';
      return patentDate >= (subSector.dateRangeStart || '') && patentDate <= (subSector.dateRangeEnd || '9999');
    });
  } else {
    throw new Error('Cannot determine patents for this sub-sector');
  }

  const newSubSectors: ProspectiveSubSector[] = [];

  if (splitType === 'date') {
    const targetSize = options.targetSize || 50;
    const dateSplits = splitByDateRange(patents, targetSize);

    for (const split of dateSplits) {
      const name = `${subSector.name}_${split.dateLabel}`;
      newSubSectors.push({
        name,
        displayName: `${subSector.displayName} (${split.dateLabel})`,
        groupingType: SubSectorGroupingType.DATE_RANGE,
        parentCpcCode: subSector.cpcCode || subSector.parentCpcCode,
        dateRangeStart: split.startDate,
        dateRangeEnd: split.endDate,
        patentCount: split.patents.length,
        patentIds: split.patents.map((p: any) => p.patent_id || p.id),
        needsReview: false,
      });
    }
  } else if (splitType === 'chunks') {
    const chunkCount = options.chunkCount || Math.ceil(patents.length / 50);
    const chunkSize = Math.ceil(patents.length / chunkCount);

    for (let i = 0; i < chunkCount; i++) {
      const chunkPatents = patents.slice(i * chunkSize, (i + 1) * chunkSize);
      if (chunkPatents.length === 0) continue;

      const name = `${subSector.name}_chunk${i + 1}`;
      newSubSectors.push({
        name,
        displayName: `${subSector.displayName} (Part ${i + 1})`,
        groupingType: SubSectorGroupingType.CUSTOM,
        parentCpcCode: subSector.cpcCode || subSector.parentCpcCode,
        patentCount: chunkPatents.length,
        patentIds: chunkPatents.map((p: any) => p.patent_id || p.id),
        needsReview: false,
      });
    }
  } else if (splitType === 'custom' && options.customGroups) {
    for (const group of options.customGroups) {
      newSubSectors.push({
        name: `${subSector.name}_${group.name}`,
        displayName: `${subSector.displayName} - ${group.name}`,
        groupingType: SubSectorGroupingType.CUSTOM,
        parentCpcCode: subSector.cpcCode || subSector.parentCpcCode,
        patentCount: group.patentIds.length,
        patentIds: group.patentIds,
        needsReview: false,
      });
    }
  }

  return newSubSectors;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group patents by their CPC subgroup codes
 * A patent may belong to multiple groups (multiple CPC codes)
 */
function groupByCpcSubgroup(patents: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};

  for (const patent of patents) {
    const cpcCodes = patent.cpc_codes || [];
    const seenCodes = new Set<string>();

    for (const cpc of cpcCodes) {
      // CPC code is already a full subgroup (e.g., H04L63/1416)
      if (!seenCodes.has(cpc)) {
        seenCodes.add(cpc);
        if (!groups[cpc]) {
          groups[cpc] = [];
        }
        groups[cpc].push(patent);
      }
    }
  }

  return groups;
}

/**
 * Split patents by date ranges to achieve target size per group
 */
function splitByDateRange(
  patents: any[],
  targetSize: number
): Array<{ dateLabel: string; startDate: string; endDate: string; patents: any[] }> {
  // Sort by patent_date
  const sorted = [...patents].sort((a, b) => {
    const dateA = a.patent_date || '';
    const dateB = b.patent_date || '';
    return dateA.localeCompare(dateB);
  });

  // Group by year first
  const byYear: Record<string, any[]> = {};
  for (const p of sorted) {
    const year = (p.patent_date || '').substring(0, 4) || 'Unknown';
    if (!byYear[year]) {
      byYear[year] = [];
    }
    byYear[year].push(p);
  }

  const result: Array<{ dateLabel: string; startDate: string; endDate: string; patents: any[] }> = [];
  const years = Object.keys(byYear).sort();

  let currentChunk: any[] = [];
  let chunkStartYear = '';

  for (const year of years) {
    const yearPatents = byYear[year];

    if (currentChunk.length === 0) {
      chunkStartYear = year;
    }

    // Would adding this year exceed target?
    if (currentChunk.length + yearPatents.length > targetSize && currentChunk.length > 0) {
      // Flush current chunk
      const chunkEndYear = years[years.indexOf(year) - 1] || chunkStartYear;
      const dateLabel = chunkStartYear === chunkEndYear ? chunkStartYear : `${chunkStartYear}-${chunkEndYear}`;
      result.push({
        dateLabel,
        startDate: chunkStartYear,
        endDate: chunkEndYear,
        patents: currentChunk,
      });

      // Start new chunk with this year
      currentChunk = [...yearPatents];
      chunkStartYear = year;
    } else {
      currentChunk.push(...yearPatents);
    }
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    const lastYear = years[years.length - 1];
    const dateLabel = chunkStartYear === lastYear ? chunkStartYear : `${chunkStartYear}-${lastYear}`;
    result.push({
      dateLabel,
      startDate: chunkStartYear,
      endDate: lastYear,
      patents: currentChunk,
    });
  }

  return result;
}

/**
 * Format CPC code into a readable display name
 */
function formatCpcDisplayName(cpcCode: string): string {
  // For now, just return the code itself
  // Could look up from CpcCode table for full title
  return cpcCode;
}

/**
 * Analyze a sector and return summary of sub-sector breakdown potential
 */
export async function analyzeSubSectorPotential(
  sectorName: string,
  candidatesFile: string = 'streaming-candidates-2026-01-25.json'
): Promise<{
  sectorName: string;
  totalPatents: number;
  uniqueCpcCodes: number;
  distribution: {
    under20: number;
    from20to50: number;
    from50to100: number;
    from100to200: number;
    from200to300: number;
    over300: number;
  };
  largestGroups: Array<{ cpcCode: string; count: number }>;
  recommendedStrategy: string;
}> {
  // Load candidates
  const candidatesPath = path.join(process.cwd(), 'output', candidatesFile);
  const data = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8'));
  const candidates = data.candidates || [];

  // Filter to sector
  const sectorPatents = candidates.filter((p: any) => p.primary_sector === sectorName);

  if (sectorPatents.length === 0) {
    return {
      sectorName,
      totalPatents: 0,
      uniqueCpcCodes: 0,
      distribution: { under20: 0, from20to50: 0, from50to100: 0, from100to200: 0, from200to300: 0, over300: 0 },
      largestGroups: [],
      recommendedStrategy: 'No patents in sector',
    };
  }

  // Group by CPC
  const cpcGroups = groupByCpcSubgroup(sectorPatents);
  const sizes = Object.values(cpcGroups).map(g => g.length);

  const distribution = {
    under20: sizes.filter(s => s < 20).length,
    from20to50: sizes.filter(s => s >= 20 && s < 50).length,
    from50to100: sizes.filter(s => s >= 50 && s < 100).length,
    from100to200: sizes.filter(s => s >= 100 && s < 200).length,
    from200to300: sizes.filter(s => s >= 200 && s < 300).length,
    over300: sizes.filter(s => s >= 300).length,
  };

  const largestGroups = Object.entries(cpcGroups)
    .map(([cpc, patents]) => ({ cpcCode: cpc, count: patents.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Determine recommendation
  let recommendedStrategy: string;
  const over100Count = distribution.from100to200 + distribution.from200to300 + distribution.over300;

  if (over100Count === 0) {
    recommendedStrategy = 'CPC-only: All subgroups are under 100 patents';
  } else if (distribution.over300 === 0) {
    recommendedStrategy = 'CPC + date splitting: Some groups 100-300 can be split by date';
  } else {
    recommendedStrategy = 'CPC + date splitting + manual review: Some groups > 300 may need intervention';
  }

  return {
    sectorName,
    totalPatents: sectorPatents.length,
    uniqueCpcCodes: Object.keys(cpcGroups).length,
    distribution,
    largestGroups,
    recommendedStrategy,
  };
}
