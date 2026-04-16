/**
 * Nutanix Sector Gap Analysis
 *
 * Queries existing DB data (no API cost) to produce two reports:
 *
 * Output A: Portfolio-wide LLM coverage report per sector
 *   - Total broadcom-core patents, LLM coverage, sub-sector scores, V3 snapshot presence
 *
 * Output B: Undervalued patents among LLM-scored (hidden gems)
 *   - High V3 Litigation Discovery score but low base score or not in Nutanix focus area
 *
 * Usage:
 *   npx tsx scripts/analyze-nutanix-sector-gaps.ts
 *   npx tsx scripts/analyze-nutanix-sector-gaps.ts --top=50     # Show top 50 hidden gems (default 30)
 *   npx tsx scripts/analyze-nutanix-sector-gaps.ts --json-only  # Skip console tables, only write JSON
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const OUTPUT_DIR = path.join(process.cwd(), 'output');

// ─── Nutanix-relevant sectors (22 total) ───────────────────────────────────

const NUTANIX_SECTORS: Record<string, string[]> = {
  COMPUTING: [
    'computing-runtime',
    'computing-systems',
    'computing-ui',
    'data-retrieval',
    'fintech-business',
    'power-management',
  ],
  NETWORKING: [
    'network-error-control',
    'network-management',
    'network-multiplexing',
    'network-protocols',
    'network-signal-processing',
    'network-switching',
    'streaming-multimedia',
    'telephony',
  ],
  SECURITY: [
    'computing-auth-boot',
    'computing-data-protection',
    'computing-os-security',
    'network-auth-access',
    'network-crypto',
    'network-secure-compute',
    'network-threat-protection',
    'wireless-security',
  ],
};

const ALL_SECTORS = Object.values(NUTANIX_SECTORS).flat();

// ─── Types ─────────────────────────────────────────────────────────────────

interface SectorCoverage {
  sector: string;
  superSector: string;
  totalPatents: number;
  withLlmData: number;
  withSubSectorScore: number;
  withV3Score: number;
  gapCount: number; // no LLM data at all
  llmCoveragePct: number;
}

interface HiddenGem {
  patentId: string;
  title: string;
  sector: string;
  superSector: string;
  baseScore: number;
  v3Score: number;
  v3Rank: number;
  forwardCitations: number;
  remainingYears: number;
  inNutanixFocusArea: boolean;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const topN = parseInt(args.find(a => a.startsWith('--top='))?.split('=')[1] || '30');
  const jsonOnly = args.includes('--json-only');

  console.log('=== Nutanix Sector Gap Analysis ===\n');

  // Resolve portfolio
  const portfolio = await prisma.portfolio.findUnique({
    where: { name: 'broadcom-core' },
    select: { id: true },
  });
  if (!portfolio) {
    console.error('broadcom-core portfolio not found');
    process.exit(1);
  }

  // Find active V3 snapshot
  const v3Snapshot = await prisma.scoreSnapshot.findFirst({
    where: { scoreType: 'V3', isActive: true, portfolioId: portfolio.id },
    select: { id: true, name: true, patentCount: true, llmDataCount: true },
  });
  if (!v3Snapshot) {
    console.warn('WARNING: No active V3 snapshot found. V3 columns will be zero.\n');
  } else {
    console.log(`V3 Snapshot: ${v3Snapshot.name} (${v3Snapshot.patentCount} patents, ${v3Snapshot.llmDataCount} with LLM data)\n`);
  }

  // Find Nutanix focus area patent IDs
  const nutanixFA = await prisma.focusArea.findFirst({
    where: { name: { contains: 'utanix', mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  let nutanixPatentIds = new Set<string>();
  if (nutanixFA) {
    const faPatents = await prisma.focusAreaPatent.findMany({
      where: { focusAreaId: nutanixFA.id },
      select: { patentId: true },
    });
    nutanixPatentIds = new Set(faPatents.map(p => p.patentId));
    console.log(`Nutanix FA: ${nutanixFA.name} (${nutanixPatentIds.size} patents)\n`);
  }

  // ─── Output A: Per-sector coverage ─────────────────────────────────────

  console.log('--- Output A: LLM Coverage by Sector ---\n');

  const coverageRows: SectorCoverage[] = [];

  for (const superSector of Object.keys(NUTANIX_SECTORS)) {
    for (const sector of NUTANIX_SECTORS[superSector]) {
      // Total patents in broadcom-core for this sector
      const totalPatents = await prisma.patent.count({
        where: {
          primarySector: sector,
          isQuarantined: false,
          portfolios: { some: { portfolioId: portfolio.id } },
        },
      });

      // Count with hasLlmData = true
      const withLlmData = await prisma.patent.count({
        where: {
          primarySector: sector,
          isQuarantined: false,
          hasLlmData: true,
          portfolios: { some: { portfolioId: portfolio.id } },
        },
      });

      // Count with PatentSubSectorScore records
      const patentsInSector = await prisma.patent.findMany({
        where: {
          primarySector: sector,
          isQuarantined: false,
          portfolios: { some: { portfolioId: portfolio.id } },
        },
        select: { patentId: true },
      });
      const sectorPatentIds = patentsInSector.map(p => p.patentId);

      let withSubSectorScore = 0;
      if (sectorPatentIds.length > 0) {
        const scored = await prisma.patentSubSectorScore.findMany({
          where: { patentId: { in: sectorPatentIds } },
          select: { patentId: true },
          distinct: ['patentId'],
        });
        withSubSectorScore = scored.length;
      }

      // Count with V3 snapshot scores
      let withV3Score = 0;
      if (v3Snapshot && sectorPatentIds.length > 0) {
        const v3Scored = await prisma.patentScoreEntry.findMany({
          where: {
            snapshotId: v3Snapshot.id,
            patentId: { in: sectorPatentIds },
          },
          select: { patentId: true },
        });
        withV3Score = v3Scored.length;
      }

      const gapCount = totalPatents - withLlmData;
      const llmCoveragePct = totalPatents > 0 ? (withLlmData / totalPatents) * 100 : 0;

      coverageRows.push({
        sector,
        superSector,
        totalPatents,
        withLlmData,
        withSubSectorScore,
        withV3Score,
        gapCount,
        llmCoveragePct,
      });
    }
  }

  if (!jsonOnly) {
    // Print table header
    const hdr = [
      'Super-Sector'.padEnd(12),
      'Sector'.padEnd(28),
      'Total'.padStart(6),
      'LLM'.padStart(6),
      'SubSec'.padStart(7),
      'V3'.padStart(6),
      'Gap'.padStart(6),
      'LLM%'.padStart(7),
    ].join(' | ');
    console.log(hdr);
    console.log('-'.repeat(hdr.length));

    for (const row of coverageRows) {
      console.log([
        row.superSector.padEnd(12),
        row.sector.padEnd(28),
        String(row.totalPatents).padStart(6),
        String(row.withLlmData).padStart(6),
        String(row.withSubSectorScore).padStart(7),
        String(row.withV3Score).padStart(6),
        String(row.gapCount).padStart(6),
        `${row.llmCoveragePct.toFixed(1)}%`.padStart(7),
      ].join(' | '));
    }

    // Summary
    const totals = coverageRows.reduce(
      (acc, r) => ({
        total: acc.total + r.totalPatents,
        llm: acc.llm + r.withLlmData,
        subSec: acc.subSec + r.withSubSectorScore,
        v3: acc.v3 + r.withV3Score,
        gap: acc.gap + r.gapCount,
      }),
      { total: 0, llm: 0, subSec: 0, v3: 0, gap: 0 }
    );
    console.log('-'.repeat(hdr.length));
    console.log([
      'TOTAL'.padEnd(12),
      ''.padEnd(28),
      String(totals.total).padStart(6),
      String(totals.llm).padStart(6),
      String(totals.subSec).padStart(7),
      String(totals.v3).padStart(6),
      String(totals.gap).padStart(6),
      `${totals.total > 0 ? ((totals.llm / totals.total) * 100).toFixed(1) : '0.0'}%`.padStart(7),
    ].join(' | '));
    console.log();
  }

  // ─── Output B: Hidden gems (undervalued patents) ───────────────────────

  console.log(`--- Output B: Hidden Gems (top ${topN}) ---`);
  console.log('High V3 score + low base score or not in Nutanix FA\n');

  const hiddenGems: HiddenGem[] = [];

  if (v3Snapshot) {
    // Get all V3-scored patents in Nutanix-relevant sectors
    const nutanixSectorPatents = await prisma.patent.findMany({
      where: {
        primarySector: { in: ALL_SECTORS },
        isQuarantined: false,
        portfolios: { some: { portfolioId: portfolio.id } },
      },
      select: {
        patentId: true,
        title: true,
        primarySector: true,
        superSector: true,
        baseScore: true,
        forwardCitations: true,
        remainingYears: true,
      },
    });
    const patentMap = new Map(nutanixSectorPatents.map(p => [p.patentId, p]));
    const allIds = nutanixSectorPatents.map(p => p.patentId);

    // Get V3 scores for these patents
    const v3Entries = await prisma.patentScoreEntry.findMany({
      where: {
        snapshotId: v3Snapshot.id,
        patentId: { in: allIds },
      },
      select: { patentId: true, score: true, rank: true },
      orderBy: { score: 'desc' },
    });

    if (v3Entries.length > 0) {
      // Find top-20% threshold per sector
      const entriesBySector = new Map<string, typeof v3Entries>();
      for (const entry of v3Entries) {
        const patent = patentMap.get(entry.patentId);
        if (!patent) continue;
        const sector = patent.primarySector || 'unknown';
        if (!entriesBySector.has(sector)) entriesBySector.set(sector, []);
        entriesBySector.get(sector)!.push(entry);
      }

      const top20Thresholds = new Map<string, number>();
      for (const [sector, entries] of entriesBySector) {
        entries.sort((a, b) => b.score - a.score);
        const idx = Math.floor(entries.length * 0.2);
        top20Thresholds.set(sector, entries[idx]?.score || 0);
      }

      // Find hidden gems: top-20% V3 score but base < 40 or not in Nutanix FA
      for (const entry of v3Entries) {
        const patent = patentMap.get(entry.patentId);
        if (!patent) continue;
        const sector = patent.primarySector || 'unknown';
        const threshold = top20Thresholds.get(sector) || 0;

        if (entry.score >= threshold) {
          const baseScore = patent.baseScore || 0;
          const inFA = nutanixPatentIds.has(entry.patentId);

          if (baseScore < 40 || !inFA) {
            hiddenGems.push({
              patentId: entry.patentId,
              title: patent.title,
              sector,
              superSector: patent.superSector || 'UNKNOWN',
              baseScore,
              v3Score: entry.score,
              v3Rank: entry.rank,
              forwardCitations: patent.forwardCitations,
              remainingYears: patent.remainingYears || 0,
              inNutanixFocusArea: inFA,
            });
          }
        }
      }

      // Sort by V3 score descending
      hiddenGems.sort((a, b) => b.v3Score - a.v3Score);
    }
  }

  if (!jsonOnly) {
    const gems = hiddenGems.slice(0, topN);
    if (gems.length === 0) {
      console.log('No hidden gems found (V3 snapshot may be missing or sectors have no LLM data).\n');
    } else {
      const gemHdr = [
        'Patent'.padEnd(12),
        'Sector'.padEnd(24),
        'Base'.padStart(6),
        'V3'.padStart(8),
        'V3Rank'.padStart(7),
        'Cites'.padStart(6),
        'YrsRem'.padStart(7),
        'InFA'.padStart(5),
        'Title',
      ].join(' | ');
      console.log(gemHdr);
      console.log('-'.repeat(gemHdr.length));

      for (const g of gems) {
        console.log([
          g.patentId.padEnd(12),
          g.sector.padEnd(24),
          g.baseScore.toFixed(1).padStart(6),
          g.v3Score.toFixed(2).padStart(8),
          String(g.v3Rank).padStart(7),
          String(g.forwardCitations).padStart(6),
          g.remainingYears.toFixed(1).padStart(7),
          (g.inNutanixFocusArea ? 'Y' : 'N').padStart(5),
          g.title.substring(0, 55),
        ].join(' | '));
      }

      console.log(`\nShowing ${gems.length} of ${hiddenGems.length} total hidden gems`);
    }
  }

  // ─── Write JSON output ─────────────────────────────────────────────────

  const dateStr = new Date().toISOString().split('T')[0];
  const outputPath = path.join(OUTPUT_DIR, `nutanix-gap-analysis-${dateStr}.json`);

  const report = {
    generatedAt: new Date().toISOString(),
    v3Snapshot: v3Snapshot ? { id: v3Snapshot.id, name: v3Snapshot.name } : null,
    nutanixFocusArea: nutanixFA ? { id: nutanixFA.id, name: nutanixFA.name, patentCount: nutanixPatentIds.size } : null,
    sectorCoverage: coverageRows,
    summary: {
      totalPatents: coverageRows.reduce((s, r) => s + r.totalPatents, 0),
      withLlmData: coverageRows.reduce((s, r) => s + r.withLlmData, 0),
      withSubSectorScore: coverageRows.reduce((s, r) => s + r.withSubSectorScore, 0),
      withV3Score: coverageRows.reduce((s, r) => s + r.withV3Score, 0),
      gapCount: coverageRows.reduce((s, r) => s + r.gapCount, 0),
    },
    hiddenGems,
  };

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report saved to: ${outputPath}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});
