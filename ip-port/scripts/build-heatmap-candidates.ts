/**
 * Build targeted candidate patent lists for next Patlytics heatmap batches.
 * Groups candidates by strategy: supporting patents, CPC variants, new angles.
 *
 * Usage:
 *   npx tsx scripts/build-heatmap-candidates.ts [options]
 *     --max-per-batch <n>   Max patents per Patlytics batch (default: 10)
 *     --output <dir>        Output directory (default: output/heatmap-candidates/)
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  getAllPatentCaches,
  type PatentCache,
} from '../src/api/services/patlytics-cache-service.js';

const prisma = new PrismaClient();

interface CandidateArgs {
  maxPerBatch: number;
  outputDir: string;
}

function parseArgs(): CandidateArgs {
  const args = process.argv.slice(2);
  let maxPerBatch = 10;
  let outputDir = path.join(process.cwd(), 'output', 'heatmap-candidates');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-per-batch' && args[i + 1]) maxPerBatch = parseInt(args[++i], 10);
    else if (args[i] === '--output' && args[i + 1]) outputDir = args[++i];
  }
  return { maxPerBatch, outputDir };
}

interface PatentCandidate {
  patentId: string;
  title: string;
  sector: string;
  superSector: string;
  subSector: string | null;
  internalV3Score: number | null;
  internalRank: number | null;
  subSectorScore: number | null;
  baseScore: number | null;
  cpcCodes: string[];
  strategy: string;
  reason: string;
  priority: number;
}

interface BatchProposal {
  batchName: string;
  strategy: string;
  description: string;
  relatedHotPatents: string[];
  targetProducts: string[];
  targetCompanies: string[];
  candidates: PatentCandidate[];
}

async function main(): Promise<void> {
  const config = parseArgs();
  console.log('=== Build Heatmap Candidate Batches ===\n');

  const allHeatmap = getAllPatentCaches();
  const heatmapIds = new Set(allHeatmap.map(p => p.patentId));

  // Identify hot patents and their characteristics
  const hotPatents = allHeatmap.filter(p => p.maxScoreOverall >= 0.80);
  console.log(`Hot heatmap patents: ${hotPatents.length}`);

  // Get DB metadata for hot patents
  const hotMeta = await prisma.patent.findMany({
    where: { patentId: { in: hotPatents.map(p => p.patentId) } },
    select: {
      patentId: true, title: true, primarySector: true, superSector: true,
      primarySubSectorName: true, primaryCpc: true, baseScore: true,
      cpcCodes: { select: { cpcCode: true } },
    },
  });
  const hotMetaMap = new Map(hotMeta.map(p => [p.patentId, p]));

  // Group hot patents by "strategy cluster" (sector + common CPC prefix)
  interface StrategyCluster {
    name: string;
    description: string;
    hotPatents: PatentCache[];
    sectors: Set<string>;
    cpcGroups: Set<string>;
    cpcFull: Set<string>;
    topProducts: Array<{ product: string; company: string; score: number }>;
    topCompanies: Set<string>;
  }

  const clusters: StrategyCluster[] = [];

  // Cluster 1: SDN / Network Virtualization
  const sdnHot = hotPatents.filter(p => {
    const m = hotMetaMap.get(p.patentId);
    return m?.primarySector === 'computing-runtime' &&
      p.products.some(pr => pr.productName.toLowerCase().includes('sdn') ||
        pr.productName.toLowerCase().includes('aci') ||
        pr.productName.toLowerCase().includes('andromeda') ||
        pr.productName.toLowerCase().includes('virtual'));
  });

  if (sdnHot.length > 0) {
    const cpcGroups = new Set<string>();
    const cpcFull = new Set<string>();
    const sectors = new Set<string>();
    for (const hp of sdnHot) {
      const m = hotMetaMap.get(hp.patentId);
      if (m) {
        if (m.primarySector) sectors.add(m.primarySector);
        if (m.primaryCpc) { cpcGroups.add(m.primaryCpc.substring(0, 4)); cpcFull.add(m.primaryCpc); }
        for (const c of m.cpcCodes) { cpcGroups.add(c.cpcCode.substring(0, 4)); cpcFull.add(c.cpcCode); }
      }
    }
    const topProducts = sdnHot.flatMap(p => p.products.filter(pr => pr.isHot))
      .sort((a, b) => b.maxScore - a.maxScore)
      .slice(0, 10)
      .map(p => ({ product: p.productName, company: p.companyName, score: p.maxScore }));
    const topCompanies = new Set(topProducts.map(p => p.company));

    clusters.push({
      name: 'SDN & Network Virtualization',
      description: 'Managed switching / SDN control plane patents. Extremely strong results against Cisco ACI, Google Andromeda, Microsoft Network Controller.',
      hotPatents: sdnHot, sectors, cpcGroups, cpcFull, topProducts, topCompanies,
    });
  }

  // Cluster 2: VM / Hypervisor / Virtualization
  const vmHot = hotPatents.filter(p => {
    const m = hotMetaMap.get(p.patentId);
    return m?.primarySector === 'computing-runtime' &&
      p.products.some(pr => pr.productName.toLowerCase().includes('vm') ||
        pr.productName.toLowerCase().includes('hypervisor') ||
        pr.productName.toLowerCase().includes('powervm') ||
        pr.productName.toLowerCase().includes('kvm'));
  });

  if (vmHot.length > 0) {
    const cpcGroups = new Set<string>();
    const cpcFull = new Set<string>();
    const sectors = new Set<string>();
    for (const hp of vmHot) {
      const m = hotMetaMap.get(hp.patentId);
      if (m) {
        if (m.primarySector) sectors.add(m.primarySector);
        if (m.primaryCpc) { cpcGroups.add(m.primaryCpc.substring(0, 4)); cpcFull.add(m.primaryCpc); }
        for (const c of m.cpcCodes) { cpcGroups.add(c.cpcCode.substring(0, 4)); cpcFull.add(c.cpcCode); }
      }
    }
    const topProducts = vmHot.flatMap(p => p.products.filter(pr => pr.isHot))
      .sort((a, b) => b.maxScore - a.maxScore).slice(0, 10)
      .map(p => ({ product: p.productName, company: p.companyName, score: p.maxScore }));

    clusters.push({
      name: 'Virtualization & Hypervisor',
      description: 'VM passthrough, emulation, hypervisor management patents. Strong against IBM PowerVM, Oracle VM.',
      hotPatents: vmHot, sectors, cpcGroups, cpcFull, topProducts,
      topCompanies: new Set(topProducts.map(p => p.company)),
    });
  }

  // Cluster 3: BAW Resonators / RF Acoustic Filters
  const bawHot = hotPatents.filter(p => {
    const m = hotMetaMap.get(p.patentId);
    return m?.primarySector === 'rf-acoustic';
  });

  if (bawHot.length > 0) {
    const cpcGroups = new Set<string>();
    const cpcFull = new Set<string>();
    const sectors = new Set<string>();
    for (const hp of bawHot) {
      const m = hotMetaMap.get(hp.patentId);
      if (m) {
        if (m.primarySector) sectors.add(m.primarySector);
        if (m.primaryCpc) { cpcGroups.add(m.primaryCpc.substring(0, 4)); cpcFull.add(m.primaryCpc); }
        for (const c of m.cpcCodes) { cpcGroups.add(c.cpcCode.substring(0, 4)); cpcFull.add(c.cpcCode); }
      }
    }
    const topProducts = bawHot.flatMap(p => p.products.filter(pr => pr.isHot))
      .sort((a, b) => b.maxScore - a.maxScore).slice(0, 10)
      .map(p => ({ product: p.productName, company: p.companyName, score: p.maxScore }));

    clusters.push({
      name: 'BAW Resonators & RF Filters',
      description: 'Bulk acoustic wave, piezoelectric, temperature compensation filter patents. Strong against Skyworks, Qorvo, Murata, MACOM.',
      hotPatents: bawHot, sectors, cpcGroups, cpcFull, topProducts,
      topCompanies: new Set(topProducts.map(p => p.company)),
    });
  }

  // Cluster 4: Analog / ADC / Power Amplifier
  const analogHot = hotPatents.filter(p => {
    const m = hotMetaMap.get(p.patentId);
    return m?.primarySector === 'analog-circuits' || m?.primarySector === 'semiconductor';
  });

  if (analogHot.length > 0) {
    const cpcGroups = new Set<string>();
    const cpcFull = new Set<string>();
    const sectors = new Set<string>();
    for (const hp of analogHot) {
      const m = hotMetaMap.get(hp.patentId);
      if (m) {
        if (m.primarySector) sectors.add(m.primarySector);
        if (m.primaryCpc) { cpcGroups.add(m.primaryCpc.substring(0, 4)); cpcFull.add(m.primaryCpc); }
        for (const c of m.cpcCodes) { cpcGroups.add(c.cpcCode.substring(0, 4)); cpcFull.add(c.cpcCode); }
      }
    }
    const topProducts = analogHot.flatMap(p => p.products.filter(pr => pr.isHot))
      .sort((a, b) => b.maxScore - a.maxScore).slice(0, 10)
      .map(p => ({ product: p.productName, company: p.companyName, score: p.maxScore }));

    clusters.push({
      name: 'ADC/DAC & Analog Circuits',
      description: 'High-speed ADC, DAC, analog amplifier, envelope tracking patents. Strong against Analog Devices, TI, Qualcomm.',
      hotPatents: analogHot, sectors, cpcGroups, cpcFull, topProducts,
      topCompanies: new Set(topProducts.map(p => p.company)),
    });
  }

  // Cluster 5: Security / Threat Protection
  const secHot = hotPatents.filter(p => {
    const m = hotMetaMap.get(p.patentId);
    return m?.superSector === 'SECURITY';
  });

  if (secHot.length > 0) {
    const cpcGroups = new Set<string>();
    const cpcFull = new Set<string>();
    const sectors = new Set<string>();
    for (const hp of secHot) {
      const m = hotMetaMap.get(hp.patentId);
      if (m) {
        if (m.primarySector) sectors.add(m.primarySector);
        if (m.primaryCpc) { cpcGroups.add(m.primaryCpc.substring(0, 4)); cpcFull.add(m.primaryCpc); }
        for (const c of m.cpcCodes) { cpcGroups.add(c.cpcCode.substring(0, 4)); cpcFull.add(c.cpcCode); }
      }
    }
    const topProducts = secHot.flatMap(p => p.products.filter(pr => pr.isHot))
      .sort((a, b) => b.maxScore - a.maxScore).slice(0, 10)
      .map(p => ({ product: p.productName, company: p.companyName, score: p.maxScore }));

    clusters.push({
      name: 'Network Security & Threat Detection',
      description: 'Threat prediction, SIEM, network security analytics patents. Strong against IBM QRadar, Zscaler ZIA.',
      hotPatents: secHot, sectors, cpcGroups, cpcFull, topProducts,
      topCompanies: new Set(topProducts.map(p => p.company)),
    });
  }

  // Cluster 6: CXL / Advanced Memory
  const cxlHot = hotPatents.filter(p => {
    const m = hotMetaMap.get(p.patentId);
    return m?.primarySector === 'computing-systems' && p.maxScoreOverall >= 0.80;
  });

  if (cxlHot.length > 0) {
    const cpcGroups = new Set<string>();
    const cpcFull = new Set<string>();
    const sectors = new Set<string>();
    for (const hp of cxlHot) {
      const m = hotMetaMap.get(hp.patentId);
      if (m) {
        if (m.primarySector) sectors.add(m.primarySector);
        if (m.primaryCpc) { cpcGroups.add(m.primaryCpc.substring(0, 4)); cpcFull.add(m.primaryCpc); }
        for (const c of m.cpcCodes) { cpcGroups.add(c.cpcCode.substring(0, 4)); cpcFull.add(c.cpcCode); }
      }
    }
    const topProducts = cxlHot.flatMap(p => p.products.filter(pr => pr.isHot))
      .sort((a, b) => b.maxScore - a.maxScore).slice(0, 10)
      .map(p => ({ product: p.productName, company: p.companyName, score: p.maxScore }));

    clusters.push({
      name: 'CXL / Heterogeneous Cache Architecture',
      description: 'CXL memory modules, cache coherency, heterogeneous compute. Strong against Intel Xeon 6, AMD EPYC, Nvidia Grace.',
      hotPatents: cxlHot, sectors, cpcGroups, cpcFull, topProducts,
      topCompanies: new Set(topProducts.map(p => p.company)),
    });
  }

  console.log(`\nIdentified ${clusters.length} strategy clusters\n`);

  // For each cluster, find candidate patents
  const batches: BatchProposal[] = [];

  for (const cluster of clusters) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`CLUSTER: ${cluster.name}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`${cluster.description}`);
    console.log(`Hot patents: ${cluster.hotPatents.map(p => p.patentId).join(', ')}`);
    console.log(`Target products: ${cluster.topProducts.slice(0, 5).map(p => `${p.product} (${p.company})`).join(', ')}`);
    console.log(`CPC groups: ${[...cluster.cpcGroups].join(', ')}`);

    // Strategy A: "Family members" — same patent families / very close CPC
    const familyCandidates = await prisma.patent.findMany({
      where: {
        primarySector: { in: [...cluster.sectors] },
        patentId: { notIn: [...heatmapIds] },
        isExpired: false,
      },
      select: {
        patentId: true, title: true, primarySector: true, superSector: true,
        primarySubSectorName: true, baseScore: true, primaryCpc: true,
        cpcCodes: { select: { cpcCode: true } },
      },
    });

    const familyIds = familyCandidates.map(c => c.patentId);
    const v3Scores = await prisma.patentCompositeScore.findMany({
      where: { patentId: { in: familyIds }, scoreName: 'v3_score' },
      select: { patentId: true, value: true, rank: true },
    });
    const v3Map = new Map(v3Scores.map(s => [s.patentId, s]));

    const subScores = await prisma.patentSubSectorScore.findMany({
      where: { patentId: { in: familyIds } },
      select: { patentId: true, compositeScore: true },
      orderBy: { compositeScore: 'desc' },
      distinct: ['patentId'],
    });
    const subMap = new Map(subScores.map(s => [s.patentId, s.compositeScore]));

    // Score and categorize candidates
    const candidates: PatentCandidate[] = [];

    for (const patent of familyCandidates) {
      const allCpcs = [
        ...(patent.primaryCpc ? [patent.primaryCpc] : []),
        ...patent.cpcCodes.map(c => c.cpcCode),
      ];
      const cpcGroupSet = new Set(allCpcs.map(c => c.substring(0, 4)));

      const exactMatches = allCpcs.filter(c => cluster.cpcFull.has(c)).length;
      const groupOverlap = [...cpcGroupSet].filter(g => cluster.cpcGroups.has(g)).length;

      if (exactMatches === 0 && groupOverlap === 0) continue; // No CPC connection

      const v3 = v3Map.get(patent.patentId);
      const subScore = subMap.get(patent.patentId);

      // Determine strategy type
      let strategy: string;
      let reason: string;
      let priority: number;

      if (exactMatches >= 5) {
        strategy = 'supporting-family';
        reason = `${exactMatches} exact CPC matches — likely same patent family or very close variant`;
        priority = 100 + exactMatches * 5 + (v3?.value ?? 0) * 0.5;
      } else if (exactMatches >= 2) {
        strategy = 'close-variant';
        reason = `${exactMatches} exact CPC matches — related technology variant`;
        priority = 50 + exactMatches * 5 + (v3?.value ?? 0) * 0.5;
      } else if (groupOverlap >= 2) {
        strategy = 'broader-variant';
        reason = `${groupOverlap} CPC group overlaps — broader technology variant`;
        priority = 30 + groupOverlap * 3 + (v3?.value ?? 0) * 0.5;
      } else {
        strategy = 'new-angle';
        reason = `${groupOverlap} CPC group overlap — potentially new angle in same sector`;
        priority = 10 + (v3?.value ?? 0) * 0.5;
      }

      // Boost high internal scorers
      if (v3 && v3.rank !== null && v3.rank <= 50) {
        priority += 20;
        reason += '; Top-50 internal rank';
      } else if (v3 && v3.rank !== null && v3.rank <= 200) {
        priority += 10;
        reason += '; Top-200 internal rank';
      }

      // Boost high sub-sector scorers
      if (subScore && subScore >= 70) {
        priority += 10;
        reason += `; High sub-sector score (${subScore.toFixed(1)})`;
      }

      candidates.push({
        patentId: patent.patentId,
        title: patent.title,
        sector: patent.primarySector!,
        superSector: patent.superSector || '',
        subSector: patent.primarySubSectorName,
        internalV3Score: v3?.value ?? null,
        internalRank: v3?.rank ?? null,
        subSectorScore: subScore ?? null,
        baseScore: patent.baseScore,
        cpcCodes: allCpcs.slice(0, 8),
        strategy,
        reason,
        priority,
      });
    }

    candidates.sort((a, b) => b.priority - a.priority);

    // Build batch proposals
    // Strategy A: Supporting patents (same family)
    const supporting = candidates.filter(c => c.strategy === 'supporting-family').slice(0, config.maxPerBatch);
    if (supporting.length > 0) {
      batches.push({
        batchName: `${cluster.name} — Supporting Patents`,
        strategy: 'supporting-family',
        description: `Patents closely related to hot patents via CPC. Likely to score well against same products.`,
        relatedHotPatents: cluster.hotPatents.map(p => p.patentId),
        targetProducts: cluster.topProducts.map(p => p.product),
        targetCompanies: [...cluster.topCompanies],
        candidates: supporting,
      });
    }

    // Strategy B: Close variants
    const variants = candidates.filter(c => c.strategy === 'close-variant').slice(0, config.maxPerBatch);
    if (variants.length > 0) {
      batches.push({
        batchName: `${cluster.name} — Close Variants`,
        strategy: 'close-variant',
        description: `Patents with significant CPC overlap. May address different aspects of same products.`,
        relatedHotPatents: cluster.hotPatents.map(p => p.patentId),
        targetProducts: cluster.topProducts.map(p => p.product),
        targetCompanies: [...cluster.topCompanies],
        candidates: variants,
      });
    }

    // Strategy C: High-internal-score new angles
    const highScoreNew = candidates
      .filter(c => c.internalV3Score !== null && c.internalV3Score >= 50)
      .sort((a, b) => (b.internalV3Score ?? 0) - (a.internalV3Score ?? 0))
      .slice(0, config.maxPerBatch);
    if (highScoreNew.length > 0) {
      batches.push({
        batchName: `${cluster.name} — High-Scoring New Angles`,
        strategy: 'high-internal-new-angle',
        description: `Patents with strong internal scores in the same sector. Could reveal new product targets.`,
        relatedHotPatents: cluster.hotPatents.map(p => p.patentId),
        targetProducts: cluster.topProducts.map(p => p.product),
        targetCompanies: [...cluster.topCompanies],
        candidates: highScoreNew,
      });
    }

    // Console output
    console.log(`\n  Supporting patents (${supporting.length}):`);
    for (const c of supporting.slice(0, 5)) {
      console.log(`    ${c.patentId} (pri=${c.priority.toFixed(0)}) — ${c.title.substring(0, 55)}`);
      console.log(`      v3=${c.internalV3Score?.toFixed(1) ?? '-'} rank=${c.internalRank ?? '-'} | ${c.reason}`);
    }

    console.log(`  Close variants (${variants.length}):`);
    for (const c of variants.slice(0, 5)) {
      console.log(`    ${c.patentId} (pri=${c.priority.toFixed(0)}) — ${c.title.substring(0, 55)}`);
      console.log(`      v3=${c.internalV3Score?.toFixed(1) ?? '-'} rank=${c.internalRank ?? '-'} | ${c.reason}`);
    }

    console.log(`  High-score new angles (${highScoreNew.length}):`);
    for (const c of highScoreNew.slice(0, 5)) {
      console.log(`    ${c.patentId} (pri=${c.priority.toFixed(0)}) — ${c.title.substring(0, 55)}`);
      console.log(`      v3=${c.internalV3Score?.toFixed(1) ?? '-'} rank=${c.internalRank ?? '-'} | ${c.reason}`);
    }
  }

  // Write outputs
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }

  // Full JSON
  const jsonPath = path.join(config.outputDir, 'candidate-batches.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config,
    totalBatches: batches.length,
    totalCandidates: batches.reduce((a, b) => a + b.candidates.length, 0),
    batches,
  }, null, 2));

  // Summary markdown
  const mdLines: string[] = [];
  mdLines.push('# Heatmap Candidate Batches for Patlytics');
  mdLines.push(`\nGenerated: ${new Date().toISOString()}\n`);

  for (const batch of batches) {
    mdLines.push(`## ${batch.batchName}`);
    mdLines.push(`\n**Strategy:** ${batch.strategy}`);
    mdLines.push(`**Description:** ${batch.description}`);
    mdLines.push(`**Related hot patents:** ${batch.relatedHotPatents.join(', ')}`);
    mdLines.push(`**Target companies:** ${batch.targetCompanies.join(', ')}`);
    mdLines.push(`\n| Patent ID | Title | V3 Score | Rank | Sub-Sector | Strategy |`);
    mdLines.push(`|-----------|-------|----------|------|------------|----------|`);
    for (const c of batch.candidates) {
      mdLines.push(`| ${c.patentId} | ${c.title.substring(0, 50)} | ${c.internalV3Score?.toFixed(1) ?? '-'} | ${c.internalRank ?? '-'} | ${c.subSector || '-'} | ${c.reason.substring(0, 40)} |`);
    }
    mdLines.push('');
  }

  const mdPath = path.join(config.outputDir, 'candidate-batches.md');
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${batches.length} batch proposals, ${batches.reduce((a, b) => a + b.candidates.length, 0)} total candidates`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${mdPath}`);
  console.log(`${'='.repeat(60)}`);

  await prisma.$disconnect();
}

main().catch(async err => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
