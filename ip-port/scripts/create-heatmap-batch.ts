/**
 * Create Patlytics heatmap batch submission packages.
 * Selects top patents per sector/super-sector for heatmap analysis.
 *
 * Usage:
 *   npx tsx scripts/create-heatmap-batch.ts <SUPER_SECTOR|SECTOR> [options]
 *     --top <n>           Patents per sector (default: 10)
 *     --min-score <n>     Min v3 composite score (default: 0)
 *     --min-years <n>     Min remaining years (default: 3)
 *     --score-type <name> Score to rank by: v3_score or v2_score (default: v3_score)
 *     --by-sector         Split into per-sector batches (for large super-sectors)
 *     --output <dir>      Output directory (default: output/heatmap-batches/)
 *     --list-only         Just print patent list, no files
 *
 * Examples:
 *   npx tsx scripts/create-heatmap-batch.ts VIDEO_STREAMING --by-sector --top=10
 *   npx tsx scripts/create-heatmap-batch.ts video-codec --top=15
 *   npx tsx scripts/create-heatmap-batch.ts WIRELESS --top=8 --by-sector
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface BatchArgs {
  target: string;
  top: number;
  minScore: number;
  minYears: number;
  scoreType: string;
  bySector: boolean;
  outputDir: string;
  listOnly: boolean;
}

function parseArgs(): BatchArgs {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--'));
  let top = 10;
  let minScore = 0;
  let minYears = 3;
  let scoreType = 'v3_score';
  let bySector = false;
  let outputDir = path.join(process.cwd(), 'output', 'heatmap-batches');
  let listOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--top' && args[i + 1]) top = parseInt(args[++i], 10);
    else if (args[i] === '--min-score' && args[i + 1]) minScore = parseFloat(args[++i]);
    else if (args[i] === '--min-years' && args[i + 1]) minYears = parseFloat(args[++i]);
    else if (args[i] === '--score-type' && args[i + 1]) scoreType = args[++i];
    else if (args[i] === '--by-sector') bySector = true;
    else if (args[i] === '--output' && args[i + 1]) outputDir = args[++i];
    else if (args[i] === '--list-only') listOnly = true;
  }

  if (!target) {
    console.error('Usage: npx tsx scripts/create-heatmap-batch.ts <SUPER_SECTOR|SECTOR> [options]');
    console.error('Examples:');
    console.error('  npx tsx scripts/create-heatmap-batch.ts VIDEO_STREAMING --by-sector --top=10');
    console.error('  npx tsx scripts/create-heatmap-batch.ts video-codec --top=15');
    process.exit(1);
  }

  return { target: target!, top, minScore, minYears, scoreType, bySector, outputDir, listOnly };
}

// Load super-sector config
function loadSuperSectors(): Record<string, { displayName: string; sectors: string[] }> {
  const configPath = path.join(process.cwd(), 'config', 'super-sectors.json');
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return raw.superSectors || raw;
}

interface BatchPatent {
  patentId: string;
  fullPatentId: string;
  title: string;
  sector: string;
  superSector: string;
  compositeScore: number;
  rank: number | null;
  baseScore: number | null;
  remainingYears: number | null;
  forwardCitations: number;
  primaryCpc: string | null;
}

interface HeatmapBatch {
  name: string;
  sector: string;
  superSector: string;
  patents: BatchPatent[];
}

async function getTopPatentsForSector(
  sector: string,
  superSector: string,
  topN: number,
  minScore: number,
  minYears: number,
  scoreType: string
): Promise<BatchPatent[]> {
  // Get patents with composite scores
  const scores = await prisma.patentCompositeScore.findMany({
    where: {
      scoreName: scoreType,
      value: { gte: minScore },
      patent: {
        primarySector: sector,
        isExpired: false,
        ...(minYears > 0 ? { remainingYears: { gte: minYears } } : {}),
      },
    },
    orderBy: { value: 'desc' },
    take: topN,
    select: {
      patentId: true,
      value: true,
      rank: true,
      patent: {
        select: {
          title: true,
          primarySector: true,
          superSector: true,
          baseScore: true,
          remainingYears: true,
          forwardCitations: true,
          primaryCpc: true,
        },
      },
    },
  });

  return scores.map(s => ({
    patentId: s.patentId,
    fullPatentId: `US-${s.patentId}-B2`,
    title: s.patent.title,
    sector: s.patent.primarySector || sector,
    superSector: s.patent.superSector || superSector,
    compositeScore: s.value,
    rank: s.rank,
    baseScore: s.patent.baseScore,
    remainingYears: s.patent.remainingYears,
    forwardCitations: s.patent.forwardCitations,
    primaryCpc: s.patent.primaryCpc,
  }));
}

async function main(): Promise<void> {
  const config = parseArgs();
  const superSectors = loadSuperSectors();

  console.log('=== Create Patlytics Heatmap Batch ===\n');
  console.log(`Target:     ${config.target}`);
  console.log(`Top N:      ${config.top} per sector`);
  console.log(`Score type: ${config.scoreType}`);
  console.log(`Min score:  ${config.minScore}`);
  console.log(`Min years:  ${config.minYears}`);
  console.log(`By sector:  ${config.bySector}`);

  // Determine if target is a super-sector or sector
  const isSuperSector = config.target === config.target.toUpperCase() && superSectors[config.target];
  let sectors: string[];
  let superSectorName: string;

  if (isSuperSector) {
    const ssConfig = superSectors[config.target];
    sectors = ssConfig.sectors;
    superSectorName = config.target;
    console.log(`\nSuper-sector: ${ssConfig.displayName}`);
    console.log(`Sectors: ${sectors.join(', ')}`);
  } else {
    sectors = [config.target];
    // Find which super-sector this sector belongs to
    superSectorName = 'UNKNOWN';
    for (const [ss, ssConfig] of Object.entries(superSectors)) {
      if (ssConfig.sectors.includes(config.target)) {
        superSectorName = ss;
        break;
      }
    }
    console.log(`\nSector: ${config.target} (${superSectorName})`);
  }

  // Build batches
  const batches: HeatmapBatch[] = [];

  if (config.bySector) {
    // One batch per sector
    for (const sector of sectors) {
      const patents = await getTopPatentsForSector(
        sector, superSectorName, config.top, config.minScore, config.minYears, config.scoreType
      );
      if (patents.length > 0) {
        batches.push({ name: sector, sector, superSector: superSectorName, patents });
      }
    }
  } else {
    // Combined batch — get top N from each sector, then merge and re-rank
    const allPatents: BatchPatent[] = [];
    for (const sector of sectors) {
      const patents = await getTopPatentsForSector(
        sector, superSectorName, config.top * 2, config.minScore, config.minYears, config.scoreType
      );
      allPatents.push(...patents);
    }
    // Sort by score, take top N total
    allPatents.sort((a, b) => b.compositeScore - a.compositeScore);
    const topPatents = allPatents.slice(0, config.top);

    if (topPatents.length > 0) {
      batches.push({
        name: isSuperSector ? config.target.toLowerCase() : config.target,
        sector: isSuperSector ? 'mixed' : config.target,
        superSector: superSectorName,
        patents: topPatents,
      });
    }
  }

  // Output
  console.log(`\n${'='.repeat(60)}`);

  let totalPatents = 0;
  for (const batch of batches) {
    console.log(`\n--- ${batch.name} (${batch.patents.length} patents) ---`);
    for (const p of batch.patents) {
      console.log(`  ${p.fullPatentId} | ${config.scoreType}=${p.compositeScore.toFixed(2)} | rank=${p.rank ?? '-'} | base=${p.baseScore?.toFixed(1) ?? '-'} | yrs=${p.remainingYears?.toFixed(1) ?? '-'} | cites=${p.forwardCitations}`);
      console.log(`    ${p.title?.substring(0, 75)}`);
    }
    totalPatents += batch.patents.length;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total: ${batches.length} batches, ${totalPatents} patents`);

  if (config.listOnly) {
    // Print bare patent ID list for easy copy/paste
    console.log('\n--- Patent IDs (copy/paste for Patlytics) ---');
    for (const batch of batches) {
      if (batches.length > 1) console.log(`\n[${batch.name}]`);
      for (const p of batch.patents) {
        console.log(p.fullPatentId);
      }
    }
    await prisma.$disconnect();
    return;
  }

  // Write output files
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().split('T')[0];

  for (const batch of batches) {
    const batchDir = path.join(config.outputDir, `${batch.name}-${timestamp}`);
    if (!fs.existsSync(batchDir)) {
      fs.mkdirSync(batchDir, { recursive: true });
    }

    // Patent list CSV
    const csvLines = [
      'PublicationID,Title,Sector,CompositeScore,Rank,BaseScore,RemainingYears,Citations,PrimaryCPC',
    ];
    for (const p of batch.patents) {
      csvLines.push([
        p.fullPatentId,
        `"${(p.title || '').replace(/"/g, '""')}"`,
        p.sector,
        p.compositeScore.toFixed(4),
        p.rank ?? '',
        p.baseScore?.toFixed(2) ?? '',
        p.remainingYears?.toFixed(1) ?? '',
        p.forwardCitations,
        p.primaryCpc || '',
      ].join(','));
    }
    fs.writeFileSync(path.join(batchDir, 'patent-list.csv'), csvLines.join('\n'));

    // Plain patent ID list (for Patlytics paste)
    const idList = batch.patents.map(p => p.fullPatentId).join('\n');
    fs.writeFileSync(path.join(batchDir, 'patent-ids.txt'), idList);

    // Batch metadata JSON
    const metadata = {
      name: batch.name,
      sector: batch.sector,
      superSector: batch.superSector,
      createdAt: new Date().toISOString(),
      config: {
        topN: config.top,
        minScore: config.minScore,
        minYears: config.minYears,
        scoreType: config.scoreType,
      },
      patentCount: batch.patents.length,
      avgScore: batch.patents.reduce((a, b) => a + b.compositeScore, 0) / batch.patents.length,
      patents: batch.patents,
    };
    fs.writeFileSync(path.join(batchDir, 'batch-metadata.json'), JSON.stringify(metadata, null, 2));

    console.log(`\nBatch output: ${batchDir}/`);
    console.log(`  patent-list.csv    — Full details`);
    console.log(`  patent-ids.txt     — For Patlytics submission`);
    console.log(`  batch-metadata.json — Batch config & provenance`);
  }

  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
