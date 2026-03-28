/**
 * Classification Divergence Analysis
 *
 * Analyzes multi-classification divergence at each taxonomy level:
 * - Level 1 (Super-sectors): Highest divergence weight
 * - Level 2 (Sectors): Medium divergence weight
 * - Level 3 (Sub-sectors): Lowest divergence weight
 *
 * Outputs:
 * 1. Aggregate statistics by level
 * 2. Top divergent patents CSV (weighted scoring)
 * 3. TopN patents with all associations CSV
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface PatentClassifications {
  patentId: string;
  classifications: Array<{
    rank: number;
    nodeId: string;
    nodeCode: string;
    nodeName: string;
    level: number;
    level1Code: string | null;
    level1Name: string | null;
    level2Code: string | null;
    level2Name: string | null;
    level3Code: string | null;
    weight: number;
    confidence: number | null;
  }>;
}

interface DivergenceScore {
  patentId: string;
  uniqueLevel1Count: number;
  uniqueLevel2Count: number;
  uniqueLevel3Count: number;
  divergenceScore: number;
  level1Codes: string[];
  level2Codes: string[];
  level3Codes: string[];
  classifications: PatentClassifications['classifications'];
}

// Divergence weights (super-sector divergence is most significant)
const LEVEL1_WEIGHT = 10;
const LEVEL2_WEIGHT = 3;
const LEVEL3_WEIGHT = 1;

async function main() {
  console.log('Classification Divergence Analysis');
  console.log('==================================\n');

  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get all patents with their classifications and node ancestry
  console.log('Loading patent classifications...');
  const classifications = await prisma.$queryRaw<Array<{
    object_id: string;
    association_rank: number;
    taxonomy_node_id: string;
    node_code: string;
    node_name: string;
    node_level: number;
    weight: number;
    confidence: number | null;
    level1_code: string | null;
    level1_name: string | null;
    level2_code: string | null;
    level2_name: string | null;
    level3_code: string | null;
  }>>`
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
        CASE WHEN n.level = 3 THEN n.code ELSE NULL END as level3_code
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
      na.level1_code,
      na.level1_name,
      na.level2_code,
      na.level2_name,
      na.level3_code
    FROM object_classifications oc
    JOIN node_ancestry na ON oc.taxonomy_node_id = na.id
    WHERE oc.object_type = 'patent'
    ORDER BY oc.object_id, oc.association_rank
  `;

  console.log(`Loaded ${classifications.length} classification records\n`);

  // Group by patent
  const patentMap = new Map<string, PatentClassifications>();
  for (const row of classifications) {
    if (!patentMap.has(row.object_id)) {
      patentMap.set(row.object_id, { patentId: row.object_id, classifications: [] });
    }
    patentMap.get(row.object_id)!.classifications.push({
      rank: row.association_rank,
      nodeId: row.taxonomy_node_id,
      nodeCode: row.node_code,
      nodeName: row.node_name,
      level: row.node_level,
      level1Code: row.level1_code,
      level1Name: row.level1_name,
      level2Code: row.level2_code,
      level2Name: row.level2_name,
      level3Code: row.level3_code,
      weight: Number(row.weight),
      confidence: row.confidence ? Number(row.confidence) : null,
    });
  }

  console.log(`Processing ${patentMap.size} patents...\n`);

  // Calculate divergence for each patent
  const divergenceScores: DivergenceScore[] = [];

  for (const [patentId, patent] of patentMap) {
    const level1Codes = new Set<string>();
    const level2Codes = new Set<string>();
    const level3Codes = new Set<string>();

    for (const c of patent.classifications) {
      if (c.level1Code) level1Codes.add(c.level1Code);
      if (c.level2Code) level2Codes.add(c.level2Code);
      if (c.level3Code) level3Codes.add(c.level3Code);
    }

    // Calculate weighted divergence score
    // Only count divergence (unique > 1)
    const l1Divergence = Math.max(0, level1Codes.size - 1);
    const l2Divergence = Math.max(0, level2Codes.size - 1);
    const l3Divergence = Math.max(0, level3Codes.size - 1);

    const divergenceScore =
      l1Divergence * LEVEL1_WEIGHT +
      l2Divergence * LEVEL2_WEIGHT +
      l3Divergence * LEVEL3_WEIGHT;

    divergenceScores.push({
      patentId,
      uniqueLevel1Count: level1Codes.size,
      uniqueLevel2Count: level2Codes.size,
      uniqueLevel3Count: level3Codes.size,
      divergenceScore,
      level1Codes: Array.from(level1Codes),
      level2Codes: Array.from(level2Codes),
      level3Codes: Array.from(level3Codes),
      classifications: patent.classifications,
    });
  }

  // ========================================
  // REPORT 1: Aggregate Statistics by Level
  // ========================================
  console.log('DIVERGENCE STATISTICS BY LEVEL');
  console.log('==============================\n');

  const totalPatents = divergenceScores.length;

  // Level 1 (Super-sectors)
  const multiLevel1 = divergenceScores.filter(d => d.uniqueLevel1Count >= 2).length;
  const threeLevel1 = divergenceScores.filter(d => d.uniqueLevel1Count >= 3).length;
  console.log('Level 1 (Super-sectors):');
  console.log(`  2+ super-sectors: ${multiLevel1.toLocaleString()} (${(multiLevel1/totalPatents*100).toFixed(1)}%)`);
  console.log(`  3  super-sectors: ${threeLevel1.toLocaleString()} (${(threeLevel1/totalPatents*100).toFixed(1)}%)`);

  // Level 2 (Sectors)
  const multiLevel2 = divergenceScores.filter(d => d.uniqueLevel2Count >= 2).length;
  const threeLevel2 = divergenceScores.filter(d => d.uniqueLevel2Count >= 3).length;
  console.log('\nLevel 2 (Sectors):');
  console.log(`  2+ sectors: ${multiLevel2.toLocaleString()} (${(multiLevel2/totalPatents*100).toFixed(1)}%)`);
  console.log(`  3  sectors: ${threeLevel2.toLocaleString()} (${(threeLevel2/totalPatents*100).toFixed(1)}%)`);

  // Level 3 (Sub-sectors/CPC codes)
  const multiLevel3 = divergenceScores.filter(d => d.uniqueLevel3Count >= 2).length;
  const threeLevel3 = divergenceScores.filter(d => d.uniqueLevel3Count >= 3).length;
  console.log('\nLevel 3 (Sub-sectors):');
  console.log(`  2+ sub-sectors: ${multiLevel3.toLocaleString()} (${(multiLevel3/totalPatents*100).toFixed(1)}%)`);
  console.log(`  3  sub-sectors: ${threeLevel3.toLocaleString()} (${(threeLevel3/totalPatents*100).toFixed(1)}%)`);

  // Divergence score distribution
  const withDivergence = divergenceScores.filter(d => d.divergenceScore > 0).length;
  const highDivergence = divergenceScores.filter(d => d.divergenceScore >= 20).length;
  console.log('\nWeighted Divergence Score:');
  console.log(`  Score > 0:  ${withDivergence.toLocaleString()} (${(withDivergence/totalPatents*100).toFixed(1)}%)`);
  console.log(`  Score >= 20: ${highDivergence.toLocaleString()} (${(highDivergence/totalPatents*100).toFixed(1)}%)`);

  // ========================================
  // REPORT 2: Top Divergent Patents CSV
  // ========================================
  console.log('\n\nGenerating top divergent patents CSV...');

  // Sort by divergence score descending
  const sortedByDivergence = [...divergenceScores]
    .sort((a, b) => b.divergenceScore - a.divergenceScore)
    .slice(0, 500); // Top 500

  const divergenceCSV = [
    'patent_id,divergence_score,unique_super_sectors,unique_sectors,unique_sub_sectors,super_sector_codes,sector_codes,primary_node,secondary_node,tertiary_node'
  ];

  for (const d of sortedByDivergence) {
    const primary = d.classifications.find(c => c.rank === 1);
    const secondary = d.classifications.find(c => c.rank === 2);
    const tertiary = d.classifications.find(c => c.rank === 3);

    divergenceCSV.push([
      d.patentId,
      d.divergenceScore,
      d.uniqueLevel1Count,
      d.uniqueLevel2Count,
      d.uniqueLevel3Count,
      `"${d.level1Codes.join(', ')}"`,
      `"${d.level2Codes.join(', ')}"`,
      primary ? `"${primary.nodeName}"` : '',
      secondary ? `"${secondary.nodeName}"` : '',
      tertiary ? `"${tertiary.nodeName}"` : '',
    ].join(','));
  }

  const divergenceFile = path.join(outputDir, 'top-divergent-patents.csv');
  fs.writeFileSync(divergenceFile, divergenceCSV.join('\n'));
  console.log(`  Saved: ${divergenceFile}`);

  // ========================================
  // REPORT 3: TopN Patents with All Associations
  // ========================================
  console.log('\nGenerating topN patents with associations CSV...');

  // Get topN patents by v2 scoring
  const topPatents = await prisma.$queryRaw<Array<{
    patent_id: string;
    title: string;
    assignee: string;
    filing_date: string;
    v2_score: number;
  }>>`
    SELECT
      p.patent_id,
      p.title,
      p.assignee,
      p.filing_date::text,
      pcs.value as v2_score
    FROM patents p
    JOIN patent_composite_scores pcs ON pcs.patent_id = p.patent_id AND pcs.score_name = 'v2_score'
    ORDER BY pcs.value DESC
    LIMIT 500
  `;

  const topPatentsCSV = [
    'patent_id,title,assignee,filing_date,v2_score,primary_super_sector,primary_sector,primary_sub_sector,primary_confidence,secondary_super_sector,secondary_sector,secondary_confidence,tertiary_super_sector,tertiary_sector,tertiary_confidence'
  ];

  for (const p of topPatents) {
    const div = divergenceScores.find(d => d.patentId === p.patent_id);
    if (!div) continue;

    const primary = div.classifications.find(c => c.rank === 1);
    const secondary = div.classifications.find(c => c.rank === 2);
    const tertiary = div.classifications.find(c => c.rank === 3);

    topPatentsCSV.push([
      p.patent_id,
      `"${(p.title || '').replace(/"/g, '""')}"`,
      `"${(p.assignee || '').replace(/"/g, '""')}"`,
      p.filing_date || '',
      p.v2_score?.toFixed(2) || '',
      primary?.level1Code || '',
      primary?.level2Code || '',
      primary?.level3Code || '',
      primary?.confidence?.toFixed(2) || '',
      secondary?.level1Code || '',
      secondary?.level2Code || '',
      secondary?.confidence?.toFixed(2) || '',
      tertiary?.level1Code || '',
      tertiary?.level2Code || '',
      tertiary?.confidence?.toFixed(2) || '',
    ].join(','));
  }

  const topPatentsFile = path.join(outputDir, 'topn-patents-with-associations.csv');
  fs.writeFileSync(topPatentsFile, topPatentsCSV.join('\n'));
  console.log(`  Saved: ${topPatentsFile}`);

  // ========================================
  // Summary JSON
  // ========================================
  const summary = {
    timestamp: new Date().toISOString(),
    totalPatents,
    divergenceByLevel: {
      level1_superSectors: {
        with2Plus: multiLevel1,
        with3: threeLevel1,
        pct2Plus: (multiLevel1/totalPatents*100).toFixed(1),
      },
      level2_sectors: {
        with2Plus: multiLevel2,
        with3: threeLevel2,
        pct2Plus: (multiLevel2/totalPatents*100).toFixed(1),
      },
      level3_subSectors: {
        with2Plus: multiLevel3,
        with3: threeLevel3,
        pct2Plus: (multiLevel3/totalPatents*100).toFixed(1),
      },
    },
    divergenceScoreStats: {
      withAnyDivergence: withDivergence,
      withHighDivergence: highDivergence,
      weights: { level1: LEVEL1_WEIGHT, level2: LEVEL2_WEIGHT, level3: LEVEL3_WEIGHT },
    },
    outputFiles: [divergenceFile, topPatentsFile],
  };

  const summaryFile = path.join(outputDir, 'classification-divergence-summary.json');
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  console.log(`\n  Summary saved: ${summaryFile}`);

  await prisma.$disconnect();
  console.log('\nAnalysis complete!');
}

main().catch((error) => {
  console.error('Analysis failed:', error);
  process.exit(1);
});
